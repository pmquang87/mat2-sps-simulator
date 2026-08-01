/**
 * Plant facade (ARCHITECTURE.md §5.3): step(dt), actuator/sensor API, snapshot(),
 * events. Behavior rules (switch actuation, coil pulse measurement, reed latch, bounce,
 * train motion, Notaus) are binding in §5.3; determinism rules in §6.3.
 *
 * Step-internal phase order (deterministic, §5.2 step 1 lists "train motion, switch
 * actuation timers, reed closure sampling"): the plant's time advances first, so events
 * of physics step k carry t = (k+1)·dt — matching the coordinator's post-step
 * `simTimeMs`. Then train motion, then switch timers, then reed sampling (reeds need
 * the post-motion magnet position). Actuator/sensor setters are called by the
 * coordinator BETWEEN steps and stamp events with the current (post-step) time, so
 * `drainEvents()` stays chronological.
 */
import { wordToTarget } from './fahrstrom';
import type { FahrstromState } from './fahrstrom';
import { OccupiedPath } from './occupiedPath';
import type { ConsistPath } from './occupiedPath';
import { Reed } from './reeds';
import type { ReedState } from './reeds';
import { mulberry32 } from './random';
import { Switch, SWITCH_OCCUPANCY_MM } from './switches';
import type { SwitchPosition, SwitchState } from './switches';
import { TrackGraph } from './trackGraph';
import { Train } from './train';
import type { TrainState } from './train';
import type { TrackplanFile, TrainStartSpec, Vec2 } from './types';

export interface PlantConfig {
  trackplan: TrackplanFile;
  seed?: number;                     // PRNG for bounce; default 1
  bounceEnabled?: boolean;           // default false; true for the Entprellen exercise/oracle A
  strictDerail?: boolean;            // default false: trailing a switch = warning, not derail
}

/**
 * How much track around the train the snapshot publishes for the renderer, mm
 * (`docs/REVIEW_SCENE.md` D12). Covers the longest consist the scene draws (422 mm) plus the
 * ±0.75 · half-length sampling and a margin.
 *
 * **The PUBLISHED span is symmetric on purpose.** The plant models the train as a point and so
 * has no notion of which way the loco faces; the coaches sit behind its FACING, which is
 * opposite to the direction of travel during a push-back. An asymmetric published span (the
 * first cut of this was 700 behind / 80 ahead) therefore truncates exactly when the train
 * reverses — both coaches clamp to the same end point and the consist collapses. Publishing the
 * same reach both ways costs ~350 polyline lookups per snapshot and removes the failure mode.
 *
 * The RECORD underneath is a different matter: `OccupiedPath` freezes only the consist's own
 * footprint (tracked side-aware, `OCCUPIED_LEAD_MM`/`OCCUPIED_NOSE_MM`) and answers the rest of
 * this span with a live walk — see occupiedPath.ts for why that asymmetry is safe: the record
 * mirrors on a frame flip instead of truncating.
 */
export const CONSIST_REACH_MM = 700;
/** Sampling spacing, mm. 4 mm keeps the chord error under 0,02 mm on the tightest curve (90,9 mm). */
export const CONSIST_STEP_MM = 4;

export interface PlantSnapshot {
  timeMs: number;
  train: TrainState & { worldPos: Vec2; headingRad: number; consistPath: ConsistPath };
  switches: SwitchState[];           // stable order = trackplan order
  reeds: ReedState[];
  fahrstrom: FahrstromState;
  notausActive: boolean;
  derailed: boolean;
}

/** SimEvent union (re-exported via plant/index.ts and app/) — the currency of the oracle
 *  and of pedagogy behavior checks. Times are simulated ms. */
export type SimEvent =
  | { t: number; type: 'speedCommand'; level: 0 | 1 | 2 | 3; direction: 'IU' | 'GU' | 'STOP'; word: number }
  | { t: number; type: 'speedConflict'; m120: number }
  | { t: number; type: 'switchPulse'; switchId: string; coil: 'G' | 'R'; durationMs: number }
  | { t: number; type: 'switchMoved'; switchId: string; position: SwitchPosition }
  | { t: number; type: 'coilConflict'; switchId: string }
  | { t: number; type: 'coilHeld'; switchId: string; coil: 'G' | 'R'; heldMs: number }
  | { t: number; type: 'switchTrailed'; switchId: string }
  | { t: number; type: 'switchMovedUnderTrain'; switchId: string }
  | { t: number; type: 'reedClosed'; reedId: string }               // rising edge of closed
  | { t: number; type: 'trainStopped' }
  | { t: number; type: 'trainStarted'; direction: 'IU' | 'GU' }
  | { t: number; type: 'segmentEntered'; edgeId: string }
  | { t: number; type: 'bufferHit'; nodeId: string }
  | { t: number; type: 'derail'; switchId?: string }
  | { t: number; type: 'notaus'; active: boolean };

