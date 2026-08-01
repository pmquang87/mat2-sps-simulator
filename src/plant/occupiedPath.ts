/**
 * OccupiedPath (ARCHITECTURE.md §5.3, §6.3): the track the consist stands on, kept as plant
 * state across steps and published by `Plant.snapshot` (`docs/REVIEW_SCENE.md` D12, D16).
 *
 * A vehicle stands on the rail it stands on. Only motion may move it to another edge, so the
 * track a consist occupies is a RECORD of where the train has been, not a query answered afresh
 * from the switch positions of the moment. Deriving it live (D12) put a switch thrown behind or
 * under the consist in charge of where the coaches are: throwing it lifted them onto the other
 * branch between two rendered frames (D16).
 *
 * Model
 * -----
 * `u` is an arc-length coordinate along the track under the consist, increasing in the direction
 * of travel; `spans` is that track as a chain of partial edge traversals, each valid on
 * `[uStart, uStart + lenMm]` with `offset(u) = offStart + dir · (u − uStart)`. `uTrain` is where
 * the loco sits inside it.
 *
 * Recorded track is never re-resolved. The chain grows only at its leading end, by the distance
 * the consist has just moved, resolving each node through `nextEdge` at the moment the leading
 * vehicle first reaches it. Behind the loco it keeps the whole published reach — that is track
 * the consist has driven over. AHEAD of the loco it stops at the consist's own footprint: past
 * the leading vehicle nothing is occupied, so nothing may be claimed. Extending the frozen part
 * further would put the coaches on a switch setting from minutes ago the next time the frame
 * flips and that stretch becomes the track they lead onto.
 *
 * Where no vehicle has ever been there is nothing to remember, and the current switch positions
 * ARE the answer (D12): those samples are walked live from the chain's ends on every snapshot.
 *
 * Direction of travel is the frame, not the geometry: on a stationary reversal (Sägefahrt) the
 * plant flips the train's travel sign, `+s` rotates 180°, and the record is mirrored so that the
 * same physical rail keeps the same physical samples. The coaches then LEAD — the footprint is
 * unchanged by the mirror, and it is the coach end that now resolves switches as it reaches them.
 */
import type { Polyline } from './geometry';
import type { SwitchPosition } from './switches';
import type { TrackGraph } from './trackGraph';
import type { Vec2 } from './types';

/**
 * The track a consist occupies, sampled at a fixed arc-length spacing (`docs/REVIEW_SCENE.md`
 * D12). `pts[i]` is the centre-line point at arc length `startMm + i * stepMm` measured from the
 * train, positive in the train's direction of travel. Purely geometric: it carries no vehicle
 * dimensions, so the renderer decides what sits where.
 */
export interface ConsistPath {
  readonly startMm: number;
  readonly stepMm: number;
  readonly pts: readonly Vec2[];
}

/** Where a vehicle sits on the graph: edge, offset from `edge.from`, travel sign on that edge. */
export interface TrainSeat {
  readonly edgeId: string;
  readonly offsetMm: number;
  readonly direction: 1 | -1;
}

/** One partial edge traversal of the recorded route, oriented along increasing `u`. */
interface RecordedSpan {
  edgeId: string;
  /** Travel sign on `edgeId` for increasing `u`. */
  dir: 1 | -1;
  uStart: number;
  /** Edge offset at `uStart`. */
  offStart: number;
  lenMm: number;
}

/**
 * How far the consist reaches from the loco centre towards its coaches, mm. The scene draws a
 * loco plus two coaches, 422 mm buffer to buffer, and samples the path 0,75 · half-length past
 * the rearmost vehicle centre (347 mm); the margin covers the renderer's inter-step smoothing.
 */
