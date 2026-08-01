/**
 * The two glass tanks: vessel, liquid column, surface, and the level probes.
 *
 * Two things here are simulation-visible rather than decorative:
 *
 * 1. The liquid column height is `LIQUID_HEIGHT × vol/100` — strictly proportional, so the
 *    student can read the level off the glass and compare it with the watch table.
 * 2. A probe sits at the height of ITS OWN THRESHOLD, read from the snapshot's parameters.
 *    Moving `llsThresholdPct` therefore moves the probe, which is the whole point of making
 *    the thresholds adjustable: the bit flips exactly where the student sees the probe.
 */
import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { LabelFactory } from '../../scene';
import type { PumpSensorId } from '../types';
import {
  LIQUID_BOTTOM_Y,
  LIQUID_HEIGHT,
  LIQUID_RADIUS,
  PUMP_DIM,
  levelY,
  tankCentreX,
  type PumpTankId,
} from './dims';
import { DisposeBag, type PumpSceneMaterials } from './materials';
import { makePumpPlate, signalPlateText } from './plates';

/** Surface shimmer amplitude, metres — a calm liquid, not a wave tank. */
const SHIMMER_AMPLITUDE = 0.0018;

export interface ProbeVisual {
  readonly id: PumpSensorId;
  readonly object: Group;
  readonly led: Mesh;
  /** Moves the probe to `thresholdPct` and lights it according to `on`. */
  update(thresholdPct: number, on: boolean): void;
}

export interface TankVisual {
  readonly id: PumpTankId;
  readonly object: Group;
  readonly liquid: Mesh;
  readonly surface: Mesh;
  readonly probes: readonly ProbeVisual[];
  update(args: {
    volPct: number;
    lowOn: boolean;
    highOn: boolean;
    lowThresholdPct: number;
    highThresholdPct: number;
    simTimeMs: number;
  }): void;
}

export interface TankBuildArgs {
  readonly id: PumpTankId;
  readonly lowSensor: PumpSensorId;
  readonly highSensor: PumpSensorId;
  readonly lowSymbol: string;
  readonly highSymbol: string;
  readonly mats: PumpSceneMaterials;
  readonly labels: LabelFactory;
  readonly bag: DisposeBag;
}

