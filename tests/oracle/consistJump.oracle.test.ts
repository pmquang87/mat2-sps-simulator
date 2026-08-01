/**
 * §9.4 regression: "cabins jump to other rails" (D16), reproduced from the actual Gruppe A
 * solution (reference/Claude_work/gruppeA.txt, gitignored, TEST TIME ONLY — skips cleanly when absent,
 * nothing is bundled or committed).
 *
 * What the user sees is a RENDERING teleport, not a plant one: the loco follows a continuous
 * route (pinned by gruppeAOnTrack.oracle.test.ts), but a coach appears on a neighbouring track
 * between two frames. This suite reproduces it end to end — real program, real plant, the real
 * `SceneManager.consistWorldPath` mapping, a real `TrainVisual` — and measures the one quantity
 * the user actually sees: how far each vehicle body moves between two consecutive plant steps.
 *
 * The metric is deliberately expressed in millimetres on the baseboard, not in renderer
 * internals. At the plant's fixed 10 ms step the fastest commanded speed (280 mm/s, §7.1 meta)
 * moves a vehicle 2,8 mm; a step above JUMP_MM is therefore not motion, it is a discontinuity.
 * Sampling every physics step rather than every scan cycle matters: a switch completes its
 * 300 ms actuation between two steps, so a coach re-routed by it moves within a single 10 ms
 * frame and a 50 ms sampler could average it away.
 *
 * `alphaMs` is 0 throughout, so the renderer's own inter-step smoothing contributes nothing —
 * every millimetre measured here comes from the published path.
 *
 * Since the D16 follow-up the run contains exactly ONE displacement above the threshold, and it is
 * named and bounded below rather than absorbed into the threshold: the record's one-time
 * re-resolution at `xW02BH3G2`. See `RERESOLVE_SWITCH`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus, SimCoordinator, buildWiring } from '../../src/app';
import { Emulator, SymbolTable } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import { Plant } from '../../src/plant';
import type { PlantSnapshot, SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';
import {
  MM,
  PlanFrame,
  buildTrain,
  createMaterials,
  type ConsistWorldPath,
} from '../../src/scene';
import expectationsJson from './expectations/gruppeA.json';
import { loadOracleSource, oracleAvailable } from './loadOracle';
import { ORACLE_SCAN_MS, ORACLE_SEED } from './scenarioRunner';

const realPlan = trackplanJson as unknown as TrackplanFile;
const expectations = expectationsJson as unknown as { bounceEnabled: boolean };

/** Physics step of the plant, ms (§5.2). */
const STEP_MS = 10;
/** Run to 150 s — the Gruppe A run ends long before, so the whole route is covered. */
const RUN_MS = 150_000;
/**
 * Discontinuity threshold, mm per 10 ms step. Top speed is 280 mm/s ⇒ 2,8 mm of legitimate
 * motion; 10 mm leaves a factor of 3,5 of headroom for acceleration and curvature.
 */
const JUMP_MM = 10;
/**
 * The ONE documented exception (`docs/REVIEW_SCENE.md` D16 Folgearbeit). When a switch completes
 * on track the loco has not crossed yet but is about to, `OccupiedPath.reresolveLead` re-walks the
 * record beyond that node, and the leading coach steps onto the branch it is going to travel. In
 * the Gruppe A Rangierfahrt that happens exactly once, at `xW02BH3G2`, and moves coach 2 by the
 * branch separation 86 mm past the frog. It is a correction, not a teleport: the alternative is
 * the whole drawn consist backing into BH3 Gleis 2 while the plant runs into Gleis 3 — 50,7 mm
 * wrong for 37 s, which is what the owner reported seeing.
 */
const RERESOLVE_SWITCH = 'xW02BH3G2';
const RERESOLVE_MM = 15;

const frame = PlanFrame.fromTrackplan(realPlan);

/** Exactly `SceneManager.consistWorldPath`: plan mm → world, board level. */
function worldPath(snapshot: PlantSnapshot): ConsistWorldPath {
  const cp = snapshot.train.consistPath;
  return {
    startMm: cp.startMm,
    stepMm: cp.stepMm,
    pts: cp.pts.map((p) => new Vector3(frame.x(p.x), 0, frame.z(p.y))),
  };
}

/** Straight-line distance between two world points, in baseboard mm. */
function distMm(a: Vector3, b: Vector3): number {
  return a.distanceTo(b) / MM;
}

