/**
 * The pump scene's camera rig. It is hand-written (not `OrbitControls`) because the same
 * pointer stream has to serve picking, so its clamps and its framing are this project's
 * responsibility and are pinned here.
 *
 * The framing check is geometric and independent of `fit()`'s own arithmetic: the whole
 * plant sphere is projected through the resulting camera and has to land inside the
 * frustum, for a wide pane and for a tall narrow one.
 */
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { PUMP_ORBIT_LIMITS, PUMP_PLANT_RADIUS, PumpOrbit } from '../../../src/pump/scene';

function rig(aspect = 16 / 9): { orbit: PumpOrbit; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(42, aspect, 0.05, 40);
  return { orbit: new PumpOrbit(camera), camera };
}

/** True when a sphere of `PUMP_PLANT_RADIUS` around the target is inside the frustum. */
function plantFits(camera: PerspectiveCamera, target: Vector3): boolean {
  const distance = camera.position.distanceTo(target);
  const vHalf = ((camera.fov * Math.PI) / 180) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const half = Math.min(vHalf, hHalf);
  return distance * Math.sin(half) >= PUMP_PLANT_RADIUS - 1e-9;
}

describe('PumpOrbit', () => {
  it('clamps the polar angle out of the floor and away from the pole', () => {
    const { orbit } = rig();
    for (let i = 0; i < 200; i += 1) orbit.rotate(0, 0.5);
    orbit.settle();
    expect(orbit.pose.polarRad).toBeCloseTo(PUMP_ORBIT_LIMITS.minPolarRad, 9);

    for (let i = 0; i < 400; i += 1) orbit.rotate(0, -0.5);
    orbit.settle();
    expect(orbit.pose.polarRad).toBeCloseTo(PUMP_ORBIT_LIMITS.maxPolarRad, 9);
  });

  it('keeps the camera above the floor at every reachable pose', () => {
    const { orbit, camera } = rig();
    for (const dy of [-0.4, 0.4]) {
      for (let i = 0; i < 60; i += 1) {
        orbit.rotate(0.2, dy);
        orbit.update();
        expect(camera.position.y).toBeGreaterThan(0);
      }
    }
  });

  it('clamps the zoom range in both directions', () => {
    const { orbit } = rig();
    for (let i = 0; i < 200; i += 1) orbit.zoom(-500);
    orbit.settle();
    expect(orbit.pose.distance).toBeCloseTo(PUMP_ORBIT_LIMITS.minDistance, 9);

    for (let i = 0; i < 400; i += 1) orbit.zoom(500);
    orbit.settle();
    expect(orbit.pose.distance).toBeCloseTo(PUMP_ORBIT_LIMITS.maxDistance, 9);
  });

  it('frames the whole plant for a wide AND for a tall narrow viewport', () => {
    for (const aspect of [16 / 9, 4 / 3, 0.65]) {
      const { orbit, camera } = rig(aspect);
      orbit.fit(aspect, camera.fov);
      expect(plantFits(camera, orbit.target), `aspect ${aspect} crops the plant`).toBe(true);
    }
  });

  it('detects a planted defect (control: the framing metric can fail)', () => {
    const { orbit, camera } = rig(0.65);
    orbit.fit(0.65, camera.fov);
    expect(plantFits(camera, orbit.target)).toBe(true);
    camera.position.lerp(orbit.target, 0.7);      // shove the camera in close
    expect(plantFits(camera, orbit.target)).toBe(false);
  });

  it('stops re-framing once the student has zoomed', () => {
    const { orbit, camera } = rig();
    orbit.fit(camera.aspect, camera.fov);
    const framed = orbit.pose.distance;
    orbit.zoom(-400);
    orbit.settle();
    const chosen = orbit.pose.distance;
    expect(chosen).toBeLessThan(framed);
    orbit.fit(0.5, camera.fov);                   // a resize must not undo the choice
    expect(orbit.pose.distance).toBeCloseTo(chosen, 9);
  });

  it('damps towards the goal instead of jumping', () => {
    const { orbit } = rig();
    orbit.fit(16 / 9, 42);
    const start = orbit.pose.azimuthRad;
    orbit.rotate(-0.5, 0);
    orbit.update();
    const afterOne = orbit.pose.azimuthRad;
    expect(afterOne).toBeGreaterThan(start);
    for (let i = 0; i < 200; i += 1) orbit.update();
    const settled = orbit.pose.azimuthRad;
    expect(afterOne).toBeLessThan(settled);       // one frame covered only part of the way
    expect(settled).toBeCloseTo(0.5 * 3.2, 6);    // ROTATE_SPEED × the drag
  });
});
