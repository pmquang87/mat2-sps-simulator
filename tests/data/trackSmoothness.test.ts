/**
 * tests/data/trackSmoothness.test.ts — the D9 contract on `trackplan.json`'s `edges[].pts`
 * (REVIEW_SCENE.md D9, tools/smooth-trackplan.ts).
 *
 * The user compared the top-down render against page 1 of "Gleisplan SPS.pdf" and circled the
 * same three areas in both: the west corner where Gleise A/B round the top left, the mid-left
 * curve group, and where the Gleis-K reversing loop meets the outer curves. The plan draws
 * smooth sweeping curves there; the render drew a chain of straight chords with visible
 * corners. The fix was a pure data transform, so this is where it is pinned.
 *
 * What is asserted:
 *  - TANGENT CONTINUITY, both *within* an edge and *across* plain-node joins, with the three
 *    circled areas named explicitly. The only joins allowed to exceed the threshold are the
 *    nine corners the Gleisplan itself draws — each one is a junction of two DIFFERENT plan
 *    straight primitives (diagonal ladder track meeting a platform road), verified here by
 *    re-measuring against `tools/gleisplan-paths.json` rather than by assertion.
 *  - CURVATURE: no micro-hook. An interpolating spline through samples that contradict the
 *    plan is G1 on paper and a 3-mm-radius spike on screen; the radius floor catches that.
 *  - PLAN FIDELITY, in both directions, per edge and per plan primitive. This is what stops the
 *    acknowledged west-corner residual (`n35`/`n37` sit off the plan's tangent points — an owner
 *    decision, REVIEW_SCENE D9 "Offener Restbefund") from silently growing: every bound below is
 *    the MEASURED value, so fidelity can only improve, never regress.
 *  - NOTHING THAT CARRIES SEMANTICS MOVED: every node coordinate, every reed plan position
 *    (edge + offsetMm) and every switch node is pinned literally. Those anchor the topology,
 *    the switch geometry, the reed trigger positions and the oracle's event timings. Per-switch
 *    branch DIVERGENCE is pinned too — nothing else in the suite would notice a turnout whose
 *    two branches collapse onto each other and stop being readable in the 3D view.
 *  - The committed `pts` are the smoothing tool's FIXED POINT, i.e. re-running the tool is a
 *    byte-identical no-op.
 */
import { describe, expect, it } from 'vitest';
import type { TrackplanFile, Vec2 } from '../../src/plant';
import {
  MIN_SEG_PT,
  PLAN_TANGENT_MAX_CORR_DEG,
  PLAN_TANGENT_MAX_DIST_PT,
  distToPolyline,
  planDirectionAt,
  planKnotTangent,
  preparePlan,
  smoothTrackplan,
  type PlanPathFile,
} from '../../tools/smooth-trackplan';
import trackplanJson from '../../src/data/trackplan.json';
import planPathsJson from '../../tools/gleisplan-paths.json';

const plan = trackplanJson as unknown as TrackplanFile;
const planPaths = planPathsJson as unknown as PlanPathFile;
const primitives = preparePlan(planPaths);
const MM_PER_UNIT = plan.meta.mmPerUnit;

/** Heading step allowed between two consecutive polyline segments (measured max: 2.27°). */
const MAX_STEP_DEG = 3;
/**
 * Curvature floor, mm. Measured minimum: 90.9 mm on `e39` (a Hermite overshoot just past the
 * clamp at `n1`, whose vertex is 3.6 mm off the plan). Kept 6 mm under the measurement rather
 * than the 25 mm of slack the first cut had, so a regression toward a corner is caught early.
 * For scale: the tightest curve the Gleisplan itself draws is 197.4 mm (plan primitive #9).
 */
const MIN_RADIUS_MM = 85;

const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
const incident = new Map<string, string[]>(plan.nodes.map((n) => [n.id, []]));
for (const e of plan.edges) {
  incident.get(e.from)?.push(e.id);
  incident.get(e.to)?.push(e.id);
}

