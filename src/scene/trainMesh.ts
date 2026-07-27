/**
 * The train: bordeaux diesel loco (BR 119/219-like) plus two red/white coaches
 * (ARCHITECTURE.md §3 `scene/trainMesh.ts`, look per `video_design.md` §2).
 *
 * Pose source: `PlantSnapshot.train.worldPos` / `headingRad` — the scene never integrates
 * motion itself. `alphaMs` (real ms since the snapshot's sim step) only shifts the sampling
 * offset along the recorded path, so rendering stays smooth between the fixed 10 ms plant
 * steps without ever feeding back into the plant (§5.4).
 *
 * The coaches follow a **path buffer**: the loco's snapshot positions are appended to a
 * directed polyline and each vehicle is placed at a fixed arc-length offset behind the
 * loco. Because the buffer is directed and the head only slides along it, reversing
 * (Sägefahrt) makes the coaches lead correctly instead of folding onto the loco.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { DIM, type SceneMaterials, type SceneQuality } from './materials';
import { MM, planHeadingToWorld, yawOfTangent } from './trackMesh';

export interface TrainUpdate {
  /** world position of the loco centre (from `snapshot.train.worldPos`) */
  readonly position: Vector3;
  /** plan-space heading in radians (from `snapshot.train.headingRad`) */
  readonly headingRad: number;
  readonly speedMmS: number;
  /** real ms elapsed since the snapshot's sim step (scene-side smoothing only) */
  readonly alphaMs: number;
  /** true while the loco is inside a `tunnel: true` edge */
  readonly hidden: boolean;
  readonly derailed: boolean;
}

interface Vehicle {
  readonly group: Group;
  /** arc-length offset of the vehicle centre behind the loco centre, in mm */
  readonly offsetMm: number;
  readonly halfLengthMm: number;
}

/** Maximum snapshot-to-snapshot jump treated as motion; above it the path buffer resets. */
const TELEPORT_MM = 200;

/**
 * How much path history is kept behind the last vehicle, in mm.
 *
 * Sized for reversals, not for the consist (`docs/REVIEW_SCENE.md` D10). While the train
 * reverses, the coaches move to *decreasing* arc length — onto track the loco recorded
 * **before** the reversal began. No trimming policy can recover history it has already
 * dropped, and at 250 mm the Gruppe A Rangierfahrt (≈ 1.4 m of reverse) sampled past the end
 * of the buffer and drew the consist 1.09 m off its true position, 590 mm beyond the plate.
 *
 * 2600 mm covers every reversal the exercises perform with margin. Beyond it `pointAt` clamps,
 * so the consist bunches at the oldest retained point instead of flying off the board — wrong,
 * but bounded and on the plate. Cost: ≈ 3200 points at 80 mm/s, ≈ 128 kB.
 */
const TAIL_KEEP_MM = 2600;

/**
 * Length of the *synthetic* straight tail laid down when the buffer is first anchored, in mm —
 * just enough to carry the consist before any real history exists. Deliberately **not** tied to
 * `TAIL_KEEP_MM`: a 3 m straight guess behind the loco would leave the baseboard, and a reversal
 * would then render the train along it.
 */
const INIT_TAIL_MM = 60;

/**
 * How far `pointAt` may extrapolate past either end of the buffer, in mm. The leading vehicle
 * legitimately needs ~42 mm of lookahead past the recorded head; everything beyond that is a gap
 * in the history, and letting it grow is what drew the consist off the plate (D10).
 */
const EXTRAPOLATE_LIMIT_MM = 60;

export class TrainVisual {
  readonly object: Group;

  private readonly vehicles: Vehicle[] = [];
  private readonly locoGroup: Group;

  /** directed path buffer: world points and their arc length in mm */
  private pathPts: Vector3[] = [];
  private pathS: number[] = [];
  private headS = 0;
  private travelSign: 1 | -1 = 1;
  private lastPos = new Vector3();
  private initialised = false;

  private readonly cabPosition = new Vector3();
  private readonly cabForward = new Vector3(1, 0, 0);

  constructor(mats: SceneMaterials, quality: SceneQuality = 'high') {
    this.object = new Group();
    this.object.name = 'train';

    this.locoGroup = buildLoco(mats, quality);
    this.object.add(this.locoGroup);
    this.vehicles.push({
      group: this.locoGroup,
      offsetMm: 0,
      halfLengthMm: DIM.locoLength / 2,
    });

    const firstCoachOffset = DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2;
    for (let i = 0; i < 2; i += 1) {
      const coach = buildCoach(mats, quality);
      coach.name = `coach${i + 1}`;
      this.object.add(coach);
      this.vehicles.push({
        group: coach,
        offsetMm: firstCoachOffset + i * (DIM.coachLength + DIM.coupling),
        halfLengthMm: DIM.coachLength / 2,
      });
    }
  }

