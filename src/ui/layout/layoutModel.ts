/**
 * Resizable-shell layout model (ARCHITECTURE.md §5.7).
 *
 * The shell's three columns (tools | editor+messages | 3D+watch) and the two splits inside
 * the centre and the right column are user-resizable. This module owns the arithmetic and
 * the persistence FORMAT; it touches neither the DOM nor localStorage, so every rule below
 * is unit-testable in the node environment (§9) — see tests/ui/layout.test.ts.
 *
 * Sizes are stored as WEIGHTS, not pixels. A weight vector becomes a grid track list
 * `minmax(<floor>px, <weight>fr)`, so a resized layout keeps its PROPORTIONS when the window
 * changes and can never out-vote the `minmax()` floors that the D2 fix relies on
 * (docs/REVIEW_SCENE.md: the 3D viewport keeps ≥ 360 px in the stacked layout). A finished
 * drag simply writes the measured pixel sizes back as the new weights — the ratio carries the
 * meaning, the unit is irrelevant.
 */

/** The three resizable splits of the shell. */
export type SplitGroupId = 'columns' | 'centreRows' | 'rightRows';

/**
 * Track weights per group. Track order is DOM order:
 *   columns    → [tools, centre (editor+messages), right (3D+watch)]
 *   centreRows → [AWL editor, messages]
 *   rightRows  → [3D viewport, watch table]
 */
export interface LayoutState {
  readonly columns: readonly number[];
  readonly centreRows: readonly number[];
  readonly rightRows: readonly number[];
}

export interface SplitGroupSpec {
  readonly id: SplitGroupId;
  /** Resizable tracks in the group; the number of splitters is `trackCount - 1`. */
  readonly trackCount: number;
  /** Drag axis. 'x' → the separator LINE is vertical (aria-orientation="vertical"). */
  readonly axis: 'x' | 'y';
  /** Drag floors in CSS px: a drag may never push a track below its floor. */
  readonly minPx: readonly number[];
  readonly defaultWeights: readonly number[];
}

/** Width of a splitter track. It replaces the 10 px grid gap it sits in, so the shell keeps
 *  exactly the metrics the D2 fix measured (stacked right column: 360 + 10 + 140 = 510). */
export const SPLITTER_PX = 10;

/** Arrow-key resize step, and the coarse step used while Shift is held. */
export const KEYBOARD_STEP_PX = 16;
export const KEYBOARD_COARSE_STEP_PX = 64;

/** Persisted under the same `mat2sps.*` convention as "mat2sps.locale" (§5.6). */
export const LAYOUT_STORAGE_KEY = 'mat2sps.layout.v1';

export const SPLIT_GROUPS: Record<SplitGroupId, SplitGroupSpec> = {
  columns: {
    id: 'columns',
    trackCount: 3,
    axis: 'x',
    minPx: [260, 320, 360],
    defaultWeights: [3, 4, 6],
  },
  centreRows: {
    id: 'centreRows',
    trackCount: 2,
    axis: 'y',
    minPx: [180, 120],
    defaultWeights: [3, 1],
  },
  rightRows: {
    id: 'rightRows',
    trackCount: 2,
    axis: 'y',
    // 360 = the D2 minimum of the 3D viewport (docs/REVIEW_SCENE.md); dragging must not
    // undercut what the media queries protect.
    minPx: [360, 140],
    defaultWeights: [3, 2],
  },
};

export const SPLIT_GROUP_IDS: readonly SplitGroupId[] = ['columns', 'centreRows', 'rightRows'];

export const DEFAULT_LAYOUT: LayoutState = {
  columns: SPLIT_GROUPS.columns.defaultWeights,
  centreRows: SPLIT_GROUPS.centreRows.defaultWeights,
  rightRows: SPLIT_GROUPS.rightRows.defaultWeights,
};

/**
 * CSS `minmax()` floors — what the GRID enforces when the WINDOW shrinks. Deliberately not
 * the same numbers as the drag floors above:
 *
 *  - the viewport's floor in the wide layout stays 0, as before this feature: a 360 px floor
 *    would make `.app-main` overflow the window height on a short display, which is exactly
 *    the failure mode the wide layout never had;
 *  - the STACKED variant keeps 360 px, the value D2 was fixed to (docs/REVIEW_SCENE.md).
 *
 * A drag can therefore never lower a floor — it only redistributes the `fr` share.
 */
const CSS_FLOORS: Record<'columns' | 'centreRows' | 'rightRows' | 'rightRowsStacked',
                         readonly number[]> = {
  columns: [260, 320, 360],
  centreRows: [0, 120],
  rightRows: [0, 140],
  rightRowsStacked: [360, 140],
};