function heading(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function stepDeg(a: Vec2, b: Vec2, c: Vec2): number {
  let d = heading(b, c) - heading(a, b);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs((d * 180) / Math.PI);
}

/** Largest heading step inside one edge. */
function maxStepInEdge(edgeId: string): number {
  const p = edgeById.get(edgeId)?.pts ?? [];
  let worst = 0;
  for (let i = 2; i < p.length; i += 1) {
    worst = Math.max(worst, stepDeg(p[i - 2] as Vec2, p[i - 1] as Vec2, p[i] as Vec2));
  }
  return worst;
}

/** Circumscribed-circle radius of every vertex triple of an edge, in mm. */
function minRadiusMm(edgeId: string): number {
  const p = edgeById.get(edgeId)?.pts ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 2; i < p.length; i += 1) {
    const a = p[i - 2] as Vec2;
    const b = p[i - 1] as Vec2;
    const c = p[i] as Vec2;
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 < 1e-12) continue;
    const l = (u: Vec2, w: Vec2): number => Math.hypot(u.x - w.x, u.y - w.y);
    const r = ((l(b, a) * l(c, b) * l(c, a)) / (2 * area2)) * MM_PER_UNIT;
    if (r < best) best = r;
  }
  return best;
}

/** Unit direction in which `edgeId` leaves `nodeId`. */
function leaveDir(edgeId: string, nodeId: string): Vec2 {
  const e = edgeById.get(edgeId) as { from: string; pts: Vec2[] };
  const p = e.pts;
  const [u, w] = e.from === nodeId
    ? [p[0] as Vec2, p[1] as Vec2]
    : [p[p.length - 1] as Vec2, p[p.length - 2] as Vec2];
  const len = Math.hypot(w.x - u.x, w.y - u.y);
  return { x: (w.x - u.x) / len, y: (w.y - u.y) / len };
}

/** Kink at a plain node: 0° = the two edges continue each other straight through. */
function jointDeg(nodeId: string): number {
  const [a, b] = incident.get(nodeId) as [string, string];
  const u = leaveDir(a, nodeId);
  const w = leaveDir(b, nodeId);
  return 180 - (Math.acos(Math.min(1, Math.max(-1, u.x * w.x + u.y * w.y))) * 180) / Math.PI;
}

/** Bounding boxes of the plan primitives, so the fidelity sweeps stay cheap. */
const planBoxes = primitives.map((prim) => {
  const xs = prim.dense.map((p) => p.x);
  const ys = prim.dense.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
});

function boxDist(p: Vec2, i: number): number {
  const b = planBoxes[i] as { x0: number; x1: number; y0: number; y1: number };
  return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
}

/** TRACK → PLAN: distance from `p` to the nearest point of the whole plan network, mm. */
function distToPlanMm(p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < primitives.length; i += 1) {
    if (boxDist(p, i) >= best) continue;
    const d = distToPolyline(p, (primitives[i] as { dense: readonly Vec2[] }).dense);
    if (d < best) best = d;
  }
  return best * MM_PER_UNIT;
}

/** TRACK → PLAN, per edge: the worst vertex. */
function edgePlanDistMm(edgeId: string): number {
  const pts = (edgeById.get(edgeId) as { pts: Vec2[] }).pts;
  return Math.max(...pts.map((p) => distToPlanMm(p)));
}

/** PLAN → TRACK: mean distance of one plan primitive's samples to the nearest track, mm. */
function planPrimMeanDistMm(primIndex: number, step = 4): number {
  const dense = (primitives[primIndex] as { dense: readonly Vec2[] }).dense;
  const polys = plan.edges.map((e) => e.pts as Vec2[]);
  let acc = 0;
  let n = 0;
  for (let i = 0; i < dense.length; i += step) {
    let best = Number.POSITIVE_INFINITY;
    for (const poly of polys) best = Math.min(best, distToPolyline(dense[i] as Vec2, poly));
    acc += best * MM_PER_UNIT;
    n += 1;
  }
  return acc / n;
}

/**
 * The nine plain-node joins that are corners in the Gleisplan itself, with the measured angle.
 * Each is a diagonal (turnout ladder) meeting a horizontal platform road — geometry the plan
 * draws as two separate straight strokes, so rounding it away would be a falsification.
 */
