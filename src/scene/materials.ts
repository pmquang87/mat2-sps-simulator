/**
 * Shared materials, palette and physical dimensions of the scene
 * (ARCHITECTURE.md §3 `scene/materials.ts`).
 *
 * Look reference: `docs/research/video_design.md` §1/§2/§4 and the frame PNGs
 * (`einfach_01.png`, `doppel_01.png`, `reedkontakt_scaled.png`) — model-railway TT (1:120)
 * look: static scatter grass (not photo-lawn), rough plaster rocks, light-grey ballast,
 * dark-red/bordeaux diesel loco with a silver roof, red/white coaches, bulky grey switch
 * motors and small white label plates with black variable names.
 *
 * Units: every dimension in this module is **millimetres of the real (TT-scale) plant**.
 * `PlanFrame` (trackMesh.ts) converts mm → world metres (1 world unit = 1 m), so the
 * baseboard is ≈ 3.36 m × 1.89 m for the default `mmPerUnit: 3.5` (§7.1).
 *
 * No DOM and no wall clock is touched at module scope: materials are plain objects, all
 * canvas work happens lazily in labels.ts. That keeps this module importable in the
 * node-environment unit tests (vitest.config.ts).
 */
import {
  Color,
  DoubleSide,
  Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';

export type SceneQuality = 'low' | 'high';

/** Colour palette (hex), derived from the video frames. */
export const PALETTE = {
  sky: 0xbcd6f2,
  boardGrass: 0x6d8049,
  boardGrassDark: 0x5b6b3d,
  boardEdge: 0x8a7a5c,
  ballast: 0xb6b0a4,
  sleeper: 0x4b4239,
  rail: 0xa8a49c,
  railActive: 0xd8d4c8,
  railIdle: 0x6f6a62,
  switchMotor: 0x3a3d40,
  lampGreen: 0x2fdc5a,
  lampRed: 0xe83a2a,
  lampOff: 0x555a5e,
  reedGlass: 0x9fd8c0,
  reedWire: 0xd8b45a,
  labelPlate: 0xf4f3ee,
  labelPlateGrey: 0xcac7bf,
  locoBody: 0x6e1622,
  locoRoof: 0xc6cacd,
  locoStripe: 0xe6d6a4,
  coachBody: 0xb3242c,
  coachBand: 0xf1efe7,
  coachRoof: 0xb9bcbd,
  windowGlass: 0x24303a,
  bogie: 0x2a2724,
  headlight: 0xfff3c4,
  rock: 0x8d8b86,
  rockDark: 0x6f6d68,
  moss: 0x86a05a,
  water: 0x1d5f9c,
  treeFoliage: 0x2f4a2b,
  treeFoliageLight: 0x3d5c31,
  treeTrunk: 0x4a3728,
  wall: 0xefe7d6,
  wallBrick: 0x8f3f30,
  roof: 0x8c3a2c,
  roofDark: 0x53565a,
  platform: 0xb8b3a9,
  platformEdge: 0xdedad2,
  boardSign: 0xf2f1ec,
  tower: 0xd8cf9a,
  notausBeacon: 0xd41f1f,
} as const;

/**
 * Physical dimensions in **mm** of the modelled plant (TT 1:120, cross-checked against
 * `reedkontakt_scaled.png` and `einfach_01.png`).
 */
export const DIM = {
  /** rail-to-rail gauge (TT = 12 mm) */
  gauge: 12,
  railWidth: 1.6,
  /** rail head height above the sleeper top */
  railHeight: 2.4,
  sleeperLength: 22,
  sleeperWidth: 2.4,
  sleeperHeight: 1.8,
  sleeperSpacing: 6.5,
  ballastHalfWidth: 15,
  ballastTopHalfWidth: 11,
  ballastHeight: 1.4,

  /** white label plate lying on the ballast shoulder (photo: ≈ 26 × 7 mm). */
  labelPlateLength: 26,
  labelPlateWidth: 7,
  labelPlateThickness: 0.6,
  /**
   * Labels are the didactic bridge between plant and AWL operands
   * (`video_design.md` §4: "weiße Etiketten … didaktisch zentral"), so they are drawn
   * slightly oversized for legibility. The factor is capped at 1.5 on purpose: parallel
   * tracks are only ~50 mm apart (14.2 plan units), and a larger plate would overlap the
   * neighbouring track's plate.
   */
  labelScale: 1.5,
  /** lateral distance of a label plate from the track centre line */
  labelOffset: 20,

  switchMotorLength: 26,
  switchMotorWidth: 9,
  switchMotorHeight: 7,
  switchMotorOffset: 17,
  switchBladeLength: 46,
  /** lateral travel of the throw bar between the two point positions */
  switchThrow: 2.6,

  reedTubeLength: 13,
  reedTubeRadius: 1.2,

  locoLength: 112,
  locoWidth: 24,
  locoBodyHeight: 22,
  locoRoofHeight: 4,
  coachLength: 148,
  coachWidth: 24,
  coachBodyHeight: 26,
  coachRoofHeight: 4,
  /** gap between two vehicle bodies (coupling) */
  coupling: 7,
  /** height of the rail top above the baseboard = ballast + sleeper + rail */
  railTop: 1.4 + 1.8 + 2.4,

  platformWidth: 20,
  platformHeight: 6,
  platformOffset: 24,
  stationBoardWidth: 100,
  stationBoardHeight: 26,
  stationBoardPostHeight: 45,
} as const;

/** Height of the rail top above the board, in mm (convenience alias). */
export const RAIL_TOP_MM = DIM.railTop;

export interface SceneMaterials {
  readonly board: MeshStandardMaterial;
  readonly boardEdge: MeshStandardMaterial;
  readonly ballast: MeshStandardMaterial;
  readonly sleeper: MeshStandardMaterial;
  readonly rail: MeshStandardMaterial;
  readonly railActive: MeshStandardMaterial;
  readonly railIdle: MeshStandardMaterial;
  readonly switchMotor: MeshStandardMaterial;
  readonly lampGreen: MeshStandardMaterial;
  readonly lampRed: MeshStandardMaterial;
  readonly lampOff: MeshStandardMaterial;
  readonly reedGlass: MeshStandardMaterial;
  readonly reedWire: MeshStandardMaterial;
  readonly labelPlate: MeshStandardMaterial;
  readonly labelPlateGrey: MeshStandardMaterial;
  readonly locoBody: MeshStandardMaterial;
  readonly locoRoof: MeshStandardMaterial;
  readonly locoStripe: MeshStandardMaterial;
  readonly coachBody: MeshStandardMaterial;
  readonly coachBand: MeshStandardMaterial;
  readonly coachRoof: MeshStandardMaterial;
  readonly windowGlass: MeshStandardMaterial;
  readonly bogie: MeshStandardMaterial;
  readonly headlight: MeshStandardMaterial;
  readonly rock: MeshStandardMaterial;
  readonly rockDark: MeshStandardMaterial;
  readonly moss: MeshStandardMaterial;
  readonly water: MeshStandardMaterial;
  readonly treeFoliage: MeshStandardMaterial;
  readonly treeFoliageLight: MeshStandardMaterial;
  readonly treeTrunk: MeshStandardMaterial;
  readonly wall: MeshStandardMaterial;
  readonly wallBrick: MeshStandardMaterial;
  readonly roof: MeshStandardMaterial;
  readonly roofDark: MeshStandardMaterial;
  readonly platform: MeshStandardMaterial;
  readonly platformEdge: MeshStandardMaterial;
  readonly boardSign: MeshStandardMaterial;
  readonly tower: MeshStandardMaterial;
  readonly notausBeaconOff: MeshStandardMaterial;
  readonly notausBeaconOn: MeshStandardMaterial;
  readonly tunnelDark: MeshBasicMaterial;
  readonly highlight: MeshStandardMaterial;
}

function std(
  color: number,
  roughness: number,
  metalness: number,
  extra?: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number; side?: typeof DoubleSide },
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  if (extra?.emissive !== undefined) m.emissive = new Color(extra.emissive);
  if (extra?.emissiveIntensity !== undefined) m.emissiveIntensity = extra.emissiveIntensity;
  if (extra?.transparent === true) m.transparent = true;
  if (extra?.opacity !== undefined) m.opacity = extra.opacity;
  if (extra?.side !== undefined) m.side = extra.side;
  return m;
}

