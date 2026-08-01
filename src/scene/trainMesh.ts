/**
 * The train: bordeaux diesel loco (BR 119/219-like) plus two red/white coaches
 * (ARCHITECTURE.md §3 `scene/trainMesh.ts`, look per `video_design.md` §2).
 *
 * Pose source: `PlantSnapshot.train.worldPos` / `headingRad` — the scene never integrates
 * motion itself. `alphaMs` (real ms since the snapshot's sim step) only shifts the sampling
 * offset along the recorded path, so rendering stays smooth between the fixed 10 ms plant
 * steps without ever feeding back into the plant (§5.4).
 *
 * The coaches are placed at fixed arc-length offsets on `PlantSnapshot.train.consistPath` — the
 * track the plant records the consist as standing on (D12/D16). The path is directed and the
 * consist only slides along it, so reversing (Sägefahrt) makes the coaches lead correctly instead
 * of folding onto the loco.
 *
 * The LOCO's POSITION is not read off that path. It is anchored to `worldPos`, the position the
 * plant states the loco has (`docs/REVIEW_SCENE.md` D16 Folgearbeit). Path and position describe
 * the same rail only while the consist is whole: when a program throws a switch out from under its
 * own coaches, the coaches keep the rail they stand on — a switch may not move a standing vehicle
 * — while the loco drives on over the new branch, and no single polyline describes both. Reading
 * the loco off the coaches' path then drew it beside the position the plant published (measured on
 * the Gruppe A run: 50,7 mm for 36,5 s). Anchored, the drawn separation becomes what it physically
 * is: a consist the program has split across two branches. Orientation stays on the path for every
 * vehicle including the loco — see `anchorLoco` for the measurement that decided that.
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
  /** the track the consist occupies, from the plant graph (`docs/REVIEW_SCENE.md` D12) */
  readonly path: ConsistWorldPath;
}

interface Vehicle {
  readonly group: Group;
  /** arc-length offset of the vehicle centre behind the loco centre, in mm */
  readonly offsetMm: number;
  readonly halfLengthMm: number;
}

/**
 * The track the consist stands on, in world space — `PlantSnapshot.train.consistPath` mapped
 * through the `PlanFrame`. `pts[i]` is the centre line at arc length `startMm + i * stepMm`
 * from the loco centre, positive in the train's **direction of travel**.
 */
export interface ConsistWorldPath {
  readonly startMm: number;
  readonly stepMm: number;
  readonly pts: readonly Vector3[];
}

/** How far along the path the frame-flip probe samples, mm. */
const FLIP_PROBE_MM = 20;
export class TrainVisual {
  readonly object: Group;

  private readonly vehicles: Vehicle[] = [];
  private readonly locoGroup: Group;

  /**
   * Which side of the path the coaches lie on: `-1` while the loco faces the direction of
   * travel (the normal case), `+1` while it is pushing back.
   *
   * The path is anchored to the direction of TRAVEL, but a consist is coupled to the loco's
   * FACING, and `Train.step` flips the travel sign on a stationary command reversal — so during
   * a push-back `+s` rotates 180° while the coaches physically stay where they are. Tracking the
   * side here, rather than deriving it from the travel sign, is what keeps them from being
   * teleported through the loco (`docs/REVIEW_SCENE.md` D12).
   */
  private coachSign: 1 | -1 = -1;
  private prevAhead: Vector3 | null = null;
  private prevBehind: Vector3 | null = null;
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
    this.trackFrameFlip(u);

    // The train advances along +s between snapshots (speed is a magnitude, +s is travel).
    const alphaMm = Math.max(0, u.alphaMs) * (u.speedMmS / 1000);
    // sign pointing from the coaches toward the loco's nose, in path coordinates
    const nose = -this.coachSign;

