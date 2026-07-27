/**
 * BehaviorChecker (ARCHITECTURE.md §5.5): SimEvent stream → per-check pass/fail/pending.
 *
 * Fed from the EventBus (`bus.on(e => checker.onEvent(e))`). Events MUST arrive in
 * chronological order — the coordinator guarantees that (§5.2 step 3). All times are
 * SIMULATED ms (`SimEvent.t`); the checker never reads a clock of its own.
 *
 * Timeout resolution (§10.1) needs one member beyond the four listed in §5.5:
 * `finalize(atSimTimeMs)`. Additive extension — the four §5.5 members keep their exact
 * signatures, and `results()` alone cannot express "the run ended, resolve what is still
 * pending" (an unmet `seq` fails, an `after` whose trigger fired fails, an `after` whose
 * trigger never fired stays pending, unviolated `never`/`invariant` pass).
 */
import type { SimEvent } from '../plant';
import type { BehaviorCheck, CheckResult, EventPattern, LocalizedText } from './types';

/** Every member of the SimEvent union (§5.3) — used to validate `EventPattern.type`. */
export const SIM_EVENT_TYPES = [
  'speedCommand',
  'speedConflict',
  'switchPulse',
  'switchMoved',
  'coilConflict',
  'coilHeld',
  'switchTrailed',
  'switchMovedUnderTrain',
  'reedClosed',
  'trainStopped',
  'trainStarted',
  'segmentEntered',
  'bufferHit',
  'derail',
  'notaus',
] as const satisfies readonly SimEvent['type'][];

/** Compile-time completeness guard: fails to type-check if the union gains a member. */
type AssertNever<T extends never> = T;
type _SimEventTypesAreComplete = AssertNever<
  Exclude<SimEvent['type'], (typeof SIM_EVENT_TYPES)[number]>
>;

export function isSimEventType(v: unknown): v is SimEvent['type'] {
  return typeof v === 'string' && (SIM_EVENT_TYPES as readonly string[]).includes(v);
}

/** Structural read of a SimEvent payload field without widening the union to `any`. */
function field(e: SimEvent, key: string): unknown {
  return (e as unknown as Record<string, unknown>)[key];
}

/** switchPulse carries `durationMs`, coilHeld carries `heldMs` — both are "a duration". */
function durationOf(e: SimEvent): number | undefined {
  const d = field(e, 'durationMs');
  if (typeof d === 'number') return d;
  const h = field(e, 'heldMs');
  if (typeof h === 'number') return h;
  return undefined;
}

const PATTERN_EQ_FIELDS = [
  'switchId',
  'coil',
  'reedId',
  'nodeId',
  'edgeId',
  'active',
  'level',
  'direction',
] as const;

/**
 * §5.5 matching rule: every field present must strictly equal the event's payload field;
 * absent fields are wildcards. `minDurationMs`/`maxDurationMs` are range constraints on the
 * event's duration payload — a pattern that states them does NOT match an event without one.
 */
export function matchesEventPattern(p: EventPattern, e: SimEvent): boolean {
  if (p.type !== e.type) return false;
  for (const key of PATTERN_EQ_FIELDS) {
    const expected = p[key];
    if (expected === undefined) continue;
    if (field(e, key) !== expected) return false;
  }
  if (p.minDurationMs !== undefined || p.maxDurationMs !== undefined) {
    const d = durationOf(e);
    if (d === undefined) return false;
    if (p.minDurationMs !== undefined && d < p.minDurationMs) return false;
    if (p.maxDurationMs !== undefined && d > p.maxDurationMs) return false;
  }
  return true;
}

// ───────────────────────────────── technical descriptions ─────────────────────────────────

/** Locale-neutral technical rendering, embedded into both language variants of `detail`. */
export function describeEventPattern(p: EventPattern): string {
  const parts: string[] = [];
  for (const key of PATTERN_EQ_FIELDS) {
    const v = p[key];
    if (v !== undefined) parts.push(`${key}=${String(v)}`);
  }
  if (p.minDurationMs !== undefined) parts.push(`≥${p.minDurationMs} ms`);
  if (p.maxDurationMs !== undefined) parts.push(`≤${p.maxDurationMs} ms`);
  return parts.length === 0 ? p.type : `${p.type}(${parts.join(', ')})`;
}

