/**
 * §9.4 Gruppe A oracle: run the local solution (reference/Claude_work/gruppeA.txt, gitignored,
 * TEST TIME ONLY) through the full sim and assert the task-derived event table
 * (expectations/gruppeA.json). Skips cleanly when the solution file is absent.
 *
 * These tests double as the §8 integration proof, with one qualification that §9.4 does not
 * make: a wrong coilToBranch entry only diverges the train on a switch the route FACES. A
 * switch the route merely TRAILS is invisible to the reed/speed sequence, so the exact
 * `switchTrailed` multiset carries the proof for those (matchers.ts header has the measured
 * mutation survey). The two mutation controls at the end cover one switch of each class.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import expectationsJson from './expectations/gruppeA.json';
import { loadOracleSource, oracleAvailable } from './loadOracle';
import type { OracleExpectations } from './matchers';
import {
  assertAllExpectations,
  assertAllPulseDurations,
  assertBounceExercised,
  assertEnding,
  assertNoForbidden,
  assertPulseGroup,
  assertSpeedSequence,
  assertStartsOnNotausRelease,
  assertStop,
  assertTrailedSet,
} from './matchers';
import type { OracleRunResult } from './scenarioRunner';
import { ORACLE_SCAN_MS, flipCoilMapping, runOracleScenario } from './scenarioRunner';

const expectations = expectationsJson as unknown as OracleExpectations;

describe.skipIf(!oracleAvailable('A'))('Gruppe A oracle (§9.4)', () => {
  let run: OracleRunResult;

  beforeAll(() => {
    const source = loadOracleSource('A');
    if (source === null) throw new Error('oracle A vanished between skipIf and run');
    run = runOracleScenario(source, {
      bounceEnabled: expectations.bounceEnabled,      // true: debounce must survive bounce
      exerciseId: expectations.exerciseId,
    });
  });

  it('completes: a final stop with 30 s quiet before the 10-minute cap', () => {
    expect(run.completed).toBe(true);
  });

  it('stays halted under Notaus and starts on the release edge (NW1 + NW2)', () => {
    assertStartsOnNotausRelease(run.events, ORACLE_SCAN_MS);
  });

  it('produces the exact speedCommand sequence of the Aufgabenstellung', () => {
    assertSpeedSequence(run.events, expectations.speedCommands);
  });

  it('throws every prescribed switch pulse after its trigger reed (300 ms ± 1 scan)', () => {
    for (const group of expectations.pulseGroups) {
      assertPulseGroup(run.events, group);
    }
  });

  it('halts 5 s at xR01D and 3 s on the siding, with the prescribed restart directions', () => {
    for (const stop of expectations.stops) {
      assertStop(run.events, stop);
    }
  });

  it('ends after the 3rd xR01BH1G1 closure with no further start', () => {
    assertEnding(run.events, expectations.ending);
  });

  it('emits no derail, coilHeld, speedConflict, coilConflict or bufferHit in the whole run', () => {
    assertNoForbidden(run.events, expectations.forbiddenEvents);
  });

  it('holds every coil pulse in the run to 300 ms ± 1 scan, not just the tabled ones', () => {
    assertAllPulseDurations(run.events);
  });

  it('trails exactly the switches A-NW7 pre-sets for the Rangierfahrt (§8 mapping proof)', () => {
    assertTrailedSet(run.events, expectations.trailedSwitches);
  });

  it('really bounces xR01D, so the NW8 Entprellen network is under test', () => {
    const bounce = expectations.bounce;
    expect(bounce, 'gruppeA.json must specify the bouncing reed').toBeDefined();
    if (bounce !== undefined) assertBounceExercised(run.events, bounce);
  });

  // Mutation controls: a green oracle is only meaningful if a broken input turns it red.
  // xW01BH1G1 is FACED on the driven route (a flip diverts the train); xW04D is only ever
  // TRAILED (a flip is invisible except through switchTrailed — the case the trailed-set
  // assertion exists for). Both must fail the full expectation set.
  it.each([
    ['xW01BH1G1', 'faced'],
    ['xW04D', 'trailed-only'],
  ])('mutation control: flipping the %s coil mapping (%s) fails the expectations', (switchId) => {
    const source = loadOracleSource('A');
    if (source === null) throw new Error('oracle A vanished mid-test');
    const broken = runOracleScenario(source, {
      bounceEnabled: expectations.bounceEnabled,
      exerciseId: expectations.exerciseId,
      mutateTrackplan: flipCoilMapping(switchId),
    });
    expect(() => {
      assertAllExpectations(broken.events, expectations, ORACLE_SCAN_MS);
    }, `flipping ${switchId} must break the §9.4 expectation set`).toThrow();
  });

  it('is deterministic: a second identical run yields a byte-identical event log', () => {
    const source = loadOracleSource('A');
    if (source === null) throw new Error('oracle A vanished mid-test');
    const again = runOracleScenario(source, {
      bounceEnabled: expectations.bounceEnabled,
      exerciseId: expectations.exerciseId,
    });
    expect(again.log).toBe(run.log);
  });
});
