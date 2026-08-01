/**
 * Â§9.4 measurement suite for the D16 follow-up question: may a switch complete its 300 ms
 * actuation while its node lies under a drawn COACH? (`docs/REVIEW_SCENE.md` D16 Folgearbeit.)
 *
 * It answers that with two metrics on the real Gruppe A run (reference/Claude_work/gruppeA.txt, gitignored,
 * TEST TIME ONLY â€” skips cleanly when absent):
 *
 *  1. **Drawn-loco lag** â€” how far the RENDERED loco body sits from the loco position the plant
 *     publishes. That was the visible symptom: when a switch completes under a coach, the coaches
 *     keep their rail (D16) while the loco later takes the new branch, so no single polyline
 *     describes the consist and a loco read off that polyline ran beside its true position until
 *     the routes rejoined. `trainMesh.ts` now anchors the loco's position to `worldPos`, so the
 *     lag is structurally zero; the second test here is the A/B that proves it, measuring the
 *     OLD path-anchored placement on the same run as its control.
 *  2. **Footprint census** â€” for every switch actuation in the run, which drawn vehicle (if any)
 *     covers the switch node while the blades travel, and how far along the published path that
 *     node lies from the loco centre.
 *
 * The census is the evidence that the obvious fix is not available. Three actuations in the run
 * complete with their node inside coach 2, and the two that decide the question are 2,4 mm apart
 * in that same vehicle:
 *
 *   xW01D/n1      completes t = 55,89 s, node 259,0 mm from the loco centre, 40,5 mm into coach 2
 *   xW02BH3G2/n69 completes t = 69,04 s, node 261,4 mm from the loco centre, 43,4 mm into coach 2
 *
 * The second causes the tear. The FIRST is one the solution depends on: A-NW8 commands `xW01D G`
 * so that the reversed facing move `toe(e39) â†’ e38` retraces the very branch the record froze on
 * the way in. A consist-footprint occupancy rule cannot block the second without blocking the
 * first â€” the first node is CLOSER to the loco. Measured: blocking both sends the loco onto `e0`
 * instead of `e38` at t = 59,19 s, the Gruppe A run never completes, and the drawn-loco lag got
 * WORSE (50,7 â†’ 151,4 mm, 5 vehicle jumps, worst 443,8 mm). That is why the tear is still there
 * in the plant and is handled where it belongs, in the renderer.
 *
 * Both metrics are in millimetres on the baseboard, `alphaMs` is 0 throughout, and every sample
 * comes from the published snapshot plus the real `TrainVisual` â€” no renderer internals.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { EventBus, SimCoordinator, buildWiring } from '../../src/app';
import { Emulator, SymbolTable } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import { Plant } from '../../src/plant';
import type { PlantSnapshot, TrackplanFile, Vec2 } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';
import { DIM, MM, PlanFrame, buildTrain, createMaterials } from '../../src/scene';
import expectationsJson from './expectations/gruppeA.json';
import { loadOracleSource, oracleAvailable } from './loadOracle';
import { ORACLE_SCAN_MS, ORACLE_SEED } from './scenarioRunner';

const realPlan = trackplanJson as unknown as TrackplanFile;
const expectations = expectationsJson as unknown as { bounceEnabled: boolean; exerciseId: string };
const frame = PlanFrame.fromTrackplan(realPlan);
const MM_PER_UNIT = realPlan.meta.mmPerUnit;

/** Physics step, ms (Â§5.2). */
const STEP_MS = 10;
/** 150 s covers the whole Gruppe A route incl. the 72â€“110 s stretch the lag lives in. */
const RUN_MS = 150_000;
/**
 * Lag above which the drawn loco is visibly beside its own track, mm. A TT rail head is 1,6 mm
 * wide and the gauge is 12 mm, so 15 mm is about one loco width off â€” the threshold the follow-up
 * brief asked the lag to be pinned under.
 */