export function describeSimEvent(e: SimEvent): string {
  const parts: string[] = [];
  for (const key of PATTERN_EQ_FIELDS) {
    const v = field(e, key);
    if (v !== undefined) parts.push(`${key}=${String(v)}`);
  }
  const d = durationOf(e);
  if (d !== undefined) parts.push(`${d} ms`);
  const head = parts.length === 0 ? e.type : `${e.type}(${parts.join(', ')})`;
  return `${head} @ ${e.t} ms`;
}

// ─────────────────────────────────────── check state ──────────────────────────────────────

type Status = 'pass' | 'fail' | 'pending';

interface SeqCandidate {
  startT: number;
  idx: number;
}

interface CommonState {
  status: Status;
  detail?: LocalizedText;
}

interface SeqState extends CommonState {
  kind: 'seq';
  candidates: SeqCandidate[];
  /** Longest prefix ever matched — the diagnostic for a failing sequence. */
  bestIdx: number;
}

interface AfterState extends CommonState {
  kind: 'after';
  /** Simulated time the trigger fired, while its window is still open. */
  armedAtT: number | null;
  triggerFired: boolean;
}

interface NeverState extends CommonState {
  kind: 'never';
}

interface InvariantState extends CommonState {
  kind: 'invariant';
  /** notausForcesStop: open window start, or null when notaus is inactive. */
  notausSinceT: number | null;
  /** Was the train already moving when notaus went active? */
  movingAtActivation: boolean;
  /** Did a trainStopped arrive inside the open window? */
  stoppedInWindow: boolean;
}

type CheckState = SeqState | AfterState | NeverState | InvariantState;

function initialState(check: BehaviorCheck): CheckState {
  switch (check.kind) {
    case 'seq':
      return { kind: 'seq', status: 'pending', candidates: [], bestIdx: 0 };
    case 'after':
      return { kind: 'after', status: 'pending', armedAtT: null, triggerFired: false };
    case 'never':
      return { kind: 'never', status: 'pending' };
    case 'invariant':
      return {
        kind: 'invariant',
        status: 'pending',
        notausSinceT: null,
        movingAtActivation: false,
        stoppedInWindow: false,
      };
  }
}

export class BehaviorChecker {
  private readonly checks: BehaviorCheck[];
  private states: CheckState[];
  /** Derived from trainStarted/trainStopped; initial state: stationary (§5.5 `armWhile`). */
  private moving = false;
  private lastEventT = 0;
  private finalized = false;

  constructor(checks: BehaviorCheck[]) {
    this.checks = [...checks];
    this.states = this.checks.map(initialState);
  }

  onEvent(e: SimEvent): void {        // subscribe via EventBus
    if (this.finalized) return;
    this.lastEventT = e.t;
    // Checks see the motion state as it was BEFORE this event: `armWhile` describes the
    // state at the moment the trigger occurs, not the state the trigger itself creates.
    const movingBefore = this.moving;
    for (let i = 0; i < this.checks.length; i += 1) {
      const check = this.checks[i];
      const state = this.states[i];
      if (check === undefined || state === undefined) continue;
      this.applyEvent(check, state, e, movingBefore);
    }
    if (e.type === 'trainStarted') this.moving = true;
    else if (e.type === 'trainStopped') this.moving = false;
  }

  /**
   * Resolve the run at `atSimTimeMs` (§10.1: the network's `runTimeoutMs`). Idempotent;
   * subsequent `onEvent` calls are ignored until `reset()`.
   */
  finalize(atSimTimeMs?: number): CheckResult[] {
    const at = atSimTimeMs ?? this.lastEventT;
    if (!this.finalized) {
      this.finalized = true;
      for (let i = 0; i < this.checks.length; i += 1) {
        const check = this.checks[i];
        const state = this.states[i];
        if (check === undefined || state === undefined) continue;
        this.resolveAtEnd(check, state, at);
      }
    }
    return this.results();
  }

