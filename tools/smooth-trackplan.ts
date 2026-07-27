/**
 * tools/smooth-trackplan.ts — rewrite `edges[].pts` in `src/data/trackplan.json` as a dense
 * tangent-continuous (G1) polyline, driven by the Gleisplan's own path primitives.
 *
 * WHY A DATA TRANSFORM (defect D9, owner decision in docs/HANDOFF.md). Two independent
 * consumers read `edges[].pts` — `src/plant/geometry.ts` (`Polyline`: drives the train and
 * the reed trigger positions) and `src/scene/trackMesh.ts` (`buildEdgeCurves`: draws the
 * rails). Smoothing only one would float the train beside its own track, so the smoothing
 * happens once, in the data, and both consumers see identical geometry with zero code
 * change. The massif's cutting mask follows automatically because it derives from the same
 * `pts` (D6 stays intact).
 *
 * ALGORITHM (three passes; every constant is listed under TOLERANCES below)
 *
 * 1. Plan repair, per edge. `tools/gleisplan-paths.json` holds the 74 stroked primitives of
 *    the grey track network (52 straights, 22 cubic-Bézier chains) extracted from
 *    "Gleisplan SPS.pdf" p. 3 — see tools/extract-gleisplan-paths.py. When BOTH endpoints of
 *    an edge sit within `ENDPOINT_TOL` of one primitive, that primitive is authoritative:
 *      - straight primitive  -> interior vertices are dropped (the plan draws no bend);
 *      - curve primitive     -> the edge is resampled off the Bézier between the projections
 *                               of its two endpoints, but only if the plan curve departs
 *                               from the stored polyline by more than `SAG_MIN_MM` (an
 *                               already-faithful sampling is left alone so arc lengths and
 *                               reed positions move as little as possible).
 *    Resampling a Bézier beats fitting a spline through sparse samples; it is also the only
 *    way to fix an edge stored as a single chord where the plan draws a curve.
 *
 * 2. Chain build. A chain is a maximal run of edges joined through PLAIN (degree-2) nodes;
 *    it stops at every switch and buffer. The worst kinks in the reported defect are
 *    cross-edge (`n39` 79.5°, `n38` 74.6°, `n29` 41.4°), so per-edge smoothing cannot reach
 *    them. Node positions are never moved: every node — chain end or interior — stays a knot
 *    of the curve at exactly its stored coordinate.
 *
 * 3. Chain smoothing. Each chain segment is classified against the plan as `line` (it hugs a
 *    plan straight within `LINE_DIST_TOL` and runs parallel to it within `LINE_ANGLE_TOL`) or
 *    `curve`. Then, per vertex, a unit tangent:
 *      - `line`|`line`  -> no tangent is needed, the segment is emitted verbatim. A genuine
 *                          plan corner (diagonal ladder track meeting a platform road) is
 *                          therefore PRESERVED, not rounded away.
 *      - `line`|`curve` -> the tangent is CLAMPED to the straight's direction, so the curve
 *                          leaves the straight tangentially. This is what removes the 79.5°
 *                          and 74.6° corners at `n39`/`n38`, where the 10-unit stubs
 *                          `e96`/`e97` (genuine plan track: plan straights #69/#70 at
 *                          x = 196.68 / 210.72, our data 0.02 pt off them) met an arc that
 *                          had overrun its tangent point.
 *      - `curve`|`curve`-> the normalised sum of the two adjacent unit chords, i.e. the same
 *                          tangent estimator `MeshAccum.sweep` already uses in trackMesh.ts.
 *                          Exact for collinear points, so a straight run cannot bow.
 *    Each `curve` segment then becomes a cubic Bézier (Hermite with control handles at
 *    chord/3) and is flattened at equal heading increments of at most `MAX_TURN_DEG`, capped at
 *    `floor(runLength / MIN_SEG_PT)` samples — a MEAN spacing bound, not a minimum one; see
 *    `MIN_SEG_PT` for why a minimum is incompatible with the heading bound.
 *    A curve run whose samples CONTRADICT this — kinking more than `RUN_KINK_LIMIT_DEG` inside
 *    or needing more than `RUN_CLAMP_LIMIT_DEG` of clamp at an end — is not interpolated at
 *    all: its non-node samples are dropped and the run is rebuilt from its NODE knots plus the
 *    clamped end tangents (`resetInconsistentRuns`). Interpolating them instead is G1 on paper
 *    and a 3-mm-radius hook on screen; the two broken west runs are the only ones affected.
 *    In such a rebuilt run the surviving INTERIOR node knots have no direction information left,
 *    so their tangent is taken from the plan too (`planKnotTangent`) rather than averaged out of
 *    the chords between the knots. That is what keeps the west corner off the curvature floor:
 *    chord averaging concentrated the turn in `e28`'s tail (84.6 mm radius, the tightest curve on
 *    the board, at exactly the spot the user circled) and the plan tangent lifts it to 107.2 mm
 *    while ALSO moving the run 21.9 mm closer to the plan.
 *
 * DETERMINISM / IDEMPOTENCE. No clock, no randomness, no floating-point-order surprises: the
 * transform is a pure function of (trackplan, plan paths), so the same input always yields
 * byte-identical output. Output coordinates are rounded to `COORD_DECIMALS`; original vertices
 * are copied through bit-identically so node coordinates cannot drift. The transform is
 * iterated to its own FIXED POINT (see `smoothTrackplan`), so re-running the tool on the
 * committed data changes nothing at all. `tests/data/trackSmoothness.test.ts` asserts both.
 *
 * CLI (repo root, Node >= 22.18 native type stripping):
 *
 *     node tools/smooth-trackplan.ts            # report only, writes nothing
 *     node tools/smooth-trackplan.ts --write    # rewrite src/data/trackplan.json in place
 *
 * Afterwards run `node tools/validate-trackplan.ts` and `npm run gates`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TrackplanFile, Vec2 } from '../src/plant';

/** Node process accessor without @types/node (see node-shim.d.ts for the module shims). */
const proc = (globalThis as unknown as {
  process: { argv: readonly (string | undefined)[]; exit(code?: number): never };
}).process;

