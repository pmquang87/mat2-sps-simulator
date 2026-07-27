/**
 * §9.2 switches.test.ts: coil rising edge → 300 ms later switchMoved with the mapped
 * branch; re-command during actuation; both-coils conflict event; pulse duration
 * measurement; coilHeld after 5 s; switchTrailed and strict-mode derail.
 */
import { describe, expect, it } from 'vitest';
import { Plant } from '../../src/plant';
import type { SimEvent, TrackplanFile } from '../../src/plant';
import { miniPlan } from './fixtures/miniplan';

function run(p: Plant, steps: number): void {
  for (let i = 0; i < steps; i++) p.step(10);
}

function ofType<T extends SimEvent['type']>(evs: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return evs.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Fixture variant: train waiting on eC pointing at the switch (branch-side approach). */
function planOnBranch(): TrackplanFile {
  const plan = miniPlan();
  plan.start = { edgeId: 'eC', offsetMm: 300, direction: -1 }; // IU sense = toward nSw
  return plan;
}

describe('Switch actuation', () => {
  it('moves to the mapped branch 300 ms after the coil rising edge', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'R', true);           // R → branch 1 (coilToBranch)
    run(p, 29);
    let s = p.snapshot().switches[0]!;
    expect(s.position).toBe(0);                    // not yet
    expect(s.moving).toBe(true);
    expect(s.movingToward).toBe(1);
    expect(s.remainingMs).toBe(10);
    p.step(10);                                    // t = 300
    s = p.snapshot().switches[0]!;
    expect(s.position).toBe(1);
    expect(s.moving).toBe(false);
    const moved = ofType(p.drainEvents(), 'switchMoved');
    expect(moved).toEqual([{ t: 300, type: 'switchMoved', switchId: 'xW01T', position: 1 }]);
  });

  it('is bistable: position persists after the pulse ends', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 30);
    p.setSwitchCoil('xW01T', 'R', false);
    run(p, 100);
    expect(p.snapshot().switches[0]!.position).toBe(1);
  });

  it('restarts actuation toward the other branch on a re-command', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 10);                                    // t = 100, mid-actuation
    p.setSwitchCoil('xW01T', 'G', true);           // re-command toward branch 0
    run(p, 29);
    expect(p.snapshot().switches[0]!.moving).toBe(true);
    p.step(10);                                    // t = 400 = 100 + 300
    const evs = p.drainEvents();
    const moved = ofType(evs, 'switchMoved');
    expect(moved).toEqual([{ t: 400, type: 'switchMoved', switchId: 'xW01T', position: 0 }]);
  });

  it('emits coilConflict when both coils are high; actuation goes to the most recent', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 5);
    p.setSwitchCoil('xW01T', 'G', true);           // second coil while R still high
    const conflicts = ofType(p.drainEvents(), 'coilConflict');
    expect(conflicts).toEqual([{ t: 50, type: 'coilConflict', switchId: 'xW01T' }]);
    run(p, 30);
    expect(p.snapshot().switches[0]!.position).toBe(0); // most recent = G = branch 0
  });

  it('measures the coil pulse duration on the falling edge (300 ms SV pattern)', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'G', true);
    run(p, 30);                                    // 300 ms high
    p.setSwitchCoil('xW01T', 'G', false);
    const pulses = ofType(p.drainEvents(), 'switchPulse');
    expect(pulses).toHaveLength(1);
    expect(pulses[0]!.switchId).toBe('xW01T');
    expect(pulses[0]!.coil).toBe('G');
    expect(Math.abs(pulses[0]!.durationMs - 300)).toBeLessThanOrEqual(10);
  });

  it('warns coilHeld once after > 5 s and never emits switchPulse while held', () => {
    const p = new Plant({ trackplan: miniPlan() });
    p.setSwitchCoil('xW01T', 'G', true);
    run(p, 510);                                   // 5.1 s
    const evs = p.drainEvents();
    const held = ofType(evs, 'coilHeld');
    expect(held).toHaveLength(1);
    expect(held[0]!.coil).toBe('G');
    expect(held[0]!.heldMs).toBeGreaterThan(5000);
    expect(ofType(evs, 'switchPulse')).toHaveLength(0);
    run(p, 200);                                   // still held — no second warning
    expect(ofType(p.drainEvents(), 'coilHeld')).toHaveLength(0);
  });
});

