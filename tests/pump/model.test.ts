/**
 * Pump plant physics: transfer/refill/drain rates, level-switch hysteresis at BOTH
 * thresholds (no chatter when the level sits exactly on one), dry-run timing, and
 * determinism of the whole model.
 */
import { describe, expect, it } from 'vitest';
import { PUMP_SENSOR_HYSTERESIS_PCT, PumpPlant } from '../../src/pump';
import type { PumpEvent, PumpParams, PumpSensorId } from '../../src/pump';

function run(p: PumpPlant, steps: number): void {
  for (let i = 0; i < steps; i++) p.step(10);
}

function plant(params: Partial<PumpParams>): PumpPlant {
  return new PumpPlant({ params });
}

function sensorEvents(events: readonly PumpEvent[], id: PumpSensorId): PumpEvent[] {
  return events.filter((e) => e.type === 'sensor' && e.id === id);
}

describe('Flows', () => {
  it('transfers A → B at the pump rate while the pump output is on', () => {
    const p = plant({ pumpRatePctS: 4, initialVolAPct: 100, initialVolBPct: 0 });
    p.setActuator('pump', true);
    run(p, 100);                                   // 1 s
    const s = p.snapshot();
    expect(s.volAPct).toBeCloseTo(96, 6);
    expect(s.volBPct).toBeCloseTo(4, 6);
    expect(s.flowPctS.pump).toBeCloseTo(4, 6);
  });

  it('moves nothing while the pump output is off', () => {
    const p = plant({ initialVolAPct: 50, initialVolBPct: 50 });
    run(p, 100);
    expect(p.snapshot().volAPct).toBe(50);
    expect(p.snapshot().volBPct).toBe(50);
    expect(p.snapshot().flowPctS.pump).toBe(0);
  });

  it('refills A and drains B at their own rates, independent of the PLC', () => {
    const p = plant({ refillRatePctS: 6, drainRatePctS: 3, initialVolAPct: 0, initialVolBPct: 50 });
    p.setValve('inA', true);
    p.setValve('outB', true);
    run(p, 100);
    expect(p.snapshot().volAPct).toBeCloseTo(6, 6);
    expect(p.snapshot().volBPct).toBeCloseTo(47, 6);
  });

  it('deadheads instead of overflowing: a full B stops the transfer, and A keeps its level', () => {
    const p = plant({ initialVolAPct: 100, initialVolBPct: 100 });
    p.setActuator('pump', true);
    run(p, 100);
    const s = p.snapshot();
    expect(s.volAPct).toBe(100);
    expect(s.volBPct).toBe(100);
    expect(s.flowPctS.pump).toBe(0);               // nothing to draw in the scene
  });

  it('never leaves the 0…100 % band, whatever the valves do', () => {
    const p = plant({ refillRatePctS: 20, drainRatePctS: 20, initialVolAPct: 0, initialVolBPct: 100 });
    p.setValve('inA', true);
    p.setValve('outB', true);
    p.setActuator('pump', true);
    run(p, 3000);                                  // 30 s — long past both limits
    const s = p.snapshot();
    expect(s.volAPct).toBeGreaterThanOrEqual(0);
    expect(s.volAPct).toBeLessThanOrEqual(100);
    expect(s.volBPct).toBeGreaterThanOrEqual(0);
    expect(s.volBPct).toBeLessThanOrEqual(100);
  });

  it('rejects a non-positive step', () => {
    const p = plant({});
    expect(() => p.step(0)).toThrow(/dtMs/);
    expect(() => p.step(-10)).toThrow(/dtMs/);
  });
});