export const OCCUPIED_LEAD_MM = 450;
/**
 * How far it reaches from the loco centre the other way — the loco's own nose, mm.
 *
 * ZERO, and the value is load-bearing: the nose has not driven over the track ahead of it, so
 * freezing any of it violates the record's own rule (only track a vehicle has stood on may be
 * frozen) and re-creates the defect from the other side. Measured on the real plan (xW02E at
 * `n3`, approach at 280 mm/s): with 100 mm frozen, a switch completing its actuation 40–95 mm
 * ahead of the loco baked the PRE-throw branch into the record while the train crossed on the
 * POST-throw one — 9 jumps, worst 113,7 mm, the drawn loco 144,7 mm off its true position.
 * With 0 the nose samples are walked live and the same runs measure 0 jumps. The loco's front
 * render probe (+0,75 · half-length) reads live track, exactly as D12 did.
 */
const OCCUPIED_NOSE_MM = 0;
/**
 * How far the loco may stray from the track the record puts under it before the record is thrown
 * away, mm.
 *
 * The plant lets a switch complete its actuation with a COACH standing on it (its occupancy test
 * looks at the loco alone, §5.3). When that happens the loco later takes the branch the switch now
 * points at while its coaches stand on the other one: the consist is torn and no single polyline
 * describes it. The coaches win, because a vehicle cannot be moved by a switch — the loco is then
 * drawn on its coaches' branch, off its true position by the branch separation, until the two
 * routes rejoin. Measured on the Gruppe A run: one such tear, at most 50,7 mm apart, healed after
 * 38 s. This bound is three times that, so it fires only when the record has stopped describing
 * the loco's neighbourhood at all.
 */
const RECORD_STRAY_MM = 150;
/** Degenerate-data guard, matching `Train.resolveTransitions`. */
const MAX_TRANSITIONS = 1000;
/**
 * Arc-length slop when testing whether a node falls inside a recorded span, mm. Spans are cut and
 * re-derived every step by `clip`, so their ends carry accumulated rounding; 1 µm is far below any
 * real edge length and far above that drift.
 */
const SPAN_EPS_MM = 1e-3;

export class OccupiedPath {
  private readonly graph: TrackGraph;
  private readonly reachMm: number;
  private readonly stepMm: number;
  private spans: RecordedSpan[] = [];
  private uTrain = 0;
  /** Which side of the loco the coaches are coupled to, in path coordinates: `-1` while the loco
   *  faces the direction of travel, `+1` while it is pushing back. Flips exactly when the frame
   *  does, which is the only thing that moves a coupled vehicle from one side to the other. */
  private coachSide: 1 | -1 = -1;

  constructor(graph: TrackGraph, reachMm: number, stepMm: number) {
    this.graph = graph;
    this.reachMm = reachMm;
    this.stepMm = stepMm;
  }

  /**
   * Start the record at a fresh seat (init/reset/`setStart`). The whole footprint is laid down
   * from the live graph: at spawn there is no history, so the switches as they stand now are the
   * only statement anyone can make about the track under the consist (D12).
   */
  reset(seat: TrainSeat, positionOf: (switchId: string) => SwitchPosition): void {
    this.uTrain = 0;
    this.coachSide = -1;
    this.spans = [];
    for (const s of this.walkSpans(seat, -1, 0, this.behindMm(), positionOf)) this.append(s);
    // never empty: a zero-length span at the loco anchors a footprint clipped away by a buffer
    this.append({ edgeId: seat.edgeId, dir: seat.direction, uStart: 0, offStart: seat.offsetMm, lenMm: 0 });
    for (const s of this.walkSpans(seat, 1, 0, this.aheadMm(), positionOf)) this.append(s);
  }

  /**
   * Fold one physics step of train motion into the record. Call it directly after `Train.step`
   * and before the switch actuation timers of the same step: the train resolved its transitions
   * with the positions as of the step's start, and the record must resolve any new track through
   * exactly those.
   */
  advance(
    seat: TrainSeat,
    travelMm: number,
    frameFlipped: boolean,
    positionOf: (switchId: string) => SwitchPosition,
  ): void {
    if (frameFlipped) this.mirror();
    this.uTrain += travelMm;
    if (this.strayMm(seat) > RECORD_STRAY_MM) this.reanchor(seat);

    const target = this.uTrain + this.aheadMm();
    const uHi = this.uHi();
    if (target > uHi) {
      for (const s of this.walkSpans(this.hiState(), 1, uHi, target - uHi, positionOf)) {
        this.append(s);
      }
    }
    this.clip(this.uTrain - this.behindMm(), target);
  }

