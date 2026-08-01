/**
 * Moving water: falling streams, impact ripples and the beads that show flow inside the
 * pipes.
 *
 * Determinism rule for the whole file (owner requirement, §6.3 in spirit): every animated
 * quantity is a function of SIM time — `snapshot.timeMs + alphaMs` — and of the flows the
 * snapshot reports. Nothing reads a wall clock, so two runs of the same program render
 * identically and a hidden tab (no rAF, no sim steps) freezes rather than fast-forwards.
 *
 * Phases that must not jump when the student changes a rate are integrated by the caller
 * (`FlowPhase`) from the same sim-time delta, which keeps them a pure function of the
 * snapshot SEQUENCE — the property the determinism test pins.
 */
import {
  BufferAttribute,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Curve } from 'three';
import { DisposeBag } from './materials';

/** Below this a stream is not drawn at all — a 1 mm tall cone is just z-fighting. */
export const MIN_STREAM_HEIGHT = 0.004;

/**
 * A unit-height falling stream: origin at the mouth, body hanging down −y, tapering (water
 * accelerates, so the column narrows) and bowed slightly in +x so it does not read as a
 * cylinder. The caller scales y to the actual fall height.
 */
export function buildStreamGeometry(
  radiusTop: number,
  radiusBottom: number,
  bowX: number,
): CylinderGeometry {
  const geom = new CylinderGeometry(radiusTop, radiusBottom, 1, 12, 10, true);
  geom.translate(0, -0.5, 0);
  const pos = geom.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const drop = -pos.getY(i); // 0 at the mouth … 1 at the bottom
    pos.setX(i, pos.getX(i) + bowX * drop * drop);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

export interface StreamVisual {
  readonly mesh: Mesh;
  /** Draws the stream from its mouth down to `fallHeight`; `active: false` hides it. */
  update(active: boolean, fallHeight: number): void;
}

export function buildStream(args: {
  name: string;
  material: Material;
  mouth: Vector3;
  radiusTop: number;
  radiusBottom: number;
  bowX: number;
  bag: DisposeBag;
}): StreamVisual {
  const geom = args.bag.add(
    buildStreamGeometry(args.radiusTop, args.radiusBottom, args.bowX),
  );
  const mesh = new Mesh(geom, args.material);
  mesh.name = args.name;
  mesh.position.copy(args.mouth);
  mesh.visible = false;
  mesh.scale.y = MIN_STREAM_HEIGHT;
  return {
    mesh,
    update(active: boolean, fallHeight: number): void {
      const h = Number.isFinite(fallHeight) ? fallHeight : 0;
      const on = active && h > MIN_STREAM_HEIGHT;
      mesh.visible = on;
      mesh.scale.y = on ? h : MIN_STREAM_HEIGHT;
    },
  };
}

/** Rings per impact point — three of them, evenly out of phase, so the ripple never stops. */
export const RIPPLE_RINGS = 3;
/** One ring's expansion period, ms of SIM time. */
export const RIPPLE_PERIOD_MS = 900;

export interface RippleVisual {
  readonly object: Group;
  /** Expanding rings on the surface at `y`, centred on the group's own x/z. */
  update(active: boolean, y: number, simTimeMs: number): void;
}

export function buildRipple(args: {
  name: string;
  material: MeshBasicMaterial;
  at: Vector3;
  maxRadius: number;
  bag: DisposeBag;
}): RippleVisual {
  const group = new Group();
  group.name = args.name;
  group.position.copy(args.at);
  const rings: Mesh[] = [];
  const mats: MeshBasicMaterial[] = [];
  // Unit ring (r = 1): the per-frame radius is a scale, so no geometry is rebuilt.
  const geom = args.bag.add(new RingGeometry(0.86, 1, 28));
  for (let i = 0; i < RIPPLE_RINGS; i += 1) {
    const mat = args.bag.add(args.material.clone());
    const ring = new Mesh(geom, mat);
    ring.name = `${args.name}:${i}`;
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    rings.push(ring);
    mats.push(mat);
    group.add(ring);
  }
  return {
    object: group,
    update(active: boolean, y: number, simTimeMs: number): void {
      group.position.y = y;
      const base = simTimeMs / RIPPLE_PERIOD_MS;
      for (let i = 0; i < rings.length; i += 1) {
        const ring = rings[i];
        const mat = mats[i];
        if (!ring || !mat) continue;
        ring.visible = active;
        if (!active) continue;
        const phase = base + i / rings.length;
        const frac = phase - Math.floor(phase);
        const r = args.maxRadius * (0.18 + 0.82 * frac);
        ring.scale.set(r, r, 1);
        mat.opacity = 0.55 * (1 - frac);
      }
    },
  };
}

export interface FlowBeadsVisual {
  readonly object: Group;
  /** `phase` is a 0…1 travel fraction the caller integrates from the active rate. */
  update(active: boolean, phase: number): void;
}

/**
 * Beads riding along a pipe centreline. A scrolling texture would need a canvas (no DOM in
 * the unit tests) and a wall-clock-free UV animation anyway, so the flow indication is
 * geometry: `count` small spheres spaced evenly along the curve, all advancing together.
 */
export function buildFlowBeads(args: {
  name: string;
  curve: Curve<Vector3>;
  count: number;
  radius: number;
  material: Material;
  bag: DisposeBag;
}): FlowBeadsVisual {
  const group = new Group();
  group.name = args.name;
  const geom = args.bag.add(new SphereGeometry(args.radius, 8, 6));
  const beads: Mesh[] = [];
  for (let i = 0; i < args.count; i += 1) {
    const bead = new Mesh(geom, args.material);
    bead.name = `${args.name}:${i}`;
    bead.visible = false;
    beads.push(bead);
    group.add(bead);
  }
  const scratch = new Vector3();
  return {
    object: group,
    update(active: boolean, phase: number): void {
      for (let i = 0; i < beads.length; i += 1) {
        const bead = beads[i];
        if (!bead) continue;
        bead.visible = active;
        if (!active) continue;
        const raw = phase + i / beads.length;
        const u = raw - Math.floor(raw);
        args.curve.getPointAt(Math.min(0.999999, Math.max(0, u)), scratch);
        bead.position.copy(scratch);
      }
    },
  };
}

/** Builds a smooth centreline through `points` (pipes and the beads share it). */
export function pipeCurve(points: readonly Vector3[]): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.2);
  return curve;
}

/**
 * A travel phase integrated from sim time — 0…1, wrapping. Kept as state (rather than
 * `time × rate`) so that changing the pump rate speeds the beads up instead of teleporting
 * them; a repeated update with the same sim time advances it by zero, which is what makes
 * the scene idempotent for a given snapshot.
 */
export class FlowPhase {
  private value = 0;

  /** `ratePctS` is the plant's own flow figure; `perPct` converts it to laps per second. */
  advance(dtMs: number, ratePctS: number, perPct: number): number {
    if (dtMs > 0 && ratePctS > 0) {
      const next = this.value + (dtMs / 1000) * ratePctS * perPct;
      this.value = next - Math.floor(next);
    }
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
