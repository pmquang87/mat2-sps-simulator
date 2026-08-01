/**
 * The student-adjustable parameter set: documented defaults, clamping at BOTH range ends,
 * live-vs-on-reset application semantics, and a measured effect — doubling the pump rate
 * halves the time it takes to fill tank B to its HLS threshold.
 */
import { describe, expect, it } from 'vitest';
import {
  PUMP_PARAM_DEFAULTS, PUMP_PARAM_KEYS, PUMP_PARAM_RANGES, PumpPlant, clampPumpParams,
} from '../../src/pump';
import type { PumpParamKey, PumpParams, PumpSensorId } from '../../src/pump';

/** Sim time until tank B reaches its HLS threshold, pump running from the first step. */
function timeToFullB(params: Partial<PumpParams>, capMs = 600_000): number {
  const p = new PumpPlant({ params });
  p.setActuator('pump', true);
  while (p.snapshot().timeMs < capMs) {
    p.step(10);
    if (p.snapshot().sensors.hlsB) return p.snapshot().timeMs;
  }
  return -1;
}

/**
 * Sim time at which each level bit first goes to 1, with the pump energised from step one
 * (and the refill hand valve optionally open). Read from the EVENT stream, not by polling the
 * snapshot, so "in the same physics step" is a statement about what the plant published.
 */
function firstTrueTimes(
  params: Partial<PumpParams>,
  opts: { refill?: boolean; capMs?: number } = {},
): Partial<Record<PumpSensorId, number>> {
  const p = new PumpPlant({ params });
  p.setActuator('pump', true);
  if (opts.refill === true) p.setValve('inA', true);
  p.drainEvents();                        // the actuator/valve commands are not measurements
  const out: Partial<Record<PumpSensorId, number>> = {};
  const cap = opts.capMs ?? 120_000;
  while (p.snapshot().timeMs < cap) {
    p.step(10);
    for (const e of p.drainEvents()) {
      if (e.type === 'sensor' && e.value && out[e.id] === undefined) out[e.id] = e.t;
    }
  }
  return out;
}

describe('Defaults', () => {
  it('are the documented ones and lie inside their own ranges', () => {
    expect(PUMP_PARAM_DEFAULTS).toEqual({
      pumpRatePctS: 4,
      refillRatePctS: 6,
      drainRatePctS: 6,
      llsThresholdPct: 2,
      hlsThresholdPct: 98,
      dryRunDelayS: 2,
      initialVolAPct: 90,
      initialVolBPct: 0,
    });
    for (const key of PUMP_PARAM_KEYS) {
      const range = PUMP_PARAM_RANGES[key];
      expect(range.min).toBeLessThan(range.max);
      expect(range.default).toBeGreaterThanOrEqual(range.min);
      expect(range.default).toBeLessThanOrEqual(range.max);
    }
  });

  it('a fresh plant starts A at the shipped 90 %, B empty, valves closed, nothing energised', () => {
    const s = new PumpPlant().snapshot();
    expect(s.volAPct).toBe(90);
    expect(s.volBPct).toBe(0);
    expect(s.valves).toEqual({ inA: false, outB: false });
    expect(s.actuators).toEqual({ pump: false, 'A0.2': false, 'A0.3': false });
    expect(s.buttons).toEqual({ S1: false, S0: false });
    expect(s.params).toEqual(PUMP_PARAM_DEFAULTS);
  });

  it('the LLS range stays strictly below the HLS range', () => {
    expect(PUMP_PARAM_RANGES.llsThresholdPct.max).toBeLessThan(PUMP_PARAM_RANGES.hlsThresholdPct.min);
  });
});