// ───────────────────────────────────── TOLERANCES ─────────────────────────────────────────

/** Max heading change between two consecutive output vertices, degrees. */
export const MAX_TURN_DEG = 2.0;
/** A span turning less than this multiple of MAX_TURN_DEG is not subdivided (idempotence). */
export const SUBDIVIDE_HYST = 1.5;
/** Plan units: both edge endpoints must be this close to a plan primitive to adopt it. */
export const ENDPOINT_TOL = 0.5;
/**
 * mm: adopt a plan curve only where the stored polyline genuinely MISREPRESENTS it by more
 * than this. Below the threshold the sampling is already faithful and pass 3 alone removes
 * the faceting, which keeps arc lengths, reed positions and everything derived from the
 * centreline as close to the shipped values as possible. Not a free knob: at 1 mm this also
 * replaced `e68` (measured sag 4.98 mm) and moved the D8 tunnel mouth 8.6 mm — enough to flip
 * the Aussichtsturm's footprint onto the levelled side of the approach clip. Re-verified at
 * SAG_MIN_MM = 1.0: `tests/scene/terrain.test.ts` goes 17/19, failing "shows the Aussichtsturm
 * standing clear of its own summit" (roof tip -25.0 mm instead of >= 120 mm above the terrain)
 * and "takes rays from the Bird and Orbit cameras" (0 tower hits from Orbit). The west mouth
 * sits at a geometric limit
 * 23.6 mm from the tower (REVIEW_SCENE.md D8), so a 3.6 mm fidelity gain on `e68` is not
 * worth moving it.
 */
export const SAG_MIN_MM = 8.0;
/** Plan units: a segment must hug a plan straight this closely to count as straight. */
export const LINE_DIST_TOL = 2.0;
/** Degrees: ... and run parallel to it this closely. */
export const LINE_ANGLE_TOL = 2.0;
/**
 * Degrees. A curve run whose stored samples kink by more than this at an interior joint is
 * INTERNALLY INCONSISTENT — the samples do not lie on one smooth curve at all. The largest
 * legitimate value in the shipped data is 11.1° (`e12`, a 10-point 90° arc); the two broken
 * west runs kink 32.0° (`n35`) and 30.4° (`n37`).
 */
export const RUN_KINK_LIMIT_DEG = 15.0;
/**
 * Degrees. A curve run whose end tangent has to be corrected by more than this to meet its
 * adjoining straight is inconsistent with the plan at that end (`n39` 79.5°, `n38` 74.6°,
 * `n29` 41.4°). Interpolating such samples yields a G1 curve with a 3-mm-radius hook — a
 * spike on screen — so the run's non-node samples are dropped and the curve is rebuilt from
 * its NODE knots with clamped end tangents instead. Node coordinates never move.
 */
export const RUN_CLAMP_LIMIT_DEG = 30.0;
/**
 * Plan units. Target MEAN segment spacing (1 pt = 3.5 mm): `decimateByHeading` caps the sample
 * COUNT at `floor(runLength / MIN_SEG_PT)`, so a run of length L never gets more than L / 1 pt
 * segments. It does NOT bound the shortest segment, and cannot: the sampler places samples at
 * equal heading increments, so at the high-curvature end of a run they necessarily bunch up.
 * Dropping a sample to enforce a floor would merge two spans, each already carrying ~MAX_TURN_DEG
 * of heading, into one of ~2 × MAX_TURN_DEG — i.e. a minimum-length floor is arithmetically
 * incompatible with the heading-step bound, which is the property the defect is about. Measured
 * on the committed data: 40 of 1076 emitted segments are under 1 pt, shortest 0.463 pt = 1.62 mm
 * on `e28`; the rounding-induced heading uncertainty on that shortest segment is 0.06°, well
 * inside the 3° budget, and the tool is still exactly idempotent. `tests/data/trackSmoothness.test.ts`
 * pins the guarantee that actually holds (count ≤ floor(L / MIN_SEG_PT)) plus the measured floor.
 *
 * The cap is not cosmetic: without it the COORD_DECIMALS rounding starts to dominate a segment's
 * direction (measured: a 3.24° step on `e27`) and idempotence is lost (a 1.6 pt span sat right on
 * the subdivision threshold and gained one vertex per run).
 */
export const MIN_SEG_PT = 1.0;
/**
 * Plan units. A rebuilt run's interior node knot takes its tangent from the plan only if the node
 * is at most this far from the nearest plan primitive; further out the "nearest" primitive says
 * nothing about this piece of track. Measured: `n37` 34.0 pt, `n35` 20.1 pt.
 */
export const PLAN_TANGENT_MAX_DIST_PT = 60;
/**
 * Degrees. …and only if the plan direction is at most this far from the chord-average tangent it
 * replaces. This is the guard against adopting a *neighbouring* track's direction: `n35` belongs
 * to the inner pair (plan arcs #19/#21) but its nearest primitive is the outer arc #20, 20.1 pt
 * away — legitimate here, because the two arcs are near-concentric there (correction 29.4°), but
 * a wilder mismatch must fall back to the chords. Measured corrections: `n37` 25.8°, `n35` 29.4°.
 */
export const PLAN_TANGENT_MAX_CORR_DEG = 45;
/** Flattening steps used when a Bézier is measured or sampled. */
export const FINE_STEPS = 256;
/** Decimals kept in generated coordinates (0.001 pt = 3.5 µm on the plant). */
export const COORD_DECIMALS = 3;

// ─────────────────────────────────── plan primitives ──────────────────────────────────────

export interface PlanPathFile {
  paths: ReadonlyArray<
    | { kind: 'line'; pts: ReadonlyArray<readonly [number, number]> }
    | { kind: 'curve'; beziers: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }
  >;
}

/** A plan primitive prepared for measurement: its kind plus a dense polyline. */
export interface PlanPrimitive {
  readonly kind: 'line' | 'curve';
  readonly dense: readonly Vec2[];
  /** For `line`: unit direction of the primitive (used for the parallel test). */
  readonly dir: Vec2;
}

