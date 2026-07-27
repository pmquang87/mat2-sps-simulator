/**
 * Reed contact markers (ARCHITECTURE.md §3 `scene/reedMesh.ts`).
 *
 * Reference `docs/research/frames/reedkontakt_scaled.png`: a small glass tube lying between
 * the sleepers, its gold wires bent into two holes in the sleeper bed, and a white sticker
 * with the variable name (`xR02BH1G1`) on the ballast next to the track.
 *
 * Visual states come straight from `ReedState` (§5.3): `closed` = the loco magnet is inside
 * the window right now (bright flash), `latched` = it closed at least once since the PLC
 * last consumed it (dim glow — this is exactly the "a scan never misses a crossing"
 * behaviour students have to reason about). Unwired reed positions (only 23 of 43 have an
 * E input) get a grey tube and a grey plate so it is obvious they cannot be queried.
 */
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { ReedSpec, ReedState, TrackplanFile } from '../plant';
import { DIM, PALETTE, type SceneMaterials } from './materials';
import { LabelFactory, placePlate } from './labels';
import {
  MM,
  lateralOf,
  poseAtOffsetMm,
  yawOfTangent,
  type EdgeCurve,
} from './trackMesh';

export interface ReedVisual {
  readonly id: string;
  readonly object: Object3D;
  readonly position: Vector3;
  readonly wired: boolean;
  update(state: ReedState): void;
  setHighlight(on: boolean): void;
  dispose(): void;
}

class ReedVisualImpl implements ReedVisual {
  readonly id: string;
  readonly object: Group;
  readonly position: Vector3;
  readonly wired: boolean;

  private readonly glass: MeshStandardMaterial;
  private readonly ring: Mesh | null;
  private lastKey = '';

  constructor(args: {
    id: string;
    group: Group;
    position: Vector3;
    wired: boolean;
    glass: MeshStandardMaterial;
    ring: Mesh | null;
  }) {
    this.id = args.id;
    this.object = args.group;
    this.position = args.position;
    this.wired = args.wired;
    this.glass = args.glass;
    this.ring = args.ring;
  }

  update(state: ReedState): void {
    const key = `${state.closed ? 1 : 0}${state.latched ? 1 : 0}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (!this.wired) {
      this.glass.emissiveIntensity = 0;
      return;
    }
    // closed → bright flash, latched-but-open → dim afterglow, idle → dark
    this.glass.emissiveIntensity = state.closed ? 2.2 : state.latched ? 0.55 : 0;
  }

  setHighlight(on: boolean): void {
    if (this.ring) this.ring.visible = on;
  }

  dispose(): void {
    this.glass.dispose();
  }
}

/** Builds one visual per reed in trackplan order (positions come from the edge curves). */
export function buildReedVisuals(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  mats: SceneMaterials,
  labels: LabelFactory,
): Map<string, ReedVisual> {
  const out = new Map<string, ReedVisual>();
  for (const spec of tp.reeds) {
    const curve = curves.get(spec.edgeId);
    if (!curve) continue;
    out.set(spec.id, buildOne(spec, curve, mats, labels));
  }
  return out;
}

function buildOne(
  spec: ReedSpec,
  curve: EdgeCurve,
  mats: SceneMaterials,
  labels: LabelFactory,
): ReedVisual {
  const group = new Group();
  group.name = `reed:${spec.id}`;
  const pose = poseAtOffsetMm(curve, spec.offsetMm);
  const lat = lateralOf(pose.tangent);
  const yaw = yawOfTangent(pose.tangent);
  const wired = spec.wired;

  const glass = mats.reedGlass.clone();
  if (!wired) {
    glass.color.setHex(PALETTE.labelPlateGrey);
    glass.emissiveIntensity = 0;
  }
  const tube = new Mesh(
    new CylinderGeometry(DIM.reedTubeRadius * MM, DIM.reedTubeRadius * MM, DIM.reedTubeLength * MM, 10),
    glass,
  );
  tube.name = `reedtube:${spec.id}`;
  // cylinder axis is +y by default → lay it along the track
  tube.rotation.order = 'YZX';
  tube.rotation.y = yaw;
  tube.rotation.z = Math.PI / 2;
  tube.position
    .copy(pose.position)
    .setY((DIM.ballastHeight + DIM.sleeperHeight + DIM.reedTubeRadius) * MM);
  group.add(tube);

  // gold wires bent into the sleeper bed at both ends
  const wireGeom = new TorusGeometry(2.4 * MM, 0.28 * MM, 6, 10, Math.PI * 0.9);
  for (const sign of [1, -1]) {
    const wire = new Mesh(wireGeom, mats.reedWire);
    wire.rotation.order = 'YZX';
    wire.rotation.y = yaw;
    wire.rotation.z = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    wire.position
      .copy(pose.position)
      .addScaledVector(pose.tangent, sign * (DIM.reedTubeLength / 2 + 1.2) * MM)
      .setY((DIM.ballastHeight + DIM.sleeperHeight + 1.2) * MM);
    group.add(wire);
  }

  const plate = labels.createPlate(spec.id, { grey: !wired });
  placePlate(
    plate,
    pose.position,
    pose.tangent,
    lat,
    DIM.labelOffset,
    DIM.ballastHeight + DIM.labelPlateThickness,
  );
  group.add(plate);

  const ring = new Mesh(new RingGeometry(16 * MM, 21 * MM, 24), mats.highlight);
  ring.name = `highlight:${spec.id}`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pose.position).setY(0.7 * MM);
  ring.visible = false;
  group.add(ring);

  return new ReedVisualImpl({
    id: spec.id,
    group,
    position: pose.position.clone(),
    wired,
    glass,
    ring,
  });
}
