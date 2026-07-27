/**
 * ProgressStore (ARCHITECTURE.md §5.5): injected KeyValueStore + NowFn, no DOM, no wall
 * clock — the store runs in the node environment of §9.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MemoryKeyValueStore,
  PROGRESS_STORAGE_KEY,
  ProgressStore,
  type KeyValueStore,
} from '../../src/pedagogy';

let kv: KeyValueStore;
let now: number;
const nowFn = (): number => now;

beforeEach(() => {
  kv = new MemoryKeyValueStore();
  now = 1_700_000_000_000;
});

describe('ProgressStore status', () => {
  it('reports untouched for unknown networks', () => {
    const store = new ProgressStore(kv, nowFn);
    expect(store.networkStatus('A-NW1')).toBe('untouched');
    expect(store.hintState('A-NW1')).toEqual({ revealed: [] });
    expect(store.networkIds()).toEqual([]);
  });

  it('persists status transitions and never downgrades passed to attempted', () => {
    const store = new ProgressStore(kv, nowFn);
    store.setNetworkStatus('A-NW1', 'attempted');
    expect(store.networkStatus('A-NW1')).toBe('attempted');
    store.setNetworkStatus('A-NW1', 'passed');
    store.setNetworkStatus('A-NW1', 'attempted');
    expect(store.networkStatus('A-NW1')).toBe('passed');
  });

  it('counts failed runs, passed runs and stuck clicks', () => {
    const store = new ProgressStore(kv, nowFn);
    store.recordFailedRun('A-NW3');
    store.recordFailedRun('A-NW3');
    store.recordStuck('A-NW3');
    const progress = store.networkProgress('A-NW3');
    expect(progress).toMatchObject({ failedRuns: 2, stuckClicks: 1, status: 'attempted' });
    store.recordPassedRun('A-NW3');
    expect(store.networkProgress('A-NW3')).toMatchObject({ passedRuns: 1, status: 'passed' });
  });

  it('stamps firstSeenMs once and measures elapsed real time from it', () => {
    const store = new ProgressStore(kv, nowFn);
    store.markVisited('B-NW7');
    const first = store.networkProgress('B-NW7').firstSeenMs;
    now += 90_000;
    store.markVisited('B-NW7');
    expect(store.networkProgress('B-NW7').firstSeenMs).toBe(first);
    expect(store.elapsedOnNetworkMs('B-NW7')).toBe(90_000);
    expect(store.elapsedOnNetworkMs('B-NW8')).toBe(0);
  });

  it('records revealed hint levels idempotently and sorted', () => {
    const store = new ProgressStore(kv, nowFn);
    store.revealHint('A-NW8', 2);
    store.revealHint('A-NW8', 1);
    store.revealHint('A-NW8', 2);
    expect(store.hintState('A-NW8').revealed).toEqual([1, 2]);
  });

  it('returns copies, so mutating a result does not change storage', () => {
    const store = new ProgressStore(kv, nowFn);
    store.revealHint('A-NW1', 1);
    const progress = store.networkProgress('A-NW1');
    progress.revealed.push(3);
    progress.status = 'passed';
    expect(store.networkProgress('A-NW1').revealed).toEqual([1]);
    expect(store.networkStatus('A-NW1')).toBe('untouched');
  });
});

describe('ProgressStore persistence', () => {
  it('shares state between two stores over the same backing storage', () => {
    const a = new ProgressStore(kv, nowFn);
    const b = new ProgressStore(kv, nowFn);
    a.recordFailedRun('A-NW5');
    expect(b.networkProgress('A-NW5').failedRuns).toBe(1);
    b.recordFailedRun('A-NW5');
    expect(a.networkProgress('A-NW5').failedRuns).toBe(2);
  });

  it('survives a round-trip through export/import', () => {
    const store = new ProgressStore(kv, nowFn);
    store.recordFailedRun('A-NW2');
    store.revealHint('A-NW2', 2);
    store.setNetworkStatus('A-NW4', 'passed');
    const blob = store.export();

    const fresh = new ProgressStore(new MemoryKeyValueStore(), nowFn);
    fresh.import(blob);
    expect(fresh.networkStatus('A-NW4')).toBe('passed');
    expect(fresh.hintState('A-NW2').revealed).toEqual([2]);
    expect(fresh.networkProgress('A-NW2').failedRuns).toBe(1);
  });

  it('rejects invalid import blobs', () => {
    const store = new ProgressStore(kv, nowFn);
    expect(() => store.import('not json')).toThrow(/not valid JSON/);
    expect(() => store.import('[]')).toThrow(/expected an object/);
    expect(() => store.import('{"version":99,"networks":{}}')).toThrow(/unsupported version/);
    expect(() => store.import('{"version":1,"networks":[]}')).toThrow(/must be an object/);
    expect(() => store.import('{"version":1,"networks":{"A-NW1":3}}')).toThrow(/must be an object/);
  });

  it('treats a corrupt stored value as "no progress yet" instead of throwing', () => {
    kv.set(PROGRESS_STORAGE_KEY, '{ this is not json');
    const store = new ProgressStore(kv, nowFn);
    expect(store.networkStatus('A-NW1')).toBe('untouched');
    store.recordFailedRun('A-NW1');
    expect(store.networkProgress('A-NW1').failedRuns).toBe(1);
  });

  it('normalises foreign field values on read', () => {
    kv.set(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        networks: { 'A-NW1': { status: 'weird', failedRuns: -3, revealed: [2, 'x', 2, 1] } },
      }),
    );
    const store = new ProgressStore(kv, nowFn);
    expect(store.networkProgress('A-NW1')).toMatchObject({
      status: 'untouched',
      failedRuns: 0,
      revealed: [1, 2],
    });
  });

  it('clear() drops everything', () => {
    const store = new ProgressStore(kv, nowFn);
    store.recordFailedRun('A-NW1');
    store.clear();
    expect(store.networkIds()).toEqual([]);
  });
});