export class Plant {
  private readonly graph: TrackGraph;
  private readonly seed: number;
  private readonly bounceEnabled: boolean;
  private readonly strictDerail: boolean;

  private train!: Train;
  private occupied!: OccupiedPath;
  private switchUnits!: Switch[];
  private switchUnitById!: Map<string, Switch>;
  private reedUnits!: Reed[];
  private reedUnitById!: Map<string, Reed>;
  private fahrstrom!: FahrstromState;
  private notaus!: boolean;
  private timeMs!: number;
  private events!: SimEvent[];

  constructor(cfg: PlantConfig) {
    this.graph = new TrackGraph(cfg.trackplan); // validates; throws with a clear message
    this.seed = cfg.seed ?? 1;
    this.bounceEnabled = cfg.bounceEnabled ?? false;
    this.strictDerail = cfg.strictDerail ?? false;
    this.init();
  }

  /** (Re)build all mutable state: train at start, switches at initial, PRNG reseeded. */
  private init(): void {
    const rng = mulberry32(this.seed);
    this.train = new Train(this.graph, this.strictDerail);
    this.switchUnits = this.graph.switches.map((s) => new Switch(s, this.graph.meta.switchActuationMs));
    this.switchUnitById = new Map(this.switchUnits.map((s) => [s.id, s]));
    this.reedUnits = this.graph.reeds.map(
      (r) => new Reed(r, this.graph.meta.reedWindowMm, this.bounceEnabled && r.bounce === true, rng),
    );
    this.reedUnitById = new Map(this.reedUnits.map((r) => [r.id, r]));
    this.fahrstrom = { word: 0, level: 0, direction: 'STOP' };
    this.notaus = false;
    this.timeMs = 0;
    this.events = [];
    this.occupied = new OccupiedPath(this.graph, CONSIST_REACH_MM, CONSIST_STEP_MM);
    this.occupied.reset(this.train.state(), (id) => this.mustSwitch(id).position);
  }

  /** Fixed-step physics; deterministic (§6.3). */
  step(dtMs: number): void {
    if (!(dtMs > 0)) throw new Error(`Plant.step: dtMs must be > 0, got ${dtMs}`);
    this.timeMs += dtMs;
    const emit = (e: SimEvent): void => {
      this.events.push(e);
    };

    // 1. Train motion (switch positions as of the previous step's completions).
    const senseBefore = this.train.directionSense;
    this.train.step(dtMs, {
      positionOf: (switchId) => this.mustSwitch(switchId).position,
      emit,
      nowMs: this.timeMs,
    });

    // 1b. Record the track the consist now stands on. Rendering-only data (§6.3) — it reads the
    // motion of step 1 and never feeds back into it. It runs before the actuation timers of step
    // 2 so that it resolves any new track through the same positions the train just used.
    this.occupied.advance(
      this.train.state(),
      this.train.lastStepTravelMm,
      this.train.directionSense !== senseBefore,
      (switchId) => this.mustSwitch(switchId).position,
    );

    // 2. Switch actuation timers + coil hold measurement.
    for (const sw of this.switchUnits) {
      const occupied = sw.isMoving ? this.trainOccupiesNode(sw.spec.nodeId) : false;
      const positionBefore = sw.position;
      const { movedUnderTrain } = sw.step(dtMs, this.timeMs, occupied, emit);
      // 2b. A switch that completed on track the loco has not crossed yet but is about to takes
      // the record with it (`docs/REVIEW_SCENE.md` D16 Folgearbeit): the loco WILL drive over the
      // new branch, so leaving the old one frozen under the leading coaches does not hold the
      // consist together, it tears it. Gated on motion — a standing consist is going nowhere and
      // the D16 freeze applies unchanged. Bounded: one truncation plus a walk of at most
      // OCCUPIED_LEAD_MM, and deterministic in trackplan order.
      if (sw.position !== positionBefore && this.train.speed > 0) {
        this.occupied.reresolveLead(sw.spec.nodeId, (id) => this.mustSwitch(id).position);
      }
      if (movedUnderTrain && this.strictDerail) {
        emit({ t: this.timeMs, type: 'derail', switchId: sw.id });
        this.train.derailNow(emit, this.timeMs);
      }
    }

    // 3. Reed closure sampling at the post-motion magnet position.
    const magnetEdgeId = this.train.currentEdgeId;
    const magnetOffsetMm = this.train.currentOffsetMm + this.graph.meta.magnetOffsetMm;
    for (const reed of this.reedUnits) {
      reed.step(this.timeMs, magnetEdgeId, magnetOffsetMm, emit);
    }
  }

