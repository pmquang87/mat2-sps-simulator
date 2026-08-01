/**
 * Fixtures for the pump-scene tests.
 *
 * Snapshots come from the REAL `PumpPlant` (never hand-written object literals): the scene's
 * job is to draw what the plant reports, and a fabricated snapshot could describe a state
 * the plant can never produce — a passing test would then say nothing.
 */
import { Box3, Object3D, Vector3 } from 'three';
import { PumpPlant } from '../../../src/pump';
import type { PumpParams, PumpSnapshot } from '../../../src/pump';

export interface PlantSetup {
  /** Level of tank A at t = 0, %. */
  volA?: number;
  /** Level of tank B at t = 0, %. */
  volB?: number;
  params?: Partial<PumpParams>;
}

/** A plant parked at the given levels, t = 0, everything else idle. */
export function plantAt(setup: PlantSetup = {}): PumpPlant {
  const params: Partial<PumpParams> = { ...setup.params };
  if (setup.volA !== undefined) params.initialVolAPct = setup.volA;
  if (setup.volB !== undefined) params.initialVolBPct = setup.volB;
  return new PumpPlant({ params });
}

export function snapshotAt(setup: PlantSetup = {}): PumpSnapshot {
  return plantAt(setup).snapshot();
}

/** Runs the pump for `steps` × 10 ms so the snapshot carries a real transfer flow. */
export function pumpingSnapshot(setup: PlantSetup = {}, steps = 1): PumpSnapshot {
  const plant = plantAt(setup);
  plant.setActuator('pump', true);
  for (let i = 0; i < steps; i += 1) plant.step(10);
  return plant.snapshot();
}

/** World-space height of an object's geometry, metres (0 for an empty/degenerate one). */
export function worldHeight(object: Object3D): number {
  const box = new Box3().setFromObject(object);
  return box.isEmpty() ? 0 : box.max.y - box.min.y;
}

/** World-space bounding box of an object. */
export function worldBox(object: Object3D): Box3 {
  return new Box3().setFromObject(object);
}

export function worldPosition(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(object.matrixWorld);
}

/** Named object or a failing lookup — a silent `undefined` would make a test vacuous. */
export function requireObject(root: Object3D, name: string): Object3D {
  const found = root.getObjectByName(name);
  if (!found) throw new Error(`scene graph has no object named "${name}"`);
  return found;
}

/**
 * Flattened world matrices of the whole graph, in traversal order, tagged with the object
 * name. Two graphs agree iff every element agrees — the determinism metric.
 */
export function worldMatrixDigest(root: Object3D): string[] {
  root.updateWorldMatrix(true, true);
  const out: string[] = [];
  root.traverse((o) => {
    const m = o.matrixWorld.elements;
    const cells = Array.from(m, (v) => (Object.is(v, -0) ? 0 : v).toExponential(12));
    out.push(`${o.name}|${o.visible ? 1 : 0}|${cells.join(',')}`);
  });
  return out;
}
