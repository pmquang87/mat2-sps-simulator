/**
 * Consist placement (`docs/REVIEW_SCENE.md` D12, superseding D10).
 *
 * The renderer used to place coaches along a **path buffer** of the loco's past positions. That
 * model is wrong in two ways that both reached the user as screenshots:
 *
 *  - at spawn there is no history at all, so the buffer laid down a straight synthetic tail and
 *    the coaches left the rails on the first curve (measured: 60,9 mm off, the rear coach's
 *    nearest track a *different* edge);
 *  - during a push-back the coaches LEAD the loco onto whatever the switches are set to now,
 *    which the loco has never driven over. `feedPath`'s forward branch verified the recorded
 *    path against reality, the reverse branch did not, and the error grew without bound —
 *    481,7 mm by cycle 1431 of the Gruppe A run, with the consist stretched to 691 mm against a
 *    physical 422 mm.
 *
 * Vehicles are now placed by arc length on `PlantSnapshot.train.consistPath`, walked live
 * through the current switch positions by `TrackGraph.consistPath`. These tests pin the
 * properties that model is supposed to deliver, measured against the real trackplan: every
 * vehicle sits on a real centre line, the consist keeps its physical length, and it never turns
 * inside out when the train reverses.
 *
 * They are deliberately expressed as "distance from any track centre line" rather than as buffer
 * internals: that is the property the user can see, and it stays meaningful whatever the
 * placement model is. The last test is an anti-vacuity control — it proves the metric reports
 * large numbers when a vehicle really is off the rails.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import trackplanJson from '../../src/data/trackplan.json';
import type { PlantSnapshot, TrackplanFile } from '../../src/plant';
import { Plant } from '../../src/plant';
import {
  DIM,
  MM,
  PlanFrame,
  buildEdgeCurves,
  buildTrain,
  createMaterials,
  poseAtOffsetMm,
  type ConsistWorldPath,
} from '../../src/scene';

const plan = trackplanJson as unknown as TrackplanFile;

/**
 * Distance between the outermost vehicle CENTRES, mm — loco centre to rear-coach centre.
 * (The overall consist is 422 mm buffer to buffer; the centres span 292 mm of that.) On a curve
 * the straight-line distance is the chord, so it can only ever come out shorter, never longer.
 */
const CENTRE_SPAN_MM =
  DIM.locoLength / 2 + DIM.coupling + DIM.coachLength * 1.5 + DIM.coupling;

/**
 * Half the ballast width (9 pt ≈ 31 mm). A vehicle centre further than this from every centre
 * line is off the track bed, not merely riding wide on a curve.
 */
const ON_RAIL_TOL_MM = 25;

const frame = PlanFrame.fromTrackplan(plan);
const curves = buildEdgeCurves(plan, frame);

/** Every track centre line as one point cloud, so "distance to any rail" is a brute force. */
const cloud: Vector3[] = (() => {
  const out: Vector3[] = [];
  for (const c of curves.values()) {
    for (let s = 0; s <= c.lengthMm; s += 3) {
      out.push(poseAtOffsetMm(c, Math.min(s, c.lengthMm)).position);
    }
  }
  return out;
})();

function offRailMm(p: Vector3): number {
  let best = Number.POSITIVE_INFINITY;
  for (const q of cloud) {
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best) / MM;
}

function worldPath(snapshot: PlantSnapshot): ConsistWorldPath {
  const cp = snapshot.train.consistPath;
  return {
    startMm: cp.startMm,
    stepMm: cp.stepMm,
    pts: cp.pts.map((p) => new Vector3(frame.x(p.x), 0, frame.z(p.y))),
  };
}

interface RenderedFrame {
  centres: Vector3[];
  offRail: number[];
  spanMm: number;
}

/** Renders one snapshot and measures every vehicle against the real track. */
function renderFrame(
  visual: ReturnType<typeof buildTrain>,
  snapshot: PlantSnapshot,
): RenderedFrame {
  const t = snapshot.train;
  visual.update({
    position: new Vector3(frame.x(t.worldPos.x), 0, frame.z(t.worldPos.y)),
    headingRad: t.headingRad,
    speedMmS: t.speedMmS,
    alphaMs: 0,
    hidden: false,
    derailed: false,
    path: worldPath(snapshot),
  });
  const centres = visual.object.children.map((c) => {
    const p = c.position.clone();
    p.y -= DIM.railTop * MM;
    return p;
  });
  let spanMm = 0;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = i + 1; j < centres.length; j += 1) {
      spanMm = Math.max(spanMm, (centres[i] as Vector3).distanceTo(centres[j] as Vector3) / MM);
    }
  }
  return { centres, offRail: centres.map(offRailMm), spanMm };
}

/** Fahrstrom word for a level/direction, as `wordToTarget` reads it. */
function speedWord(level: 1 | 2 | 3, direction: 'IU' | 'GU'): number {
  return direction === 'IU' ? level : level | 0x0100;
}

function runToStop(plant: Plant): void {
  plant.setFahrstromWord(0);
  for (let i = 0; i < 600 && plant.snapshot().train.speedMmS > 0; i += 1) plant.step(10);
}