  results(): CheckResult[] {
    const out: CheckResult[] = [];
    for (let i = 0; i < this.checks.length; i += 1) {
      const check = this.checks[i];
      const state = this.states[i];
      if (check === undefined || state === undefined) continue;
      const result: CheckResult = { checkId: check.id, status: state.status };
      if (state.detail !== undefined) result.detail = state.detail;
      out.push(result);
    }
    return out;
  }

  reset(): void {
    this.states = this.checks.map(initialState);
    this.moving = false;
    this.lastEventT = 0;
    this.finalized = false;
  }

  // ── per-kind event handling ──────────────────────────────────────────────────────────

  private applyEvent(
    check: BehaviorCheck,
    state: CheckState,
    e: SimEvent,
    movingBefore: boolean,
  ): void {
    if (state.status === 'fail') return;                 // failures are sticky
    switch (check.kind) {
      case 'seq':
        if (state.kind === 'seq') this.applySeq(check, state, e);
        return;
      case 'after':
        if (state.kind === 'after') this.applyAfter(check, state, e, movingBefore);
        return;
      case 'never':
        if (state.kind === 'never') this.applyNever(check, state, e);
        return;
      case 'invariant':
        if (state.kind === 'invariant') this.applyInvariant(check, state, e, movingBefore);
        return;
    }
  }

  private applySeq(
    check: Extract<BehaviorCheck, { kind: 'seq' }>,
    state: SeqState,
    e: SimEvent,
  ): void {
    if (state.status === 'pass') return;
    const patterns = check.events;
    if (patterns.length === 0) {
      state.status = 'pass';
      return;
    }

    // Drop candidates whose window has expired (window runs from the FIRST match).
    const alive =
      check.windowMs === undefined
        ? state.candidates
        : state.candidates.filter((c) => e.t - c.startT <= (check.windowMs ?? 0));

    const next: SeqCandidate[] = [];
    for (const candidate of alive) {
      const pattern = patterns[candidate.idx];
      if (pattern !== undefined && matchesEventPattern(pattern, e)) {
        next.push({ startT: candidate.startT, idx: candidate.idx + 1 });
      } else {
        next.push(candidate);
      }
    }
    const first = patterns[0];
    if (first !== undefined && matchesEventPattern(first, e)) {
      next.push({ startT: e.t, idx: 1 });
    }

    // Keep the LATEST start per progress index: for an identical remaining pattern a later
    // start is strictly more permissive under `windowMs`, so it dominates.
    const bestByIdx = new Map<number, number>();
    for (const c of next) {
      const known = bestByIdx.get(c.idx);
      if (known === undefined || c.startT > known) bestByIdx.set(c.idx, c.startT);
    }
    state.candidates = [...bestByIdx.entries()].map(([idx, startT]) => ({ idx, startT }));

    for (const c of state.candidates) {
      if (c.idx > state.bestIdx) state.bestIdx = c.idx;
      if (c.idx >= patterns.length) {
        state.status = 'pass';
        delete state.detail;
        return;
      }
    }
  }

  private applyAfter(
    check: Extract<BehaviorCheck, { kind: 'after' }>,
    state: AfterState,
    e: SimEvent,
    movingBefore: boolean,
  ): void {
    // 1. An open window that this event is already past → the expectation was missed.
    if (state.armedAtT !== null && e.t - state.armedAtT > check.withinMs) {
      const armedAt = state.armedAtT;
      state.armedAtT = null;
      if (state.status !== 'pass') {
        state.status = 'fail';
        state.detail = missedExpectationDetail(check, armedAt);
        return;
      }
    }
    if (state.status === 'pass') return;

    // 2. Does this event satisfy an open expectation?
    if (state.armedAtT !== null && matchesEventPattern(check.expect, e)) {
      const dt = e.t - state.armedAtT;
      const minDelay = check.minDelayMs ?? 0;
      if (dt >= minDelay) {
        state.status = 'pass';
        delete state.detail;
        state.armedAtT = null;
        return;
      }
      // Too early: keep waiting inside the same window (a later, valid event may follow),
      // but remember why — if the window then expires this is the useful diagnostic.
      state.detail = tooEarlyDetail(check, dt);
      return;
    }

    // 3. Does this event arm the check?
    if (state.armedAtT === null && matchesEventPattern(check.trigger, e)) {
      const armOk =
        check.armWhile === undefined ||
        (check.armWhile === 'trainMoving' ? movingBefore : !movingBefore);
      if (armOk) {
        state.armedAtT = e.t;
        state.triggerFired = true;
      }
    }
  }

