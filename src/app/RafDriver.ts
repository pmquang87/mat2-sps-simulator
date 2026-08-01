/**
 * requestAnimationFrame driver (ARCHITECTURE.md §3, §5.2): real time → SimClock feed.
 * DOM access is allowed HERE (browser only) — never below app/. Feeds RAW real elapsed ms
 * into clock.accumulate (SimClock alone applies timeScale; the driver never pre-scales,
 * otherwise scaling would be applied twice), advances the coordinator by the returned
 * whole-step count, then calls onFrame with the leftover fractional time as the scene
 * interpolation alpha.
 *
 * This is the ONLY requestAnimationFrame user in the codebase. It keeps calling onFrame
 * while paused (timeScale 0 yields zero steps) so the scene stays interactive.
 */
import type { SimClock } from './SimClock';

/**
 * All the driver needs of a coordinator. Typed as a structural interface rather than as
 * `SimCoordinator` so the second experiment's own loop (`pump/PumpCoordinator`) can reuse
 * this driver unchanged — the railway coordinator satisfies it as-is, so nothing about the
 * delivered behaviour moves.
 */
export interface SteppableCoordinator {
  advanceSteps(n: number): void;
}

export class RafDriver {
  private readonly clock: SimClock;
  private readonly coordinator: SteppableCoordinator;
  private readonly onFrame: (alphaMs: number) => void;

  private handle: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(clock: SimClock, coordinator: SteppableCoordinator,
              onFrame: (alphaMs: number) => void) {
    this.clock = clock;
    this.coordinator = coordinator;
    this.onFrame = onFrame;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;
    this.lastTimestamp = null;
    const frame = (timestamp: number): void => {
      this.handle = requestAnimationFrame(frame);
      const realDtMs = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
      this.lastTimestamp = timestamp;
      const steps = this.clock.accumulate(realDtMs);
      if (steps > 0) this.coordinator.advanceSteps(steps);
      this.onFrame(this.clock.pendingMs);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.handle === null) return;
    cancelAnimationFrame(this.handle);
    this.handle = null;
    this.lastTimestamp = null;
  }
}