const EPSILON = 0.01;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

/** A usable weight: finite and > 0. Everything else is a corrupt entry and becomes 1. */
function sane(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function total(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

// ── track list emission ──────────────────────────────────────────────────────

/** `minmax(f0px, w0fr) 10px minmax(f1px, w1fr) …` — the splitter track sits in the gap. */
function trackList(floors: readonly number[], weights: readonly number[]): string {
  const tracks = weights.map((weight, i) => `minmax(${at(floors, i)}px, ${round(sane(weight), 3)}fr)`);
  return tracks.join(` ${SPLITTER_PX}px `);
}

/**
 * The custom properties `styles.css` reads. Four, not three: the right column's row list
 * exists twice because its viewport floor differs between the wide and the stacked layout
 * (see CSS_FLOORS). The stacked variant is consumed inside the media queries, so a narrow
 * window still gets the user's proportions AND the 360 px D2 floor.
 */
export function layoutCssVars(state: LayoutState): Record<string, string> {
  return {
    '--layout-cols': trackList(CSS_FLOORS.columns, state.columns),
    '--layout-rows-centre': trackList(CSS_FLOORS.centreRows, state.centreRows),
    '--layout-rows-right': trackList(CSS_FLOORS.rightRows, state.rightRows),
    '--layout-rows-right-stacked': trackList(CSS_FLOORS.rightRowsStacked, state.rightRows),
  };
}

// ── resizing ─────────────────────────────────────────────────────────────────

export function weightsOf(state: LayoutState, group: SplitGroupId): readonly number[] {
  return state[group];
}

export function withGroup(
  state: LayoutState,
  group: SplitGroupId,
  weights: readonly number[],
): LayoutState {
  return { ...state, [group]: [...weights] };
}

/**
 * Move the boundary between track `index` and `index + 1` by `deltaPx`. Returns the new
 * pixel sizes — which the caller stores verbatim as the group's new weights.
 *
 * Only the two adjacent tracks change; every other track keeps its measured size, which is
 * what a splitter is expected to do. The clamp floor is `min(dragFloor, currentSize)`: a
 * track that the window (not the user) already squeezed below its floor must not be SNAPPED
 * back up by an unrelated drag — it simply cannot be shrunk any further.
 */
export function resizeSplit(
  sizesPx: readonly number[],
  minPx: readonly number[],
  index: number,
  deltaPx: number,
): number[] {
  const next = sizesPx.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  if (index < 0 || index + 1 >= next.length) return next;
  const first = at(next, index);
  const second = at(next, index + 1);
  const room = first + second;
  if (room <= 0 || !Number.isFinite(deltaPx)) return next;
  const floorFirst = Math.min(Math.max(at(minPx, index), 0), first);
  const floorSecond = Math.min(Math.max(at(minPx, index + 1), 0), second);
  const wanted = first + deltaPx;
  const clamped = Math.min(Math.max(wanted, floorFirst), room - floorSecond);
  next[index] = round(clamped, 2);
  next[index + 1] = round(room - clamped, 2);
  return next;
}

/** Proportional split of `availablePx` over `weights` (no floors applied). */
export function distributeWeights(
  weights: readonly number[],
  availablePx: number,
): number[] {
  const clean = weights.map(sane);
  const sum = total(clean);
  if (!(availablePx > 0) || sum <= 0) return clean.map(() => 0);
  return clean.map((weight) => round((availablePx * weight) / sum, 2));
}

/**
 * Repair a set of weights so that, at `availablePx`, every track still clears its drag floor.
 *
 * This is the RESTORE path: a layout persisted on a 4K display must not be applied blindly on
 * a laptop, where "the 3D view had 8 % of the width" means an unusable viewport. Tracks that
 * would fall below their floor are pinned AT the floor and the remainder is redistributed
 * proportionally over the rest, repeatedly until nothing violates its floor.
 *
 * If the floors do not fit into `availablePx` at all, the weights are returned unchanged: no
 * distribution could satisfy the constraint, and the CSS `minmax()` floors then decide.
 */
export function repairWeights(
  weights: readonly number[],
  minPx: readonly number[],
  availablePx: number,
): number[] {
  const clean = weights.map(sane);
  if (!(availablePx > 0)) return clean;
  const floors = clean.map((_, i) => Math.max(at(minPx, i), 0));
  if (total(floors) > availablePx) return clean;

  const pinned = clean.map(() => false);
  for (let pass = 0; pass < clean.length; pass += 1) {
    let freePx = availablePx;
    let freeWeight = 0;
    for (let i = 0; i < clean.length; i += 1) {
      if (pinned[i] === true) freePx -= at(floors, i);
      else freeWeight += at(clean, i);
    }
    let violated = -1;
    for (let i = 0; i < clean.length; i += 1) {
      if (pinned[i] === true) continue;
      const size = freeWeight > 0 ? (freePx * at(clean, i)) / freeWeight : 0;
      if (size < at(floors, i) - EPSILON) {
        violated = i;
        break;
      }
    }
    if (violated < 0) break;
    pinned[violated] = true;
  }
  if (!pinned.includes(true)) return clean;

  let freePx = availablePx;
  let freeWeight = 0;
  for (let i = 0; i < clean.length; i += 1) {
    if (pinned[i] === true) freePx -= at(floors, i);
    else freeWeight += at(clean, i);
  }
  return clean.map((weight, i) => {
    if (pinned[i] === true) return round(at(floors, i), 2);
    if (freeWeight <= 0) return round(weight, 2);
    return round((freePx * weight) / freeWeight, 2);
  });
}

/** Repair every group of a restored layout against the measured track totals.
 *  A group whose total is unknown (0 — not laid out, or its splitter is hidden) is left
 *  alone: there is nothing to measure against, and guessing would corrupt a good layout. */
export function repairLayout(
  state: LayoutState,
  availablePx: Partial<Record<SplitGroupId, number>>,
): LayoutState {
  let repaired = state;
  for (const id of SPLIT_GROUP_IDS) {
    const available = availablePx[id];
    if (available === undefined || !(available > 0)) continue;
    repaired = withGroup(repaired, id,
                         repairWeights(weightsOf(repaired, id), SPLIT_GROUPS[id].minPx, available));
  }
  return repaired;
}

/** `aria-valuenow` of a splitter: the first neighbour's share of the pair, in percent. */
export function splitPercent(firstPx: number, secondPx: number): number {
  const room = firstPx + secondPx;
  if (!(room > 0) || !Number.isFinite(room)) return 50;
  return Math.round((Math.max(firstPx, 0) / room) * 100);
}

// ── persistence format ───────────────────────────────────────────────────────

interface StoredLayout {
  v: 1;
  columns: number[];
  centreRows: number[];
  rightRows: number[];
}

export function serializeLayout(state: LayoutState): string {
  const stored: StoredLayout = {
    v: 1,
    columns: state.columns.map((w) => round(sane(w), 2)),
    centreRows: state.centreRows.map((w) => round(sane(w), 2)),
    rightRows: state.rightRows.map((w) => round(sane(w), 2)),
  };
  return JSON.stringify(stored);
}

function readWeights(raw: unknown, spec: SplitGroupSpec): readonly number[] | null {
  if (!Array.isArray(raw) || raw.length !== spec.trackCount) return null;
  const weights: number[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) return null;
    weights.push(entry);
  }
  return weights;
}

/**
 * Total inverse of `serializeLayout`: ANY unusable input (null, non-JSON, wrong version,
 * wrong arity, zero/negative/NaN weight) yields the default layout. A partially valid record
 * keeps the groups that parsed and defaults the rest — losing a stale column split must not
 * cost the student their editor/messages split.
 */
export function parseLayout(raw: string | null | undefined): LayoutState {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_LAYOUT;
  }
  const record = parsed as Record<string, unknown>;
  if (record['v'] !== 1) return DEFAULT_LAYOUT;
  return {
    columns: readWeights(record['columns'], SPLIT_GROUPS.columns) ?? DEFAULT_LAYOUT.columns,
    centreRows:
      readWeights(record['centreRows'], SPLIT_GROUPS.centreRows) ?? DEFAULT_LAYOUT.centreRows,
    rightRows:
      readWeights(record['rightRows'], SPLIT_GROUPS.rightRows) ?? DEFAULT_LAYOUT.rightRows,
  };
}

/** True when `state` is the default layout (used to drop a redundant persisted record). */
export function isDefaultLayout(state: LayoutState): boolean {
  return SPLIT_GROUP_IDS.every((id) => {
    const weights = weightsOf(state, id);
    const defaults = SPLIT_GROUPS[id].defaultWeights;
    if (weights.length !== defaults.length) return false;
    // Ratios are the meaning: [6, 8, 12] IS the default [3, 4, 6].
    const scale = total(defaults) / (total(weights) || 1);
    return weights.every((weight, i) => Math.abs(weight * scale - at(defaults, i)) < EPSILON);
  });
}