const PLAN_CORNERS: ReadonlyArray<readonly [string, number]> = [
  ['n31', 19.02], ['n81', 18.56], ['n83', 18.45], ['n13', 18.30], ['n74', 18.28],
  ['n70', 14.43], ['n80', 9.55], ['n79', 9.47], ['n75', 7.36],
];

describe('trackplan edges are tangent-continuous (D9)', () => {
  it('no edge turns more than 3° between consecutive samples', () => {
    const offenders = plan.edges
      .map((e) => ({ id: e.id, deg: maxStepInEdge(e.id) }))
      .filter((r) => r.deg > MAX_STEP_DEG);
    expect(offenders).toEqual([]);
  });

  it('every plain-node join is smooth except the nine corners the Gleisplan draws', () => {
    const rough = plan.nodes
      .filter((n) => n.kind === 'plain')
      .map((n) => n.id)
      .filter((id) => jointDeg(id) > MAX_STEP_DEG)
      .sort();
    expect(rough).toEqual([...PLAN_CORNERS].map(([id]) => id).sort());
  });

  it('those nine corners really are drawn as two separate straights in the plan', () => {
    for (const [nodeId, deg] of PLAN_CORNERS) {
      expect(jointDeg(nodeId), `${nodeId} join`).toBeCloseTo(deg, 1);
      // each incident edge must hug ONE plan straight, and the two must be different strokes
      const chosen = (incident.get(nodeId) as string[]).map((edgeId) => {
        const pts = (edgeById.get(edgeId) as { pts: Vec2[] }).pts;
        let best = { d: Number.POSITIVE_INFINITY, i: -1 };
        primitives.forEach((prim, i) => {
          if (prim.kind !== 'line') return;
          const d = Math.max(...pts.map((p) => distToPolyline(p, prim.dense)));
          if (d < best.d) best = { d, i };
        });
        return best;
      });
      for (const c of chosen) expect(c.d, `${nodeId} edge on a plan straight`).toBeLessThan(2.5);
      expect(chosen[0]?.i, `${nodeId} straights differ`).not.toBe(chosen[1]?.i);
    }
  });

  it('keeps every curve above a model-railway radius (no micro-hooks)', () => {
    const tight = plan.edges
      .map((e) => ({ id: e.id, r: minRadiusMm(e.id) }))
      .filter((r) => r.r < MIN_RADIUS_MM);
    expect(tight).toEqual([]);
  });
});

describe('the three areas the user circled against Gleisplan page 1', () => {
  // west corner: Gleise A and B round the top-left corner onto the Bahnhof-2 straight
  const WEST_A = ['e16', 'e17', 'e26', 'e28', 'e96', 'e29'] as const;
  const WEST_B = ['e12', 'e18', 'e25', 'e27', 'e97', 'e30'] as const;
  const WEST_JOINS = ['n27', 'n28', 'n37', 'n39', 'n40', 'n21', 'n29', 'n35', 'n38', 'n41'] as const;
  // mid-left curve group: the C-vertical connector round to the Gleis-B side of the See
  const MID_LEFT = ['e44', 'e88', 'e87', 'e19'] as const;
  const MID_LEFT_JOINS = ['n50', 'n78', 'n30', 'n24'] as const;
  // Gleis-K reversing loop meeting the outer curves at the Bahnhof-1 west head
  const K_LOOP = ['e12', 'e14', 'e16', 'e46', 'e53', 'e54'] as const;
  const K_LOOP_JOINS = ['n21', 'n23', 'n22', 'n24', 'n26', 'n27', 'n54'] as const;

  for (const [label, edges, joins] of [
    ['west corner (Gleise A/B round the top left)', [...WEST_A, ...WEST_B], WEST_JOINS],
    ['mid-left curve group', MID_LEFT, MID_LEFT_JOINS],
    ['Gleis-K reversing loop meeting the outer curves', K_LOOP, K_LOOP_JOINS],
  ] as ReadonlyArray<readonly [string, readonly string[], readonly string[]]>) {
    it(`${label}: no chord facets and no corners`, () => {
      for (const id of edges) {
        expect(edgeById.has(id), `edge ${id} exists`).toBe(true);
        expect(maxStepInEdge(id), `${id} intra-edge step`).toBeLessThanOrEqual(MAX_STEP_DEG);
      }
      for (const id of joins) {
        expect(nodeById.get(id)?.kind, `${id} is a plain node`).toBe('plain');
        expect(jointDeg(id), `${id} join`).toBeLessThanOrEqual(MAX_STEP_DEG);
      }
    });
  }

  it('the 10-unit stubs e96/e97 stay straight on the plan verticals and are met tangentially', () => {
    // Evidence from the PDF: plan straights #69 (x = 196.68) and #70 (x = 210.72) run from
    // y = 128.31 to y = 99.96, and the arcs that reach them (plan curves #22/#21) end tangent
    // to them. So the 79.5°/74.6° corners our data had at n39/n38 were NOT real corners — the
    // stubs are faithful plan track, the arcs had overrun their tangent points.
    for (const [edgeId, x] of [['e96', 196.7], ['e97', 210.7]] as const) {
      const pts = (edgeById.get(edgeId) as { pts: Vec2[] }).pts;
      expect(pts.length, `${edgeId} is still a single straight segment`).toBe(2);
      for (const p of pts) expect(p.x, `${edgeId} stays on its plan vertical`).toBe(x);
      expect(Math.max(...pts.map((p) => distToPolyline(p, primitives[edgeId === 'e96' ? 69 : 70]?.dense ?? [])))
        * MM_PER_UNIT, `${edgeId} on the plan straight`).toBeLessThan(0.5);
    }
    expect(jointDeg('n39'), 'e28 meets the e96 stub tangentially').toBeLessThan(2);
    expect(jointDeg('n38'), 'e27 meets the e97 stub tangentially').toBeLessThan(2);
  });
});