const LAG_VISIBLE_MM = 15;
/**
 * Bound for the drawn-loco lag, mm, at the snapshot instant this suite renders at
 * (`alphaMs` = 0). The loco is anchored to `worldPos`, so there the lag is exactly 0 and only a
 * defect can fill this budget. Between steps the whole consist slides by the same `alphaMm`, so
 * the lag there is the smoothing advance and nothing else: measured 0,000 mm at `alphaMs` 0,
 * 2,24 mm at 8, 4,48 mm at 16 — exactly 280 mm/s × `alphaMs`.
 */
const LAG_BOUND_MM = 3;
/** A projected point further than this from the published path is not on it, mm. */
const ON_PATH_TOL_MM = 8;
/**
 * The owner-visible property of the Gruppe A Rangierfahrt: the plant backs the train into BH3
 * Gleis 3 (`e74`, reached over `e76`), and the drawn train must go there too. Before the record
 * re-resolution the drawn loco stood on `e70` â€” Gleis 2, the platform road next door â€” which is
 * what the owner reported seeing in the 3D view.
 */
const RANGIER_ROAD = 'e74';
const RANGIER_WRONG_ROAD = 'e70';
/** Trigger reed for the halt that ends the backing move. */
const RANGIER_REED = 'xR02BH3G3';

const NODE_PT = new Map<string, Vec2>(realPlan.nodes.map((n) => [n.id, n.pt]));

interface Vehicle {
  name: string;
  halfLengthMm: number;
}
/** The drawn consist, in the order `TrainVisual` adds its children. */
const VEHICLES: Vehicle[] = [
  { name: 'loco', halfLengthMm: DIM.locoLength / 2 },
  { name: 'coach1', halfLengthMm: DIM.coachLength / 2 },
  { name: 'coach2', halfLengthMm: DIM.coachLength / 2 },
];
/** Arc-length offsets `TrainVisual` places the coaches at, mm from the loco centre. */
const COACH1_OFFSET_MM = DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2;
const COACH2_OFFSET_MM = COACH1_OFFSET_MM + DIM.coachLength + DIM.coupling;

/** Arc length (mm) and perpendicular offset (mm) of a plan point projected on the published path. */
interface OnPath {
  sMm: number;
  perpMm: number;
}

/**
 * Projects a plan-space point onto the published consist path. The path is a polyline of samples
 * at known arc lengths, so the projection interpolates WITHIN the closest segment â€” the 4 mm
 * sample spacing would otherwise be far too coarse for the 2 mm question this suite asks.
 */
function projectOnPath(path: PlantSnapshot['train']['consistPath'], p: Vec2): OnPath {
  let best: OnPath = { sMm: 0, perpMm: Number.POSITIVE_INFINITY };
  for (let i = 0; i + 1 < path.pts.length; i += 1) {
    const a = path.pts[i] as Vec2;
    const b = path.pts[i + 1] as Vec2;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const perp = Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)) * MM_PER_UNIT;
    if (perp < best.perpMm) {
      best = { sMm: path.startMm + (i + t) * path.stepMm, perpMm: perp };
    }
  }
  return best;
}

/** Distance from a plan point to an edge's centre line, mm. */
function edgeDistMm(edgeId: string, p: Vec2): number {
  const e = realPlan.edges.find((x) => x.id === edgeId);
  if (e === undefined) throw new Error(`no edge ${edgeId} in the trackplan`);
  const pts = e.pts as readonly Vec2[];
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i] as Vec2;
    const b = pts[i + 1] as Vec2;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)));
  }
  return best * MM_PER_UNIT;
}