    for (const v of this.vehicles) {
      const centreS = alphaMm + this.coachSign * v.offsetMm;
      const front = this.pointAt(u.path, centreS + nose * v.halfLengthMm * 0.75);
      const rear = this.pointAt(u.path, centreS - nose * v.halfLengthMm * 0.75);
      const centre = front.clone().add(rear).multiplyScalar(0.5);
      const dir = front.clone().sub(rear);
      if (dir.lengthSq() < 1e-12) dir.copy(planHeadingToWorld(u.headingRad));
      dir.setY(0).normalize();
      if (v.group === this.locoGroup) this.anchorLoco(u, alphaMm, centre);
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

  /**
   * Moves the loco's centre from the path sample to the pose the PLANT publishes
   * (`docs/REVIEW_SCENE.md` D16 Folgearbeit). Board level in, board level out — the rail-top lift
   * is added by the caller for every vehicle alike.
   *
   * POSITION only, deliberately. The orientation keeps coming from the same ±0,75 · half-length
   * chord on the path that every vehicle uses, because the published `headingRad` is the exact
   * polyline tangent at the loco's offset and that tangent is DISCONTINUOUS where two edges meet:
   * measured over the Gruppe A run, taking the yaw from it snaps the loco by up to 22,03° in one
   * 10 ms step (54 steps above 2°, always at an edge entry, offset < 2 mm) and whips the cab
   * camera anchor by 19,3 mm per step, against 1,36° / 2,90 mm for the chord. The chord is also
   * what keeps the loco turning like the coaches do. What the anchor is for is the POSITION: that
   * is what the lag measures and what puts the drawn loco beside its own rail during a tear.
   *
   * The smoothing advance is a straight line along the direction of travel rather than a walk
   * along the path: over one step of travel (≤ 2,8 mm at the top speed of 280 mm/s) the chord
   * error against the tightest curve on the plan (R = 90,9 mm) is L²/8R ≈ 0,011 mm, whereas a
   * path walk would follow the COACHES' branch during a tear and give back part of the lag the
   * anchor removes.
   *
   * The advance is the SAME `alphaMm` the coaches slide by, deliberately unclamped: clamping the
   * loco alone at one step of travel would compress the drawn consist whenever `alphaMs` exceeds
   * one step (measured against the 50 ms interpolation contract in `tests/scene/train.test.ts`:
   * loco 2,0 mm against coaches 10,0 mm). `RafDriver` feeds `SimClock.pendingMs`, which is the
   * accumulator leftover and therefore always under one step, so the anchor's guarantee holds
   * where it is stated — at the snapshot instant, `alphaMs` = 0, where the lag is exactly 0 —
   * and between steps the whole consist slides together, as it always did.
   */
  private anchorLoco(u: TrainUpdate, alphaMm: number, centre: Vector3): void {
    centre
      .copy(u.position)
      .setY(0)
      .addScaledVector(planHeadingToWorld(u.headingRad), alphaMm * MM);
  }

  /** Forgets the consist orientation (called on plant reset / teleport). */
  reset(): void {
    this.initialised = false;
    this.coachSign = -1;
    this.prevAhead = null;
    this.prevBehind = null;
  }

  dispose(): void {
    this.reset();
  }

  // ──────────────────────── consist orientation ────────────────────────

  /**
   * Detects a 180° flip of the published path frame and swaps the side the coaches sit on.
   *
   * The test is geometric rather than a read of the plant's travel sign, so it needs no
   * knowledge of plant internals and is falsifiable on its own: after a flip the new `+s`
   * samples the track the old `-s` used to sample. §5.3 permits a reversal only through
   * speed 0, so this is only ever consulted while the train is stationary — at speed the
   * probe cannot fire, which is what keeps an ordinary node transition (where the travel
   * sign also changes, but the frame does NOT rotate) from being mistaken for a flip.
   */
  private trackFrameFlip(u: TrainUpdate): void {
    const ahead = this.pointAt(u.path, FLIP_PROBE_MM);
    const behind = this.pointAt(u.path, -FLIP_PROBE_MM);
    const prevAhead = this.prevAhead;
    const prevBehind = this.prevBehind;
    if (this.initialised && prevAhead && prevBehind) {
      const kept = ahead.distanceTo(prevAhead);
      const swapped = ahead.distanceTo(prevBehind);
      // Margins are wide apart, so no speed gate is needed (and none would work: the plant
      // flips the travel sign and accelerates within the SAME step, so the first snapshot
      // after a flip already reports motion). Travelling normally the train advances a few mm
      // per frame, so `kept` is small and `swapped` is ~2 × FLIP_PROBE_MM; on a flip the two
      // swap roles. Requiring a clear factor keeps ordinary jitter from toggling the side.
      if (swapped * 2 < kept) this.coachSign = (this.coachSign === 1 ? -1 : 1) as 1 | -1;
    }
    this.prevAhead = ahead;
    this.prevBehind = behind;
    this.initialised = true;
  }

  /**
   * World point at arc length `s` along the published path, linearly interpolated between
   * samples and **clamped** to its ends.
   *
   * Clamping is safe here in a way it never was for the old history buffer: the plant publishes
   * `CONSIST_REACH_MM` in both directions, which exceeds the furthest sample any vehicle takes,
   * so the clamp is unreachable in normal operation. Where it does bite — a consist standing
   * against a buffer stop — the plant has already clamped its own walk to the same point, so the
   * two agree.
   */
  private pointAt(path: ConsistWorldPath, s: number): Vector3 {
    const n = path.pts.length;
    if (n === 0) return new Vector3();
    if (n === 1) return (path.pts[0] as Vector3).clone();
    const raw = (s - path.startMm) / path.stepMm;
    const idx = Math.min(n - 2, Math.max(0, Math.floor(raw)));
    const t = Math.min(1, Math.max(0, raw - idx));
    const a = path.pts[idx] as Vector3;
    const b = path.pts[idx + 1] as Vector3;
    return a.clone().lerp(b, t);
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
