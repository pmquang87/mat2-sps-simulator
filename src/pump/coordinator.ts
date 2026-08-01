/**
 * PumpCoordinator — the pump experiment's master loop. Same shape and the same binding
 * step order as `app/SimCoordinator` (§5.2): physics first, the scan phase pinned POST-step
 * at `simTimeMs % scanIntervalMs === 0`, then deterministic event emission.
 *
 * It is a PARALLEL coordinator, not a generalisation of the railway one, on purpose: the
 * railway is delivered and its behaviour is pinned by tests and by the oracle. Duplicating
 * ~80 lines of loop is cheaper than any refactor that could move a railway event by one
 * step. The pieces that carry no railway behaviour (SimClock, RafDriver) are reused as-is.
 */
import type { BitAddress, Emulator, ScanResult } from '../core';
import type { PumpPlant, PumpSnapshot } from './model';
import type { PumpParams } from './params';
import type { PumpButtonId, PumpEventBus, PumpToggleId, PumpValveId } from './types';
import { isForciblePumpInput } from './wiring';
import type { PumpWiring } from './wiring';

/** Fixed physics step (§6.1) — mirrors SimClock.physicsStepMs. */
const PHYSICS_STEP_MS = 10;

const DEFAULT_SCAN_INTERVAL_MS = 50;
const MIN_SCAN_INTERVAL_MS = 10;
const MAX_SCAN_INTERVAL_MS = 200;

export interface PumpCoordinatorConfig {
  scanIntervalMs?: number;      // default 50; allowed 10..200, multiple of physicsStepMs (10)
  trace?: boolean;              // per-instruction trace (cycle inspector)
}

/** Force-mask key of an input bit — E is one byte area, so byte·8 + bit is unique. */
function inputKey(address: BitAddress): number {
  return address.byte * 8 + address.bit;
}

function inputAddress(key: number): BitAddress {
  return { kind: 'bit', area: 'E', byte: Math.floor(key / 8), bit: key % 8 };
}

function checkScanInterval(ms: number): number {
  if (!Number.isInteger(ms) || ms < MIN_SCAN_INTERVAL_MS || ms > MAX_SCAN_INTERVAL_MS
      || ms % PHYSICS_STEP_MS !== 0) {
    throw new RangeError(
      `scanIntervalMs must be an integer in ${MIN_SCAN_INTERVAL_MS}..${MAX_SCAN_INTERVAL_MS} `
      + `and a multiple of ${PHYSICS_STEP_MS} (got ${ms})`,
    );
  }
  return ms;
}

export class PumpCoordinator {
  private readonly emulator: Emulator;
  private readonly plant: PumpPlant;
  private readonly wiring: PumpWiring;
  private readonly bus: PumpEventBus;
  private readonly cfg: PumpCoordinatorConfig;

  private scanIntervalMs: number;
  private simTime = 0;
  private scan: ScanResult | null = null;
  /** Forced PAE bits (§10.3 "Try it"): mask key → value, re-asserted after every PAE write. */
  private readonly forced = new Map<number, boolean>();