describe('Level switches', () => {
  it('reports the initial bits from the initial levels', () => {
    const s = plant({ initialVolAPct: 100, initialVolBPct: 0 }).snapshot();
    expect(s.sensors).toEqual({ llsA: false, hlsA: true, llsB: true, hlsB: false, ls: true });
  });

  it('HLS trips at the threshold and releases one hysteresis band below it', () => {
    const p = plant({
      hlsThresholdPct: 80, pumpRatePctS: 1, drainRatePctS: 1,
      initialVolAPct: 100, initialVolBPct: 79.5,
    });
    expect(p.snapshot().sensors.hlsB).toBe(false);
    p.setActuator('pump', true);
    run(p, 51);                                    // 79.5 → 80.01, i.e. one step past it
    expect(p.snapshot().volBPct).toBeCloseTo(80, 1);
    expect(p.snapshot().sensors.hlsB).toBe(true);
    p.setActuator('pump', false);
    p.setValve('outB', true);
    run(p, 50);                                    // 80.0 → 79.5, inside the band
    expect(p.snapshot().sensors.hlsB).toBe(true);
    run(p, 60);                                    // → 78.9, below threshold − band
    expect(p.snapshot().sensors.hlsB).toBe(false);
  });

  it('LLS trips at the threshold and releases one hysteresis band above it', () => {
    const p = plant({
      llsThresholdPct: 2, pumpRatePctS: 1, refillRatePctS: 1,
      initialVolAPct: 2.5, initialVolBPct: 0,
    });
    expect(p.snapshot().sensors.llsA).toBe(false);
    p.setActuator('pump', true);
    run(p, 51);                                    // 2.5 → 1.99, i.e. one step past it
    expect(p.snapshot().sensors.llsA).toBe(true);
    p.setActuator('pump', false);
    p.setValve('inA', true);
    run(p, 50);                                    // 2.0 → 2.5, inside the band
    expect(p.snapshot().sensors.llsA).toBe(true);
    run(p, 60);                                    // → 3.1, above threshold + band
    expect(p.snapshot().sensors.llsA).toBe(false);
  });

  it('does not chatter when the level sits exactly ON the HLS threshold', () => {
    const p = plant({
      hlsThresholdPct: 80, pumpRatePctS: 1, drainRatePctS: 1,
      initialVolAPct: 100, initialVolBPct: 80,
    });
    expect(p.snapshot().volBPct).toBe(80);
    expect(p.snapshot().sensors.hlsB).toBe(true);
    p.drainEvents();

    // Ten crossings of the threshold, ±0.4 % — smaller than the hysteresis band.
    for (let i = 0; i < 10; i++) {
      p.setValve('outB', true);
      run(p, 40);
      p.setValve('outB', false);
      p.setActuator('pump', true);
      run(p, 40);
      p.setActuator('pump', false);
    }
    expect(p.snapshot().volBPct).toBeCloseTo(80, 6);
    expect(sensorEvents(p.drainEvents(), 'hlsB')).toHaveLength(0);

    // A real departure from the band flips the bit exactly once.
    p.setValve('outB', true);
    run(p, 200);                                   // −2 %
    const flips = sensorEvents(p.drainEvents(), 'hlsB');
    expect(flips).toHaveLength(1);
    expect(p.snapshot().sensors.hlsB).toBe(false);
  });

  it('does not chatter when the level sits exactly ON the LLS threshold', () => {
    const p = plant({
      llsThresholdPct: 2, pumpRatePctS: 1, refillRatePctS: 1,
      initialVolAPct: 2, initialVolBPct: 0,
    });
    expect(p.snapshot().sensors.llsA).toBe(true);
    p.drainEvents();

    for (let i = 0; i < 10; i++) {
      p.setValve('inA', true);
      run(p, 40);
      p.setValve('inA', false);
      p.setActuator('pump', true);
      run(p, 40);
      p.setActuator('pump', false);
    }
    expect(p.snapshot().volAPct).toBeCloseTo(2, 6);
    expect(sensorEvents(p.drainEvents(), 'llsA')).toHaveLength(0);

    p.setValve('inA', true);
    run(p, 200);                                   // +2 %
    expect(sensorEvents(p.drainEvents(), 'llsA')).toHaveLength(1);
    expect(p.snapshot().sensors.llsA).toBe(false);
  });

  it('keeps the band inside the admissible threshold ranges', () => {
    // The parameter ranges (LLS ≤ 20, HLS ≥ 80) must leave room for both bands.
    expect(20 + PUMP_SENSOR_HYSTERESIS_PCT).toBeLessThan(80 - PUMP_SENSOR_HYSTERESIS_PCT);
  });
});

