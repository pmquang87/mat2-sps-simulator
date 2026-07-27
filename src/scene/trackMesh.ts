/**
 * Track geometry: plan → world transform, polyline sampling, extruded track ribbons
 * (ARCHITECTURE.md §3 `scene/trackMesh.ts`).
 *
 * Everything is derived read-only from `TrackplanFile` (§7.1). The arc-length
 * parametrisation is deliberately the *same* linear polyline interpolation the plant uses
 * for `offsetMm` (§6.3: "arc-length stepping uses precomputed cumulative polyline
 * lengths") — so a reed at `offsetMm` renders exactly where the plant thinks it is, and
 * `PlantSnapshot.train.worldPos` lands on the rails.
 *
 * Pure geometry helpers in this file touch neither the DOM nor a clock, so they are unit
 * testable in the node environment.
 */
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { TrackEdgeSpec, TrackplanFile, TrackplanMeta, Vec2 } from '../plant';
import { DIM, type SceneMaterials, type SceneQuality } from './materials';

/** 1 mm of the modelled plant expressed in world units (world unit = 1 m). */
export const MM = 0.001;

const UP = new Vector3(0, 1, 0);

export interface PlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Plan-space (Gleisplan pt, y grows downward) → world-space (metres, y up) transform.
 * The plan centre becomes the world origin; plan +x → world +x, plan +y → world +z, so a
 * top-down camera with `up = -z` shows the plan exactly as printed.
 */
export class PlanFrame {
  readonly mmPerUnit: number;
  readonly bounds: PlanBounds;
  /** world metres per plan unit */
  readonly scale: number;
  readonly centre: Vec2;
  readonly widthM: number;
  readonly depthM: number;

  constructor(meta: TrackplanMeta, bounds: PlanBounds) {
    this.mmPerUnit = meta.mmPerUnit;
    this.bounds = bounds;
    this.scale = meta.mmPerUnit * MM;
    this.centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    this.widthM = (bounds.maxX - bounds.minX) * this.scale;
    this.depthM = (bounds.maxY - bounds.minY) * this.scale;
  }

  static fromTrackplan(tp: TrackplanFile): PlanFrame {
    return new PlanFrame(tp.meta, planBounds(tp));
  }

  /** plan x → world x */
  x(px: number): number {
    return (px - this.centre.x) * this.scale;
  }

  /** plan y → world z */
  z(py: number): number {
    return (py - this.centre.y) * this.scale;
  }

  /** plan point (+ height in mm) → world position */
  v(p: Vec2, heightMm = 0): Vector3 {
    return new Vector3(this.x(p.x), heightMm * MM, this.z(p.y));
  }

  /** world x → plan x (inverse of `x`) */
  planX(x: number): number {
    return x / this.scale + this.centre.x;
  }

  /** world z → plan y (inverse of `z`) */
  planY(z: number): number {
    return z / this.scale + this.centre.y;
  }

  /** plan units → world metres (lengths, radii) */
  units(u: number): number {
    return u * this.scale;
  }

  /** plan units → mm of the modelled plant */
  unitsToMm(u: number): number {
    return u * this.mmPerUnit;
  }
}

/** Bounding box of every node and edge vertex in plan space. */
export function planBounds(tp: TrackplanFile): PlanBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (p: Vec2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const n of tp.nodes) consider(n.pt);
  for (const e of tp.edges) for (const p of e.pts) consider(p);
  if (tp.landscape.lake) {
    const l = tp.landscape.lake;
    consider({ x: l.center.x - l.radiusPt, y: l.center.y - l.radiusPt });
    consider({ x: l.center.x + l.radiusPt, y: l.center.y + l.radiusPt });
  }
  for (const m of tp.landscape.mountains) {
    consider({ x: m.center.x - m.radiusPt, y: m.center.y - m.radiusPt });
    consider({ x: m.center.x + m.radiusPt, y: m.center.y + m.radiusPt });
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 960, maxY: 540 };
  return { minX, minY, maxX, maxY };
}

/** A trackplan edge resampled into world space with cumulative arc lengths in mm. */
export interface EdgeCurve {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly tunnel: boolean;
  /** polyline vertices in world space, y = 0 (baseboard level) */
  readonly points: readonly Vector3[];
  /** cumulative length in mm, `cumMm[0] === 0`, same length as `points` */
  readonly cumMm: readonly number[];
  readonly lengthMm: number;
}

/** Pose (position + tangent) of a point on an edge. */
export interface TrackPose {
  /** world position at baseboard level (y = 0) */
  readonly position: Vector3;
  /** unit tangent in the from→to direction, y = 0 */
  readonly tangent: Vector3;
}

/** Builds the world-space curve of every edge, keyed by edge id. */
export function buildEdgeCurves(tp: TrackplanFile, frame: PlanFrame): Map<string, EdgeCurve> {
  const out = new Map<string, EdgeCurve>();
  for (const e of tp.edges) {
    const curve = buildEdgeCurve(e, frame);
    if (curve) out.set(e.id, curve);
  }
  return out;
}

