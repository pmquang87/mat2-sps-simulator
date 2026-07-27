/**
 * Switch (Weiche) visuals: point blades, throw bar, side motor, indication lamp and the
 * white variable-name plate (ARCHITECTURE.md §3 `scene/switchMesh.ts`).
 *
 * Reference: `docs/research/frames/einfach_01.png` / `doppel_01.png` — a bulky dark-grey
 * side motor next to the track and a white sticker (`xW02BH1G4`) on the ballast shoulder.
 *
 * Didactic core: the blade position must be readable at a glance, and it must *move* for
 * the 300 ms actuation the students program (`switchActuationMs`, Anleitung V.1). The blade
 * offset is therefore interpolated from `SwitchState.remainingMs` alone — the scene keeps no
 * clock of its own (§5.4: "animation driven by snapshot deltas").
 */
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { SwitchSpec, SwitchState, TrackplanFile, Vec2 } from '../plant';
import { DIM, PALETTE, type SceneMaterials, type SceneQuality } from './materials';
import { LabelFactory, placePlate } from './labels';
import {
  MM,
  directionAtNode,
  lateralOf,
  yawOfTangent,
  type EdgeCurve,
  type PlanFrame,
} from './trackMesh';

/**
 * Blade position as a continuous value between the two branch indices: `0` = branch 0
 * closed, `1` = branch 1 closed, in between = actuating. Pure function of the snapshot.
 */
export function switchBlend(state: SwitchState, actuationMs: number, alphaMs = 0): number {
  const from = state.position;
  if (!state.moving || state.movingToward === undefined) return from;
  const total = actuationMs > 0 ? actuationMs : 300;
  const remaining = Math.max(0, (state.remainingMs ?? total) - Math.max(0, alphaMs));
  const frac = Math.min(Math.max(1 - remaining / total, 0), 1);
  return from + (state.movingToward - from) * frac;
}

/** Which coil colour indicates a given branch index (`null` = non-commandable switch). */
export function coilColourOfBranch(
  spec: Pick<SwitchSpec, 'coilToBranch'>,
  branch: 0 | 1,
): 'G' | 'R' | null {
  const map = spec.coilToBranch;
  if (!map) return null;
  if (map.G === branch) return 'G';
  if (map.R === branch) return 'R';
  return null;
}

export interface SwitchVisual {
  readonly id: string;
  readonly object: Object3D;
  /** world position of the switch node — used by the trackside camera / UI picking */
  readonly nodePosition: Vector3;
  update(state: SwitchState, actuationMs: number, alphaMs: number): void;
  setHighlight(on: boolean): void;
  dispose(): void;
}

class SwitchVisualImpl implements SwitchVisual {
  readonly id: string;
  readonly object: Group;
  readonly nodePosition: Vector3;

  private readonly spec: SwitchSpec;
  private readonly mats: SceneMaterials;
  private readonly blades: Mesh[];
  private readonly bladeBase: Vector3[];
  private readonly bladeLateral: Vector3[];
  private readonly throwBar: Mesh | null;
  private readonly throwBase: Vector3;
  private readonly throwLateral: Vector3;
  private readonly lamp: Mesh | null;
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly ring: Mesh | null;
  private lastBlend = -1;

  constructor(args: {
    spec: SwitchSpec;
    mats: SceneMaterials;
    group: Group;
    nodePosition: Vector3;
    blades: Mesh[];
    bladeBase: Vector3[];
    bladeLateral: Vector3[];
    throwBar: Mesh | null;
    throwBase: Vector3;
    throwLateral: Vector3;
    lamp: Mesh | null;
    lampMaterial: MeshStandardMaterial;
    ring: Mesh | null;
  }) {
    this.id = args.spec.id;
    this.spec = args.spec;
    this.mats = args.mats;
    this.object = args.group;
    this.nodePosition = args.nodePosition;
    this.blades = args.blades;
    this.bladeBase = args.bladeBase;
    this.bladeLateral = args.bladeLateral;
    this.throwBar = args.throwBar;
    this.throwBase = args.throwBase;
    this.throwLateral = args.throwLateral;
    this.lamp = args.lamp;
    this.lampMaterial = args.lampMaterial;
    this.ring = args.ring;
  }

