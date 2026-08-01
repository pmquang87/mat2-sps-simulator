/**
 * What the published consist path may and may not do when a switch moves (D16).
 *
 * The path is published from `OccupiedPath`, a stateful record of the track under the consist
 * (the deleted `TrackGraph.consistPath` used to re-walk the live graph on every snapshot and
 * resolve every node with the switches' CURRENT positions). Two readings of "current" are not
 * the same thing, and the difference is the whole defect:
 *
 *  - AHEAD of the train, and at spawn, the current positions are the right answer: the consist
 *    has no history there, and the track the train is about to occupy is whatever the switches
 *    are set to now (D12).
 *  - BEHIND the train, they are the wrong answer: a vehicle stands on the rail it stands on.
 *    Only motion may move it to another edge. Re-resolving the behind walk through a switch that
 *    has been thrown since the consist drove over it lifts the coaches onto the other branch
 *    between two rendered frames — the "cabins jump to other rails" the user reported.
 *
 * These pins are solution-free: they run on the `miniPlan` fixture, where the two branches are a
 * straight rail (eC, y = 0) and one that climbs away (eD), so "which rail is this sample on" is
 * answerable in millimetres against the fixture geometry rather than against renderer internals.
 * `mmPerUnit` is 1 there, so plan units are millimetres throughout.
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { ConsistPath, TrackplanFile, Vec2 } from '../../src/plant';
import { miniPlan } from './fixtures/miniplan';

/** The switch under test and the two rails it chooses between. */
const SWITCH_ID = 'xW01T';
const BRANCH_0 = 'eC';
const BRANCH_1 = 'eD';
/** Plan x of the switch node nSw — samples beyond it are past the switch. */
const NODE_X = 1000;
/** A sample is "on" an edge when it is this close to that edge's centre line, mm. */
const ON_EDGE_TOL_MM = 0.5;
/**
 * How far a vehicle reaches from the loco centre, mm: the drawn consist is 422 mm buffer to
 * buffer and the loco centre sits half a loco (56 mm) from its front one. Samples further out
 * than this carry no vehicle, and there the current switch state is the right answer (D12).
 */
const CONSIST_MM = 366;

/** Fahrstrom word for a level/direction, as `wordToTarget` reads it. */
function speedWord(level: 1 | 2 | 3, direction: 'IU' | 'GU'): number {
  return direction === 'IU' ? level : level | 0x0100;
}

function runToStop(plant: Plant): void {
  plant.setFahrstromWord(0);
  for (let i = 0; i < 600 && plant.snapshot().train.speedMmS > 0; i += 1) plant.step(10);
}

function distPointSegmentMm(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from a plan point to an edge's centre line, mm. */
function distToEdgeMm(plan: TrackplanFile, edgeId: string, p: Vec2): number {
  const edge = plan.edges.find((e) => e.id === edgeId);
  if (edge === undefined) throw new Error(`no edge ${edgeId} in fixture`);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < edge.pts.length; i += 1) {
    const d = distPointSegmentMm(p, edge.pts[i] as Vec2, edge.pts[i + 1] as Vec2);
    if (d < best) best = d;
  }
  return best;
}

/** The samples BEHIND the train (arc length < 0), in walk order. */
function behindSamples(path: ConsistPath): Vec2[] {
  return path.pts.filter((_, i) => path.startMm + i * path.stepMm < 0);
}

