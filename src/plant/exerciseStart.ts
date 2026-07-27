/**
 * Per-exercise start position (ARCHITECTURE.md §7.1 deviation note `exerciseStarts`).
 *
 * §7.1 gives the trackplan one `start`, but the two Aufgabenstellungen do not share it:
 * Gruppe A begins on Bahnhof 1 Gleis 1 (the default `start`), Gruppe B on Gleis 4 — B-NW3
 * triggers on "xR03BH1G4" and B-NW10 returns the loco "auf das ursprüngliche Gleis 4".
 *
 * This is the single rule for that resolution. It exists because the three places that
 * seat a train (the live stack, the check runner, the oracle scenario runner) each carried
 * their own copy, and the live one was never updated — D13: whichever exercise the student
 * had open, the visible loco stood on Gleis 1.
 */
import type { TrackplanFile, TrainStartSpec } from './types';

/**
 * Where the loco stands for `exerciseId`: its `exerciseStarts` entry when the trackplan has
 * one, else the §7.1 `start`. An unknown id resolves to the default, so a new exercise
 * without an entry behaves exactly like Gruppe A instead of failing to load.
 */
export function startForExercise(plan: TrackplanFile, exerciseId: string): TrainStartSpec {
  const spec = plan.exerciseStarts?.[exerciseId];
  if (spec === undefined) return { ...plan.start };
  return { edgeId: spec.edgeId, offsetMm: spec.offsetMm, direction: spec.direction };
}

/**
 * The plan with `start` substituted for `exerciseId` — for consumers that build a Plant from
 * a trackplan rather than re-seating a live one. Returns the plan unchanged (no clone) when
 * the exercise uses the default, so the shipped JSON is never copied needlessly.
 */
export function trackplanForExercise(plan: TrackplanFile, exerciseId: string): TrackplanFile {
  if (plan.exerciseStarts?.[exerciseId] === undefined) return plan;
  const clone = JSON.parse(JSON.stringify(plan)) as TrackplanFile;
  clone.start = startForExercise(plan, exerciseId);
  return clone;
}