describe('plan fidelity is pinned in both directions (D9)', () => {
  /**
   * TRACK → PLAN, per edge. Everything on the board hugs the Gleisplan to 11.5 mm except the four
   * west-corner edges, whose residual is the KNOWN consequence of `n35` (88/185) and `n37`
   * (75/175) sitting 70 / 119 mm off the plan's tangent points — moving those two nodes is an
   * owner decision outside D9 (REVIEW_SCENE D9 "Offener Restbefund"). Pinning the measured value
   * per edge means the residual can only shrink: a smoothing change that "looks smoother" while
   * drifting further from the plan now fails here. Bites hard against HEAD, where `e28` was
   * 221.8 mm, `e27` 186.4, `e81` 32.7, `e87` 20.5 and `e44` 16.3.
   */
  const WEST_RESIDUAL_MM: ReadonlyArray<readonly [string, number]> = [
    ['e28', 139], ['e26', 120], ['e27', 96], ['e25', 71],
  ];
  /** Every OTHER edge, mm. Measured worst: `e51` 11.47, then `e46` 5.66 and `e92` 5.49. */
  const PLAN_DIST_LIMIT_MM = 12;

  it('every edge except the four west-corner ones is within 12 mm of the Gleisplan', () => {
    const west = new Set(WEST_RESIDUAL_MM.map(([id]) => id));
    const offenders = plan.edges
      .filter((e) => !west.has(e.id))
      .map((e) => ({ id: e.id, mm: Number(edgePlanDistMm(e.id).toFixed(2)) }))
      .filter((r) => r.mm > PLAN_DIST_LIMIT_MM);
    expect(offenders).toEqual([]);
  });

  it('the four west-corner edges do not drift further from the plan than they already are', () => {
    for (const [id, limitMm] of WEST_RESIDUAL_MM) {
      expect(edgePlanDistMm(id), `${id} distance to the Gleisplan`).toBeLessThanOrEqual(limitMm);
    }
  });

  /**
   * PLAN → TRACK for the four west primitives — the direction a side-by-side comparison actually
   * looks at ("is there track where the plan draws track"), and the one the first cut of D9 never
   * measured. #19 is the one primitive the smoothing made *worse* in the mean (75.4 → 85.7 mm):
   * it is the inner arc whose inflection our `n35` misplaces, so it is pinned at its measured
   * value too rather than quietly ignored.
   */
  const PLAN_PRIM_MEAN_MM: ReadonlyArray<readonly [number, number]> = [
    [19, 86], [20, 58], [21, 101], [22, 73],
  ];

  it('the west plan arcs are covered at least as well as they are now', () => {
    for (const [i, limitMm] of PLAN_PRIM_MEAN_MM) {
      expect(planPrimMeanDistMm(i), `plan primitive #${i} mean distance to the network`)
        .toBeLessThanOrEqual(limitMm);
    }
  });
});