function v(x: number, y: number): Vec2 {
  return { x, y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return v(a.x - b.x, a.y - b.y);
}

function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

function unit(a: Vec2): Vec2 {
  const l = len(a);
  return l > 1e-12 ? v(a.x / l, a.y / l) : v(1, 0);
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function bezierAt(p: readonly Vec2[], t: number): Vec2 {
  const u = 1 - t;
  const [p0, p1, p2, p3] = p as [Vec2, Vec2, Vec2, Vec2];
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return v(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
}

function flattenBezier(p: readonly Vec2[], steps = FINE_STEPS): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) out.push(bezierAt(p, i / steps));
  return out;
}

export function preparePlan(file: PlanPathFile): PlanPrimitive[] {
  return file.paths.map((p) => {
    if (p.kind === 'line') {
      const pts = p.pts.map(([x, y]) => v(x, y));
      const first = pts[0] as Vec2;
      const last = pts[pts.length - 1] as Vec2;
      return { kind: 'line' as const, dense: pts, dir: unit(sub(last, first)) };
    }
    const dense: Vec2[] = [];
    for (const bez of p.beziers) {
      const seg = flattenBezier(bez.map(([x, y]) => v(x, y)));
      const head = seg[0] as Vec2;
      const tail = dense[dense.length - 1];
      dense.push(...(tail && len(sub(head, tail)) < 1e-6 ? seg.slice(1) : seg));
    }
    const first = dense[0] as Vec2;
    const last = dense[dense.length - 1] as Vec2;
    return { kind: 'curve' as const, dense, dir: unit(sub(last, first)) };
  });
}

// ────────────────────────────────── geometry helpers ──────────────────────────────────────

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < 1e-12) return len(sub(p, a));
  const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / l2));
  return len(sub(p, v(a.x + t * d.x, a.y + t * d.y)));
}

/** Distance from `p` to a polyline, and the index of the closest segment with its parameter. */
function projectOnPolyline(p: Vec2, poly: readonly Vec2[]): { d: number; i: number; t: number } {
  let best = { d: Number.POSITIVE_INFINITY, i: 0, t: 0 };
  for (let i = 0; i < poly.length - 1; i += 1) {
    const a = poly[i] as Vec2;
    const b = poly[i + 1] as Vec2;
    const d = sub(b, a);
    const l2 = dot(d, d);
    const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / l2));
    const q = v(a.x + t * d.x, a.y + t * d.y);
    const dist = len(sub(p, q));
    if (dist < best.d) best = { d: dist, i, t };
  }
  return best;
}

export function distToPolyline(p: Vec2, poly: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length - 1; i += 1) {
    const d = distToSegment(p, poly[i] as Vec2, poly[i + 1] as Vec2);
    if (d < best) best = d;
  }
  return best;
}

/** Closest distance from `p` to any plan primitive (plan units). */
export function distToPlan(p: Vec2, plan: readonly PlanPrimitive[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const prim of plan) {
    const d = distToPolyline(p, prim.dense);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Direction of the plan at the point of the plan network closest to `p`, with that distance.
 * Unoriented (the caller flips it into the run's travel sense); `null` if the plan is empty.
 */
export function planDirectionAt(
  p: Vec2,
  plan: readonly PlanPrimitive[],
): { dir: Vec2; distPt: number } | null {
  let best: { dir: Vec2; distPt: number } | null = null;
  for (const prim of plan) {
    const poly = prim.dense;
    for (let i = 0; i < poly.length - 1; i += 1) {
      const a = poly[i] as Vec2;
      const b = poly[i + 1] as Vec2;
      const d = sub(b, a);
      const l2 = dot(d, d);
      if (l2 < 1e-12) continue;
      const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / l2));
      const distPt = len(sub(p, v(a.x + t * d.x, a.y + t * d.y)));
      if (best === null || distPt < best.distPt) best = { dir: unit(d), distPt };
    }
  }
  return best;
}

export function polylineLength(pts: readonly Vec2[]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) acc += len(sub(pts[i] as Vec2, pts[i - 1] as Vec2));
  return acc;
}

