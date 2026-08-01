/**
 * Decorative landscape and station furniture (ARCHITECTURE.md §3 `scene/landscape.ts`).
 *
 * Everything here is approximate by design (§5.4 "decorative accuracy is approximate") and
 * driven by `trackplan.landscape` (§7.1): green baseboard, the grey "MFD-Gebirge" massif
 * with tunnel portals over the Gleis C/K area, the Badesee with its rocky island, a few
 * buildings (Lokschuppen, station buildings, bakery, lookout tower) and scattered conifers.
 *
 * **Terrain, not loose cones.** `landscape.mountains` only gives centre/radius/height hints,
 * and those footprints cover far more track than the two edges the trackplan declares as a
 * tunnel. A massif built as bare cones therefore buries open track (and any tunnel portal)
 * inside its slope. The massif is built here as one *height field* instead:
 * `buildTerrain()` evaluates max-of-cones and then carves a rock cutting along every track
 * corridor that is **not** declared a tunnel. Track is then either in daylight (cutting) or
 * under rock (tunnel), and a tunnel portal can be placed exactly where a declared tunnel
 * edge passes under terrain tall enough to cover it — see `findPortalSites()`.
 *
 * Station platforms and name boards are *derived* from the plant's own naming convention
 * (`xR01BH1G2` → station `BH1`, track `G2`) so no extra schema field is needed and the
 * boards show exactly the tokens that appear in the students' AWL operands. Board text is
 * therefore a plant identifier, not translatable UI prose (no i18n key required).
 *
 * Randomness: a local seeded mulberry32 (never `Math.random`) so the decoration is
 * identical on every run and screenshots stay comparable.
 */
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  RingGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { BuildingSpec, TrackplanFile, Vec2 } from '../plant';
import { DIM, type SceneMaterials, type SceneQuality } from './materials';
import type { LabelFactory } from './labels';
import {
  MM,
  lateralOf,
  platformProfile,
  poseAtOffsetMm,
  yawOfTangent,
  MeshAccum,
  type EdgeCurve,
  type PlanFrame,
} from './trackMesh';

/** Margin of bare baseboard around the track bounding box, in plan units. */
export const BOARD_MARGIN_PT = 26;

/** Half width of a rock cutting at its floor, plan units (ballast half width + shoulder). */
const CUT_HALF_PT = 9;
/**
 * Width of a cutting's rock wall, plan units — deliberately narrow (21 mm), the way a blasted
 * rock cutting really looks. A wide, gentle wall reaches so far from the track that it eats
 * into the summit 65 mm away and leaves the `Aussichtsturm` standing on a 79° slope.
 */
const CUT_FALLOFF_PT = 6;
/** Step along a track corridor when sampling it for the cutting mask, plan units. */
const CUT_SAMPLE_PT = 3;
/** Terrain lift so its flat fringe never z-fights the baseboard top (y = 0), mm. */
const TERRAIN_LIFT_MM = 0.6;

/**
 * Tunnel portal geometry, mm of the modelled plant (TT 1:120).
 *
 * A masonry **headwall with a hole**, not two free-standing piers under a cap: a height field
 * closes over the track, so the mouth needs a real aperture, and the wall around that aperture
 * is also what covers the hole punched through the terrain mesh (see `buildMassif`). The
 * aperture clears the tallest vehicle (coach roof at 35.6 mm) by 6.4 mm and the widest
 * (24 mm) by 10 mm.
 */
const PORTAL = {
  /** clear aperture width, mm */
  openW: 34,
  /** clear aperture height above the baseboard, mm */
  openH: 42,
  /** half width of the masonry headwall */
  wallHalf: 40,
  /** top of the headwall above the baseboard */
  wallTop: 66,
  /** depth of the headwall along the track */
  thick: 12,
  /** the dark bore is swept a little wider than the opening so the headwall hides its rim */
  boreOversize: 2,
} as const;

/** Top edge of the portal headwall above the baseboard, mm. */
export const PORTAL_TOP_MM = PORTAL.wallTop;

/** Clear aperture of a tunnel mouth, mm — reported by the acceptance tests. */
export const APERTURE_W_MM = PORTAL.openW;
export const APERTURE_H_MM = PORTAL.openH;

/** Roof of the dark bore above the baseboard, mm — the cover the lined stretch must have. */
export const BORE_ROOF_MM = PORTAL.openH + PORTAL.boreOversize;

/** Rock the massif keeps over the bore corridor between two mouths, mm. */
export const BORE_MIN_COVER_MM = BORE_ROOF_MM + 8;

/**
 * Rock cover the massif must give for a track to count as *tunnelled*: enough rock above the
 * aperture to read as a hillside, plus a margin for the terrain grid, which samples the height
 * field every few plan units and can undercut the analytic field between two vertices.
 */
export const PORTAL_COVER_MM = PORTAL.openH + 18;

/**
 * Rock cover from which the consist counts as *inside* the massif and is hidden: the roof of
 * the tallest vehicle. Below it the rock in front simply occludes the lower part of the
 * vehicle, which is what entering a tunnel mouth looks like — so the train never pops out of
 * existence in daylight. (Before this the whole tunnel *edge* hid the train, i.e. 553 mm of
 * `e68` where only ~157 mm is actually under rock.)
 */
export const TRAIN_HIDE_COVER_MM = DIM.railTop + DIM.coachBodyHeight + DIM.coachRoofHeight;

// ────────────────────────────── station derivation ──────────────────────────────

/** One station track derived from the reed naming convention. */
export interface DerivedLane {
  readonly laneKey: string; // "G2"
  readonly edgeId: string;
  readonly startMm: number;
  readonly endMm: number;
  readonly reedIds: readonly string[];
}

export interface DerivedStation {
  readonly key: string; // "BH1"
  readonly lanes: readonly DerivedLane[];
}

const STATION_RE = /(BH\d+)\s*(G\d+)/i;

/**
 * Groups the trackplan's reeds into stations/tracks by their symbolic names. Pure and
 * order-stable (trackplan array order), so the derived platforms never jitter.
 */
export function deriveStations(tp: TrackplanFile): DerivedStation[] {
  interface Acc {
    edges: Map<string, { offsets: number[]; reedIds: string[] }>;
  }
  const stations = new Map<string, Map<string, Acc>>();
  for (const reed of tp.reeds) {
    const m = STATION_RE.exec(reed.id);
    const stationKey = m?.[1];
    const laneKey = m?.[2];
    if (!stationKey || !laneKey) continue;
    const station = stations.get(stationKey.toUpperCase()) ?? new Map<string, Acc>();
    stations.set(stationKey.toUpperCase(), station);
    const lane = station.get(laneKey.toUpperCase()) ?? { edges: new Map() };
    station.set(laneKey.toUpperCase(), lane);
    const bucket = lane.edges.get(reed.edgeId) ?? { offsets: [], reedIds: [] };
    lane.edges.set(reed.edgeId, bucket);
    bucket.offsets.push(reed.offsetMm);
    bucket.reedIds.push(reed.id);
  }

  const out: DerivedStation[] = [];
  for (const [key, laneMap] of stations) {
    const lanes: DerivedLane[] = [];
    for (const [laneKey, acc] of laneMap) {
      let best: { edgeId: string; offsets: number[]; reedIds: string[] } | null = null;
      for (const [edgeId, bucket] of acc.edges) {
        if (!best || bucket.offsets.length > best.offsets.length) {
          best = { edgeId, offsets: bucket.offsets, reedIds: bucket.reedIds };
        }
      }
      if (!best) continue;
      const min = Math.min(...best.offsets);
      const max = Math.max(...best.offsets);
      const pad = max - min < 1 ? 180 : 80;
      lanes.push({
        laneKey,
        edgeId: best.edgeId,
        startMm: min - pad,
        endMm: max + pad,
        reedIds: best.reedIds,
      });
    }
    if (lanes.length > 0) out.push({ key, lanes });
  }
  return out;
}