function buildEdgeCurve(e: TrackEdgeSpec, frame: PlanFrame): EdgeCurve | null {
  const points: Vector3[] = [];
  const cumMm: number[] = [];
  for (const p of e.pts) {
    const w = frame.v(p);
    const prev = points[points.length - 1];
    if (prev && prev.distanceTo(w) < 1e-9) continue; // drop duplicate vertices
    points.push(w);
    cumMm.push(0);
  }
  if (points.length < 2) return null;
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    acc += a.distanceTo(b) / MM; // world metres → mm
    cumMm[i] = acc;
  }
  return {
    id: e.id,
    fromNode: e.from,
    toNode: e.to,
    tunnel: e.tunnel === true,
    points,
    cumMm,
    lengthMm: acc,
  };
}

/** Linear (arc-length) interpolation along an edge, `offsetMm` measured from `from`. */
export function poseAtOffsetMm(curve: EdgeCurve, offsetMm: number): TrackPose {
  const n = curve.points.length;
  const clamped = Math.min(Math.max(offsetMm, 0), curve.lengthMm);
  let seg = 0;
  for (let i = 1; i < n; i += 1) {
    const c = curve.cumMm[i];
    if (c !== undefined && c >= clamped) {
      seg = i - 1;
      break;
    }
    seg = i - 1;
  }
  const a = curve.points[seg];
  const b = curve.points[seg + 1] ?? curve.points[seg];
  const ca = curve.cumMm[seg] ?? 0;
  const cb = curve.cumMm[seg + 1] ?? ca;
  if (!a || !b) {
    return { position: new Vector3(), tangent: new Vector3(1, 0, 0) };
  }
  const span = cb - ca;
  const t = span > 1e-9 ? (clamped - ca) / span : 0;
  const position = a.clone().lerp(b, t);
  const tangent = b.clone().sub(a);
  if (tangent.lengthSq() < 1e-18) tangent.set(1, 0, 0);
  tangent.y = 0;
  tangent.normalize();
  return { position, tangent };
}

/**
 * Unit direction in which the edge leaves `nodeId` (i.e. pointing away from the node into
 * the edge). Returns `null` when the edge is not incident to the node.
 */
export function directionAtNode(curve: EdgeCurve, nodeId: string): Vector3 | null {
  const pts = curve.points;
  const n = pts.length;
  if (curve.fromNode === nodeId) {
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return null;
    return b.clone().sub(a).setY(0).normalize();
  }
  if (curve.toNode === nodeId) {
    const a = pts[n - 1];
    const b = pts[n - 2];
    if (!a || !b) return null;
    return b.clone().sub(a).setY(0).normalize();
  }
  return null;
}

/** Lateral (right-hand) unit vector of a tangent, in the xz plane. */
export function lateralOf(tangent: Vector3): Vector3 {
  return new Vector3().crossVectors(UP, tangent).normalize();
}

/**
 * World heading angle of a plan-space heading. `PlantSnapshot.train.headingRad` is an
 * angle in the plan frame (atan2(dy, dx), y downward); a mesh whose local forward is +x
 * must be rotated by `-headingRad` around +y to point that way.
 */
export function meshYawFromPlanHeading(headingRad: number): number {
  return -headingRad;
}

/** Plan-space heading → world direction vector. */
export function planHeadingToWorld(headingRad: number): Vector3 {
  return new Vector3(Math.cos(headingRad), 0, Math.sin(headingRad));
}

// ────────────────────────────── swept-profile extrusion ──────────────────────────────

/** One point of a swept cross-section: `u` = lateral mm, `v` = height mm. */
export interface ProfilePoint {
  readonly u: number;
  readonly v: number;
}