  /**
   * A switch has just completed on `nodeId`. If that node lies on recorded track the LOCO has not
   * crossed yet but is about to — at or ahead of it, inside the leading footprint — the record
   * beyond that node is re-walked through the new position. Returns whether it re-resolved.
   *
   * Why this does not contradict the D16 freeze rule
   * -----------------------------------------------
   * The record freezes track a vehicle STANDS on, and it never re-resolves behind the loco or at
   * any node the loco has already crossed — that is the whole of D16 and it is untouched here.
   * Ahead of the loco during a push-back the record holds something different in kind: the
   * coaches lead, so the record already reaches `OCCUPIED_LEAD_MM` past the loco, and that
   * stretch is track the LOCO is going to drive over within the second. The plant's own train
   * resolves each node live as it reaches it, so when a switch changes there, the loco WILL take
   * the new branch. Leaving the old one frozen does not keep the consist together — it guarantees
   * the consist is torn, with the coaches drawn into one platform road and the loco running into
   * the next (the Gruppe A Rangierfahrt: drawn into BH3 Gleis 2 / `e70`, plant into Gleis 3 /
   * `e74`). Re-resolving keeps the drawn consist on the route the plant actually drives.
   *
   * The caller gates this on the loco being in motion (`Plant.step`): a standing consist is not
   * about to drive anywhere, so a switch thrown under it changes nothing and the freeze holds —
   * which is exactly what `tests/plant/consistFreeze.test.ts` pins.
   */
  reresolveLead(nodeId: string, positionOf: (switchId: string) => SwitchPosition): boolean {
    const target = this.uTrain + this.aheadMm();
    if (target <= this.uTrain) return false;      // nothing recorded ahead: nothing to re-resolve
    const uNode = this.leadNodeU(nodeId, target);
    if (uNode === null) return false;
    this.truncateAt(uNode);
    for (const s of this.walkSpans(this.hiState(), 1, uNode, target - uNode, positionOf)) {
      this.append(s);
    }
    return true;
  }

  /** Arc position of `nodeId` in `[uTrain, target]`, or null. Nearest to the loco wins. */
  private leadNodeU(nodeId: string, target: number): number | null {
    let best: number | null = null;
    for (const s of this.spans) {
      if (s.uStart + s.lenMm < this.uTrain || s.uStart > target) continue;
      const edge = this.graph.edge(s.edgeId);
      const cands: number[] = [];
      if (edge.from === nodeId) cands.push(s.uStart - s.dir * s.offStart);
      if (edge.to === nodeId) {
        cands.push(s.uStart + s.dir * (this.graph.edgeLengthMm(s.edgeId) - s.offStart));
      }
      for (const u of cands) {
        if (u < s.uStart - SPAN_EPS_MM || u > s.uStart + s.lenMm + SPAN_EPS_MM) continue;
        if (u < this.uTrain || u > target) continue;
        if (best === null || u < best) best = u;
      }
    }
    return best;
  }

  /** Cuts the chain to `[uLo, u]`, so the last span ends exactly at `u`. */
  private truncateAt(u: number): void {
    const kept: RecordedSpan[] = [];
    for (const s of this.spans) {
      if (s.uStart >= u) break;
      const lenMm = Math.min(s.lenMm, u - s.uStart);
      kept.push(lenMm === s.lenMm ? s : { ...s, lenMm });
    }
    // `spans` must never be empty (uLo/uHi/hiState index its ends); a node at the very start of
    // the chain leaves a zero-length anchor there, exactly as `reset` does.
    if (kept.length === 0) {
      const first = this.spans[0] as RecordedSpan;
      kept.push({ ...first, lenMm: 0 });
    }
    this.spans = kept;
  }