/** Signed heading of a segment in plan space (atan2(dy, dx), y downward). */
function heading(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Largest heading change (degrees) between consecutive segments of a polyline. */
export function maxTurnDeg(pts: readonly Vec2[]): number {
  let worst = 0;
  for (let i = 2; i < pts.length; i += 1) {
    const h0 = heading(pts[i - 2] as Vec2, pts[i - 1] as Vec2);
    const h1 = heading(pts[i - 1] as Vec2, pts[i] as Vec2);
    const d = Math.abs((wrapPi(h1 - h0) * 180) / Math.PI);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Keeps both endpoints and inserts interior samples at equal absolute-heading increments of
 * at most MAX_TURN_DEG. A run turning less than MAX_TURN_DEG * SUBDIVIDE_HYST is left as a
 * single chord — that hysteresis is what makes a second run of the tool a no-op.
 */
function decimateByHeading(fine: readonly Vec2[]): Vec2[] {
  if (fine.length < 3) return [...fine];
  const cum: number[] = [0];
  let prev = heading(fine[0] as Vec2, fine[1] as Vec2);
  for (let i = 1; i < fine.length - 1; i += 1) {
    const h = heading(fine[i] as Vec2, fine[i + 1] as Vec2);
    cum.push((cum[i - 1] as number) + Math.abs(wrapPi(h - prev)));
    prev = h;
  }
  const totalDeg = ((cum[cum.length - 1] as number) * 180) / Math.PI;
  const first = fine[0] as Vec2;
  const last = fine[fine.length - 1] as Vec2;
  if (totalDeg <= MAX_TURN_DEG * SUBDIVIDE_HYST) return [first, last];
  const n = Math.min(
    Math.ceil(totalDeg / MAX_TURN_DEG),
    Math.floor(polylineLength(fine) / MIN_SEG_PT),
  );
  if (n < 2) return [first, last];
  const out: Vec2[] = [first];
  let j = 0;
  for (let k = 1; k < n; k += 1) {
    const target = ((cum[cum.length - 1] as number) * k) / n;
    while (j < cum.length - 1 && (cum[j + 1] as number) < target) j += 1;
    out.push(fine[j + 1] as Vec2);
  }
  out.push(last);
  return dedupe(out);
}

function dedupe(pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [pts[0] as Vec2];
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i] as Vec2;
    if (len(sub(p, out[out.length - 1] as Vec2)) > 1e-9) out.push(p);
  }
  return out;
}

// ────────────────────────────────── pass 1: plan repair ───────────────────────────────────

export interface RepairNote {
  edgeId: string;
  action: 'collapsed-to-plan-line' | 'resampled-from-plan-curve';
  planIndex: number;
  before: number;
  after: number;
  sagMm: number;
}

/** Dense sub-polyline of `poly` between two projected positions, ordered start→end. */
function subPolyline(
  poly: readonly Vec2[],
  a: { i: number; t: number },
  b: { i: number; t: number },
): Vec2[] {
  const at = (i: number, t: number): Vec2 => {
    const p = poly[i] as Vec2;
    const q = poly[i + 1] as Vec2;
    return v(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
  };
  const forward = a.i < b.i || (a.i === b.i && a.t <= b.t);
  const lo = forward ? a : b;
  const hi = forward ? b : a;
  const out: Vec2[] = [at(lo.i, lo.t)];
  for (let i = lo.i + 1; i <= hi.i; i += 1) out.push(poly[i] as Vec2);
  out.push(at(hi.i, hi.t));
  const ded = dedupe(out);
  return forward ? ded : ded.reverse();
}

/**
 * Rubber-sheets a resampled plan curve onto the edge's own endpoints: the (at most
 * ENDPOINT_TOL) offset between the plan curve's ends and the node coordinates is spread over
 * the whole run in proportion to arc length. Overwriting only the two end vertices instead
 * would leave a kink on the last short segment — measured as a 58 mm curvature radius on
 * `e31` before this was added.
 */
function snapEnds(fine: readonly Vec2[], a: Vec2, b: Vec2): Vec2[] {
  const d0 = sub(a, fine[0] as Vec2);
  const d1 = sub(b, fine[fine.length - 1] as Vec2);
  const cum: number[] = [0];
  for (let i = 1; i < fine.length; i += 1) {
    cum.push((cum[i - 1] as number) + len(sub(fine[i] as Vec2, fine[i - 1] as Vec2)));
  }
  const total = cum[cum.length - 1] as number;
  if (!(total > 0)) return [...fine];
  return fine.map((p, i) => {
    const t = (cum[i] as number) / total;
    return v(p.x + d0.x * (1 - t) + d1.x * t, p.y + d0.y * (1 - t) + d1.y * t);
  });
}

export function planRepair(
  plan: TrackplanFile,
  primitives: readonly PlanPrimitive[],
  mmPerUnit: number,
): { pts: Map<string, Vec2[]>; notes: RepairNote[] } {
  const pts = new Map<string, Vec2[]>();
  const notes: RepairNote[] = [];
  for (const e of plan.edges) {
    const stored = e.pts.map((p) => v(p.x, p.y));
    const a = stored[0] as Vec2;
    const b = stored[stored.length - 1] as Vec2;
    let pick = -1;
    let pickErr = Number.POSITIVE_INFINITY;
    for (let i = 0; i < primitives.length; i += 1) {
      const prim = primitives[i] as PlanPrimitive;
      const err = Math.max(distToPolyline(a, prim.dense), distToPolyline(b, prim.dense));
      if (err <= ENDPOINT_TOL && err < pickErr) {
        pick = i;
        pickErr = err;
      }
    }
    if (pick < 0) {
      pts.set(e.id, stored);
      continue;
    }
    const prim = primitives[pick] as PlanPrimitive;
    if (prim.kind === 'line') {
      if (stored.length > 2) {
        pts.set(e.id, [a, b]);
        notes.push({
          edgeId: e.id, action: 'collapsed-to-plan-line', planIndex: pick,
          before: stored.length, after: 2,
          sagMm: Math.max(...stored.slice(1, -1).map((p) => distToSegment(p, a, b))) * mmPerUnit,
        });
      } else {
        pts.set(e.id, stored);
      }
      continue;
    }
    const fine = snapEnds(
      subPolyline(prim.dense, projectOnPolyline(a, prim.dense), projectOnPolyline(b, prim.dense)),
      a,
      b,
    );
    const sagMm = Math.max(...fine.map((p) => distToPolyline(p, stored))) * mmPerUnit;
    if (sagMm < SAG_MIN_MM) {
      pts.set(e.id, stored);
      continue;
    }
    const dec = decimateByHeading(fine);
    dec[0] = a;
    dec[dec.length - 1] = b;
    pts.set(e.id, dec);
    notes.push({
      edgeId: e.id, action: 'resampled-from-plan-curve', planIndex: pick,
      before: stored.length, after: dec.length, sagMm,
    });
  }
  return { pts, notes };
}

// ─────────────────────────────────── pass 2: chains ───────────────────────────────────────

export interface Chain {
  /** Edge ids in traversal order. */
  readonly edgeIds: readonly string[];
  /** Node id sequence, `nodeIds[k]` joins `edgeIds[k-1]` to `edgeIds[k]`. */
  readonly nodeIds: readonly string[];
}

/** Maximal edge runs through plain degree-2 nodes; stops at switches, buffers and any other. */
export function buildChains(plan: TrackplanFile): Chain[] {
  const incident = new Map<string, string[]>(plan.nodes.map((n) => [n.id, []]));
  for (const e of plan.edges) {
    incident.get(e.from)?.push(e.id);
    incident.get(e.to)?.push(e.id);
  }
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
  const plain = new Set(
    plan.nodes.filter((n) => n.kind === 'plain' && (incident.get(n.id) ?? []).length === 2).map((n) => n.id),
  );
  const used = new Set<string>();
  const chains: Chain[] = [];
  for (const seed of plan.edges) {
    if (used.has(seed.id)) continue;
    used.add(seed.id);
    const edgeIds = [seed.id];
    const grow = (startNode: string, append: boolean): string => {
      let cur = seed.id;
      let node = startNode;
      while (plain.has(node)) {
        const next = (incident.get(node) ?? []).find((id) => id !== cur);
        if (next === undefined || used.has(next)) break;
        used.add(next);
        cur = next;
        if (append) edgeIds.push(cur);
        else edgeIds.unshift(cur);
        const e = edgeById.get(cur) as { from: string; to: string };
        node = e.from === node ? e.to : e.from;
      }
      return node;
    };
    grow(seed.to, true);
    grow(seed.from, false);
    // node sequence: walk the chain from its first edge's free end
    const nodeIds: string[] = [];
    const firstEdge = edgeById.get(edgeIds[0] as string) as { from: string; to: string };
    let node: string;
    if (edgeIds.length === 1) {
      node = firstEdge.from;
    } else {
      const second = edgeById.get(edgeIds[1] as string) as { from: string; to: string };
      node = second.from === firstEdge.to || second.to === firstEdge.to ? firstEdge.from : firstEdge.to;
    }
    nodeIds.push(node);
    for (const id of edgeIds) {
      const e = edgeById.get(id) as { from: string; to: string };
      node = e.from === node ? e.to : e.from;
      nodeIds.push(node);
    }
    chains.push({ edgeIds, nodeIds });
  }
  return chains;
}

// ────────────────────────────── pass 3: chain smoothing ───────────────────────────────────

export type SegmentKind = 'line' | 'curve';

/** Classifies a chain segment against the plan straights (see the header for the rule). */
export function classifySegment(a: Vec2, b: Vec2, plan: readonly PlanPrimitive[]): SegmentKind {
  const mid = v((a.x + b.x) / 2, (a.y + b.y) / 2);
  const u = unit(sub(b, a));
  for (const prim of plan) {
    if (prim.kind !== 'line') continue;
    const o = prim.dense[0] as Vec2;
    const n = v(-prim.dir.y, prim.dir.x);
    const perp = (p: Vec2): number => Math.abs(dot(sub(p, o), n));
    if (Math.max(perp(a), perp(mid), perp(b)) > LINE_DIST_TOL) continue;
    const ang = (Math.acos(Math.min(1, Math.abs(dot(u, prim.dir)))) * 180) / Math.PI;
    if (ang <= LINE_ANGLE_TOL) return 'line';
  }
  return 'curve';
}

export interface ClampNote {
  at: Vec2;
  correctionDeg: number;
}

export interface ResetNote {
  from: Vec2;
  to: Vec2;
  dropped: number;
  reason: string;
}

/** One vertex of a chain: its position and, if it is a node, that node's id. */
export interface ChainVertex {
  p: Vec2;
  node: string | null;
  /**
   * Tangent imposed from the plan instead of estimated from the neighbouring chords. Set only on
   * the interior NODE knots of a run that `resetInconsistentRuns` rebuilt — see `planKnotTangent`.
   */
  planTangent?: Vec2 | null;
}

export interface PlanKnotNote {
  nodeId: string;
  at: Vec2;
  /** Plan units: how far the node sits from the plan primitive whose direction was adopted. */
  distPt: number;
  /** Degrees: how far that direction is from the chord-average tangent it replaced. */
  correctionDeg: number;
}

/**
 * Once a run's interior samples have been discarded as untrustworthy (`resetInconsistentRuns`),
 * its interior NODE knots have no direction information left. Averaging the surviving chords
 * there is arbitrary — and measurably wrong: at `n37` it yields −48.3°, which sends the curve out
 * of the node steeper than the chord to `n39` and forces the whole remaining 69° of turn into the
 * tail, producing the tightest curve on the board (84.6 mm) at exactly the spot the user circled.
 * The plan is the authority everywhere else in this tool, so it is the authority here too: the
 * knot tangent is the direction of the plan at the point of the plan network closest to the node.
 *
 * Measured effect (the only two runs this reaches are the two west runs; see REVIEW_SCENE D9):
 *   knot | chord-average | plan  | tightest radius   | max distance to the plan
 *   n37  | −48.32°       | −22.54° | 84.6 → 107.2 mm | 160.2 → 138.3 mm
 *   n35  | −47.72°       | −18.28° | 98.7 → 135.1 mm  | 131.6 → 95.1 mm
 * Both bounds improve, so this is not a curvature/fidelity trade. It does NOT make the corner
 * plan-CORRECT — that needs `n35`/`n37` moved onto the plan's tangent points, which is an owner
 * decision outside D9 (REVIEW_SCENE D9 "Offener Restbefund").
 */
export function planKnotTangent(
  p: Vec2,
  chordAverage: Vec2,
  plan: readonly PlanPrimitive[],
): { tangent: Vec2; distPt: number; correctionDeg: number } | null {
  const near = planDirectionAt(p, plan);
  if (near === null || near.distPt > PLAN_TANGENT_MAX_DIST_PT) return null;
  // orient the (unsigned) plan direction into the run's travel sense
  const dir = dot(near.dir, chordAverage) >= 0 ? near.dir : v(-near.dir.x, -near.dir.y);
  const correctionDeg = angleBetweenDeg(dir, chordAverage);
  if (correctionDeg > PLAN_TANGENT_MAX_CORR_DEG) return null;
  return { tangent: dir, distPt: near.distPt, correctionDeg };
}

function angleBetweenDeg(a: Vec2, b: Vec2): number {
  return (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI;
}

/**
 * A curve run whose stored samples contradict either themselves (interior kink >
 * RUN_KINK_LIMIT_DEG) or the plan straight they run into (end correction >
 * RUN_CLAMP_LIMIT_DEG) is rebuilt from its NODE knots alone: every non-node sample inside
 * the run is dropped. Mutates `vertices`/`kinds` in place; NODE vertices are never dropped,
 * so the topology and all node coordinates survive untouched.
 */
export function resetInconsistentRuns(
  vertices: ChainVertex[],
  kinds: SegmentKind[],
  plan: readonly PlanPrimitive[] = [],
): { resets: ResetNote[]; planKnots: PlanKnotNote[] } {
  const notes: ResetNote[] = [];
  const planKnots: PlanKnotNote[] = [];
  // scan right to left so splices never invalidate a run we have not looked at yet
  const runs: Array<{ s: number; e: number }> = [];
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== 'curve') { i += 1; continue; }
    let j = i;
    while (j < kinds.length && kinds[j] === 'curve') j += 1;
    runs.push({ s: i, e: j });
    i = j;
  }
  for (const run of runs.reverse()) {
    const at = (k: number): Vec2 => (vertices[k] as ChainVertex).p;
    let reason = '';
    for (let k = run.s + 1; k < run.e; k += 1) {
      const kink = angleBetweenDeg(unit(sub(at(k), at(k - 1))), unit(sub(at(k + 1), at(k))));
      if (kink > RUN_KINK_LIMIT_DEG) reason = `interior kink ${kink.toFixed(1)} deg`;
    }
    for (const [end, inward, outward] of [
      [run.s, run.s + 1, run.s - 1],
      [run.e, run.e - 1, run.e + 1],
    ] as ReadonlyArray<readonly [number, number, number]>) {
      if (outward < 0 || outward >= vertices.length) continue;
      const clamp = unit(sub(at(end), at(outward)));
      const chord = unit(sub(at(inward), at(end)));
      const corr = angleBetweenDeg(clamp, chord);
      if (corr > RUN_CLAMP_LIMIT_DEG) reason = `end correction ${corr.toFixed(1)} deg`;
    }
    if (reason === '') continue;
    const from = at(run.s);
    const to = at(run.e);
    const interiorKnots: ChainVertex[] = [];
    let dropped = 0;
    for (let k = run.e - 1; k > run.s; k -= 1) {
      const vx = vertices[k] as ChainVertex;
      if (vx.node !== null) {
        interiorKnots.push(vx);
        continue;
      }
      vertices.splice(k, 1);
      kinds.splice(k, 1);
      dropped += 1;
    }
    if (dropped === 0) continue;
    notes.push({ from, to, dropped, reason });
    // the surviving interior knots have lost their direction information — take it from the plan
    for (const knot of interiorKnots) {
      const i = vertices.indexOf(knot);
      if (i <= 0 || i >= vertices.length - 1) continue;
      const prev = unit(sub(knot.p, (vertices[i - 1] as ChainVertex).p));
      const next = unit(sub((vertices[i + 1] as ChainVertex).p, knot.p));
      const chordAverage = unit(v(prev.x + next.x, prev.y + next.y));
      const picked = planKnotTangent(knot.p, chordAverage, plan);
      if (picked === null) continue;
      knot.planTangent = picked.tangent;
      planKnots.push({
        nodeId: knot.node as string,
        at: knot.p,
        distPt: picked.distPt,
        correctionDeg: picked.correctionDeg,
      });
    }
  }
  return { resets: notes, planKnots };
}

function smoothVertexRun(
  pts: readonly Vec2[],
  kinds: readonly SegmentKind[],
  clamps: ClampNote[],
  /** Per-vertex tangent imposed from the plan (see `planKnotTangent`); `null` = estimate it. */
  forced: ReadonlyArray<Vec2 | null> = [],
): { out: Vec2[]; keptAt: number[] } {
  const n = pts.length;
  const chords: Vec2[] = [];
  for (let i = 0; i < n - 1; i += 1) chords.push(unit(sub(pts[i + 1] as Vec2, pts[i] as Vec2)));
  const tangents: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = i > 0 ? (chords[i - 1] as Vec2) : undefined;
    const next = i < n - 1 ? (chords[i] as Vec2) : undefined;
    if (!prev) {
      tangents.push(next as Vec2);
      continue;
    }
    if (!next) {
      tangents.push(prev);
      continue;
    }
    const impose = forced[i];
    if (impose) {
      tangents.push(impose);
      continue;
    }
    const pk = kinds[i - 1] as SegmentKind;
    const nk = kinds[i] as SegmentKind;
    if (pk !== nk) {
      const keep = pk === 'line' ? prev : next;
      const correctionDeg = angleBetweenDeg(prev, next);
      if (correctionDeg > 1e-6) clamps.push({ at: pts[i] as Vec2, correctionDeg });
      tangents.push(keep);
      continue;
    }
    tangents.push(unit(v(prev.x + next.x, prev.y + next.y)));
  }
  const out: Vec2[] = [pts[0] as Vec2];
  const keptAt: number[] = [0];
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = pts[i] as Vec2;
    const p1 = pts[i + 1] as Vec2;
    if (kinds[i] === 'line') {
      out.push(p1);
    } else {
      const l = len(sub(p1, p0));
      const t0 = tangents[i] as Vec2;
      const t1 = tangents[i + 1] as Vec2;
      const c0 = v(p0.x + (t0.x * l) / 3, p0.y + (t0.y * l) / 3);
      const c1 = v(p1.x - (t1.x * l) / 3, p1.y - (t1.y * l) / 3);
      const dec = decimateByHeading(flattenBezier([p0, c0, c1, p1]));
      for (let k = 1; k < dec.length - 1; k += 1) out.push(dec[k] as Vec2);
      out.push(p1);
    }
    keptAt.push(out.length - 1);
  }
  return { out, keptAt };
}

