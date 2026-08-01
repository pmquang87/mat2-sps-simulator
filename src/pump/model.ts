/**
 * Deterministic pump plant (Anleitung IV.2.5.2, Abbildung 4): a centrifugal pump moves
 * product from source tank A into target tank B, watched by four level switches and a
 * dry-run guard.
 *
 * Pure logic, exactly like `plant/`: no DOM, no wall clock, no `Math.random`. Fixed-step,
 * called with 10 ms by the coordinator; two runs of the same host-call script produce
 * byte-identical snapshot sequences (§6.3).
 *
 * MODEL ASSUMPTIONS (the manual specifies signals and start/stop conditions, no dynamics):
 *  - Levels are % of each tank's own capacity. One transfer rate moves both levels, i.e.
 *    the two tanks are modelled with equal capacity.
 *  - Transfer is limited by what A still holds and by what B can still take, so a full B
 *    deadheads the pump instead of overflowing (the level bits keep working either way).
 *  - The pump is a dumb actuator: it runs whenever A 0.1 is on, dry-run guard or not. The
 *    guard is a SENSOR the student program has to evaluate — that is the whole point of the
 *    Anleitung's `U E 0.5`, and a plant that stopped the pump by itself would hide the bug
 *    the exercise is about.
 *  - Every level bit has a hysteresis band (`PUMP_SENSOR_HYSTERESIS_PCT`) so a level parked
 *    exactly on a threshold cannot chatter the input bit from scan to scan.
 */
import {
  PUMP_ACTUATOR_IDS, PUMP_BUTTON_IDS, PUMP_SENSOR_IDS, PUMP_TOGGLE_IDS, PUMP_VALVE_IDS,
} from './types';
import type {
  PumpActuatorId, PumpButtonId, PumpEvent, PumpSensorId, PumpToggleId, PumpValveId,
} from './types';
import { PUMP_PARAM_DEFAULTS, PUMP_PARAM_KEYS, clampPumpParams } from './params';
import type { PumpParams } from './params';

/** Tank capacity in the model's own unit: levels run 0 … 100 %. */
export const PUMP_LEVEL_MIN_PCT = 0;
export const PUMP_LEVEL_MAX_PCT = 100;

/**
 * Sensor hysteresis band, % of capacity. An empty bit that switched on at `lls` only
 * releases at `lls + 1`, a full bit that switched on at `hls` only releases at `hls − 1`.
 * Not student-adjustable: it is what makes the bits stable, not a teaching variable. The
 * parameter ranges keep `lls + band < hls − band` for every admissible setting.
 */
export const PUMP_SENSOR_HYSTERESIS_PCT = 1;

/** Levels below this count as zero — guards the float residue of repeated subtraction. */
const EMPTY_EPS_PCT = 1e-9;

export interface PumpSnapshot {
  timeMs: number;
  volAPct: number;
  volBPct: number;
  sensors: Record<PumpSensorId, boolean>;
  buttons: Record<PumpButtonId, boolean>;
  toggles: Record<PumpToggleId, boolean>;
  actuators: Record<PumpActuatorId, boolean>;
  valves: Record<PumpValveId, boolean>;
  /** Flows actually realised in the last step, %/s — a stream is drawn only where this is
   *  > 0, at a speed proportional to it (a deadheaded pump therefore draws nothing). */
  flowPctS: { pump: number; refill: number; drain: number };
  /** How long the pump has been running with A empty, ms; 0 while A holds product. */
  dryRunMs: number;
  /** The parameters in force — the scene places the sensor probes at these thresholds. */
  params: PumpParams;
}

export interface PumpPlantConfig {
  /** Initial parameter patch; missing fields take the documented defaults. */
  params?: Partial<PumpParams>;
}

function clampLevel(v: number): number {
  if (v < PUMP_LEVEL_MIN_PCT) return PUMP_LEVEL_MIN_PCT;
  if (v > PUMP_LEVEL_MAX_PCT) return PUMP_LEVEL_MAX_PCT;
  return v;
}

/** Empty bit with hysteresis: trips at `threshold`, releases one band above it. */
function lowBit(prev: boolean, level: number, threshold: number): boolean {
  return prev ? level < threshold + PUMP_SENSOR_HYSTERESIS_PCT : level <= threshold;
}

/** Full bit with hysteresis: trips at `threshold`, releases one band below it. */
function highBit(prev: boolean, level: number, threshold: number): boolean {
  return prev ? level > threshold - PUMP_SENSOR_HYSTERESIS_PCT : level >= threshold;
}

function fill<K extends string, V>(keys: readonly K[], value: V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const key of keys) out[key] = value;
  return out;
}

export class PumpPlant {
  private activeParams: PumpParams;

