/**
 * Progress persistence (ARCHITECTURE.md §5.5). pedagogy/ has no DOM and no wall-clock
 * access (§2 rule 5) — storage and time are INJECTED: ui/ supplies the browser
 * implementations (localStorage + Date.now); tests supply an in-memory store and a
 * fake clock.
 *
 * Persisted under the key "mat2sps.progress.v1". The store keeps NO in-memory copy: every
 * accessor re-reads the KeyValueStore and every mutation writes it back, so two stores over
 * the same backing storage can never drift apart. A corrupt or foreign value is treated as
 * "no progress yet" (never throws) — a broken blob must not break the app; `import()` is
 * the only strict entry point.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type NowFn = () => number;               // real-time ms (epoch), injected

export const PROGRESS_STORAGE_KEY = 'mat2sps.progress.v1';
export const PROGRESS_FILE_VERSION = 1;

export type NetworkStatus = 'untouched' | 'attempted' | 'passed';

/** Per-network record. Times are REAL time (injected `now()`), not simulated time (§5.5). */
export interface NetworkProgress {
  status: NetworkStatus;
  /** First time the student opened this network — the base of the 5-minute hint unlock. */
  firstSeenMs: number | null;
  /** Failed "Run checks" runs — the attempt count that gates hint levels (§5.5 HintGate). */
  failedRuns: number;
  /** "Run checks" runs in which every check passed. */
  passedRuns: number;
  /** Explicit "I'm stuck" clicks. */
  stuckClicks: number;
  /** Hint levels the student has actually revealed. */
  revealed: number[];
  lastUpdatedMs: number | null;
}

interface ProgressFile {
  version: number;
  networks: Record<string, NetworkProgress>;
}

