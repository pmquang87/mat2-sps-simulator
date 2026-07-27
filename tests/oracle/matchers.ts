/**
 * §9.4 oracle assertions over a scenario run's SimEvent log, driven by the
 * expectations/*.json event tables (task-derived, shippable).
 *
 * Note on the §9.4 stop-duration wording: the architecture asks for
 * "trainStopped → trainStarted = 5 s / 3 s ± 150 ms". Physically the wait timer runs from
 * the trigger reed closure while `trainStopped` fires only after the deceleration lag
 * (§12 #6), so stopped→started is systematically shorter than the wait. The restart is
 * therefore measured from the TRIGGER CLOSURE (exact in simulated time): a bug in either
 * the 5 s/3 s wait or in the stop itself still fails the assertion. The ±150 ms tolerance
 * of §9.4 is kept verbatim (observed deviations are 10–50 ms).
 *
 * Note on the §9.4 pulse-ordering wording: the architecture asks for each pulse "after its
 * trigger reed's `reedClosed` and BEFORE the next `speedCommand`". That second half is not
 * satisfiable as written, for two independent reasons, so it is implemented as a bounded
 * window after the trigger closure instead:
 *   (a) `switchPulse` is emitted on the coil's FALLING edge (§5.3 pulse measurement), i.e.
 *       ~300 ms after the network ran, whereas the network's `speedCommand` lands in the
 *       SAME scan — so even a textbook-correct network pulses after its own speedCommand
 *       (xR01BH1G1#1: speedCommand at 11 750 ms, pulses at 12 050 ms).
 *   (b) A-NW8/A-NW10/B-NW7/B-NW8 throw their route AFTER the 5 s/3 s wait, i.e. after the
 *       resume speedCommand, by the task's own wording ("Nach Ablauf der Wartezeit ...").
 * The window still enforces the load-bearing half (pulse strictly after its trigger
 * closure, within a route-plausible time) and cannot match a later round's re-throw.
 *
 * Note on trailed switches (`assertTrailedSet`): a switch that the driven route only ever
 * TRAILS is invisible to the reed/speed sequence — flipping its `coilToBranch` cannot
 * divert the train, so §9.4's claim that the oracle proves every §8 mapping on the driven
 * routes does NOT hold for those switches on the sequence assertions alone. A measured
 * mutation survey (flip G/R on each driven switch) left 8 of 26 mappings undetected:
 * A xW02BH1G1, xW04D; B xW02BH1G4, xW04C, xW02BH3G2, xW01D, xW02D, xW04D. Pinning the
 * exact `switchTrailed` multiset closes all 8 — for a trailed-only switch, whether it
 * trails IS the observable. The mutation controls in the group suites keep this honest.
 *
 * `forbiddenEvents` extends §9.4's derail/coilHeld/speedConflict by `coilConflict` (both
 * coils of one switch energized at once) and `bufferHit` (ran into a buffer stop) — both are
 * unambiguous faults and both are absent from a correct run. `switchMovedUnderTrain` is
 * deliberately NOT forbidden: A-NW8 throws its switches "hinter der Lok", so brushing the
 * 50 mm occupancy envelope is a design consequence of the task, and §5.3 classes it as a
 * warning rather than a fault.
 */
import { expect } from 'vitest';
import type { SimEvent } from '../../src/plant';