describe('Trailing (branch-side approach)', () => {
  it('passes silently when the position matches the branch being left', () => {
    const p = new Plant({ trackplan: planOnBranch() });
    p.setFahrstromWord(3);                         // toward nSw; position 0 matches eC
    run(p, 150);
    const evs = p.drainEvents();
    expect(ofType(evs, 'switchTrailed')).toHaveLength(0);
    expect(ofType(evs, 'segmentEntered').map((e) => e.edgeId)).toContain('eB');
  });

  it('warns switchTrailed on mismatch and continues in non-strict mode', () => {
    const p = new Plant({ trackplan: planOnBranch() });
    p.setSwitchCoil('xW01T', 'R', true);           // throw to branch 1 (eD) first
    run(p, 30);
    p.setSwitchCoil('xW01T', 'R', false);
    p.drainEvents();
    p.setFahrstromWord(3);
    run(p, 150);
    const evs = p.drainEvents();
    const trailed = ofType(evs, 'switchTrailed');
    expect(trailed).toHaveLength(1);
    expect(trailed[0]!.switchId).toBe('xW01T');
    expect(ofType(evs, 'derail')).toHaveLength(0);
    expect(ofType(evs, 'segmentEntered').map((e) => e.edgeId)).toContain('eB');
    expect(p.snapshot().derailed).toBe(false);
  });

  it('derails on mismatch in strict mode and freezes the train', () => {
    const p = new Plant({ trackplan: planOnBranch(), strictDerail: true });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 30);
    p.setSwitchCoil('xW01T', 'R', false);
    p.drainEvents();
    p.setFahrstromWord(3);
    run(p, 150);
    const evs = p.drainEvents();
    expect(ofType(evs, 'switchTrailed')).toHaveLength(1);
    const derails = ofType(evs, 'derail');
    expect(derails).toHaveLength(1);
    expect(derails[0]!.switchId).toBe('xW01T');
    const snap = p.snapshot();
    expect(snap.derailed).toBe(true);
    expect(snap.train.speedMmS).toBe(0);
    expect(snap.train.edgeId).toBe('eC');          // never entered eB
    // Frozen: further steps do not move it.
    run(p, 50);
    expect(p.snapshot().train.speedMmS).toBe(0);
    expect(ofType(p.drainEvents(), 'segmentEntered')).toHaveLength(0);
  });
});

describe('Actuation under the train', () => {
  it('warns switchMovedUnderTrain once when actuating with the train on the node', () => {
    const plan = miniPlan();
    plan.start = { edgeId: 'eB', offsetMm: 970, direction: 1 }; // 30 mm from nSw
    const p = new Plant({ trackplan: plan });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 30);
    const evs = p.drainEvents();
    const warns = ofType(evs, 'switchMovedUnderTrain');
    expect(warns).toEqual([{ t: 10, type: 'switchMovedUnderTrain', switchId: 'xW01T' }]);
    expect(ofType(evs, 'switchMoved')).toHaveLength(1); // still completes (non-strict)
    expect(p.snapshot().derailed).toBe(false);
  });

  it('derails in strict mode when the switch moves under the train', () => {
    const plan = miniPlan();
    plan.start = { edgeId: 'eB', offsetMm: 970, direction: 1 };
    const p = new Plant({ trackplan: plan, strictDerail: true });
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 30);
    const evs = p.drainEvents();
    expect(ofType(evs, 'switchMovedUnderTrain')).toHaveLength(1);
    expect(ofType(evs, 'derail')).toHaveLength(1);
    expect(p.snapshot().derailed).toBe(true);
  });

  it('does not warn when the train is far from the switch node', () => {
    const p = new Plant({ trackplan: miniPlan() });      // train at eB@100
    p.setSwitchCoil('xW01T', 'R', true);
    run(p, 30);
    expect(ofType(p.drainEvents(), 'switchMovedUnderTrain')).toHaveLength(0);
  });
});

describe('Unknown ids', () => {
  it('throws on an unknown switch id', () => {
    const p = new Plant({ trackplan: miniPlan() });
    expect(() => p.setSwitchCoil('xW99T', 'G', true)).toThrow(/unknown switch id/);
  });
});
