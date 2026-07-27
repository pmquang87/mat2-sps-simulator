/**
 * §9.4 scenarioRunner.ts — headless full simulation for the oracle tests: real
 * SymbolTable (variables.json), Emulator, Plant (seed 42; bounce enabled for Gruppe A —
 * the solution's debounce network must survive real bounce), Wiring, Coordinator
 * (scan 50 ms).
 *
 * Scenario script (binding): t = 0 notaus active; t = 2 s release (E 1.7 goes 0 → 1);
 * then free-run until a final `trainStopped` with no restart for 30 s, or a
 * 10-simulated-minutes cap (reported as `completed: false`).
 */
import { EventBus, SimCoordinator, buildWiring } from '../../src/app';
import { Emulator, SymbolTable } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import { Plant } from '../../src/plant';
import type { SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';

export const ORACLE_SEED = 42;
export const ORACLE_SCAN_MS = 50;
/** Quiet time after the last trainStopped that ends the run. */
export const QUIET_MS = 30_000;
/** Hard cap: 10 simulated minutes. */
export const CAP_MS = 600_000;

export interface OracleRunOptions {
  bounceEnabled: boolean;              // true for Gruppe A (§9.4)
  seed?: number;
  /** Apply trackplan.json `exerciseStarts[exerciseId]` (ARCHITECTURE.md §7.1 deviation
   *  note): Gruppe B starts on BH1 Gleis 4, not at the §7.1 `start` (Gleis 1). */
  exerciseId?: string;
  /**
   * Test-only fault injection on a DEEP CLONE of the trackplan (the shipped JSON is never
   * mutated). Used by the mutation-control tests that prove the §9.4 assertions actually
   * bite: a deliberately broken `coilToBranch` on a FACED driven switch must make the
   * expected reed/speed sequence fail. Without such a control a green oracle cannot be
   * distinguished from a vacuous one.
   */
  mutateTrackplan?: (plan: TrackplanFile) => void;
}

interface StartSpec { edgeId: string; offsetMm: number; direction: 1 | -1; }

function trackplanForExercise(plan: TrackplanFile, exerciseId: string | undefined): TrackplanFile {
  if (exerciseId === undefined) return plan;
  const extras = plan as unknown as { exerciseStarts?: Record<string, StartSpec> };
  const start = extras.exerciseStarts?.[exerciseId];
  if (start === undefined) return plan;
  const clone = JSON.parse(JSON.stringify(plan)) as TrackplanFile & { start: StartSpec };
  clone.start = { edgeId: start.edgeId, offsetMm: start.offsetMm, direction: start.direction };
  return clone;
}

/**
 * Fault injector for the mutation-control tests: swap a switch's G/R → branch mapping.
 * A flip on a switch the route FACES diverts the train (the reed/speed sequence breaks);
 * a flip on a switch the route only TRAILS is observable solely through `switchTrailed`
 * (see matchers.ts header). Both classes must make the expectation set fail.
 */
export function flipCoilMapping(switchId: string): (plan: TrackplanFile) => void {
  return (plan: TrackplanFile): void => {
    const sw = plan.switches.find((s) => s.id === switchId);
    if (sw === undefined) throw new Error(`flipCoilMapping: no switch ${switchId} in trackplan`);
    if (sw.coilToBranch === null) {
      throw new Error(`flipCoilMapping: ${switchId} is not commandable (coilToBranch null)`);
    }
    const g = sw.coilToBranch.G;
    sw.coilToBranch.G = sw.coilToBranch.R;
    sw.coilToBranch.R = g;
  };
}

export interface OracleRunResult {
  events: SimEvent[];
  /** JSON-serialized event log (identity comparison across runs, §9.4 determinism). */
  log: string;
  /** True when the run ended via the final-stop condition (not the cap). */
  completed: boolean;
  endTimeMs: number;
}

export function runOracleScenario(source: string, options: OracleRunOptions): OracleRunResult {
  const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);
  let trackplan = trackplanForExercise(
    trackplanJson as unknown as TrackplanFile,
    options.exerciseId,
  );
  if (options.mutateTrackplan !== undefined) {
    // Clone first: trackplanForExercise only clones when an exercise start override exists,
    // and the imported JSON module object is shared across the whole test file.
    trackplan = JSON.parse(JSON.stringify(trackplan)) as TrackplanFile;
    options.mutateTrackplan(trackplan);
  }

  const emulator = new Emulator(symbols);
  const load = emulator.load(source);
  if (!load.ok) {
    const details = load.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} @${d.line}:${d.col} ${d.message.en}`)
      .join('; ');
    throw new Error(`oracle program failed to load: ${details}`);
  }

  const plant = new Plant({
    trackplan,
    seed: options.seed ?? ORACLE_SEED,
    bounceEnabled: options.bounceEnabled,
  });
  const wiring = buildWiring(symbols, trackplan);
  const bus = new EventBus();
  const events: SimEvent[] = [];
  bus.on((e) => events.push(e));
  const coordinator = new SimCoordinator(emulator, plant, wiring, bus, {
    scanIntervalMs: ORACLE_SCAN_MS,
  });
  coordinator.loadScenario([
    { atMs: 0, action: 'notaus', active: true },
    { atMs: 2_000, action: 'notaus', active: false },
  ]);

  let lastMotionEvent: { type: 'trainStarted' | 'trainStopped'; t: number } | null = null;
  let cursor = 0;
  let completed = false;
  while (coordinator.simTimeMs < CAP_MS) {
    coordinator.advanceSteps(100);               // 1 s chunks
    for (; cursor < events.length; cursor++) {
      const event = events[cursor];
      if (event === undefined) continue;
      if (event.type === 'trainStarted' || event.type === 'trainStopped') {
        lastMotionEvent = { type: event.type, t: event.t };
      }
    }
    if (
      lastMotionEvent !== null &&
      lastMotionEvent.type === 'trainStopped' &&
      coordinator.simTimeMs - lastMotionEvent.t >= QUIET_MS
    ) {
      completed = true;
      break;
    }
  }

  return {
    events,
    log: JSON.stringify(events),
    completed,
    endTimeMs: coordinator.simTimeMs,
  };
}