export interface PulseSpec { switchId: string; coil: 'G' | 'R'; }
export interface SpeedExpectation {
  level: 0 | 1 | 2 | 3 | null;             // null = task names no level (direction only)
  direction: 'IU' | 'GU' | 'STOP';
  note?: string;
}
export interface PulseGroupExpectation {
  afterReed: string;
  closure: number;                          // n-th reedClosed of that reed (1-based)
  withinMs: number;
  pulses: PulseSpec[];
  note?: string;
}
export interface StopExpectation {
  afterReed: string;
  closure: number;
  haltMs: number;
  restartDirection: 'IU' | 'GU';
  note?: string;
}
/** Exact `switchTrailed` multiset expected over the whole run (see header note). */
export interface TrailedExpectation { switchId: string; count: number; note?: string; }
/** Bounce evidence: the debounce requirement is only exercised if the reed really bounces. */
export interface BounceExpectation {
  reedId: string;
  physicalCrossings: number;
  /** Rising edges within one physical crossing are ≤ this far apart (ms). */
  clusterGapMs: number;
  note?: string;
}
export interface OracleExpectations {
  exerciseId: string;
  bounceEnabled: boolean;
  notes?: string[];
  speedCommands: SpeedExpectation[];
  pulseGroups: PulseGroupExpectation[];
  stops: StopExpectation[];
  ending: { reedId: string; closure: number; withinMs: number; note?: string };
  forbiddenEvents: string[];
  /** Exact multiset of switchTrailed events; `[]` asserts the route never trails. */
  trailedSwitches: TrailedExpectation[];
  /** Present only where the task requires software debounce (Gruppe A NW8). */
  bounce?: BounceExpectation;
}

/** switchPulse duration tolerance: 300 ms ± 1 scan (§9.4). */
const PULSE_MIN_MS = 250;
const PULSE_MAX_MS = 350;
/** Restart delay from trigger closure: haltMs ± 150 ms (§9.4 verbatim). */
const RESTART_EARLY_MS = 150;
const RESTART_LATE_MS = 150;

export function nthClosureTime(events: readonly SimEvent[], reedId: string, n: number): number {
  let seen = 0;
  for (const e of events) {
    if (e.type === 'reedClosed' && e.reedId === reedId) {
      seen += 1;
      if (seen === n) return e.t;
    }
  }
  throw new Error(`closure #${n} of ${reedId} not found (saw ${seen})`);
}

export function assertSpeedSequence(
  events: readonly SimEvent[],
  expected: readonly SpeedExpectation[],
): void {
  const commands = events.filter((e) => e.type === 'speedCommand');
  const actual = commands.map((e) =>
    e.type === 'speedCommand' ? `L${e.level} ${e.direction}` : '',
  );
  const wanted = expected.map((s) => `L${s.level ?? '?'} ${s.direction}`);
  expect(actual.length, `speedCommand count\nactual:   ${actual.join(' | ')}\nexpected: ${wanted.join(' | ')}`)
    .toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const spec = expected[i];
    const command = commands[i];
    if (spec === undefined || command === undefined || command.type !== 'speedCommand') continue;
    expect(command.direction, `speedCommand[${i}] direction (${spec.note ?? ''})`)
      .toBe(spec.direction);
    if (spec.level !== null) {
      expect(command.level, `speedCommand[${i}] level (${spec.note ?? ''})`).toBe(spec.level);
    }
  }
}

export function assertPulseGroup(
  events: readonly SimEvent[],
  group: PulseGroupExpectation,
): void {
  const t0 = nthClosureTime(events, group.afterReed, group.closure);
  for (const spec of group.pulses) {
    const match = events.find(
      (e) =>
        e.type === 'switchPulse' &&
        e.switchId === spec.switchId &&
        e.coil === spec.coil &&
        e.t > t0 &&
        e.t <= t0 + group.withinMs,
    );
    expect(
      match,
      `pulse ${spec.switchId}${spec.coil} after ${group.afterReed}#${group.closure} ` +
        `(t0=${t0}, within ${group.withinMs} ms)`,
    ).toBeDefined();
    if (match !== undefined && match.type === 'switchPulse') {
      expect(match.durationMs, `pulse ${spec.switchId}${spec.coil} duration`)
        .toBeGreaterThanOrEqual(PULSE_MIN_MS);
      expect(match.durationMs, `pulse ${spec.switchId}${spec.coil} duration`)
        .toBeLessThanOrEqual(PULSE_MAX_MS);
    }
  }
}

