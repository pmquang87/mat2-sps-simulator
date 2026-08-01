/**
 * Seat persistence across reloads (ARCHITECTURE.md §10.1 reload guard, REVIEW_SCENE.md
 * D19, `src/ui/seatStorage.ts`).
 *
 * Half of the D19 start-seat trap: the editor buffer survives a reload, but the seat was
 * runtime-only, so F5 silently put the loco back on the §7.1 default start while the
 * student kept working on the Gruppe B solution. The storage contract pinned here:
 *
 * 1. **Reading is total** — a malformed entry costs the restore, never the boot (same
 *    contract as `parsePumpParams`).
 * 2. **Restore resolves through the pinned rules** — `startForExercise` for an exercise
 *    seat (byte for byte the §7.1 offset the graded check runs replay, so a restored seat
 *    cannot violate D13), `startSpecForTrack` for a direct track choice.
 * 3. **An unknown exercise id is rejected, not defaulted** — `startForExercise` alone
 *    resolves an unknown id to the default start, and restoring that would let the chooser
 *    claim a provenance the plant does not have. The control below shows this guard does
 *    real work: the same id passed to `startForExercise` DOES yield the default seat.
 */
import { describe, expect, it } from 'vitest';
import trackplanJson from '../../src/data/trackplan.json';
import { startForExercise } from '../../src/plant';
import type { TrackplanFile, TrainStartSpec } from '../../src/plant';
import { startSpecForTrack } from '../../src/scene';
import {
  SEAT_STORAGE_KEY,
  parseStoredSeat,
  restoredSeatStart,
  serializeStoredSeat,
} from '../../src/ui/seatStorage';

const plan = trackplanJson as unknown as TrackplanFile;
const DEFAULT_ID = 'gruppeA';

describe('seat storage — the contract (parse/serialize)', () => {
  it('round-trips both kinds of seat', () => {
    const exercise = { kind: 'exercise', exerciseId: 'gruppeB' } as const;
    const track = { kind: 'track', stationKey: 'BH3', laneKey: 'G2' } as const;
    expect(parseStoredSeat(serializeStoredSeat(exercise))).toEqual(exercise);
    expect(parseStoredSeat(serializeStoredSeat(track))).toEqual(track);
  });

  it('keeps the versioned key name — renaming it would strand every stored seat', () => {
    expect(SEAT_STORAGE_KEY).toBe('mat2sps.seat.v1');
  });

  it('reads totally: anything that is not exactly a stored seat yields null', () => {
    expect(parseStoredSeat(null)).toBeNull();                       // no entry yet
    expect(parseStoredSeat('')).toBeNull();
    expect(parseStoredSeat('not json')).toBeNull();
    expect(parseStoredSeat('42')).toBeNull();
    expect(parseStoredSeat('"gruppeB"')).toBeNull();
    expect(parseStoredSeat('{}')).toBeNull();
    expect(parseStoredSeat('{"kind":"exercise"}')).toBeNull();      // id missing
    expect(parseStoredSeat('{"kind":"exercise","exerciseId":7}')).toBeNull();
    expect(parseStoredSeat('{"kind":"track","stationKey":"BH1"}')).toBeNull();
    expect(parseStoredSeat('{"kind":"track","stationKey":1,"laneKey":"G1"}')).toBeNull();
    expect(parseStoredSeat('{"kind":"weird","exerciseId":"gruppeB"}')).toBeNull();
  });
});

describe('seat storage — restore resolves through the pinned rules', () => {
  it('an exercise seat restores the §7.1 pinned offset (what the check runs replay)', () => {
    const restored = restoredSeatStart(plan, { kind: 'exercise', exerciseId: 'gruppeB' }, DEFAULT_ID);
    expect(restored).not.toBeNull();
    expect(restored?.exerciseId).toBe('gruppeB');
    expect(restored?.start).toEqual(startForExercise(plan, 'gruppeB'));
    // and that IS the exerciseStarts entry, not some re-derivation
    const pinned = plan.exerciseStarts?.gruppeB as TrainStartSpec;
    expect(restored?.start.edgeId).toBe(pinned.edgeId);
    expect(restored?.start.offsetMm).toBe(pinned.offsetMm);
  });

  it('the default exercise (no exerciseStarts entry) restores the §7.1 default start', () => {
    const restored = restoredSeatStart(plan, { kind: 'exercise', exerciseId: DEFAULT_ID }, DEFAULT_ID);
    expect(restored?.exerciseId).toBe(DEFAULT_ID);
    expect(restored?.start).toEqual({ ...plan.start });
  });

  it('REJECTS an unknown exercise id — with the control that proves the guard works', () => {
    // control: the underlying resolution would happily seat the default for this id …
    expect(startForExercise(plan, 'gruppeX')).toEqual({ ...plan.start });
    // … so without the rejection the chooser would claim "gruppeX" provenance on Gleis 1.
    expect(restoredSeatStart(plan, { kind: 'exercise', exerciseId: 'gruppeX' }, DEFAULT_ID))
      .toBeNull();
  });

  it('a track seat restores the same deterministic spec the chooser produced', () => {
    const ref = { stationKey: 'BH3', laneKey: 'G2' };
    const restored = restoredSeatStart(plan, { kind: 'track', ...ref }, DEFAULT_ID);
    expect(restored?.exerciseId).toBeNull();
    expect(restored?.start).toEqual(startSpecForTrack(plan, ref));
  });

  it('rejects a track that is not on this board', () => {
    expect(restoredSeatStart(plan, { kind: 'track', stationKey: 'BH9', laneKey: 'G1' }, DEFAULT_ID))
      .toBeNull();
  });
});
