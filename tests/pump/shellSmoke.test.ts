/**
 * End-to-end smoke of the PUMP BOOTSTRAP PATH, headless.
 *
 * Everything the browser bootstrap assembles is assembled here, minus the two pieces that
 * need a browser (the WebGL scene and the rAF driver): the real stack from
 * `createPumpStack`, the real examples library from `src/data/examples.json` filtered for
 * this experiment, the real profile from `ui/pumpProfile.ts`, and the real parameter host
 * over a fake key-value store. `SimClock` + `advanceSteps` stand in for `RafDriver`, which
 * is exactly what the driver does with the frame time it is handed.
 *
 * One scripted run: load the manual's self-holding pump program, press S1 the way the 3D
 * pedestal would, and assert that the pump output and the tank levels actually move.
 */
import { describe, expect, it } from 'vitest';
import { SimClock } from '../../src/app';
import { examplesForExperiment, loadExamples } from '../../src/pedagogy';
import type { KeyValueStore } from '../../src/pedagogy';
import { PUMP_PARAM_DEFAULTS, createPumpStack } from '../../src/pump';
import {
  buildPumpProfile,
  createPumpParameterHost,
  readStoredPumpParams,
} from '../../src/ui/pumpProfile';
import examplesJson from '../../src/data/examples.json';

/** In-memory KeyValueStore — the browser store's shape, none of its environment. */
function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

function pumpExample(id: string): string {
  const examples = examplesForExperiment(loadExamples(examplesJson), 'pump');
  const found = examples.find((e) => e.id === id);
  if (found === undefined) throw new Error(`examples.json has no pump example "${id}"`);
  return found.awl;
}

describe('pump bootstrap path (headless)', () => {
  it('runs the manual’s self-holding pump program end to end', () => {
    const store = memoryStore();
    const stack = createPumpStack({
      params: readStoredPumpParams(store),
      scanIntervalMs: 50,
    });
    const parameters = createPumpParameterHost(stack.coordinator, store);
    const profile = buildPumpProfile({ wiring: stack.wiring, parameters });

    // The bootstrap's effect check: one real step must work before the loop starts.
    stack.coordinator.advanceSteps(1);
    stack.coordinator.reset();

    const loaded = stack.emulator.load(pumpExample('pump-selfhold'));
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(loaded.ok).toBe(true);

    const before = stack.coordinator.snapshot();
    expect(before.actuators.pump).toBe(false);
    expect(before.volAPct).toBe(PUMP_PARAM_DEFAULTS.initialVolAPct);
    expect(before.volBPct).toBe(PUMP_PARAM_DEFAULTS.initialVolBPct);

    // The 3D pedestal reports a press as (id, true) then (id, false); the host forwards it.
    const clock = new SimClock();
    clock.timeScale = 1;
    const advance = (realMs: number): void => {
      stack.coordinator.advanceSteps(clock.accumulate(realMs));
    };

    profile.parameters?.set('pumpRatePctS', 10);
    expect(stack.coordinator.params.pumpRatePctS).toBe(10);

    stack.coordinator.setButton('S1', true);
    advance(200);                                   // ≥ 1 scan while the button is held
    stack.coordinator.setButton('S1', false);
    expect(stack.coordinator.snapshot().actuators.pump).toBe(true);

    advance(1000);                                  // the self-hold must survive the release
    const running = stack.coordinator.snapshot();
    expect(running.actuators.pump).toBe(true);
    expect(running.volAPct).toBeLessThan(before.volAPct);
    expect(running.volBPct).toBeGreaterThan(before.volBPct);
    expect(running.flowPctS.pump).toBeGreaterThan(0);

    // S0 is the manual's stop condition — the pump must drop and stay down.
    stack.coordinator.setButton('S0', true);
    advance(200);
    stack.coordinator.setButton('S0', false);
    advance(500);
    const stopped = stack.coordinator.snapshot();
    expect(stopped.actuators.pump).toBe(false);
    expect(stopped.flowPctS.pump).toBe(0);

    // No runtime error anywhere in the run.
    expect((stack.coordinator.lastScan?.diagnostics ?? [])
      .filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('the profile subtracts the railway-only controls and adds the parameters tab', () => {
    const stack = createPumpStack();
    const profile = buildPumpProfile({
      wiring: stack.wiring,
      parameters: createPumpParameterHost(stack.coordinator, memoryStore()),
    });
    expect(profile.experiment).toBe('pump');
    expect(profile.showNotaus).toBe(false);
    expect(profile.showStartTrack).toBe(false);
    expect(profile.showDerailedChip).toBe(false);
    expect(profile.cameraModes).toEqual(['orbit']);
    expect(profile.tools).toEqual(['exercises', 'examples', 'parameters']);
    expect(profile.taskDoc).not.toBeNull();
    expect(profile.parameters).not.toBeNull();
    expect(profile.watchSections).not.toBeNull();
  });

  /** The watch table must cover every wired bit — a signal the student cannot observe is
   *  a signal the plant might as well not have. */
  it('the watch layout lists every wired input and output bit', () => {
    const stack = createPumpStack();
    const sections = buildPumpProfile({
      wiring: stack.wiring,
      parameters: createPumpParameterHost(stack.coordinator, memoryStore()),
    }).watchSections ?? [];
    const bits = new Set<string>();
    for (const section of sections) {
      for (const row of section.rows) {
        if (row.kind === 'bit') bits.add(`${row.address.area} ${row.address.byte}.${row.address.bit}`);
      }
    }
    for (const address of ['E 0.0', 'E 0.1', 'E 0.2', 'E 0.3', 'E 0.4', 'E 0.5', 'E 0.6',
                           'E 0.7', 'E 1.0', 'E 1.1', 'E 1.2', 'E 1.3', 'E 1.4', 'E 1.7',
                           'A 0.1', 'A 0.2', 'A 0.3']) {
      expect(bits.has(address), address).toBe(true);
    }
  });
});