export function assertStop(events: readonly SimEvent[], stop: StopExpectation): void {
  const t0 = nthClosureTime(events, stop.afterReed, stop.closure);
  const stopped = events.find((e) => e.type === 'trainStopped' && e.t > t0);
  expect(stopped, `trainStopped after ${stop.afterReed}#${stop.closure}`).toBeDefined();
  if (stopped === undefined) return;
  const started = events.find((e) => e.type === 'trainStarted' && e.t > stopped.t);
  expect(started, `trainStarted after the ${stop.afterReed} halt`).toBeDefined();
  if (started === undefined || started.type !== 'trainStarted') return;
  const delay = started.t - t0;
  expect(delay, `restart delay from ${stop.afterReed}#${stop.closure} (halt ${stop.haltMs} ms)`)
    .toBeGreaterThanOrEqual(stop.haltMs - RESTART_EARLY_MS);
  expect(delay, `restart delay from ${stop.afterReed}#${stop.closure} (halt ${stop.haltMs} ms)`)
    .toBeLessThanOrEqual(stop.haltMs + RESTART_LATE_MS);
  expect(started.direction, `restart direction after ${stop.afterReed}#${stop.closure}`)
    .toBe(stop.restartDirection);
}

export function assertEnding(
  events: readonly SimEvent[],
  ending: OracleExpectations['ending'],
): void {
  const t0 = nthClosureTime(events, ending.reedId, ending.closure);
  const stopped = events.find((e) => e.type === 'trainStopped' && e.t > t0);
  expect(stopped, `final trainStopped after ${ending.reedId}#${ending.closure}`).toBeDefined();
  if (stopped === undefined) return;
  expect(stopped.t - t0, 'final stop delay').toBeLessThanOrEqual(ending.withinMs);
  const restarted = events.find((e) => e.type === 'trainStarted' && e.t > stopped.t);
  expect(restarted, 'no trainStarted after the final stop').toBeUndefined();
}

export function assertNoForbidden(
  events: readonly SimEvent[],
  forbidden: readonly string[],
): void {
  for (const type of forbidden) {
    const hits = events.filter((e) => e.type === type);
    expect(hits, `forbidden event type ${type}`).toHaveLength(0);
  }
}

/**
 * §9.4 "300 ms ± 1 scan" applied to EVERY coil pulse in the run, not only to the ones a
 * pulseGroup happens to name: a network that holds a coil for 600 ms (or 50 ms) on a switch
 * outside the expectation tables would otherwise go unnoticed.
 */
export function assertAllPulseDurations(events: readonly SimEvent[]): void {
  const pulses = events.filter((e) => e.type === 'switchPulse');
  expect(pulses.length, 'the run must contain coil pulses at all').toBeGreaterThan(0);
  const offenders = pulses.filter(
    (e) => e.type === 'switchPulse' && (e.durationMs < PULSE_MIN_MS || e.durationMs > PULSE_MAX_MS),
  );
  expect(
    offenders.map((e) =>
      e.type === 'switchPulse' ? `${String(e.t)} ${e.switchId}${e.coil}=${String(e.durationMs)}ms` : '',
    ),
    `every switchPulse must last ${String(PULSE_MIN_MS)}–${String(PULSE_MAX_MS)} ms`,
  ).toEqual([]);
}

/**
 * Exact `switchTrailed` multiset. This is what makes the §8 coil mapping of trailed-only
 * switches observable at all (see header note) — do not relax it to a subset check.
 */