interface Jump {
  step: number;
  /** Scan cycle (50 ms) the step falls in — the unit the user's reports are phrased in. */
  cycle: number;
  timeMs: number;
  vehicle: string;
  distMm: number;
  switchActivity: string;
}

interface JumpRun {
  jumps: Jump[];
  vehicles: string[];
  steps: number;
  /** Displacement samples actually taken — guards against a vacuous run. */
  samples: number;
  /** Largest single-step displacement per vehicle, mm. */
  maxMoveMm: number[];
  /** Largest single-step displacement of the PLANT's train position, mm. */
  maxPlantMoveMm: number;
  movingSamples: number;
}

/** Switches that changed position, or were commanded, inside one physics step. */
function switchActivity(
  prev: Map<string, number>,
  now: Map<string, number>,
  events: readonly SimEvent[],
): string {
  const parts: string[] = [];
  for (const [id, pos] of now) {
    const was = prev.get(id);
    if (was !== undefined && was !== pos) parts.push(`${id} ${was}→${pos}`);
  }
  for (const e of events) {
    if (e.type === 'switchPulse') parts.push(`pulse ${e.switchId}/${e.coil} ${e.durationMs}ms`);
    else if (e.type === 'switchMoved') parts.push(`moved ${e.switchId}→${e.position}`);
    else if (e.type === 'switchTrailed') parts.push(`trailed ${e.switchId}`);
    else if (e.type === 'switchMovedUnderTrain') parts.push(`underTrain ${e.switchId}`);
    else if (e.type === 'segmentEntered') parts.push(`entered ${e.edgeId}`);
  }
  return parts.length === 0 ? 'none' : parts.join(', ');
}

function positionsOf(snapshot: PlantSnapshot): Map<string, number> {
  return new Map(snapshot.switches.map((s) => [s.id, s.position as number]));
}

function runGruppeAConsist(): JumpRun {
  const source = loadOracleSource('A');
  if (source === null) throw new Error('oracle A vanished between skipIf and run');
  const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);
  const emulator = new Emulator(symbols);
  const load = emulator.load(source);
  if (!load.ok) throw new Error('oracle program failed to load');
  const plant = new Plant({
    trackplan: realPlan,
    seed: ORACLE_SEED,
    bounceEnabled: expectations.bounceEnabled,
  });
  const wiring = buildWiring(symbols, realPlan);
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

  const visual = buildTrain(createMaterials('low'), 'low');
  const plantPos = (snapshot: PlantSnapshot): Vector3 =>
    new Vector3(frame.x(snapshot.train.worldPos.x), 0, frame.z(snapshot.train.worldPos.y));
  const render = (snapshot: PlantSnapshot): Vector3[] => {
    const t = snapshot.train;
    visual.update({
      position: new Vector3(frame.x(t.worldPos.x), 0, frame.z(t.worldPos.y)),
      headingRad: t.headingRad,
      speedMmS: t.speedMmS,
      alphaMs: 0,
      hidden: false,
      derailed: false,
      path: worldPath(snapshot),
    });
    // y is a constant rail-top lift, identical every frame, so it cancels in the displacement.
    return visual.object.children.map((c) => c.position.clone());
  };

  let snapshot = coordinator.snapshot();
  let prev = render(snapshot);
  let prevPlant = plantPos(snapshot);
  let prevSwitches = positionsOf(snapshot);
  const vehicles = visual.object.children.map((c) => c.name);
  const jumps: Jump[] = [];
  let cursor = events.length;
  let samples = 0;
  const maxMoveMm = vehicles.map(() => 0);
  let maxPlantMoveMm = 0;
  let movingSamples = 0;

  const steps = RUN_MS / STEP_MS;
  for (let step = 1; step <= steps; step += 1) {
    coordinator.advanceSteps(1);
    snapshot = coordinator.snapshot();
    const now = render(snapshot);
    const nowPlant = plantPos(snapshot);
    const nowSwitches = positionsOf(snapshot);
    const stepEvents = events.slice(cursor);
    cursor = events.length;
    maxPlantMoveMm = Math.max(maxPlantMoveMm, distMm(nowPlant, prevPlant));
    for (let v = 0; v < now.length; v += 1) {
      const d = distMm(now[v] as Vector3, prev[v] as Vector3);
      samples += 1;
      if (d > (maxMoveMm[v] as number)) maxMoveMm[v] = d;
      if (d > 0.1) movingSamples += 1;
      if (d > JUMP_MM) {
        jumps.push({
          step,
          cycle: snapshot.timeMs / ORACLE_SCAN_MS,
          timeMs: snapshot.timeMs,
          vehicle: vehicles[v] ?? `#${v}`,
          distMm: d,
          switchActivity: switchActivity(prevSwitches, nowSwitches, stepEvents),
        });
      }
    }
    prev = now;
    prevPlant = nowPlant;
    prevSwitches = nowSwitches;
  }

  return { jumps, vehicles, steps, samples, maxMoveMm, maxPlantMoveMm, movingSamples };
}