  private volA!: number;
  private volB!: number;
  private sensorBits!: Record<PumpSensorId, boolean>;
  private buttonBits!: Record<PumpButtonId, boolean>;
  private toggleBits!: Record<PumpToggleId, boolean>;
  private actuatorBits!: Record<PumpActuatorId, boolean>;
  private valveBits!: Record<PumpValveId, boolean>;
  private flow!: { pump: number; refill: number; drain: number };
  private dryMs!: number;
  private timeMs!: number;
  private events!: PumpEvent[];

  constructor(cfg: PumpPlantConfig = {}) {
    this.activeParams = clampPumpParams(cfg.params, PUMP_PARAM_DEFAULTS);
    this.init();
  }

  /** (Re)build all mutable state from the ACTIVE parameters (initial levels included). */
  private init(): void {
    this.volA = clampLevel(this.activeParams.initialVolAPct);
    this.volB = clampLevel(this.activeParams.initialVolBPct);
    this.buttonBits = fill(PUMP_BUTTON_IDS, false);
    this.toggleBits = fill(PUMP_TOGGLE_IDS, false);
    this.actuatorBits = fill(PUMP_ACTUATOR_IDS, false);
    this.valveBits = fill(PUMP_VALVE_IDS, false);
    this.flow = { pump: 0, refill: 0, drain: 0 };
    this.dryMs = 0;
    this.timeMs = 0;
    this.events = [];
    this.sensorBits = fill(PUMP_SENSOR_IDS, false);
    this.seedSensorBits();
    // The seed above is the initial state, not a transition: a fresh plant hands out no
    // events, exactly like the railway plant after reset().
    this.events = [];
  }

  /** Sensor bits without hysteresis memory — used at reset and after a threshold change. */
  private seedSensorBits(): void {
    const p = this.activeParams;
    this.setSensor('llsA', this.volA <= p.llsThresholdPct);
    this.setSensor('hlsA', this.volA >= p.hlsThresholdPct);
    this.setSensor('llsB', this.volB <= p.llsThresholdPct);
    this.setSensor('hlsB', this.volB >= p.hlsThresholdPct);
    this.setSensor('ls', !this.isDry());
  }

  // ── physics ───────────────────────────────────────────────────────────────

  /** One fixed physics step. Deterministic; `dtMs` must be > 0. */
  step(dtMs: number): void {
    if (!(dtMs > 0)) throw new Error(`PumpPlant.step: dtMs must be > 0, got ${dtMs}`);
    this.timeMs += dtMs;
    const dtS = dtMs / 1000;
    const p = this.activeParams;

    // 1. Flows, all evaluated against the PRE-step levels so their order cannot matter.
    const demand = this.actuatorBits.pump ? p.pumpRatePctS * dtS : 0;
    const transferred = Math.min(demand, this.volA, PUMP_LEVEL_MAX_PCT - this.volB);
    const refilled = this.valveBits.inA
      ? Math.min(p.refillRatePctS * dtS, PUMP_LEVEL_MAX_PCT - this.volA) : 0;
    const drained = this.valveBits.outB ? Math.min(p.drainRatePctS * dtS, this.volB) : 0;

    const beforeA = this.volA;
    const beforeB = this.volB;
    this.volA = clampLevel(this.volA - transferred + refilled);
    this.volB = clampLevel(this.volB + transferred - drained);
    this.flow = { pump: transferred / dtS, refill: refilled / dtS, drain: drained / dtS };

    // 2. Dry-run guard: the delay only accumulates while the pump actually runs dry, and it
    //    is cleared the moment product is back — "re-wets as soon as volA > 0".
    //    Only a step that was dry at BOTH ends counts: the step in which the tank runs
    //    empty is partly wet (counting it would trip the guard one step early), and the
    //    step in which the refill valve puts product back is wet again. "Dry for
    //    `dryRunDelayS`" is therefore exactly that much simulated time after the level
    //    reached zero.
    const dryStep = this.actuatorBits.pump
      && beforeA <= EMPTY_EPS_PCT && this.volA <= EMPTY_EPS_PCT;
    if (dryStep) this.dryMs += dtMs;
    else this.dryMs = 0;

    // 3. Sensor bits (hysteresis) + the level-extreme events the scene uses for splashes.
    this.updateSensors();
    this.emitLevelEdges('A', beforeA, this.volA);
    this.emitLevelEdges('B', beforeB, this.volB);
  }

  private updateSensors(): void {
    const p = this.activeParams;
    this.setSensor('llsA', lowBit(this.sensorBits.llsA, this.volA, p.llsThresholdPct));
    this.setSensor('hlsA', highBit(this.sensorBits.hlsA, this.volA, p.hlsThresholdPct));
    this.setSensor('llsB', lowBit(this.sensorBits.llsB, this.volB, p.llsThresholdPct));
    this.setSensor('hlsB', highBit(this.sensorBits.hlsB, this.volB, p.hlsThresholdPct));
    this.setSensor('ls', !this.isDry());
  }

