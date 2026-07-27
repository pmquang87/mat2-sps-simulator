/**
 * BehaviorChecker semantics (ARCHITECTURE.md §5.5, test list §9.3): seq matching
 * (subsequence, not contiguity), windowMs, `after` with min/max delay, `after` payload
 * pinning, `armWhile` gating, `never` violation, the three invariants.
 */
import { describe, expect, it } from 'vitest';

import type { SimEvent } from '../../src/plant';
import {
  BehaviorChecker,
  SIM_EVENT_TYPES,
  isSimEventType,
  matchesEventPattern,
  summarizeResults,
  type BehaviorCheck,
  type CheckResult,
} from '../../src/pedagogy';

// ── event builders (neutral ids — no plant symbols needed for semantics tests) ────────────

const notaus = (t: number, active: boolean): SimEvent => ({ t, type: 'notaus', active });
const stopped = (t: number): SimEvent => ({ t, type: 'trainStopped' });
const started = (t: number, direction: 'IU' | 'GU' = 'IU'): SimEvent => ({
  t,
  type: 'trainStarted',
  direction,
});
const reed = (t: number, reedId: string): SimEvent => ({ t, type: 'reedClosed', reedId });
const pulse = (
  t: number,
  switchId: string,
  coil: 'G' | 'R',
  durationMs: number,
): SimEvent => ({ t, type: 'switchPulse', switchId, coil, durationMs });
const speedCommand = (
  t: number,
  level: 0 | 1 | 2 | 3,
  direction: 'IU' | 'GU' | 'STOP',
): SimEvent => ({ t, type: 'speedCommand', level, direction, word: level });
const speedConflict = (t: number, m120: number): SimEvent => ({ t, type: 'speedConflict', m120 });
const coilHeld = (t: number, switchId: string, heldMs: number): SimEvent => ({
  t,
  type: 'coilHeld',
  switchId,
  coil: 'G',
  heldMs,
});

const DESC = { de: 'Testprüfung', en: 'Test check' };

function run(checks: BehaviorCheck[], events: SimEvent[], finalizeAt?: number): CheckResult[] {
  const checker = new BehaviorChecker(checks);
  for (const e of events) checker.onEvent(e);
  return finalizeAt === undefined ? checker.results() : checker.finalize(finalizeAt);
}

function statusOf(results: readonly CheckResult[], id: string): string {
  const hit = results.find((r) => r.checkId === id);
  return hit === undefined ? 'missing' : hit.status;
}

// ── the event-type registry ──────────────────────────────────────────────────────────────

describe('SimEvent type registry', () => {
  it('covers the whole union', () => {
    expect(SIM_EVENT_TYPES).toHaveLength(15);
    expect(new Set(SIM_EVENT_TYPES).size).toBe(SIM_EVENT_TYPES.length);
  });

  it('recognises valid and rejects invalid type names', () => {
    expect(isSimEventType('switchPulse')).toBe(true);
    expect(isSimEventType('trainDerailed')).toBe(false);
    expect(isSimEventType(42)).toBe(false);
  });
});

// ── pattern matching ─────────────────────────────────────────────────────────────────────

describe('matchesEventPattern', () => {
  it('treats absent fields as wildcards and present fields as strict equality', () => {
    const e = pulse(1000, 'W1', 'G', 300);
    expect(matchesEventPattern({ type: 'switchPulse' }, e)).toBe(true);
    expect(matchesEventPattern({ type: 'switchPulse', switchId: 'W1' }, e)).toBe(true);
    expect(matchesEventPattern({ type: 'switchPulse', switchId: 'W2' }, e)).toBe(false);
    expect(matchesEventPattern({ type: 'switchPulse', coil: 'R' }, e)).toBe(false);
    expect(matchesEventPattern({ type: 'switchMoved' }, e)).toBe(false);
  });

  it('pins the notaus payload — without `active` both press and release match', () => {
    expect(matchesEventPattern({ type: 'notaus' }, notaus(10, true))).toBe(true);
    expect(matchesEventPattern({ type: 'notaus' }, notaus(20, false))).toBe(true);
    expect(matchesEventPattern({ type: 'notaus', active: true }, notaus(20, false))).toBe(false);
  });

  it('applies duration bounds to the event duration payload', () => {
    const e = pulse(1000, 'W1', 'G', 300);
    expect(matchesEventPattern({ type: 'switchPulse', minDurationMs: 250 }, e)).toBe(true);
    expect(matchesEventPattern({ type: 'switchPulse', maxDurationMs: 250 }, e)).toBe(false);
    expect(
      matchesEventPattern({ type: 'switchPulse', minDurationMs: 250, maxDurationMs: 350 }, e),
    ).toBe(true);
    // coilHeld carries `heldMs` — also a duration
    expect(matchesEventPattern({ type: 'coilHeld', minDurationMs: 4000 }, coilHeld(1, 'W1', 5000))).toBe(
      true,
    );
    // an event without any duration payload cannot satisfy a duration bound
    expect(matchesEventPattern({ type: 'trainStopped', minDurationMs: 1 }, stopped(5))).toBe(false);
  });
});