// ────────────────────────────── seeded PRNG (scene-local) ──────────────────────────────

/** mulberry32 — the only randomness source in scene/, seeded for reproducible decoration. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ────────────────────────────── terrain ──────────────────────────────

/**
 * Every edge the trackplan declares as running inside the massif.
 *
 * `landscape.tunnels` is the authoritative list and wins whenever it is non-empty; the
 * per-edge `tunnel` flag is only the fallback for plans that do not carry a tunnel section.
 * The two disagree in `trackplan.json` on purpose: `e48` still carries `tunnel: true` from an
 * earlier revision, but the orchestrator removed it from `landscape.tunnels` so that the
 * `xW02C`/`xW03C` switches at `n55`/`n51` stay visible (see docs/REVIEW_SCENE.md). Treating
 * the per-edge flag as equally authoritative would silently re-bury them.
 */
export function tunnelEdgeIds(tp: TrackplanFile): Set<string> {
  const declared = new Set<string>();
  for (const t of tp.landscape.tunnels) for (const id of t.edgeIds) declared.add(id);
  if (declared.size > 0) return declared;
  const out = new Set<string>();
  for (const e of tp.edges) if (e.tunnel === true) out.add(e.id);
  return out;
}

/**
 * The massif as a height field: max-of-hills minus a rock cutting along every open (i.e.
 * non-tunnel) track corridor. Pure and deterministic — no clock, no `Math.random`.
 */
export interface Terrain {
  /** Terrain height above the baseboard at a plan point, in plan units. */
  heightPt(px: number, py: number): number;
  /** Terrain height above the baseboard at a plan point, in world metres. */
  heightAt(px: number, py: number): number;
  /** Plan-space bounding box of the relief (`null` when the trackplan has no mountains). */
  readonly extent: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/**
 * The open approach in front of one tunnel mouth. Everything inside the corridor *outward* of
 * the mouth plane is cut to baseboard level, so the rails run in daylight right up to the
 * masonry face instead of disappearing under a thin wedge of rock 14 mm short of it
 * (REVIEW_SCENE.md D8).
 *
 * The clip is directional on purpose: a distance-only cut would also reach the `Aussichtsturm`
 * 39 mm behind the mouth and level its summit. Everything *inward* of the plane is untouched.
 */
export interface ApproachClip {
  /** mouth position in plan space */
  readonly at: Vec2;
  /** unit plan-space direction pointing into the rock */
  readonly inward: Vec2;
  /** plan points of the tunnel centre line outward of the mouth */
  readonly outward: readonly Vec2[];
}

export function buildTerrain(
  tp: TrackplanFile,
  frame: PlanFrame,
  clips: readonly ApproachClip[] = [],
  bores: readonly Vec2[] = [],
): Terrain {
  const mountains = tp.landscape.mountains;
  const cuts = collectCuttingSamples(tp, mountains);
  const reach = CUT_HALF_PT + CUT_FALLOFF_PT;
  // only as wide as the aperture plus a shoulder: at the full headwall width the corridor
  // reaches the Aussichtsturm's footprint 33 mm behind the mouth and levels its summit
  const approachHalf = (PORTAL.openW / 2 + 5) / frame.mmPerUnit;
  const boreHalf = (PORTAL.openW / 2 + PORTAL.boreOversize) / frame.mmPerUnit;
  const boreFloorPt = BORE_MIN_COVER_MM / frame.mmPerUnit;

  const heightPt = (px: number, py: number): number => {
    let raw = 0;
    for (const m of mountains) {
      const v = coneHeightPt(m, px, py);
      if (v > raw) raw = v;
    }
    if (raw <= 0) return 0;
    for (const clip of clips) {
      if ((px - clip.at.x) * clip.inward.x + (py - clip.at.y) * clip.inward.y > 0) continue;
      for (const o of clip.outward) {
        if (dist2(px, py, o) <= approachHalf * approachHalf) return 0;
      }
    }
    let mask = 1;
    for (const c of cuts) {
      const d2 = dist2(px, py, c);
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d <= CUT_HALF_PT) return 0;
      const s = smoothstep((d - CUT_HALF_PT) / CUT_FALLOFF_PT); // flat floor, rounded wall top
      if (s < mask) mask = s;
    }
    const h = raw * mask;
    // Rock floor over the bore. `e68` runs within 39 mm of the open `e49` at its west mouth, so
    // `e49`'s cutting mask would otherwise shave the hill down *inside* the tunnel and leave a
    // rock shelf poking through the bore's flank at 16 mm above the rails (measured, D8). The
    // roof over a bore is not optional, so between the mouths the corridor keeps at least
    // `BORE_MIN_COVER_MM` — it only ever *raises* terrain, never buries open track.
    if (h < boreFloorPt) {
      for (const b of bores) {
        if (dist2(px, py, b) <= boreHalf * boreHalf) return boreFloorPt;
      }
    }
    return h;
  };

  let extent: Terrain['extent'] = null;
  if (mountains.length > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const m of mountains) {
      minX = Math.min(minX, m.center.x - m.radiusPt);
      minY = Math.min(minY, m.center.y - m.radiusPt);
      maxX = Math.max(maxX, m.center.x + m.radiusPt);
      maxY = Math.max(maxY, m.center.y + m.radiusPt);
    }
    extent = { minX, minY, maxX, maxY };
  }

  return {
    heightPt,
    heightAt: (px, py) => frame.units(heightPt(px, py)),
    extent,
  };
}

/**
 * Un-carved height (plan units) of one hill of the massif.
 *
 * Smoothstep, not a straight cone: the summit and the toe are both flat, so the
 * `Aussichtsturm` stands level on its summit instead of leaning on a 58° cone flank, the toe
 * blends into the board without a hard crease, and the covered stretch of a tunnel edge is
 * ~10 % shorter for the same radius. The massif silhouette comes from overlapping several
 * hills (`landscape.mountains`) rather than from bolted-on satellite cones.
 */
function coneHeightPt(
  spec: { center: Vec2; radiusPt: number; heightPt: number },
  px: number,
  py: number,
): number {
  const d = Math.sqrt(dist2(px, py, spec.center));
  if (d >= spec.radiusPt) return 0;
  return spec.heightPt * smoothstep(1 - d / spec.radiusPt);
}

function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Plan points of every open track corridor that runs inside (or near) a massif. */
function collectCuttingSamples(
  tp: TrackplanFile,
  mountains: readonly { center: Vec2; radiusPt: number }[],
): Vec2[] {
  if (mountains.length === 0) return [];
  const tunnels = tunnelEdgeIds(tp);
  const reach = CUT_HALF_PT + CUT_FALLOFF_PT;
  const out: Vec2[] = [];
  for (const e of tp.edges) {
    if (tunnels.has(e.id)) continue;
    for (let i = 1; i < e.pts.length; i += 1) {
      const a = e.pts[i - 1];
      const b = e.pts[i];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / CUT_SAMPLE_PT));
      for (let k = 0; k <= steps; k += 1) {
        const px = a.x + ((b.x - a.x) * k) / steps;
        const py = a.y + ((b.y - a.y) * k) / steps;
        const near = mountains.some((m) => dist2(px, py, m.center) < (m.radiusPt + reach) ** 2);
        if (near) out.push({ x: px, y: py });
      }
    }
  }
  return out;
}