/** Largest point-to-point distance between two equally long sample lists, mm. */
function maxSampleShiftMm(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.length !== b.length) throw new Error(`sample count changed: ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    const p = a[i] as Vec2;
    const q = b[i] as Vec2;
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Drives the fixture train forward over the switch onto branch 0, then pushes it back through
 * the switch onto the toe edge and stops it there — the Rangierfahrt shape of the Gruppe A run.
 * Afterwards the consist straddles the switch: the loco is on the toe edge eB and its rear
 * reach extends past nSw onto eC, the rail the vehicles physically drove over.
 */
function straddlingTheSwitch(): Plant {
  const plant = new Plant({ trackplan: miniPlan() });

  plant.setFahrstromWord(speedWord(2, 'IU'));
  for (let i = 0; i < 2000; i += 1) {
    plant.step(10);
    const t = plant.snapshot().train;
    if (t.edgeId === BRANCH_0 && t.offsetMm > 200) break;
  }
  expect(plant.snapshot().train.edgeId, 'the train must reach branch 0').toBe(BRANCH_0);
  runToStop(plant);

  plant.setFahrstromWord(speedWord(2, 'GU'));
  for (let i = 0; i < 2000; i += 1) {
    plant.step(10);
    const t = plant.snapshot().train;
    if (t.edgeId === 'eB' && t.offsetMm < 620) break;
  }
  runToStop(plant);

  const t = plant.snapshot().train;
  expect(t.edgeId, 'the train must have pushed back onto the toe edge').toBe('eB');
  expect(t.speedMmS, 'the train must be standing still before the switch is thrown').toBe(0);
  return plant;
}

/** Pulses a coil and steps through the full 300 ms actuation. */
function throwSwitch(plant: Plant, coil: 'G' | 'R'): void {
  plant.setSwitchCoil(SWITCH_ID, coil, true);
  for (let i = 0; i < 40; i += 1) plant.step(10);
  plant.setSwitchCoil(SWITCH_ID, coil, false);
  plant.drainEvents();
}

function positionOf(plant: Plant): number {
  const sw = plant.snapshot().switches.find((s) => s.id === SWITCH_ID);
  if (sw === undefined) throw new Error(`no switch ${SWITCH_ID} in snapshot`);
  return sw.position;
}

describe('published consist path vs. switch state', () => {
  it('does not move the track behind the consist when a switch is thrown under it', () => {
    // D16: the coaches stand on eC. Throwing xW01T to eD must not move them — no vehicle has
    // moved, and a vehicle cannot change rails without moving.
    const plan = miniPlan();
    const plant = straddlingTheSwitch();
    expect(positionOf(plant), 'the switch must start on the rail the train drove over').toBe(0);

    const before = plant.snapshot().train.consistPath;
    const behindBefore = behindSamples(before);
    const pastNodeBefore = behindBefore.filter((p) => p.x > NODE_X);
    expect(
      pastNodeBefore.length,
      'the rear reach must actually cross the switch for this test to mean anything',
    ).toBeGreaterThan(20);
    for (const p of pastNodeBefore) {
      expect(distToEdgeMm(plan, BRANCH_0, p)).toBeLessThan(ON_EDGE_TOL_MM);
    }

    throwSwitch(plant, 'R');
    expect(positionOf(plant), 'the switch must actually have moved').toBe(1);
    expect(plant.snapshot().train.speedMmS, 'nothing may have moved the train').toBe(0);

    const after = plant.snapshot().train.consistPath;
    const behindAfter = behindSamples(after);
    const shifted = maxSampleShiftMm(behindBefore, behindAfter);
    const onBranch1 = behindAfter.filter(
      (p) => p.x > NODE_X && distToEdgeMm(plan, BRANCH_1, p) < ON_EDGE_TOL_MM,
    ).length;
    expect(
      shifted,
      `${onBranch1} of ${pastNodeBefore.length} samples behind the consist moved from ` +
        `${BRANCH_0} onto ${BRANCH_1} when the switch was thrown; worst sample moved ` +
        `${shifted.toFixed(1)} mm with the train standing still`,
    ).toBeLessThan(ON_EDGE_TOL_MM);
  });

  it('does not move the track the coaches lead onto when a switch is thrown under them', () => {
    // The same rule on the other side of the loco. After a stationary reversal the coaches LEAD,
    // so the track they stand on is at POSITIVE s — a fix that only freezes the rear half leaves
    // this red, and it is the Rangierfahrt half of the Gruppe A run.
    const plan = miniPlan();
    // seat the loco with its coaches on the switch side: travel sign −1, so −s points at nSw
    plan.start = { edgeId: 'eB', offsetMm: 900, direction: -1 };
    const plant = new Plant({ trackplan: plan });

    // one stationary reversal: +s rotates 180° and the coaches change side without moving
    plant.setFahrstromWord(speedWord(1, 'GU'));
    plant.step(10);
    runToStop(plant);
    expect(plant.snapshot().train.speedMmS, 'the train must be standing still').toBe(0);
    expect(positionOf(plant), 'the switch must start on the rail the coaches stand on').toBe(0);

    const before = plant.snapshot().train.consistPath;
    const underConsist = (path: ConsistPath): Vec2[] =>
      path.pts.filter((_, i) => {
        const s = path.startMm + i * path.stepMm;
        return s >= 0 && s <= CONSIST_MM;
      });
    const leadBefore = underConsist(before);
    const pastNode = leadBefore.filter((p) => p.x > NODE_X);
    expect(
      pastNode.length,
      'the coaches must actually lead across the switch — if they do not, the frame never flipped',
    ).toBeGreaterThan(20);
    for (const p of pastNode) expect(distToEdgeMm(plan, BRANCH_0, p)).toBeLessThan(ON_EDGE_TOL_MM);

    throwSwitch(plant, 'R');
    expect(positionOf(plant), 'the switch must actually have moved').toBe(1);
    expect(plant.snapshot().train.speedMmS, 'nothing may have moved the train').toBe(0);

    const leadAfter = underConsist(plant.snapshot().train.consistPath);
    const shifted = maxSampleShiftMm(leadBefore, leadAfter);
    const onBranch1 = leadAfter.filter(
      (p) => p.x > NODE_X && distToEdgeMm(plan, BRANCH_1, p) < ON_EDGE_TOL_MM,
    ).length;
    expect(
      shifted,
      `${onBranch1} of ${pastNode.length} samples under the leading coaches moved from ` +
        `${BRANCH_0} onto ${BRANCH_1} when the switch was thrown; worst sample moved ` +
        `${shifted.toFixed(1)} mm with the train standing still`,
    ).toBeLessThan(ON_EDGE_TOL_MM);
  });

  it('follows the current switch state ahead of the train at spawn (D12)', () => {
    // The other half of the contract, and the reason the walk exists at all: with no history,
    // the track in front of the consist is whatever the switches are set to now. Two fresh
    // plants, identical but for the switch's initial position, must lay their forward samples
    // on the two different branches.
    const build = (initial: 0 | 1): { plan: TrackplanFile; path: ConsistPath } => {
      const plan = miniPlan();
      plan.start = { edgeId: 'eB', offsetMm: 500, direction: 1 };
      const sw = plan.switches.find((s) => s.id === SWITCH_ID);
      if (sw === undefined) throw new Error('fixture lost its switch');
      sw.initialPosition = initial;
      return { plan, path: new Plant({ trackplan: plan }).snapshot().train.consistPath };
    };

    const a = build(0);
    const b = build(1);
    const past = (path: ConsistPath): Vec2[] =>
      path.pts.filter((p, i) => path.startMm + i * path.stepMm > 0 && p.x > NODE_X);

    const pastA = past(a.path);
    const pastB = past(b.path);
    expect(pastA.length, 'the forward reach must cross the switch').toBeGreaterThan(20);
    expect(pastB.length).toBe(pastA.length);
    for (const p of pastA) expect(distToEdgeMm(a.plan, BRANCH_0, p)).toBeLessThan(ON_EDGE_TOL_MM);
    for (const p of pastB) expect(distToEdgeMm(b.plan, BRANCH_1, p)).toBeLessThan(ON_EDGE_TOL_MM);
    // the branches diverge, so the two spawns must not agree
    expect(maxSampleShiftMm(pastA, pastB)).toBeGreaterThan(50);
  });

  it('reports a shift when the samples really differ (anti-vacuity control)', () => {
    // Without this, "nothing moved" could equally mean the comparator cannot report movement.
    const path = new Plant({ trackplan: miniPlan() }).snapshot().train.consistPath;
    const samples = behindSamples(path);
    expect(samples.length).toBeGreaterThan(20);
    expect(maxSampleShiftMm(samples, samples.map((p) => ({ ...p })))).toBe(0);
    const displaced = samples.map((p) => ({ x: p.x + 30, y: p.y + 40 }));
    expect(maxSampleShiftMm(samples, displaced)).toBeCloseTo(50, 6);
    expect(maxSampleShiftMm(samples, displaced)).toBeGreaterThan(ON_EDGE_TOL_MM);
  });
});