// ── seq ──────────────────────────────────────────────────────────────────────────────────

describe('seq checks', () => {
  const seqCheck: BehaviorCheck = {
    kind: 'seq',
    id: 'seq-1',
    description: DESC,
    events: [
      { type: 'reedClosed', reedId: 'R1' },
      { type: 'switchPulse', switchId: 'W1', coil: 'G' },
      { type: 'speedCommand', level: 2, direction: 'IU' },
    ],
  };

  it('matches a subsequence, not a contiguous run', () => {
    const results = run(
      [seqCheck],
      [
        reed(1000, 'R1'),
        reed(1050, 'R9'), // unrelated event in between
        pulse(1100, 'W1', 'G', 300),
        stopped(1200), // more noise
        speedCommand(1300, 2, 'IU'),
      ],
    );
    expect(statusOf(results, 'seq-1')).toBe('pass');
  });

  it('requires the given order', () => {
    const results = run(
      [seqCheck],
      [pulse(1000, 'W1', 'G', 300), reed(1100, 'R1'), speedCommand(1200, 2, 'IU')],
      5000,
    );
    expect(statusOf(results, 'seq-1')).toBe('fail');
  });

  it('reports how far it got when it fails at the run timeout', () => {
    const results = run([seqCheck], [reed(1000, 'R1'), pulse(1100, 'W1', 'G', 300)], 9000);
    const result = results[0];
    expect(result?.status).toBe('fail');
    expect(result?.detail?.en).toContain('matched 2 of 3');
    expect(result?.detail?.de).toContain('2 von 3');
  });

  it('honours windowMs and can restart on a later occurrence', () => {
    const windowed: BehaviorCheck = {
      kind: 'seq',
      id: 'seq-window',
      description: DESC,
      events: [{ type: 'reedClosed', reedId: 'R1' }, { type: 'trainStopped' }],
      windowMs: 1000,
    };
    const checker = new BehaviorChecker([windowed]);
    checker.onEvent(reed(0, 'R1'));
    checker.onEvent(stopped(2000)); // too late — window expired
    expect(statusOf(checker.results(), 'seq-window')).toBe('pending');
    checker.onEvent(reed(3000, 'R1'));
    checker.onEvent(stopped(3400)); // inside the window this time
    expect(statusOf(checker.results(), 'seq-window')).toBe('pass');
  });
});

// ── after ────────────────────────────────────────────────────────────────────────────────