// ────────────────────────────── tunnel portals ──────────────────────────────

/** A point where a declared tunnel edge crosses the massif surface. */
export interface PortalSite {
  readonly edgeId: string;
  readonly offsetMm: number;
  /** world position on the track centre line, y = 0 */
  readonly position: Vector3;
  /** world unit tangent of the edge at that offset, y = 0 */
  readonly tangent: Vector3;
  /** `+1` when the bore continues along `tangent`, `-1` when it runs against it */
  readonly inward: 1 | -1;
  /** terrain height at the site in plan units (≈ the portal top by construction) */
  readonly terrainPt: number;
}

/**
 * Finds the tunnel mouths from the geometry: walk each declared tunnel edge and take every
 * offset where the carved terrain crosses the portal's top height. Nothing is hardcoded —
 * a tunnel edge that never gets that much cover (because the massif is carved away along an
 * open corridor beside it) yields no portal, which is the honest answer for that edge.
 */
export function findPortalSites(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
  terrain: Terrain,
): PortalSite[] {
  const clearPt = PORTAL_COVER_MM / frame.mmPerUnit;
  const stepMm = 4;
  const sites: PortalSite[] = [];
  const covered = (curve: EdgeCurve, offsetMm: number): boolean => {
    const p = poseAtOffsetMm(curve, offsetMm).position;
    return terrain.heightPt(frame.planX(p.x), frame.planY(p.z)) >= clearPt;
  };

  for (const edgeId of [...tunnelEdgeIds(tp)].sort()) {
    const curve = curves.get(edgeId);
    if (!curve) continue;
    let prevOff = 0;
    let prev = covered(curve, 0);
    for (let s = stepMm; s <= curve.lengthMm; s += stepMm) {
      const off = Math.min(s, curve.lengthMm);
      const cur = covered(curve, off);
      if (cur !== prev) {
        // bisect down to ≈ 0.1 mm so the portal really sits on the rock face
        let lo = prevOff;
        let hi = off;
        for (let i = 0; i < 12 && hi - lo > 0.1; i += 1) {
          const mid = (lo + hi) / 2;
          if (covered(curve, mid) === prev) lo = mid;
          else hi = mid;
        }
        const offsetMm = cur ? hi : lo;
        const pose = poseAtOffsetMm(curve, offsetMm);
        sites.push({
          edgeId,
          offsetMm,
          position: pose.position,
          tangent: pose.tangent,
          inward: cur ? 1 : -1,
          terrainPt: terrain.heightPt(
            frame.planX(pose.position.x),
            frame.planY(pose.position.z),
          ),
        });
        prev = cur;
      }
      prevOff = off;
    }
  }

  // two tunnel edges meeting at a node can report the same mouth twice
  const unique: PortalSite[] = [];
  for (const site of sites) {
    if (unique.some((u) => u.position.distanceTo(site.position) < 20 * MM)) continue;
    unique.push(site);
  }
  return unique;
}

/** The covered stretch between an entry and an exit mouth, along one tunnel edge. */
export interface BoreSpan {
  readonly edgeId: string;
  readonly startMm: number;
  readonly endMm: number;
}

/**
 * Pairs the portal sites of each tunnel edge into bores. A tunnel edge that starts or ends
 * already under rock (its neighbour continues the tunnel) reports an unpaired mouth; the bore
 * then runs to that end of the edge.
 */
export function tunnelBores(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
  terrain: Terrain,
  sites?: readonly PortalSite[],
): BoreSpan[] {
  const byEdge = new Map<string, PortalSite[]>();
  for (const site of sites ?? findPortalSites(tp, curves, frame, terrain)) {
    const list = byEdge.get(site.edgeId) ?? [];
    list.push(site);
    byEdge.set(site.edgeId, list);
  }
  const out: BoreSpan[] = [];
  for (const [edgeId, list] of byEdge) {
    const curve = curves.get(edgeId);
    if (!curve) continue;
    const sorted = [...list].sort((a, b) => a.offsetMm - b.offsetMm);
    // the bore runs mouth to mouth: a portal frame is `thick` deep and its *inner* face sits
    // exactly on its site, so the tube must start there — no overshoot, or its roof would
    // break out of the rock face (the cover falls by ~5 mm per mm of track just outside).
    let open: number | null = sorted[0]?.inward === -1 ? 0 : null;
    for (const site of sorted) {
      if (site.inward === 1) {
        open = site.offsetMm;
      } else if (open !== null) {
        out.push({ edgeId, startMm: open, endMm: site.offsetMm });
        open = null;
      }
    }
    if (open !== null) out.push({ edgeId, startMm: open, endMm: curve.lengthMm });
  }
  return out;
}

/** Everything the tunnels need, resolved in the two passes the geometry requires. */
export interface TunnelResolution {
  /** final terrain: hills, rock cuttings *and* the open approaches in front of the mouths */
  readonly terrain: Terrain;
  readonly sites: readonly PortalSite[];
  readonly bores: readonly BoreSpan[];
}

/**
 * Two passes, because the mouth positions and the terrain define each other:
 *
 * 1. terrain from the hills and the open-track cuttings alone → where does a declared tunnel
 *    edge cross into full rock cover? Those crossings are the mouths.
 * 2. terrain again, now with an `ApproachClip` in front of each mouth, so the rock stops at the
 *    masonry face instead of closing over the rails ahead of it.
 *
 * Pass 2 cannot move the mouths: it only *lowers* terrain outward of a mouth plane, where the
 * cover was already below the threshold, so the crossing stays exactly on the plane.
 */
export function resolveTunnels(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
): TunnelResolution {
  const rough = buildTerrain(tp, frame);
  const sites = findPortalSites(tp, curves, frame, rough);
  const clips: ApproachClip[] = [];
  for (const site of sites) {
    const curve = curves.get(site.edgeId);
    if (!curve) continue;
    const outward: Vec2[] = [];
    const step = 4;
    for (let d = 0; d <= APPROACH_LENGTH_MM; d += step) {
      const off = site.offsetMm - site.inward * d;
      if (off < 0 || off > curve.lengthMm) break;
      const p = poseAtOffsetMm(curve, off).position;
      outward.push({ x: frame.planX(p.x), y: frame.planY(p.z) });
    }
    const tangent = site.tangent;
    clips.push({
      at: { x: frame.planX(site.position.x), y: frame.planY(site.position.z) },
      // plan-space inward direction: world +x → plan +x, world +z → plan +y
      inward: { x: site.inward * tangent.x, y: site.inward * tangent.z },
      outward,
    });
  }
  // bore centre lines, so pass 2 can guarantee a roof over every lined stretch
  const spans = tunnelBores(tp, curves, frame, rough, sites);
  const boreSamples: Vec2[] = [];
  for (const span of spans) {
    const curve = curves.get(span.edgeId);
    if (!curve) continue;
    for (let s = span.startMm; s <= span.endMm; s += 3) {
      const p = poseAtOffsetMm(curve, s).position;
      boreSamples.push({ x: frame.planX(p.x), y: frame.planY(p.z) });
    }
  }
  const terrain = buildTerrain(tp, frame, clips, boreSamples);
  return { terrain, sites, bores: spans };
}

/** How far in front of a mouth the approach is cut open, mm. */
const APPROACH_LENGTH_MM = 140;

// ────────────────────────────── scenery footprints ──────────────────────────────