describe('Clamping', () => {
  it('clamps every key at both ends and never throws', () => {
    for (const key of PUMP_PARAM_KEYS) {
      const range = PUMP_PARAM_RANGES[key];
      const low = clampPumpParams({ [key]: range.min - 1000 } as Partial<PumpParams>);
      const high = clampPumpParams({ [key]: range.max + 1000 } as Partial<PumpParams>);
      expect(low[key]).toBe(range.min);
      expect(high[key]).toBe(range.max);
    }
  });

  it('keeps a value that is already inside the range', () => {
    expect(clampPumpParams({ pumpRatePctS: 7.5 }).pumpRatePctS).toBe(7.5);
  });

  it('falls back to the base value for NaN, Infinity and non-numbers', () => {
    const base = clampPumpParams({ pumpRatePctS: 7 });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
                       'fast' as unknown as number, null as unknown as number]) {
      expect(clampPumpParams({ pumpRatePctS: bad }, base).pumpRatePctS).toBe(7);
    }
  });

  it('an empty or missing patch yields the defaults', () => {
    expect(clampPumpParams()).toEqual(PUMP_PARAM_DEFAULTS);
    expect(clampPumpParams({})).toEqual(PUMP_PARAM_DEFAULTS);
    expect(clampPumpParams(null)).toEqual(PUMP_PARAM_DEFAULTS);
  });

  it('the plant clamps its constructor patch too', () => {
    const p = new PumpPlant({ params: { pumpRatePctS: 1e6, llsThresholdPct: -5 } });
    expect(p.params.pumpRatePctS).toBe(PUMP_PARAM_RANGES.pumpRatePctS.max);
    expect(p.params.llsThresholdPct).toBe(PUMP_PARAM_RANGES.llsThresholdPct.min);
  });

  it('setParams patches only the given keys and returns the parameters in force', () => {
    const p = new PumpPlant({ params: { pumpRatePctS: 5 } });
    const active = p.setParams({ drainRatePctS: 9 });
    expect(active.pumpRatePctS).toBe(5);
    expect(active.drainRatePctS).toBe(9);
    expect(p.params).toEqual(active);
  });
});

describe('Application semantics', () => {
  it('applies a rate change LIVE, from the very next step', () => {
    const p = new PumpPlant({ params: { pumpRatePctS: 4, initialVolAPct: 100, initialVolBPct: 0 } });
    p.setActuator('pump', true);
    for (let i = 0; i < 100; i++) p.step(10);          // 1 s at 4 %/s
    expect(p.snapshot().volBPct).toBeCloseTo(4, 6);
    p.setParams({ pumpRatePctS: 8 });
    for (let i = 0; i < 100; i++) p.step(10);          // 1 s at 8 %/s
    expect(p.snapshot().volBPct).toBeCloseTo(12, 6);
  });

  it('applies a threshold change LIVE, moving the trip point with the probe', () => {
    const p = new PumpPlant({ params: { hlsThresholdPct: 98, initialVolBPct: 90 } });
    expect(p.snapshot().sensors.hlsB).toBe(false);
    p.setParams({ hlsThresholdPct: 85 });             // probe dragged below the surface
    expect(p.snapshot().sensors.hlsB).toBe(true);
    p.setParams({ hlsThresholdPct: 95 });             // and back above it
    expect(p.snapshot().sensors.hlsB).toBe(false);
  });

  it('applies the dry-run delay LIVE', () => {
    const p = new PumpPlant({ params: { dryRunDelayS: 10, initialVolAPct: 0 } });
    p.setActuator('pump', true);
    for (let i = 0; i < 300; i++) p.step(10);          // 3 s of dry running
    expect(p.snapshot().sensors.ls).toBe(true);
    p.setParams({ dryRunDelayS: 1 });                 // 3 s already dry > 1 s
    p.step(10);
    expect(p.snapshot().sensors.ls).toBe(false);
  });

  it('holds the initial levels back until the NEXT reset', () => {
    const p = new PumpPlant({ params: { initialVolAPct: 100, initialVolBPct: 0 } });
    p.setActuator('pump', true);
    for (let i = 0; i < 100; i++) p.step(10);
    const movedA = p.snapshot().volAPct;
    expect(movedA).toBeLessThan(100);

    p.setParams({ initialVolAPct: 30, initialVolBPct: 60 });
    expect(p.snapshot().volAPct).toBe(movedA);        // no teleporting liquid
    expect(p.snapshot().volBPct).toBeCloseTo(4, 6);

    p.reset();
    expect(p.snapshot().volAPct).toBe(30);
    expect(p.snapshot().volBPct).toBe(60);
    expect(p.snapshot().timeMs).toBe(0);
  });

  it('emits paramsChanged so the scene can re-place the probes', () => {
    const p = new PumpPlant();
    p.drainEvents();
    p.setParams({ pumpRatePctS: 5 });
    expect(p.drainEvents().filter((e) => e.type === 'paramsChanged')).toHaveLength(1);
  });
});