  /** Total consist length in mm (loco + 2 coaches incl. couplings). */
  get lengthMm(): number {
    const last = this.vehicles[this.vehicles.length - 1];
    return (last ? last.offsetMm + last.halfLengthMm : 0) + DIM.locoLength / 2;
  }

  /** World position of the loco cab window (cab camera anchor). */
  getCabPosition(): Vector3 {
    return this.cabPosition;
  }

  /** World forward direction of the loco (cab camera look direction). */
  getCabForward(): Vector3 {
    return this.cabForward;
  }

  update(u: TrainUpdate): void {
    this.object.visible = !u.hidden;
    this.feedPath(u.position, u.headingRad);

    const alphaMm = Math.max(0, u.alphaMs) * (u.speedMmS / 1000);
    const sampleS = this.headS + this.travelSign * alphaMm;

    for (const v of this.vehicles) {
      const front = this.pointAt(sampleS - v.offsetMm + v.halfLengthMm * 0.75);
      const rear = this.pointAt(sampleS - v.offsetMm - v.halfLengthMm * 0.75);
      const centre = front.clone().add(rear).multiplyScalar(0.5);
      const dir = front.clone().sub(rear);
      if (dir.lengthSq() < 1e-12) dir.copy(planHeadingToWorld(u.headingRad));
      dir.setY(0).normalize();
      // the path buffer runs at board level; vehicle origins sit on the rail heads
      centre.y += DIM.railTop * MM;
      v.group.position.copy(centre);
      v.group.rotation.order = 'YXZ';
      v.group.rotation.y = yawOfTangent(dir);
      v.group.rotation.z = u.derailed ? 0.22 : 0;
      if (v.group === this.locoGroup) {
        this.cabPosition
          .copy(centre)
          .addScaledVector(dir, (DIM.locoLength / 2 - 6) * MM);
        this.cabPosition.y = centre.y + 26 * MM;
        this.cabForward.copy(dir);
      }
    }
  }

  /** Clears the path buffer (called on plant reset / teleport). */
  reset(): void {
    this.initialised = false;
    this.pathPts = [];
    this.pathS = [];
    this.headS = 0;
    this.travelSign = 1;
  }

  dispose(): void {
    this.reset();
  }

  // ───────────────────────────── path buffer ─────────────────────────────

  private feedPath(pos: Vector3, headingRad: number): void {
    if (!this.initialised) {
      this.initPath(pos, headingRad);
      return;
    }
    const moved = pos.distanceTo(this.lastPos);
    if (moved > TELEPORT_MM * MM) {
      this.initPath(pos, headingRad);
      return;
    }
    if (moved < 0.15 * MM) return;

    const step = moved / MM; // mm
    const tangent = this.tangentAt(this.headS);
    const motion = pos.clone().sub(this.lastPos).setY(0).normalize();
    if (motion.dot(tangent) >= 0) {
      this.travelSign = 1;
      const newS = this.headS + step;
      const maxS = this.pathS[this.pathS.length - 1] ?? 0;
      const onRecordedPath =
        newS <= maxS && this.pointAt(newS).distanceTo(pos) < 8 * MM;
      if (onRecordedPath) {
        this.headS = newS;
      } else {
        this.truncateAfter(this.headS);
        this.append(pos, newS);
        this.headS = newS;
      }
    } else {
      this.travelSign = -1;
      const newS = this.headS - step;
      // reversing past the start of the buffer: the plant's worldPos is an exact track point,
      // so recording it keeps the head exact and `pathS` monotonic. (The coaches, which sit at
      // still lower arc length, rely on the retained tail — see TAIL_KEEP_MM.)
      if (newS < (this.pathS[0] ?? 0)) this.prepend(pos, newS);
      this.headS = newS;
    }
    this.lastPos.copy(pos);
    this.trimTail();
  }

  private initPath(pos: Vector3, headingRad: number): void {
    this.initPathAt(pos, planHeadingToWorld(headingRad));
  }

  /** Anchors a fresh two-point buffer: a straight synthetic tail behind `pos` along `forward`. */
  private initPathAt(pos: Vector3, forward: Vector3): void {
    const back = forward.clone().setY(0);
    if (back.lengthSq() < 1e-18) back.set(1, 0, 0);
    back.normalize().multiplyScalar(-1);
    const tailMm = this.lengthMm + INIT_TAIL_MM;
    this.pathPts = [pos.clone().addScaledVector(back, tailMm * MM), pos.clone()];
    this.pathS = [0, tailMm];
    this.headS = tailMm;
    this.travelSign = 1;
    this.lastPos.copy(pos);
    this.initialised = true;
  }