/**
 * A scenery volume in world space, as a bounding circle on the baseboard. The fixed
 * trackside cameras (`cameras.ts`) use these to make sure no tripod ends up standing inside
 * (or on top of) a piece of scenery — the BH1 station building used to sit 16 mm from one of
 * them, which filled the lower third of the Trackside view with the building's own hull.
 */
export interface SceneryFootprint {
  readonly kind: 'mountain' | 'lake' | 'building' | 'beacon';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export function sceneryFootprints(tp: TrackplanFile, frame: PlanFrame): SceneryFootprint[] {
  const out: SceneryFootprint[] = [];
  for (const m of tp.landscape.mountains) {
    out.push({
      kind: 'mountain',
      x: frame.x(m.center.x),
      z: frame.z(m.center.y),
      radius: frame.units(m.radiusPt),
    });
  }
  const lake = tp.landscape.lake;
  if (lake) {
    out.push({
      kind: 'lake',
      x: frame.x(lake.center.x),
      z: frame.z(lake.center.y),
      radius: frame.units(lake.radiusPt * 1.12),
    });
  }
  for (const p of buildingPlacements(tp, frame)) {
    out.push({
      kind: 'building',
      x: frame.x(p.pt.x),
      z: frame.z(p.pt.y),
      radius: Math.hypot(p.shape.lengthMm / 2, p.shape.widthMm / 2) * MM,
    });
  }
  const beacon = notausBeaconPosition(frame);
  out.push({ kind: 'beacon', x: beacon.x, z: beacon.z, radius: 10 * MM });
  return out;
}

/** Where the trackside Notaus beacon stands (world x/z), shared with `cameras.ts`. */
export function notausBeaconPosition(frame: PlanFrame): { x: number; z: number } {
  const b = frame.bounds;
  return {
    x: frame.x((b.minX + b.maxX) / 2),
    z: frame.z(b.maxY + BOARD_MARGIN_PT * 0.55),
  };
}

// ────────────────────────────── landscape ──────────────────────────────

export interface LandscapeResult {
  readonly group: Group;
  readonly stations: readonly DerivedStation[];
  /** the height field the massif was built from — the SceneManager hides the train by it */
  readonly terrain: Terrain;
  /** lights the trackside Notaus beacon while the emergency stop is engaged */
  setNotaus(active: boolean): void;
}

export interface LandscapeArgs {
  readonly tp: TrackplanFile;
  readonly curves: ReadonlyMap<string, EdgeCurve>;
  readonly frame: PlanFrame;
  readonly mats: SceneMaterials;
  readonly labels: LabelFactory;
  readonly quality?: SceneQuality;
}

export function buildLandscape(args: LandscapeArgs): LandscapeResult {
  const { tp, curves, frame, mats, labels } = args;
  const quality: SceneQuality = args.quality ?? 'high';
  const group = new Group();
  group.name = 'landscape';
  const rand = mulberry32(0x5eed);
  const { terrain, sites, bores } = resolveTunnels(tp, curves, frame);

  group.add(buildBaseboard(frame, mats, quality));

  group.add(buildMassif(tp, frame, terrain, sites, mats, quality));

  if (tp.landscape.lake) group.add(buildLake(tp.landscape.lake, frame, mats));

  group.add(buildTunnelPortals(curves, sites, bores, mats, quality));

  const buildings = new Group();
  buildings.name = 'buildings';
  for (const placement of buildingPlacements(tp, frame)) {
    buildings.add(buildBuilding(placement, frame, terrain, mats, quality));
  }
  group.add(buildings);

  const stations = deriveStations(tp);
  group.add(buildStations(stations, curves, mats, labels, quality));

  group.add(buildTrees(tp, curves, frame, terrain, mats, rand, quality));

  const beacon = buildNotausBeacon(frame, mats);
  group.add(beacon.group);

  return {
    group,
    stations,
    terrain,
    setNotaus: (active: boolean) => beacon.set(active),
  };
}

/** Rock cover above the baseboard at a world position, in mm of the modelled plant. */
export function terrainCoverMm(terrain: Terrain, frame: PlanFrame, at: Vector3): number {
  return terrain.heightAt(frame.planX(at.x), frame.planY(at.z)) / MM;
}

function buildBaseboard(frame: PlanFrame, mats: SceneMaterials, quality: SceneQuality): Group {
  const g = new Group();
  g.name = 'baseboard';
  const w = frame.widthM + 2 * frame.units(BOARD_MARGIN_PT);
  const d = frame.depthM + 2 * frame.units(BOARD_MARGIN_PT);

  const board = new Mesh(new BoxGeometry(w, 4 * MM, d), mats.board);
  board.position.y = -2 * MM;
  board.receiveShadow = quality === 'high';
  board.name = 'board';
  g.add(board);

  // wooden rim around the plate
  const rimH = 14 * MM;
  const rimT = 10 * MM;
  const rims: [number, number, number, number][] = [
    [w + 2 * rimT, rimT, 0, (d + rimT) / 2],
    [w + 2 * rimT, rimT, 0, -(d + rimT) / 2],
    [rimT, d, (w + rimT) / 2, 0],
    [rimT, d, -(w + rimT) / 2, 0],
  ];
  for (const [sx, sz, px, pz] of rims) {
    const rim = new Mesh(new BoxGeometry(sx, rimH, sz), mats.boardEdge);
    rim.position.set(px, -rimH / 2 + 2 * MM, pz);
    g.add(rim);
  }
  return g;
}

/**
 * The whole relief as ONE height-field mesh (plus a moss skirt per massif).
 *
 * A single mesh, not one per mountain, because overlapping massifs would otherwise render
 * two coincident surfaces in their intersection (z-fighting). Quads are emitted with an
 * upward winding by construction — `(i,j) → (i,j+1) → (i+1,j+1)` in a plan grid where world
 * x follows plan x and world z follows plan y — so no camera can ever see an unlit back
 * face of the massif, and quads whose four corners are all at ground level are dropped
 * (that is the bare board and the floor of every rock cutting).
 *
 * **The mouths are pierced.** A height field is a single-valued surface, so where it steps up
 * from the open approach to full cover it forms a wall right across the track — that wall was
 * D8's "rails run into an unbroken hillside". Quads inside a mouth window are therefore
 * dropped, leaving a genuine hole; the portal's masonry headwall is wider and taller than the
 * hole and stands in the same plane, so nothing looks through the mountain.
 */
function buildMassif(
  tp: TrackplanFile,
  frame: PlanFrame,
  terrain: Terrain,
  sites: readonly PortalSite[],
  mats: SceneMaterials,
  quality: SceneQuality,
): Group {
  const g = new Group();
  g.name = 'mountains';
  const extent = terrain.extent;
  if (!extent) return g;

  const cellPt = quality === 'high' ? 2.5 : 5;
  const nx = Math.max(2, Math.ceil((extent.maxX - extent.minX) / cellPt));
  const ny = Math.max(2, Math.ceil((extent.maxY - extent.minY) / cellPt));
  const stepX = (extent.maxX - extent.minX) / nx;
  const stepY = (extent.maxY - extent.minY) / ny;

  const heights: number[] = [];
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j <= ny; j += 1) {
      heights.push(terrain.heightPt(extent.minX + i * stepX, extent.minY + j * stepY));
    }
  }
  const at = (i: number, j: number): number => heights[i * (ny + 1) + j] ?? 0;

  const positions: number[] = [];
  const indices: number[] = [];
  const vertexOf = new Map<number, number>();
  const emit = (i: number, j: number): number => {
    const key = i * (ny + 1) + j;
    const existing = vertexOf.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(
      frame.x(extent.minX + i * stepX),
      frame.units(at(i, j)) + TERRAIN_LIFT_MM * MM,
      frame.z(extent.minY + j * stepY),
    );
    vertexOf.set(key, index);
    return index;
  };

  // mouth windows in plan space: aperture half width plus one cell, and one cell either side
  // of the mouth plane (the headwall is `thick` = 12 mm deep, so the hole stays behind it)
  const windows = sites.map((site) => ({
    at: { x: frame.planX(site.position.x), y: frame.planY(site.position.z) },
    tangent: { x: site.tangent.x, y: site.tangent.z },
    lateral: { x: -site.tangent.z, y: site.tangent.x },
    alongPt: 1.2 * cellPt,
    latPt: PORTAL.openW / 2 / frame.mmPerUnit + 0.6 * cellPt,
  }));
  const inMouthWindow = (px: number, py: number): boolean =>
    windows.some((w) => {
      const dx = px - w.at.x;
      const dy = py - w.at.y;
      return (
        Math.abs(dx * w.tangent.x + dy * w.tangent.y) <= w.alongPt &&
        Math.abs(dx * w.lateral.x + dy * w.lateral.y) <= w.latPt
      );
    });

  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      if (at(i, j) <= 0 && at(i + 1, j) <= 0 && at(i, j + 1) <= 0 && at(i + 1, j + 1) <= 0) {
        continue;
      }
      // pierce the mouth: drop the wall quads that would seal the aperture
      const lowest = Math.min(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
      if (lowest * frame.mmPerUnit < PORTAL.wallTop) {
        let pierced = false;
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          if (inMouthWindow(extent.minX + (i + di) * stepX, extent.minY + (j + dj) * stepY)) {
            pierced = true;
            break;
          }
        }
        if (pierced) continue;
      }
      const v00 = emit(i, j);
      const v01 = emit(i, j + 1);
      const v10 = emit(i + 1, j);
      const v11 = emit(i + 1, j + 1);
      indices.push(v00, v01, v11, v00, v11, v10);
    }
  }
  if (indices.length === 0) return g;

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  const massif = new Mesh(geom, mats.rock);
  massif.name = 'massif';
  massif.castShadow = quality === 'high';
  massif.receiveShadow = quality === 'high';
  g.add(massif);

  // moss / scatter-grass skirt: a flat annulus hugging each base, not a second cone
  for (const spec of tp.landscape.mountains) {
    const c = frame.v(spec.center);
    const r = frame.units(spec.radiusPt);
    const skirt = new Mesh(new RingGeometry(r * 0.9, r * 1.12, quality === 'high' ? 48 : 24), mats.moss);
    skirt.name = 'mountainSkirt';
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.copy(c).setY(0.4 * MM);
    g.add(skirt);
  }
  return g;
}