  update(state: SwitchState, actuationMs: number, alphaMs: number): void {
    const blend = switchBlend(state, actuationMs, alphaMs);
    if (blend !== this.lastBlend) {
      this.lastBlend = blend;
      const gap = DIM.switchThrow * MM;
      for (let i = 0; i < this.blades.length; i += 1) {
        const blade = this.blades[i];
        const base = this.bladeBase[i];
        const lat = this.bladeLateral[i];
        if (!blade || !base || !lat) continue;
        // blade 0 opens as the blend moves towards branch 1 and vice versa
        const open = i === 0 ? blend : 1 - blend;
        blade.position.copy(base).addScaledVector(lat, open * gap);
        blade.material = open < 0.5 ? this.mats.railActive : this.mats.railIdle;
      }
      if (this.throwBar) {
        this.throwBar.position
          .copy(this.throwBase)
          .addScaledVector(this.throwLateral, (blend - 0.5) * DIM.switchThrow * 2 * MM);
      }
    }
    this.updateLamp(state, blend);
  }

  private updateLamp(state: SwitchState, blend: number): void {
    if (!this.lamp) return;
    const map = this.spec.coilToBranch;
    if (!map) {
      this.lampMaterial.color.setHex(PALETTE.lampOff);
      this.lampMaterial.emissiveIntensity = 0;
      return;
    }
    const energised: 'G' | 'R' | null = state.coilG ? 'G' : state.coilR ? 'R' : null;
    const nearestBranch: 0 | 1 = blend < 0.5 ? 0 : 1;
    const indicated = energised ?? coilColourOfBranch(this.spec, nearestBranch);
    const hex = indicated === 'G' ? PALETTE.lampGreen : indicated === 'R' ? PALETTE.lampRed : PALETTE.lampOff;
    this.lampMaterial.color.setHex(hex);
    this.lampMaterial.emissive.setHex(hex);
    // bright while a coil is energised, dim while it only indicates the resting position
    this.lampMaterial.emissiveIntensity = energised ? 1.8 : state.moving ? 0.9 : 0.35;
  }

  setHighlight(on: boolean): void {
    if (this.ring) this.ring.visible = on;
  }

  dispose(): void {
    this.lampMaterial.dispose();
  }
}

/** Builds one visual per switch in trackplan order. */
export function buildSwitchVisuals(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
  mats: SceneMaterials,
  labels: LabelFactory,
  quality: SceneQuality = 'high',
): Map<string, SwitchVisual> {
  const nodes = new Map<string, Vec2>();
  for (const n of tp.nodes) nodes.set(n.id, n.pt);

  const out = new Map<string, SwitchVisual>();
  for (const spec of tp.switches) {
    const pt = nodes.get(spec.nodeId);
    if (!pt) continue;
    const visual = buildOne(spec, pt, curves, frame, mats, labels, quality);
    if (visual) out.set(spec.id, visual);
  }
  return out;
}