export function buildTank(args: TankBuildArgs): TankVisual {
  const { mats, bag } = args;
  const cx = tankCentreX(args.id);
  const cz = PUMP_DIM.tankZ;
  const group = new Group();
  group.name = `pump:tank:${args.id}`;

  // ── plinth ───────────────────────────────────────────────────────────────────────────
  const plinth = new Mesh(
    bag.add(new CylinderGeometry(
      PUMP_DIM.plinthRadius,
      PUMP_DIM.plinthRadius + 0.02,
      PUMP_DIM.tankBaseY,
      28,
    )),
    mats.plinth,
  );
  plinth.name = `pump:plinth:${args.id}`;
  plinth.position.set(cx, PUMP_DIM.tankBaseY / 2, cz);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  // ── glass shell (open top: the falling stream has to get in) ─────────────────────────
  const shell = new Mesh(
    bag.add(new CylinderGeometry(
      PUMP_DIM.tankRadius,
      PUMP_DIM.tankRadius,
      PUMP_DIM.tankHeight,
      36,
      1,
      true,
    )),
    mats.glass,
  );
  shell.name = `pump:glass:${args.id}`;
  shell.position.set(cx, PUMP_DIM.tankBaseY + PUMP_DIM.tankHeight / 2, cz);
  group.add(shell);

  const floorDisc = new Mesh(
    bag.add(new CircleGeometry(PUMP_DIM.tankRadius, 36)),
    mats.glass,
  );
  floorDisc.name = `pump:glassfloor:${args.id}`;
  floorDisc.rotation.x = -Math.PI / 2;
  floorDisc.position.set(cx, PUMP_DIM.tankBaseY + 0.001, cz);
  group.add(floorDisc);

  // Rims: the outline of a nearly invisible vessel. Without them a 16 %-opacity cylinder
  // has no readable silhouette against the floor.
  const rimGeom = bag.add(new TorusGeometry(PUMP_DIM.tankRadius, PUMP_DIM.tankWall, 8, 40));
  for (const y of [PUMP_DIM.tankBaseY + 0.004, PUMP_DIM.tankBaseY + PUMP_DIM.tankHeight]) {
    const rim = new Mesh(rimGeom, mats.glassRim);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(cx, y, cz);
    group.add(rim);
  }

  // ── liquid column ────────────────────────────────────────────────────────────────────
  // Unit-height cylinder with its origin at the BOTTOM, so `scale.y` is the fill height in
  // metres and the world bounding box measures the level directly.
  const columnGeom = bag.add(new CylinderGeometry(LIQUID_RADIUS, LIQUID_RADIUS, 1, 32, 1, true));
  columnGeom.translate(0, 0.5, 0);
  const liquid = new Mesh(columnGeom, mats.liquid);
  liquid.name = `pump:liquid:${args.id}`;
  liquid.position.set(cx, LIQUID_BOTTOM_Y, cz);
  liquid.scale.y = 1e-6;
  liquid.visible = false;
  group.add(liquid);

  const surface = new Mesh(bag.add(new CircleGeometry(LIQUID_RADIUS, 32)), mats.liquidSurface);
  surface.name = `pump:surface:${args.id}`;
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(cx, LIQUID_BOTTOM_Y, cz);
  surface.visible = false;
  group.add(surface);

  // ── probes ───────────────────────────────────────────────────────────────────────────
  const built = [
    buildProbe({
      id: args.lowSensor,
      symbol: args.lowSymbol,
      azimuthRad: PUMP_DIM.probeAzimuthLowRad,
      cx,
      cz,
      mats,
      labels: args.labels,
      bag,
    }),
    buildProbe({
      id: args.highSensor,
      symbol: args.highSymbol,
      azimuthRad: PUMP_DIM.probeAzimuthHighRad,
      cx,
      cz,
      mats,
      labels: args.labels,
      bag,
    }),
  ];
  const probes = built.map((b) => b.probe);
  for (const b of built) {
    group.add(b.probe.object);
    // The plate is positioned in WORLD coordinates; the tank group has an identity
    // transform, the probe group does not (it is yawed onto its radial direction), so the
    // plate hangs off the tank rather than off the probe it names.
    group.add(b.plate);
  }

  // ── the vessel's own plate (a plant identifier, not a PLC operand) ───────────────────
  const anchor = new Vector3(cx, PUMP_DIM.tankBaseY, cz + PUMP_DIM.plinthRadius);
  group.add(makePumpPlate(args.labels, `Tank ${args.id}`, {
    at: new Vector3(cx, PUMP_DIM.tankBaseY + 0.004, cz + PUMP_DIM.plinthRadius + 0.07),
    anchor,
  }));

  const [lowProbe, highProbe] = probes as [ProbeVisual, ProbeVisual];

  return {
    id: args.id,
    object: group,
    liquid,
    surface,
    probes,
    update(u): void {
      const vol = Number.isFinite(u.volPct) ? Math.min(100, Math.max(0, u.volPct)) : 0;
      const height = (LIQUID_HEIGHT * vol) / 100;
      const filled = height > 1e-5;
      liquid.visible = filled;
      liquid.scale.y = filled ? height : 1e-6;

      // Deterministic shimmer: two out-of-phase sine terms in SIM time, so the surface
      // breathes without a clock and identical inputs give an identical transform.
      const t = u.simTimeMs / 1000;
      const bob = filled
        ? SHIMMER_AMPLITUDE * Math.sin(t * 2.7) + SHIMMER_AMPLITUDE * 0.6 * Math.sin(t * 4.3 + 1.1)
        : 0;
      surface.visible = filled;
      surface.position.y = LIQUID_BOTTOM_Y + height + 0.0015 + bob;
      const pulse = filled ? 1 + 0.004 * Math.sin(t * 3.1) : 1;
      surface.scale.set(pulse, pulse, 1);

      lowProbe.update(u.lowThresholdPct, u.lowOn);
      highProbe.update(u.highThresholdPct, u.highOn);
    },
  };
}