function buildLake(
  spec: { center: Vec2; radiusPt: number },
  frame: PlanFrame,
  mats: SceneMaterials,
): Group {
  const g = new Group();
  g.name = 'lake';
  const c = frame.v(spec.center);
  const r = frame.units(spec.radiusPt);

  const water = new Mesh(new CircleGeometry(r, 40), mats.water);
  water.rotation.x = -Math.PI / 2;
  water.position.copy(c).setY(1.2 * MM);
  g.add(water);

  // shore: a flat gravel annulus around the water (never over it)
  const shore = new Mesh(new RingGeometry(r * 0.98, r * 1.12, 48), mats.rockDark);
  shore.rotation.x = -Math.PI / 2;
  shore.position.copy(c).setY(0.9 * MM);
  g.add(shore);

  // rocky island with a few bare branches (video 04:28)
  const island = new Mesh(new SphereGeometry(r * 0.16, 10, 8), mats.rock);
  island.name = 'lakeIsland';
  island.scale.y = 0.4;
  island.position.copy(c).setY(1.6 * MM);
  g.add(island);
  for (const [ox, oz, hMm] of [
    [0.05, -0.03, 22],
    [-0.06, 0.04, 16],
  ] as const) {
    const branch = new Mesh(
      new CylinderGeometry(0.5 * MM, 0.8 * MM, hMm * MM, 5),
      mats.treeTrunk,
    );
    branch.position.set(c.x + r * ox, (hMm / 2) * MM, c.z + r * oz);
    branch.rotation.z = 0.15;
    g.add(branch);
  }
  return g;
}

/**
 * Tunnel portals at the geometric mouths from `resolveTunnels()`. Each mouth gets a masonry
 * headwall with a real aperture plus a dark bore reaching into the rock, so the rails visibly
 * run into an opening rather than into a slope.
 */
function buildTunnelPortals(
  curves: ReadonlyMap<string, EdgeCurve>,
  sites: readonly PortalSite[],
  bores: readonly BoreSpan[],
  mats: SceneMaterials,
  quality: SceneQuality,
): Group {
  const g = new Group();
  g.name = 'tunnelPortals';
  for (const site of sites) g.add(buildPortal(site, mats, quality));
  for (const span of bores) {
    const curve = curves.get(span.edgeId);
    if (curve) g.add(buildBore(curve, span, mats));
  }
  return g;
}

/**
 * The dark bore, swept along the track between the two mouths — not a straight box: `e68`
 * turns ~25° between its portals, and a box long enough to bridge them would poke out of the
 * rock sideways. `mats.tunnelDark` is unlit and double sided, so the tube reads as a hole
 * from every angle.
 */
function buildBore(curve: EdgeCurve, span: BoreSpan, mats: SceneMaterials): Mesh {
  const half = PORTAL.openW / 2 + PORTAL.boreOversize;
  const top = PORTAL.openH + PORTAL.boreOversize;
  const profile = [
    { u: -half, v: 0 },
    { u: -half, v: top },
    { u: half, v: top },
    { u: half, v: 0 },
    { u: -half, v: 0 },
  ];
  const accum = new MeshAccum();
  // start a hair inside each mouth so the tube's rim hides behind the headwall
  const inset = 2;
  accum.sweep(
    samplePath(curve, Math.min(span.startMm + inset, span.endMm), Math.max(span.endMm - inset, span.startMm)),
    profile,
  );
  const mesh = new Mesh(accum.toGeometry(), mats.tunnelDark);
  mesh.name = `bore:${span.edgeId}`;
  return mesh;
}

/**
 * One tunnel mouth: a masonry headwall pierced by the aperture, standing in the rock face with
 * its **outer** face on the mouth plane and its body reaching `thick` mm into the hill. Built
 * as three blocks — left of the aperture, right of it, and the lintel over it — so the middle
 * is a genuine hole and not a dark decal. The blocks are placed at ±(openW/2 + …), i.e.
 * symmetric about the track centre line by construction; `tests/scene/terrain.test.ts` measures
 * the residual offset.
 */
