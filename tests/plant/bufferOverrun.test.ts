/**
 * §9.2 bufferOverrun.test.ts — the buffer (Prellbock) hard stop under the worst case: full
 * speed straight into a degree-1 node, from BOTH travel senses.
 *
 * The Anleitung warns there is no precise braking at model scale ("kein zielgenaues
 * Bremsen"), so an overrun attempt is normal operation, not an error case: in the step that
 * reaches the node the integrator wants to place the train PAST the edge end. §5.3 requires
 * a hard stop with one `bufferHit`; this suite pins that the offset lands exactly on the
 * edge end (never beyond), the train stays there while the command still pushes into the
 * buffer, and it can be reversed away afterwards.
 *
 * tests/plant/plant.test.ts already covers the facade-level event shape for the +1 sense;
 * what is new here is the −1 sense (buffer at an edge's `from` end), the exact clamp under a
 * step that overshoots, and every buffer of the real trackplan.
 */
import { describe, expect, it } from 'vitest';
import { Plant, TrackGraph } from '../../src/plant';
import type { SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import { miniPlan } from './fixtures/miniplan';
import { onTrackChecker } from './support/onTrack';

const realPlan = trackplanJson as unknown as TrackplanFile;

const IU3 = 3;
const GU3 = 0x103;

interface HitReport {
  events: SimEvent[];
  /** offset in the step BEFORE the buffer step (proof the step really overshot) */
  offsetBeforeMm: number;
  offsetAtHitMm: number;
  speedBeforeMm: number;
  hitStep: number;
}

/**
 * Drives `plan` from its start at full speed until the buffer stops the train, checking the
 * §5.3 position invariant after every step. Returns the state on the scans either side.
 */
function driveIntoBuffer(plan: TrackplanFile, label: string, maxSteps = 600): HitReport {
  const plant = new Plant({ trackplan: plan });
  const { check } = onTrackChecker(plan);
  const events: SimEvent[] = [];
  plant.setFahrstromWord(IU3);          // IU == the start direction sign (§5.3)
  let offsetBeforeMm = plant.snapshot().train.offsetMm;
  let speedBeforeMm = 0;
  let hitStep = -1;
  for (let step = 1; step <= maxSteps && hitStep < 0; step++) {
    const before = plant.snapshot().train;
    plant.step(10);
    check(plant.snapshot(), `${label} step ${step}`);
    const drained = plant.drainEvents();
    events.push(...drained);
    if (drained.some((e) => e.type === 'bufferHit')) {
      hitStep = step;
      offsetBeforeMm = before.offsetMm;
      speedBeforeMm = before.speedMmS;
    }
  }
  expect(hitStep, `${label}: no bufferHit within ${maxSteps} steps`).toBeGreaterThan(0);
  const at = plant.snapshot().train;

  // still pushing into the buffer: no motion, no repeat event, invariant still holds
  for (let step = 1; step <= 200; step++) {
    plant.step(10);
    check(plant.snapshot(), `${label} held ${step}`);
    const held = plant.drainEvents();
    expect(held.filter((e) => e.type === 'bufferHit'), `${label}: repeated bufferHit`).toEqual([]);
    expect(held.filter((e) => e.type === 'trainStarted'), `${label}: restarted into the buffer`)
      .toEqual([]);
  }
  const stillThere = plant.snapshot().train;
  expect(stillThere.offsetMm, `${label}: crept while blocked`).toBe(at.offsetMm);
  expect(stillThere.speedMmS).toBe(0);

  // and it must be able to leave again
  plant.setFahrstromWord(GU3);
  for (let step = 1; step <= 200; step++) {
    plant.step(10);
    check(plant.snapshot(), `${label} away ${step}`);
    plant.drainEvents();
  }
  const away = plant.snapshot().train;
  expect(away.speedMmS, `${label}: cannot reverse away from the buffer`).toBeGreaterThan(0);
  expect(away.offsetMm, `${label}: did not move away`).not.toBe(at.offsetMm);

  return {
    events,
    offsetBeforeMm,
    offsetAtHitMm: at.offsetMm,
    speedBeforeMm,
    hitStep,
  };
}

/** Clone of `plan` whose train starts on `edgeId`, aimed at `towardNodeId`. */
function startAimedAt(plan: TrackplanFile, edgeId: string, towardNodeId: string): TrackplanFile {
  const clone = JSON.parse(JSON.stringify(plan)) as TrackplanFile;
  const edge = clone.edges.find((e) => e.id === edgeId);
  if (edge === undefined) throw new Error(`no edge ${edgeId}`);
  const lengthMm = new TrackGraph(clone).edgeLengthMm(edgeId);
  if (edge.to === towardNodeId) clone.start = { edgeId, offsetMm: 0, direction: 1 };
  else if (edge.from === towardNodeId) clone.start = { edgeId, offsetMm: lengthMm, direction: -1 };
  else throw new Error(`edge ${edgeId} is not incident to ${towardNodeId}`);
  return clone;
}

describe('buffer hard stop at full speed, both travel senses (§5.3)', () => {
  it('+1 sense: clamps exactly at the edge end although the step overshot it', () => {
    // miniPlan: eB@100 → nSw (branch 0) → eC → nBufC, i.e. the buffer is eC's `to` node.
    const report = driveIntoBuffer(miniPlan(), 'mini +1');
    const hits = report.events.filter((e) => e.type === 'bufferHit');
    expect(hits).toEqual([{ t: hits[0]!.t, type: 'bufferHit', nodeId: 'nBufC' }]);
    expect(report.events.filter((e) => e.type === 'trainStopped')).toHaveLength(1);
    // proof the clamp was needed: 600 mm/s × 10 ms = 6 mm of travel from < 1000 mm
    expect(report.speedBeforeMm).toBe(600);
    expect(report.offsetBeforeMm).toBeGreaterThan(1000 - 6);
    expect(report.offsetBeforeMm).toBeLessThan(1000);
    expect(report.offsetAtHitMm).toBe(1000);            // exactly the edge end
  });

  it('−1 sense: clamps exactly at offset 0 although the step undershot it', () => {
    // Aim the start at nBuf0, which is eA's `from` node → travel sign −1.
    const plan = startAimedAt(miniPlan(), 'eA', 'nBuf0');
    const report = driveIntoBuffer(plan, 'mini −1');
    const hits = report.events.filter((e) => e.type === 'bufferHit');
    expect(hits).toEqual([{ t: hits[0]!.t, type: 'bufferHit', nodeId: 'nBuf0' }]);
    expect(report.events.filter((e) => e.type === 'trainStopped')).toHaveLength(1);
    expect(report.speedBeforeMm).toBe(600);
    expect(report.offsetBeforeMm).toBeLessThan(6);
    expect(report.offsetBeforeMm).toBeGreaterThan(0);
    expect(report.offsetAtHitMm).toBe(0);               // exactly the edge start
  });
});

describe('every buffer of the real trackplan stops the train on its edge', () => {
  const graph = new TrackGraph(realPlan);
  const buffers = realPlan.nodes.filter((n) => n.kind === 'buffer');

  it('the plan has the documented dead ends, each with exactly one incident edge', () => {
    expect(buffers.length).toBeGreaterThan(0);
    for (const b of buffers) expect(graph.edgesAtNode(b.id)).toHaveLength(1);
  });

  for (const buffer of realPlan.nodes.filter((n) => n.kind === 'buffer')) {
    const edgeId = graph.edgesAtNode(buffer.id)[0] as string;
    const edge = graph.edge(edgeId);
    const sense = edge.to === buffer.id ? '+1' : '−1';
    it(`${buffer.id} via ${edgeId} (${sense} sense)`, () => {
      const plan = startAimedAt(realPlan, edgeId, buffer.id);
      const report = driveIntoBuffer(plan, `${buffer.id}`);
      const hits = report.events.filter((e) => e.type === 'bufferHit');
      expect(hits).toEqual([{ t: hits[0]!.t, type: 'bufferHit', nodeId: buffer.id }]);
      expect(report.speedBeforeMm).toBeGreaterThan(0);
      const lengthMm = graph.edgeLengthMm(edgeId);
      expect(report.offsetAtHitMm).toBe(edge.to === buffer.id ? lengthMm : 0);
    });
  }
});
