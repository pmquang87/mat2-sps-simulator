/**
 * Placement contract of the four fixed trackside cameras (`docs/REVIEW_SCENE.md` D1).
 *
 * A tripod that ends up inside — or on top of — a piece of scenery renders that scenery's own
 * hull over the lower part of the Trackside view. The mid-edge default position of tripod 2
 * did exactly that: it sat 16 mm from the centre of the BH1 station building and 36 mm above
 * its roof ridge, which filled the bottom third of the frame. The tests below pin the
 * clearance and, with a raycast, that the near track is actually visible from every tripod.
 */
import { describe, expect, it } from 'vitest';
import { Raycaster, Scene, Vector3 } from 'three';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import {
  LabelFactory,
  MM,
  PlanFrame,
  TRIPOD_CLEARANCE_MM,
  TRIPOD_HEIGHT_MM,
  buildEdgeCurves,
  buildLandscape,
  buildTerrain,
  buildTrackMeshes,
  createMaterials,
  footprintClearance,
  poseAtOffsetMm,
  sceneryFootprints,
  tracksideTripodPositions,
  type EdgeCurve,
} from '../../src/scene';
import { straightPlan } from './fixture';

const plan = trackplanJson as unknown as TrackplanFile;

/** Near plane of the trackside camera (cameras.ts) — nothing may sit closer. */
const TRACKSIDE_NEAR = 0.01;

function tripodsOf(tp: TrackplanFile): { frame: PlanFrame; tripods: Vector3[] } {
  const frame = PlanFrame.fromTrackplan(tp);
  return { frame, tripods: tracksideTripodPositions(frame, sceneryFootprints(tp, frame)) };
}

function nearestTrackPoint(
  at: Vector3,
  curves: ReadonlyMap<string, EdgeCurve>,
): { point: Vector3; distance: number } {
  let point = new Vector3();
  let distance = Number.POSITIVE_INFINITY;
  for (const curve of curves.values()) {
    for (let s = 0; s <= curve.lengthMm; s += 5) {
      const p = poseAtOffsetMm(curve, s).position;
      const d = Math.hypot(at.x - p.x, at.z - p.z);
      if (d < distance) {
        distance = d;
        point = p;
      }
    }
  }
  return { point, distance };
}

describe('trackside tripod placement', () => {
  it('gives four tripods on the bare board margin at lens height', () => {
    const { frame, tripods } = tripodsOf(plan);
    expect(tripods).toHaveLength(4);
    const halfW = frame.widthM / 2 + frame.units(26);
    const halfD = frame.depthM / 2 + frame.units(26);
    for (const t of tripods) {
      expect(t.y).toBeCloseTo(TRIPOD_HEIGHT_MM * MM, 9);
      expect(Math.abs(t.x)).toBeLessThanOrEqual(halfW);
      expect(Math.abs(t.z)).toBeLessThanOrEqual(halfD);
    }
  });

  it('never stands inside a mountain footprint, and always above ground', () => {
    const { frame, tripods } = tripodsOf(plan);
    const terrain = buildTerrain(plan, frame);
    const margin = TRIPOD_CLEARANCE_MM * MM;
    for (const t of tripods) {
      for (const m of plan.landscape.mountains) {
        const d = Math.hypot(t.x - frame.x(m.center.x), t.z - frame.z(m.center.y));
        expect(d).toBeGreaterThan(frame.units(m.radiusPt) + margin);
      }
      // above ground: the tripod stands on the bare margin, never on a slope
      expect(terrain.heightPt(frame.planX(t.x), frame.planY(t.z))).toBe(0);
      expect(t.y).toBeGreaterThan(terrain.heightAt(frame.planX(t.x), frame.planY(t.z)));
    }
  });

  it('keeps every scenery footprint clear of the lens and far behind the near plane', () => {
    const { frame, tripods } = tripodsOf(plan);
    const footprints = sceneryFootprints(plan, frame);
    expect(footprints.length).toBeGreaterThan(plan.landscape.buildings.length);
    for (const t of tripods) {
      const clearance = footprintClearance(t, footprints);
      expect(clearance).toBeGreaterThanOrEqual(TRIPOD_CLEARANCE_MM * MM);
      expect(clearance).toBeGreaterThan(TRACKSIDE_NEAR * 4);
    }
  });

  it('sees the near track unobstructed from every tripod', () => {
    const frame = PlanFrame.fromTrackplan(plan);
    const curves = buildEdgeCurves(plan, frame);
    const mats = createMaterials('high');
    const scene = new Scene();
    scene.add(
      buildLandscape({
        tp: plan,
        curves,
        frame,
        mats,
        labels: new LabelFactory('high'),
        quality: 'high',
      }).group,
    );
    scene.add(buildTrackMeshes(curves, mats, 'high').group);
    scene.updateMatrixWorld(true);

    const tripods = tracksideTripodPositions(frame, sceneryFootprints(plan, frame));
    const rc = new Raycaster();
    for (const t of tripods) {
      const near = nearestTrackPoint(t, curves);
      // the closest rail is on the neighbouring track, never across the plate
      expect(near.distance).toBeLessThan(0.2);
      const target = near.point.clone().setY(6 * MM);
      const dir = target.clone().sub(t).normalize();
      rc.set(t, dir);
      rc.near = TRACKSIDE_NEAR;
      rc.far = 60;
      const hit = rc.intersectObject(scene, true)[0];
      expect(hit).toBeDefined();
      // nothing between the lens and the rail head: the first hit is the track itself
      expect(hit?.distance ?? 0).toBeGreaterThan(t.distanceTo(target) - 8 * MM);
    }
  });

  it('slides a blocked tripod along its own board edge, and leaves the others', () => {
    const frame = PlanFrame.fromTrackplan(plan);
    const clean = tracksideTripodPositions(frame, []);
    const margin = frame.units(30);
    expect(clean[1]?.x).toBeCloseTo(frame.widthM / 2 + margin * 0.55, 9);

    // drop an obstacle exactly on the default position of tripod 1
    const blocker = { kind: 'building' as const, x: clean[1]!.x, z: clean[1]!.z, radius: 0.1 };
    const moved = tracksideTripodPositions(frame, [blocker]);
    expect(footprintClearance(moved[1]!, [blocker])).toBeGreaterThanOrEqual(
      TRIPOD_CLEARANCE_MM * MM,
    );
    // it slid along its own edge (constant x), the others did not move at all
    expect(moved[1]?.x).toBeCloseTo(clean[1]!.x, 9);
    expect(moved[1]?.z).not.toBeCloseTo(clean[1]!.z, 3);
    for (const i of [0, 2, 3]) {
      expect(moved[i]?.distanceTo(clean[i]!)).toBeCloseTo(0, 9);
    }
  });

  it('leaves a plan without scenery on the plain mid-edge positions', () => {
    const tp = straightPlan();
    const frame = PlanFrame.fromTrackplan(tp);
    const margin = frame.units(30);
    const tripods = tracksideTripodPositions(frame, []);
    expect(tripods[0]?.z).toBeCloseTo(-(frame.depthM / 2 + margin * 0.55), 9);
    expect(tripods[2]?.z).toBeCloseTo(frame.depthM / 2 + margin * 0.55, 9);
  });
});