function buildProbe(args: {
  id: PumpSensorId;
  symbol: string;
  azimuthRad: number;
  cx: number;
  cz: number;
  mats: PumpSceneMaterials;
  labels: LabelFactory;
  bag: DisposeBag;
}): { probe: ProbeVisual; plate: Mesh } {
  const { mats, bag } = args;
  const dir = new Vector3(Math.sin(args.azimuthRad), 0, Math.cos(args.azimuthRad));
  const group = new Group();
  group.name = `pump:probe:${args.id}`;
  group.position.set(
    args.cx + dir.x * (PUMP_DIM.tankRadius - 0.01),
    LIQUID_BOTTOM_Y,
    args.cz + dir.z * (PUMP_DIM.tankRadius - 0.01),
  );
  // The probe body is modelled along local +x; this yaw turns +x onto the radial direction.
  group.rotation.y = args.azimuthRad - Math.PI / 2;

  const body = new Mesh(
    bag.add(new CylinderGeometry(
      PUMP_DIM.probeRadius,
      PUMP_DIM.probeRadius,
      PUMP_DIM.probeReach,
      12,
    )),
    mats.steelDark,
  );
  body.name = `pump:probeBody:${args.id}`;
  body.rotation.z = -Math.PI / 2;
  body.position.x = PUMP_DIM.probeReach / 2;
  group.add(body);

  const ledMat: MeshStandardMaterial = bag.add(mats.probeLed.clone());
  const led = new Mesh(bag.add(new SphereGeometry(PUMP_DIM.probeLedRadius, 14, 10)), ledMat);
  led.name = `pump:probeLed:${args.id}`;
  led.position.x = PUMP_DIM.probeReach + PUMP_DIM.probeLedRadius * 0.4;
  group.add(led);

  // A stub reaching into the tank, so the probe reads as measuring the liquid, not the wall.
  const stub = new Mesh(
    bag.add(new CylinderGeometry(PUMP_DIM.probeRadius * 0.5, PUMP_DIM.probeRadius * 0.5, 0.05, 8)),
    mats.steel,
  );
  stub.rotation.z = -Math.PI / 2;
  stub.position.x = -0.025;
  group.add(stub);

  // Placed in world space (yaw 0 = text along +x), radially outboard of the probe so the
  // two plates of one tank can never share a ground footprint whatever the thresholds are.
  const plate = makePumpPlate(args.labels, signalPlateText(args.symbol), {
    at: new Vector3(
      args.cx + dir.x * (PUMP_DIM.tankRadius + PUMP_DIM.probeLabelOffset),
      0,
      args.cz + dir.z * (PUMP_DIM.tankRadius + PUMP_DIM.probeLabelOffset),
    ),
    anchor: new Vector3(
      args.cx + dir.x * (PUMP_DIM.tankRadius + PUMP_DIM.probeReach),
      0,
      args.cz + dir.z * (PUMP_DIM.tankRadius + PUMP_DIM.probeReach),
    ),
  });

  const probe: ProbeVisual = {
    id: args.id,
    object: group,
    led,
    update(thresholdPct: number, on: boolean): void {
      const y = levelY(thresholdPct);
      group.position.y = y;
      plate.position.y = y;
      const anchor = plate.userData['anchorWorld'] as Vector3 | undefined;
      if (anchor) anchor.y = y;
      ledMat.emissiveIntensity = on ? 1.9 : 0;
      ledMat.color.setHex(on ? PUMP_PROBE_ON_HEX : PUMP_PROBE_OFF_HEX);
    },
  };
  return { probe, plate };
}

/** Lit / dark body colour of a probe LED (the emissive alone is invisible on a dark cap). */
const PUMP_PROBE_ON_HEX = 0x8ff0bb;
const PUMP_PROBE_OFF_HEX = 0x5d656d;
