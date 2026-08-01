/**
 * Reload persistence of the loco seat (§10.1 reload guard, REVIEW_SCENE.md D19).
 *
 * The editor buffer survives a reload (§7.4 bufferStore), but the seat used to be
 * runtime-only state in main.ts: F5 silently put the loco back on the §7.1 default start
 * while the student kept working on the other Aufgabenstellung's solution — half of the
 * D19 start-seat trap. This module is the storage contract for the seat: what a
 * successful re-seat writes, and how a stored entry resolves back into a start spec.
 *
 * Restore goes through the SAME pinned resolutions the live actions use —
 * `startForExercise` for an exercise seat (byte for byte the §7.1 offset the graded
 * check runs replay, so a restored seat cannot violate D13 by construction) and
 * `startSpecForTrack` for a direct track choice. Reading is total: a malformed entry
 * costs the restore, never the boot (the `parsePumpParams` contract). An exercise id the
 * trackplan does not pin is REJECTED rather than resolved: `startForExercise` would
 * silently seat the default while the chooser claimed the stored id as provenance — a
 * lying display, which D13 exists to rule out.
 */
import { startForExercise } from '../plant';
import type { TrackplanFile, TrainStartSpec } from '../plant';
import { startSpecForTrack } from '../scene';

export const SEAT_STORAGE_KEY = 'mat2sps.seat.v1';

/** The persisted seat: which action produced the last successful re-seat. */
export type StoredSeat =
  | { readonly kind: 'exercise'; readonly exerciseId: string }
  | { readonly kind: 'track'; readonly stationKey: string; readonly laneKey: string };

export function serializeStoredSeat(seat: StoredSeat): string {
  return JSON.stringify(seat);
}

/** Total reader: anything that is not exactly a stored-seat shape yields `null`. */
export function parseStoredSeat(raw: string | null): StoredSeat | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  if (record.kind === 'exercise' && typeof record.exerciseId === 'string') {
    return { kind: 'exercise', exerciseId: record.exerciseId };
  }
  if (record.kind === 'track'
      && typeof record.stationKey === 'string' && typeof record.laneKey === 'string') {
    return { kind: 'track', stationKey: record.stationKey, laneKey: record.laneKey };
  }
  return null;
}

/** A restorable seat: the start spec to re-apply and the provenance it carries. */
export interface RestoredSeat {
  readonly start: TrainStartSpec;
  /** Exercise the seat belongs to; `null` for a direct track choice. */
  readonly exerciseId: string | null;
}

/**
 * Resolve a stored seat against the trackplan; `null` when it is not restorable (unknown
 * exercise id, track not on this board) — the caller then keeps the default seat.
 * `defaultExerciseId` names the exercise whose seat IS the §7.1 default `start` and which
 * therefore carries no `exerciseStarts` entry (Gruppe A).
 */
export function restoredSeatStart(
  plan: TrackplanFile,
  seat: StoredSeat,
  defaultExerciseId: string,
): RestoredSeat | null {
  if (seat.kind === 'exercise') {
    const known = seat.exerciseId === defaultExerciseId
      || plan.exerciseStarts?.[seat.exerciseId] !== undefined;
    if (!known) return null;
    return { start: startForExercise(plan, seat.exerciseId), exerciseId: seat.exerciseId };
  }
  const start = startSpecForTrack(plan, seat);
  return start === null ? null : { start, exerciseId: null };
}