function buildOne(
  spec: SwitchSpec,
  nodePt: Vec2,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
  mats: SceneMaterials,
  labels: LabelFactory,
  quality: SceneQuality,
): SwitchVisual | null {
  const nodePos = frame.v(nodePt);
  const group = new Group();
  group.name = `switch:${spec.id}`;

  const branchDirs: Vector3[] = [];
  for (const edgeId of spec.branchEdgeIds) {
    const curve = curves.get(edgeId);
    const dir = curve ? directionAtNode(curve, spec.nodeId) : null;
    branchDirs.push(dir ?? new Vector3(1, 0, 0));
  }
  const toeCurve = curves.get(spec.toeEdgeId);
  const toeDir =
    (toeCurve ? directionAtNode(toeCurve, spec.nodeId) : null) ??
    branchDirs
      .reduce((acc, d) => acc.add(d), new Vector3())
      .negate()
      .setY(0)
      .normalize();

  // ── point blades: one thin tapered rail along each branch, converging at the node ──
  const blades: Mesh[] = [];
  const bladeBase: Vector3[] = [];
  const bladeLateral: Vector3[] = [];
  const bladeGeom = new BoxGeometry(
    DIM.switchBladeLength * MM,
    DIM.railHeight * MM,
    DIM.railWidth * 1.2 * MM,
  );
  for (let i = 0; i < 2; i += 1) {
    const dir = branchDirs[i];
    const other = branchDirs[1 - i];
    if (!dir || !other) continue;
    const lat = lateralOf(dir);
    // point the blade's opening movement towards the *other* branch
    const inward = other.clone().sub(dir).dot(lat) >= 0 ? 1 : -1;
    const blade = new Mesh(bladeGeom, mats.railIdle);
    blade.name = `blade:${spec.id}:${i}`;
    const base = nodePos
      .clone()
      .addScaledVector(dir, (DIM.switchBladeLength / 2 + 6) * MM)
      .addScaledVector(lat, inward * (DIM.gauge / 2 - 1.2) * MM);
    base.y = (DIM.ballastHeight + DIM.sleeperHeight + DIM.railHeight / 2) * MM;
    blade.position.copy(base);
    blade.rotation.y = yawOfTangent(dir);
    group.add(blade);
    blades.push(blade);
    bladeBase.push(base.clone());
    bladeLateral.push(lat.clone().multiplyScalar(inward));
  }

  // ── throw bar on the toe leg: slides sideways over the full actuation ──
  const throwLateral = lateralOf(toeDir);
  const throwBar = new Mesh(
    new BoxGeometry(1.6 * MM, 1.2 * MM, (DIM.gauge + 8) * MM),
    mats.switchMotor,
  );
  throwBar.name = `throwbar:${spec.id}`;
  const throwBase = nodePos
    .clone()
    .addScaledVector(toeDir, 14 * MM)
    .setY((DIM.ballastHeight + DIM.sleeperHeight + 0.6) * MM);
  throwBar.position.copy(throwBase);
  throwBar.rotation.y = yawOfTangent(toeDir);
  group.add(throwBar);

  // ── side motor with indication lamp ──
  const motorSide = pickMotorSide(toeDir, branchDirs);
  const motorPos = nodePos
    .clone()
    .addScaledVector(toeDir, 12 * MM)
    .addScaledVector(throwLateral, motorSide * DIM.switchMotorOffset * MM)
    .setY((DIM.switchMotorHeight / 2) * MM);
  const motor = new Mesh(
    new BoxGeometry(
      DIM.switchMotorLength * MM,
      DIM.switchMotorHeight * MM,
      DIM.switchMotorWidth * MM,
    ),
    mats.switchMotor,
  );
  motor.name = `motor:${spec.id}`;
  motor.position.copy(motorPos);
  motor.rotation.y = yawOfTangent(toeDir);
  motor.castShadow = quality === 'high';
  group.add(motor);

  const lampMaterial = mats.lampOff.clone();
  const lamp = new Mesh(new SphereGeometry(2.2 * MM, 10, 8), lampMaterial);
  lamp.name = `lamp:${spec.id}`;
  lamp.position
    .copy(motorPos)
    .addScaledVector(toeDir, (DIM.switchMotorLength / 2 - 4) * MM)
    .setY((DIM.switchMotorHeight + 1) * MM);
  group.add(lamp);

  // ── white label plate with the variable name (didactically central) ──
  const plate = labels.createPlate(spec.id, { grey: spec.coilToBranch === null });
  const platePos = nodePos.clone().addScaledVector(toeDir, 30 * MM);
  placePlate(
    plate,
    platePos,
    toeDir,
    throwLateral,
    motorSide * (DIM.switchMotorOffset + DIM.labelPlateWidth * DIM.labelScale * 0.7),
    DIM.ballastHeight + DIM.labelPlateThickness,
  );
  group.add(plate);

  // ── selection ring (hidden until highlighted) ──
  const ring = new Mesh(new RingGeometry(24 * MM, 30 * MM, 28), mats.highlight);
  ring.name = `highlight:${spec.id}`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(nodePos).setY(0.6 * MM);
  ring.visible = false;
  group.add(ring);

  return new SwitchVisualImpl({
    spec,
    mats,
    group,
    nodePosition: nodePos,
    blades,
    bladeBase,
    bladeLateral,
    throwBar,
    throwBase,
    throwLateral,
    lamp,
    lampMaterial,
    ring,
  });
}

/** Puts the motor on the side of the toe leg that the branches do *not* diverge into. */
function pickMotorSide(toeDir: Vector3, branchDirs: readonly Vector3[]): 1 | -1 {
  const lat = lateralOf(toeDir);
  let sum = 0;
  for (const d of branchDirs) sum += d.dot(lat);
  return sum > 0 ? -1 : 1;
}
