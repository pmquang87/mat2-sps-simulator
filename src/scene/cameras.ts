/**
 * The four camera rigs (ARCHITECTURE.md §5.4, `video_design.md` §4 "Kamerasystem"):
 *
 * - `orbit`     — default free view with OrbitControls over the whole plate
 * - `bird`      — top-down orthographic Vogelperspektive (misrouted switches are obvious)
 * - `cab`       — Lokführer view, attached to the loco front, looking along the heading
 * - `trackside` — one of four fixed tripods, auto-selecting the one closest to the train
 *
 * The rigs are passive: they are updated from the train pose the SceneManager derives from
 * the snapshot, they never read a clock.
 */
import {
  BoxGeometry,
  Camera,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TrackplanFile } from '../plant';
import { type SceneMaterials, type SceneQuality } from './materials';
import { BOARD_MARGIN_PT, sceneryFootprints, type SceneryFootprint } from './landscape';
import { MM, type PlanFrame } from './trackMesh';

export type CameraMode = 'orbit' | 'bird' | 'cab' | 'trackside';

export const CAMERA_MODES: readonly CameraMode[] = ['orbit', 'bird', 'cab', 'trackside'];

/** Lens height of a trackside tripod above the baseboard, mm of the modelled plant. */
export const TRIPOD_HEIGHT_MM = 120;

/**
 * Clearance a tripod keeps from every scenery bounding circle, mm. Generous on purpose: the
 * lens must not merely be outside the hull, the hull must also stay out of the lower part of
 * a 30° frame, and it must stay far behind the 10 mm near plane.
 */
export const TRIPOD_CLEARANCE_MM = 90;

/** Step used when sliding a blocked tripod along its board edge, plan units. */
const TRIPOD_SLIDE_PT = 40;
/** How far the search may slide, in steps. */
const TRIPOD_SLIDE_STEPS = 8;

/**
 * The four fixed trackside tripods: mid-edge on the bare board margin, just outside the
 * track bounding box (so they never straddle a rail) and inside the plate rim.
 *
 * A mid-edge point can land on top of a piece of scenery — the BH1 station building sits
 * exactly on the middle of the front edge — and then the tripod renders the inside of that
 * scenery over the lower part of the Trackside view. Each blocked tripod is therefore slid
 * along its own edge (alternating outwards from the middle, so the result is deterministic
 * and stays symmetric-ish) until every footprint is at least `TRIPOD_CLEARANCE_MM` away.
 */
export function tracksideTripodPositions(
  frame: PlanFrame,
  footprints: readonly SceneryFootprint[],
): Vector3[] {
  const margin = frame.units(30);
  const y = TRIPOD_HEIGHT_MM * MM;
  const tx = frame.widthM / 2 + margin * 0.55;
  const tz = frame.depthM / 2 + margin * 0.55;
  const halfW = frame.widthM / 2 + frame.units(BOARD_MARGIN_PT) - 0.03;
  const halfD = frame.depthM / 2 + frame.units(BOARD_MARGIN_PT) - 0.03;
  const bases: { base: Vector3; along: Vector3; limit: number }[] = [
    { base: new Vector3(0, y, -tz), along: new Vector3(1, 0, 0), limit: halfW },
    { base: new Vector3(tx, y, 0), along: new Vector3(0, 0, 1), limit: halfD },
    { base: new Vector3(0, y, tz), along: new Vector3(1, 0, 0), limit: halfW },
    { base: new Vector3(-tx, y, 0), along: new Vector3(0, 0, 1), limit: halfD },
  ];
  const step = frame.units(TRIPOD_SLIDE_PT);
  const need = TRIPOD_CLEARANCE_MM * MM;

  return bases.map(({ base, along, limit }) => {
    let best = base;
    let bestClearance = footprintClearance(base, footprints);
    if (bestClearance >= need) return best;
    for (let k = 1; k <= TRIPOD_SLIDE_STEPS; k += 1) {
      for (const sign of [1, -1]) {
        const cand = base.clone().addScaledVector(along, sign * k * step);
        // stay on the plate: only the coordinate we slide along can leave the board
        if (Math.abs(cand.x * along.x + cand.z * along.z) > limit) continue;
        const clearance = footprintClearance(cand, footprints);
        if (clearance > bestClearance) {
          best = cand;
          bestClearance = clearance;
        }
        if (bestClearance >= need) return best;
      }
    }
    return best;
  });
}

/** Smallest gap between a point and any scenery bounding circle (negative = inside). */
export function footprintClearance(
  at: Vector3,
  footprints: readonly SceneryFootprint[],
): number {
  let min = Number.POSITIVE_INFINITY;
  for (const f of footprints) {
    const d = Math.hypot(at.x - f.x, at.z - f.z) - f.radius;
    if (d < min) min = d;
  }
  return min;
}

export interface CameraRigs {
  /** camera currently used for rendering */
  active(): Camera;
  getMode(): CameraMode;
  setMode(m: CameraMode): void;
  resize(width: number, height: number): void;
  /** feeds the loco pose into the cab and trackside rigs */
  followTrain(cabPosition: Vector3, cabForward: Vector3, trainCentre: Vector3): void;
  /** per-frame work (OrbitControls damping) */
  update(): void;
  /** small tripod props for the trackside cameras (the active one hides itself) */
  readonly markers: Group;
  dispose(): void;
}

export interface CameraRigArgs {
  readonly domElement: HTMLElement;
  readonly frame: PlanFrame;
  /** read-only: the trackside tripods are placed clear of the scenery it declares */
  readonly trackplan: TrackplanFile;
  readonly mats: SceneMaterials;
  readonly quality?: SceneQuality;
}

class CameraRigsImpl implements CameraRigs {
  readonly markers: Group;

