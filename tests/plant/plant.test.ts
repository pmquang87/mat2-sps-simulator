/**
 * §9.2 plant.test.ts: facade step ordering, snapshot deep-equality/stability,
 * drainEvents chronological + emptied, reset restores start state and reseeds the PRNG.
 * Plus facade-level behavior: speedCommand emission, Notaus, buffer hard stop.
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { SimEvent } from '../../src/plant';
import { miniPlan } from './fixtures/miniplan';

function run(p: Plant, steps: number): void {
  for (let i = 0; i < steps; i++) p.step(10);
}

function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('Step + time', () => {
  it('advances timeMs by dt per step; events carry post-step times', () => {
    const p = new Plant({ trackplan: miniPlan() });
    expect(p.snapshot().timeMs).toBe(0);
    p.setFahrstromWord(1);            // between steps at t = 0
    run(p, 3);
    expect(p.snapshot().timeMs).toBe(30);
    const evs = p.drainEvents();
    expect(ofType(evs, 'speedCommand')[0]!.t).toBe(0);
    expect(ofType(evs, 'trainStarted')[0]!.t).toBe(10); // first physics step is t = 10
  });

  it('rejects non-positive dt', () => {
    const p = new Plant({ trackplan: miniPlan() });
    expect(() => p.step(0)).toThrow(/dtMs/);
    expect(() => p.step(-10)).toThrow(/dtMs/);
  });
});

describe('Snapshot', () => {
  it('is deep-equal across calls without a step and detached from internal state', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(2);
    run(p, 25);
    const s1 = p.snapshot();
    const s2 = p.snapshot();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
    // Mutating a snapshot must not leak into the plant.
    s1.train.offsetMm = 99999;
    s1.switches[0]!.position = 1;
    s1.reeds[0]!.latched = true;
    s1.fahrstrom.word = 0x303;
    expect(p.snapshot()).toEqual(s2);
  });

  it('exposes world pose for rendering (position on the plan, heading along travel)', () => {
    const p = new Plant({ trackplan: miniPlan() });
    const s = p.snapshot();
    // Start: eB @ 100 mm, straight +x edge from (0,0) → (1000,0), mmPerUnit 1.
    expect(s.train.worldPos.x).toBeCloseTo(100, 9);
    expect(s.train.worldPos.y).toBeCloseTo(0, 9);
    expect(s.train.headingRad).toBeCloseTo(0, 9);   // +x
    p.setFahrstromWord(0x101);                      // reverse sense while stationary
    p.step(10);
    expect(p.snapshot().train.headingRad).toBeCloseTo(Math.PI, 9); // −x
  });

  it('keeps switches and reeds in trackplan order', () => {
    const p = new Plant({ trackplan: miniPlan() });
    const s = p.snapshot();
    expect(s.switches.map((x) => x.id)).toEqual(['xW01T']);
    expect(s.reeds.map((x) => x.id)).toEqual(['xR01T', 'xR02T', 'xR03T']);
  });
});

describe('drainEvents', () => {
  it('returns chronological events and empties the queue', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3);
    run(p, 400); // start, reed crossings, segment change, buffer hit …
    const evs = p.drainEvents();
    expect(evs.length).toBeGreaterThan(3);
    for (let i = 1; i < evs.length; i++) {
      expect(evs[i]!.t).toBeGreaterThanOrEqual(evs[i - 1]!.t);
    }
    expect(p.drainEvents()).toEqual([]);
  });
});

describe('speedCommand emission', () => {
  it('emits only on word change, with decoded level and direction', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1);
    p.setFahrstromWord(1);            // unchanged — no second event
    p.step(10);
    p.setFahrstromWord(0x102);
    p.setFahrstromWord(0);
    const cmds = ofType(p.drainEvents(), 'speedCommand');
    expect(cmds).toEqual([
      { t: 0, type: 'speedCommand', level: 1, direction: 'IU', word: 1 },
      { t: 10, type: 'speedCommand', level: 2, direction: 'GU', word: 0x102 },
      { t: 10, type: 'speedCommand', level: 0, direction: 'STOP', word: 0 },
    ]);
  });

  it('reflects the word in the fahrstrom snapshot', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(0x103);
    expect(p.snapshot().fahrstrom).toEqual({ word: 0x103, level: 3, direction: 'GU' });
  });
});

describe('Notaus', () => {
  it('latches, emits on change only, and does NOT stop the train by itself', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(1);
    run(p, 20);
    p.setNotaus(true);
    p.setNotaus(true);                // no repeat event
    expect(p.notausActive).toBe(true);
    run(p, 20);
    // §5.3: the plant does not stop the train — the student program must.
    expect(p.snapshot().train.speedMmS).toBe(100);
    p.setNotaus(false);
    const notausEvs = ofType(p.drainEvents(), 'notaus');
    expect(notausEvs).toEqual([
      { t: 200, type: 'notaus', active: true },
      { t: 400, type: 'notaus', active: false },
    ]);
  });
});

describe('Buffer stop', () => {
  it('hard-stops at the buffer once and blocks further pushing, until reversed away', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setFahrstromWord(3);            // straight into nBufC via eC (position 0)
    run(p, 400);
    let evs = p.drainEvents();
    const hits = ofType(evs, 'bufferHit');
    expect(hits).toEqual([{ t: hits[0]!.t, type: 'bufferHit', nodeId: 'nBufC' }]);
    expect(ofType(evs, 'trainStopped')).toHaveLength(1);
    let s = p.snapshot();
    expect(s.train.edgeId).toBe('eC');
    expect(s.train.offsetMm).toBe(1000);           // clamped at the buffer end
    expect(s.train.speedMmS).toBe(0);

    run(p, 50);                        // command still pushing into the buffer
    evs = p.drainEvents();
    expect(ofType(evs, 'bufferHit')).toHaveLength(0);   // no repeat
    expect(ofType(evs, 'trainStarted')).toHaveLength(0); // blocked, not oscillating

    p.setFahrstromWord(0x103);         // reverse away
    run(p, 100);
    evs = p.drainEvents();
    const started = ofType(evs, 'trainStarted');
    expect(started).toHaveLength(1);
    expect(started[0]!.direction).toBe('GU');
    s = p.snapshot();
    expect(s.train.offsetMm).toBeLessThan(1000);
    expect(s.train.speedMmS).toBeGreaterThan(0);
  });
});

describe('reset', () => {
  it('restores the start state (train, switches, reeds, fahrstrom, time, notaus)', () => {
    const p = new Plant({ trackplan: miniPlan(), seed: 5, bounceEnabled: true });
    const fresh = p.snapshot();
    p.setFahrstromWord(2);
    p.setSwitchCoil('xW01T', 'R', true);
    p.setNotaus(true);
    run(p, 500);
    p.reset();
    expect(p.snapshot()).toEqual(fresh);
    expect(p.notausActive).toBe(false);
    expect(p.drainEvents()).toEqual([]);   // event queue cleared too
  });

  it('reseeds the PRNG: a rerun after reset matches a fresh run bit for bit', () => {
    const script = (p: Plant): SimEvent[] => {
      p.setFahrstromWord(2);
      run(p, 1300);                       // over the bounce reed incl. re-closure
      return p.drainEvents();
    };
    const a = new Plant({ trackplan: miniPlan(), seed: 5, bounceEnabled: true });
    const log1 = JSON.stringify(script(a));
    a.reset();
    const log2 = JSON.stringify(script(a));
    const b = new Plant({ trackplan: miniPlan(), seed: 5, bounceEnabled: true });
    const log3 = JSON.stringify(script(b));
    expect(log2).toBe(log1);
    expect(log3).toBe(log1);
  });
});
