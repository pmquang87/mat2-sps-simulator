/**
 * Splitter controller (ARCHITECTURE.md §5.7): the DOM half of the resizable shell.
 *
 * It creates one `role="separator"` element per split, turns pointer drags and arrow keys into
 * `resizeSplit` calls, writes the resulting track lists onto the host element as custom
 * properties, and persists them under "mat2sps.layout.v1". All arithmetic lives in
 * layoutModel.ts — this file is deliberately the only place that needs a browser.
 *
 * Three properties matter for the rest of the app:
 *
 *  1. A resize is a pure STYLE write on one element. It never calls into scene/ or app/: the
 *     canvas' drawing buffer is re-synced from its CSS size by the App's ResizeObserver and,
 *     as a backstop, once per frame by the RafDriver callback in main.ts. Nothing here touches
 *     the SimClock, so dragging cannot change simulated time.
 *  2. A split is only operable while its splitter is actually laid out. In the stacked layouts
 *     the column splitters are `display: none` (the media queries own the arrangement there),
 *     and `isLive()` makes drag, keyboard and layout repair skip such a group instead of
 *     writing nonsense weights measured from a two-column grid.
 *  3. Storage is written on drag END (and on every keyboard step), never per pointermove.
 */
import { t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';
import { el } from '../dom';
import {
  DEFAULT_LAYOUT,
  KEYBOARD_COARSE_STEP_PX,
  KEYBOARD_STEP_PX,
  LAYOUT_STORAGE_KEY,
  SPLIT_GROUPS,
  SPLIT_GROUP_IDS,
  isDefaultLayout,
  layoutCssVars,
  parseLayout,
  repairLayout,
  resizeSplit,
  serializeLayout,
  splitPercent,
  withGroup,
} from './layoutModel';
import type { LayoutState, SplitGroupId } from './layoutModel';

/** The panel elements each group resizes, in DOM order (see LayoutState). */
export interface LayoutTracks {
  readonly columns: readonly HTMLElement[];
  readonly centreRows: readonly HTMLElement[];
  readonly rightRows: readonly HTMLElement[];
}

/** i18n label per splitter, indexed like the splitters of the group. */
const SPLITTER_LABELS: Record<SplitGroupId, readonly MsgKey[]> = {
  columns: ['layout.splitter.toolsCentre', 'layout.splitter.centreRight'],
  centreRows: ['layout.splitter.editorMessages'],
  rightRows: ['layout.splitter.viewportWatch'],
};

/** localStorage is absent in the node test environment and throws in some private modes. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class LayoutController {
  /** The separator elements, for the App to place between the panels it owns. */
  readonly splitters: Record<SplitGroupId, readonly HTMLElement[]>;

  private readonly tracks: LayoutTracks;
  private host: HTMLElement | null = null;
  private state: LayoutState = DEFAULT_LAYOUT;
  private observer: ResizeObserver | null = null;
  /** Teardown of the drag in progress — one at a time, and released on dispose(). */
  private endDrag: (() => void) | null = null;

  constructor(tracks: LayoutTracks) {
    this.tracks = tracks;
    this.splitters = {
      columns: this.buildSplitters('columns'),
      centreRows: this.buildSplitters('centreRows'),
      rightRows: this.buildSplitters('rightRows'),
    };
  }

  /**
   * Adopt `host` (the `.app-main` element — the custom properties inherit from there into the
   * columns), restore the persisted layout and repair it against the sizes actually available
   * on THIS display.
   */
  mount(host: HTMLElement): void {
    this.host = host;
    const restored = parseLayout(store()?.getItem(LAYOUT_STORAGE_KEY) ?? null);
    this.state = repairLayout(restored, this.availableSizes());
    this.apply();
    // Re-publish aria-valuenow when the WINDOW (not the user) changed the proportions.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.syncSplitterValues());
      this.observer.observe(host);
    }
  }

  /** "Reset layout" (control bar): back to the shipped proportions, storage record dropped. */
  reset(): void {
    this.state = DEFAULT_LAYOUT;
    this.apply();
    this.persist();
  }

  retranslate(): void {
    for (const id of SPLIT_GROUP_IDS) {
      const labels = SPLITTER_LABELS[id];
      this.splitters[id].forEach((splitter, index) => {
        const key = labels[index];
        if (key === undefined) return;
        splitter.setAttribute('aria-label', t(key));
        splitter.title = `${t(key)} — ${t('layout.splitterHint')}`;
      });
    }
  }

  dispose(): void {
    this.endDrag?.();
    this.observer?.disconnect();
    this.observer = null;
  }

  // ── construction ───────────────────────────────────────────────────────────

  private buildSplitters(group: SplitGroupId): HTMLElement[] {
    const spec = SPLIT_GROUPS[group];
    const orientation = spec.axis === 'x' ? 'vertical' : 'horizontal';
    const splitters: HTMLElement[] = [];
    for (let index = 0; index < spec.trackCount - 1; index += 1) {
      const splitter = el('div', {
        className: `app-splitter app-splitter-${spec.axis === 'x' ? 'col' : 'row'}`,
        attrs: {
          role: 'separator',
          'aria-orientation': orientation,
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          tabindex: '0',
        },
      });
      splitter.addEventListener('pointerdown', (ev) => this.beginDrag(group, index, ev));
      splitter.addEventListener('keydown', (ev) => this.onKeyDown(group, index, ev));
      splitter.addEventListener('dblclick', () => this.resetGroup(group));
      splitters.push(splitter);
    }
    return splitters;
  }

  // ── measurement ────────────────────────────────────────────────────────────

  /** Measured track sizes of a group along its axis; `[]` when the group is not operable. */
  private measure(group: SplitGroupId): number[] {
    if (!this.isLive(group)) return [];
    const horizontal = SPLIT_GROUPS[group].axis === 'x';
    return this.tracks[group].map((track) => {
      const rect = track.getBoundingClientRect();
      return horizontal ? rect.width : rect.height;
    });
  }

  /**
   * A group is operable only when every one of its splitters is laid out. `display: none`
   * (the stacked layouts drop the column splitters) reports 0 for both offsets, which is
   * exactly the signal we need — measuring a 3-track group inside a 2-column grid would
   * otherwise persist weights that describe a layout the user never saw.
   */
  private isLive(group: SplitGroupId): boolean {
    const splitters = this.splitters[group];
    if (splitters.length === 0) return false;
    return splitters.every((s) => s.offsetWidth > 0 && s.offsetHeight > 0);
  }

  private availableSizes(): Partial<Record<SplitGroupId, number>> {
    const sizes: Partial<Record<SplitGroupId, number>> = {};
    for (const id of SPLIT_GROUP_IDS) {
      const measured = this.measure(id);
      if (measured.length === 0) continue;
      sizes[id] = measured.reduce((sum, size) => sum + size, 0);
    }
    return sizes;
  }

  // ── interaction ────────────────────────────────────────────────────────────

  /**
   * `pointerdown` deliberately does NOT call `preventDefault()`: per the Pointer Events spec a
   * prevented pointerdown suppresses the compatibility mouse events, which is the documented
   * way to lose the `dblclick` that resets this split. Text selection is blocked by CSS
   * (`user-select: none` on the splitter and on `body` while dragging) instead.
   */
  private beginDrag(group: SplitGroupId, index: number, ev: PointerEvent): void {
    if (ev.button !== 0 || this.endDrag !== null) return;
    const sizes = this.measure(group);
    if (sizes.length === 0) return;
    const spec = SPLIT_GROUPS[group];
    const splitter = this.splitters[group][index];
    if (splitter === undefined) return;

    const origin = spec.axis === 'x' ? ev.clientX : ev.clientY;
    const dragClass = spec.axis === 'x' ? 'is-resizing-col' : 'is-resizing-row';
    splitter.classList.add('is-dragging');
    document.body.classList.add(dragClass);
    splitter.focus({ preventScroll: true });   // arrow keys continue where the drag stopped
    try {
      splitter.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is a convenience: the window listeners below track the drag either way */
    }

    const onMove = (move: Event): void => {
      const pointer = move as PointerEvent;
      if (pointer.pointerId !== ev.pointerId) return;
      const delta = (spec.axis === 'x' ? pointer.clientX : pointer.clientY) - origin;
      this.applyGroup(group, resizeSplit(sizes, spec.minPx, index, delta));
    };
    const onEnd = (end: Event): void => {
      if ((end as PointerEvent).pointerId !== ev.pointerId) return;
      finish();
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      splitter.classList.remove('is-dragging');
      document.body.classList.remove(dragClass);
      this.endDrag = null;
      this.persist();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    this.endDrag = finish;
  }

  /** Arrow keys resize (Shift = coarse step), Home/End restore this split's default. */
  private onKeyDown(group: SplitGroupId, index: number, ev: KeyboardEvent): void {
    if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault();
      this.resetGroup(group);
      return;
    }
    let direction = 0;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') direction = -1;
    else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') direction = 1;
    if (direction === 0) return;
    ev.preventDefault();
    const sizes = this.measure(group);
    if (sizes.length === 0) return;
    const step = ev.shiftKey ? KEYBOARD_COARSE_STEP_PX : KEYBOARD_STEP_PX;
    this.applyGroup(group, resizeSplit(sizes, SPLIT_GROUPS[group].minPx, index, direction * step));
    this.persist();
  }

  private resetGroup(group: SplitGroupId): void {
    this.state = withGroup(this.state, group, SPLIT_GROUPS[group].defaultWeights);
    this.apply();
    this.persist();
  }

  // ── applying / persisting ──────────────────────────────────────────────────

  private applyGroup(group: SplitGroupId, weights: readonly number[]): void {
    this.state = withGroup(this.state, group, weights);
    this.apply();
  }

  private apply(): void {
    const host = this.host;
    if (host === null) return;
    for (const [name, value] of Object.entries(layoutCssVars(this.state))) {
      host.style.setProperty(name, value);
    }
    this.syncSplitterValues();
  }

  private syncSplitterValues(): void {
    for (const id of SPLIT_GROUP_IDS) {
      const sizes = this.measure(id);
      this.splitters[id].forEach((splitter, index) => {
        if (sizes.length === 0) {
          splitter.removeAttribute('aria-valuenow');
          return;
        }
        const percent = splitPercent(sizes[index] ?? 0, sizes[index + 1] ?? 0);
        splitter.setAttribute('aria-valuenow', String(percent));
      });
    }
  }

  private persist(): void {
    const storage = store();
    if (storage === null) return;
    try {
      if (isDefaultLayout(this.state)) storage.removeItem(LAYOUT_STORAGE_KEY);
      else storage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(this.state));
    } catch {
      /* storage full or blocked — the layout still applies for this session */
    }
  }
}
