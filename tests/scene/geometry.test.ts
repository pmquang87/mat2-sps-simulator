/**
 * scene/ geometry contract: plan → world transform and the arc-length parametrisation the
 * scene shares with the plant (ARCHITECTURE.md §6.3 — a reed at `offsetMm` must render
 * exactly where the plant places it).
 */
import { describe, expect, it } from 'vitest';
import {
  MM,
  MeshAccum,
  PlanFrame,
  buildEdgeCurves,
  directionAtNode,
  lateralOf,
  meshYawFromPlanHeading,
  planBounds,
  planHeadingToWorld,
  platformProfile,
  poseAtOffsetMm,
  yawOfTangent,
} from '../../src/scene';
import { straightPlan } from './fixture';

describe('planBounds / PlanFrame', () => {
  it('spans nodes, edge vertices and landscape extents', () => {
    const tp = straightPlan();
    const b = planBounds(tp);
    expect(b.minX).toBe(0);
    expect(b.maxX).toBe(200);
    expect(b.minY).toBe(-100);
    expect(b.maxY).toBe(100);
  });

  it('maps the plan centre to the world origin and plan +y to world +z', () => {
    const tp = straightPlan();
    const frame = PlanFrame.fromTrackplan(tp);
    expect(frame.centre).toEqual({ x: 100, y: 0 });
    const origin = frame.v({ x: 100, y: 0 });
    expect(origin.x).toBeCloseTo(0, 12);
    expect(origin.z).toBeCloseTo(0, 12);
    // mmPerUnit = 2 → 1 plan unit = 2 mm = 0.002 world units
    expect(frame.v({ x: 200, y: 0 }).x).toBeCloseTo(0.2, 12);
    expect(frame.v({ x: 100, y: 50 }).z).toBeCloseTo(0.1, 12);
    expect(frame.widthM).toBeCloseTo(0.4, 12);
    expect(frame.depthM).toBeCloseTo(0.4, 12);
  });

  it('reports heights in millimetres', () => {
    const frame = PlanFrame.fromTrackplan(straightPlan());
    expect(frame.v({ x: 100, y: 0 }, 5).y).toBeCloseTo(5 * MM, 12);
  });
});

describe('buildEdgeCurves', () => {
  it('converts polyline length to millimetres via mmPerUnit', () => {
    const tp = straightPlan();
    const frame = PlanFrame.fromTrackplan(tp);
    const curves = buildEdgeCurves(tp, frame);
    expect(curves.get('e1')?.lengthMm).toBeCloseTo(200, 6); // 100 units × 2 mm
    expect(curves.get('e2')?.lengthMm).toBeCloseTo(400, 6); // 200 units × 2 mm
  });

  it('carries node ids and the tunnel flag', () => {
    const tp = straightPlan();
    tp.edges[1] = { ...(tp.edges[1] as (typeof tp.edges)[number]), tunnel: true };
    const curves = buildEdgeCurves(tp, PlanFrame.fromTrackplan(tp));
    const e2 = curves.get('e2');
    expect(e2?.fromNode).toBe('n2');
    expect(e2?.toNode).toBe('n3');
    expect(e2?.tunnel).toBe(true);
    expect(curves.get('e1')?.tunnel).toBe(false);
  });
});