  private mode: CameraMode = 'orbit';
  private readonly orbit: PerspectiveCamera;
  private readonly bird: OrthographicCamera;
  private readonly cab: PerspectiveCamera;
  private readonly trackside: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly tripods: Vector3[];
  private readonly tripodMarkers: Group[] = [];
  private activeTripod = 0;
  private aspect = 1;
  private readonly halfW: number;
  private readonly halfD: number;

  constructor(args: CameraRigArgs) {
    const { frame, mats, domElement, trackplan } = args;
    const margin = frame.units(30);
    this.halfW = frame.widthM / 2 + margin;
    this.halfD = frame.depthM / 2 + margin;

    const fit = Math.max(this.halfW, this.halfD) * 1.55;
    this.orbit = new PerspectiveCamera(45, 1, 0.01, 80);
    this.orbit.position.set(0, fit * 0.72, fit * 0.86);
    this.orbit.lookAt(0, 0, 0);

    this.bird = new OrthographicCamera(-this.halfW, this.halfW, this.halfD, -this.halfD, 0.01, 20);
    this.bird.position.set(0, 4, 0);
    this.bird.up.set(0, 0, -1); // plan "north" (small y) points up on screen
    this.bird.lookAt(0, 0, 0);

    this.cab = new PerspectiveCamera(68, 1, 0.004, 60);
    this.trackside = new PerspectiveCamera(30, 1, 0.01, 60);

    const camHeight = TRIPOD_HEIGHT_MM * MM;
    this.tripods = tracksideTripodPositions(frame, sceneryFootprints(trackplan, frame));

    this.markers = new Group();
    this.markers.name = 'tripods';
    for (const p of this.tripods) {
      const marker = buildTripod(mats, p, camHeight);
      this.tripodMarkers.push(marker);
      this.markers.add(marker);
    }

    this.controls = new OrbitControls(this.orbit, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = Math.max(this.halfW, this.halfD) * 6;
    this.controls.maxPolarAngle = 1.47;
    this.controls.update();
  }

  active(): Camera {
    switch (this.mode) {
      case 'bird':
        return this.bird;
      case 'cab':
        return this.cab;
      case 'trackside':
        return this.trackside;
      case 'orbit':
      default:
        return this.orbit;
    }
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    this.updateMarkerVisibility();
  }

  resize(width: number, height: number): void {
    this.aspect = height > 0 ? width / height : 1;
    for (const cam of [this.orbit, this.cab, this.trackside]) {
      cam.aspect = this.aspect;
      cam.updateProjectionMatrix();
    }
    // fit the whole plate into the orthographic frustum whatever the aspect is
    if (this.aspect >= this.halfW / this.halfD) {
      this.bird.top = this.halfD;
      this.bird.bottom = -this.halfD;
      this.bird.right = this.halfD * this.aspect;
      this.bird.left = -this.halfD * this.aspect;
    } else {
      this.bird.right = this.halfW;
      this.bird.left = -this.halfW;
      this.bird.top = this.halfW / this.aspect;
      this.bird.bottom = -this.halfW / this.aspect;
    }
    this.bird.updateProjectionMatrix();
  }

  followTrain(cabPosition: Vector3, cabForward: Vector3, trainCentre: Vector3): void {
    this.cab.position.copy(cabPosition);
    this.cab.lookAt(
      cabPosition.x + cabForward.x,
      cabPosition.y + cabForward.y * 0.2 - 0.01,
      cabPosition.z + cabForward.z,
    );

    // pick the closest tripod, with hysteresis so it does not flicker between two
    let best = this.activeTripod;
    const current = this.tripods[this.activeTripod];
    let bestDist = current ? current.distanceToSquared(trainCentre) : Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.tripods.length; i += 1) {
      const p = this.tripods[i];
      if (!p) continue;
      const d = p.distanceToSquared(trainCentre);
      if (d < bestDist * 0.8) {
        bestDist = d;
        best = i;
      }
    }
    if (best !== this.activeTripod) {
      this.activeTripod = best;
      this.updateMarkerVisibility();
    }
    const tripod = this.tripods[this.activeTripod];
    if (tripod) {
      this.trackside.position.copy(tripod);
      this.trackside.lookAt(trainCentre.x, trainCentre.y + 20 * MM, trainCentre.z);
    }
  }

  update(): void {
    if (this.mode === 'orbit') this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }

  private updateMarkerVisibility(): void {
    for (let i = 0; i < this.tripodMarkers.length; i += 1) {
      const marker = this.tripodMarkers[i];
      if (!marker) continue;
      marker.visible = !(this.mode === 'trackside' && i === this.activeTripod);
    }
  }
}

function buildTripod(mats: SceneMaterials, position: Vector3, camHeight: number): Group {
  const g = new Group();
  g.name = 'tripod';
  g.position.set(position.x, 0, position.z);
  const legGeom = new CylinderGeometry(0.003, 0.003, camHeight, 5);
  for (let i = 0; i < 3; i += 1) {
    const leg = new Mesh(legGeom, mats.switchMotor);
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.018, camHeight / 2, Math.sin(a) * 0.018);
    leg.rotation.z = Math.cos(a) * 0.16;
    leg.rotation.x = -Math.sin(a) * 0.16;
    g.add(leg);
  }
  const body = new Mesh(new BoxGeometry(0.05, 0.03, 0.03), mats.switchMotor);
  body.position.y = camHeight + 0.016;
  g.add(body);
  const lens = new Mesh(new ConeGeometry(0.012, 0.02, 10), mats.windowGlass);
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.03, camHeight + 0.016, 0);
  g.add(lens);
  return g;
}

export function createCameraRigs(args: CameraRigArgs): CameraRigs {
  return new CameraRigsImpl(args);
}
