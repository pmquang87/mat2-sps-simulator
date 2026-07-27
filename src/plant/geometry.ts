/**
 * Track geometry (ARCHITECTURE.md §3, §6.3): polyline arc length, point/tangent at
 * offset, plan-unit ↔ mm conversion.
 *
 * Determinism note (§6.3): arc-length stepping uses precomputed cumulative polyline
 * lengths only (+, −, sqrt — all IEEE-754-exact operations). Math.atan2/sin/cos never
 * appear in state-affecting code; tangents are consumed for *rendering* (heading) only.
 */
import type { Vec2 } from './types';

export function unitsToMm(units: number, mmPerUnit: number): number {
  return units * mmPerUnit;
}

export function mmToUnits(mm: number, mmPerUnit: number): number {
  return mm / mmPerUnit;
}

/**
 * Immutable polyline in plan units with arc-length parameterization in mm.
 * Offsets outside [0, lengthMm] are clamped.
 */
export class Polyline {
  readonly pts: readonly Vec2[];
  readonly mmPerUnit: number;
  readonly lengthMm: number;
  /** Cumulative arc length in mm at each vertex; cumMm[0] = 0. */
  private readonly cumMm: readonly number[];

  constructor(pts: readonly Vec2[], mmPerUnit: number) {
    if (pts.length < 2) {
      throw new Error(`Polyline needs at least 2 points, got ${pts.length}`);
    }
    if (!(mmPerUnit > 0)) {
      throw new Error(`Polyline mmPerUnit must be > 0, got ${mmPerUnit}`);
    }
    this.pts = pts.map((p) => ({ x: p.x, y: p.y }));
    this.mmPerUnit = mmPerUnit;
    const cum: number[] = [0];
    let acc = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1] as Vec2;
      const b = this.pts[i] as Vec2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      acc += Math.sqrt(dx * dx + dy * dy) * mmPerUnit;
      cum.push(acc);
    }
    this.cumMm = cum;
    this.lengthMm = acc;
    if (!(this.lengthMm > 0)) {
      throw new Error('Polyline has zero length');
    }
  }

  /** Point (plan units) at arc-length offset (mm from the first vertex). */
  pointAtMm(offsetMm: number): Vec2 {
    const { seg, frac } = this.locate(offsetMm);
    const a = this.pts[seg] as Vec2;
    const b = this.pts[seg + 1] as Vec2;
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  /**
   * Unit tangent (plan-unit space, from→to sense) at arc-length offset. At an interior
   * vertex the FOLLOWING segment's tangent is returned (deterministic choice); at the
   * very end, the last segment's.
   */
  tangentAtMm(offsetMm: number): Vec2 {
    const { seg } = this.locate(offsetMm);
    const a = this.pts[seg] as Vec2;
    const b = this.pts[seg + 1] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    return { x: dx / len, y: dy / len };
  }

  /** Segment index + fractional position for a (clamped) mm offset. */
  private locate(offsetMm: number): { seg: number; frac: number } {
    const o = Math.min(Math.max(offsetMm, 0), this.lengthMm);
    let seg = -1;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.cumMm[i] as number;
      const b = this.cumMm[i + 1] as number;
      if (b === a) continue; // degenerate (zero-length) segment: skip
      seg = i;
      if (o < b) break; // strictly inside this segment (or at its start)
    }
    /* c8 ignore next — lengthMm > 0 guarantees at least one non-degenerate segment */
    if (seg < 0) throw new Error('Polyline.locate: no non-degenerate segment');
    const a = this.cumMm[seg] as number;
    const b = this.cumMm[seg + 1] as number;
    return { seg, frac: (o - a) / (b - a) };
  }
}