  /**
   * How far the record may reach past the loco in `+u`, mm: only as far as the consist itself
   * does. Ahead of the leading vehicle nothing is occupied, so nothing may be remembered — that
   * is the track the leading vehicle is about to enter, and the switches decide it when it gets
   * there, not when the loco last drove past (D12).
   */
  private aheadMm(): number {
    return this.coachSide > 0 ? OCCUPIED_LEAD_MM : OCCUPIED_NOSE_MM;
  }

  /**
   * How far it may reach in `−u`, mm: the whole published reach. Everything behind the loco is
   * track the consist has driven over, and a switch thrown there changes nothing about where the
   * vehicles that drove over it now stand (D16).
   */
  private behindMm(): number {
    return this.reachMm;
  }

  /**
   * The published path for this frame: `reachMm` of track either side of the train at `stepMm`
   * spacing, read from the record where the consist has been and walked live where it has not.
   * A buffer end stops a live walk and the remaining samples clamp to it — a consist standing
   * against the stops, which is what the plant does too.
   */
  path(positionOf: (switchId: string) => SwitchPosition): ConsistPath {
    const step = this.stepMm;
    const n = Math.ceil(this.reachMm / step);
    const startMm = -n * step;
    const pts: Vec2[] = new Array<Vec2>(2 * n + 1);
    const uLo = this.uLo();
    const uHi = this.uHi();
    const uAt = (i: number): number => this.uTrain + startMm + i * step;

    // recorded stretch: exactly the samples the train has driven over
    let first = 0;
    while (first <= 2 * n && uAt(first) < uLo) first += 1;
    let last = 2 * n;
    while (last >= first && uAt(last) > uHi) last -= 1;
    let si = 0;
    for (let i = first; i <= last; i += 1) {
      const u = uAt(i);
      let span = this.spans[si] as RecordedSpan;
      while (si + 1 < this.spans.length && u > span.uStart + span.lenMm) {
        si += 1;
        span = this.spans[si] as RecordedSpan;
      }
      pts[i] = this.pointOn(span, u);
    }

    // unoccupied track: the current switch positions are the answer (D12)
    if (last < 2 * n) {
      const gaps: number[] = [];
      for (let i = last + 1; i <= 2 * n; i += 1) gaps.push(uAt(i) - uHi);
      const walked = this.walkPoints(this.hiState(), 1, gaps, positionOf);
      for (let k = 0; k < walked.length; k += 1) pts[last + 1 + k] = walked[k] as Vec2;
    }
    if (first > 0) {
      const gaps: number[] = [];
      for (let i = first - 1; i >= 0; i -= 1) gaps.push(uLo - uAt(i));
      const walked = this.walkPoints(this.loState(), -1, gaps, positionOf);
      for (let k = 0; k < walked.length; k += 1) pts[first - 1 - k] = walked[k] as Vec2;
    }

    return { startMm, stepMm: step, pts };
  }

  // ── record ───────────────────────────────────────────────────────────────

  private uLo(): number {
    return (this.spans[0] as RecordedSpan).uStart;
  }

  private uHi(): number {
    const last = this.spans[this.spans.length - 1] as RecordedSpan;
    return last.uStart + last.lenMm;
  }

  /** The seat the record ends on. Read off the LAST span: a span boundary belongs to the span
   *  the walk continues from, and a zero-length span is exactly such a boundary. */
  private hiState(): TrainSeat {
    const s = this.spans[this.spans.length - 1] as RecordedSpan;
    return {
      edgeId: s.edgeId,
      offsetMm: this.clampOffset(s.edgeId, s.offStart + s.dir * s.lenMm),
      direction: s.dir,
    };
  }

  /** The seat the record begins on (mirror image of `hiState`). */
  private loState(): TrainSeat {
    const s = this.spans[0] as RecordedSpan;
    return { edgeId: s.edgeId, offsetMm: this.clampOffset(s.edgeId, s.offStart), direction: s.dir };
  }

  /** Appends a span, folding it into the previous one when it merely continues it. */
  private append(span: RecordedSpan): void {
    const prev = this.spans[this.spans.length - 1];
    if (
      prev !== undefined &&
      prev.edgeId === span.edgeId &&
      prev.dir === span.dir &&
      Math.abs(prev.uStart + prev.lenMm - span.uStart) < 1e-9 &&
      Math.abs(prev.offStart + prev.dir * prev.lenMm - span.offStart) < 1e-9
    ) {
      prev.lenMm += span.lenMm;
      return;
    }
    this.spans.push(span);
  }