describe('the west corner takes its knot tangents from the plan, not from the chords', () => {
  /**
   * `n35`/`n37` are the interior knots of the two runs the tool rebuilds from node knots alone.
   * Averaging the surviving chords there is what put the tightest curve on the whole board into
   * `e28`'s tail (84.6 mm); taking the direction from the plan lifts it to 107.2 mm AND moves the
   * run closer to the plan. Measured plan directions: `n37` −22.54°, `n35` −18.28°.
   */
  const KNOTS: ReadonlyArray<readonly [string, number]> = [['n37', -22.54], ['n35', -18.28]];

  it('both incident edges leave the knot along the plan direction there', () => {
    for (const [nodeId, planDeg] of KNOTS) {
      const node = nodeById.get(nodeId)?.pt as Vec2;
      const near = planDirectionAt(node, primitives);
      expect(near, `${nodeId} has a nearest plan primitive`).not.toBeNull();
      const dirDeg = (Math.atan2(near!.dir.y, near!.dir.x) * 180) / Math.PI;
      expect(dirDeg, `${nodeId} plan direction`).toBeCloseTo(planDeg, 1);
      for (const edgeId of incident.get(nodeId) as string[]) {
        const u = leaveDir(edgeId, nodeId);
        // leaveDir points AWAY from the node on both edges, so compare against ±plan direction
        const ang = (Math.acos(Math.min(1, Math.abs(u.x * near!.dir.x + u.y * near!.dir.y)))
          * 180) / Math.PI;
        expect(ang, `${edgeId} leaves ${nodeId} along the plan`).toBeLessThan(MAX_STEP_DEG);
      }
    }
  });

  it('the guards that pick the plan tangent hold at both knots, with their measured margins', () => {
    // measured: n37 is 34.04 pt from the plan and 25.78 deg off the chord average; n35 20.14 pt
    // and 29.44 deg. Both inside PLAN_TANGENT_MAX_DIST_PT / PLAN_TANGENT_MAX_CORR_DEG.
    for (const [nodeId, distPt, corrDeg] of [
      ['n37', 34.04, 25.78], ['n35', 20.14, 29.44],
    ] as ReadonlyArray<readonly [string, number, number]>) {
      const node = nodeById.get(nodeId)?.pt as Vec2;
      const [a, b] = incident.get(nodeId) as [string, string];
      // chord average of the two node-to-node chords, in the run's travel sense
      const ua = leaveDir(a, nodeId);
      const ub = leaveDir(b, nodeId);
      const sum = { x: ub.x - ua.x, y: ub.y - ua.y };
      const l = Math.hypot(sum.x, sum.y);
      const picked = planKnotTangent(node, { x: sum.x / l, y: sum.y / l }, primitives);
      expect(picked, `${nodeId} adopts a plan tangent`).not.toBeNull();
      expect(picked!.distPt, `${nodeId} distance to the plan`).toBeCloseTo(distPt, 1);
      expect(picked!.distPt).toBeLessThanOrEqual(PLAN_TANGENT_MAX_DIST_PT);
      expect(picked!.correctionDeg, `${nodeId} correction`).toBeLessThanOrEqual(corrDeg + 3);
      expect(picked!.correctionDeg).toBeLessThanOrEqual(PLAN_TANGENT_MAX_CORR_DEG);
    }
  });

  it('a node far from the plan falls back to the chords instead of inventing a tangent', () => {
    expect(planKnotTangent({ x: -5000, y: -5000 }, { x: 1, y: 0 }, primitives)).toBeNull();
  });
});