/**
 * Creates the shared material set. `quality: 'low'` flattens the look a little (no
 * transparency on the water, no emissive glow budget) for weak GPUs (§5.4).
 */
export function createMaterials(quality: SceneQuality = 'high'): SceneMaterials {
  const high = quality === 'high';
  return {
    board: std(PALETTE.boardGrass, 0.95, 0),
    boardEdge: std(PALETTE.boardEdge, 0.8, 0),
    ballast: std(PALETTE.ballast, 0.92, 0),
    sleeper: std(PALETTE.sleeper, 0.85, 0),
    rail: std(PALETTE.rail, 0.35, 0.85),
    railActive: std(PALETTE.railActive, 0.3, 0.9, { emissive: PALETTE.railActive, emissiveIntensity: high ? 0.35 : 0 }),
    railIdle: std(PALETTE.railIdle, 0.6, 0.5),
    switchMotor: std(PALETTE.switchMotor, 0.7, 0.2),
    lampGreen: std(PALETTE.lampGreen, 0.4, 0, { emissive: PALETTE.lampGreen, emissiveIntensity: 1 }),
    lampRed: std(PALETTE.lampRed, 0.4, 0, { emissive: PALETTE.lampRed, emissiveIntensity: 1 }),
    lampOff: std(PALETTE.lampOff, 0.6, 0.1),
    reedGlass: std(PALETTE.reedGlass, 0.25, 0.1, {
      emissive: PALETTE.reedGlass,
      emissiveIntensity: 0,
      transparent: high,
      opacity: high ? 0.85 : 1,
    }),
    reedWire: std(PALETTE.reedWire, 0.35, 0.8),
    labelPlate: std(PALETTE.labelPlate, 0.7, 0),
    labelPlateGrey: std(PALETTE.labelPlateGrey, 0.75, 0),
    locoBody: std(PALETTE.locoBody, 0.55, 0.15),
    locoRoof: std(PALETTE.locoRoof, 0.45, 0.55),
    locoStripe: std(PALETTE.locoStripe, 0.6, 0.05),
    coachBody: std(PALETTE.coachBody, 0.55, 0.1),
    coachBand: std(PALETTE.coachBand, 0.6, 0.05),
    coachRoof: std(PALETTE.coachRoof, 0.5, 0.35),
    windowGlass: std(PALETTE.windowGlass, 0.2, 0.4),
    bogie: std(PALETTE.bogie, 0.8, 0.3),
    headlight: std(PALETTE.headlight, 0.4, 0, { emissive: PALETTE.headlight, emissiveIntensity: 0.9 }),
    rock: std(PALETTE.rock, 0.95, 0),
    rockDark: std(PALETTE.rockDark, 0.95, 0),
    moss: std(PALETTE.moss, 0.95, 0),
    water: std(PALETTE.water, 0.15, 0.2, { transparent: high, opacity: high ? 0.88 : 1 }),
    treeFoliage: std(PALETTE.treeFoliage, 0.9, 0),
    treeFoliageLight: std(PALETTE.treeFoliageLight, 0.9, 0),
    treeTrunk: std(PALETTE.treeTrunk, 0.9, 0),
    wall: std(PALETTE.wall, 0.8, 0),
    wallBrick: std(PALETTE.wallBrick, 0.85, 0),
    roof: std(PALETTE.roof, 0.8, 0),
    roofDark: std(PALETTE.roofDark, 0.75, 0.1),
    platform: std(PALETTE.platform, 0.9, 0),
    platformEdge: std(PALETTE.platformEdge, 0.85, 0),
    boardSign: std(PALETTE.boardSign, 0.7, 0),
    tower: std(PALETTE.tower, 0.8, 0),
    notausBeaconOff: std(PALETTE.notausBeacon, 0.5, 0.1, { emissive: PALETTE.notausBeacon, emissiveIntensity: 0 }),
    notausBeaconOn: std(PALETTE.notausBeacon, 0.4, 0.1, { emissive: PALETTE.notausBeacon, emissiveIntensity: 1.6 }),
    // double sided: the tunnel bore is a swept tube seen from the outside *and* from within
    tunnelDark: new MeshBasicMaterial({ color: 0x0a0a0c, side: DoubleSide }),
    highlight: std(0xffd24a, 0.4, 0.1, { emissive: 0xffd24a, emissiveIntensity: 0.9 }),
  };
}

/** Disposes every material of the set (called from `SceneManager.dispose()`). */
export function disposeMaterials(mats: SceneMaterials): void {
  for (const value of Object.values(mats) as Material[]) {
    value.dispose();
  }
}