  /** How far the loco has strayed from the track the record puts under it, mm. */
  private strayMm(seat: TrainSeat): number {
    const rec = this.pointAtU(this.uTrain);
    const loco = this.polyline(seat.edgeId).pointAtMm(seat.offsetMm);
    return Math.hypot(rec.x - loco.x, rec.y - loco.y) * this.graph.meta.mmPerUnit;
  }

  /**
   * Last resort when the recorded track and the loco's own route have parted for good: the record
   * is cut at the loco and re-grown from there. It moves every vehicle onto the branch the loco
   * took, which is a teleport — that is why the bound above is set where it is, and why this is
   * a runaway guard rather than the normal correction. Recorded track behind the loco is kept.
   */
  private reanchor(seat: TrainSeat): void {
    const kept: RecordedSpan[] = [];
    for (const s of this.spans) {
      if (s.uStart >= this.uTrain) break;
      const lenMm = Math.min(s.lenMm, this.uTrain - s.uStart);
      kept.push({ ...s, lenMm });
    }
    kept.push({
      edgeId: seat.edgeId,
      dir: seat.direction,
      uStart: this.uTrain,
      offStart: seat.offsetMm,
      lenMm: 0,
    });
    this.spans = kept;
  }

  /** `+s` has rotated 180°: the same rail keeps the same samples, and the coaches change side. */
  private mirror(): void {
    this.coachSide = (this.coachSide === 1 ? -1 : 1) as 1 | -1;
    for (const s of this.spans) {
      const uEnd = s.uStart + s.lenMm;
      const offEnd = s.offStart + s.dir * s.lenMm;
      s.uStart = -uEnd;
      s.offStart = offEnd;
      s.dir = (s.dir === 1 ? -1 : 1) as 1 | -1;
    }
    this.spans.reverse();
    this.uTrain = -this.uTrain;
  }

  /**
   * Cuts the chain back to `[lo, hi]` exactly. Exactness is the point, not memory: track kept
   * past the footprint would become frozen track AHEAD of the consist the next time the frame
   * flips, and the coaches would then be told to stand on a switch setting from minutes ago.
   */
  private clip(lo: number, hi: number): void {
    const kept: RecordedSpan[] = [];
    for (const s of this.spans) {
      const a = Math.max(s.uStart, lo);
      const b = Math.min(s.uStart + s.lenMm, hi);
      if (b <= a) continue;
      kept.push(
        a === s.uStart && b === s.uStart + s.lenMm
          ? s
          : {
              edgeId: s.edgeId,
              dir: s.dir,
              uStart: a,
              offStart: s.offStart + s.dir * (a - s.uStart),
              lenMm: b - a,
            },
      );
    }
    // Load-bearing guard, not defensiveness: `spans` must never be empty (uLo/uHi/hiState
    // index its ends), and the zero-length anchor from `reset` is dropped by `b <= a` above.
    // A window that excludes every span keeps the old chain; `advance` re-anchors next step.
    if (kept.length > 0) this.spans = kept;
  }

  // ── graph walks ──────────────────────────────────────────────────────────