describe('the emitted sampling honours the spacing rule it documents', () => {
  it('no edge carries more segments than floor(length / MIN_SEG_PT)', () => {
    // This — a MEAN spacing of at least MIN_SEG_PT — is the guarantee `decimateByHeading`
    // actually gives. A minimum-length floor is arithmetically incompatible with the heading
    // step bound (equal-heading sampling bunches samples where the curve is tightest), which is
    // why the tool's comment claims the mean and this test pins the mean.
    const offenders = plan.edges
      .map((e) => {
        const pts = e.pts as Vec2[];
        let lengthPt = 0;
        for (let i = 1; i < pts.length; i += 1) {
          lengthPt += Math.hypot(
            (pts[i] as Vec2).x - (pts[i - 1] as Vec2).x,
            (pts[i] as Vec2).y - (pts[i - 1] as Vec2).y,
          );
        }
        return { id: e.id, segments: pts.length - 1, cap: Math.floor(lengthPt / MIN_SEG_PT) };
      })
      .filter((r) => r.segments > r.cap);
    expect(offenders).toEqual([]);
  });

  it('the shortest emitted segment stays where it was measured', () => {
    let shortest = Number.POSITIVE_INFINITY;
    let under = 0;
    for (const e of plan.edges) {
      const pts = e.pts as Vec2[];
      for (let i = 1; i < pts.length; i += 1) {
        const d = Math.hypot(
          (pts[i] as Vec2).x - (pts[i - 1] as Vec2).x,
          (pts[i] as Vec2).y - (pts[i - 1] as Vec2).y,
        );
        shortest = Math.min(shortest, d);
        if (d < MIN_SEG_PT) under += 1;
      }
    }
    // measured: 0.6701 pt = 2.35 mm on `e86`, and 17 of 1077 segments under 1 pt. Rounding to
    // COORD_DECIMALS leaves 0.06° of heading uncertainty on that segment — inside the 3° budget.
    expect(shortest, 'shortest emitted segment, plan units').toBeGreaterThan(0.6);
    expect(under, 'segments under MIN_SEG_PT').toBeLessThanOrEqual(20);
  });
});