  constructor(emulator: Emulator, plant: PumpPlant, wiring: PumpWiring, bus: PumpEventBus,
              cfg?: PumpCoordinatorConfig) {
    this.emulator = emulator;
    this.plant = plant;
    this.wiring = wiring;
    this.bus = bus;
    this.cfg = cfg ?? {};
    this.scanIntervalMs = checkScanInterval(this.cfg.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
  }

  /** Advance simulation by n physics steps (n·10 ms simulated). Deterministic. */
  advanceSteps(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  setScanInterval(ms: number): void {
    this.scanIntervalMs = checkScanInterval(ms);
  }

  reset(): void {
    this.emulator.reset();
    this.plant.reset();
    this.simTime = 0;
    this.scan = null;
    this.forced.clear();
  }

  // ── host input (UI) ───────────────────────────────────────────────────────

  /** Momentary start button S1 (E 0.0). */
  pressS1(pressed: boolean): void {
    this.plant.pressS1(pressed);
  }

  /** Momentary stop button S0 (E 0.6). */
  pressS0(pressed: boolean): void {
    this.plant.pressS0(pressed);
  }

  setButton(id: PumpButtonId, pressed: boolean): void {
    this.plant.setButton(id, pressed);
  }

  setToggle(id: PumpToggleId, value: boolean): void {
    this.plant.setToggle(id, value);
  }

  setValve(id: PumpValveId, open: boolean): void {
    this.plant.setValve(id, open);
  }

  /** Student-adjustable model physics; rates/thresholds/delay live, initial levels on reset. */
  setParams(patch: Partial<PumpParams>): PumpParams {
    return this.plant.setParams(patch);
  }

  get params(): PumpParams {
    return this.plant.params;
  }

  // ── "Try it" input forcing (§10.3) ────────────────────────────────────────

  /**
   * Force a PAE bit from the UI. `true` writes the bit AND registers it in the force mask,
   * which every scan re-asserts AFTER the peripheral PAE write, so a forced input never
   * fights the plant's own sensor/button write. `false` releases the force and clears the
   * bit, handing the input back to the plant. Returns false for anything that is not an E
   * bit. The mask is cleared by `reset()`.
   */
  forceInputBit(address: BitAddress, value: boolean): boolean {
    if (!isForciblePumpInput(address)) return false;
    const key = inputKey(address);
    if (value) this.forced.set(key, true);
    else this.forced.delete(key);
    this.emulator.setInputBit(address, value);
    return true;
  }

  clearForcedInputs(): void {
    this.forced.clear();
  }

  isInputForced(address: BitAddress): boolean {
    return address.area === 'E' && this.forced.has(inputKey(address));
  }

  // ── state ─────────────────────────────────────────────────────────────────

  snapshot(): PumpSnapshot {
    return this.plant.snapshot();
  }

  /** Most recent ScanResult — the DiagnosticsPanel polls this for runtime diagnostics. */
  get lastScan(): ScanResult | null {
    return this.scan;
  }

  get simTimeMs(): number {
    return this.simTime;
  }

  get scanInterval(): number {
    return this.scanIntervalMs;
  }

  // ── one 10 ms physics step (§5.2 loop order) ──────────────────────────────

  private step(): void {
    // 1. physics.
    this.plant.step(PHYSICS_STEP_MS);
    this.simTime += PHYSICS_STEP_MS;

    // 2. scan phase, pinned POST-step: the first scan runs at t = scanIntervalMs.
    if (this.simTime % this.scanIntervalMs === 0) this.runScan();

    // 3. emission — plant events in detection order (their times are monotonic).
    for (const e of this.plant.drainEvents()) this.bus.emit(e);
  }

  private runScan(): void {
    // a. PAE write — sensors, momentary buttons and pedestal toggles.
    const state = this.plant.snapshot();
    for (const [id, address] of this.wiring.sensorInput) {
      this.emulator.setInputBit(address, state.sensors[id]);
    }
    for (const [id, address] of this.wiring.buttonInput) {
      this.emulator.setInputBit(address, state.buttons[id]);
    }
    for (const [id, address] of this.wiring.toggleInput) {
      this.emulator.setInputBit(address, state.toggles[id]);
    }

    // a'. forced bits win over the peripheral write (§10.3).
    for (const [key, value] of this.forced) {
      this.emulator.setInputBit(inputAddress(key), value);
    }

    // b. one full PLC scan.
    this.scan = this.emulator.step(this.scanIntervalMs, this.cfg.trace === true);

    // c. actuator read — PAA into the plant.
    const memory = this.emulator.memory;
    for (const [id, address] of this.wiring.actuatorOutput) {
      this.plant.setActuator(id, memory.getBit(address));
    }
  }
}
