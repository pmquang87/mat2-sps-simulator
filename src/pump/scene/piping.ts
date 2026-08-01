/**
 * Pipework, the pump itself, the two hand valves and everything that flows.
 *
 * Flow cues are tied to the flows the plant ACTUALLY realised in its last step
 * (`snapshot.flowPctS`), not to the actuator bit: a pump running against a full tank B
 * transfers nothing, and drawing a stream for it would teach that deadheading moves
 * product. Every cue therefore disappears in the same frame its flow reaches zero.
 */
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { LabelFactory } from '../../scene';
import type { PumpValveId } from '../types';
import { PUMP_DIM, valveBody } from './dims';
import { DisposeBag, type PumpSceneMaterials } from './materials';
import { makePumpPlate, signalPlateText } from './plates';
import { pumpPickName } from './picking';
import { buildFlowBeads, pipeCurve, type FlowBeadsVisual } from './water';

/** Beads per metre of pipe — dense enough to read as flow, cheap enough to keep. */
const BEADS_PER_METRE = 5;

/** Impeller revolutions per second at 1 %/s of transfer. */
const IMPELLER_REV_PER_PCT = 0.5;

export interface PipeRunVisual {
  readonly object: Group;
  readonly beads: FlowBeadsVisual;
  readonly lengthM: number;
}

/** A pipe run plus the beads that ride inside it. */
export function buildPipeRun(args: {
  name: string;
  points: readonly Vector3[];
  mats: PumpSceneMaterials;
  bag: DisposeBag;
}): PipeRunVisual {
  const group = new Group();
  group.name = args.name;
  const curve = pipeCurve(args.points);
  const lengthM = curve.getLength();
  const segments = Math.max(24, Math.round(lengthM * 40));
  const tube = new Mesh(
    args.bag.add(new TubeGeometry(curve, segments, PUMP_DIM.pipeRadius, 12, false)),
    args.mats.steel,
  );
  tube.name = `${args.name}:tube`;
  tube.castShadow = true;
  group.add(tube);

  // No corner flanges: a torus dropped unoriented at a bend slices through the tube at an
  // arbitrary angle (user report 2026-08-01) — decoration that reads as a defect is worse
  // than none, and orienting one on an elbow is ambiguous (two directions meet there).

  const beads = buildFlowBeads({
    name: `${args.name}:flow`,
    curve,
    count: Math.max(4, Math.round(lengthM * BEADS_PER_METRE)),
    radius: PUMP_DIM.pipeRadius * 0.55,
    material: args.mats.stream,
    bag: args.bag,
  });
  group.add(beads.object);

  return { object: group, beads, lengthM };
}

export interface PumpUnitVisual {
  readonly object: Group;
  /** Spins the impeller to `angleRad` and lights the dry-run probe. */
  update(angleRad: number, lsOn: boolean): void;
}

/**
 * The pump: a volute with a transparent front cover and a visible impeller, plus the
 * dry-run guard LS on its suction side (the sensor the Anleitung's `U E 0.5` reads).
 */
export function buildPumpUnit(args: {
  mats: PumpSceneMaterials;
  labels: LabelFactory;
  bag: DisposeBag;
  lsSymbol: string;
}): PumpUnitVisual {
  const { mats, bag } = args;
  const group = new Group();
  group.name = 'pump:unit';
  const centre = new Vector3(0, PUMP_DIM.pumpY, PUMP_DIM.tankZ);

  const base = new Mesh(
    bag.add(new BoxGeometry(0.26, PUMP_DIM.pumpStandTop, 0.22)),
    mats.steelDark,
  );
  base.name = 'pump:base';
  base.position.set(centre.x, PUMP_DIM.pumpStandTop / 2, centre.z);
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  const volute = new Mesh(
    bag.add(new CylinderGeometry(
      PUMP_DIM.pumpRadius,
      PUMP_DIM.pumpRadius,
      PUMP_DIM.pumpDepth,
      28,
      1,
      true,
    )),
    mats.pumpBody,
  );
  volute.name = 'pump:volute';
  volute.rotation.x = Math.PI / 2;           // barrel axis along z, mouth towards the viewer
  volute.position.copy(centre);
  volute.castShadow = true;
  group.add(volute);

  const backPlate = new Mesh(bag.add(new CircleGeometry(PUMP_DIM.pumpRadius, 28)), mats.pumpBody);
  backPlate.rotation.y = Math.PI;
  backPlate.position.set(centre.x, centre.y, centre.z - PUMP_DIM.pumpDepth / 2);
  group.add(backPlate);

  // Transparent cover — without it the impeller is invisible, which is the one thing the
  // pump has to show (it turns only while the plant is actually moving product).
  const cover = new Mesh(bag.add(new CircleGeometry(PUMP_DIM.pumpRadius, 28)), mats.glass);
  cover.name = 'pump:cover';
  cover.position.set(centre.x, centre.y, centre.z + PUMP_DIM.pumpDepth / 2 + 0.001);
  group.add(cover);

  const impeller = new Group();
  impeller.name = 'pump:impeller';
  impeller.position.set(centre.x, centre.y, centre.z + PUMP_DIM.pumpDepth / 2 - 0.02);
  const hub = new Mesh(bag.add(new CylinderGeometry(0.022, 0.022, 0.03, 12)), mats.steel);
  hub.rotation.x = Math.PI / 2;
  impeller.add(hub);
  const bladeGeom = bag.add(new BoxGeometry(PUMP_DIM.impellerRadius, 0.012, 0.026));
  for (let i = 0; i < PUMP_DIM.impellerBlades; i += 1) {
    const blade = new Mesh(bladeGeom, mats.steel);
    const a = (i / PUMP_DIM.impellerBlades) * Math.PI * 2;
    blade.position.set(
      (Math.cos(a) * PUMP_DIM.impellerRadius) / 2,
      (Math.sin(a) * PUMP_DIM.impellerRadius) / 2,
      0,
    );
    blade.rotation.z = a + 0.5;
    impeller.add(blade);
  }
  group.add(impeller);

  // ── dry-run guard LS ─────────────────────────────────────────────────────────────────
  const lsGroup = new Group();
  lsGroup.name = 'pump:probe:ls';
  lsGroup.position.set(centre.x - 0.02, centre.y + PUMP_DIM.pumpRadius + 0.03, centre.z + 0.06);
  const lsBody = new Mesh(bag.add(new CylinderGeometry(0.014, 0.014, 0.07, 10)), mats.steelDark);
  lsBody.position.y = 0.035;
  lsGroup.add(lsBody);
  const lsMat = bag.add(mats.probeLed.clone());
  const lsLed = new Mesh(bag.add(new CircleGeometry(0.024, 16)), lsMat);
  lsLed.name = 'pump:probeLed:ls';
  lsLed.position.y = 0.078;
  lsLed.rotation.x = -Math.PI / 2;
  lsGroup.add(lsLed);
  group.add(lsGroup);

  const lsWorld = new Vector3(
    centre.x - 0.02,
    centre.y + PUMP_DIM.pumpRadius + 0.11,
    centre.z + 0.06,
  );
  group.add(makePumpPlate(args.labels, signalPlateText(args.lsSymbol), {
    at: new Vector3(lsWorld.x, lsWorld.y, lsWorld.z + 0.24),
    anchor: lsWorld,
  }));

  return {
    object: group,
    update(angleRad: number, lsOn: boolean): void {
      impeller.rotation.z = angleRad;
      lsMat.emissiveIntensity = lsOn ? 1.9 : 0;
      lsMat.color.setHex(lsOn ? 0x8ff0bb : 0x5d656d);
    },
  };
}