describe('consist placement on the real trackplan', () => {
  it('puts every vehicle on a real centre line at the start pose', () => {
    // D12a: the straight synthetic tail put coach 2 60,9 mm off, its nearest track a different
    // edge (e59). Nothing has moved yet, so this is purely "does spawn know where the track is".
    const plant = new Plant({ trackplan: plan });
    const visual = buildTrain(createMaterials('low'), 'low');
    const f = renderFrame(visual, plant.snapshot());

    expect(f.offRail).toHaveLength(3);
    for (const [i, d] of f.offRail.entries()) {
      expect(d, `vehicle ${i} off the centre line at t=0`).toBeLessThan(ON_RAIL_TOL_MM);
    }
    expect(f.spanMm).toBeGreaterThan(CENTRE_SPAN_MM - 40);
    expect(f.spanMm).toBeLessThan(CENTRE_SPAN_MM + 1);
  });

  it('keeps the consist on the rails through a push-back over a switch thrown behind it', () => {
    // D12b, reproduced WITHOUT the gitignored solution: drive forward over a switch, stop, throw
    // that switch to its other branch, then reverse. The reverse route now differs from the
    // recorded one — exactly what Gruppe A's Rangierfahrt does ("die Weichen … hinter der Lok
    // gestellt … und die Lok soll nun zurückstoßen").
    const plant = new Plant({ trackplan: plan });
    const visual = buildTrain(createMaterials('low'), 'low');

    // 1. forward until the train has crossed a switch node
    plant.setFahrstromWord(speedWord(2, 'IU'));
    const crossed: string[] = [];
    let prevEdge = plant.snapshot().train.edgeId;
    for (let i = 0; i < 4000 && crossed.length < 2; i += 1) {
      plant.step(10);
      plant.drainEvents();
      const now = plant.snapshot().train.edgeId;
      if (now !== prevEdge) {
        const a = plan.edges.find((e) => e.id === prevEdge);
        const b = plan.edges.find((e) => e.id === now);
        const shared = [a?.from, a?.to].find((n) => n === b?.from || n === b?.to);
        const sw = plan.switches.find((s) => s.nodeId === shared);
        if (sw) crossed.push(sw.id);
        prevEdge = now;
      }
    }
    expect(
      crossed.length,
      'the train must cross a switch for this test to mean anything',
    ).toBeGreaterThan(0);

    runToStop(plant);
    expect(plant.snapshot().train.speedMmS).toBe(0);

    // 2. throw the switch the train just crossed to its other branch
    const target = crossed[crossed.length - 1] as string;
    const before = plant.snapshot().switches.find((s) => s.id === target)?.position;
    const coil = before === 0 ? 'R' : 'G';
    plant.setSwitchCoil(target, coil, true);
    for (let i = 0; i < 200; i += 1) plant.step(10);
    plant.setSwitchCoil(target, coil, false);
    plant.drainEvents();
    const after = plant.snapshot().switches.find((s) => s.id === target)?.position;
    expect(after, `switch ${target} must actually have moved`).not.toBe(before);

    // 3. push back over it, measuring every frame
    plant.setFahrstromWord(speedWord(1, 'GU'));
    let checks = 0;
    let worstOffRail = 0;
    let worstSpan = 0;
    for (let i = 0; i < 2500; i += 1) {
      plant.step(10);
      plant.drainEvents();
      const f = renderFrame(visual, plant.snapshot());
      checks += 1;
      worstOffRail = Math.max(worstOffRail, ...f.offRail);
      worstSpan = Math.max(worstSpan, f.spanMm);
    }

    expect(checks, 'anti-vacuity: the reversal must actually have been sampled').toBeGreaterThan(
      2000,
    );
    expect(worstOffRail, 'a vehicle left the track bed during the push-back').toBeLessThan(
      ON_RAIL_TOL_MM,
    );
    // the old model stretched this to 691 mm against a true 292 mm
    expect(worstSpan, 'the consist stretched beyond its physical length').toBeLessThan(
      CENTRE_SPAN_MM + 1,
    );
  });

  it('never turns the consist inside out when the travel direction flips', () => {
    // The path is anchored to the direction of TRAVEL, but the coaches are coupled to the loco's
    // FACING, and the plant flips its travel sign on a stationary reversal. If the renderer took
    // the coaches' side from the travel sign they would jump through the loco on that frame.
    const plant = new Plant({ trackplan: plan });
    const visual = buildTrain(createMaterials('low'), 'low');

    plant.setFahrstromWord(speedWord(2, 'IU'));
    for (let i = 0; i < 900; i += 1) plant.step(10);
    runToStop(plant);

    let prev = renderFrame(visual, plant.snapshot()).centres;
    plant.setFahrstromWord(speedWord(1, 'GU'));
    let worstJump = 0;
    let sawReversal = false;
    for (let i = 0; i < 600; i += 1) {
      plant.step(10);
      const snapshot = plant.snapshot();
      if (snapshot.train.speedMmS > 0) sawReversal = true;
      const now = renderFrame(visual, snapshot).centres;
      for (let v = 0; v < now.length; v += 1) {
        worstJump = Math.max(worstJump, (now[v] as Vector3).distanceTo(prev[v] as Vector3) / MM);
      }
      prev = now;
    }

    expect(sawReversal, 'the train must actually reverse for this test to mean anything').toBe(
      true,
    );
    // a side swap would move a coach by 2 × its offset (274 mm / 584 mm); real motion in one
    // 10 ms step at level 1 is 0,8 mm
    expect(worstJump, 'a vehicle teleported — the consist flipped side').toBeLessThan(10);
  });

  it('reports large distances when a vehicle really is off the rails (anti-vacuity control)', () => {
    // Without this, "everything is under 25 mm" could equally mean the metric is broken.
    const plant = new Plant({ trackplan: plan });
    const visual = buildTrain(createMaterials('low'), 'low');
    const f = renderFrame(visual, plant.snapshot());
    const displaced = (f.centres[0] as Vector3).clone();
    displaced.x += 200 * MM;
    displaced.z += 200 * MM;
    expect(offRailMm(displaced)).toBeGreaterThan(100);
    expect(Math.max(...f.offRail)).toBeLessThan(ON_RAIL_TOL_MM);
  });
});
