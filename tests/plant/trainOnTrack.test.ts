/**
 * §9.2 trainOnTrack.test.ts — the §5.3 position invariant across the plant scenarios:
 * after EVERY physics step the train sits on a real edge (0 ≤ offset ≤ length), its plan
 * position is inside the track rectangle (⊂ baseboard), and its motion is continuous.
 *
 * Motivated by a bug report ("train outside the baseboard at cycle 1454"): the plant state
 * was in fact sound at that cycle, but nothing pinned it — so the property the scene, the
 * watch table and the oracle all rely on could have regressed silently. The scenarios below
 * deliberately cover the situations that could extrapolate a position past an edge end:
 * buffer overruns at full speed, reversals (Sägefahrt) across nodes with opposed edge
 * orientations, trailing a switch set against the movement, and switches thrown under the
 * train — on the miniature fixtures and on the real trackplan.
 *
 * The last test is a self-test of the checker, so the invariant can never pass vacuously.
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { PlantSnapshot, SimEvent, TrackplanFile } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import { miniPlan, opposedPlan } from './fixtures/miniplan';
import { onTrackChecker, onTrackViolations, trackBounds } from './support/onTrack';

const realPlan = trackplanJson as unknown as TrackplanFile;

/** AW 6 words (§5.3 encoding): low byte = level 1..3, bit 8 = GU. */
const IU3 = 3;
const GU3 = 0x103;
const IU1 = 1;
const GU1 = 0x101;
const STOP = 0;

interface DriveLeg {
  word: number;
  steps: number;
  /** optional coil command applied before the leg: [switchId, coil] */
  coil?: [string, 'G' | 'R'];
}

/** Runs the legs on `plan`, checking the invariant after every 10 ms step. */
function drive(
  plan: TrackplanFile,
  legs: readonly DriveLeg[],
  opts: { strictDerail?: boolean; label: string },
): { events: SimEvent[]; steps: number; final: PlantSnapshot } {
  const plant = new Plant({ trackplan: plan, strictDerail: opts.strictDerail ?? false });
  const { check } = onTrackChecker(plan);
  const events: SimEvent[] = [];
  let steps = 0;
  check(plant.snapshot(), `${opts.label} start`);
  for (const leg of legs) {
    if (leg.coil !== undefined) {
      const [switchId, coil] = leg.coil;
      plant.setSwitchCoil(switchId, coil, true);
      plant.setSwitchCoil(switchId, coil === 'G' ? 'R' : 'G', false);
    }
    plant.setFahrstromWord(leg.word);
    for (let i = 0; i < leg.steps; i++) {
      plant.step(10);
      steps++;
      check(plant.snapshot(), `${opts.label} step ${steps}`);
      for (const e of plant.drainEvents()) events.push(e);
    }
  }
  return { events, steps, final: plant.snapshot() };
}

function typesOf(events: readonly SimEvent[], type: SimEvent['type']): SimEvent[] {
  return events.filter((e) => e.type === type);
}

describe('§5.3 position invariant — miniature plans', () => {
  it('survives a full-speed run into a buffer, both buffers of the plan', () => {
    // eB@100 → nSw (branch 0 = eC) → nBufC, then all the way back over nA to nBuf0.
    const run = drive(
      miniPlan(),
      [
        { word: IU3, steps: 400 },   // into nBufC and held against it
        { word: GU3, steps: 500 },   // reverse across nSw + nA into nBuf0
        { word: GU3, steps: 200 },   // held against nBuf0
      ],
      { label: 'mini both buffers' },
    );
    const hits = typesOf(run.events, 'bufferHit').map((e) => (e as { nodeId: string }).nodeId);
    expect(hits).toEqual(['nBufC', 'nBuf0']);
    expect(run.final.train.edgeId).toBe('eA');
    expect(run.final.train.offsetMm).toBe(0);       // exactly the buffer end, not past it
    expect(run.final.train.speedMmS).toBe(0);
  });

  it('survives repeated reversals that never quite reach a node ("kein zielgenaues Bremsen")', () => {
    const legs: DriveLeg[] = [];
    for (let i = 0; i < 12; i++) {
      legs.push({ word: i % 2 === 0 ? IU1 : GU1, steps: 90 });
      legs.push({ word: STOP, steps: 30 });
    }
    const run = drive(miniPlan(), legs, { label: 'mini sawtooth' });
    expect(run.steps).toBe(12 * 120);
    expect(typesOf(run.events, 'trainStarted').length).toBeGreaterThan(6);
  });

  it('survives a trailing move against the switch position (warning, non-strict)', () => {
    // R throws to branch 1 (eD); run onto eD, throw the switch back to 0, reverse and trail it.
    const run = drive(
      miniPlan(),
      [
        { word: IU3, steps: 300, coil: ['xW01T', 'R'] },   // via eD into nBufD
        { word: STOP, steps: 40, coil: ['xW01T', 'G'] },    // switch now points at eC
        { word: GU3, steps: 400 },                          // trailing move through nSw
      ],
      { label: 'mini trailed' },
    );
    expect(typesOf(run.events, 'switchTrailed')).toHaveLength(1);
    expect(typesOf(run.events, 'derail')).toHaveLength(0);
  });

  it('survives the same trailing move in strict mode (derail stops on the edge)', () => {
    const run = drive(
      miniPlan(),
      [
        { word: IU3, steps: 300, coil: ['xW01T', 'R'] },
        { word: STOP, steps: 40, coil: ['xW01T', 'G'] },
        { word: GU3, steps: 400 },
      ],
      { strictDerail: true, label: 'mini derail' },
    );
    expect(typesOf(run.events, 'derail')).toHaveLength(1);
    expect(run.final.derailed).toBe(true);
    expect(run.final.train.edgeId).toBe('eD');
    expect(run.final.train.offsetMm).toBe(0);      // clamped at nSw, not extrapolated past it
    expect(run.final.train.speedMmS).toBe(0);
  });

  it('survives a switch thrown under the train (non-strict and strict)', () => {
    for (const strictDerail of [false, true]) {
      // 40 steps at speed 3 = 240 mm: the train is inside the switch occupancy window when
      // the coil is thrown, so the actuation completes under it.
      const run = drive(
        miniPlan(),
        [
          { word: IU3, steps: 148 },
          { word: IU3, steps: 60, coil: ['xW01T', 'R'] },
          { word: IU3, steps: 200 },
        ],
        { strictDerail, label: `mini under-train strict=${strictDerail}` },
      );
      expect(typesOf(run.events, 'switchMovedUnderTrain').length).toBeGreaterThan(0);
    }
  });

  it('survives the opposed-orientation node in both travel directions', () => {
    const run = drive(
      opposedPlan(),
      [
        { word: IU3, steps: 250 },   // e1 +1 → n2 → e2 entered at its `to` end (dir −1)
        { word: GU3, steps: 400 },   // back over n2 onto e1 and into n1
        { word: IU3, steps: 400 },   // forward again, into n3
      ],
      { label: 'opposed' },
    );
    const hits = typesOf(run.events, 'bufferHit').map((e) => (e as { nodeId: string }).nodeId);
    expect(hits).toEqual(['n3', 'n1', 'n3']);
  });
});