  /**
   * Appends a point, re-anchoring instead of writing a non-monotonic arc length.
   *
   * The old code could reach `truncateAfter(headS)` with `headS` *below* `pathS[0]` (after a
   * reversal ran off the end of the buffer), empty the buffer down to one point and then append
   * below that point's arc length. The resulting non-monotonic `pathS` is what rendered the
   * consist as a stretched streak instead of three vehicles (D10).
   */
  private append(pos: Vector3, s: number): void {
    const last = this.pathS[this.pathS.length - 1];
    if (last !== undefined && s <= last) {
      this.initPathAt(pos, this.tangentAt(this.headS));
      return;
    }
    this.pathPts.push(pos.clone());
    this.pathS.push(s);
  }

  /** Prepends a point ahead of the buffer start, keeping `pathS` strictly increasing. */
  private prepend(pos: Vector3, s: number): void {
    const first = this.pathS[0];
    if (first !== undefined && s >= first) return;
    this.pathPts.unshift(pos.clone());
    this.pathS.unshift(s);
  }

  /**
   * Path buffer as read-only arrays — a test hook for the `pathS` monotonicity invariant
   * (`tests/scene/consist.test.ts`), which is the property whose violation drew the streak.
   */
  pathSnapshot(): { readonly s: readonly number[]; readonly points: readonly Vector3[] } {
    return { s: this.pathS, points: this.pathPts };
  }

  private truncateAfter(s: number): void {
    while (this.pathS.length > 1) {
      const last = this.pathS[this.pathS.length - 1];
      if (last === undefined || last <= s) break;
      this.pathS.pop();
      this.pathPts.pop();
    }
  }

  private trimTail(): void {
    const keepFrom = this.headS - this.lengthMm - TAIL_KEEP_MM;
    while (this.pathS.length > 2) {
      const second = this.pathS[1];
      if (second === undefined || second > keepFrom) break;
      this.pathS.shift();
      this.pathPts.shift();
    }
  }

  /**
   * World point at arc length `s` (mm) along the buffer, **clamped** to `[pathS[0], pathS[n-1]]`.
   *
   * A *little* extrapolation is legitimate and necessary: each vehicle is placed from two samples
   * ±0.75 · halfLength around its centre, so the leading one reaches ~42 mm past the recorded
   * head, where no path exists yet. What broke D10 was that the extrapolation was **unbounded** —
   * once a reversal outran the retained history every vehicle sampled below `pathS[0]` and the
   * straight-line error grew with the reversal distance, reaching 1,09 m at cycle 1454. Capping it
   * at `EXTRAPOLATE_LIMIT_MM` keeps the normal case exact and turns the pathological case into a
   * bounded few-cm error instead of a streak off the baseboard.
   */
  private pointAt(s: number): Vector3 {
    const n = this.pathPts.length;
    if (n === 0) return new Vector3();
    const first = this.pathPts[0];
    const last = this.pathPts[n - 1];
    const firstS = this.pathS[0] ?? 0;
    const lastS = this.pathS[n - 1] ?? 0;
    if (!first || !last) return new Vector3();
    if (n === 1) return first.clone();
    if (s <= firstS) {
      const over = Math.min(firstS - s, EXTRAPOLATE_LIMIT_MM);
      return first.clone().addScaledVector(this.tangentAt(firstS), -over * MM);
    }
    if (s >= lastS) {
      const over = Math.min(s - lastS, EXTRAPOLATE_LIMIT_MM);
      return last.clone().addScaledVector(this.tangentAt(lastS), over * MM);
    }
    for (let i = 1; i < n; i += 1) {
      const sb = this.pathS[i];
      const sa = this.pathS[i - 1];
      const pb = this.pathPts[i];
      const pa = this.pathPts[i - 1];
      if (sb === undefined || sa === undefined || !pa || !pb) continue;
      if (s <= sb) {
        const span = sb - sa;
        const t = span > 1e-9 ? (s - sa) / span : 0;
        return pa.clone().lerp(pb, t);
      }
    }
    return last.clone();
  }

  /** Forward unit tangent of the buffer at arc length `s`. */
  private tangentAt(s: number): Vector3 {
    const n = this.pathPts.length;
    if (n < 2) return new Vector3(1, 0, 0);
    let idx = n - 1;
    for (let i = 1; i < n; i += 1) {
      const sb = this.pathS[i];
      if (sb !== undefined && s <= sb) {
        idx = i;
        break;
      }
    }
    const a = this.pathPts[idx - 1];
    const b = this.pathPts[idx];
    if (!a || !b) return new Vector3(1, 0, 0);
    const t = b.clone().sub(a).setY(0);
    if (t.lengthSq() < 1e-18) return new Vector3(1, 0, 0);
    return t.normalize();
  }
}

