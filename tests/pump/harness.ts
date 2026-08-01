/**
 * Shared fixture for the pump-experiment tests: the REAL Emulator + PumpPlant + wiring +
 * PumpCoordinator, built through `createPumpStack` — the same call the app bootstrap makes.
 * No doubles anywhere, so a passing test says something about the shipped stack.
 */
import { createPumpStack } from '../../src/pump';
import type { PumpEvent, PumpParams, PumpSnapshot, PumpStack } from '../../src/pump';
import examplesJson from '../../src/data/examples.json';

export interface PumpHarnessOptions {
  program?: string;
  params?: Partial<PumpParams>;
  scanIntervalMs?: number;
}

export interface PumpHarness extends PumpStack {
  /** Every PumpEvent emitted on the bus, in emission order. */
  events: PumpEvent[];
}

export function buildPumpHarness(options: PumpHarnessOptions = {}): PumpHarness {
  const stackCfg: Parameters<typeof createPumpStack>[0] = {};
  if (options.params !== undefined) stackCfg.params = options.params;
  if (options.scanIntervalMs !== undefined) stackCfg.scanIntervalMs = options.scanIntervalMs;
  const stack = createPumpStack(stackCfg);
  if (options.program !== undefined) {
    const result = stack.emulator.load(options.program);
    if (!result.ok) {
      const details = result.diagnostics
        .map((d) => `${d.code} @${d.line}:${d.col} ${d.message.en}`)
        .join('; ');
      throw new Error(`harness program failed to load: ${details}`);
    }
  }
  const events: PumpEvent[] = [];
  stack.bus.on((e) => events.push(e));
  return { ...stack, events };
}

/**
 * Advance until `predicate` holds for the snapshot AFTER a step; returns the simulated time
 * at which it first held, or null at the cap. Checking post-step keeps the answer on the
 * 10 ms grid the coordinator advances on.
 */
export function advanceUntil(
  harness: PumpHarness,
  predicate: (s: PumpSnapshot) => boolean,
  maxSimMs: number,
): number | null {
  while (harness.coordinator.simTimeMs < maxSimMs) {
    harness.coordinator.advanceSteps(1);
    if (predicate(harness.coordinator.snapshot())) return harness.coordinator.simTimeMs;
  }
  return null;
}

/** Minimal view of src/data/examples.json — deliberately NOT the pedagogy loader, so this
 *  suite does not move when the examples schema grows a field. */
interface ExampleRow { id: string; awl: string; source: string }

export function exampleRows(): ExampleRow[] {
  const doc = examplesJson as unknown as { examples: ExampleRow[] };
  return doc.examples;
}

export function exampleAwl(id: string): string {
  const row = exampleRows().find((e) => e.id === id);
  if (row === undefined) throw new Error(`examples.json has no example "${id}"`);
  return row.awl;
}
