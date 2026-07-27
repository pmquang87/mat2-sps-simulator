/**
 * §9.2 reeds.test.ts: closure window geometry; latch survives until consume, cleared
 * after; a ~30 ms crossing at Speed3 is caught by the next scan; bounce pattern
 * determinism (seeded); bounce only when enabled; the guaranteed trailing re-closure
 * produces a second PLC-level rising edge at scan 50 ms.
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { SimEvent } from '../../src/plant';
import { miniPlan } from './fixtures/miniplan';

function run(p: Plant, steps: number): void {
  for (let i = 0; i < steps; i++) p.step(10);
}

function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function reedClosedCount(evs: SimEvent[], reedId: string): number {
  return ofType(evs, 'reedClosed').filter((e) => e.reedId === reedId).length;
}

/** Drive at level 2 over the bounce reed xR02T (on eC @ 500 mm); returns the event log. */
function bounceRun(seed: number, bounceEnabled: boolean): SimEvent[] {
  const p = new Plant({ trackplan: miniPlan(), seed, bounceEnabled });
  p.setFahrstromWord(2);
  run(p, 1300); // 13 s — well past crossing + trailing re-closure
  return p.drainEvents();
}

describe('Closure window geometry', () => {
  it('closes exactly while the magnet is within windowMm/2 of the reed', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1); // 100 mm/s → 1 mm/step at full speed
    const closedOffsets: number[] = [];
    const openOffsets: number[] = [];
    for (let i = 0; i < 600; i++) {
      p.step(10);
      const s = p.snapshot();
      const reed = s.reeds.find((r) => r.id === 'xR01T')!;
      if (s.train.edgeId === 'eB') {
        (reed.closed ? closedOffsets : openOffsets).push(s.train.offsetMm);
      }
    }
    expect(closedOffsets.length).toBeGreaterThan(0);
    // xR01T at 500, window 20 → closed iff |offset − 500| ≤ 10
    for (const o of closedOffsets) expect(Math.abs(o - 500)).toBeLessThanOrEqual(10);
    for (const o of openOffsets) expect(Math.abs(o - 500)).toBeGreaterThan(10);
  });

  it('emits reedClosed exactly once for a clean pass (rising edge only)', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3);
    run(p, 200);
    expect(reedClosedCount(p.drainEvents(), 'xR01T')).toBe(1);
  });
});

describe('Latch until consume', () => {
  it('keeps the latch after the magnet has left, until consumed; consuming clears it', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3);
    run(p, 200); // well past xR01T
    const snap = p.snapshot();
    const reed = snap.reeds.find((r) => r.id === 'xR01T')!;
    expect(reed.closed).toBe(false);   // magnet long gone
    expect(reed.latched).toBe(true);   // latch survived
    expect(p.consumeReedLatch('xR01T')).toBe(true);
    expect(p.consumeReedLatch('xR01T')).toBe(false); // cleared, no re-closure since
    expect(p.snapshot().reeds.find((r) => r.id === 'xR01T')!.latched).toBe(false);
  });

  it('catches a ~30 ms crossing at Speed3 with a 50 ms consume cadence', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3); // 600 mm/s → 20 mm window crossed in ~30 ms < 50 ms scan
    const consumed: boolean[] = [];
    for (let i = 1; i <= 200; i++) {
      p.step(10);
      if (i % 5 === 0) consumed.push(p.consumeReedLatch('xR01T')); // 50 ms cadence
    }
    const hits = consumed.filter(Boolean).length;
    expect(hits).toBeGreaterThanOrEqual(1); // never missed
    expect(hits).toBeLessThanOrEqual(2);    // one crossing, at most straddling a boundary
  });

  it('throws on an unknown reed id', () => {
    const p = new Plant({ trackplan: miniPlan() });
    expect(() => p.consumeReedLatch('xR99T')).toThrow(/unknown reed id/);
  });
});

describe('Bounce', () => {
  it('is off by default and only affects reeds with bounce: true', () => {
    const noBounce = bounceRun(7, false);
    expect(reedClosedCount(noBounce, 'xR02T')).toBe(1);
    const withBounce = bounceRun(7, true);
    expect(reedClosedCount(withBounce, 'xR02T')).toBeGreaterThanOrEqual(2);
    // xR01T (bounce: false) stays clean even when bounce is enabled.
    expect(reedClosedCount(withBounce, 'xR01T')).toBe(1);
  });

  it('is deterministic per seed: same seed → identical logs, different seed → different', () => {
    const a = JSON.stringify(bounceRun(7, true));
    const b = JSON.stringify(bounceRun(7, true));
    const c = JSON.stringify(bounceRun(9, true));
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('produces the guaranteed PLC-visible re-closure after window exit (50 ms scan)', () => {
    const p = new Plant({ trackplan: miniPlan(), seed: 7, bounceEnabled: true });
    p.setFahrstromWord(2);
    const consumed: boolean[] = [];
    for (let i = 1; i <= 1300; i++) {
      p.step(10);
      if (i % 5 === 0) consumed.push(p.consumeReedLatch('xR02T'));
    }
    // Maximal true-runs over the consume sequence.
    const runs: { start: number; len: number }[] = [];
    for (let i = 0; i < consumed.length; i++) {
      if (consumed[i] && (i === 0 || !consumed[i - 1])) runs.push({ start: i, len: 0 });
      if (consumed[i]) runs[runs.length - 1]!.len++;
    }
    // Exactly two PLC-level closure groups: the crossing and the trailing re-closure.
    expect(runs).toHaveLength(2);
    const [crossing, reclose] = runs as [{ start: number; len: number }, { start: number; len: number }];
    // Open gap and re-closure each span ≥ 2 consume cycles (≥ 2× the 50 ms scan).
    expect(reclose.start - (crossing.start + crossing.len)).toBeGreaterThanOrEqual(2);
    expect(reclose.len).toBeGreaterThanOrEqual(2);
    // And the un-latched instantaneous view is closed again for 150 ms — i.e. the PLC
    // sees a genuine second rising edge, which the event log confirms:
    const evs = p.drainEvents();
    expect(reedClosedCount(evs, 'xR02T')).toBeGreaterThanOrEqual(2);
  });
});