function buildPortal(site: PortalSite, mats: SceneMaterials, quality: SceneQuality): Group {
  const g = new Group();
  g.name = 'portal';
  const { openW, openH, wallHalf, wallTop, thick } = PORTAL;
  g.position.copy(site.position).setY(0);
  g.rotation.y = yawOfTangent(site.tangent);
  const cast = quality === 'high';
  // darker masonry than the plaster rock around it, so the frame reads as a *structure*
  // and not as a crack in the slope from the Orbit and Bird cameras
  const stone = mats.rockDark;
  // local +x is the track tangent; the wall body sits between the plane and `thick` inward
  const midX = site.inward * (thick / 2) * MM;

  const jambW = wallHalf - openW / 2;
  for (const sz of [1, -1]) {
    const jamb = new Mesh(new BoxGeometry(thick * MM, openH * MM, jambW * MM), stone);
    jamb.position.set(midX, (openH / 2) * MM, sz * ((openW + jambW) / 2) * MM);
    jamb.castShadow = cast;
    jamb.name = `portalJamb:${sz > 0 ? 'right' : 'left'}`;
    g.add(jamb);
  }
  const lintel = new Mesh(
    new BoxGeometry(thick * MM, (wallTop - openH) * MM, 2 * wallHalf * MM),
    stone,
  );
  lintel.position.set(midX, ((wallTop + openH) / 2) * MM, 0);
  lintel.castShadow = cast;
  lintel.name = 'portalLintel';
  g.add(lintel);

  // parapet cap reaching back into the slope: the part of a portal a top-down camera can see
  const cap = new Mesh(
    new BoxGeometry((thick + 18) * MM, 5 * MM, (2 * wallHalf + 8) * MM),
    stone,
  );
  cap.position.set(site.inward * ((thick + 18) / 2 - 2) * MM, (wallTop + 2.5) * MM, 0);
  cap.castShadow = cast;
  cap.name = 'portalCap';
  g.add(cap);
  return g;
}