describe('poseAtOffsetMm', () => {
  const tp = straightPlan();
  const frame = PlanFrame.fromTrackplan(tp);
  const curves = buildEdgeCurves(tp, frame);

  it('interpolates along the first segment', () => {
    const e1 = curves.get('e1');
    expect(e1).toBeDefined();
    if (!e1) return;
    const pose = poseAtOffsetMm(e1, 100); // half of 200 mm
    expect(pose.position.x).toBeCloseTo(frame.v({ x: 50, y: 0 }).x, 9);
    expect(pose.position.z).toBeCloseTo(frame.v({ x: 50, y: 0 }).z, 9);
    expect(pose.tangent.x).toBeCloseTo(1, 9);
    expect(pose.tangent.z).toBeCloseTo(0, 9);
  });

  it('walks past a polyline vertex and returns the second segment tangent', () => {
    const e2 = curves.get('e2');
    expect(e2).toBeDefined();
    if (!e2) return;
    const pose = poseAtOffsetMm(e2, 300); // 200 mm along +x, then 100 mm along +y
    expect(pose.position.x).toBeCloseTo(frame.v({ x: 200, y: 50 }).x, 9);
    expect(pose.position.z).toBeCloseTo(frame.v({ x: 200, y: 50 }).z, 9);
    expect(pose.tangent.z).toBeCloseTo(1, 9);
  });

  it('clamps offsets outside the edge', () => {
    const e1 = curves.get('e1');
    if (!e1) return;
    expect(poseAtOffsetMm(e1, -50).position.x).toBeCloseTo(frame.v({ x: 0, y: 0 }).x, 9);
    expect(poseAtOffsetMm(e1, 9999).position.x).toBeCloseTo(frame.v({ x: 100, y: 0 }).x, 9);
  });
});

describe('directionAtNode', () => {
  const tp = straightPlan();
  const curves = buildEdgeCurves(tp, PlanFrame.fromTrackplan(tp));

  it('points away from the node at both ends', () => {
    const e1 = curves.get('e1');
    if (!e1) return;
    const atStart = directionAtNode(e1, 'n1');
    const atEnd = directionAtNode(e1, 'n2');
    expect(atStart?.x).toBeCloseTo(1, 9);
    expect(atEnd?.x).toBeCloseTo(-1, 9);
  });

  it('returns null for a node the edge does not touch', () => {
    const e1 = curves.get('e1');
    if (!e1) return;
    expect(directionAtNode(e1, 'n3')).toBeNull();
  });
});

describe('orientation helpers', () => {
  it('lateral is perpendicular to the tangent and horizontal', () => {
    const t = planHeadingToWorld(0.7);
    const l = lateralOf(t);
    expect(t.dot(l)).toBeCloseTo(0, 12);
    expect(l.y).toBeCloseTo(0, 12);
    expect(l.length()).toBeCloseTo(1, 12);
  });

  it('mesh yaw of a plan heading matches the yaw of the same world tangent', () => {
    for (const heading of [0, 0.4, 1.9, -2.6, Math.PI]) {
      const yawA = meshYawFromPlanHeading(heading);
      const yawB = yawOfTangent(planHeadingToWorld(heading));
      expect(Math.cos(yawA)).toBeCloseTo(Math.cos(yawB), 9);
      expect(Math.sin(yawA)).toBeCloseTo(Math.sin(yawB), 9);
    }
  });
});

describe('MeshAccum.sweep', () => {
  it('produces (n-1)·(m-1)·2 triangles with upward-facing top normals', () => {
    const tp = straightPlan();
    const frame = PlanFrame.fromTrackplan(tp);
    const curve = buildEdgeCurves(tp, frame).get('e1');
    if (!curve) return;
    const accum = new MeshAccum();
    accum.sweep(curve.points, [
      { u: -10, v: 0 },
      { u: 10, v: 0 },
    ]);
    expect(accum.triangleCount).toBe(2);
    const geom = accum.toGeometry();
    const normal = geom.getAttribute('normal');
    expect(normal.getY(0)).toBeCloseTo(1, 6);
    geom.dispose();
  });

  it('platform profiles mirror across the track', () => {
    const right = platformProfile(1);
    const left = platformProfile(-1);
    const maxRight = Math.max(...right.map((p) => p.u));
    const minLeft = Math.min(...left.map((p) => p.u));
    expect(maxRight).toBeGreaterThan(0);
    expect(minLeft).toBeLessThan(0);
    expect(maxRight).toBeCloseTo(-minLeft, 9);
  });
});
