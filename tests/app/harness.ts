/**
 * Shared fixture for the §9.3 app-level integration tests: the REAL Emulator + Plant +
 * Wiring + SimCoordinator built from the shipped data files (src/data/*.json) — no doubles
 * (tests/ui/coordinatorLoop.test.ts covers the coordinator against doubles; these suites
 * prove the assembled stack).
 */
import { EventBus, SimCoordinator, buildWiring } from '../../src/app';
import type { Wiring } from '../../src/app';
import { Emulator, SymbolTable } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import { Plant } from '../../src/plant';
import type { SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';

export interface HarnessOptions {
  program?: string;
  seed?: number;
  scanIntervalMs?: number;
  bounceEnabled?: boolean;
}

export interface AppHarness {
  symbols: SymbolTable;
  emulator: Emulator;
  plant: Plant;
  wiring: Wiring;
  bus: EventBus;
  coordinator: SimCoordinator;
  /** Every SimEvent emitted on the bus, in emission order. */
  events: SimEvent[];
}

export function buildHarness(options: HarnessOptions = {}): AppHarness {
  const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);
  const trackplan = trackplanJson as unknown as TrackplanFile;
  const emulator = new Emulator(symbols);
  if (options.program !== undefined) {
    const result = emulator.load(options.program);
    if (!result.ok) {
      const details = result.diagnostics
        .map((d) => `${d.code} @${d.line}:${d.col} ${d.message.en}`)
        .join('; ');
      throw new Error(`harness program failed to load: ${details}`);
    }
  }
  const plant = new Plant({
    trackplan,
    seed: options.seed ?? 1,
    bounceEnabled: options.bounceEnabled ?? false,
  });
  const wiring = buildWiring(symbols, trackplan);
  const bus = new EventBus();
  const events: SimEvent[] = [];
  bus.on((e) => events.push(e));
  const coordinator = new SimCoordinator(emulator, plant, wiring, bus, {
    scanIntervalMs: options.scanIntervalMs ?? 50,
  });
  return { symbols, emulator, plant, wiring, bus, coordinator, events };
}

/** Advance until `predicate` matches a new event; returns the event or null at the cap. */
export function advanceUntil(
  harness: AppHarness,
  predicate: (e: SimEvent) => boolean,
  maxSimMs: number,
): SimEvent | null {
  let cursor = harness.events.length;
  while (harness.coordinator.simTimeMs < maxSimMs) {
    harness.coordinator.advanceSteps(1);
    for (; cursor < harness.events.length; cursor++) {
      const event = harness.events[cursor];
      if (event !== undefined && predicate(event)) return event;
    }
  }
  return null;
}

/** A program with neutral behavior only: drive at speed 3 while the emergency stop is
 *  released, force STOP while it is pressed. Uses only documented system symbols. */
export const DRIVE_PROGRAM = [
  'U  "NotausBit"',
  'S  "Speed3IU"',
  'UN "NotausBit"',
  'R  "Speed3IU"',
  'UN "NotausBit"',
  'S  "STOP"',
  'U  "NotausBit"',
  'R  "STOP"',
  '',
].join('\n');
