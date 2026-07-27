/**
 * SimCoordinator (ARCHITECTURE.md §5.2): master fixed-step loop — plant.step + PLC scan +
 * I/O ferrying. The per-step ordering in §5.2 (physics first, scan phase pinned POST-step
 * at simTimeMs % scanIntervalMs === 0, then deterministic event emission) is BINDING —
 * determinism (§6.3) and the oracle depend on it.
 */
import type { BitAddress, Emulator, ScanResult } from '../core';
import type { ScenarioAction } from '../pedagogy';
import { bitsToWord } from '../plant';
import type { Plant, PlantSnapshot, SimEvent } from '../plant';
import type { EventBus } from './EventBus';
import { isForcibleInput } from './Wiring';
import type { Wiring } from './Wiring';

/** Fixed physics step (§6.1) — mirrors SimClock.physicsStepMs. */
const PHYSICS_STEP_MS = 10;

const DEFAULT_SCAN_INTERVAL_MS = 50;
const MIN_SCAN_INTERVAL_MS = 10;
const MAX_SCAN_INTERVAL_MS = 200;

export interface CoordinatorConfig {
  scanIntervalMs?: number;      // default 50; allowed 10..200, multiple of physicsStepMs (10)
  seed?: number;                // plant PRNG seed, default 1
  trace?: boolean;              // per-instruction trace (M2 cycle inspector)
}

/** One coil command that went to a switch this board model does not have (§7.1). */
export interface UnplacedCoilCommand { switchId: string; coil: 'G' | 'R'; }

/** Force-mask key of an input bit — E is one byte area, so byte·8 + bit is unique. */
function inputKey(address: BitAddress): number {
  return address.byte * 8 + address.bit;
}

function inputAddress(key: number): BitAddress {
  return { kind: 'bit', area: 'E', byte: Math.floor(key / 8), bit: key % 8 };
}

/** Validate a scan interval against §5.2/§6.1: 10…200 ms and a multiple of the 10 ms step. */
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

export class SimCoordinator {
  private readonly emulator: Emulator;
  private readonly plant: Plant;
  private readonly wiring: Wiring;
  private readonly bus: EventBus;
  private readonly cfg: CoordinatorConfig;

  private scanIntervalMs: number;
  private simTime = 0;
  private scenario: ScenarioAction[] = [];
  private scenarioCursor = 0;
  private scan: ScanResult | null = null;
  /** Forced PAE bits (§10.3 "Try it"): mask key → value, re-asserted after every PAE write. */
  private readonly forced = new Map<number, boolean>();
  /** Coil commands to unplaced switches, recorded once per coil (§7.1). */
  private readonly unplacedHits: UnplacedCoilCommand[] = [];
  private readonly unplacedSeen = new Set<string>();