  /** The guard reports dry only after `dryRunDelayS` of pumping against an empty tank A. */
  private isDry(): boolean {
    if (!this.actuatorBits.pump) return false;
    if (this.volA > EMPTY_EPS_PCT) return false;
    return this.dryMs >= this.activeParams.dryRunDelayS * 1000;
  }

  private setSensor(id: PumpSensorId, value: boolean): void {
    if (this.sensorBits[id] === value) return;
    this.sensorBits[id] = value;
    this.events.push({ t: this.timeMs, type: 'sensor', id, value });
  }

  private emitLevelEdges(tank: 'A' | 'B', before: number, after: number): void {
    if (after >= PUMP_LEVEL_MAX_PCT && before < PUMP_LEVEL_MAX_PCT) {
      this.events.push({ t: this.timeMs, type: 'tankFull', tank });
    }
    if (after <= PUMP_LEVEL_MIN_PCT && before > PUMP_LEVEL_MIN_PCT) {
      this.events.push({ t: this.timeMs, type: 'tankEmpty', tank });
    }
  }

  // ── actuator side (coordinator) ───────────────────────────────────────────

  /** PAA → plant: A 0.1 pump, A 0.2 / A 0.3 indicator lamps. */
  setActuator(id: PumpActuatorId, on: boolean): void {
    if (this.actuatorBits[id] === on) return;
    this.actuatorBits[id] = on;
    this.events.push({ t: this.timeMs, type: 'actuator', id, on });
  }

  // ── host input side (UI) ──────────────────────────────────────────────────

  /** Momentary start button S1 (E 0.0) — held while the pointer is down. */
  pressS1(pressed: boolean): void {
    this.setButton('S1', pressed);
  }

  /** Momentary stop button S0 (E 0.6). */
  pressS0(pressed: boolean): void {
    this.setButton('S0', pressed);
  }

  setButton(id: PumpButtonId, pressed: boolean): void {
    if (this.buttonBits[id] === pressed) return;
    this.buttonBits[id] = pressed;
    this.events.push({ t: this.timeMs, type: 'button', id, pressed });
  }

  /** Pedestal toggle switch, e.g. `setToggle('E1.0', true)`. */
  setToggle(id: PumpToggleId, value: boolean): void {
    if (this.toggleBits[id] === value) return;
    this.toggleBits[id] = value;
    this.events.push({ t: this.timeMs, type: 'toggle', id, value });
  }

  /** Hand valve: `'inA'` refills tank A, `'outB'` drains tank B. Not PLC-controlled. */
  setValve(id: PumpValveId, open: boolean): void {
    if (this.valveBits[id] === open) return;
    this.valveBits[id] = open;
    this.events.push({ t: this.timeMs, type: 'valve', id, open });
  }

  // ── parameters ────────────────────────────────────────────────────────────

  get params(): PumpParams {
    return { ...this.activeParams };
  }

  /**
   * Apply a parameter patch. Rates, thresholds and the dry-run delay take effect on the
   * next step; the initial levels are stored for the next `reset()` and do NOT move the
   * liquid now. Values are clamped, never rejected. Returns the parameters in force.
   *
   * A threshold change re-seeds the level bits WITHOUT hysteresis memory: dragging a
   * threshold past the current level must flip the bit at the level the probe now sits at,
   * not one band later.
   *
   * A patch that clamps to the values already in force is a NON-EVENT: `paramsChanged` says
   * "the probes moved, re-place them", and a slider that reports every pointer sample would
   * otherwise fill the event queue with hundreds of identical notifications per drag. Same
   * rule as `setActuator`/`setToggle` above — the plant publishes transitions, not calls.
   */
  setParams(patch: Partial<PumpParams>): PumpParams {
    const previous = this.activeParams;
    const next = clampPumpParams(patch, previous);
    let changed = false;
    for (const key of PUMP_PARAM_KEYS) {
      if (next[key] !== previous[key]) changed = true;
    }
    if (!changed) return this.params;
    const thresholdsMoved = next.llsThresholdPct !== previous.llsThresholdPct
      || next.hlsThresholdPct !== previous.hlsThresholdPct;
    this.activeParams = next;
    if (thresholdsMoved) this.seedSensorBits();
    this.events.push({ t: this.timeMs, type: 'paramsChanged' });
    return this.params;
  }

  // ── state ─────────────────────────────────────────────────────────────────

  snapshot(): PumpSnapshot {
    return {
      timeMs: this.timeMs,
      volAPct: this.volA,
      volBPct: this.volB,
      sensors: { ...this.sensorBits },
      buttons: { ...this.buttonBits },
      toggles: { ...this.toggleBits },
      actuators: { ...this.actuatorBits },
      valves: { ...this.valveBits },
      flowPctS: { ...this.flow },
      dryRunMs: this.dryMs,
      params: { ...this.activeParams },
    };
  }

  /** Events since the last drain, chronological (append order; time is monotonic). */
  drainEvents(): PumpEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Levels back to the initial-level parameters, valves/buttons/toggles released, t = 0. */
  reset(): void {
    this.init();
  }
}