describe('Dry-run guard', () => {
  it('stays wetted while the pump is off, whatever tank A holds', () => {
    const p = plant({ initialVolAPct: 0, dryRunDelayS: 0 });
    run(p, 500);
    expect(p.snapshot().sensors.ls).toBe(true);
    expect(p.snapshot().dryRunMs).toBe(0);
  });

  it('goes dry exactly dryRunDelayS after A runs empty, and re-wets on refill', () => {
    const p = plant({
      pumpRatePctS: 4, dryRunDelayS: 2, refillRatePctS: 6,
      initialVolAPct: 1, initialVolBPct: 0,
    });
    p.setActuator('pump', true);
    // A (1 %) empties after 250 ms at 4 %/s.
    const emptied = advance(p, (s) => s.volAPct <= 0, 2000);
    expect(emptied).toBe(250);
    expect(p.snapshot().sensors.ls).toBe(true);    // still wetted — the delay is running

    const wentDry = advance(p, (s) => !s.sensors.ls, 10000);
    expect(wentDry).toBe(emptied + 2000);

    p.setValve('inA', true);
    run(p, 1);                                     // one step of refill is enough
    expect(p.snapshot().volAPct).toBeGreaterThan(0);
    expect(p.snapshot().sensors.ls).toBe(true);
    expect(p.snapshot().dryRunMs).toBe(0);
  });

  it('with a zero delay it goes dry on the first dry step', () => {
    const p = plant({ pumpRatePctS: 4, dryRunDelayS: 0, initialVolAPct: 0 });
    p.setActuator('pump', true);
    run(p, 1);
    expect(p.snapshot().sensors.ls).toBe(false);
  });
});

describe('Determinism', () => {
  it('two identical runs produce identical serialized snapshots and events', () => {
    const script = (p: PumpPlant): string[] => {
      const trace: string[] = [];
      p.setValve('inA', true);
      p.setActuator('pump', true);
      for (let i = 0; i < 400; i++) {
        p.step(10);
        if (i === 120) p.setValve('inA', false);
        if (i === 200) p.setToggle('E1.0', true);
        if (i === 260) p.setValve('outB', true);
        if (i === 300) p.setParams({ pumpRatePctS: 9.5 });
        if (i % 10 === 0) trace.push(JSON.stringify(p.snapshot()));
      }
      trace.push(JSON.stringify(p.drainEvents()));
      return trace;
    };
    const a = script(plant({ initialVolAPct: 40, initialVolBPct: 10 }));
    const b = script(plant({ initialVolAPct: 40, initialVolBPct: 10 }));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('reset() restores the initial state exactly', () => {
    const p = plant({ initialVolAPct: 70, initialVolBPct: 5 });
    const before = JSON.stringify(p.snapshot());
    p.setActuator('pump', true);
    p.setToggle('E1.3', true);
    p.setValve('outB', true);
    p.pressS1(true);
    run(p, 500);
    p.reset();
    expect(JSON.stringify(p.snapshot())).toBe(before);
    expect(p.drainEvents()).toEqual([]);
  });

  it('hands out detached snapshots', () => {
    const p = plant({});
    const s = p.snapshot();
    s.sensors.llsA = true;
    s.params.pumpRatePctS = 999;
    expect(p.snapshot().sensors.llsA).toBe(false);
    expect(p.params.pumpRatePctS).not.toBe(999);
  });
});

/** Step until `predicate` holds after a step; returns that sim time, or -1 at the cap. */
function advance(p: PumpPlant, predicate: (s: ReturnType<PumpPlant['snapshot']>) => boolean,
                 maxMs: number): number {
  const start = p.snapshot().timeMs;
  while (p.snapshot().timeMs - start < maxMs) {
    p.step(10);
    if (predicate(p.snapshot())) return p.snapshot().timeMs;
  }
  return -1;
}
