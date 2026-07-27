/**
 * §9.3 / §6.3 determinism.test.ts — two identical seeded runs of the full stack produce
 * byte-identical serialized event logs. Uses a tiny built-in test program (NOT the oracle,
 * §9.3) with a scenario script, seed 7 and reed bounce enabled so the PRNG path is on.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/plant';
import { DRIVE_PROGRAM, buildHarness } from './harness';

function scriptedRun(seed: number): { log: string; events: SimEvent[] } {
  const h = buildHarness({ program: DRIVE_PROGRAM, seed, bounceEnabled: true });
  h.coordinator.loadScenario([
    { atMs: 20_000, action: 'notaus', active: true },
    { atMs: 25_000, action: 'notaus', active: false },
  ]);
  h.coordinator.advanceSteps(6_000);               // 60 s simulated
  return { log: JSON.stringify(h.events), events: h.events };
}

describe('full-stack determinism (§6.3)', () => {
  it('two runs with seed 7 produce byte-identical event logs', () => {
    const first = scriptedRun(7);
    const second = scriptedRun(7);
    expect(second.log).toBe(first.log);

    // The run must be non-trivial for the identity to mean anything: the train drives,
    // crosses reeds and reacts to the scripted notaus press.
    const types = new Set(first.events.map((e) => e.type));
    expect(types.has('trainStarted')).toBe(true);
    expect(types.has('reedClosed')).toBe(true);
    expect(types.has('trainStopped')).toBe(true);
    expect(types.has('notaus')).toBe(true);
    expect(first.events.length).toBeGreaterThan(10);
  });

  it('event timestamps are monotone non-decreasing (emission order, §5.2 step 3)', () => {
    const { events } = scriptedRun(7);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const next = events[i];
      if (prev === undefined || next === undefined) continue;
      expect(next.t).toBeGreaterThanOrEqual(prev.t);
    }
  });
});