// ───────────────────────────────────── the transform ──────────────────────────────────────

export interface SmoothReport {
  repairs: RepairNote[];
  clamps: ClampNote[];
  resets: ResetNote[];
  planKnots: PlanKnotNote[];
  chains: number;
  ptsBefore: number;
  ptsAfter: number;
  /** Passes needed to reach the fixed point (see `smoothTrackplan`). */
  passes: number;
}

/** Cap on the fixed-point iteration in `smoothTrackplan` (it converges in 2 on the shipped data). */
export const MAX_PASSES = 6;

function round(x: number): number {
  const r = Math.round(x * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;
  return r === 0 ? 0 : r; // normalise -0
}

/**
 * Pure transform: returns a NEW trackplan with rewritten `edges[].pts`, iterated to its own
 * fixed point so that re-running the tool on the committed data is a byte-identical no-op.
 *
 * Why iterating is needed: the line/curve classification is positional, and a smoothed curve
 * now leaves its straight tangentially — so on a second pass its first, very short generated
 * segment also hugs the plan straight and is classified `line`, moving the clamp boundary one
 * vertex inward. That is a contraction, not a drift: pass 2 moves the centreline by 0.07 mm
 * and adds 2 of 1177 vertices, pass 3 changes nothing. Publishing the fixed point instead of
 * the first pass makes idempotence exact rather than merely "stable".
 */
export function smoothTrackplan(
  plan: TrackplanFile,
  planPaths: PlanPathFile,
): { plan: TrackplanFile; report: SmoothReport } {
  let cur = plan;
  let report: SmoothReport | null = null;
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const step = smoothPass(cur, planPaths);
    const settled = JSON.stringify(step.plan.edges) === JSON.stringify(cur.edges);
    if (report === null) report = { ...step.report, passes: pass };
    cur = step.plan;
    if (settled) return { plan: cur, report: { ...report, passes: pass - 1, ptsAfter: countPts(cur) } };
  }
  throw new Error(`smooth-trackplan: no fixed point after ${MAX_PASSES} passes`);
}