describe('the smoothing moved nothing that carries meaning', () => {
  it('every node coordinate is unchanged', () => {
    const pinned = [
      'n25:130,525.1', 'n26:125.6,525.1', 'n12:167.6,525.1', 'n15:182.6,525.1', 'n31:621.7,525.1',
      'n11:125.6,511', 'n16:221.9,511', 'n16b:227.9,511', 'n75:337.9,496.8', 'n59:703.8,496.8',
      'n59b:709.8,496.8', 'n4:791.8,496.8', 'n5:847.3,496.8', 'n6:933.5,496.8', 'n76:118.6,482.6',
      'n58:307,482.6', 'n58b:313,482.6', 'n32:352,482.6', 'n33:749.3,482.6', 'n57:394.9,454.1',
      'n49:399.9,454.2', 'n13:749.2,454.3', 'n14:791.8,468.4', 'n48:847.3,468.5', 'n27:26.4,424.6',
      'n28:26.4,298.6', 'n37:75,175', 'n39:196.7,110', 'n40:196.7,100', 'n7:281.5,14.9',
      'n10:848.6,14.9', 'n20:933.5,100', 'n21:40.7,410', 'n29:40.7,282', 'n35:88,185',
      'n38:210.7,110', 'n41:210.7,100', 'n42:281.3,29', 'n8:324,29.1', 'n64:338.3,29',
      'n79:423.4,43.2', 'n80:707.4,43.2', 'n63:791.8,29', 'n9:806,29.1', 'n44:847,29',
      'n45:919.3,100', 'n60:352.9,57.4', 'n61:420.4,57.4', 'n61b:426.4,57.4', 'n62:706.8,57.4',
      'n66:751.8,43', 'n65:508.4,85.7', 'n83:621.4,85.8', 'n81:551,100', 'n82:643,100',
      'n56:281.5,128.3', 'n55:281.5,301.7', 'n51:281.5,338.7', 'n53:281.5,366.2', 'n50:178.4,241.8',
      'n78:155.4,241.7', 'n30:54.8,341', 'n24:54.8,368', 'n23:152,468.4', 'n22:157,468.4',
      'n54:177.1,468.4', 'n67:380.8,199.2', 'n68:422.8,199.2', 'n69:784.3,199.2', 'n17:801.3,199.2',
      'n70:478,213.4', 'n71:650.1,213.4', 'n73:356,184.9', 'n72:351,184.9', 'n74:741,184.9',
      'n77:296.8,158', 'n18:919.3,137.2', 'n18b:919.3,143.2', 'n19:877.2,197.2', 'n2:919.3,309.5',
      'n2b:919.3,315.5', 'n47:919.3,394.7', 'n1:919.3,411.8', 'n3:933.5,355', 'n0:933.5,369.2',
      'n46:933.5,408.4',
    ];
    expect(plan.nodes.map((n) => `${n.id}:${n.pt.x},${n.pt.y}`)).toEqual(pinned);
  });

  it('every edge still starts and ends exactly on its node (bit-identical, not just close)', () => {
    for (const e of plan.edges) {
      const from = nodeById.get(e.from)?.pt as Vec2;
      const to = nodeById.get(e.to)?.pt as Vec2;
      const first = e.pts[0] as Vec2;
      const last = e.pts[e.pts.length - 1] as Vec2;
      expect([first.x, first.y], `${e.id} start`).toEqual([from.x, from.y]);
      expect([last.x, last.y], `${e.id} end`).toEqual([to.x, to.y]);
    }
  });

  it('every reed plan position (edge + offsetMm) is unchanged', () => {
    const pinned = [
      'xR02BH1G2:e77@993.6', 'xR03D:e32@302.5', 'xR03E:e31@263.5', 'xR01BH2G2:e89@917.7',
      'xR01BH2G1:e33@1488.9', 'xR02BH2G5:e94@49.4', 'xR01BH3G2:e9@223.7', 'xR02BH2G3:e61@113.4',
      'xR02BH2G2:e89@49.7', 'xR02BH2G1:e33@397.3', 'xR02BH3G3:e74@260.8', 'xR01B:e30@103.1',
      'xR01A:e29@216.4', 'xR01BH1G1:e23@868', 'xR01BH1G3:e24@1215.2', 'xR01D:e39@182.1',
      'xR01E:e37@263.6', 'xR01K:e87@29.1', 'xR03B:e12@215.4', 'xR03A:e16@273.4',
      'xR02BH1G1:e23@49.4', 'xR03BH1G4:e43@346.8', 'xR03BH1G3:e24@396.9', 'xR02A:e26@301.2',
      'xR02B:e25@228.7', 'xR01C:e92@282.9', 'xR02C:e49@247.8', 'xR03C:e46@329.3', 'xR02K:e14@408.9',
      'xR02D:e41@344.8', 'xR02E:e36@595.4', 'xR01BH1G2:e77@175', 'xR01BH1G4:e51@263',
      'xR02BH1G4:e43@1165.5', 'xR03BH1G2:e2@94.5', 'xR04BH1G2:e3@252.4', 'xR01BH2G3:e61@807.8',
      'xR01BH2G4:e100@347.2', 'xR02BH2G4:e100@149.1', 'xR01BH2G5:e94@148.8', 'xR03BH3G2:e70@944.7',
      'xR04BH3G2:e70@398.7', 'xR05BH3G2:e68@371', 'xR01BH3G3:e74@1228.2', 'xR02BH3G1:e72@155.8',
    ];
    expect(plan.reeds.map((r) => `${r.id}:${r.edgeId}@${r.offsetMm}`)).toEqual(pinned);
  });

  it('every switch still sits on its own node', () => {
    const pinned = [
      'xW01BH1G1:n12', 'xW02BH1G1:n15', 'xW01BH1G2:n11', 'xW03BH1G2:n16', 'xW02BH1G2:n16b',
      'xW02BH1G3:n58', 'xW03BH1G3:n58b', 'xW02BH1G4:n57', 'xW04BH1G2:n59', 'xW05BH1G2:n59b',
      'xW05BH1G3:n33', 'xW03BH1G4:n14', 'xW01D:n1', 'xW02D:n2', 'xW03D:n2b', 'xW04D:n18',
      'xW05D:n18b', 'xW01E:n0', 'xW02E:n3', 'xW03E:n20', 'xW02BH2G1:n7', 'xW01BH2G1:n10',
      'xW04BH2G2:n8', 'xW03BH2G2:n64', 'xW02BH2G3:n61', 'xW03BH2G3:n61b', 'xW01BH2G4:n65',
      'xW01BH2G3:n62', 'xW02BH2G2:n63', 'xW01BH2G2:n9', 'xW02C:n55', 'xW03C:n51', 'xW04C:n53',
      'xW03BH3G2:n68', 'xW02BH3G2:n69', '(xW):n5',
    ];
    expect(plan.switches.map((s) => `${s.id}:${s.nodeId}`)).toEqual(pinned);
  });

  /**
   * Smallest angle between any two edges leaving a switch node. `src/scene/switchMesh.ts` orients
   * the blades from `directionAtNode`, and its stated didactic requirement is that "the blade
   * position must be readable at a glance" — which fails once the two branches are parallel. The
   * smoothing collapsed `xW05D` from 37.94° to 1.70° because `e10` now follows plan curve #9
   * instead of a 2-point chord (verified plan-CORRECT: #9 passes 0.05 mm from `n18b` and leaves
   * plan straight #31 tangentially, so at that node the true divergence really is ~1.7°). Nothing
   * else in the suite measures this — `tests/scene/switches.test.ts` only covers blend arithmetic
   * — so a future collapse anywhere on the board would go unnoticed. Pinned as a per-switch FLOOR:
   * divergence may grow, never shrink.
   */
  const NARROW_SWITCHES: ReadonlyArray<readonly [string, number]> = [
    ['xW05D', 1.70], ['xW03C', 2.31], ['(xW)', 2.68], ['xW02C', 3.34], ['xW02D', 4.36],
  ];
  /** Every other switch, degrees. Measured next-narrowest: `xW03BH2G2` 9.61. */
  const WIDE_SWITCH_MIN_DEG = 9.5;

  it('no turnout collapses further than the five already-narrow ones', () => {
    const narrow = new Map(NARROW_SWITCHES);
    for (const s of plan.switches) {
      const dirs = (incident.get(s.nodeId) as string[]).map((id) => leaveDir(id, s.nodeId));
      let worst = Number.POSITIVE_INFINITY;
      for (let i = 0; i < dirs.length; i += 1) {
        for (let j = i + 1; j < dirs.length; j += 1) {
          const u = dirs[i] as Vec2;
          const w = dirs[j] as Vec2;
          worst = Math.min(
            worst,
            (Math.acos(Math.min(1, Math.max(-1, u.x * w.x + u.y * w.y))) * 180) / Math.PI,
          );
        }
      }
      const floor = narrow.get(s.id);
      expect(worst, `${s.id} branch divergence`)
        .toBeGreaterThanOrEqual((floor ?? WIDE_SWITCH_MIN_DEG) - 0.01);
    }
    // ...and the narrow list is exhaustive: nothing else may join it
    expect(plan.switches.filter((s) => !narrow.has(s.id)).length).toBe(plan.switches.length - 5);
  });

  it('every reed offset is still inside its (re-sampled) edge', () => {
    for (const r of plan.reeds) {
      const pts = (edgeById.get(r.edgeId) as { pts: Vec2[] }).pts;
      let mm = 0;
      for (let i = 1; i < pts.length; i += 1) {
        mm += Math.hypot(
          (pts[i] as Vec2).x - (pts[i - 1] as Vec2).x,
          (pts[i] as Vec2).y - (pts[i - 1] as Vec2).y,
        ) * MM_PER_UNIT;
      }
      expect(r.offsetMm, `${r.id} on ${r.edgeId} (0..${mm.toFixed(1)} mm)`).toBeLessThanOrEqual(mm);
    }
  });
});

describe('the committed pts are the smoothing tool output', () => {
  it('re-running tools/smooth-trackplan.ts is a byte-identical no-op (idempotent)', () => {
    const again = smoothTrackplan(plan, planPaths);
    expect(JSON.stringify(again.plan.edges)).toBe(JSON.stringify(plan.edges));
    expect(again.report.passes, 'already at the fixed point').toBe(0);
  });

  it('is deterministic: the same input yields the identical output twice', () => {
    const a = smoothTrackplan(plan, planPaths).plan;
    const b = smoothTrackplan(plan, planPaths).plan;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