/** Accumulator for merged geometry (positions + indices, normals computed at the end). */
export class MeshAccum {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** Sweeps `profile` along `path` (world points, y = 0). */
  sweep(path: readonly Vector3[], profile: readonly ProfilePoint[]): void {
    const n = path.length;
    const m = profile.length;
    if (n < 2 || m < 2) return;
    const base = this.positions.length / 3;
    const tangents: Vector3[] = [];
    for (let i = 0; i < n; i += 1) {
      const prev = path[i - 1];
      const cur = path[i];
      const next = path[i + 1];
      if (!cur) return;
      const t = new Vector3();
      if (prev) t.add(cur.clone().sub(prev).setY(0).normalize());
      if (next) t.add(next.clone().sub(cur).setY(0).normalize());
      if (t.lengthSq() < 1e-18) t.set(1, 0, 0);
      tangents.push(t.normalize());
    }
    for (let i = 0; i < n; i += 1) {
      const p = path[i];
      const t = tangents[i];
      if (!p || !t) return;
      const lat = lateralOf(t);
      for (let k = 0; k < m; k += 1) {
        const pr = profile[k];
        if (!pr) return;
        this.positions.push(
          p.x + lat.x * pr.u * MM,
          p.y + pr.v * MM,
          p.z + lat.z * pr.u * MM,
        );
      }
    }
    for (let i = 0; i < n - 1; i += 1) {
      for (let k = 0; k < m - 1; k += 1) {
        const a = base + i * m + k;
        const b = base + (i + 1) * m + k;
        const c = base + (i + 1) * m + k + 1;
        const d = base + i * m + k + 1;
        this.indices.push(a, b, c, a, c, d);
      }
    }
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const BALLAST_PROFILE: readonly ProfilePoint[] = [
  { u: -DIM.ballastHalfWidth, v: 0 },
  { u: -DIM.ballastTopHalfWidth, v: DIM.ballastHeight },
  { u: DIM.ballastTopHalfWidth, v: DIM.ballastHeight },
  { u: DIM.ballastHalfWidth, v: 0 },
];

function railProfile(offsetMm: number): readonly ProfilePoint[] {
  const half = DIM.railWidth / 2;
  const foot = DIM.ballastHeight + DIM.sleeperHeight;
  const top = DIM.railTop;
  return [
    { u: offsetMm - half, v: foot },
    { u: offsetMm - half, v: top },
    { u: offsetMm + half, v: top },
    { u: offsetMm + half, v: foot },
  ];
}

/** Cross-section of a station platform, `side = +1` right of the track, `-1` left. */
export function platformProfile(side: 1 | -1): readonly ProfilePoint[] {
  const near = DIM.platformOffset * side;
  const far = (DIM.platformOffset + DIM.platformWidth) * side;
  const h = DIM.platformHeight;
  return side === 1
    ? [{ u: near, v: 0 }, { u: near, v: h }, { u: far, v: h }, { u: far, v: 0 }]
    : [{ u: far, v: 0 }, { u: far, v: h }, { u: near, v: h }, { u: near, v: 0 }];
}

export interface TrackMeshes {
  readonly group: Group;
  readonly sleeperCount: number;
}

/**
 * Builds ballast + rails + sleepers for every edge as three merged/instanced meshes
 * (one draw call each) so even ~35 m of TT track stays cheap.
 */
export function buildTrackMeshes(
  curves: ReadonlyMap<string, EdgeCurve>,
  mats: SceneMaterials,
  quality: SceneQuality = 'high',
): TrackMeshes {
  const group = new Group();
  group.name = 'track';

  const ballast = new MeshAccum();
  const rails = new MeshAccum();
  const left = railProfile(-DIM.gauge / 2);
  const right = railProfile(DIM.gauge / 2);
  const sleeperMatrices: Matrix4[] = [];
  const spacing = quality === 'high' ? DIM.sleeperSpacing : DIM.sleeperSpacing * 2;

  for (const curve of curves.values()) {
    ballast.sweep(curve.points, BALLAST_PROFILE);
    rails.sweep(curve.points, left);
    rails.sweep(curve.points, right);
    for (let s = spacing / 2; s < curve.lengthMm; s += spacing) {
      const pose = poseAtOffsetMm(curve, s);
      sleeperMatrices.push(sleeperMatrix(pose));
    }
  }

  const ballastMesh = new Mesh(ballast.toGeometry(), mats.ballast);
  ballastMesh.name = 'ballast';
  ballastMesh.receiveShadow = quality === 'high';
  group.add(ballastMesh);

  const railMesh = new Mesh(rails.toGeometry(), mats.rail);
  railMesh.name = 'rails';
  railMesh.castShadow = false;
  railMesh.receiveShadow = false;
  group.add(railMesh);

  if (sleeperMatrices.length > 0) {
    const geom = new BoxGeometry(
      DIM.sleeperWidth * MM,
      DIM.sleeperHeight * MM,
      DIM.sleeperLength * MM,
    );
    const inst = new InstancedMesh(geom, mats.sleeper, sleeperMatrices.length);
    inst.name = 'sleepers';
    for (let i = 0; i < sleeperMatrices.length; i += 1) {
      const m = sleeperMatrices[i];
      if (m) inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = quality === 'high';
    group.add(inst);
  }

  return { group, sleeperCount: sleeperMatrices.length };
}

function sleeperMatrix(pose: TrackPose): Matrix4 {
  const yaw = Math.atan2(-pose.tangent.z, pose.tangent.x);
  const q = new Quaternion().setFromAxisAngle(UP, yaw);
  const pos = pose.position
    .clone()
    .setY((DIM.ballastHeight + DIM.sleeperHeight / 2) * MM);
  return new Matrix4().compose(pos, q, new Vector3(1, 1, 1));
}

/** Yaw (rotation about +y) that aligns a mesh's local +x with a world tangent. */
export function yawOfTangent(tangent: Vector3): number {
  return Math.atan2(-tangent.z, tangent.x);
}

/** Disposes every geometry below `root` (materials are owned by `SceneMaterials`). */
export function disposeGeometries(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Partial<Mesh>;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      mesh.geometry.dispose();
    }
  });
}
