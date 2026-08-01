/**
 * The editor buffer's mirror into persistent storage: a debounced write plus an explicit
 * flush.
 *
 * It is a unit of its own rather than three methods on `EditorPanel` because the panel needs
 * a real DOM (it builds a CodeMirror `EditorView`) and this does not — so the contract that
 * matters, "the page going away must not cost the last keystrokes", is checkable in the node
 * suites. That is exactly the defect it was extracted for: the experiment switcher reloads
 * the page, and a reload DESTROYS the pending timer instead of running it.
 *
 * Storage is injected so the same code path is exercised headlessly. The browser default is
 * total: a blocked or absent `localStorage` (private mode, node) turns every write into a
 * no-op instead of throwing, because a failed mirror must never break editing.
 */

export interface EditorBufferStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Quiet period after the last keystroke before the buffer is mirrored, ms. */
export const EDITOR_SAVE_DEBOUNCE_MS = 500;

export function browserBufferStorage(): EditorBufferStorage {
  return {
    get: (key) => {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      } catch {
        /* quota or private mode — the editor keeps working, it just is not persisted */
      }
    },
  };
}

export class EditorBufferStore {
  private readonly key: string;
  private readonly read: () => string;
  private readonly storage: EditorBufferStorage;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `read` is called at write time, so the mirror always carries the CURRENT buffer — a
   *  save scheduled three keystrokes ago still stores what the student has now. */
  constructor(key: string, read: () => string, storage: EditorBufferStorage = browserBufferStorage()) {
    this.key = key;
    this.read = read;
    this.storage = storage;
  }

  /** The stored buffer, or null when nothing was ever mirrored (or storage is unavailable). */
  stored(): string | null {
    return this.storage.get(this.key);
  }

  /** Mirror after the debounce; a newer call replaces the pending one. */
  schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.storage.set(this.key, this.read());
    }, EDITOR_SAVE_DEBOUNCE_MS);
  }

  /** Cancel the pending save and mirror the buffer NOW. Safe to call repeatedly. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.storage.set(this.key, this.read());
  }

  /** Whether a debounced write is still waiting — for tests and for teardown assertions. */
  hasPendingWrite(): boolean {
    return this.timer !== null;
  }
}