describe('§5.3 position invariant — real trackplan', () => {
  it('holds over a long forward run at full speed', () => {
    const run = drive(realPlan, [{ word: IU3, steps: 6_000 }], { label: 'real IU' });
    expect(typesOf(run.events, 'segmentEntered').length).toBeGreaterThan(10);
  });

  it('holds over a long REVERSE run at full speed (the reported Rangierfahrt leg)', () => {
    const run = drive(
      realPlan,
      [
        { word: IU3, steps: 3_000 },
        { word: STOP, steps: 300 },
        { word: GU3, steps: 9_000 },   // 90 s of reversing — far past the reported cycle 1454
      ],
      { label: 'real GU' },
    );
    expect(typesOf(run.events, 'segmentEntered').length).toBeGreaterThan(10);
  });

  it('holds while switches are thrown continuously under a running train', () => {
    const commandable = realPlan.switches.filter((s) => s.coilToBranch !== null).map((s) => s.id);
    expect(commandable.length).toBeGreaterThan(20);
    for (const strictDerail of [false, true]) {
      const legs: DriveLeg[] = [];
      for (let i = 0; i < 60; i++) {
        const id = commandable[(i * 7) % commandable.length] as string;
        legs.push({ word: i % 5 === 4 ? GU3 : IU3, steps: 100, coil: [id, i % 2 === 0 ? 'G' : 'R'] });
      }
      drive(realPlan, legs, { strictDerail, label: `real churn strict=${strictDerail}` });
    }
  });
});

describe('invariant self-test (the checker must not pass vacuously)', () => {
  const plan = miniPlan();
  const box = trackBounds(plan);
  const { graph } = onTrackChecker(plan);
  const base = new Plant({ trackplan: plan }).snapshot();

  function withTrain(patch: Partial<PlantSnapshot['train']>, timeMs = base.timeMs): PlantSnapshot {
    return { ...base, timeMs, train: { ...base.train, ...patch } };
  }

  it('flags an offset past the edge end', () => {
    const bad = onTrackViolations(graph, plan, box, withTrain({ offsetMm: 1000.5 }), null);
    expect(bad.join(' ')).toMatch(/beyond the edge end/);
  });

  it('flags a negative offset', () => {
    const bad = onTrackViolations(graph, plan, box, withTrain({ offsetMm: -0.5 }), null);
    expect(bad.join(' ')).toMatch(/before the edge start/);
  });

  it('flags an unknown edge id', () => {
    const bad = onTrackViolations(graph, plan, box, withTrain({ edgeId: 'nope' }), null);
    expect(bad.join(' ')).toMatch(/unknown edge/);
  });

  it('flags a position off the track rectangle', () => {
    const bad = onTrackViolations(graph, plan, box, withTrain({ worldPos: { x: 9e3, y: 0 } }), null);
    expect(bad.join(' ')).toMatch(/outside the track box/);
  });

  it('flags a teleport between two snapshots', () => {
    const prev = withTrain({ offsetMm: 100, worldPos: { x: 100, y: 0 } }, 0);
    const next = withTrain({ offsetMm: 900, worldPos: { x: 900, y: 0 }, speedMmS: 100 }, 10);
    expect(onTrackViolations(graph, plan, box, next, prev).join(' ')).toMatch(/discontinuous/);
  });

  it('accepts a legitimate step', () => {
    const prev = withTrain({ offsetMm: 100, worldPos: { x: 100, y: 0 }, speedMmS: 100 }, 0);
    const next = withTrain({ offsetMm: 101, worldPos: { x: 101, y: 0 }, speedMmS: 100 }, 10);
    expect(onTrackViolations(graph, plan, box, next, prev)).toEqual([]);
  });
});
