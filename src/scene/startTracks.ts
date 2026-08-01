/**
 * Choosable start tracks (ARCHITECTURE.md §7.1 `start`, §10.1 start-track chooser).
 *
 * The student may seat the loco on any station track of the real trackplan, not only on the
 * two §7.1 exercise starts. A "track" here is exactly what `deriveStations()` already derives
 * from the reed naming convention (`xR01BH1G2` → station `BH1`, track `G2`) — this module is
 * that derivation one step further: lane → `TrainStartSpec`. It lives beside `landscape.ts`
 * because it shares that derivation and, like it, is pure over the trackplan (no three.js, no
 * DOM), so `main.ts` can resolve a seat without owning a second naming rule.
 *
 * EXERCISE starts are NOT this: opening a Gruppe A/B network still seats the pinned §7.1
 * position through `startForExercise` (plant/exerciseStart.ts). Those offsets are what the
 * graded check runner and the oracle suites replay; a mid-track seat there would make the
 * live plant disagree with the check run, which is exactly the D13 defect. This module only
 * answers "where does the CHOOSER put the loco", and `startTrackOf` maps an exercise seat
 * back onto its lane so the chooser can display it.
 */
import { Polyline } from '../plant';
import type { TrackplanFile, TrainStartSpec, Vec2 } from '../plant';
import { deriveStations } from './landscape';

/** One choosable seat: the station track, its edge, and which way the loco faces there. */
export interface StartTrackOption {
  readonly stationKey: string;   // "BH1"
  readonly laneKey: string;      // "G2"
  readonly edgeId: string;
  readonly lengthMm: number;
  /** Travel sign on `edgeId` that realizes an **IU** command — see `iuTravelSign`. */
  readonly direction: 1 | -1;
  /** The quantity `direction` is derived from: twice the signed plan area this edge sweeps
   *  about the plan centre, walked `from`→`to` (plan units²). Its SIGN is the edge's
   *  rotational sense; its magnitude says how well conditioned that sign is. */
  readonly sweepPt2: number;
  /** True when the IU direction runs into a buffer stop (dead-end track): Speed1IU from this
   *  seat parks the loco against the stops, exactly as the real plant's global drive sense
   *  would. The chooser marks such lanes instead of hiding them or faking their facing. */
  readonly stub: boolean;
}

/** A station track, as the UI names it. */
export interface StartTrackRef {
  readonly stationKey: string;
  readonly laneKey: string;
}

/** Centre of the trackplan's bounding box, in plan units — the pivot every rotational sense
 *  below is measured about. The box, not the mean of the polyline points: re-smoothing a
 *  centreline (D9) changes how densely edges are sampled, and the pivot must not move with
 *  it. */
function planCentre(tp: TrackplanFile): Vec2 {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const edge of tp.edges) {
    for (const p of edge.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Twice the signed area the edge sweeps about `centre`, walked `from`→`to` (shoelace). */
function sweepAboutCentre(tp: TrackplanFile, edgeId: string, centre: Vec2): number {
  const edge = tp.edges.find((e) => e.id === edgeId);
  if (edge === undefined) return 0;
  let sum = 0;
  for (let i = 1; i < edge.pts.length; i += 1) {
    const p = edge.pts[i - 1];
    const q = edge.pts[i];
    if (p === undefined || q === undefined) continue;
    sum += (p.x - centre.x) * (q.y - centre.y) - (q.x - centre.x) * (p.y - centre.y);
  }
  return sum;
}

/**
 * The travel sign on `edgeId` that realizes an **IU** command, derived from the trackplan's
 * own geometry.
 *
 * `Train` adopts `start.direction` as the sign its IU sense drives with, so this IS the
 * facing question: from any seat, Speed1IU has to send the loco around the layout the same
 * way round as it does from the delivered §7.1 start.
 *
 * The rule: an edge walked `from`→`to` sweeps a signed area about the plan centre; its sign
 * is that walk's plan-wise rotational sense. Take the §7.1 `start` edge — whose IU sign is
 * data — as the reference sense, and give an edge `+1` when its own walk turns the same way
 * and `-1` when it turns the other way. No per-lane table, and nothing about the switch
 * positions: it is one geometric property of the shipped centrelines.
 *
 * `direction: +1` is NOT a safe default even though §7.1 declares `from`→`to` to be "the
 * direction the documented IU route walks": on the shipped plan, `e77` (Bahnhof 1 Gleis 2) is
 * stored the other way round, and a `+1` seat there drives the student's first Speed1IU
 * backwards out of the station. `tests/plant/startTracks.test.ts` measures every seat against
 * the Gruppe A seat by actually driving the plant, so the derivation stands on a measurement
 * rather than on the convention.
 */
export function iuTravelSign(tp: TrackplanFile, edgeId: string): 1 | -1 {
  const centre = planCentre(tp);
  const reference = sweepAboutCentre(tp, tp.start.edgeId, centre) * tp.start.direction;
  const own = sweepAboutCentre(tp, edgeId, centre);
  return own * reference >= 0 ? 1 : -1;
}

/** Numeric suffix of a BH/G key, for display order ("G10" after "G2", unlike a string sort). */
function keyNumber(key: string): number {
  const match = /(\d+)$/.exec(key);
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1]);
}