/** Plan point at arc length `s` on the published path â€” `TrainVisual.pointAt`, in plan space. */
function pathPointAt(path: PlantSnapshot['train']['consistPath'], s: number): Vec2 {
  const n = path.pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return path.pts[0] as Vec2;
  const raw = (s - path.startMm) / path.stepMm;
  const i = Math.min(n - 2, Math.max(0, Math.floor(raw)));
  const t = Math.min(1, Math.max(0, raw - i));
  const a = path.pts[i] as Vec2;
  const b = path.pts[i + 1] as Vec2;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** One switch actuation, sampled at the last physics step on which the blades were still moving. */
interface Actuation {
  switchId: string;
  nodeId: string;
  startMs: number;
  endMs: number;
  /** signed arc length loco â†’ node on the published path at that last step, mm */
  sMm: number;
  perpMm: number;
  /** which drawn vehicle body covers the node there, or null */
  cover: string | null;
  /** how far the node is INSIDE that body (negative = clear of every body), mm */
  intoBodyMm: number;
}

interface Run {
  steps: number;
  movingSamples: number;
  worstLagMm: number;
  worstLagAtMs: number;
  stepsAboveVisible: number;
  /** The same lag for the OLD placement â€” loco read off the path at s = 0. Control. */
  worstPathLagMm: number;
  pathStepsAboveBound: number;
  /** Where every drawn vehicle stands when the backing move ends, mm from each platform road. */
  rangier: { timeMs: number; toRoad: number[]; toWrongRoad: number[] } | null;
  /** sanity: a drawn coach projects back onto the path at its own known offset, mm of error */
  worstCoachSErrMm: number;
  actuations: Actuation[];
}

function runGruppeA(): Run {
  const source = loadOracleSource('A');
  if (source === null) throw new Error('oracle A vanished between skipIf and run');
  const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);
  const emulator = new Emulator(symbols);
  const load = emulator.load(source);
  if (!load.ok) throw new Error('oracle program failed to load');

  const starts = (realPlan as unknown as {
    exerciseStarts?: Record<string, { edgeId: string; offsetMm: number; direction: 1 | -1 }>;
  }).exerciseStarts;
  const start = starts?.[expectations.exerciseId];
  const plan = JSON.parse(JSON.stringify(realPlan)) as TrackplanFile;
  if (start !== undefined) plan.start = { ...start };

  const plant = new Plant({
    trackplan: plan,
    seed: ORACLE_SEED,
    bounceEnabled: expectations.bounceEnabled,
  });
  const bus = new EventBus();
  let sawRangierReed = false;
  bus.on((e) => {
    if (e.type === 'reedClosed' && e.reedId === RANGIER_REED) sawRangierReed = true;
  });
  const coordinator = new SimCoordinator(emulator, plant, buildWiring(symbols, plan), bus, {
    scanIntervalMs: ORACLE_SCAN_MS,
  });
  coordinator.loadScenario([
    { atMs: 0, action: 'notaus', active: true },
    { atMs: 2_000, action: 'notaus', active: false },
  ]);

  const visual = buildTrain(createMaterials('low'), 'low');
  const render = (snapshot: PlantSnapshot): Vector3[] => {
    const t = snapshot.train;
    const cp = t.consistPath;
    visual.update({
      position: new Vector3(frame.x(t.worldPos.x), 0, frame.z(t.worldPos.y)),
      headingRad: t.headingRad,
      speedMmS: t.speedMmS,
      alphaMs: 0,
      hidden: false,
      derailed: false,
      path: {
        startMm: cp.startMm,
        stepMm: cp.stepMm,
        pts: cp.pts.map((p) => new Vector3(frame.x(p.x), 0, frame.z(p.y))),
      },
    });
    return visual.object.children.map((c) => c.position.clone());
  };

  const nodeOfSwitch = new Map(plan.switches.map((sw) => [sw.id, sw.nodeId]));
  const out: Run = {
    steps: 0,
    movingSamples: 0,
    worstLagMm: 0,
    worstLagAtMs: 0,
    stepsAboveVisible: 0,
    worstPathLagMm: 0,
    pathStepsAboveBound: 0,
    rangier: null,
    worstCoachSErrMm: 0,
    actuations: [],
  };
  const openMs = new Map<string, number>();
  const lastSample = new Map<string, Actuation>();
  let prev = render(coordinator.snapshot());

  for (let step = 1; step <= RUN_MS / STEP_MS; step += 1) {
    coordinator.advanceSteps(1);
    const snapshot = coordinator.snapshot();
    const drawn = render(snapshot);
    out.steps += 1;

    const truth = new Vector3(
      frame.x(snapshot.train.worldPos.x),
      0,
      frame.z(snapshot.train.worldPos.y),
    );
    const loco = (drawn[0] as Vector3).clone();
    loco.y = 0;                                  // the rail-top lift is not a lag
    const lagMm = loco.distanceTo(truth) / MM;
    if (lagMm > out.worstLagMm) {
      out.worstLagMm = lagMm;
      out.worstLagAtMs = snapshot.timeMs;
    }
    if (lagMm > LAG_VISIBLE_MM) out.stepsAboveVisible += 1;

    // Control, same run, same metric, only the anchor differs: where `trainMesh` USED to read the
    // loco â€” the midpoint of the path samples 0,75 Â· half a loco either side of s = 0. That
    // midpoint is symmetric in the nose sign, so it needs no knowledge of which side the coaches
    // are on this frame.
    const probeMm = 0.75 * (DIM.locoLength / 2);
    const cp = snapshot.train.consistPath;
    const fore = pathPointAt(cp, probeMm);
    const aft = pathPointAt(cp, -probeMm);
    const pathLagMm =
      Math.hypot(
        (fore.x + aft.x) / 2 - snapshot.train.worldPos.x,
        (fore.y + aft.y) / 2 - snapshot.train.worldPos.y,
      ) * MM_PER_UNIT;
    out.worstPathLagMm = Math.max(out.worstPathLagMm, pathLagMm);
    if (pathLagMm > LAG_BOUND_MM) out.pathStepsAboveBound += 1;

    // The owner-visible question, sampled where the owner looked: the train standing still at the
    // end of the backing move. Distances from every DRAWN vehicle to the two platform roads.
    if (sawRangierReed && out.rangier === null && snapshot.train.speedMmS === 0) {
      const planPts = drawn.map((p) => ({ x: frame.planX(p.x), y: frame.planY(p.z) }));
      out.rangier = {
        timeMs: snapshot.timeMs,
        toRoad: planPts.map((p) => edgeDistMm(RANGIER_ROAD, p)),
        toWrongRoad: planPts.map((p) => edgeDistMm(RANGIER_WRONG_ROAD, p)),
      };
    }
    for (let v = 0; v < drawn.length; v += 1) {
      if ((drawn[v] as Vector3).distanceTo(prev[v] as Vector3) / MM > 0.1) out.movingSamples += 1;
    }
    prev = drawn;

    const moving = snapshot.switches.filter((sw) => sw.moving);
    if (moving.length === 0) {
      for (const [id, rec] of lastSample) {
        out.actuations.push(rec);
        lastSample.delete(id);
        openMs.delete(id);
      }
      continue;
    }
    // Vehicle centres in the path's own arc-length frame. The loco IS that frame's origin by
    // construction (`ConsistPath` measures from the plant's train position), and it is no longer
    // drawn on the path at all, so projecting it back would measure the anchor, not the census.
    // The coaches ARE path-placed, so they are projected — and how far their projection lands
    // from their known offset is this suite's check that the projection works at all.
    const vehicleS = drawn.map((p, i) => {
      if (i === 0) return 0;
      const q = p.clone();
      q.y = 0;
      return projectOnPath(snapshot.train.consistPath, {
        x: frame.planX(q.x),
        y: frame.planY(q.z),
      }).sMm;
    });
    for (let v = 1; v < VEHICLES.length; v += 1) {
      const wanted = v === 1 ? COACH1_OFFSET_MM : COACH2_OFFSET_MM;
      const err = Math.abs(Math.abs(vehicleS[v] as number) - wanted);
      out.worstCoachSErrMm = Math.max(out.worstCoachSErrMm, err);
    }

    for (const sw of moving) {
      if (!openMs.has(sw.id)) openMs.set(sw.id, snapshot.timeMs);
      const nodeId = nodeOfSwitch.get(sw.id) as string;
      const pt = NODE_PT.get(nodeId);
      if (pt === undefined) continue;
      const on = projectOnPath(snapshot.train.consistPath, pt);
      let cover: string | null = null;
      let intoBody = Number.NEGATIVE_INFINITY;
      if (on.perpMm <= ON_PATH_TOL_MM) {
        for (let v = 0; v < VEHICLES.length; v += 1) {
          const veh = VEHICLES[v] as Vehicle;
          const into = veh.halfLengthMm - Math.abs(on.sMm - (vehicleS[v] as number));
          if (into > intoBody) {
            intoBody = into;
            if (into >= 0) cover = veh.name;
          }
        }
      }
      lastSample.set(sw.id, {
        switchId: sw.id,
        nodeId,
        startMs: openMs.get(sw.id) as number,
        endMs: snapshot.timeMs,
        sMm: on.sMm,
        perpMm: on.perpMm,
        cover,
        intoBodyMm: intoBody,
      });
    }
    for (const [id, rec] of lastSample) {
      if (!moving.some((sw) => sw.id === id)) {
        out.actuations.push(rec);
        lastSample.delete(id);
        openMs.delete(id);
      }
    }
  }
  for (const rec of lastSample.values()) out.actuations.push(rec);
  return out;
}