  /**
   * `distMm` of track from `from`, walking `senseU` × the seat's travel sign, as spans oriented
   * along increasing `u` and starting at `uFrom`. Stops short at a buffer.
   */
  private walkSpans(
    from: TrainSeat,
    senseU: 1 | -1,
    uFrom: number,
    distMm: number,
    positionOf: (switchId: string) => SwitchPosition,
  ): RecordedSpan[] {
    const out: RecordedSpan[] = [];
    let edgeId = from.edgeId;
    let off = from.offsetMm;
    let trav: 1 | -1 = (from.direction * senseU) as 1 | -1;
    let u = uFrom;
    let remaining = distMm;

    for (let guard = 0; guard < MAX_TRANSITIONS; guard += 1) {
      const len = this.graph.edgeLengthMm(edgeId);
      const take = Math.min(trav > 0 ? len - off : off, remaining);
      if (take > 0) {
        const offEnd = off + trav * take;
        const uEnd = u + senseU * take;
        const dir = (trav * senseU) as 1 | -1;
        out.push(
          senseU > 0
            ? { edgeId, dir, uStart: u, offStart: off, lenMm: take }
            : { edgeId, dir, uStart: uEnd, offStart: offEnd, lenMm: take },
        );
        off = offEnd;
        u = uEnd;
        remaining -= take;
      }
      if (remaining <= 0) break;
      const edge = this.graph.edge(edgeId);
      const exitNodeId = trav > 0 ? edge.to : edge.from;
      const res = this.graph.nextEdge(edgeId, exitNodeId, positionOf);
      if (res.kind === 'buffer') break;
      edgeId = res.edgeId;
      if (this.graph.edge(edgeId).from === exitNodeId) {
        off = 0;
        trav = 1;
      } else {
        off = this.graph.edgeLengthMm(edgeId);
        trav = -1;
      }
    }
    if (senseU < 0) out.reverse();
    return out;
  }

  /**
   * Centre-line points at ascending `distances` from `from`, walking `senseU` × the seat's travel
   * sign. Node transitions resolve exactly as `Train.resolveTransitions` does, so a live-walked
   * sample can never occupy a route the train could not; a buffer end repeats its own point.
   */
  private walkPoints(
    from: TrainSeat,
    senseU: 1 | -1,
    distances: readonly number[],
    positionOf: (switchId: string) => SwitchPosition,
  ): Vec2[] {
    const out: Vec2[] = [];
    let edgeId = from.edgeId;
    let off = from.offsetMm;
    let trav: 1 | -1 = (from.direction * senseU) as 1 | -1;
    let walked = 0;
    let stuck: Vec2 | null = null;

    for (const d of distances) {
      if (stuck) {
        out.push(stuck);
        continue;
      }
      off += trav * (d - walked);
      walked = d;
      let atBuffer = false;
      for (let guard = 0; guard < MAX_TRANSITIONS; guard += 1) {
        const len = this.graph.edgeLengthMm(edgeId);
        const edge = this.graph.edge(edgeId);
        let exitNodeId: string;
        let overshootMm: number;
        if (trav > 0 && off > len) {
          exitNodeId = edge.to;
          overshootMm = off - len;
        } else if (trav < 0 && off < 0) {
          exitNodeId = edge.from;
          overshootMm = -off;
        } else {
          break;
        }
        const res = this.graph.nextEdge(edgeId, exitNodeId, positionOf);
        if (res.kind === 'buffer') {
          off = trav > 0 ? len : 0;
          atBuffer = true;
          break;
        }
        edgeId = res.edgeId;
        if (this.graph.edge(edgeId).from === exitNodeId) {
          off = overshootMm;
          trav = 1;
        } else {
          off = this.graph.edgeLengthMm(edgeId) - overshootMm;
          trav = -1;
        }
      }
      const pt = this.polyline(edgeId).pointAtMm(off);
      out.push(pt);
      if (atBuffer) stuck = pt;
    }
    return out;
  }

  /** Recorded centre-line point at `u`, clamped to the chain's ends. */
  private pointAtU(u: number): Vec2 {
    let span = this.spans[0] as RecordedSpan;
    for (const s of this.spans) {
      span = s;
      if (u <= s.uStart + s.lenMm) break;
    }
    return this.pointOn(span, u);
  }

  private pointOn(span: RecordedSpan, u: number): Vec2 {
    const off = span.offStart + span.dir * (u - span.uStart);
    return this.polyline(span.edgeId).pointAtMm(this.clampOffset(span.edgeId, off));
  }

  private clampOffset(edgeId: string, offsetMm: number): number {
    return Math.min(this.graph.edgeLengthMm(edgeId), Math.max(0, offsetMm));
  }

  private polyline(edgeId: string): Polyline {
    return this.graph.polyline(edgeId);
  }
}
