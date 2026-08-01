/**
 * Switch picking (docs/DESIGN_SCENE_EDITOR.md §14.3): headless raycast against the real
 * switch visuals — same pipeline as the SceneManager ctor minus the renderer (the
 * labelPlacement.test.ts pattern). Controls in both directions: a hit resolves to the
 * right id, empty scenery misses, a visible occluder in front blocks the pick, and the
 * SAME occluder made invisible stops blocking (invisible geometry — hidden highlight
 * rings, hidden tripods — must never eat clicks).
 */
import {
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  LabelFactory,
  PlanFrame,
  buildEdgeCurves,
  buildSwitchVisuals,
  createMaterials,
  pickSwitchIn,
  switchIdOfObject,
} from '../../src/scene';
import { straightPlan } from './fixture';

function buildPickScene(): { scene: Scene; target: Vector3 } {
  const plan = straightPlan();
  plan.switches = plan.switches.slice(0, 1);   // one switch — the pick is unambiguous
  const frame = PlanFrame.fromTrackplan(plan);
  const curves = buildEdgeCurves(plan, frame);
  const switches = buildSwitchVisuals(
    plan,
    curves,
    frame,
    createMaterials('low'),
    new LabelFactory('low'),
    'low',
  );
  const scene = new Scene();
  for (const v of switches.values()) scene.add(v.object);
  scene.updateMatrixWorld(true);

  // Aim at a solid, always-present part of the switch: its motor box.
  const motor = scene.getObjectByName('motor:xW01TEST');
  if (motor === undefined) throw new Error('fixture switch lost its motor mesh');
  const target = new Vector3();
  motor.getWorldPosition(target);
  return { scene, target };
}

function cameraOver(target: Vector3): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, 1, 0.001, 100);
  // Small lateral offset so lookAt straight down is never degenerate with the up vector.
  camera.position.set(target.x + 0.05, target.y + 0.6, target.z + 0.05);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('switch picking (§14.3)', () => {
  it('resolves a centre ray to the switch and a corner ray to a miss', () => {
    const { scene, target } = buildPickScene();
    const camera = cameraOver(target);
    expect(pickSwitchIn(scene, camera, { x: 0, y: 0 })).toBe('xW01TEST');
    // Control: the same scene and camera, but a ray into empty air.
    expect(pickSwitchIn(scene, camera, { x: 0.98, y: 0.98 })).toBeNull();
  });

  it('is blocked by a visible occluder but never by an invisible one', () => {
    const { scene, target } = buildPickScene();
    const camera = cameraOver(target);

    const occluder = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial());
    occluder.name = 'occluder';
    occluder.position.set(target.x, target.y + 0.3, target.z);
    occluder.rotateX(-Math.PI / 2);            // face up, between camera and switch
    scene.add(occluder);
    scene.updateMatrixWorld(true);

    expect(pickSwitchIn(scene, camera, { x: 0, y: 0 })).toBeNull();

    // The SAME ray with the SAME occluder, only invisible — must reach the switch again,
    // otherwise hidden highlight rings and tripod markers would eat clicks.
    occluder.visible = false;
    expect(pickSwitchIn(scene, camera, { x: 0, y: 0 })).toBe('xW01TEST');
  });

  it('switchIdOfObject walks child meshes up to the owning switch group', () => {
    const { scene } = buildPickScene();
    const motor = scene.getObjectByName('motor:xW01TEST');
    expect(motor).toBeDefined();
    expect(switchIdOfObject(motor ?? null)).toBe('xW01TEST');
    // Controls: an unparented stray object and null resolve to nothing.
    expect(switchIdOfObject(new Object3D())).toBeNull();
    expect(switchIdOfObject(null)).toBeNull();
  });
});