/** Builds the loco (local +x = forward, y = 0 at rail top). */
function buildLoco(mats: SceneMaterials, quality: SceneQuality): Group {
  const g = new Group();
  g.name = 'loco';
  const L = DIM.locoLength;
  const W = DIM.locoWidth;
  const cast = quality === 'high';

  addRunningGear(g, mats, L, W, cast);

  const frame = new Mesh(box(L, 3, W), mats.bogie);
  frame.position.y = 7.5 * MM;
  frame.castShadow = cast;
  g.add(frame);

  const body = new Mesh(box(L - 6, 18, W - 1.5), mats.locoBody);
  body.position.y = 18 * MM;
  body.castShadow = cast;
  g.add(body);

  const stripe = new Mesh(box(L - 5, 1.6, W - 0.6), mats.locoStripe);
  stripe.position.y = 13 * MM;
  g.add(stripe);

  const roof = new Mesh(box(L - 14, 3.5, W - 4), mats.locoRoof);
  roof.position.y = 28.7 * MM;
  roof.castShadow = cast;
  g.add(roof);

  // cab windows at both ends (the loco is symmetric like the BR 119)
  for (const sx of [1, -1]) {
    const win = new Mesh(box(6, 5.5, W - 3), mats.windowGlass);
    win.position.set(sx * (L / 2 - 6) * MM, 23 * MM, 0);
    g.add(win);
    const side = new Mesh(box(24, 4.5, W - 0.4), mats.windowGlass);
    side.position.set(sx * (L / 4) * MM, 22 * MM, 0);
    g.add(side);
  }

  // headlights: two at the front, two at the rear
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const lamp = new Mesh(new SphereGeometry(1.5 * MM, 8, 6), mats.headlight);
      lamp.position.set(sx * (L / 2 - 1) * MM, 12 * MM, sz * (W / 2 - 5) * MM);
      g.add(lamp);
    }
  }

  return g;
}

/** Builds one red/white coach (local +x = forward, y = 0 at rail top). */
function buildCoach(mats: SceneMaterials, quality: SceneQuality): Group {
  const g = new Group();
  const L = DIM.coachLength;
  const W = DIM.coachWidth;
  const cast = quality === 'high';

  addRunningGear(g, mats, L, W, cast);

  const frame = new Mesh(box(L, 3, W - 1), mats.bogie);
  frame.position.y = 7.5 * MM;
  g.add(frame);

  const body = new Mesh(box(L - 4, 22, W), mats.coachBody);
  body.position.y = 20 * MM;
  body.castShadow = cast;
  g.add(body);

  const band = new Mesh(box(L - 8, 7, W + 0.3), mats.coachBand);
  band.position.y = 24 * MM;
  g.add(band);

  const windows = new Mesh(box(L - 18, 4.2, W + 0.6), mats.windowGlass);
  windows.position.y = 24 * MM;
  g.add(windows);

  const roof = new Mesh(box(L - 6, 3.5, W - 3), mats.coachRoof);
  roof.position.y = 32.7 * MM;
  roof.castShadow = cast;
  g.add(roof);

  return g;
}

function addRunningGear(
  g: Group,
  mats: SceneMaterials,
  lengthMm: number,
  widthMm: number,
  cast: boolean,
): void {
  const wheelGeom = new CylinderGeometry(3.2 * MM, 3.2 * MM, 1.6 * MM, 12);
  for (const sx of [1, -1]) {
    const bogie = new Mesh(box(26, 4, widthMm - 6), mats.bogie);
    bogie.position.set(sx * (lengthMm / 2 - 24) * MM, 5.5 * MM, 0);
    bogie.castShadow = cast;
    g.add(bogie);
    for (const dx of [-8, 8]) {
      for (const sz of [1, -1]) {
        const wheel = new Mesh(wheelGeom, mats.bogie);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(
          (sx * (lengthMm / 2 - 24) + dx) * MM,
          3.2 * MM,
          sz * (DIM.gauge / 2) * MM,
        );
        g.add(wheel);
      }
    }
  }
}

function box(lengthMm: number, heightMm: number, widthMm: number): BoxGeometry {
  return new BoxGeometry(lengthMm * MM, heightMm * MM, widthMm * MM);
}

/** Factory kept symmetric with the other mesh modules. */
export function buildTrain(mats: SceneMaterials, quality: SceneQuality = 'high'): TrainVisual {
  return new TrainVisual(mats, quality);
}
