/**
 * Which experiment the app boots into: the delivered model railway, or the pump teaching
 * example of Anleitung IV.2.5.2. One app, one `dist/index.html` — the choice is a persisted
 * localStorage value that `main.ts` routes on.
 *
 * Switching RELOADS the page (`location.reload()`) instead of tearing a live stack down.
 * That is deliberate: a reload has no disposal risk at all, while swapping a WebGL context,
 * a CodeMirror view, a rAF driver and a coordinator in place has several.
 *
 * What the student keeps across a switch is the PROGRAM: the editor buffer has a key per
 * experiment (`editorStorageKeyFor`), so the two programs cannot overwrite each other. The
 * panel layout and the locale are single, shared settings — they survive the reload, but they
 * are not remembered per experiment.
 *
 * Storage is accessed defensively: this module is imported by node-environment tests (§9)
 * and must survive a blocked `localStorage` (private mode) by falling back to the default.
 */

export type ExperimentId = 'railway' | 'pump';

/** Display order of the header switcher; `railway` first because it is the practicum task. */
export const EXPERIMENT_IDS: readonly ExperimentId[] = ['railway', 'pump'];

export const EXPERIMENT_STORAGE_KEY = 'mat2sps.experiment';

/** Unknown or absent storage means the railway — the delivered experiment (§1). */
export const DEFAULT_EXPERIMENT: ExperimentId = 'railway';

export function isExperimentId(value: unknown): value is ExperimentId {
  return value === 'railway' || value === 'pump';
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The persisted choice; anything unrecognised (or unreadable) falls back to the default.
 *
 * `getItem` is inside the try, not only the storage lookup: some browsers expose
 * `localStorage` and then throw on ACCESS (Safari private mode, blocked third-party
 * storage). This is the first call of the whole bootstrap, so a throw here would be a blank
 * page rather than a lost preference.
 */
export function readStoredExperiment(): ExperimentId {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(EXPERIMENT_STORAGE_KEY) ?? null;
  } catch {
    return DEFAULT_EXPERIMENT;
  }
  return isExperimentId(raw) ? raw : DEFAULT_EXPERIMENT;
}

/** Persist the choice. Returns whether it was actually written (blocked storage → false). */
export function writeStoredExperiment(id: ExperimentId): boolean {
  if (!isExperimentId(id)) return false;
  try {
    const target = store();
    if (target === null) return false;
    target.setItem(EXPERIMENT_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/** Editor buffer key per experiment (§7.4) — the two programs must not overwrite each other. */
export function editorStorageKeyFor(experiment: ExperimentId): string {
  return experiment === 'pump' ? 'mat2sps.editor.pump.v1' : 'mat2sps.editor.v1';
}

/** What a switch needs from the shell. Every effect is injected, so the ORDER below is a
 *  property of this function rather than of `App`'s DOM code. */
export interface ExperimentSwitch {
  /** The experiment running right now. */
  current: ExperimentId;
  /** The one the student picked. */
  next: ExperimentId;
  /** Force every debounced write out — the editor buffer and the plant parameters both
   *  persist on a timer, and a reload DESTROYS pending timers instead of running them. */
  flush: () => void;
  persist: (id: ExperimentId) => boolean;
  reload: () => void;
}

/**
 * Perform an experiment switch: flush, persist, reload — in that order, because the reload is
 * what ends the page.
 *
 * Returns false, doing nothing at all, when the picked experiment is already running or is
 * not a known id: clicking the active button must not cost a reload.
 */
export function switchExperiment(args: ExperimentSwitch): boolean {
  if (!isExperimentId(args.next) || args.next === args.current) return false;
  args.flush();
  args.persist(args.next);
  args.reload();
  return true;
}
