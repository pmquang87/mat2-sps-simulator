/**
 * §9.1 timers-se.test.ts — SE (Einschaltverzögerung): Q only after preset AND VKE still
 * high; early VKE drop → never Q; Q falls when VKE falls.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

const PROGRAM = 'U E 0.0\nL S5T#200MS\nSE T 11\nU T 11\n= M 10.0';

describe('SE — Einschaltverzögerung', () => {
  it('Q comes only after the preset with VKE held', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start, Q=0
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(11)).toMatchObject({ kind: 'SE', q: false, running: true });
    stepN(em, 3);                                  // scans 2..4: still delaying
    expect(em.peekBit('M 10.0')).toBe(false);
    em.step(50);                                   // scan 5: 200 ms over, VKE still 1 → Q=1
    expect(em.peekBit('M 10.0')).toBe(true);
    stepN(em, 5);                                  // Q follows VKE from now on
    expect(em.peekBit('M 10.0')).toBe(true);
  });

  it('early VKE drop aborts — Q never comes', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 2);                                  // delaying
    em.setInputBit(bit('E 0.0'), false);
    stepN(em, 10);                                 // way past the preset
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(11)).toMatchObject({ q: false, running: false });
  });

  it('Q falls when VKE falls (after expiry)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 5);                                   // Q=1 reached
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // Q follows VKE down
  });

  it('a new edge after an abort restarts the delay', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 2);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                    // abort
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                    // restart — full 200 ms again
    expect(em.peekBit('M 10.0')).toBe(false);
    stepN(em, 3);
    expect(em.peekBit('M 10.0')).toBe(false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
  });
});