function census(run: Run): string {
  return run.actuations
    .filter((a) => a.cover !== null)
    .map(
      (a) =>
        `${a.switchId}/${a.nodeId} completing at t = ${(a.endMs / 1000).toFixed(2)} s: ` +
        `node ${a.sMm.toFixed(1)} mm along the path from the loco centre, ` +
        `${a.intoBodyMm.toFixed(1)} mm inside ${a.cover ?? 'â€”'}`,
    )
    .join('\n  ');
}

describe.skipIf(!oracleAvailable('A'))('Gruppe A: consist footprint vs switch actuation', () => {
  let run: Run;

  beforeAll(() => {
    run = runGruppeA();
  });

  it('really renders and measures the whole run (anti-vacuity)', () => {
    expect(run.steps).toBe(RUN_MS / STEP_MS);
    expect(run.movingSamples).toBeGreaterThan(10_000);
    expect(run.actuations.length).toBeGreaterThan(20);
    // the projection is sane: a drawn coach lands back on its own arc-length offset
    expect(run.worstCoachSErrMm).toBeLessThan(2);
  });

  it('draws the loco on its published position for every step of the run', () => {
    // The anchor (`trainMesh.anchorLoco`): the drawn loco IS the plant's loco, tear or no tear.
    expect(
      run.worstLagMm,
      `drawn loco worst ${run.worstLagMm.toFixed(3)} mm from its published position ` +
        `(at t = ${(run.worstLagAtMs / 1000).toFixed(2)} s), ` +
        `${((run.stepsAboveVisible * STEP_MS) / 1000).toFixed(1)} s of the run above ` +
        `${LAG_VISIBLE_MM} mm`,
    ).toBeLessThan(LAG_BOUND_MM);
    expect(run.stepsAboveVisible).toBe(0);
  });

  it('backs the whole drawn consist into BH3 Gleis 3, the road the plant drives into', () => {
    // The owner's report, as a measurement: "the drawn train backs into Gleis 2 while the plant
    // runs into Gleis 3". Every drawn vehicle must end the backing move nearer e74 than e70.
    const r = run.rangier;
    expect(r, 'the backing move must actually have been sampled').not.toBeNull();
    if (r === null) return;
    const lines = VEHICLES.map(
      (v, i) =>
        `${v.name}: ${(r.toRoad[i] as number).toFixed(1)} mm from ${RANGIER_ROAD} vs ` +
        `${(r.toWrongRoad[i] as number).toFixed(1)} mm from ${RANGIER_WRONG_ROAD}`,
    ).join('; ');
    for (let i = 0; i < VEHICLES.length; i += 1) {
      expect(r.toRoad[i] as number, `at t = ${(r.timeMs / 1000).toFixed(2)} s â€” ${lines}`)
        .toBeLessThan(r.toWrongRoad[i] as number);
    }
    // and not merely nearer: on the road. Half the ballast width is ~31 mm; the rear coach
    // stands on the curve into it, so 60 mm is the bound that still separates the two roads.
    for (let i = 0; i < VEHICLES.length; i += 1) {
      expect(r.toRoad[i] as number, lines).toBeLessThan(60);
    }
  });

  it('the road metric can report the wrong road (anti-vacuity control)', () => {
    // Without this, "nearer e74" could equally mean the two roads are indistinguishable to the
    // metric. A point taken from e70's own centre line must come back as e70, by a wide margin â€”
    // which is what the drawn loco measured before the record re-resolution (0,0 mm from e70,
    // 50,0 mm from e74 at t = 88,39 s; see docs/REVIEW_SCENE.md).
    const wrong = realPlan.edges.find((e) => e.id === RANGIER_WRONG_ROAD);
    expect(wrong).toBeDefined();
    if (wrong === undefined) return;
    const p = (wrong.pts as readonly Vec2[])[Math.floor(wrong.pts.length / 2)] as Vec2;
    expect(edgeDistMm(RANGIER_WRONG_ROAD, p)).toBeCloseTo(0, 6);
    expect(edgeDistMm(RANGIER_ROAD, p)).toBeGreaterThan(30);
  });

  it('the OLD path-anchored loco fails the same pin on the same run (A/B control)', () => {
    // Without this the pin above could pass because the metric cannot report a lag at all. Same
    // snapshots, same distance function â€” only the anchor differs: the loco read off the path at
    // s = 0, which is where it came from. Even with the record re-resolved it stays measurably
    // off, because that midpoint of two samples 84 mm apart cuts every curve: 8,1 mm on the
    // tightest one (R = 90,9 mm â‡’ sagitta 10,3 mm), 25,3 s of the run beyond the bound. That is
    // the residual the anchor exists for; the tear it also removed was 50,7 mm before the record
    // re-resolution (see docs/REVIEW_SCENE.md).
    expect(
      run.worstPathLagMm,
      `path-anchored loco worst ${run.worstPathLagMm.toFixed(1)} mm, ` +
        `${((run.pathStepsAboveBound * STEP_MS) / 1000).toFixed(1)} s above ${LAG_BOUND_MM} mm`,
    ).toBeGreaterThan(LAG_BOUND_MM);
    expect(run.worstPathLagMm).toBeGreaterThan(5);
    expect(run.pathStepsAboveBound).toBeGreaterThan(1_000);
    // the metric itself, on two points a known distance apart
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(50 * MM, 0, 0);
    expect(a.distanceTo(b) / MM).toBeCloseTo(50, 6);
    expect(a.distanceTo(a.clone()) / MM).toBe(0);
  });

  it('finds switch actuations both under a coach and clear of every vehicle (control)', () => {
    // Without the second half, "covered" could be the only answer the census can give.
    const covered = run.actuations.filter((a) => a.cover !== null);
    const clear = run.actuations.filter((a) => a.cover === null);
    expect(covered.length, census(run)).toBe(3);
    expect(clear.length).toBeGreaterThan(10);
  });

  it('completes two actuations under coach 2, and no footprint can separate them', () => {
    // THE finding. `xW02BH3G2` is the one that produces the lag; `xW01D` is the one A-NW8 needs
    // (its G branch e38 is the branch the record froze on the way in, so the reversed facing move
    // retraces its own recorded track). Any occupancy window wide enough to block the first also
    // blocks the second, because the second node is CLOSER to the loco.
    const underCoach2 = run.actuations.filter((a) => a.cover === 'coach2');
    const ids = underCoach2.map((a) => a.switchId);
    expect(ids, census(run)).toContain('xW02BH3G2');
    expect(ids, census(run)).toContain('xW01D');

    const tear = underCoach2.find((a) => a.switchId === 'xW02BH3G2' && a.endMs < 100_000);
    const needed = underCoach2.find((a) => a.switchId === 'xW01D');
    expect(tear).toBeDefined();
    expect(needed).toBeDefined();
    if (tear === undefined || needed === undefined) return;

    const dTear = Math.abs(tear.sMm);
    const dNeeded = Math.abs(needed.sMm);
    const message =
      `tear switch ${tear.switchId} at ${dTear.toFixed(1)} mm from the loco, ` +
      `needed switch ${needed.switchId} at ${dNeeded.toFixed(1)} mm â€” ` +
      `a footprint blocking the first must be â‰¥ ${dTear.toFixed(1)} mm and then also blocks ` +
      `the second`;
    expect(dNeeded, message).toBeLessThan(dTear);
    expect(dTear - dNeeded, message).toBeLessThan(5);
  });
});


