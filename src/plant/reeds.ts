/**
 * Reed contact (ARCHITECTURE.md §5.3): magnet-window closure, latch-until-consumed,
 * seeded bounce generator (Entprellen exercise).
 *
 * Binding behavior rules (§5.3):
 * - Instantaneous `closed` = magnet center (loco center + `magnetOffsetMm`) within
 *   `windowMm/2` of the reed position. Closure is evaluated while the magnet is on the
 *   reed's edge (along-edge distance; window ≪ edge length, so cross-node proximity is
 *   negligible — documented simplification).
 * - `latched` = OR of `closed` over all physics steps since the last consume — a scan
 *   never misses a crossing (models the input electronics latch; deterministic).
 * - Bounce (only when enabled AND `spec.bounce`): on window entry, 2–4 alternating
 *   closed/open bursts of 10–30 ms within the first 100 ms, then solid closed until
 *   window exit. Those sub-scan bursts are absorbed by the latch at the default 50 ms
 *   scan (§12 #9) — so additionally ONE guaranteed PLC-visible re-closure: 250–400 ms
 *   after window exit (seeded) the reed closes again for 150 ms; the open gap and the
 *   re-closure each span ≥ 2× the default scan interval. All draws come from the shared
 *   seeded PRNG (`random.ts`), in trackplan processing order — reproducible per seed.
 *   Burst/delay durations are drawn as 10 ms multiples so the pattern aligns with the
 *   fixed physics step.
 */
import type { SimEvent } from './plant';
import { randInt, type Rng } from './random';
import type { ReedSpec } from './types';

export interface ReedState {
  id: string;
  closed: boolean;                   // instantaneous (magnet inside window / bounce pattern)
  latched: boolean;                  // closed at any physics step since last consume
}

/** Bounce burst phase length after window entry (§5.3: "in the first 100 ms"). */
export const REED_BOUNCE_BURST_WINDOW_MS = 100;
/** Duration of the guaranteed PLC-visible re-closure after window exit (§5.3). */
export const REED_BOUNCE_RECLOSE_MS = 150;

export class Reed {
  readonly spec: ReedSpec;
  private readonly windowMm: number;
  private readonly bounceActive: boolean;
  private readonly rng: Rng;
  private closed_ = false;
  private latched_ = false;
  private prevGeom = false;
  /** Active burst pattern: alternating segment durations (ms), first segment closed. */
  private burst: { entryMs: number; segments: readonly number[] } | null = null;
  /** Scheduled trailing re-closure interval [startMs, endMs). */
  private reclose: { startMs: number; endMs: number } | null = null;

  constructor(spec: ReedSpec, windowMm: number, bounceActive: boolean, rng: Rng) {
    this.spec = spec;
    this.windowMm = windowMm;
    this.bounceActive = bounceActive;
    this.rng = rng;
  }

  get id(): string {
    return this.spec.id;
  }

  get closed(): boolean {
    return this.closed_;
  }

  get latched(): boolean {
    return this.latched_;
  }

  /** Sensor read by the SimCoordinator: returns the latch, then clears it. */
  consume(): boolean {
    const v = this.latched_;
    this.latched_ = false;
    return v;
  }

  /** One physics step: sample closure from the magnet position, update latch/events. */
  step(nowMs: number, magnetEdgeId: string, magnetOffsetMm: number, emit: (e: SimEvent) => void): void {
    const geom =
      magnetEdgeId === this.spec.edgeId &&
      Math.abs(magnetOffsetMm - this.spec.offsetMm) <= this.windowMm / 2;

    let eff: boolean;
    if (!this.bounceActive) {
      eff = geom;
    } else {
      if (geom && !this.prevGeom) {
        // Window entry: draw the burst pattern (2–4 segments of 10/20/30 ms).
        const n = randInt(this.rng, 2, 4);
        const segments: number[] = [];
        for (let i = 0; i < n; i++) segments.push(10 * randInt(this.rng, 1, 3));
        this.burst = { entryMs: nowMs, segments };
        this.reclose = null;
      } else if (!geom && this.prevGeom) {
        // Window exit: schedule the guaranteed trailing re-closure (250–400 ms gap).
        const delayMs = 10 * randInt(this.rng, 25, 40);
        this.reclose = { startMs: nowMs + delayMs, endMs: nowMs + delayMs + REED_BOUNCE_RECLOSE_MS };
        this.burst = null;
      }
      if (geom) {
        eff = this.burstClosed(nowMs);
      } else {
        eff = this.reclose !== null && nowMs >= this.reclose.startMs && nowMs < this.reclose.endMs;
        if (this.reclose !== null && nowMs >= this.reclose.endMs) this.reclose = null;
      }
    }

    this.prevGeom = geom;
    if (eff && !this.closed_) {
      emit({ t: nowMs, type: 'reedClosed', reedId: this.spec.id });
    }
    this.closed_ = eff;
    if (eff) this.latched_ = true;
  }

  /** Closure value inside the geometric window per the active burst pattern. */
  private burstClosed(nowMs: number): boolean {
    if (this.burst === null) return true;
    let t = nowMs - this.burst.entryMs;
    if (t >= REED_BOUNCE_BURST_WINDOW_MS) return true; // solid closed after the burst phase
    let closedSeg = true;
    for (const d of this.burst.segments) {
      if (t < d) return closedSeg;
      t -= d;
      closedSeg = !closedSeg;
    }
    return true; // after all segments: solid closed
  }
}
