/**
 * §9.4 oracle, student-facing branch: the `exercises.json` BehaviorChecks are what a
 * student sees when clicking "Run checks" (§10.1) — the other two oracle files assert the
 * task-derived event tables in `expectations/*.json`, which is a DIFFERENT set of
 * assertions. A check whose pattern is subtly wrong therefore stays invisible: the sim is
 * right, the expectations are right, and yet a correct solution is reported as failing.
 *
 * This file closes that gap. For every network of both groups it replays the local
 * solution (`reference/Claude_work/`, TEST TIME ONLY, skipped when absent) through exactly the
 * pipeline `main.ts#runChecks` uses — fresh Emulator + Plant per network, seed 1,
 * scan 50 ms, the exercise's `bounceEnabled`, the network's own `scenario`, finalized at
 * `runTimeoutMs` — and requires every check to end in `pass`. `pending`/`notExercised`
 * count as failures here: with the reference solution loaded, a check that never triggers
 * is an unreachable check.
 */
import { describe, expect, it } from 'vitest';
import { EventBus, SimCoordinator, buildWiring } from '../../src/app';
import { Emulator, SymbolTable } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import { BehaviorChecker, loadExercises, runTimeoutMsOf } from '../../src/pedagogy';
import type { CheckResult, ExerciseSpec } from '../../src/pedagogy';
import { Plant } from '../../src/plant';
import type { TrackplanFile } from '../../src/plant';
import exercisesJson from '../../src/data/exercises.json';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';
import { loadOracleSource, oracleAvailable } from './loadOracle';

/** Same per-exercise start override main.ts applies (ARCHITECTURE.md §7.1 deviation note). */
interface StartSpec { edgeId: string; offsetMm: number; direction: 1 | -1; }

function planForExercise(exerciseId: string): TrackplanFile {
  const plan = trackplanJson as unknown as TrackplanFile;
  const extras = plan as unknown as { exerciseStarts?: Record<string, StartSpec> };
  const start = extras.exerciseStarts?.[exerciseId];
  if (start === undefined) return plan;
  const clone = JSON.parse(JSON.stringify(plan)) as TrackplanFile & { start: StartSpec };
  clone.start = { edgeId: start.edgeId, offsetMm: start.offsetMm, direction: start.direction };
  return clone;
}

function exerciseById(id: string): ExerciseSpec {
  const exercise = loadExercises(exercisesJson).find((e) => e.id === id);
  if (exercise === undefined) throw new Error(`exercises.json has no exercise "${id}"`);
  return exercise;
}

/** One headless check run, byte-for-byte the pipeline of `main.ts#runChecks`. */
function runNetworkChecks(exercise: ExerciseSpec, networkId: string, source: string): CheckResult[] {
  const network = exercise.networks.find((n) => n.id === networkId);
  if (network === undefined) throw new Error(`no network "${networkId}"`);

  const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);
  const emulator = new Emulator(symbols);
  const load = emulator.load(source);
  if (!load.ok) {
    const errors = load.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.code} @${d.line}:${d.col} ${d.message.en}`)
      .join('; ');
    throw new Error(`oracle program failed to load: ${errors}`);
  }

  const plan = planForExercise(exercise.id);
  const plant = new Plant({ trackplan: plan, seed: 1, bounceEnabled: exercise.bounceEnabled });
  const wiring = buildWiring(symbols, plan);
  const bus = new EventBus();
  const checker = new BehaviorChecker(network.checks);
  bus.on((e) => checker.onEvent(e));
  const coordinator = new SimCoordinator(emulator, plant, wiring, bus,
                                         { scanIntervalMs: 50, seed: 1 });
  coordinator.loadScenario(network.scenario ?? []);
  const timeoutMs = runTimeoutMsOf(network);
  coordinator.advanceSteps(Math.ceil(timeoutMs / 10));
  return [...checker.finalize(timeoutMs)];
}

function report(results: readonly CheckResult[]): string {
  return results
    .filter((r) => r.status !== 'pass')
    .map((r) => `${r.checkId}: ${r.status} — ${r.detail?.en ?? '(no detail)'}`)
    .join('\n');
}

for (const [group, exerciseId] of [['A', 'gruppeA'], ['B', 'gruppeB']] as const) {
  describe.skipIf(!oracleAvailable(group))(
    `Gruppe ${group} exercise checks (§9.4/§10.1)`,
    () => {
      const exercise = exerciseById(exerciseId);
      const source = oracleAvailable(group) ? loadOracleSource(group) : null;

      it('defines at least one check per network', () => {
        for (const network of exercise.networks) {
          expect(network.checks.length, `${network.id} has no checks`).toBeGreaterThan(0);
        }
      });

      for (const network of exercise.networks) {
        it(`${network.id}: every check passes for the reference solution`, () => {
          if (source === null) throw new Error(`oracle ${group} vanished between skipIf and run`);
          const results = runNetworkChecks(exercise, network.id, source);
          expect(results.length).toBe(network.checks.length);
          expect(report(results), `${network.id} check failures:\n${report(results)}`).toBe('');
        }, 60_000);
      }
    },
  );
}
