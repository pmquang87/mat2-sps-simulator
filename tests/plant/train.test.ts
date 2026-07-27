/**
 * §9.2 train.test.ts: accel lag toward target speed; overshoot past a point when
 * stopping (multiple-crossing realism); direction reversal only through 0; edge
 * transition conserves position continuity.
 *
 * All through the Plant facade: fixed 10 ms steps, fixture physics (accel 1000 mm/s²
 * → Δv = 10 mm/s per step; level 1 = 100 mm/s → 1 mm/step at full speed).
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { PlantSnapshot, SimEvent } from '../../src/plant';
import { miniPlan, opposedPlan } from './fixtures/miniplan';

function run(p: Plant, steps: number): void {
  for (let i = 0; i < steps; i++) p.step(10);
}

function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('Train motion', () => {
  it('ramps speed toward the target with constant acceleration, no overshoot', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1); // level 1 IU → 100 mm/s
    const speeds: number[] = [];
    for (let i = 0; i < 15; i++) {
      p.step(10);
      speeds.push(p.snapshot().train.speedMmS);
    }
    expect(speeds.slice(0, 10)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(speeds.slice(10)).toEqual([100, 100, 100, 100, 100]);
    expect(p.snapshot().train.targetSpeedMmS).toBe(100);
    expect(p.snapshot().train.command).toBe('IU');
  });

  it('glides past the stop command position (braking distance, no precise stop)', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1);
    run(p, 30); // at full speed
    const atCommand = p.snapshot().train.offsetMm;
    p.setFahrstromWord(0); // STOP
    const marks: number[] = [];
    for (let i = 0; i < 12; i++) {
      p.step(10);
      marks.push(p.snapshot().train.offsetMm);
    }
    const final = p.snapshot().train.speedMmS;
    expect(final).toBe(0);
    // Decel from 100 mm/s at 10 mm/s per 10 ms step → glide = (90+80+…+10)·0.01 = 4.5 mm
    expect(p.snapshot().train.offsetMm - atCommand).toBeCloseTo(4.5, 9);
    // It kept moving after the command — multiple physics steps advanced the position.
    expect(marks[0]).toBeGreaterThan(atCommand);
    expect(marks[5]).toBeGreaterThan(marks[0] as number);
    expect(p.snapshot().train.command).toBe('STOP');
  });

  it('reverses direction only through speed 0 and flips the edge-relative sign', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1);
    run(p, 30);
    p.drainEvents();
    p.setFahrstromWord(0x101); // level 1 GU — opposite of current motion
    const history: PlantSnapshot[] = [];
    for (let i = 0; i < 30; i++) {
      p.step(10);
      history.push(p.snapshot());
    }
    // The sign never flips while the train is still moving in the old sense: every
    // direction change in the history happens at/after a speed-0 snapshot.
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1] as PlantSnapshot;
      const cur = history[i] as PlantSnapshot;
      if (cur.train.direction !== prev.train.direction) {
        expect(prev.train.speedMmS).toBe(0);
      }
    }
    const last = history[history.length - 1] as PlantSnapshot;
    expect(last.train.direction).toBe(-1);
    expect(last.train.speedMmS).toBeGreaterThan(0);
    const evs = p.drainEvents();
    const stopped = ofType(evs, 'trainStopped');
    const started = ofType(evs, 'trainStarted');
    expect(stopped).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(started[0]?.direction).toBe('GU');
    expect(started[0]!.t).toBeGreaterThan(stopped[0]!.t);
  });

  it('emits trainStarted with the IU sense on first start', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(2);
    p.step(10);
    const started = ofType(p.drainEvents(), 'trainStarted');
    expect(started).toEqual([{ t: 10, type: 'trainStarted', direction: 'IU' }]);
  });

  it('conserves position continuity across a same-orientation plain-node transition', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(0x101); // GU from standstill: sign flips to −1, toward nA then eA
    let prev = p.snapshot();
    let entered: { prev: PlantSnapshot; cur: PlantSnapshot } | null = null;
    for (let i = 0; i < 300 && !entered; i++) {
      p.step(10);
      const cur = p.snapshot();
      if (cur.train.edgeId === 'eA') entered = { prev, cur };
      prev = cur;
    }
    expect(entered).not.toBeNull();
    const { prev: b, cur: a } = entered as { prev: PlantSnapshot; cur: PlantSnapshot };
    // Leaving eB through its from-node (nA); eA.to === nA → still direction −1 on eA.
    expect(a.train.direction).toBe(-1);
    const stepDist = a.train.speedMmS * 0.01;
    const before = b.train.offsetMm;               // distance left on eB = offset itself
    const after = 500 - a.train.offsetMm;          // distance walked into eA (len 500, entered at to)
    expect(before + after).toBeCloseTo(stepDist, 9);
    expect(ofType(p.drainEvents(), 'segmentEntered').map((e) => e.edgeId)).toContain('eA');
  });

  it('conserves continuity and re-derives the sign at an opposed-orientation transition', () => {
    const p = new Plant({ trackplan: opposedPlan() });
    p.setFahrstromWord(1); // IU, direction +1 on e1
    let prev = p.snapshot();
    let entered: { prev: PlantSnapshot; cur: PlantSnapshot } | null = null;
    for (let i = 0; i < 400 && !entered; i++) {
      p.step(10);
      const cur = p.snapshot();
      if (cur.train.edgeId === 'e2') entered = { prev, cur };
      prev = cur;
    }
    expect(entered).not.toBeNull();
    const { prev: b, cur: a } = entered as { prev: PlantSnapshot; cur: PlantSnapshot };
    // e2 points BACKWARDS (n3→n2): entering at its to-end flips the edge-relative sign.
    expect(b.train.direction).toBe(1);
    expect(a.train.direction).toBe(-1);
    const stepDist = a.train.speedMmS * 0.01;
    const before = 400 - b.train.offsetMm;         // rest of e1 (len 400)
    const after = 400 - a.train.offsetMm;          // walked into e2 from its to-end (len 400)
    expect(before + after).toBeCloseTo(stepDist, 9);
    // Same physical command, same physical travel — the COMMAND did not change.
    expect(a.train.command).toBe('IU');
  });

  it('takes the switch branch selected by the current position (toe entry)', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3); // 600 mm/s — fast to the switch
    run(p, 300);
    // initialPosition 0 → branch eC
    const evs = p.drainEvents();
    expect(ofType(evs, 'segmentEntered').map((e) => e.edgeId)).toContain('eC');
    expect(ofType(evs, 'switchTrailed')).toHaveLength(0);
  });
});