function countPts(plan: TrackplanFile): number {
  return plan.edges.reduce((a, e) => a + e.pts.length, 0);
}

/** One pass of the three-stage transform (see the file header). */
function smoothPass(
  plan: TrackplanFile,
  planPaths: PlanPathFile,
): { plan: TrackplanFile; report: SmoothReport } {
  const primitives = preparePlan(planPaths);
  const { pts: repaired, notes: repairs } = planRepair(plan, primitives, plan.meta.mmPerUnit);
  const chains = buildChains(plan);
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
  const clamps: ClampNote[] = [];
  const resets: ResetNote[] = [];
  const planKnots: PlanKnotNote[] = [];
  const result = new Map<string, Vec2[]>();

  for (const chain of chains) {
    const vertices: ChainVertex[] = [];
    const reversedOf = new Map<string, boolean>();
    for (let k = 0; k < chain.edgeIds.length; k += 1) {
      const edgeId = chain.edgeIds[k] as string;
      const e = edgeById.get(edgeId) as { from: string; to: string };
      const entry = chain.nodeIds[k] as string;
      const exit = chain.nodeIds[k + 1] as string;
      const reversed = e.from !== entry;
      reversedOf.set(edgeId, reversed);
      const own = repaired.get(edgeId) as Vec2[];
      const oriented = reversed ? [...own].reverse() : own;
      if (vertices.length === 0) vertices.push({ p: oriented[0] as Vec2, node: entry });
      for (let i = 1; i < oriented.length; i += 1) {
        vertices.push({ p: oriented[i] as Vec2, node: i === oriented.length - 1 ? exit : null });
      }
    }
    const kinds: SegmentKind[] = [];
    for (let i = 0; i < vertices.length - 1; i += 1) {
      const a = vertices[i] as ChainVertex;
      const b = vertices[i + 1] as ChainVertex;
      kinds.push(classifySegment(a.p, b.p, primitives));
    }
    const reset = resetInconsistentRuns(vertices, kinds, primitives);
    resets.push(...reset.resets);
    planKnots.push(...reset.planKnots);
    const { out, keptAt } = smoothVertexRun(
      vertices.map((x) => x.p),
      kinds,
      clamps,
      vertices.map((x) => x.planTangent ?? null),
    );
    // node vertices are never dropped, so each edge is the range between two node vertices
    const nodeAt = new Map<string, number>();
    vertices.forEach((x, i) => { if (x.node !== null) nodeAt.set(x.node, i); });
    for (let k = 0; k < chain.edgeIds.length; k += 1) {
      const edgeId = chain.edgeIds[k] as string;
      const lo = nodeAt.get(chain.nodeIds[k] as string) as number;
      const hi = nodeAt.get(chain.nodeIds[k + 1] as string) as number;
      const slice = out.slice(keptAt[lo] as number, (keptAt[hi] as number) + 1);
      result.set(edgeId, reversedOf.get(edgeId) === true ? slice.reverse() : slice);
    }
  }

  const edges = plan.edges.map((e) => {
    const smoothed = result.get(e.id) as Vec2[];
    const original = e.pts;
    const first = original[0] as Vec2;
    const last = original[original.length - 1] as Vec2;
    const out = smoothed.map((p, i) => {
      if (i === 0) return { x: first.x, y: first.y };
      if (i === smoothed.length - 1) return { x: last.x, y: last.y };
      return { x: round(p.x), y: round(p.y) };
    });
    return { ...e, pts: out };
  });

  return {
    plan: { ...plan, edges },
    report: {
      repairs,
      clamps,
      resets,
      planKnots,
      chains: chains.length,
      ptsBefore: countPts(plan),
      ptsAfter: edges.reduce((a, e) => a + e.pts.length, 0),
      passes: 1,
    },
  };
}

