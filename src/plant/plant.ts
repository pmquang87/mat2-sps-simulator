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
import { Reed } from './reeds';
import type { ReedState } from './reeds';
import { mulberry32 } from './random';
import { Switch, SWITCH_OCCUPANCY_MM } from './switches';
import type { SwitchPosition, SwitchState } from './switches';
import { TrackGraph } from './trackGraph';
import { Train } from './train';
import type { TrainState } from './train';
import type { TrackplanFile, Vec2 } from './types';

export interface PlantConfig {
  trackplan: TrackplanFile;
  seed?: number;                     // PRNG for bounce; default 1
  bounceEnabled?: boolean;           // default false; true for the Entprellen exercise/oracle A
  strictDerail?: boolean;            // default false: trailing a switch = warning, not derail
}

export interface PlantSnapshot {
  timeMs: number;
  train: TrainState & { worldPos: Vec2; headingRad: number };
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
  }

  /** Fixed-step physics; deterministic (§6.3). */
  step(dtMs: number): void {
    if (!(dtMs > 0)) throw new Error(`Plant.step: dtMs must be > 0, got ${dtMs}`);
    this.timeMs += dtMs;
    const emit = (e: SimEvent): void => {
      this.events.push(e);
    };

    // 1. Train motion (switch positions as of the previous step's completions).
    this.train.step(dtMs, {
      positionOf: (switchId) => this.mustSwitch(switchId).position,
      emit,
      nowMs: this.timeMs,
    });

    // 2. Switch actuation timers + coil hold measurement.
    for (const sw of this.switchUnits) {
      const occupied = sw.isMoving ? this.trainOccupiesNode(sw.spec.nodeId) : false;
      const { movedUnderTrain } = sw.step(dtMs, this.timeMs, occupied, emit);
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
    return {
      timeMs: this.timeMs,
      train: { ...ts, worldPos, headingRad },
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