  private applyNever(
    check: Extract<BehaviorCheck, { kind: 'never' }>,
    state: NeverState,
    e: SimEvent,
  ): void {
    if (!matchesEventPattern(check.event, e)) return;
    state.status = 'fail';
    state.detail = {
      de: `Verbotenes Ereignis aufgetreten: ${describeSimEvent(e)}.`,
      en: `Forbidden event occurred: ${describeSimEvent(e)}.`,
    };
  }

  private applyInvariant(
    check: Extract<BehaviorCheck, { kind: 'invariant' }>,
    state: InvariantState,
    e: SimEvent,
    movingBefore: boolean,
  ): void {
    switch (check.invariant) {
      case 'exclusiveSpeedBit': {
        if (e.type !== 'speedConflict') return;
        const bits = field(e, 'm120');
        const byte = typeof bits === 'number' ? bits : 0;
        state.status = 'fail';
        state.detail = {
          de:
            `Mehr als eine Fahrstufe gleichzeitig gesetzt (Merkerbyte 0x${byte.toString(16)}) ` +
            `bei ${e.t} ms.`,
          en:
            `More than one traction stage set at the same time (flag byte 0x${byte.toString(16)}) ` +
            `at ${e.t} ms.`,
        };
        return;
      }
      case 'noCoilHeld': {
        if (e.type !== 'coilHeld') return;
        state.status = 'fail';
        state.detail = {
          de:
            `Weichenspule dauerhaft bestromt: ${describeSimEvent(e)} — erwartet ist ein ` +
            `kurzer Stellimpuls.`,
          en:
            `Point coil energised permanently: ${describeSimEvent(e)} — a short actuation ` +
            `pulse is expected.`,
        };
        return;
      }
      case 'notausForcesStop': {
        if (e.type === 'notaus') {
          if (e.active) {
            if (state.notausSinceT === null) {
              state.notausSinceT = e.t;
              state.movingAtActivation = movingBefore;
              state.stoppedInWindow = false;
            }
          } else if (state.notausSinceT !== null) {
            this.closeNotausWindow(state, e.t);
          }
          return;
        }
        if (state.notausSinceT === null) return;
        if (e.type === 'trainStopped') {
          state.stoppedInWindow = true;
          return;
        }
        if (e.type === 'trainStarted') {
          state.status = 'fail';
          state.detail = {
            de:
              `Zug fährt bei aktivem Notaus los (${e.t} ms, Notaus aktiv seit ` +
              `${state.notausSinceT} ms).`,
            en:
              `Train started while the emergency stop was active (${e.t} ms, active since ` +
              `${state.notausSinceT} ms).`,
          };
        }
        return;
      }
    }
  }

  /**
   * "no motion carried into the window" (§5.5): a train that was already rolling when
   * notaus went active must come to a stop before the window closes. Deliberately NOT
   * "zero motion from the first instant" — deceleration takes time, and A-NW1's own
   * `after` check (withinMs) is what bounds it.
   */
  private closeNotausWindow(state: InvariantState, atT: number): void {
    const since = state.notausSinceT;
    state.notausSinceT = null;
    if (since === null) return;
    if (state.movingAtActivation && !state.stoppedInWindow && state.status !== 'fail') {
      state.status = 'fail';
      state.detail = {
        de:
          `Zug kam bei aktivem Notaus nicht zum Stehen (Notaus aktiv ${since}…${atT} ms, ` +
          `kein Stillstand in diesem Fenster).`,
        en:
          `Train never came to a stand while the emergency stop was active (active ` +
          `${since}…${atT} ms, no standstill inside that window).`,
      };
    }
    state.movingAtActivation = false;
    state.stoppedInWindow = false;
  }