describe('after checks', () => {
  const stopAfterNotaus: BehaviorCheck = {
    kind: 'after',
    id: 'after-stop',
    description: DESC,
    trigger: { type: 'notaus', active: true },
    expect: { type: 'trainStopped' },
    withinMs: 4000,
  };

  it('passes when the expected event arrives inside the window', () => {
    const results = run([stopAfterNotaus], [notaus(2000, true), stopped(3500)]);
    expect(statusOf(results, 'after-stop')).toBe('pass');
  });

  it('fails when the window expires unmatched', () => {
    const results = run([stopAfterNotaus], [notaus(2000, true), stopped(9000)]);
    const result = results[0];
    expect(result?.status).toBe('fail');
    expect(result?.detail?.en).toContain('within 4000 ms');
  });

  it('fails at the run timeout when the expected event never occurs', () => {
    const results = run([stopAfterNotaus], [notaus(2000, true)], 30000);
    expect(statusOf(results, 'after-stop')).toBe('fail');
  });

  it('stays pending ("not exercised") when the trigger never fires', () => {
    const results = run([stopAfterNotaus], [stopped(1000)], 30000);
    const result = results[0];
    expect(result?.status).toBe('pending');
    expect(result?.detail?.en).toContain('Not exercised');
  });

  it('pins the trigger payload — the notaus RELEASE does not arm the check', () => {
    const results = run([stopAfterNotaus], [notaus(2000, false), stopped(9000)], 30000);
    expect(statusOf(results, 'after-stop')).toBe('pending');
  });

  it('respects minDelayMs: too-early events keep waiting, a later valid one passes', () => {
    const dwell: BehaviorCheck = {
      kind: 'after',
      id: 'after-dwell',
      description: DESC,
      trigger: { type: 'trainStopped' },
      expect: { type: 'trainStarted' },
      withinMs: 6000,
      minDelayMs: 5000,
    };
    const checker = new BehaviorChecker([dwell]);
    checker.onEvent(stopped(1000));
    checker.onEvent(started(2000)); // only 1 s of dwell — too early
    expect(statusOf(checker.results(), 'after-dwell')).toBe('pending');
    checker.onEvent(started(6500)); // 5.5 s after the stop — inside [5000, 6000]
    expect(statusOf(checker.results(), 'after-dwell')).toBe('pass');
  });

  it('reports the too-early diagnostic when the window closes on early events only', () => {
    const dwell: BehaviorCheck = {
      kind: 'after',
      id: 'after-early',
      description: DESC,
      trigger: { type: 'trainStopped' },
      expect: { type: 'trainStarted' },
      withinMs: 6000,
      minDelayMs: 5000,
    };
    const checker = new BehaviorChecker([dwell]);
    checker.onEvent(stopped(0));
    checker.onEvent(started(1000));
    // while the window is still open the too-early event is reported as the diagnostic
    expect(checker.results()[0]?.detail?.en).toContain('after only 1000 ms');
    const results = checker.finalize(20000);
    const result = results[0];
    expect(result?.status).toBe('fail');
    expect(result?.detail?.en).toContain('within 6000 ms');
  });

  describe('armWhile', () => {
    const armed: BehaviorCheck = {
      kind: 'after',
      id: 'after-armed',
      description: DESC,
      trigger: { type: 'notaus', active: true },
      expect: { type: 'trainStopped' },
      withinMs: 4000,
      armWhile: 'trainMoving',
    };

    it('does not fire when the train is already stationary (no false fail)', () => {
      const results = run([armed], [notaus(2000, true), notaus(6000, false)], 30000);
      expect(statusOf(results, 'after-armed')).toBe('pending');
    });

    it('fires when the train is moving at trigger time', () => {
      const results = run([armed], [started(500), notaus(2000, true), stopped(3200)], 30000);
      expect(statusOf(results, 'after-armed')).toBe('pass');
    });

    it('supports the trainStationary variant', () => {
      const stationary: BehaviorCheck = {
        kind: 'after',
        id: 'after-stationary',
        description: DESC,
        trigger: { type: 'notaus', active: false },
        expect: { type: 'trainStarted' },
        withinMs: 4000,
        armWhile: 'trainStationary',
      };
      const passing = run([stationary], [notaus(6000, false), started(6500)], 30000);
      expect(statusOf(passing, 'after-stationary')).toBe('pass');
      const notArmed = run(
        [stationary],
        [started(100), notaus(6000, false), stopped(20000)],
        30000,
      );
      expect(statusOf(notArmed, 'after-stationary')).toBe('pending');
    });
  });
});

// ── never ────────────────────────────────────────────────────────────────────────────────

describe('never checks', () => {
  const noSecondPulse: BehaviorCheck = {
    kind: 'never',
    id: 'never-pulse',
    description: DESC,
    event: { type: 'switchPulse', switchId: 'W1', coil: 'R' },
  };

  it('fails on the forbidden event and names it', () => {
    const results = run([noSecondPulse], [pulse(1000, 'W1', 'R', 300)], 5000);
    const result = results[0];
    expect(result?.status).toBe('fail');
    expect(result?.detail?.en).toContain('switchPulse');
    expect(result?.detail?.de).toContain('Verbotenes Ereignis');
  });

  it('passes at the run timeout when nothing matched', () => {
    const results = run([noSecondPulse], [pulse(1000, 'W1', 'G', 300)], 5000);
    expect(statusOf(results, 'never-pulse')).toBe('pass');
  });

  it('is pending until the run is resolved', () => {
    const checker = new BehaviorChecker([noSecondPulse]);
    checker.onEvent(pulse(1000, 'W2', 'G', 300));
    expect(statusOf(checker.results(), 'never-pulse')).toBe('pending');
  });
});

// ── invariants ───────────────────────────────────────────────────────────────────────────