  // ── actuator side (coordinator) ──────────────────────────────────────────

  setSwitchCoil(switchId: string, coil: 'G' | 'R', level: boolean): void {
    this.mustSwitch(switchId).setCoil(coil, level, this.timeMs, (e) => this.events.push(e));
  }

  setFahrstromWord(aw6: number): void {
    const { speedMmS, command } = wordToTarget(aw6, this.graph.meta);
    const level = (command === 'STOP' ? 0 : aw6 & 0xff) as 0 | 1 | 2 | 3;
    const changed = (aw6 & 0xffff) !== this.fahrstrom.word;
    this.fahrstrom = { word: aw6 & 0xffff, level, direction: command };
    this.train.setTraction(speedMmS, command);
    if (changed) {
      this.events.push({ t: this.timeMs, type: 'speedCommand', level, direction: command, word: this.fahrstrom.word });
    }
  }

  /** UI Notaus button (latching toggle). The plant itself does NOT stop the train —
   *  the student program must (§5.3; that is exercise NW 1). */
  setNotaus(active: boolean): void {
    if (active === this.notaus) return;
    this.notaus = active;
    this.events.push({ t: this.timeMs, type: 'notaus', active });
  }

  // ── sensor side (coordinator) ────────────────────────────────────────────

  /** Returns the latch, then clears it (§5.3 latch-until-consume). */
  consumeReedLatch(reedId: string): boolean {
    return this.mustReed(reedId).consume();
  }

  get notausActive(): boolean {
    return this.notaus;
  }

  // ── state ────────────────────────────────────────────────────────────────

  snapshot(): PlantSnapshot {
    const ts = this.train.state();
    const poly = this.graph.polyline(ts.edgeId);
    const worldPos = poly.pointAtMm(ts.offsetMm);
    const tan = poly.tangentAtMm(ts.offsetMm);
    // atan2 is rendering-only data (§6.3) — it never feeds back into plant state.
    // `+ 0` normalizes IEEE −0 (atan2(−0, −1) would flip π to −π).
    const headingRad = Math.atan2(tan.y * ts.direction + 0, tan.x * ts.direction + 0);
    // The track the consist stands on — recorded where the train has driven, walked through the
    // current switch positions where it has not (see OccupiedPath). Rendering-only data (§6.3):
    // it never feeds back into plant state.
    const consistPath = this.occupied.path((id) => this.mustSwitch(id).position);
    return {
      timeMs: this.timeMs,
      train: { ...ts, worldPos, headingRad, consistPath },
      switches: this.switchUnits.map((s) => s.snapshot()),
      reeds: this.reedUnits.map((r) => ({ id: r.id, closed: r.closed, latched: r.latched })),
      fahrstrom: { ...this.fahrstrom },
      notausActive: this.notaus,
      derailed: this.train.derailed,
    };
  }

  /** Events since last drain, chronological (append order; time is monotonic). */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Train to start pos, switches to initial, PRNG reseed (§5.3). */
  reset(): void {
    this.init();
  }

  /**
   * Re-seat the loco and reset (§7.1 `exerciseStarts`): the two Aufgabenstellungen start on
   * different tracks, so the live plant has to follow the exercise the student has open —
   * D13, where it stayed on the §7.1 default and Gruppe B always began on Gleis 1.
   *
   * Resolve the spec with `startForExercise`. Validation runs before anything moves, so a
   * bad spec throws and leaves the loco where it was.
   */
  setStart(spec: TrainStartSpec): void {
    this.graph.setStart(spec);
    this.init();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private mustSwitch(switchId: string): Switch {
    const sw = this.switchUnitById.get(switchId);
    if (!sw) throw new Error(`Plant: unknown switch id "${switchId}"`);
    return sw;
  }

  private mustReed(reedId: string): Reed {
    const r = this.reedUnitById.get(reedId);
    if (!r) throw new Error(`Plant: unknown reed id "${reedId}"`);
    return r;
  }

  /** Train within SWITCH_OCCUPANCY_MM (along-edge) of `nodeId` on an incident edge. */
  private trainOccupiesNode(nodeId: string): boolean {
    const edgeId = this.train.currentEdgeId;
    const off = this.train.currentOffsetMm;
    const e = this.graph.edge(edgeId);
    if (e.from === nodeId) return off <= SWITCH_OCCUPANCY_MM;
    if (e.to === nodeId) return this.graph.edgeLengthMm(edgeId) - off <= SWITCH_OCCUPANCY_MM;
    return false;
  }
}