/**
 * The manual gives TWO independent end conditions, "Tank A leer" and "Tank B voll". With one
 * capacity and one transfer rate they are only distinguishable if the tanks do not start
 * 100/0 — see the `initialVolAPct` note in `pump/params.ts`. Measured here, with the old
 * default kept as the control that shows the metric can fail.
 */
describe('Shipped defaults keep the two end conditions apart', () => {
  it('A reports empty at 22 s and B never reaches its full signal on its own', () => {
    const t = firstTrueTimes({});
    expect(t.llsA).toBe(22_000);          // (90 − 2) % at 4 %/s
    // B tops out at the 90 % that came out of A, so the 98 % probe is never wetted at all —
    // the separation is 8 percentage points, not a race the float sums could decide.
    expect(t.hlsB).toBeUndefined();
  });

  it('CONTROL: with the retired 100 % default both conditions fire in the same step', () => {
    const t = firstTrueTimes({ initialVolAPct: 100 });
    expect(t.llsA).toBe(24_500);
    expect(t.hlsB).toBe(24_500);          // 100 − 2 = 98: indistinguishable end conditions
  });

  it('refilling A by hand while the pump runs is what reaches HLS_TankB', () => {
    const t = firstTrueTimes({}, { refill: true });
    expect(t.hlsB).toBe(24_500);          // 98 % at 4 %/s
    expect(t.llsA).toBeUndefined();       // 6 %/s in beats 4 %/s out: A never runs empty
  });
});

describe('Measured effect', () => {
  it('doubling the pump rate halves the time from start to HLS_TankB', () => {
    const base = { hlsThresholdPct: 80, initialVolAPct: 100, initialVolBPct: 0 };
    const slow = timeToFullB({ ...base, pumpRatePctS: 4 });
    const fast = timeToFullB({ ...base, pumpRatePctS: 8 });
    // Tolerance is one physics step: the level is a float sum, so a threshold can be
    // reached one 10 ms step late. That is the resolution of the measurement itself.
    expect(Math.abs(slow - 20_000)).toBeLessThanOrEqual(10);   // 80 % at 4 %/s
    expect(Math.abs(fast - 10_000)).toBeLessThanOrEqual(10);   // 80 % at 8 %/s
    expect(Math.abs(slow / 2 - fast)).toBeLessThanOrEqual(10);
  });

  it('the same halving holds through a LIVE change on a running plant', () => {
    const p = new PumpPlant({
      params: { hlsThresholdPct: 80, pumpRatePctS: 4, initialVolAPct: 100, initialVolBPct: 0 },
    });
    p.setActuator('pump', true);
    for (let i = 0; i < 1000; i++) p.step(10);        // 10 s at 4 %/s → 40 %
    expect(p.snapshot().volBPct).toBeCloseTo(40, 6);
    p.setParams({ pumpRatePctS: 8 });
    let ms = 0;
    while (!p.snapshot().sensors.hlsB && ms < 60_000) {
      p.step(10);
      ms += 10;
    }
    expect(Math.abs(ms - 5_000)).toBeLessThanOrEqual(10);   // the remaining 40 % at 8 %/s
  });
});

/** Type-level guard: the key list and the range table cannot drift apart. */
const _keysCoverRanges: readonly PumpParamKey[] = PUMP_PARAM_KEYS;
void _keysCoverRanges;