// ─────────────────────────────────────────── CLI ──────────────────────────────────────────

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const planFile = join(here, '..', 'src', 'data', 'trackplan.json');
  const before = JSON.parse(readFileSync(planFile, 'utf8')) as TrackplanFile;
  const paths = JSON.parse(readFileSync(join(here, 'gleisplan-paths.json'), 'utf8')) as PlanPathFile;
  const { plan: after, report } = smoothTrackplan(before, paths);
  const mm = before.meta.mmPerUnit;
  const primitives = preparePlan(paths);

  console.log(`smooth-trackplan: ${report.chains} chains, ${report.ptsBefore} -> ${report.ptsAfter} vertices`);
  console.log('plan repairs:');
  for (const r of report.repairs) {
    console.log(`  ${r.edgeId}: ${r.action} #${r.planIndex}, ${r.before} -> ${r.after} pts, `
      + `sag ${r.sagMm.toFixed(2)} mm`);
  }
  console.log('inconsistent curve runs rebuilt from their node knots:');
  for (const r of report.resets) {
    console.log(`  (${r.from.x}, ${r.from.y}) -> (${r.to.x}, ${r.to.y}): dropped ${r.dropped} `
      + `interior samples — ${r.reason}`);
  }
  console.log('interior knots of rebuilt runs whose tangent came from the plan:');
  for (const k of report.planKnots) {
    console.log(`  ${k.nodeId} at (${k.at.x}, ${k.at.y}): plan ${k.distPt.toFixed(2)} pt away, `
      + `${k.correctionDeg.toFixed(2)} deg off the chord average`);
  }
  console.log('tangent clamps > 3 deg (correction actually applied):');
  for (const c of report.clamps.filter((x) => x.correctionDeg > 3).sort((a, b) => b.correctionDeg - a.correctionDeg)) {
    console.log(`  ${c.correctionDeg.toFixed(2)} deg at (${c.at.x}, ${c.at.y})`);
  }

  const beforeById = new Map(before.edges.map((e) => [e.id, e.pts.map((p) => v(p.x, p.y))]));
  let maxDev = 0;
  let maxDevEdge = '';
  let maxDLen = 0;
  let maxDLenEdge = '';
  let maxStep = 0;
  let maxStepEdge = '';
  let totalBefore = 0;
  let totalAfter = 0;
  let planBefore = 0;
  let planAfter = 0;
  for (const e of after.edges) {
    const old = beforeById.get(e.id) as Vec2[];
    const now = e.pts.map((p) => v(p.x, p.y));
    const dev = Math.max(...now.map((p) => distToPolyline(p, old))) * mm;
    const dLen = (polylineLength(now) - polylineLength(old)) * mm;
    const step = maxTurnDeg(now);
    if (dev > maxDev) { maxDev = dev; maxDevEdge = e.id; }
    if (Math.abs(dLen) > Math.abs(maxDLen)) { maxDLen = dLen; maxDLenEdge = e.id; }
    if (step > maxStep) { maxStep = step; maxStepEdge = e.id; }
    totalBefore += polylineLength(old) * mm;
    totalAfter += polylineLength(now) * mm;
    planBefore = Math.max(planBefore, ...old.map((p) => distToPlan(p, primitives)) as number[]);
    planAfter = Math.max(planAfter, ...now.map((p) => distToPlan(p, primitives)) as number[]);
  }
  // plain-node joins: the cross-edge kinks the defect is about
  const incident = new Map<string, string[]>(before.nodes.map((n) => [n.id, []]));
  for (const e of before.edges) {
    incident.get(e.from)?.push(e.id);
    incident.get(e.to)?.push(e.id);
  }
  const joinAngles = (plan: TrackplanFile): Array<{ nodeId: string; deg: number }> => {
    const byId = new Map(plan.edges.map((e) => [e.id, e]));
    const rows: Array<{ nodeId: string; deg: number }> = [];
    for (const n of plan.nodes) {
      if (n.kind !== 'plain') continue;
      const inc = incident.get(n.id) ?? [];
      if (inc.length !== 2) continue;
      const leave = (id: string): Vec2 => {
        const e = byId.get(id) as { from: string; pts: Vec2[] };
        const p = e.pts;
        return e.from === n.id
          ? unit(sub(p[1] as Vec2, p[0] as Vec2))
          : unit(sub(p[p.length - 2] as Vec2, p[p.length - 1] as Vec2));
      };
      const a = leave(inc[0] as string);
      const b = leave(inc[1] as string);
      rows.push({ nodeId: n.id, deg: 180 - angleBetweenDeg(a, b) });
    }
    return rows.sort((x, y) => y.deg - x.deg);
  };
  const jb = joinAngles(before);
  const ja = joinAngles(after);
  const fmt = (rows: Array<{ nodeId: string; deg: number }>): string =>
    rows.slice(0, 6).map((r) => `${r.nodeId} ${r.deg.toFixed(2)}`).join(', ');
  console.log(`plain-node joins before: ${fmt(jb)} | > 3 deg: ${jb.filter((r) => r.deg > 3).length}/${jb.length}`);
  console.log(`plain-node joins after : ${fmt(ja)} | > 3 deg: ${ja.filter((r) => r.deg > 3).length}/${ja.length}`);

  // tightest curvature: three consecutive vertices -> circumscribed radius
  let minRadiusMm = Number.POSITIVE_INFINITY;
  let minRadiusEdge = '';
  for (const e of after.edges) {
    const p = e.pts;
    for (let i = 2; i < p.length; i += 1) {
      const a = p[i - 2] as Vec2;
      const b = p[i - 1] as Vec2;
      const c = p[i] as Vec2;
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area2 < 1e-12) continue;
      const r = (len(sub(b, a)) * len(sub(c, b)) * len(sub(c, a))) / (2 * area2) * mm;
      if (r < minRadiusMm) { minRadiusMm = r; minRadiusEdge = e.id; }
    }
  }
  console.log(`tightest curvature radius ${minRadiusMm.toFixed(1)} mm (${minRadiusEdge})`);
  console.log(`max centreline deviation ${maxDev.toFixed(2)} mm (${maxDevEdge})`);
  console.log(`max per-edge arc-length change ${maxDLen.toFixed(2)} mm (${maxDLenEdge})`);
  console.log(`max heading step ${maxStep.toFixed(2)} deg (${maxStepEdge})`);
  console.log(`network ${totalBefore.toFixed(1)} -> ${totalAfter.toFixed(1)} mm `
    + `(${(totalAfter - totalBefore).toFixed(1)} mm, ${(((totalAfter - totalBefore) / totalBefore) * 100).toFixed(4)} %)`);
  console.log(`max distance from the Gleisplan ${(planBefore * mm).toFixed(1)} -> ${(planAfter * mm).toFixed(1)} mm`);

  if (proc.argv.includes('--write')) {
    writeFileSync(planFile, `${JSON.stringify(after, null, 2)}\n`, 'utf8');
    console.log(`smooth-trackplan: wrote ${planFile}`);
  } else {
    console.log('smooth-trackplan: dry run (pass --write to rewrite src/data/trackplan.json)');
  }
}

const isMain = proc.argv[1] !== undefined
  && /smooth-trackplan\.(ts|js|mts|mjs)$/.test(proc.argv[1].replace(/\\/g, '/'));
if (isMain) main();