function report(run: JumpRun): string {
  const head = run.jumps
    .slice(0, 5)
    .map(
      (j) =>
        `  cycle ${j.cycle.toFixed(1)} (t = ${(j.timeMs / 1000).toFixed(2)} s, step ${j.step}): ` +
        `${j.vehicle} moved ${j.distMm.toFixed(1)} mm in one 10 ms step — switches: ${j.switchActivity}`,
    )
    .join('\n');
  const worst = run.jumps.reduce((m, j) => Math.max(m, j.distMm), 0);
  const perVehicle = run.vehicles
    .map((name, v) => `${name} ${(run.maxMoveMm[v] as number).toFixed(1)}`)
    .join(', ');
  return (
    `${run.jumps.length} vehicle jumps > ${JUMP_MM} mm in ${run.samples} samples ` +
    `(worst ${worst.toFixed(1)} mm; largest step per vehicle: ${perVehicle} mm); first five:\n${head}`
  );
}

describe.skipIf(!oracleAvailable('A'))('Gruppe A: the consist never teleports (D16)', () => {
  let run: JumpRun;

  beforeAll(() => {
    run = runGruppeAConsist();
  });

  it('really renders the whole run with all three vehicles moving', () => {
    // Anti-vacuity: without this, "no jumps" could equally mean nothing was ever rendered.
    expect(run.steps).toBe(RUN_MS / STEP_MS);
    expect(run.vehicles).toEqual(['loco', 'coach1', 'coach2']);
    expect(run.samples).toBe(run.steps * 3);
    expect(run.movingSamples).toBeGreaterThan(10_000);
  });

  it('drives a continuous plant route the whole time', () => {
    // Separates the two candidate explanations. The PLANT's own train position never moves more
    // than one step of travel (280 mm/s × 10 ms = 2,8 mm), so whatever the next test catches is
    // introduced by the published path SAMPLES around the train, not by the physics.
    expect(run.maxPlantMoveMm).toBeLessThan(2.9);
  });

  it('moves no vehicle further than one step of travel between two steps', () => {
    // Everything except the single re-resolution correction named above. Keeping that one out by
    // NAME rather than by raising the threshold is the point: a second one, one on another
    // switch, or one on the loco all still fail here.
    const unexplained = run.jumps.filter(
      (j) => !(j.vehicle === 'coach2' && j.switchActivity.includes(`moved ${RERESOLVE_SWITCH}`)),
    );
    expect(unexplained.length, report(run)).toBe(0);
  });

  it('takes the documented re-resolution correction exactly once, and small', () => {
    expect(run.jumps.length, report(run)).toBe(1);
    const j = run.jumps[0] as Jump;
    expect(j.vehicle).toBe('coach2');
    expect(j.switchActivity).toContain(`moved ${RERESOLVE_SWITCH}`);
    expect(j.distMm, report(run)).toBeLessThan(RERESOLVE_MM);
    // the loco and the leading coach never take it — the record is re-walked from the node
    // outward, so only what lies BEYOND the node moves
    expect(run.maxMoveMm[0], `loco max step ${(run.maxMoveMm[0] as number).toFixed(2)} mm`)
      .toBeLessThan(2.9);
    expect(run.maxMoveMm[1], `coach1 max step ${(run.maxMoveMm[1] as number).toFixed(2)} mm`)
      .toBeLessThan(2.9);
  });

  it('reports a jump when a vehicle really is displaced (anti-vacuity control)', () => {
    // Proves the metric can fail: the same distance function on a deliberately moved point.
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(50 * MM, 0, 0);
    expect(distMm(a, b)).toBeCloseTo(50, 6);
    expect(distMm(a, b)).toBeGreaterThan(JUMP_MM);
    expect(distMm(a, a.clone())).toBe(0);
  });
});
