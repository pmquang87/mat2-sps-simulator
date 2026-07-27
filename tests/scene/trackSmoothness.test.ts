/**
 * tests/scene/trackSmoothness.test.ts — the consumer-side half of the D9 contract.
 *
 * D9 was fixed as a pure data transform for one reason: `edges[].pts` has TWO independent
 * consumers — `src/plant/geometry.ts` (`Polyline`, which drives the train and the reed trigger
 * positions) and `src/scene/trackMesh.ts` (`buildEdgeCurves`, which draws the rails). Smoothing
 * either one alone would float the train beside its own track. These tests pin that property
 * from the consumer side, so a future "let's smooth it in the renderer instead" cannot pass
 * silently, and they check the two things the rails themselves need: no visible faceting, and
 * a curvature radius wide enough that the swept ballast ribbon cannot fold over itself.
 */
import { describe, expect, it } from 'vitest';
import { Polyline } from '../../src/plant';
import type { TrackplanFile, Vec2 } from '../../src/plant';
import {
  DIM,
  PlanFrame,
  buildEdgeCurves,
  poseAtOffsetMm,
  yawOfTangent,
} from '../../src/scene';
import trackplanJson from '../../src/data/trackplan.json';

const plan = trackplanJson as unknown as TrackplanFile;
const frame = PlanFrame.fromTrackplan(plan);
const curves = buildEdgeCurves(plan, frame);
const MM_PER_UNIT = plan.meta.mmPerUnit;

/** The user's three circled areas, by edge id (see tests/data/trackSmoothness.test.ts). */
const CIRCLED: Record<string, readonly string[]> = {
  'west corner (Gleise A/B round the top left)':
    ['e16', 'e17', 'e26', 'e28', 'e96', 'e29', 'e12', 'e18', 'e25', 'e27', 'e97', 'e30'],
  'mid-left curve group': ['e44', 'e88', 'e87', 'e19'],
  'Gleis-K reversing loop meeting the outer curves': ['e12', 'e14', 'e16', 'e46', 'e53', 'e54'],
};

function wrapDeg(rad: number): number {
  let d = rad;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs((d * 180) / Math.PI);
}

describe('plant and scene read the SAME geometry out of edges[].pts', () => {
  it('every edge has identical arc length in both consumers', () => {
    for (const e of plan.edges) {
      const poly = new Polyline(e.pts, MM_PER_UNIT);
      const curve = curves.get(e.id);
      expect(curve, `${e.id} has a scene curve`).toBeDefined();
      // world metres → mm round trip, so 1e-6 mm is float noise, not a modelling difference
      expect(curve!.lengthMm).toBeCloseTo(poly.lengthMm, 6);
    }
  });

  it('sampling an edge at the same offsetMm lands on the same plan point in both', () => {
    let worstMm = 0;
    for (const e of plan.edges) {
      const poly = new Polyline(e.pts, MM_PER_UNIT);
      const curve = curves.get(e.id)!;
      for (let i = 0; i <= 40; i += 1) {
        const off = (poly.lengthMm * i) / 40;
        const a = poly.pointAtMm(off);
        const w = poseAtOffsetMm(curve, off).position;
        const b: Vec2 = { x: frame.planX(w.x), y: frame.planY(w.z) };
        worstMm = Math.max(worstMm, Math.hypot(a.x - b.x, a.y - b.y) * MM_PER_UNIT);
      }
    }
    // the train's rendered position vs the plant's own idea of it: micrometres, not millimetres
    expect(worstMm).toBeLessThan(1e-6);
  });
});

/**
 * Measured minimum centreline radius (mm) of the rendered curve inside each circled area. These
 * are pins on the SHIPPED data, not physical bounds: the previous cut of this suite only asserted
 * the ballast-fold bound (45 mm), which the pre-D9 data already satisfied — so the three area
 * tests could not have caught a regression. Both bounds are asserted now.
 */
const AREA_MIN_RADIUS_MM: Record<string, number> = {
  'west corner (Gleise A/B round the top left)': 100, // measured 107.2 on `e28`
  'mid-left curve group': 300, // measured 340.3 on `e44`
  'Gleis-K reversing loop meeting the outer curves': 110, // measured 116.9 on `e46`
};

describe('the rails the renderer builds are smooth (D9)', () => {
  it('consecutive sleepers never imply a curve tighter than 80 mm', () => {
    // What the eye actually reads as a "corner" is the yaw step between two adjacent sleepers,
    // 6.5 mm apart — i.e. the curvature radius spacing/dθ. Measured worst case: 4.21° on `e28`
    // = 88.4 mm radius. Before D9: 20.5° on `e81` = 18 mm and 11.1° on `e12` = 34 mm. The first
    // cut of D9 left 5.25° = 71 mm here, because it averaged the chords at the rebuilt west knots
    // instead of taking their tangent from the plan; 80 mm bites on both of those.
    const offenders: Array<{ id: string; radiusMm: number }> = [];
    for (const e of plan.edges) {
      const curve = curves.get(e.id)!;
      let prev: number | null = null;
      let worstRad = 0;
      for (let s = 0; s <= curve.lengthMm; s += DIM.sleeperSpacing) {
        const yaw = yawOfTangent(poseAtOffsetMm(curve, s).tangent);
        if (prev !== null) worstRad = Math.max(worstRad, (wrapDeg(yaw - prev) * Math.PI) / 180);
        prev = yaw;
      }
      const radiusMm = worstRad > 0 ? DIM.sleeperSpacing / worstRad : Number.POSITIVE_INFINITY;
      if (radiusMm < 80) offenders.push({ id: e.id, radiusMm });
    }
    expect(offenders).toEqual([]);
  });

  for (const [label, edges] of Object.entries(CIRCLED)) {
    it(`${label}: the swept ballast ribbon cannot fold, and stays at its measured radius`, () => {
      for (const id of edges) {
        const curve = curves.get(id)!;
        const p = curve.points;
        let minR = Number.POSITIVE_INFINITY;
        for (let i = 2; i < p.length; i += 1) {
          const a = p[i - 2]!;
          const b = p[i - 1]!;
          const c = p[i]!;
          const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
          if (area2 < 1e-18) continue;
          const r = (a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c)) / (2 * area2) / 0.001;
          minR = Math.min(minR, r);
        }
        // A swept ribbon self-intersects once the centreline radius drops below its half width
        // (15 mm), and looks pinched well before that. Verified to bite: an intermediate
        // smoothing variant that interpolated the contradictory samples instead of rebuilding
        // the run left a 29.9 mm radius on `e26`, which fails this bound.
        expect(minR, `${id} radius vs ballast half width`)
          .toBeGreaterThan(3 * DIM.ballastHalfWidth);
        // ...and the pin that actually discriminates the shipped geometry from its predecessors
        expect(minR, `${id} radius vs the measured area floor`)
          .toBeGreaterThanOrEqual(AREA_MIN_RADIUS_MM[label] as number);
      }
    });
  }
});
