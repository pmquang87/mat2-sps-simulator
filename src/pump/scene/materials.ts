/**
 * Materials of the pump scene.
 *
 * A separate set from `scene/materials.ts` on purpose: that palette is a weathered TT-scale
 * model railway, this one is a laboratory skid — clean steel, painted floor, and above all
 * GLASS. The owner requirement is that the tanks read as transparent and the liquid columns
 * and their surfaces stay visible from every angle, so the vessel material is a low-opacity
 * `MeshPhysicalMaterial` with a clearcoat and `depthWrite: false` (a transparent shell that
 * writes depth hides whatever is inside it, which is exactly what must not happen here).
 *
 * `transmission` is deliberately NOT used: it costs an extra render target per frame and the
 * scene must stay cheap enough for the weak lab GPUs the railway's `quality: 'low'` path
 * exists for.
 *
 * Every material that carries per-instance STATE (a probe LED, a lamp, a pressed button) is
 * cloned per instance by its builder and disposed with it — the shared set below only holds
 * the stateless ones.
 */
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from 'three';
import type { SceneQuality } from '../../scene';

export const PUMP_PALETTE = {
  background: 0x1d232b,
  floor: 0x515861,
  floorMark: 0x6a727c,
  plinth: 0x3f464e,
  steel: 0xb2b8bf,
  steelDark: 0x6b727a,
  pumpBody: 0x2f6f9e,
  glass: 0xdcecf5,
  glassRim: 0x8f9aa3,
  liquid: 0x2f8ed6,
  liquidSurface: 0x6fc0f0,
  stream: 0x7cc8f2,
  ripple: 0xcfe9fb,
  panel: 0x39414a,
  panelFace: 0x4b545e,
  buttonGreen: 0x27c25a,
  buttonRed: 0xe0392a,
  toggleBody: 0x2b3138,
  toggleLever: 0xc9ced4,
  lampAmber: 0xf2b134,
  lampWhite: 0xf4f1e8,
  probeOff: 0x5d656d,
  probeOn: 0x4de08a,
  valve: 0xc4452f,
  highlight: 0xffd24a,
} as const;

export interface PumpSceneMaterials {
  readonly floor: MeshStandardMaterial;
  readonly plinth: MeshStandardMaterial;
  readonly steel: MeshStandardMaterial;
  readonly steelDark: MeshStandardMaterial;
  readonly pumpBody: MeshStandardMaterial;
  readonly glass: MeshPhysicalMaterial;
  readonly glassRim: MeshStandardMaterial;
  readonly liquid: MeshPhysicalMaterial;
  readonly liquidSurface: MeshPhysicalMaterial;
  readonly stream: MeshPhysicalMaterial;
  readonly ripple: MeshBasicMaterial;
  readonly panel: MeshStandardMaterial;
  readonly panelFace: MeshStandardMaterial;
  readonly toggleBody: MeshStandardMaterial;
  readonly toggleLever: MeshStandardMaterial;
  readonly valve: MeshStandardMaterial;
  readonly highlight: MeshBasicMaterial;
  /** Prototypes — builders CLONE these, because each instance switches on its own. */
  readonly buttonGreen: MeshStandardMaterial;
  readonly buttonRed: MeshStandardMaterial;
  readonly lamp: MeshStandardMaterial;
  readonly probeLed: MeshStandardMaterial;
}

function std(
  color: number,
  roughness: number,
  metalness: number,
  extra?: { emissive?: number; emissiveIntensity?: number },
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness, metalness });
  if (extra?.emissive !== undefined) m.emissive = new Color(extra.emissive);
  if (extra?.emissiveIntensity !== undefined) m.emissiveIntensity = extra.emissiveIntensity;
  return m;
}