describe('invariant checks', () => {
  const exclusive: BehaviorCheck = {
    kind: 'invariant',
    id: 'inv-speed',
    description: DESC,
    invariant: 'exclusiveSpeedBit',
  };
  const noHold: BehaviorCheck = {
    kind: 'invariant',
    id: 'inv-coil',
    description: DESC,
    invariant: 'noCoilHeld',
  };
  const forcesStop: BehaviorCheck = {
    kind: 'invariant',
    id: 'inv-notaus',
    description: DESC,
    invariant: 'notausForcesStop',
  };

  it('exclusiveSpeedBit fires on a double-set speed byte', () => {
    expect(statusOf(run([exclusive], [speedConflict(1000, 0b0000_0110)], 5000), 'inv-speed')).toBe(
      'fail',
    );
    expect(statusOf(run([exclusive], [speedCommand(1000, 2, 'IU')], 5000), 'inv-speed')).toBe(
      'pass',
    );
  });

  it('noCoilHeld fires on a permanently energised coil', () => {
    const results = run([noHold], [coilHeld(6000, 'W1', 5000)], 9000);
    const result = results[0];
    expect(result?.status).toBe('fail');
    expect(result?.detail?.de).toContain('dauerhaft');
    expect(statusOf(run([noHold], [pulse(1000, 'W1', 'G', 300)], 5000), 'inv-coil')).toBe('pass');
  });

  describe('notausForcesStop', () => {
    it('fails when the train starts while notaus is active', () => {
      const results = run([forcesStop], [notaus(1000, true), started(2000)], 9000);
      const result = results[0];
      expect(result?.status).toBe('fail');
      expect(result?.detail?.en).toContain('started while the emergency stop was active');
    });

    it('fails when a moving train never comes to a stand inside the window', () => {
      const results = run(
        [forcesStop],
        [started(500), notaus(1000, true), notaus(8000, false)],
        20000,
      );
      const result = results[0];
      expect(result?.status).toBe('fail');
      expect(result?.detail?.en).toContain('never came to a stand');
    });

    it('passes when a moving train stops inside the window (deceleration is allowed)', () => {
      const results = run(
        [forcesStop],
        [started(500), notaus(2000, true), stopped(3500), notaus(6000, false), started(6500)],
        20000,
      );
      expect(statusOf(results, 'inv-notaus')).toBe('pass');
    });

    it('passes when the train was stationary the whole time', () => {
      const results = run([forcesStop], [notaus(2000, true), notaus(6000, false)], 20000);
      expect(statusOf(results, 'inv-notaus')).toBe('pass');
    });

    it('also resolves a still-open notaus window at the run timeout', () => {
      const results = run([forcesStop], [started(500), notaus(1000, true)], 20000);
      expect(statusOf(results, 'inv-notaus')).toBe('fail');
    });
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────────────────────

describe('checker lifecycle', () => {
  const check: BehaviorCheck = {
    kind: 'never',
    id: 'never-derail',
    description: DESC,
    event: { type: 'derail' },
  };

  it('ignores events after finalize and is idempotent', () => {
    const checker = new BehaviorChecker([check]);
    const first = checker.finalize(1000);
    expect(statusOf(first, 'never-derail')).toBe('pass');
    checker.onEvent({ t: 2000, type: 'derail' });
    expect(statusOf(checker.finalize(3000), 'never-derail')).toBe('pass');
  });

  it('reset() returns every check to pending', () => {
    const checker = new BehaviorChecker([check]);
    checker.onEvent({ t: 1000, type: 'derail' });
    expect(statusOf(checker.results(), 'never-derail')).toBe('fail');
    checker.reset();
    expect(statusOf(checker.results(), 'never-derail')).toBe('pending');
  });

  it('keeps results in check order and summarises them', () => {
    const checker = new BehaviorChecker([
      check,
      { kind: 'invariant', id: 'inv-a', description: DESC, invariant: 'noCoilHeld' },
      {
        kind: 'after',
        id: 'after-a',
        description: DESC,
        trigger: { type: 'notaus', active: true },
        expect: { type: 'trainStopped' },
        withinMs: 1000,
      },
    ]);
    const results = checker.finalize(5000);
    expect(results.map((r) => r.checkId)).toEqual(['never-derail', 'inv-a', 'after-a']);
    const summary = summarizeResults(results);
    expect(summary).toMatchObject({ passed: 2, failed: 0, pending: 1, allPassed: false });
  });
});