/**
 * Every station track the chooser may offer, ordered as the student reads the plan: stations
 * BH1→BH3, tracks G1→Gn (numeric — `deriveStations` yields reed-declaration order, which put
 * G2 before G1 and made "pick a Bahnhof" seat its G2). A lane whose derived edge is missing
 * from `edges` is dropped instead of yielding an unseatable option.
 */
export function startTrackOptions(tp: TrackplanFile): StartTrackOption[] {
  const centre = planCentre(tp);
  const reference = sweepAboutCentre(tp, tp.start.edgeId, centre) * tp.start.direction;
  const nodeKind = new Map(tp.nodes.map((n) => [n.id, n.kind]));
  const out: StartTrackOption[] = [];
  for (const station of deriveStations(tp)) {
    for (const lane of station.lanes) {
      const edge = tp.edges.find((e) => e.id === lane.edgeId);
      if (edge === undefined) continue;
      const sweepPt2 = sweepAboutCentre(tp, lane.edgeId, centre);
      const direction: 1 | -1 = sweepPt2 * reference >= 0 ? 1 : -1;
      out.push({
        stationKey: station.key,
        laneKey: lane.laneKey,
        edgeId: lane.edgeId,
        lengthMm: new Polyline(edge.pts, tp.meta.mmPerUnit).lengthMm,
        direction,
        sweepPt2,
        stub: nodeKind.get(direction === 1 ? edge.to : edge.from) === 'buffer',
      });
    }
  }
  out.sort((a, b) =>
    keyNumber(a.stationKey) - keyNumber(b.stationKey) || keyNumber(a.laneKey) - keyNumber(b.laneKey));
  return out;
}

/**
 * Where the loco stands when the student picks this track: the MIDDLE of the lane's edge,
 * facing the IU direction. `null` for a track that is not on the board — the caller then
 * leaves the loco where it is (`Plant.setStart` would reject the spec anyway).
 */
export function startSpecForTrack(
  tp: TrackplanFile,
  ref: StartTrackRef,
): TrainStartSpec | null {
  const option = startTrackOptions(tp).find(
    (o) => o.stationKey === ref.stationKey && o.laneKey === ref.laneKey,
  );
  if (option === undefined) return null;
  return {
    edgeId: option.edgeId,
    offsetMm: option.lengthMm / 2,
    direction: option.direction,
  };
}

/**
 * Which station track a seat sits on — the chooser renders this, so it also follows a re-seat
 * it did not cause (a §7.1 exercise start: `e23` → BH1 G1, `e43` → BH1 G4). `null` when the
 * seat is on plain line, which no station board names.
 */
export function startTrackOf(tp: TrackplanFile, spec: TrainStartSpec): StartTrackRef | null {
  const option = startTrackOptions(tp).find((o) => o.edgeId === spec.edgeId);
  if (option === undefined) return null;
  return { stationKey: option.stationKey, laneKey: option.laneKey };
}