function emptyNetwork(): NetworkProgress {
  return {
    status: 'untouched',
    firstSeenMs: null,
    failedRuns: 0,
    passedRuns: 0,
    stuckClicks: 0,
    revealed: [],
    lastUpdatedMs: null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nonNegativeInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function statusOf(v: unknown): NetworkStatus {
  return v === 'attempted' || v === 'passed' ? v : 'untouched';
}

function levelsOf(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 1 && !out.includes(item)) {
      out.push(item);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Lenient normalisation used when reading storage: unknown shapes degrade to defaults. */
function normalizeNetwork(v: unknown): NetworkProgress {
  if (!isRecord(v)) return emptyNetwork();
  return {
    status: statusOf(v['status']),
    firstSeenMs: numberOrNull(v['firstSeenMs']),
    failedRuns: nonNegativeInt(v['failedRuns']),
    passedRuns: nonNegativeInt(v['passedRuns']),
    stuckClicks: nonNegativeInt(v['stuckClicks']),
    revealed: levelsOf(v['revealed']),
    lastUpdatedMs: numberOrNull(v['lastUpdatedMs']),
  };
}

function cloneNetwork(n: NetworkProgress): NetworkProgress {
  return { ...n, revealed: [...n.revealed] };
}

export class ProgressStore {                    // persisted under key "mat2sps.progress.v1"
  private readonly kv: KeyValueStore;
  private readonly now: NowFn;

  constructor(kv: KeyValueStore, now: NowFn) {
    this.kv = kv;
    this.now = now;
  }

  // ── reads ────────────────────────────────────────────────────────────────────────────

  networkStatus(id: string): NetworkStatus {
    return this.networkProgress(id).status;
  }

  hintState(id: string): { revealed: number[] } {
    return { revealed: this.networkProgress(id).revealed };
  }

  /** Full record (a copy — mutating it does not touch storage). */
  networkProgress(id: string): NetworkProgress {
    const file = this.load();
    const entry = file.networks[id];
    return entry === undefined ? emptyNetwork() : cloneNetwork(entry);
  }

  /** Ids with stored progress, in storage-file order. */
  networkIds(): string[] {
    return Object.keys(this.load().networks);
  }

  /**
   * Real time since the network was first opened, 0 if never opened. Deliberately
   * "wall clock since first visit" rather than accumulated focus time: the unlock policy
   * (§5.5) only needs a monotone "how long has the student been at it".
   */
  elapsedOnNetworkMs(id: string): number {
    const first = this.networkProgress(id).firstSeenMs;
    if (first === null) return 0;
    const dt = this.now() - first;
    return dt > 0 ? dt : 0;
  }

  // ── mutations ────────────────────────────────────────────────────────────────────────

  /** Call when the student opens the network. Stamps `firstSeenMs` exactly once. */
  markVisited(id: string): void {
    this.mutate(id, (n) => {
      if (n.firstSeenMs === null) n.firstSeenMs = this.now();
    });
  }

  setNetworkStatus(id: string, s: 'attempted' | 'passed'): void {
    this.mutate(id, (n) => {
      // 'passed' is never downgraded to 'attempted' by a later failed run.
      if (n.status === 'passed' && s === 'attempted') return;
      n.status = s;
    });
  }

  /** A "Run checks" run that did not pass — the attempt count for hint gating. */
  recordFailedRun(id: string): void {
    this.mutate(id, (n) => {
      n.failedRuns += 1;
      if (n.status !== 'passed') n.status = 'attempted';
      if (n.firstSeenMs === null) n.firstSeenMs = this.now();
    });
  }

  /** A "Run checks" run in which every check passed. */
  recordPassedRun(id: string): void {
    this.mutate(id, (n) => {
      n.passedRuns += 1;
      n.status = 'passed';
      if (n.firstSeenMs === null) n.firstSeenMs = this.now();
    });
  }

  /** Explicit "I'm stuck" click (§5.5 unlock trigger c). */
  recordStuck(id: string): void {
    this.mutate(id, (n) => {
      n.stuckClicks += 1;
      if (n.status === 'untouched') n.status = 'attempted';
      if (n.firstSeenMs === null) n.firstSeenMs = this.now();
    });
  }

  /** Record that a hint level was revealed (idempotent). */
  revealHint(id: string, level: number): void {
    this.mutate(id, (n) => {
      if (!n.revealed.includes(level)) {
        n.revealed.push(level);
        n.revealed.sort((a, b) => a - b);
      }
    });
  }

  /** Drop all stored progress. */
  clear(): void {
    this.kv.remove(PROGRESS_STORAGE_KEY);
  }

  // ── backup ───────────────────────────────────────────────────────────────────────────

  export(): string {                            // JSON blob for backup
    return JSON.stringify(this.load());
  }

  /** Strict counterpart of `export()` — throws on anything that is not a progress blob. */
  import(s: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      throw new Error('ProgressStore.import: not valid JSON');
    }
    if (!isRecord(parsed)) throw new Error('ProgressStore.import: expected an object');
    if (parsed['version'] !== PROGRESS_FILE_VERSION) {
      throw new Error(
        `ProgressStore.import: unsupported version ${String(parsed['version'])} ` +
          `(expected ${PROGRESS_FILE_VERSION})`,
      );
    }
    const networks = parsed['networks'];
    if (!isRecord(networks)) throw new Error('ProgressStore.import: "networks" must be an object');
    const file: ProgressFile = { version: PROGRESS_FILE_VERSION, networks: {} };
    for (const [id, value] of Object.entries(networks)) {
      if (!isRecord(value)) {
        throw new Error(`ProgressStore.import: networks.${id} must be an object`);
      }
      file.networks[id] = normalizeNetwork(value);
    }
    this.save(file);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────

  private load(): ProgressFile {
    const raw = this.kv.get(PROGRESS_STORAGE_KEY);
    if (raw === null) return { version: PROGRESS_FILE_VERSION, networks: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { version: PROGRESS_FILE_VERSION, networks: {} };
    }
    const out: ProgressFile = { version: PROGRESS_FILE_VERSION, networks: {} };
    if (!isRecord(parsed)) return out;
    const networks = parsed['networks'];
    if (isRecord(networks)) {
      for (const [id, value] of Object.entries(networks)) {
        out.networks[id] = normalizeNetwork(value);
      }
    }
    return out;
  }

  private save(file: ProgressFile): void {
    this.kv.set(PROGRESS_STORAGE_KEY, JSON.stringify(file));
  }

  private mutate(id: string, fn: (n: NetworkProgress) => void): void {
    const file = this.load();
    const current = file.networks[id];
    const entry = current === undefined ? emptyNetwork() : current;
    fn(entry);
    entry.lastUpdatedMs = this.now();
    file.networks[id] = entry;
    this.save(file);
  }
}

/** In-memory KeyValueStore — tests, and ui/ fallback when browser storage is unavailable. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    const v = this.map.get(key);
    return v === undefined ? null : v;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}
