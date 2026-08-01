/**
 * §9.3 trainOnTrack.test.ts — the §5.3 position invariant through the ASSEMBLED stack
 * (Emulator + Plant + Wiring + SimCoordinator on the shipped trackplan, scan 50 ms), for the
 * exact scenario shape of the bug report: Notaus pressed at t = 0, released at t = 2 s, then
 * free-run well past cycle 1454 / 72.7 s of simulated time.
 *
 * The plant-level scenarios live in tests/plant/trainOnTrack.test.ts; this suite adds the
 * coordinator's I/O ferrying and the 50 ms scan phase, and it runs the reverse (GU) leg that
 * the report's Rangierfahrt exercises, because that is the direction in which a sign error at
 * an edge hand-over would surface.
 *
 * Deliberately independent of `reference/Claude_work/` (see tests/oracle/gruppeAOnTrack.oracle.test.ts
 * for the run of the actual Gruppe A solution): CI must keep this guard even without the
 * solution files.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import { onTrackChecker } from '../plant/support/onTrack';
import { DRIVE_PROGRAM, buildHarness } from './harness';

const realPlan = trackplanJson as unknown as TrackplanFile;

/** Same shape as DRIVE_PROGRAM but reversing (GU): the Rangierfahrt direction. */
const REVERSE_PROGRAM = [
  'U  "NotausBit"',
  'S  "Speed3GU"',
  'UN "NotausBit"',
  'R  "Speed3GU"',
  'UN "NotausBit"',
  'S  "STOP"',
  'U  "NotausBit"',
  'R  "STOP"',
  '',
].join('\n');

/** Cycle and sim time of the reported failure (scan 50 ms ⇒ cycle n ends at n·50 ms). */
const REPORTED_CYCLE = 1454;
const SCAN_MS = 50;
const REPORTED_MS = REPORTED_CYCLE * SCAN_MS;   // 72 700 ms
const RUN_MS = 150_000;                          // 3 000 cycles — well past the report

function runInvariantScenario(program: string, label: string): {
  cycles: number;
  events: SimEvent[];
  atReportedCycle: { edgeId: string; offsetMm: number; direction: 1 | -1 };
} {
  const harness = buildHarness({ program, scanIntervalMs: SCAN_MS });
  harness.coordinator.loadScenario([
    { atMs: 0, action: 'notaus', active: true },
    { atMs: 2_000, action: 'notaus', active: false },
  ]);
  const { check } = onTrackChecker(realPlan);
  check(harness.coordinator.snapshot(), `${label} t=0`);
  let atReported: { edgeId: string; offsetMm: number; direction: 1 | -1 } | null = null;
  const steps = RUN_MS / 10;
  for (let step = 1; step <= steps; step++) {
    harness.coordinator.advanceSteps(1);
    const snapshot = harness.coordinator.snapshot();
    check(snapshot, `${label} cycle ${Math.floor(snapshot.timeMs / SCAN_MS)}`);
    if (snapshot.timeMs === REPORTED_MS) {
      atReported = {
        edgeId: snapshot.train.edgeId,
        offsetMm: snapshot.train.offsetMm,
        direction: snapshot.train.direction,
      };
    }
  }
  expect(atReported, `${label}: never reached t = ${REPORTED_MS} ms`).not.toBeNull();
  return {
    cycles: RUN_MS / SCAN_MS,
    events: harness.events,
    atReportedCycle: atReported as { edgeId: string; offsetMm: number; direction: 1 | -1 },
  };
}

describe('§5.3 position invariant through the assembled stack', () => {
  it('holds for 3 000 scan cycles driving IU at speed 3', () => {
    const run = runInvariantScenario(DRIVE_PROGRAM, 'IU');
    expect(run.cycles).toBeGreaterThan(REPORTED_CYCLE);
    // the train really moved (otherwise the invariant would be trivially satisfied)
    expect(run.events.filter((e) => e.type === 'segmentEntered').length).toBeGreaterThan(5);
  });

  it('holds for 3 000 scan cycles driving GU at speed 3 (reverse leg)', () => {
    const run = runInvariantScenario(REVERSE_PROGRAM, 'GU');
    expect(run.events.filter((e) => e.type === 'segmentEntered').length).toBeGreaterThan(5);
    // the reported cycle is reached and the train is on a real edge there
    expect(run.atReportedCycle.offsetMm).toBeGreaterThanOrEqual(0);
  });
});
