/**
 * Geometry of the pump scene, in **world metres** (1 world unit = 1 m).
 *
 * This is the one place where the pump scene differs in units from `scene/materials.ts`,
 * whose `DIM` table is millimetres of a 1:120 model railway scaled by `MM`. The pump plant
 * is not a model — it is drawn at roughly life size (tanks ≈ 0.9 m tall), because the
 * Anleitung's figure shows a laboratory skid, not a layout.
 *
 * Every number here is decoration; the only ones the simulation can see are the level
 * mapping (`levelY`) and the probe heights derived from `PumpParams`. Nothing in this file
 * may be read by `model.ts` — the scene reads the plant, never the other way round.
 */
import { Vector3 } from 'three';

export const PUMP_DIM = {
  floorWidth: 3.7,
  floorDepth: 2.9,

  /** Glass cylinder: outer radius, height, and the height of its plinth top. */
  tankRadius: 0.3,
  tankHeight: 0.86,
  tankBaseY: 0.16,
  tankWall: 0.008,
  plinthRadius: 0.34,
  tankAX: -0.78,
  tankBX: 0.78,
  tankZ: -0.2,

  /** Gaps between the glass and the liquid column, so the column reads as a body of water. */
  liquidFloorGap: 0.012,
  liquidHeadroom: 0.02,
  liquidInset: 0.02,

  probeReach: 0.075,
  probeRadius: 0.017,
  probeLedRadius: 0.022,
  /** Radial distance of a probe's label plate from the tank axis, beyond `tankRadius`. */
  probeLabelOffset: 0.2,
  /** Probe azimuths, radians from +z towards +x: the two probes of a tank sit apart so
   *  their label plates cannot share a footprint whatever the thresholds are. */
  probeAzimuthLowRad: -0.87,
  probeAzimuthHighRad: 0.87,

  /** The pump sits on a stand, high enough to stay visible OVER the console from the
   *  default camera — it is the machine the whole experiment is about. */
  pumpY: 0.34,
  pumpStandTop: 0.21,
  pumpRadius: 0.13,
  pumpDepth: 0.14,
  impellerRadius: 0.092,
  impellerBlades: 6,

  pipeRadius: 0.022,
  /** Height of the discharge header above the floor — clear of both tank rims. */
  headerY: 1.22,
  /** Length of the down-turned nozzle at the end of a header. */
  nozzleDrop: 0.06,
  /** Lateral offset of a falling stream from the tank axis (it must land inside the glass). */
  inletOffsetX: 0.09,
  drainOutletX: 1.14,
  drainOutletY: 0.13,
  floorDrainY: 0.004,

  panelZ: 0.88,
  /** Kept low on purpose (user request 2026-08-01): the console must not hide the tanks —
   *  its highest edge stays well below the liquid columns from the default camera. */
  panelY: 0.44,
  panelWidth: 1.62,
  panelDepth: 0.4,
  panelThickness: 0.03,
  /** Console panel tilt, radians: the back edge is higher and the face looks towards +z. */
  panelTiltRad: 0.55,
  pedestalHeight: 0.4,

  controlSpacing: 0.24,
  /** Panel-local v of the two control rows (v grows towards the viewer and downwards). */
  controlRowFront: 0.09,
  controlRowBack: -0.06,
  /** How far in front of its control a label plate sits, in panel-local v. */
  labelRowOffset: 0.058,

  buttonRadius: 0.034,
  buttonTravel: 0.012,
  toggleBaseRadius: 0.022,
  toggleLeverLength: 0.055,
  toggleThrowRad: 0.7,
  lampRadius: 0.028,

  valveHandleRadius: 0.052,
  valveStemLength: 0.055,

  /** Label plates are `scene/labels` plates (mm-sized for TT) scaled up to this plant. */
  labelScale: 2.6,
  labelTiltRad: 0.45,
} as const;

/** Radius of a liquid column (inside the glass). */
export const LIQUID_RADIUS = PUMP_DIM.tankRadius - PUMP_DIM.liquidInset;

/** World y of a tank's inner bottom — the 0 % surface. */
export const LIQUID_BOTTOM_Y = PUMP_DIM.tankBaseY + PUMP_DIM.liquidFloorGap;

/** Usable column height, i.e. the travel between 0 % and 100 %. */
export const LIQUID_HEIGHT =
  PUMP_DIM.tankHeight - PUMP_DIM.liquidFloorGap - PUMP_DIM.liquidHeadroom;

export type PumpTankId = 'A' | 'B';

export function tankCentreX(tank: PumpTankId): number {
  return tank === 'A' ? PUMP_DIM.tankAX : PUMP_DIM.tankBX;
}

/** World y of the liquid surface for a level in %. Clamped: a snapshot cannot be trusted
 *  to stay in range after a parameter edit, and a NaN would poison the world matrix. */
