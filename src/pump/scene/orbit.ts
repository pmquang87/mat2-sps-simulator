/**
 * Damped orbit camera for the pump scene.
 *
 * Self-contained rather than `OrbitControls` (which `scene/cameras.ts` uses) for one
 * reason: the pump scene picks. `OrbitControls` installs its own pointer listeners and
 * swallows the events the pedestal needs, and disabling it per-press would fight the very
 * damping it exists for. This rig owns no listeners at all — the host decides, per
 * `pointerdown`, whether the gesture belongs to a control or to the camera.
 *
 * No clock: `update()` damps by a fixed fraction per rendered frame, exactly like
 * `OrbitControls`' own damping, which is frame-based too.
 */
import { PerspectiveCamera, Vector3 } from 'three';

export interface PumpOrbitLimits {
  readonly minPolarRad: number;
  readonly maxPolarRad: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export const PUMP_ORBIT_LIMITS: PumpOrbitLimits = {
  // Never below the floor and never exactly overhead (a pole flip loses the azimuth).
  minPolarRad: 0.18,
  maxPolarRad: 1.46,
  minDistance: 1.1,
  maxDistance: 9,
};

/**
 * Radius of the sphere the whole plant fits into, metres (tanks + console + headers). The
 * default distance is derived from it and the viewport aspect, because the pane the shell
 * gives the canvas can be much taller than it is wide — a fixed distance framed the console
 * and cropped both tanks.
 */
export const PUMP_PLANT_RADIUS = 2.1;

const DAMPING = 0.14;
const ROTATE_SPEED = 3.2;
const ZOOM_SPEED = 0.0012;

export class PumpOrbit {
  readonly camera: PerspectiveCamera;
  readonly target = new Vector3(0, 0.55, 0);

  private azimuth = 0;
  private polar = 1.05;
  private distance = 3.4;
  private goalAzimuth = 0;
  private goalPolar = 1.05;
  private goalDistance = 3.4;
  private userZoomed = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
    this.apply();
  }

  /** Drag deltas in NDC (right/up positive). Dragging up lifts the camera over the plant. */
  rotate(dxNdc: number, dyNdc: number): void {
    this.goalAzimuth -= dxNdc * ROTATE_SPEED;
    this.goalPolar = clamp(
      this.goalPolar - dyNdc * ROTATE_SPEED,
      PUMP_ORBIT_LIMITS.minPolarRad,
      PUMP_ORBIT_LIMITS.maxPolarRad,
    );
  }

  /** Wheel delta in pixels (positive = away = zoom out). */
  zoom(deltaY: number): void {
    const factor = 1 + deltaY * ZOOM_SPEED;
    this.userZoomed = true;
    this.goalDistance = clamp(
      this.goalDistance * factor,
      PUMP_ORBIT_LIMITS.minDistance,
      PUMP_ORBIT_LIMITS.maxDistance,
    );
  }

  /**
   * Distance at which the whole plant fits the viewport. Called on every resize until the
   * student zooms — after that the framing is theirs and a resize must not undo it.
   */
  fit(aspect: number, fovDeg: number): void {
    if (this.userZoomed) return;
    const vHalf = ((fovDeg * Math.PI) / 180) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, aspect));
    const half = Math.min(vHalf, hHalf);
    const needed = PUMP_PLANT_RADIUS / Math.max(0.05, Math.sin(half));
    this.goalDistance = clamp(
      needed,
      PUMP_ORBIT_LIMITS.minDistance,
      PUMP_ORBIT_LIMITS.maxDistance,
    );
    this.distance = this.goalDistance;
    this.apply();
  }

  /** One damping step towards the goal pose; call once per rendered frame. */
  update(): void {
    this.azimuth += (this.goalAzimuth - this.azimuth) * DAMPING;
    this.polar += (this.goalPolar - this.polar) * DAMPING;
    this.distance += (this.goalDistance - this.distance) * DAMPING;
    this.apply();
  }

  /** Jumps to the goal pose without damping (initial layout, resize). */
  settle(): void {
    this.azimuth = this.goalAzimuth;
    this.polar = this.goalPolar;
    this.distance = this.goalDistance;
    this.apply();
  }

  get pose(): { azimuthRad: number; polarRad: number; distance: number } {
    return { azimuthRad: this.azimuth, polarRad: this.polar, distance: this.distance };
  }

  private apply(): void {
    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * sinPolar * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}
