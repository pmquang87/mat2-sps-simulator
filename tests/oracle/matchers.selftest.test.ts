/**
 * Self-test for the §9.4 oracle matchers — the same anti-vacuity principle as the self-test
 * at the end of `no-bundle.test.ts`, applied to the acceptance assertions.
 *
 * The group suites can only ever show that a CORRECT solution passes. They cannot show that
 * an incorrect one fails: for that, each matcher is fed a deliberately wrong log here and
 * must reject it. Combined with the trackplan mutation controls in the group suites (which
 * cover the assertions end-to-end through a real run), this keeps the milestone-1 gate from
 * silently degrading into a green rubber stamp — e.g. if `assertTrailedSet` were ever
 * relaxed from an exact multiset to a subset check, or `assertAllPulseDurations` were made
 * to tolerate an empty pulse list, the corresponding case below turns red.
 *
 * Runs unconditionally: it needs no `reference/Claude_work/` solution, only synthetic event logs.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/plant';
import {
  assertAllPulseDurations, assertBounceExercised, assertStartsOnNotausRelease, assertTrailedSet,
} from './matchers';

const good: SimEvent[] = [
  { t: 0, type: 'notaus', active: true },
  { t: 1990, type: 'notaus', active: false },
  { t: 2000, type: 'speedCommand', level: 1, direction: 'IU', word: 1 },
  { t: 2010, type: 'trainStarted', direction: 'IU' },
];

describe('oracle matcher self-test (§9.4 anti-vacuity)', () => {
  it('accepts a good notaus/start log', () => {
    assertStartsOnNotausRelease(good, 50);
  });
  it('rejects a speed command issued while notaus is pressed', () => {
    const bad: SimEvent[] = [
      { t: 0, type: 'notaus', active: true },
      { t: 50, type: 'speedCommand', level: 1, direction: 'IU', word: 1 },
      ...good.slice(1),
    ];
    expect(() => { assertStartsOnNotausRelease(bad, 50); }).toThrow();
  });
  it('rejects a start that lags the release by more than one scan', () => {
    const bad: SimEvent[] = [
      { t: 0, type: 'notaus', active: true },
      { t: 1990, type: 'notaus', active: false },
      { t: 5000, type: 'speedCommand', level: 1, direction: 'IU', word: 1 },
      { t: 5010, type: 'trainStarted', direction: 'IU' },
    ];
    expect(() => { assertStartsOnNotausRelease(bad, 50); }).toThrow();
  });
  it('rejects an out-of-band pulse duration', () => {
    expect(() => {
      assertAllPulseDurations([
        { t: 100, type: 'switchPulse', switchId: 'xW01D', coil: 'G', durationMs: 300 },
        { t: 200, type: 'switchPulse', switchId: 'xW02D', coil: 'R', durationMs: 600 },
      ]);
    }).toThrow();
    expect(() => { assertAllPulseDurations([]); }).toThrow();   // no pulses at all
  });
  it('rejects a trailed multiset mismatch in both directions', () => {
    const ev: SimEvent[] = [{ t: 1, type: 'switchTrailed', switchId: 'xW04D' }];
    expect(() => { assertTrailedSet(ev, []); }).toThrow();                        // extra
    expect(() => { assertTrailedSet([], [{ switchId: 'xW04D', count: 1 }]); }).toThrow(); // missing
    expect(() => { assertTrailedSet(ev, [{ switchId: 'xW04D', count: 2 }]); }).toThrow(); // count
    assertTrailedSet(ev, [{ switchId: 'xW04D', count: 1 }]);                     // exact
  });
  it('rejects a clean signal when bounce is expected', () => {
    const clean: SimEvent[] = [
      { t: 1000, type: 'reedClosed', reedId: 'xR01D' },
      { t: 9000, type: 'reedClosed', reedId: 'xR01D' },
    ];
    expect(() => {
      assertBounceExercised(clean, { reedId: 'xR01D', physicalCrossings: 2, clusterGapMs: 2000 });
    }).toThrow();
    const bouncy: SimEvent[] = [
      { t: 1000, type: 'reedClosed', reedId: 'xR01D' },
      { t: 1050, type: 'reedClosed', reedId: 'xR01D' },
      { t: 9000, type: 'reedClosed', reedId: 'xR01D' },
      { t: 9060, type: 'reedClosed', reedId: 'xR01D' },
    ];
    assertBounceExercised(bouncy, { reedId: 'xR01D', physicalCrossings: 2, clusterGapMs: 2000 });
  });
});