/** Footprint and materials of a building kind, in mm of the modelled plant. */
interface BuildingShape {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** round footprint (the lookout tower's shaft) — probed on its axes, it has no corners */
  readonly tower: boolean;
}

function buildingShape(kind: string): BuildingShape {
  const k = kind.toLowerCase();
  if (k.includes('turm') || k.includes('tower')) {
    // the shaft is CylinderGeometry(11, 15, 130): a 30 mm base circle, 157 mm to the roof tip.
    // Recording the *bounding box* (40 mm, i.e. the observation deck) here instead made the
    // ground probe reach 28 mm out into the rock cutting beside the summit and sink the tower
    // 67 mm into its own mountain (REVIEW_SCENE.md D7).
    return { lengthMm: 30, widthMm: 30, heightMm: 157, tower: true };
  }
  if (k.includes('lokschuppen') || k.includes('shed')) {
    return { lengthMm: 210, widthMm: 95, heightMm: 66, tower: false };
  }
  if (k.includes('bahnhof') || k.includes('station')) {
    return { lengthMm: 175, widthMm: 72, heightMm: 58, tower: false };
  }
  if (k.includes('baecker') || k.includes('bäcker') || k.includes('bakery')) {
    return { lengthMm: 105, widthMm: 68, heightMm: 52, tower: false };
  }
  return { lengthMm: 150, widthMm: 70, heightMm: 55, tower: false };
}

/** A building spec after the scene has pushed it clear of the track. */
export interface BuildingPlacement {
  readonly spec: BuildingSpec;
  readonly shape: BuildingShape;
  /** placement actually used, in plan units */
  readonly pt: Vec2;
  /** distance of the footprint from the nearest track centre line, in mm */
  readonly trackClearanceMm: number;
}

/** Clearance a building footprint must keep from a track centre line: behind the platform. */
export const BUILDING_CLEARANCE_MM = DIM.platformOffset + DIM.platformWidth;
/** Shallowest a building may be modelled when the plate margin is tight, mm. */
const BUILDING_MIN_DEPTH_MM = 40;

/**
 * Places the decorative buildings (§7.1 `landscape.buildings` is a *hint*, §5.4 "decorative
 * accuracy is approximate"). Three of the four station buildings in `trackplan.json` foul the
 * neighbouring track — the BH1 one stands 5.6 mm from the centre line, i.e. on the ballast
 * shoulder, which is what shows up as a building corner touching the track in the Cab view.
 *
 * Two deterministic steps, both scene-side (`trackplan.json` is never modified):
 * 1. push the footprint away from its nearest track along the local normal, clamped so it
 *    stays on the baseboard;
 * 2. if the plate's 26 pt margin still cannot hold platform *and* building, model the
 *    building shallower (a long, low station building instead of a deep one) until its wall
 *    lands behind the platform edge, where a station building belongs.
 */
export function buildingPlacements(tp: TrackplanFile, frame: PlanFrame): BuildingPlacement[] {
  const b = frame.bounds;
  const limit = {
    minX: b.minX - BOARD_MARGIN_PT + 1,
    maxX: b.maxX + BOARD_MARGIN_PT - 1,
    minY: b.minY - BOARD_MARGIN_PT + 1,
    maxY: b.maxY + BOARD_MARGIN_PT - 1,
  };
  const out: BuildingPlacement[] = [];
  for (const spec of tp.landscape.buildings) {
    const full = buildingShape(spec.kind);
    // towers stand on the massif, away from any track — leave them exactly where asked
    if (full.tower) {
      out.push({ spec, shape: full, pt: spec.pt, trackClearanceMm: Number.POSITIVE_INFINITY });
      continue;
    }
    let best: BuildingPlacement | null = null;
    for (const factor of [1, 0.8, 0.65, 0.55]) {
      const depth = Math.max(BUILDING_MIN_DEPTH_MM, full.widthMm * factor);
      const shape: BuildingShape = {
        ...full,
        widthMm: depth,
        heightMm: Math.min(full.heightMm, depth * 1.15),
      };
      const placed = nudgeClearOfTrack(tp, frame, spec, shape, limit);
      if (!best || placed.trackClearanceMm > best.trackClearanceMm) best = placed;
      if (placed.trackClearanceMm >= BUILDING_CLEARANCE_MM) break;
      if (depth <= BUILDING_MIN_DEPTH_MM) break;
    }
    if (best) out.push(best);
  }
  return out;
}

/** Step 1: slide one footprint outwards along the normal of its nearest track. */
function nudgeClearOfTrack(
  tp: TrackplanFile,
  frame: PlanFrame,
  spec: BuildingSpec,
  shape: BuildingShape,
  limit: { minX: number; minY: number; maxX: number; maxY: number },
): BuildingPlacement {
  const nearest = nearestTrack(tp, spec.pt, shape);
  const start = nearest?.distancePt ?? Number.POSITIVE_INFINITY;
  let best = { pt: spec.pt, clearance: start };
  if (nearest && start * frame.mmPerUnit < BUILDING_CLEARANCE_MM) {
    const stepPt = 0.25;
    const maxStep = Math.ceil(BUILDING_CLEARANCE_MM / frame.mmPerUnit / stepPt) + 4;
    for (let k = 1; k <= maxStep; k += 1) {
      const cand = {
        x: spec.pt.x + nearest.away.x * stepPt * k,
        y: spec.pt.y + nearest.away.y * stepPt * k,
      };
      if (!footprintInside(cand, shape, frame, limit)) break;
      const d = nearestTrack(tp, cand, shape)?.distancePt ?? Number.POSITIVE_INFINITY;
      if (d > best.clearance) best = { pt: cand, clearance: d };
      if (d * frame.mmPerUnit >= BUILDING_CLEARANCE_MM) break;
    }
  }
  return {
    spec,
    shape,
    pt: best.pt,
    trackClearanceMm: best.clearance * frame.mmPerUnit,
  };
}

/** Distance (plan units) of a building footprint from the closest track centre line. */
function nearestTrack(
  tp: TrackplanFile,
  pt: Vec2,
  shape: BuildingShape,
): { distancePt: number; away: Vec2 } | null {
  const hl = shape.lengthMm / 2 / mmPerUnitOf(tp);
  const hw = shape.widthMm / 2 / mmPerUnitOf(tp);
  let best: { distancePt: number; away: Vec2 } | null = null;
  for (const e of tp.edges) {
    for (let i = 1; i < e.pts.length; i += 1) {
      const a = e.pts[i - 1];
      const c = e.pts[i];
      if (!a || !c) continue;
      const near = closestPointOnSegment(pt, a, c);
      // distance from the rectangle, not from its centre (axis-aligned box vs point)
      const dx = Math.max(0, Math.abs(near.x - pt.x) - hl);
      const dy = Math.max(0, Math.abs(near.y - pt.y) - hw);
      const distancePt = Math.hypot(dx, dy);
      if (best && distancePt >= best.distancePt) continue;
      const vx = pt.x - near.x;
      const vy = pt.y - near.y;
      const len = Math.hypot(vx, vy) || 1;
      best = { distancePt, away: { x: vx / len, y: vy / len } };
    }
  }
  return best;
}

function mmPerUnitOf(tp: TrackplanFile): number {
  return tp.meta.mmPerUnit || 1;
}

function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Lowest terrain (world y) under a building footprint: its centre plus the outline. A box is
 * probed at its four corners, a round footprint on its four axes — probing a cylinder at the
 * corners of its bounding square reaches 41 % further out than the shaft actually stands, and
 * on a summit next to a rock cutting that is the difference between a tower and a stump.
 */
function groundUnderFootprint(
  terrain: Terrain,
  frame: PlanFrame,
  pt: Vec2,
  shape: BuildingShape,
): number {
  const hl = shape.lengthMm / 2 / frame.mmPerUnit;
  const hw = shape.widthMm / 2 / frame.mmPerUnit;
  const offsets: readonly (readonly [number, number])[] = shape.tower
    ? [
        [hl, 0],
        [-hl, 0],
        [0, hw],
        [0, -hw],
      ]
    : [
        [hl, hw],
        [hl, -hw],
        [-hl, hw],
        [-hl, -hw],
      ];
  let low = terrain.heightAt(pt.x, pt.y);
  for (const [dx, dy] of offsets) {
    const h = terrain.heightAt(pt.x + dx, pt.y + dy);
    if (h < low) low = h;
  }
  return low;
}

function footprintInside(
  pt: Vec2,
  shape: BuildingShape,
  frame: PlanFrame,
  limit: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const hl = shape.lengthMm / 2 / frame.mmPerUnit;
  const hw = shape.widthMm / 2 / frame.mmPerUnit;
  return (
    pt.x - hl >= limit.minX &&
    pt.x + hl <= limit.maxX &&
    pt.y - hw >= limit.minY &&
    pt.y + hw <= limit.maxY
  );
}

function buildBuilding(
  placement: BuildingPlacement,
  frame: PlanFrame,
  terrain: Terrain,
  mats: SceneMaterials,
  quality: SceneQuality,
): Group {
  const { spec, shape, pt } = placement;
  const g = new Group();
  g.name = `building:${spec.kind}`;
  g.position.copy(frame.v(pt));
  // stand on the terrain: the lookout tower sits on a mountain (video 03:56). The *lowest*
  // point under the footprint, not the centre — on a slope that embeds the uphill wall in the
  // rock (which reads as a building cut into the hillside) instead of leaving a visible gap
  // under the downhill one.
  g.position.y = groundUnderFootprint(terrain, frame, pt, shape);
  g.rotation.y = (-spec.rotDeg * Math.PI) / 180;
  const cast = quality === 'high';

  const kind = spec.kind.toLowerCase();
  if (shape.tower) {
    const shaft = new Mesh(new CylinderGeometry(11 * MM, 15 * MM, 130 * MM, 10), mats.tower);
    shaft.position.y = 65 * MM;
    shaft.castShadow = cast;
    g.add(shaft);
    const deck = new Mesh(new CylinderGeometry(19 * MM, 19 * MM, 5 * MM, 10), mats.wall);
    deck.position.y = 132 * MM;
    g.add(deck);
    const roof = new Mesh(new ConeGeometry(20 * MM, 22 * MM, 10), mats.roofDark);
    roof.position.y = 146 * MM;
    g.add(roof);
    return g;
  }

  const { lengthMm, widthMm, heightMm } = shape;
  const brick = kind.includes('lokschuppen') || kind.includes('shed');
  const wallMat = brick ? mats.wallBrick : mats.wall;
  const roofMat = brick ? mats.roofDark : mats.roof;

  const walls = new Mesh(
    new BoxGeometry(lengthMm * MM, heightMm * MM, widthMm * MM),
    wallMat,
  );
  walls.position.y = (heightMm / 2) * MM;
  walls.castShadow = cast;
  walls.receiveShadow = cast;
  g.add(walls);

  const roof = new Mesh(gableRoofGeometry(lengthMm + 12, widthMm + 12, 26), roofMat);
  roof.position.y = heightMm * MM;
  roof.castShadow = cast;
  g.add(roof);

  // door + windows as thin dark plates on the long side
  const windowMat = mats.windowGlass;
  for (let i = -1; i <= 1; i += 1) {
    const win = new Mesh(new BoxGeometry(22 * MM, 18 * MM, 1 * MM), windowMat);
    win.position.set(i * (lengthMm / 3.4) * MM, (heightMm * 0.55) * MM, (widthMm / 2 + 0.5) * MM);
    g.add(win);
  }
  return g;
}

/**
 * A simple gable roof prism (ridge along the building's local +x).
 *
 * The winding matters: three.js culls back faces for `FrontSide` materials and derives the
 * vertex normals from the same triangle order. The index list below is wound so that every
 * face normal points *away* from the roof volume (checked in `tests/scene/landscape.test.ts`
 * — the slope normals must have `y > 0`). The earlier order was inverted, which made every
 * roof invisible from the outside and left the buildings as flat-topped boxes.
 */
function gableRoofGeometry(lengthMm: number, widthMm: number, heightMm: number): BufferGeometry {
  const l = (lengthMm / 2) * MM;
  const w = (widthMm / 2) * MM;
  const h = heightMm * MM;
  const v = [
    -l, 0, -w, // 0
    l, 0, -w, // 1
    l, 0, w, // 2
    -l, 0, w, // 3
    -l, h, 0, // 4 ridge back
    l, h, 0, // 5 ridge front
  ];
  const idx = [
    0, 5, 1, 0, 4, 5, // north slope (faces -z / +y)
    2, 4, 3, 2, 5, 4, // south slope (faces +z / +y)
    0, 3, 4, // west gable (faces -x)
    1, 5, 2, // east gable (faces +x)
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildStations(
  stations: readonly DerivedStation[],
  curves: ReadonlyMap<string, EdgeCurve>,
  mats: SceneMaterials,
  labels: LabelFactory,
  quality: SceneQuality,
): Group {
  const g = new Group();
  g.name = 'stations';

  for (const station of stations) {
    // station centroid: mid point of every lane, used to pick the platform side
    const mids: Vector3[] = [];
    for (const lane of station.lanes) {
      const curve = curves.get(lane.edgeId);
      if (!curve) continue;
      mids.push(poseAtOffsetMm(curve, (lane.startMm + lane.endMm) / 2).position);
    }
    if (mids.length === 0) continue;
    const centroid = mids
      .reduce((acc, p) => acc.add(p), new Vector3())
      .multiplyScalar(1 / mids.length);

    let boardAnchor: { position: Vector3; tangent: Vector3; lateral: Vector3; side: 1 | -1 } | null =
      null;

    for (const lane of station.lanes) {
      const curve = curves.get(lane.edgeId);
      if (!curve) continue;
      const startMm = Math.max(0, Math.min(lane.startMm, curve.lengthMm - 20));
      const endMm = Math.min(curve.lengthMm, Math.max(lane.endMm, startMm + 40));
      const midPose = poseAtOffsetMm(curve, (startMm + endMm) / 2);
      const lateral = lateralOf(midPose.tangent);
      const away = midPose.position.clone().sub(centroid);
      const side: 1 | -1 = away.dot(lateral) >= 0 ? 1 : -1;

      const path = samplePath(curve, startMm, endMm);
      const accum = new MeshAccum();
      accum.sweep(path, platformProfile(side));
      const platform = new Mesh(accum.toGeometry(), mats.platform);
      platform.name = `platform:${station.key}:${lane.laneKey}`;
      platform.receiveShadow = quality === 'high';
      g.add(platform);

      // small track-number plate on the platform, offset along the track so it never
      // collides with the station name board (which stands at the lane mid point)
      const platePose = poseAtOffsetMm(curve, startMm + (endMm - startMm) * 0.75);
      const plate = labels.createPlate(lane.laneKey, { lengthMm: 18 });
      plate.position
        .copy(platePose.position)
        .addScaledVector(
          lateralOf(platePose.tangent),
          side * (DIM.platformOffset + DIM.platformWidth * 0.5) * MM,
        );
      plate.position.y = (DIM.platformHeight + 0.5) * MM;
      plate.rotation.y = yawOfTangent(platePose.tangent);
      // deconflictPlates retreats a crowded plate towards what it names (D17)
      plate.userData['anchorWorld'] = platePose.position.clone();
      g.add(plate);

      if (!boardAnchor) {
        boardAnchor = { position: midPose.position.clone(), tangent: midPose.tangent.clone(), lateral, side };
      }
    }

    if (boardAnchor) {
      // the name board stands on the platform, like the real station signs
      const board = labels.createBoard(station.key);
      board.position
        .copy(boardAnchor.position)
        .addScaledVector(
          boardAnchor.lateral,
          boardAnchor.side * (DIM.platformOffset + DIM.platformWidth * 0.5) * MM,
        );
      board.position.y = DIM.platformHeight * MM;
      board.rotation.y = yawOfTangent(boardAnchor.tangent);
      g.add(board);
    }
  }
  return g;
}

/** Samples an edge between two offsets into a polyline (≈ 25 mm steps). */
function samplePath(curve: EdgeCurve, startMm: number, endMm: number): Vector3[] {
  const out: Vector3[] = [];
  const span = endMm - startMm;
  const steps = Math.max(2, Math.ceil(span / 25));
  for (let i = 0; i <= steps; i += 1) {
    out.push(poseAtOffsetMm(curve, startMm + (span * i) / steps).position);
  }
  return out;
}

function buildTrees(
  tp: TrackplanFile,
  curves: ReadonlyMap<string, EdgeCurve>,
  frame: PlanFrame,
  terrain: Terrain,
  mats: SceneMaterials,
  rand: () => number,
  quality: SceneQuality,
): Group {
  const g = new Group();
  g.name = 'trees';
  const count = quality === 'high' ? 150 : 60;

  // occupancy grid of the track corridor so no tree grows between the rails
  const cellPt = 9;
  const occupied = new Set<string>();
  const key = (cx: number, cy: number): string => `${cx}|${cy}`;
  for (const e of tp.edges) {
    const curve = curves.get(e.id);
    if (!curve) continue;
    const steps = Math.max(2, Math.ceil(curve.lengthMm / (cellPt * frame.mmPerUnit)));
    for (let i = 0; i <= steps; i += 1) {
      const p = poseAtOffsetMm(curve, (curve.lengthMm * i) / steps).position;
      const px = p.x / frame.scale + frame.centre.x;
      const py = p.z / frame.scale + frame.centre.y;
      const cx = Math.floor(px / cellPt);
      const cy = Math.floor(py / cellPt);
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) occupied.add(key(cx + dx, cy + dy));
      }
    }
  }

  const b = frame.bounds;
  const trunkMatrices: Matrix4[] = [];
  const foliageMatrices: Matrix4[][] = [[], []];
  let attempts = 0;
  while (trunkMatrices.length < count && attempts < count * 40) {
    attempts += 1;
    const px = b.minX - 10 + rand() * (b.maxX - b.minX + 20);
    const py = b.minY - 10 + rand() * (b.maxY - b.minY + 20);
    if (occupied.has(key(Math.floor(px / cellPt), Math.floor(py / cellPt)))) continue;
    const lake = tp.landscape.lake;
    if (lake && dist2(px, py, lake.center) < (lake.radiusPt * 1.15) ** 2) continue;
    const ground = terrain.heightAt(px, py);
    const scale = 0.75 + rand() * 0.7;
    const pos = new Vector3(frame.x(px), ground, frame.z(py));
    const q = new Quaternion();
    const trunkH = 14 * scale;
    trunkMatrices.push(
      new Matrix4().compose(
        pos.clone().setY(ground + (trunkH / 2) * MM),
        q,
        new Vector3(scale, scale, scale),
      ),
    );
    const bucket = foliageMatrices[trunkMatrices.length % 2] ?? foliageMatrices[0];
    bucket?.push(
      new Matrix4().compose(
        pos.clone().setY(ground + (trunkH + 20 * scale) * MM),
        q,
        new Vector3(scale, scale, scale),
      ),
    );
  }

  if (trunkMatrices.length > 0) {
    const trunkGeom = new CylinderGeometry(1.4 * MM, 2.2 * MM, 14 * MM, 5);
    const trunks = new InstancedMesh(trunkGeom, mats.treeTrunk, trunkMatrices.length);
    for (let i = 0; i < trunkMatrices.length; i += 1) {
      const m = trunkMatrices[i];
      if (m) trunks.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    g.add(trunks);

    const foliageGeom = new ConeGeometry(9 * MM, 40 * MM, 7);
    const foliageMats = [mats.treeFoliage, mats.treeFoliageLight];
    for (let bucketIdx = 0; bucketIdx < foliageMatrices.length; bucketIdx += 1) {
      const bucket = foliageMatrices[bucketIdx];
      const mat = foliageMats[bucketIdx] ?? mats.treeFoliage;
      if (!bucket || bucket.length === 0) continue;
      const inst = new InstancedMesh(foliageGeom, mat, bucket.length);
      for (let i = 0; i < bucket.length; i += 1) {
        const m = bucket[i];
        if (m) inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = quality === 'high';
      g.add(inst);
    }
  }
  return g;
}

function dist2(px: number, py: number, c: Vec2): number {
  return (px - c.x) ** 2 + (py - c.y) ** 2;
}

function buildNotausBeacon(
  frame: PlanFrame,
  mats: SceneMaterials,
): { group: Group; set(active: boolean): void } {
  const g = new Group();
  g.name = 'notausBeacon';
  const at = notausBeaconPosition(frame);
  g.position.set(at.x, 0, at.z);

  const post = new Mesh(new CylinderGeometry(2 * MM, 2.6 * MM, 60 * MM, 8), mats.switchMotor);
  post.position.y = 30 * MM;
  g.add(post);
  const dome = new Mesh(new SphereGeometry(7 * MM, 12, 10), mats.notausBeaconOff);
  dome.position.y = 66 * MM;
  g.add(dome);

  return {
    group: g,
    set: (active: boolean) => {
      dome.material = active ? mats.notausBeaconOn : mats.notausBeaconOff;
    },
  };
}
