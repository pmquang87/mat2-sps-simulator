/**
 * tests/plant/exerciseStart.test.ts — per-exercise start position (trackplan.json
 * `exerciseStarts`, ARCHITECTURE.md §7.1 deviation note) and the re-seating API the live
 * simulation stack uses (`Plant.setStart`).
 *
 * Regression guard for D13: `exerciseStarts` was applied only on the throwaway Plants built
 * for check runs and in tests/oracle/scenarioRunner.ts, while the live stack kept the §7.1
 * `start` (Bahnhof 1 Gleis 1 — the Gruppe A position). Selecting Gruppe B therefore left the
 * visible loco on Gleis 1, although the Aufgabenstellung starts and ends it on Gleis 4
 * ("Einfahrt in den Bahnhof 1 wieder auf das ursprüngliche Gleis 4", B-NW10/B-NW11).
 *
 * Ground truth here is the WIRED REED the assignment names, not the field's own note: the
 * start must sit on that reed's edge, upstream of it in the direction of travel — otherwise
 * the trigger the exercise is built on (B-NW3 on "xR03BH1G4") can never fire. Gruppe A is
 * carried through every case as the control: it has no `exerciseStarts` entry, so it must
 * resolve to the §7.1 default and must NOT move when Gruppe B does.
 */
import { describe, expect, it } from 'vitest';
import exercisesJson from '../../src/data/exercises.json';
import trackplanJson from '../../src/data/trackplan.json';
import { Plant, startForExercise } from '../../src/plant';
import type { ReedSpec, TrackplanFile } from '../../src/plant/types';

const plan = trackplanJson as unknown as TrackplanFile;

function reed(id: string): ReedSpec {
  const r = plan.reeds.find((x) => x.id === id);
  if (r === undefined) throw new Error(`test fixture: no reed "${id}" in trackplan.json`);
  return r;
}

/** The reed each Aufgabenstellung uses as its first trigger after departure. */
const FIRST_TRIGGER = {
  gruppeA: 'xR01BH1G1',   // A-NW11 final stop, Bahnhof 1 Gleis 1
  gruppeB: 'xR03BH1G4',   // B-NW3 turn into the See-Kehre, Bahnhof 1 Gleis 4
} as const;

describe('startForExercise (trackplan exerciseStarts, §7.1 deviation)', () => {
  it('places Gruppe B on the Gleis 4 edge, upstream of its first trigger reed', () => {
    const start = startForExercise(plan, 'gruppeB');
    const trigger = reed(FIRST_TRIGGER.gruppeB);

    expect(start.edgeId).toBe(trigger.edgeId);
    expect(start.direction).toBe(1);
    expect(start.offsetMm).toBeLessThan(trigger.offsetMm);
  });

  it('leaves Gruppe A on the §7.1 default start (control: no exerciseStarts entry)', () => {
    const start = startForExercise(plan, 'gruppeA');
    const trigger = reed(FIRST_TRIGGER.gruppeA);

    expect(start).toEqual(plan.start);
    expect(start.edgeId).toBe(trigger.edgeId);
    expect(start.offsetMm).toBeLessThan(trigger.offsetMm);
  });

  it('resolves an unknown exercise id to the §7.1 default', () => {
    expect(startForExercise(plan, 'gruppeZ')).toEqual(plan.start);
  });

  it('puts the two groups on different edges (the defect was that they did not)', () => {
    expect(startForExercise(plan, 'gruppeB').edgeId)
      .not.toBe(startForExercise(plan, 'gruppeA').edgeId);
  });

  /**
   * The start-track switch in the ControlPanel offers exactly these two ids, and `main.ts`
   * reports `gruppeA` as the seat of the untouched §7.1 start. A renamed exercise id or a
   * typo in an `exerciseStarts` key would leave the switch pressing a button that seats
   * nothing — silently, because `startForExercise` falls back to the default.
   */
  it('agrees with the exercise ids the UI offers', () => {
    const ids = exercisesJson.exercises.map((e) => e.id);
    expect(ids).toContain('gruppeA');
    expect(ids).toContain('gruppeB');
    for (const key of Object.keys(plan.exerciseStarts ?? {})) {
      expect(ids, `exerciseStarts key "${key}" is not an exercise id`).toContain(key);
    }
  });
});

