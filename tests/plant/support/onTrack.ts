/**
 * The "train is always on the track" invariant (ARCHITECTURE.md §5.3 train motion rules),
 * as a reusable checker so plant- and app-level scenarios can assert it after EVERY step.
 *
 * Why this exists: a user report showed the consist rendered off the baseboard during the
 * Gruppe A reverse leg. The plant state turned out to be sound, but nothing in the suite
 * PINNED that — the §5.3 wording ("offsetMm: 0..edge length") was documentation only. The
 * three properties below are the contract the scene, the watch table and the oracle all
 * read, so they are asserted mechanically now:
 *
 *   1. `edgeId` is an edge of the graph and `0 ≤ offsetMm ≤ edgeLengthMm(edgeId)`
 *      — never beyond an edge end, i.e. no extrapolation past a buffer or a node.
 *   2. `worldPos` lies inside the track's own bounding rectangle. The baseboard is that
 *      rectangle plus a bare margin (scene/landscape `BOARD_MARGIN_PT`), so containment in
 *      the track box implies the position is on the plate — a strictly stronger statement,
 *      and one plant tests can make without importing scene/.
 *   3. Motion is continuous: one step displaces the train by at most the distance the
 *      integrator can produce in that step. A teleporting position is still "on an edge",
 *      yet it is exactly what breaks a renderer that interpolates between snapshots — so
 *      the invariant covers it.
 */
import { expect } from 'vitest';
import { TrackGraph } from '../../../src/plant';
import type { PlantSnapshot, TrackplanFile, Vec2 } from '../../../src/plant';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding rectangle of every node and edge vertex of the plan, in plan units. */
export function trackBounds(plan: TrackplanFile): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const n of plan.nodes) consider(n.pt);
  for (const e of plan.edges) for (const p of e.pts) consider(p);
  return { minX, minY, maxX, maxY };
}

/** Tolerance for the plan-unit box test: interpolation rounding only, never a real overrun. */
const BOX_EPS_UNITS = 1e-6;

/**
 * Every way `snapshot` violates the invariant, as human-readable strings (empty = valid).
 * `previous` enables the continuity check; pass `null` for the first snapshot of a run.
 */
export function onTrackViolations(
  graph: TrackGraph,
  plan: TrackplanFile,
  box: Rect,
  snapshot: PlantSnapshot,
  previous: PlantSnapshot | null,
): string[] {
  const out: string[] = [];
  const t = snapshot.train;

  // 1. the edge exists and the offset is a point ON it
  let lengthMm: number | null = null;
  try {
    lengthMm = graph.edgeLengthMm(t.edgeId);
  } catch {
    out.push(`unknown edge "${t.edgeId}"`);
  }
  if (!Number.isFinite(t.offsetMm)) {
    out.push(`offset is not finite (${t.offsetMm})`);
  } else if (lengthMm !== null) {
    if (t.offsetMm < 0) out.push(`offset ${t.offsetMm} < 0 — before the edge start`);
    if (t.offsetMm > lengthMm) {
      out.push(`offset ${t.offsetMm} > edge length ${lengthMm} — beyond the edge end`);
    }
  }

  // 2. the plan position is inside the track box (⊂ baseboard)
  const p = t.worldPos;
  if (
    !(p.x >= box.minX - BOX_EPS_UNITS && p.x <= box.maxX + BOX_EPS_UNITS
      && p.y >= box.minY - BOX_EPS_UNITS && p.y <= box.maxY + BOX_EPS_UNITS)
  ) {
    out.push(
      `plan position (${p.x}, ${p.y}) outside the track box `
        + `(${box.minX}..${box.maxX}, ${box.minY}..${box.maxY})`,
    );
  }

  // 3. continuity: at most one integrator step of travel since the previous snapshot
  if (previous !== null) {
    const dtS = (snapshot.timeMs - previous.timeMs) / 1000;
    if (dtS > 0) {
      const moved = Math.hypot(p.x - previous.train.worldPos.x, p.y - previous.train.worldPos.y)
        * plan.meta.mmPerUnit;
      // semi-implicit Euler advances with the POST-update speed, so the bound is the larger
      // of the two speeds plus one acceleration increment; +1e-6 absorbs float noise.
      const vMax = Math.max(previous.train.speedMmS, t.speedMmS) + plan.meta.trainAccelMmS2 * dtS;
      const limit = vMax * dtS + 1e-6;
      if (moved > limit) {
        out.push(
          `position jumped ${moved.toFixed(3)} mm in ${dtS * 1000} ms `
            + `(at most ${limit.toFixed(3)} mm is reachable) — discontinuous motion`,
        );
      }
    }
  }
  return out;
}

/**
 * Per-step checker for one plan: ONE assertion per snapshot, so a 20 000-step scenario stays
 * fast while still failing at the exact step. `where` is echoed into the failure message.
 */
export function onTrackChecker(plan: TrackplanFile): {
  graph: TrackGraph;
  box: Rect;
  check: (snapshot: PlantSnapshot, where: string) => void;
} {
  const graph = new TrackGraph(plan);
  const box = trackBounds(plan);
  let previous: PlantSnapshot | null = null;
  return {
    graph,
    box,
    check: (snapshot, where): void => {
      const bad = onTrackViolations(graph, plan, box, snapshot, previous);
      if (bad.length > 0) {
        const t = snapshot.train;
        expect(
          bad,
          `${where} @t=${snapshot.timeMs} ms [edge=${t.edgeId} off=${t.offsetMm} `
            + `dir=${t.direction} cmd=${t.command} v=${t.speedMmS}]`,
        ).toEqual([]);
      }
      previous = snapshot;
    },
  };
}
