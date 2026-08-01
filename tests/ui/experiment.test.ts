/**
 * The experiment switcher's persistence contract (`src/ui/experiment.ts`).
 *
 * `main.ts` routes on `readStoredExperiment()`, so this is the function that decides which
 * app a student gets. The load-bearing property is the fallback: anything unrecognised —
 * a stale value, a hand-edited entry, a blocked storage — must yield the railway, because
 * "no app at all" is the only outcome worse than "the wrong experiment".
 *
 * The buffer keys matter for the same reason the two experiments exist separately: the
 * programs address different plants, so one must never overwrite the other.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorBufferStore } from '../../src/ui/editor/bufferStore';
import {
  DEFAULT_EXPERIMENT,
  EXPERIMENT_IDS,
  EXPERIMENT_STORAGE_KEY,
  editorStorageKeyFor,
  isExperimentId,
  readStoredExperiment,
  switchExperiment,
  writeStoredExperiment,
} from '../../src/ui/experiment';

interface Globals { localStorage?: unknown }

/** Minimal Storage stand-in; `throwing` models private mode / a blocked quota. */
function installStorage(seed: Record<string, string> = {}, throwing = false): () => void {
  const globals = globalThis as unknown as Globals;
  const previous = globals.localStorage;
  const map = new Map<string, string>(Object.entries(seed));
  globals.localStorage = {
    getItem: (key: string): string | null => {
      if (throwing) throw new Error('storage blocked');
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string): void => {
      if (throwing) throw new Error('storage blocked');
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
  return () => {
    if (previous === undefined) delete globals.localStorage;
    else globals.localStorage = previous;
  };
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

describe('experiment identity', () => {
  it('offers exactly the two experiments, railway first', () => {
    expect(EXPERIMENT_IDS).toEqual(['railway', 'pump']);
    expect(DEFAULT_EXPERIMENT).toBe('railway');
    expect(EXPERIMENT_STORAGE_KEY).toBe('mat2sps.experiment');
  });

  it('recognises only the two ids', () => {
    expect(isExperimentId('railway')).toBe(true);
    expect(isExperimentId('pump')).toBe(true);
    for (const value of ['Pump', '', 'weiche', null, undefined, 3, {}]) {
      expect(isExperimentId(value), String(value)).toBe(false);
    }
  });
});

describe('readStoredExperiment / writeStoredExperiment', () => {
  it('reads back what was written', () => {
    uninstall = installStorage();
    expect(readStoredExperiment()).toBe('railway');
    expect(writeStoredExperiment('pump')).toBe(true);
    expect(readStoredExperiment()).toBe('pump');
    expect(writeStoredExperiment('railway')).toBe(true);
    expect(readStoredExperiment()).toBe('railway');
  });

  it('falls back to the railway for an absent or unrecognised value', () => {
    uninstall = installStorage({ 'mat2sps.experiment': 'Pumpe' });
    expect(readStoredExperiment()).toBe('railway');
    uninstall();
    uninstall = installStorage();
    expect(readStoredExperiment()).toBe('railway');
  });

  it('survives blocked storage: reads the default, reports the failed write', () => {
    uninstall = installStorage({}, true);
    expect(readStoredExperiment()).toBe('railway');
    expect(writeStoredExperiment('pump')).toBe(false);
  });

  it('refuses to persist a value it would not read back', () => {
    uninstall = installStorage();
    expect(writeStoredExperiment('rail' as never)).toBe(false);
    expect(readStoredExperiment()).toBe('railway');
  });
});

describe('editor buffers are per experiment', () => {
  it('keeps the railway key and gives the pump its own', () => {
    expect(editorStorageKeyFor('railway')).toBe('mat2sps.editor.v1');
    expect(editorStorageKeyFor('pump')).toBe('mat2sps.editor.pump.v1');
    expect(editorStorageKeyFor('railway')).not.toBe(editorStorageKeyFor('pump'));
  });
});

/**
 * Switching experiments RELOADS the page, and both the editor buffer and the plant parameters
 * persist on a 500 ms debounce — a reload destroys those timers instead of running them, so a
 * student who typed and switched within half a second used to lose the keystrokes.
 *
 * Driven against the shipped units: the real `EditorBufferStore` the panel writes through, and
 * the real `switchExperiment` the shell calls. `EditorPanel` and `App` themselves cannot be
 * constructed here (CodeMirror needs a real DOM, §13.7 scope note), so what is NOT covered
 * headlessly is the one-line closure in `App.flushPendingWrites`.
 */
describe('switchExperiment', () => {
  function memoryStorage(): { map: Map<string, string>; get(k: string): string | null; set(k: string, v: string): void } {
    const map = new Map<string, string>();
    return {
      map,
      get: (k) => map.get(k) ?? null,
      set: (k, v) => {
        map.set(k, v);
      },
    };
  }

  it('flushes the debounced editor buffer BEFORE it persists and reloads', () => {
    const storage = memoryStorage();
    const key = editorStorageKeyFor('pump');
    let typed = '';
    const buffer = new EditorBufferStore(key, () => typed, storage);

    typed = 'U   E 0.7\nFP  M 10.0\n';
    buffer.schedule();                          // …and the student switches 20 ms later
    expect(buffer.hasPendingWrite()).toBe(true);
    expect(storage.map.size).toBe(0);

    const order: string[] = [];
    const switched = switchExperiment({
      current: 'pump',
      next: 'railway',
      flush: () => {
        order.push('flush');
        buffer.flush();
      },
      persist: (id) => {
        order.push(`persist:${id}`);
        return true;
      },
      reload: () => order.push('reload'),
    });

    expect(switched).toBe(true);
    expect(order).toEqual(['flush', 'persist:railway', 'reload']);
    expect(storage.map.get(key)).toBe('U   E 0.7\nFP  M 10.0\n');
    expect(buffer.hasPendingWrite()).toBe(false);
  });

  it('CONTROL: without the flush the reload would happen over an empty store', () => {
    const storage = memoryStorage();
    const buffer = new EditorBufferStore(editorStorageKeyFor('pump'), () => 'U E 0.7', storage);
    buffer.schedule();
    switchExperiment({
      current: 'pump',
      next: 'railway',
      flush: () => undefined,                   // the defect this item fixed
      persist: () => true,
      reload: () => undefined,
    });
    expect(storage.map.size).toBe(0);
    buffer.flush();                             // …clear the pending timer for this suite
  });

  it('does nothing at all when the picked experiment is already running', () => {
    const seen: string[] = [];
    const noop = (label: string) => (): boolean => {
      seen.push(label);
      return true;
    };
    expect(switchExperiment({
      current: 'pump',
      next: 'pump',
      flush: noop('flush'),
      persist: noop('persist'),
      reload: noop('reload'),
    })).toBe(false);
    expect(switchExperiment({
      current: 'railway',
      next: 'weiche' as never,
      flush: noop('flush'),
      persist: noop('persist'),
      reload: noop('reload'),
    })).toBe(false);
    expect(seen).toEqual([]);
  });
});