export interface ValveVisual {
  readonly id: PumpValveId;
  readonly object: Group;
  readonly highlight: Mesh;
  /** Turns the handwheel a quarter turn and colours it open/closed. */
  update(open: boolean): void;
}

/** A quarter-turn hand valve — the one control on the plant that is NOT a PLC signal. */
export function buildValve(args: {
  id: PumpValveId;
  mats: PumpSceneMaterials;
  labels: LabelFactory;
  bag: DisposeBag;
}): ValveVisual {
  const { mats, bag } = args;
  const at = valveBody(args.id);
  const group = new Group();
  group.name = `pump:valve:${args.id}`;
  group.position.copy(at);

  const body = new Mesh(bag.add(new CylinderGeometry(0.038, 0.038, 0.07, 14)), mats.steelDark);
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const stem = new Mesh(
    bag.add(new CylinderGeometry(0.01, 0.01, PUMP_DIM.valveStemLength, 8)),
    mats.steelDark,
  );
  stem.position.y = PUMP_DIM.valveStemLength / 2;
  group.add(stem);

  // Everything that reacts to a click sits under one pickable node.
  const handle = new Group();
  handle.name = pumpPickName({ kind: 'valve', id: args.id });
  handle.position.y = PUMP_DIM.valveStemLength;
  const handleMat = bag.add(mats.valve.clone());
  const wheel = new Mesh(
    bag.add(new TorusGeometry(PUMP_DIM.valveHandleRadius, 0.009, 8, 22)),
    handleMat,
  );
  wheel.rotation.x = Math.PI / 2;
  handle.add(wheel);
  const spokeGeom = bag.add(new BoxGeometry(PUMP_DIM.valveHandleRadius * 2, 0.008, 0.012));
  for (const rot of [0, Math.PI / 2]) {
    const spoke = new Mesh(spokeGeom, handleMat);
    spoke.rotation.y = rot;
    handle.add(spoke);
  }
  group.add(handle);

  const highlight = new Mesh(
    bag.add(new TorusGeometry(PUMP_DIM.valveHandleRadius + 0.02, 0.005, 6, 24)),
    mats.highlight,
  );
  highlight.name = `pump:highlight:valve:${args.id}`;
  highlight.rotation.x = Math.PI / 2;
  highlight.position.y = PUMP_DIM.valveStemLength;
  highlight.visible = false;
  group.add(highlight);

  // The hand valves carry no PLC address — the parenthesised token is the plant id the
  // snapshot uses (`valves.inA`), which keeps the plate language-neutral like every other
  // identifier in the scene. `at` is group-local, the anchor must be WORLD.
  const label = args.id === 'inA' ? 'V1 (inA)' : 'V2 (outB)';
  group.add(makePumpPlate(args.labels, label, {
    at: new Vector3(0, PUMP_DIM.valveStemLength, 0.16),
    anchor: at.clone().setY(at.y + PUMP_DIM.valveStemLength),
  }));

  return {
    id: args.id,
    object: group,
    highlight,
    update(open: boolean): void {
      handle.rotation.y = open ? Math.PI / 2 : 0;
      handleMat.color.setHex(open ? 0x2fbf62 : 0xc4452f);
    },
  };
}

/** Impeller angle for a transfer rate — the caller integrates it, this only scales it. */
export function impellerTurnsPerSecond(flowPctS: number): number {
  return flowPctS * IMPELLER_REV_PER_PCT;
}