export function levelY(pct: number): number {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return LIQUID_BOTTOM_Y + LIQUID_HEIGHT * (p / 100);
}

/**
 * Panel-local (u, v) → world. `u` runs along the console (world +x), `v` towards the
 * viewer; the panel is tilted by `panelTiltRad`, so a larger `v` is both nearer and lower.
 */
export function panelPoint(u: number, v: number, lift = 0): Vector3 {
  const c = Math.cos(PUMP_DIM.panelTiltRad);
  const s = Math.sin(PUMP_DIM.panelTiltRad);
  return new Vector3(
    u,
    PUMP_DIM.panelY - v * s + lift * c,
    PUMP_DIM.panelZ + v * c + lift * s,
  );
}

/** Outward unit normal of the console panel (a control's "up"). */
export function panelNormal(): Vector3 {
  return new Vector3(0, Math.cos(PUMP_DIM.panelTiltRad), Math.sin(PUMP_DIM.panelTiltRad));
}

/** World position of the discharge nozzle mouth over tank B. */
export function dischargeOutlet(): Vector3 {
  return new Vector3(
    PUMP_DIM.tankBX - PUMP_DIM.inletOffsetX,
    PUMP_DIM.headerY - PUMP_DIM.nozzleDrop,
    PUMP_DIM.tankZ,
  );
}

/** World position of the refill nozzle mouth over tank A. */
export function refillOutlet(): Vector3 {
  return new Vector3(
    PUMP_DIM.tankAX + PUMP_DIM.inletOffsetX,
    PUMP_DIM.headerY - PUMP_DIM.nozzleDrop,
    PUMP_DIM.tankZ,
  );
}

/** World position of the drain nozzle mouth beside tank B. */
export function drainOutlet(): Vector3 {
  return new Vector3(PUMP_DIM.drainOutletX, PUMP_DIM.drainOutletY, PUMP_DIM.tankZ);
}

/** Centreline of the suction + discharge line, tank A bottom → pump → over tank B. */
export function pumpLinePoints(): Vector3[] {
  const z = PUMP_DIM.tankZ;
  return [
    new Vector3(PUMP_DIM.tankAX, PUMP_DIM.tankBaseY + 0.01, z),
    new Vector3(PUMP_DIM.tankAX, 0.09, z),
    new Vector3(PUMP_DIM.tankAX + 0.16, 0.09, z),
    new Vector3(-0.36, 0.09, z),
    new Vector3(-0.36, PUMP_DIM.pumpY, z),
    new Vector3(-PUMP_DIM.pumpRadius - 0.01, PUMP_DIM.pumpY, z),
    new Vector3(0, PUMP_DIM.pumpY + PUMP_DIM.pumpRadius - 0.01, z),
    new Vector3(0, 0.78, z),
    new Vector3(0, PUMP_DIM.headerY, z),
    new Vector3(0.3, PUMP_DIM.headerY, z),
    new Vector3(PUMP_DIM.tankBX - PUMP_DIM.inletOffsetX, PUMP_DIM.headerY, z),
    new Vector3(
      PUMP_DIM.tankBX - PUMP_DIM.inletOffsetX,
      PUMP_DIM.headerY - PUMP_DIM.nozzleDrop,
      z,
    ),
  ];
}

/** Centreline of the hand-valve refill line into tank A. */
export function refillLinePoints(): Vector3[] {
  const z = PUMP_DIM.tankZ;
  return [
    new Vector3(-1.6, PUMP_DIM.headerY, z),
    new Vector3(-1.3, PUMP_DIM.headerY, z),
    new Vector3(-1.0, PUMP_DIM.headerY, z),
    new Vector3(PUMP_DIM.tankAX + PUMP_DIM.inletOffsetX, PUMP_DIM.headerY, z),
    new Vector3(
      PUMP_DIM.tankAX + PUMP_DIM.inletOffsetX,
      PUMP_DIM.headerY - PUMP_DIM.nozzleDrop,
      z,
    ),
  ];
}

/** Centreline of the hand-valve drain line out of tank B. */
export function drainLinePoints(): Vector3[] {
  const z = PUMP_DIM.tankZ;
  const y = PUMP_DIM.tankBaseY + 0.01;
  return [
    new Vector3(PUMP_DIM.tankBX, y, z),
    new Vector3(PUMP_DIM.tankBX + 0.14, y, z),
    new Vector3(PUMP_DIM.drainOutletX, y, z),
    new Vector3(PUMP_DIM.drainOutletX, PUMP_DIM.drainOutletY, z),
  ];
}

/** World position of a hand valve's body on its line. */
export function valveBody(id: 'inA' | 'outB'): Vector3 {
  return id === 'inA'
    ? new Vector3(-1.15, PUMP_DIM.headerY, PUMP_DIM.tankZ)
    : new Vector3(PUMP_DIM.tankBX + 0.19, PUMP_DIM.tankBaseY + 0.01, PUMP_DIM.tankZ);
}
