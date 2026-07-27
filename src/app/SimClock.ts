/**
 * Deterministic accumulator clock (ARCHITECTURE.md §5.2, §6.1): fixed 10 ms physics step,
 * time scale, pause. SimClock is the SOLE owner of time scaling.
 *
 * Simulated time is always an INTEGER number of ms and advances only in whole 10 ms steps,
 * identically in the browser and in headless tests (§6.1).
 */

export class SimClock {
  readonly physicsStepMs: 10 = 10;            // fixed
  timeScale = 1;                              // 0 (paused) … 8

  /** Real frames longer than this are clipped, so a backgrounded tab (or a debugger pause)
   *  cannot produce a multi-second catch-up burst ("spiral of death"). */
  static readonly maxRealDtMs = 250;

  private accumulatorMs = 0;
  private simTime = 0;

  /** Feed RAW real elapsed ms (unscaled — SimClock applies timeScale internally);
   *  returns how many whole physics steps to run now. */
  accumulate(realDtMs: number): number {
    if (!Number.isFinite(realDtMs) || realDtMs <= 0) return 0;
    const scaled = Math.min(realDtMs, SimClock.maxRealDtMs) * this.timeScale;
    if (scaled <= 0) return 0;                // timeScale 0 = paused
    this.accumulatorMs += scaled;
    const steps = Math.floor(this.accumulatorMs / this.physicsStepMs);
    if (steps <= 0) return 0;
    this.accumulatorMs -= steps * this.physicsStepMs;
    this.simTime += steps * this.physicsStepMs;
    return steps;
  }

  /** Integer, advances only in 10 ms steps. */
  get simTimeMs(): number {
    return this.simTime;
  }

  /** Leftover real time not yet consumed by a whole step (0 … <10 ms). The RafDriver hands
   *  it to the scene as the interpolation alpha (§6.1); it never affects the simulation. */
  get pendingMs(): number {
    return this.accumulatorMs;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.simTime = 0;
  }
}