export function assertTrailedSet(
  events: readonly SimEvent[],
  expected: readonly TrailedExpectation[],
): void {
  const actual = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'switchTrailed') actual.set(e.switchId, (actual.get(e.switchId) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>): string[] =>
    [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}x${String(v)}`);
  const wanted = new Map(expected.map((t) => [t.switchId, t.count]));
  expect(fmt(actual), 'switchTrailed multiset (§8 mapping proof for trailed-only switches)')
    .toEqual(fmt(wanted));
}

/**
 * NW1 + NW2 together: nothing may be commanded while Notaus is pressed, and the first
 * speed command must follow the RELEASE edge (E 1.7 0→1) within one scan. The scenario
 * script presses at t = 0 and releases at t = 2 s (§9.4), so this also pins the scripted
 * release point that the rest of the timeline hangs off.
 */
export function assertStartsOnNotausRelease(
  events: readonly SimEvent[],
  scanMs: number,
): void {
  const release = events.find((e) => e.type === 'notaus' && !e.active);
  expect(release, 'the scenario must release Notaus (E 1.7 0->1)').toBeDefined();
  if (release === undefined) return;
  const press = events.find((e) => e.type === 'notaus' && e.active);
  expect(press, 'the scenario must press Notaus first').toBeDefined();

  const commands = events.filter((e) => e.type === 'speedCommand');
  const first = commands[0];
  expect(first, 'the program must command a speed at all').toBeDefined();
  if (first === undefined) return;

  // NW1: no speed command while Notaus is pressed.
  expect(
    commands.filter((e) => e.t <= release.t).map((e) => String(e.t)),
    'no speedCommand may be issued while Notaus is pressed (NW1)',
  ).toEqual([]);
  // NW2: the start reacts to the release edge, within the scan that observes it.
  expect(
    first.t - release.t,
    `first speedCommand must follow the Notaus release within one scan (${String(scanMs)} ms)`,
  ).toBeLessThanOrEqual(scanMs);
  // …and the train really does move off (not just a command into the void).
  const started = events.find((e) => e.type === 'trainStarted');
  expect(started, 'trainStarted after the Notaus release').toBeDefined();
  if (started !== undefined) expect(started.t).toBeGreaterThan(release.t);
}

/**
 * The whole §9.4 expectation set in one call. The per-assertion `it`s in the group suites
 * exist for diagnosis; this aggregate exists so the MUTATION CONTROLS assert against exactly
 * the same criteria the suite enforces (a control that checked less than the suite would
 * prove nothing about the suite).
 */
export function assertAllExpectations(
  events: readonly SimEvent[],
  expectations: OracleExpectations,
  scanMs: number,
): void {
  assertStartsOnNotausRelease(events, scanMs);
  assertSpeedSequence(events, expectations.speedCommands);
  for (const group of expectations.pulseGroups) assertPulseGroup(events, group);
  for (const stop of expectations.stops) assertStop(events, stop);
  assertEnding(events, expectations.ending);
  assertNoForbidden(events, expectations.forbiddenEvents);
  assertAllPulseDurations(events);
  assertTrailedSet(events, expectations.trailedSwitches);
  if (expectations.bounce !== undefined) assertBounceExercised(events, expectations.bounce);
}

/**
 * Proves the debounce requirement is genuinely under test: the bouncing reed must produce
 * strictly more PLC-visible rising edges than physical crossings. If the plant's bounce
 * were silently off (or `bounceEnabled` were dropped), the solution's Entprellen network
 * would be exercised by a clean signal and the whole point of A-NW8 would be untested,
 * while every other assertion still passed.
 */
export function assertBounceExercised(
  events: readonly SimEvent[],
  spec: BounceExpectation,
): void {
  const times = events
    .filter((e) => e.type === 'reedClosed' && e.reedId === spec.reedId)
    .map((e) => e.t);
  let clusters = 0;
  let prev: number | null = null;
  for (const t of times) {
    if (prev === null || t - prev > spec.clusterGapMs) clusters += 1;
    prev = t;
  }
  expect(clusters, `${spec.reedId}: physical crossings (edge clusters), times=[${times.join(',')}]`)
    .toBe(spec.physicalCrossings);
  expect(
    times.length,
    `${spec.reedId}: rising edges must EXCEED the ${String(spec.physicalCrossings)} crossings ` +
      `(bounce actually active), times=[${times.join(',')}]`,
  ).toBeGreaterThan(spec.physicalCrossings);
}