  constructor(emulator: Emulator, plant: Plant, wiring: Wiring, bus: EventBus,
              cfg?: CoordinatorConfig) {
    this.emulator = emulator;
    this.plant = plant;
    this.wiring = wiring;
    this.bus = bus;
    this.cfg = cfg ?? {};
    this.scanIntervalMs = checkScanInterval(this.cfg.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
  }

  /** Advance simulation by n physics steps (n*10 ms simulated). Deterministic. */
  advanceSteps(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** Deterministic stimulus playback for check runs and record/replay (§5.5
   *  ScenarioAction, §6.3): each action is applied immediately before the first physics
   *  step whose post-step simTimeMs is ≥ atMs (notaus → plant.setNotaus). Cleared by
   *  reset(). */
  loadScenario(actions: readonly ScenarioAction[]): void {
    this.scenario = [...actions].sort((a, b) => a.atMs - b.atMs);
    this.scenarioCursor = 0;
  }

  setScanInterval(ms: number): void {
    this.scanIntervalMs = checkScanInterval(ms);
  }

  reset(): void {                              // emulator.reset + plant.reset + clock 0
    this.emulator.reset();
    this.plant.reset();
    this.simTime = 0;
    this.scenario = [];
    this.scenarioCursor = 0;
    this.scan = null;
    this.forced.clear();
    this.clearUnplacedCoilCommands();
  }

  /**
   * Force a PAE bit from the UI — the "Try it" mini-mode of §10.3, which exercises the
   * Anleitung timer/edge examples (E 0.x / E 1.x operands) without the railway.
   *
   * `value = true` writes the bit AND registers it in the force mask: every scan re-asserts
   * forced bits AFTER the peripheral PAE write (step 2a below), so a forced input never
   * fights the per-scan reed/Notaus write. Reed latches are still consumed there, i.e. the
   * plant evolves identically whether an input is forced or not (determinism, §6.3).
   * `value = false` RELEASES the force and clears the bit — a wired reed input thereby
   * returns to the plant's control.
   *
   * Returns false, writing nothing, for anything that is not a forcible input
   * (`isForcibleInput`: an E bit other than the Notaus input, which has its own latching
   * button). The mask is cleared by `reset()`.
   */
  forceInputBit(address: BitAddress, value: boolean): boolean {
    if (!isForcibleInput(this.wiring, address)) return false;
    const key = inputKey(address);
    if (value) this.forced.set(key, true);
    else this.forced.delete(key);
    this.emulator.setInputBit(address, value);
    return true;
  }

  /** Release every forced input bit (the values stay as they are until the next scan). */
  clearForcedInputs(): void {
    this.forced.clear();
  }

  /** Is this bit currently held by the force mask? */
  isInputForced(address: BitAddress): boolean {
    return address.area === 'E' && this.forced.has(inputKey(address));
  }

  /**
   * Coil commands that went to switches the Variablenliste knows but this board model does
   * not have (trackplan `unplacedSwitches`, §7.1) — recorded ONCE per coil, not per scan, so
   * the UI can warn about a pulse that would otherwise be a silent no-op.
   */
  get unplacedCoilCommands(): readonly UnplacedCoilCommand[] {
    return this.unplacedHits;
  }

  /** Forget the recorded unplaced-coil commands — one program run, one warning per coil. */
  clearUnplacedCoilCommands(): void {
    this.unplacedHits.length = 0;
    this.unplacedSeen.clear();
  }

  snapshot(): PlantSnapshot {                  // pass-through of plant.snapshot()
    return this.plant.snapshot();
  }

  /** Most recent ScanResult — DiagnosticsPanel polls this for runtime diagnostics
   *  (R-RUN-001/002); those are NOT SimEvents (§6.3). */
  get lastScan(): ScanResult | null {
    return this.scan;
  }

  get simTimeMs(): number {
    return this.simTime;
  }

  /** Current PLC scan interval in simulated ms (default 50). */
  get scanInterval(): number {
    return this.scanIntervalMs;
  }

  // ── one 10 ms physics step (§5.2 loop, binding order) ──────────────────────

  private step(): void {
    // 1. scenario actions due for this step, then physics.
    const postStepMs = this.simTime + PHYSICS_STEP_MS;
    this.applyScenario(postStepMs);
    this.plant.step(PHYSICS_STEP_MS);
    this.simTime = postStepMs;

    // 2. scan phase, pinned POST-step: the first scan runs at t = scanIntervalMs.
    const coordinatorEvents: SimEvent[] = [];
    if (this.simTime % this.scanIntervalMs === 0) {
      this.runScan(coordinatorEvents);
    }

    // 3. deterministic emission: plant events first, then coordinator events.
    const plantEvents = this.plant.drainEvents();
    for (const e of stableByTime(plantEvents)) this.bus.emit(e);
    for (const e of coordinatorEvents) this.bus.emit(e);
  }

  private applyScenario(postStepMs: number): void {
    while (this.scenarioCursor < this.scenario.length) {
      const action = this.scenario[this.scenarioCursor];
      if (action === undefined || action.atMs > postStepMs) break;
      if (action.action === 'notaus') this.plant.setNotaus(action.active);
      this.scenarioCursor++;
    }
  }

  private runScan(out: SimEvent[]): void {
    // a. PAE write — reed latches + the fail-safe Notaus input (0-active, §5.3).
    for (const [reedId, address] of this.wiring.reedInput) {
      this.emulator.setInputBit(address, this.plant.consumeReedLatch(reedId));
    }
    this.emulator.setInputBit(this.wiring.notausInput, !this.plant.notausActive);

    // a'. forced bits win over the peripheral write (§10.3 "Try it"): re-asserted AFTER it,
    //     so the force never fights the reed write above — which still consumed every latch.
    for (const [key, value] of this.forced) {
      this.emulator.setInputBit(inputAddress(key), value);
    }

    // b. one full PLC scan.
    this.scan = this.emulator.step(this.scanIntervalMs, this.cfg.trace === true);

    // c. actuator read — simulates the system blocks FB2 (switches) and FB1 (Fahrstrom).
    const memory = this.emulator.memory;
    for (const [switchId, coils] of this.wiring.switchCoils) {
      this.plant.setSwitchCoil(switchId, 'G', memory.getBit(coils.G));
      this.plant.setSwitchCoil(switchId, 'R', memory.getBit(coils.R));
    }

    // Switches the Variablenliste commands but the board model lacks (§7.1): nothing to
    // ferry — record the command once per coil so the UI can warn instead of ignoring it.
    for (const [switchId, coils] of this.wiring.unplacedCoils) {
      for (const coil of ['G', 'R'] as const) {
        if (!memory.getBit(coils[coil])) continue;
        const key = `${switchId}.${coil}`;
        if (this.unplacedSeen.has(key)) continue;
        this.unplacedSeen.add(key);
        this.unplacedHits.push({ switchId, coil });
      }
    }

    const speedBits = this.wiring.speedBits;
    let m120 = 0;
    let setCount = 0;
    for (const address of [speedBits.stop, speedBits.s1iu, speedBits.s2iu, speedBits.s3iu,
                           speedBits.s1gu, speedBits.s2gu, speedBits.s3gu]) {
      if (!memory.getBit(address)) continue;
      m120 |= 1 << address.bit;
      setCount++;
    }
    const word = bitsToWord(m120);
    // Write AW 6 back into the process image so students can watch it, then drive the plant.
    memory.setWord(this.wiring.fahrstromWord, word);
    this.plant.setFahrstromWord(word);
    if (setCount > 1) out.push({ t: this.simTime, type: 'speedConflict', m120 });
  }
}

/** Stable sort by event time; equal times keep their detection order (§5.2 step 3). */
function stableByTime(events: readonly SimEvent[]): SimEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.t - b.e.t) || (a.i - b.i))
    .map(({ e }) => e);
}