  // ── timeout resolution (§10.1) ───────────────────────────────────────────────────────

  private resolveAtEnd(check: BehaviorCheck, state: CheckState, atT: number): void {
    if (state.status !== 'pending') return;
    switch (check.kind) {
      case 'seq': {
        if (state.kind !== 'seq') return;
        state.status = 'fail';
        const total = check.events.length;
        const missing = check.events[state.bestIdx];
        const missingText =
          missing === undefined ? '—' : describeEventPattern(missing);
        state.detail = {
          de:
            `Ereignisfolge unvollständig: ${state.bestIdx} von ${total} Ereignissen erkannt; ` +
            `fehlt: ${missingText}.`,
          en:
            `Event sequence incomplete: matched ${state.bestIdx} of ${total} events; ` +
            `missing: ${missingText}.`,
        };
        return;
      }
      case 'after': {
        if (state.kind !== 'after') return;
        if (state.armedAtT !== null) {
          const armedAt = state.armedAtT;
          state.armedAtT = null;
          state.status = 'fail';
          state.detail = missedExpectationDetail(check, armedAt);
          return;
        }
        if (!state.triggerFired) {
          // Stays pending — "not exercised" (§10.1), not a failure.
          state.detail = {
            de:
              `Nicht geprüft: Auslöser ${describeEventPattern(check.trigger)} trat im Lauf ` +
              `nicht auf${check.armWhile === undefined ? '' : ' (bzw. nicht im passenden Fahrzustand)'}.`,
            en:
              `Not exercised: trigger ${describeEventPattern(check.trigger)} never occurred ` +
              `during the run${check.armWhile === undefined ? '' : ' (or not in the required motion state)'}.`,
          };
        }
        return;
      }
      case 'never':
        state.status = 'pass';
        return;
      case 'invariant': {
        if (state.kind !== 'invariant') return;
        if (check.invariant === 'notausForcesStop' && state.notausSinceT !== null) {
          this.closeNotausWindow(state, atT);
        }
        if (state.status === 'pending') state.status = 'pass';
        return;
      }
    }
  }
}

function missedExpectationDetail(
  check: Extract<BehaviorCheck, { kind: 'after' }>,
  armedAtT: number,
): LocalizedText {
  return {
    de:
      `Erwartetes Ereignis ${describeEventPattern(check.expect)} trat nicht innerhalb von ` +
      `${check.withinMs} ms nach ${describeEventPattern(check.trigger)} (${armedAtT} ms) ein.`,
    en:
      `Expected event ${describeEventPattern(check.expect)} did not occur within ` +
      `${check.withinMs} ms after ${describeEventPattern(check.trigger)} (${armedAtT} ms).`,
  };
}

function tooEarlyDetail(
  check: Extract<BehaviorCheck, { kind: 'after' }>,
  dtMs: number,
): LocalizedText {
  const minDelay = check.minDelayMs ?? 0;
  return {
    de:
      `${describeEventPattern(check.expect)} trat bereits nach ${dtMs} ms auf — erwartet ` +
      `frühestens nach ${minDelay} ms.`,
    en:
      `${describeEventPattern(check.expect)} occurred after only ${dtMs} ms — expected no ` +
      `earlier than ${minDelay} ms.`,
  };
}

/** Roll-up for the ExercisePanel result list and the ProgressStore update (§10.1). */
export interface CheckSummary {
  passed: number;
  failed: number;
  pending: number;
  /** True when nothing failed and at least one check passed (nothing pending either). */
  allPassed: boolean;
}

export function summarizeResults(results: readonly CheckResult[]): CheckSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const r of results) {
    if (r.status === 'pass') passed += 1;
    else if (r.status === 'fail') failed += 1;
    else pending += 1;
  }
  return { passed, failed, pending, allPassed: failed === 0 && pending === 0 && passed > 0 };
}
