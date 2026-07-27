/**
 * Resizable-shell layout model (ARCHITECTURE.md §5.7).
 *
 * Runs in the node environment (vitest default, §9): everything asserted here is pure
 * arithmetic and string building — no DOM, no localStorage. The DOM half
 * (ui/layout/LayoutController.ts: pointer capture, focus, aria-valuenow) is verified in the
 * running app instead, because jsdom is deliberately not a dependency of this repo.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  SPLITTER_PX,
  SPLIT_GROUPS,
  distributeWeights,
  isDefaultLayout,
  layoutCssVars,
  parseLayout,
  repairLayout,
  repairWeights,
  resizeSplit,
  serializeLayout,
  splitPercent,
  withGroup,
} from '../../src/ui/layout/layoutModel';
import type { LayoutState } from '../../src/ui/layout/layoutModel';

const COLUMNS = SPLIT_GROUPS.columns.minPx;
const RIGHT_ROWS = SPLIT_GROUPS.rightRows.minPx;

describe('group specs', () => {
  it('keeps the D2 viewport minimum as the drag floor of the 3D/watch split', () => {
    // docs/REVIEW_SCENE.md D2: the 3D viewport must stay ≥ 360 px. A drag may not undercut
    // what the media queries protect, so the drag floor is the same number.
    expect(SPLIT_GROUPS.rightRows.minPx[0]).toBe(360);
  });

  it('has one splitter less than it has tracks, per group', () => {
    expect(SPLIT_GROUPS.columns.trackCount).toBe(3);
    expect(SPLIT_GROUPS.centreRows.trackCount).toBe(2);
    expect(SPLIT_GROUPS.rightRows.trackCount).toBe(2);
  });

  it('defaults reproduce the shipped 3 : 4 : 6 / 3 : 1 / 3 : 2 proportions', () => {
    expect(DEFAULT_LAYOUT.columns).toEqual([3, 4, 6]);
    expect(DEFAULT_LAYOUT.centreRows).toEqual([3, 1]);
    expect(DEFAULT_LAYOUT.rightRows).toEqual([3, 2]);
  });
});

describe('resizeSplit', () => {
  it('moves the boundary and conserves the pair total', () => {
    const next = resizeSplit([600, 400], RIGHT_ROWS, 0, -80);
    expect(next).toEqual([520, 480]);
    expect(next[0]! + next[1]!).toBe(1000);
  });

  it('clamps the first track at its minimum', () => {
    const next = resizeSplit([600, 400], RIGHT_ROWS, 0, -1000);
    expect(next).toEqual([360, 640]);          // viewport stops at its 360 px floor
  });

  it('clamps the second track at its minimum', () => {
    const next = resizeSplit([600, 400], RIGHT_ROWS, 0, +1000);
    expect(next).toEqual([860, 140]);          // watch table stops at its 140 px floor
  });

  it('leaves the non-adjacent tracks untouched (a splitter is local)', () => {
    const next = resizeSplit([400, 500, 700], COLUMNS, 1, 120);
    expect(next).toEqual([400, 620, 580]);
  });

  it('resizes the second boundary of the three-column group', () => {
    const next = resizeSplit([400, 500, 700], COLUMNS, 1, -1000);
    expect(next).toEqual([400, 320, 880]);     // centre column stops at 320 px
  });

  it('never snaps an already-undersized track up (the window squeezed it, not the user)', () => {
    // Viewport is 200 px — below its 360 px floor — because the window is short. A drag must
    // refuse to shrink it further, but must not jump it to 360 either.
    expect(resizeSplit([200, 300], RIGHT_ROWS, 0, -50)).toEqual([200, 300]);
    expect(resizeSplit([200, 300], RIGHT_ROWS, 0, +50)).toEqual([250, 250]);
  });

  it('is a no-op for an out-of-range index, an empty pair or a NaN delta', () => {
    expect(resizeSplit([600, 400], RIGHT_ROWS, 1, 50)).toEqual([600, 400]);
    expect(resizeSplit([600, 400], RIGHT_ROWS, -1, 50)).toEqual([600, 400]);
    expect(resizeSplit([0, 0], RIGHT_ROWS, 0, 50)).toEqual([0, 0]);
    expect(resizeSplit([600, 400], RIGHT_ROWS, 0, Number.NaN)).toEqual([600, 400]);
  });

  it('treats a corrupt measurement as zero instead of producing NaN sizes', () => {
    const next = resizeSplit([Number.NaN, 400], RIGHT_ROWS, 0, 50);
    expect(next.every((size) => Number.isFinite(size))).toBe(true);
  });
});

describe('distributeWeights', () => {
  it('splits the available space in the weight ratio', () => {
    expect(distributeWeights([3, 2], 1000)).toEqual([600, 400]);
    expect(distributeWeights([3, 4, 6], 1300)).toEqual([300, 400, 600]);
  });

  it('is total for degenerate input', () => {
    expect(distributeWeights([3, 2], 0)).toEqual([0, 0]);
    expect(distributeWeights([3, 2], -100)).toEqual([0, 0]);
  });
});

describe('repairWeights (restore path)', () => {
  it('leaves a layout that clears every floor untouched', () => {
    expect(repairWeights([3, 2], RIGHT_ROWS, 1000)).toEqual([3, 2]);
  });

  it('repairs a stored split that would crush the 3D viewport', () => {
    // Persisted on a tall display: viewport 8 % of the column. On a 900 px column that is
    // 72 px — the D2 failure mode. Repair pins the viewport at 360 and hands the rest over.
    const repaired = repairWeights([0.08, 0.92], RIGHT_ROWS, 900);
    expect(repaired).toEqual([360, 540]);
    expect(repaired[0]!).toBeGreaterThanOrEqual(360);
  });

  it('repairs the watch table side too', () => {
    expect(repairWeights([50, 1], RIGHT_ROWS, 900)).toEqual([760, 140]);
  });

  it('repairs several violated tracks in one pass and keeps the total', () => {
    const repaired = repairWeights([1, 1, 20], COLUMNS, 1300);
    expect(repaired[0]!).toBeGreaterThanOrEqual(260);
    expect(repaired[1]!).toBeGreaterThanOrEqual(320);
    expect(repaired.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1300, 1);
  });

  it('gives up (unchanged weights) when the floors do not fit at all', () => {
    // 360 + 140 = 500 > 400: no weight vector can satisfy this, so the CSS minmax() floors
    // decide and the stored proportions are kept for the next, larger window.
    expect(repairWeights([3, 2], RIGHT_ROWS, 400)).toEqual([3, 2]);
  });

  it('is total for an unmeasurable container and for corrupt weights', () => {
    expect(repairWeights([3, 2], RIGHT_ROWS, 0)).toEqual([3, 2]);
    // A corrupt weight becomes 1 — an even split, which clears both floors at 1000 px.
    expect(repairWeights([Number.NaN, -4], RIGHT_ROWS, 1000)).toEqual([1, 1]);
  });

  it('repairLayout only touches the groups it was given a measurement for', () => {
    const stored: LayoutState = { columns: [1, 1, 20], centreRows: [3, 1], rightRows: [0.08, 0.92] };
    const repaired = repairLayout(stored, { rightRows: 900 });
    expect(repaired.rightRows).toEqual([360, 540]);
    expect(repaired.columns).toEqual([1, 1, 20]);       // no width measured → left alone
    expect(repaired.centreRows).toEqual([3, 1]);
  });
});

describe('layoutCssVars', () => {
  it('emits one splitter track between the panel tracks', () => {
    expect(layoutCssVars(DEFAULT_LAYOUT)['--layout-rows-centre'])
      .toBe(`minmax(0px, 3fr) ${SPLITTER_PX}px minmax(120px, 1fr)`);
    expect(layoutCssVars(DEFAULT_LAYOUT)['--layout-cols'])
      .toBe('minmax(260px, 3fr) 10px minmax(320px, 4fr) 10px minmax(360px, 6fr)');
  });

  it('keeps the D2 360 px viewport floor in the stacked row list', () => {
    // The wide layout keeps a 0 floor (a 360 px floor would overflow a short window); the
    // stacked variant is the one the media queries read, and it must carry 360px.
    const vars = layoutCssVars({ ...DEFAULT_LAYOUT, rightRows: [800, 120] });
    expect(vars['--layout-rows-right'])
      .toBe('minmax(0px, 800fr) 10px minmax(140px, 120fr)');
    expect(vars['--layout-rows-right-stacked'])
      .toBe('minmax(360px, 800fr) 10px minmax(140px, 120fr)');
  });

  it('rounds the fr values and substitutes a corrupt weight', () => {
    const vars = layoutCssVars({ ...DEFAULT_LAYOUT, centreRows: [512.34567, Number.NaN] });
    expect(vars['--layout-rows-centre']).toBe('minmax(0px, 512.346fr) 10px minmax(120px, 1fr)');
  });
});

describe('persistence', () => {
  it('uses the mat2sps.* key convention of §5.6', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('mat2sps.layout.v1');
  });

  it('round-trips a resized layout', () => {
    const state = withGroup(DEFAULT_LAYOUT, 'rightRows', [612.5, 287.5]);
    expect(parseLayout(serializeLayout(state))).toEqual(state);
  });

  it('writes the version tag', () => {
    expect(JSON.parse(serializeLayout(DEFAULT_LAYOUT))).toEqual({
      v: 1, columns: [3, 4, 6], centreRows: [3, 1], rightRows: [3, 2],
    });
  });

  it('falls back to the default for anything unusable', () => {
    for (const raw of [
      null, undefined, '', 'not json', '[]', '"x"', '42',
      '{}',                                        // no version
      '{"v":2,"columns":[3,4,6],"centreRows":[3,1],"rightRows":[3,2]}',
    ]) {
      expect(parseLayout(raw), String(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it('defaults only the groups that are corrupt, keeping the valid ones', () => {
    const raw = '{"v":1,"columns":[3,4],"centreRows":[5,1],"rightRows":[0,2]}';
    const parsed = parseLayout(raw);
    expect(parsed.columns).toEqual(DEFAULT_LAYOUT.columns);      // wrong arity
    expect(parsed.centreRows).toEqual([5, 1]);                   // valid → kept
    expect(parsed.rightRows).toEqual(DEFAULT_LAYOUT.rightRows);  // zero weight
  });

  it('rejects non-finite, negative and non-numeric weights', () => {
    for (const group of ['[null,2]', '["3",2]', '[-1,2]', '[1e999,2]']) {
      const parsed = parseLayout(`{"v":1,"columns":[3,4,6],"centreRows":${group},"rightRows":[3,2]}`);
      expect(parsed.centreRows, group).toEqual(DEFAULT_LAYOUT.centreRows);
    }
  });
});

describe('reset / default detection', () => {
  it('recognises the default layout, and any scalar multiple of it', () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isDefaultLayout({ columns: [6, 8, 12], centreRows: [30, 10], rightRows: [300, 200] }))
      .toBe(true);
  });

  it('recognises a resized layout', () => {
    expect(isDefaultLayout(withGroup(DEFAULT_LAYOUT, 'rightRows', [4, 1]))).toBe(false);
  });

  it('resetting one group restores exactly that group', () => {
    const dragged: LayoutState = { columns: [400, 500, 700], centreRows: [8, 1], rightRows: [9, 1] };
    const reset = withGroup(dragged, 'rightRows', SPLIT_GROUPS.rightRows.defaultWeights);
    expect(reset.rightRows).toEqual([3, 2]);
    expect(reset.columns).toEqual([400, 500, 700]);
    expect(isDefaultLayout(reset)).toBe(false);
  });
});

describe('splitPercent (aria-valuenow)', () => {
  it('reports the share of the first neighbour', () => {
    expect(splitPercent(600, 400)).toBe(60);
    expect(splitPercent(360, 640)).toBe(36);
  });

  it('is total for a collapsed or unmeasurable pair', () => {
    expect(splitPercent(0, 0)).toBe(50);
    expect(splitPercent(Number.NaN, 100)).toBe(50);
  });
});
