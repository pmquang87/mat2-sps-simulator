/**
 * §9.4 Gruppe B oracle: run the local solution (reference/Claude_work/gruppeB.txt, gitignored,
 * TEST TIME ONLY) through the full sim and assert the task-derived event table
 * (expectations/gruppeB.json). Skips cleanly when the solution file is absent.
 *
 * The loco starts on Bahnhof 1 Gleis 4 (trackplan `exerciseStarts.gruppeB`, §7.1
 * deviation note) — B-NW10 returns "auf das ursprüngliche Gleis 4".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import expectationsJson from './expectations/gruppeB.json';
import { loadOracleSource, oracleAvailable } from './loadOracle';
import type { OracleExpectations } from './matchers';
import {
  assertAllExpectations,
  assertAllPulseDurations,
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

describe.skipIf(!oracleAvailable('B'))('Gruppe B oracle (§9.4)', () => {
  let run: OracleRunResult;

  beforeAll(() => {
    const source = loadOracleSource('B');
    if (source === null) throw new Error('oracle B vanished between skipIf and run');
    run = runOracleScenario(source, {
      bounceEnabled: expectations.bounceEnabled,
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

  it('halts 5 s at xR03A and 5 s at xR03BH1G3, with the prescribed restart directions', () => {
    for (const stop of expectations.stops) {
      assertStop(run.events, stop);
    }
  });

  it('ends after the 2nd xR03BH1G4 closure with no further start', () => {
    assertEnding(run.events, expectations.ending);
  });

  it('emits no derail, coilHeld, speedConflict, coilConflict or bufferHit in the whole run', () => {
    assertNoForbidden(run.events, expectations.forbiddenEvents);
  });

  it('holds every coil pulse in the run to 300 ms ± 1 scan, not just the tabled ones', () => {
    assertAllPulseDurations(run.events);
  });

  it('never trails a switch on the Gruppe B route (§8 mapping proof)', () => {
    assertTrailedSet(run.events, expectations.trailedSwitches);
  });

  // Mutation controls, as for Gruppe A: xW03C is FACED on the driven route (a flip diverts
  // the train); xW02D is only ever TRAILED, so only the empty-trailed-set assertion can see
  // a flip. Both must fail the full expectation set.
  it.each([
    ['xW03C', 'faced'],
    ['xW02D', 'trailed-only'],
  ])('mutation control: flipping the %s coil mapping (%s) fails the expectations', (switchId) => {
    const source = loadOracleSource('B');
    if (source === null) throw new Error('oracle B vanished mid-test');
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
    const source = loadOracleSource('B');
    if (source === null) throw new Error('oracle B vanished mid-test');
    const again = runOracleScenario(source, {
      bounceEnabled: expectations.bounceEnabled,
      exerciseId: expectations.exerciseId,
    });
    expect(again.log).toBe(run.log);
  });
});