export function createPumpMaterials(quality: SceneQuality = 'high'): PumpSceneMaterials {
  const high = quality === 'high';
  const glass = new MeshPhysicalMaterial({
    color: PUMP_PALETTE.glass,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    // Low enough that the liquid, the probes and the falling stream stay readable through
    // both walls of the cylinder; the rim rings carry the vessel's outline instead.
    opacity: high ? 0.16 : 0.28,
    depthWrite: false,
    side: DoubleSide,
    clearcoat: high ? 1 : 0,
    clearcoatRoughness: 0.05,
  });
  const liquid = new MeshPhysicalMaterial({
    color: PUMP_PALETTE.liquid,
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity: high ? 0.72 : 0.9,
    depthWrite: false,
    side: FrontSide,
    clearcoat: high ? 0.6 : 0,
  });
  const liquidSurface = new MeshPhysicalMaterial({
    color: PUMP_PALETTE.liquidSurface,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: high ? 0.6 : 0.85,
    depthWrite: false,
    side: DoubleSide,
  });
  const stream = new MeshPhysicalMaterial({
    color: PUMP_PALETTE.stream,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: high ? 0.66 : 0.85,
    depthWrite: false,
    side: DoubleSide,
  });
  return {
    floor: std(PUMP_PALETTE.floor, 0.94, 0.02),
    plinth: std(PUMP_PALETTE.plinth, 0.85, 0.1),
    // Moderate metalness on purpose: there is no environment map in this scene (one more
    // render target the weak lab GPUs do not need), and a highly metallic material with
    // nothing to reflect renders almost black — the pipework read as charcoal, not steel.
    steel: std(PUMP_PALETTE.steel, 0.42, 0.35),
    steelDark: std(PUMP_PALETTE.steelDark, 0.55, 0.3),
    pumpBody: std(PUMP_PALETTE.pumpBody, 0.45, 0.35),
    glass,
    // BackSide rim: the ring is seen through the front wall of its own tank, and a
    // FrontSide ring disappears into the glass at grazing angles.
    glassRim: new MeshStandardMaterial({
      color: PUMP_PALETTE.glassRim,
      roughness: 0.35,
      metalness: 0.8,
      side: BackSide,
    }),
    liquid,
    liquidSurface,
    stream,
    ripple: new MeshBasicMaterial({
      color: PUMP_PALETTE.ripple,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    panel: std(PUMP_PALETTE.panel, 0.8, 0.15),
    panelFace: std(PUMP_PALETTE.panelFace, 0.7, 0.2),
    toggleBody: std(PUMP_PALETTE.toggleBody, 0.7, 0.3),
    toggleLever: std(PUMP_PALETTE.toggleLever, 0.35, 0.8),
    valve: std(PUMP_PALETTE.valve, 0.6, 0.2),
    highlight: new MeshBasicMaterial({
      color: PUMP_PALETTE.highlight,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    buttonGreen: std(PUMP_PALETTE.buttonGreen, 0.45, 0.05, {
      emissive: PUMP_PALETTE.buttonGreen,
      emissiveIntensity: 0.15,
    }),
    buttonRed: std(PUMP_PALETTE.buttonRed, 0.45, 0.05, {
      emissive: PUMP_PALETTE.buttonRed,
      emissiveIntensity: 0.15,
    }),
    lamp: std(PUMP_PALETTE.lampAmber, 0.4, 0.05, {
      emissive: PUMP_PALETTE.lampAmber,
      emissiveIntensity: 0,
    }),
    probeLed: std(PUMP_PALETTE.probeOff, 0.4, 0.1, {
      emissive: PUMP_PALETTE.probeOn,
      emissiveIntensity: 0,
    }),
  };
}

export function disposePumpMaterials(mats: PumpSceneMaterials): void {
  for (const value of Object.values(mats) as Material[]) value.dispose();
}

/**
 * Collects the geometries and cloned materials a builder creates so the graph can free them
 * in one call — Three.js frees neither automatically.
 *
 * Note what this is NOT for: the shipped app never tears the pump scene down. An experiment
 * switch is a page RELOAD (ui/experiment.ts), which drops the whole WebGL context, and
 * nothing else disposes a live scene. The bag exists so the graph owns its GPU resources
 * completely — which is what the scene tests rely on, and what a future in-place switch or
 * scene editor would need — not because the app currently calls it.
 */
export class DisposeBag {
  private readonly items: { dispose(): void }[] = [];

  add<T extends { dispose(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
  }
}