describe('Plant.setStart — re-seating the live plant (D13)', () => {
  /** Built exactly as main.ts `buildSimStack` builds the live stack: raw trackplan. */
  function livePlant(): Plant {
    return new Plant({ trackplan: plan, seed: 1 });
  }

  it('starts on the §7.1 default before an exercise is chosen', () => {
    const train = livePlant().snapshot().train;
    expect(train.edgeId).toBe(plan.start.edgeId);
    expect(train.offsetMm).toBe(plan.start.offsetMm);
  });

  it('seats the loco on Bahnhof 1 Gleis 4 for Gruppe B', () => {
    const plant = livePlant();
    plant.setStart(startForExercise(plan, 'gruppeB'));

    const train = plant.snapshot().train;
    const trigger = reed(FIRST_TRIGGER.gruppeB);
    expect(train.edgeId).toBe(trigger.edgeId);
    expect(train.offsetMm).toBeLessThan(trigger.offsetMm);
  });

  it('returns to the Gruppe A seat when the selection changes back', () => {
    const plant = livePlant();
    plant.setStart(startForExercise(plan, 'gruppeB'));
    plant.setStart(startForExercise(plan, 'gruppeA'));

    const train = plant.snapshot().train;
    expect(train.edgeId).toBe(plan.start.edgeId);
    expect(train.offsetMm).toBe(plan.start.offsetMm);
  });

  it('keeps the exercise seat across a plain reset (the Reset button)', () => {
    const plant = livePlant();
    plant.setStart(startForExercise(plan, 'gruppeB'));
    plant.setFahrstromWord(0x0102);
    plant.step(500);

    plant.reset();                        // what the UI's Reset button reaches

    const train = plant.snapshot().train;
    expect(train.edgeId).toBe(reed(FIRST_TRIGGER.gruppeB).edgeId);
    expect(train.offsetMm).toBe(startForExercise(plan, 'gruppeB').offsetMm);
  });

  it('re-seating also resets plant state (time, Fahrstrom, Notaus)', () => {
    const plant = livePlant();
    plant.setNotaus(true);
    plant.setFahrstromWord(0x0102);
    plant.step(1000);
    expect(plant.snapshot().timeMs).toBe(1000);

    plant.setStart(startForExercise(plan, 'gruppeB'));

    const snap = plant.snapshot();
    expect(snap.timeMs).toBe(0);
    expect(snap.notausActive).toBe(false);
    expect(snap.fahrstrom.level).toBe(0);
    expect(snap.train.speedMmS).toBe(0);
  });

  it('rejects a start the board cannot hold (validation still runs)', () => {
    const plant = livePlant();
    expect(() => plant.setStart({ edgeId: 'e-does-not-exist', offsetMm: 0, direction: 1 }))
      .toThrow(/e-does-not-exist/);
    expect(() => plant.setStart({ edgeId: plan.start.edgeId, offsetMm: 1e9, direction: 1 }))
      .toThrow(/outside edge/);
  });

  it('keeps a rejected re-seat from moving the loco', () => {
    const plant = livePlant();
    plant.setStart(startForExercise(plan, 'gruppeB'));
    const before = plant.snapshot().train;

    expect(() => plant.setStart({ edgeId: 'e-does-not-exist', offsetMm: 0, direction: 1 })).toThrow();

    const after = plant.snapshot().train;
    expect(after.edgeId).toBe(before.edgeId);
    expect(after.offsetMm).toBe(before.offsetMm);
  });
});
