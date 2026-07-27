/**
 * Switch (ARCHITECTURE.md §5.3): G/R coil inputs from M100–111 (levels ferried in by the
 * SimCoordinator), 300 ms actuation, explicit coilToBranch mapping. Bistable, no
 * position feedback to the PLC.
 *
 * Binding behavior rules (§5.3):
 * - Rising edge on a coil starts a `switchActuationMs` (300 ms) actuation toward
 *   `branchEdgeIds[coilToBranch[coil]]`; completion changes `position` + emits
 *   `switchMoved`. A rising edge on the other coil during actuation restarts the
 *   actuation toward the other branch. Both coils high → `coilConflict` warning;
 *   actuation continues toward the most recent edge.
 * - Coil pulse measurement: high-time is accumulated during physics steps; the falling
 *   edge emits `switchPulse {durationMs}` ("≈300 ms, not permanent" checks). A coil held
 *   > 5 s emits a single `coilHeld` warning (teaches the `=`-with-SV rule).
 * - Actuation while the train occupies the switch node → `switchMovedUnderTrain`
 *   warning, once per actuation (strict-mode derail is handled by the Plant facade).
 * - `coilToBranch: null` (the unlabeled "(xW)", non-commandable): coil edges are still
 *   measured defensively, but no actuation ever starts — the switch lies fixed at
 *   `initialPosition` ("fest liegend").
 */
import type { SimEvent } from './plant';
import type { SwitchSpec } from './types';

export type SwitchPosition = 0 | 1;  // index into branchEdgeIds

export interface SwitchState {
  id: string;
  position: SwitchPosition;
  moving: boolean;
  movingToward?: SwitchPosition;
  remainingMs?: number;              // of the 300 ms actuation
  coilG: boolean; coilR: boolean;    // current commanded coil levels
}

/** Coil high-time threshold for the `coilHeld` warning (§5.3: "held > 5 s"). */
export const COIL_HELD_WARN_MS = 5000;

/**
 * Along-edge distance (mm) from the switch node within which the train counts as
 * occupying the node for the `switchMovedUnderTrain` check. Implementation assumption —
 * §5.3 names the rule but no envelope; 50 mm ≈ half a TT loco length.
 */
export const SWITCH_OCCUPANCY_MM = 50;

export class Switch {
  readonly spec: SwitchSpec;
  private readonly actuationMs: number;
  private position_: SwitchPosition;
  private moving_ = false;
  private movingToward_: SwitchPosition = 0;
  private remainingMs_ = 0;
  private coilG = false;
  private coilR = false;
  private highMsG = 0;
  private highMsR = 0;
  private heldWarnedG = false;
  private heldWarnedR = false;
  private underTrainWarned = false;

  constructor(spec: SwitchSpec, actuationMs: number) {
    this.spec = spec;
    this.actuationMs = actuationMs;
    this.position_ = spec.initialPosition;
  }

  get id(): string {
    return this.spec.id;
  }

  get position(): SwitchPosition {
    return this.position_;
  }

  get isMoving(): boolean {
    return this.moving_;
  }

  /** Commanded coil level change (SimCoordinator actuator phase, between steps). */
  setCoil(coil: 'G' | 'R', level: boolean, nowMs: number, emit: (e: SimEvent) => void): void {
    const prev = coil === 'G' ? this.coilG : this.coilR;
    if (level === prev) return; // no edge

    if (level) {
      // Rising edge.
      const otherHigh = coil === 'G' ? this.coilR : this.coilG;
      if (otherHigh) emit({ t: nowMs, type: 'coilConflict', switchId: this.spec.id });
      if (coil === 'G') {
        this.highMsG = 0;
        this.heldWarnedG = false;
      } else {
        this.highMsR = 0;
        this.heldWarnedR = false;
      }
      const map = this.spec.coilToBranch;
      if (map !== null) {
        this.moving_ = true;
        this.movingToward_ = map[coil];
        this.remainingMs_ = this.actuationMs;
        this.underTrainWarned = false;
      }
    } else {
      // Falling edge: report the measured pulse.
      const held = coil === 'G' ? this.highMsG : this.highMsR;
      emit({ t: nowMs, type: 'switchPulse', switchId: this.spec.id, coil, durationMs: held });
      if (coil === 'G') {
        this.highMsG = 0;
        this.heldWarnedG = false;
      } else {
        this.highMsR = 0;
        this.heldWarnedR = false;
      }
    }

    if (coil === 'G') this.coilG = level;
    else this.coilR = level;
  }

  /**
   * One physics step. `occupied` = train currently occupies this switch's node (only
   * consulted while the actuation runs). Returns whether `switchMovedUnderTrain` fired
   * this step so the Plant can apply the strict-mode derail.
   */
  step(
    dtMs: number,
    nowMs: number,
    occupied: boolean,
    emit: (e: SimEvent) => void,
  ): { movedUnderTrain: boolean } {
    if (this.coilG) {
      this.highMsG += dtMs;
      if (!this.heldWarnedG && this.highMsG > COIL_HELD_WARN_MS) {
        this.heldWarnedG = true;
        emit({ t: nowMs, type: 'coilHeld', switchId: this.spec.id, coil: 'G', heldMs: this.highMsG });
      }
    }
    if (this.coilR) {
      this.highMsR += dtMs;
      if (!this.heldWarnedR && this.highMsR > COIL_HELD_WARN_MS) {
        this.heldWarnedR = true;
        emit({ t: nowMs, type: 'coilHeld', switchId: this.spec.id, coil: 'R', heldMs: this.highMsR });
      }
    }

    let movedUnderTrain = false;
    if (this.moving_) {
      if (occupied && !this.underTrainWarned) {
        this.underTrainWarned = true;
        movedUnderTrain = true;
        emit({ t: nowMs, type: 'switchMovedUnderTrain', switchId: this.spec.id });
      }
      this.remainingMs_ -= dtMs;
      if (this.remainingMs_ <= 0) {
        this.moving_ = false;
        this.remainingMs_ = 0;
        this.position_ = this.movingToward_;
        emit({ t: nowMs, type: 'switchMoved', switchId: this.spec.id, position: this.position_ });
      }
    }
    return { movedUnderTrain };
  }

  snapshot(): SwitchState {
    return {
      id: this.spec.id,
      position: this.position_,
      moving: this.moving_,
      ...(this.moving_ ? { movingToward: this.movingToward_, remainingMs: this.remainingMs_ } : {}),
      coilG: this.coilG,
      coilR: this.coilR,
    };
  }
}
