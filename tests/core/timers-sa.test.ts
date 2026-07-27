/**
 * §9.1 timers-sa.test.ts — SA (Ausschaltverzögerung): Q=1 immediately with VKE; VKE 1→0
 * starts the off-delay; Q falls at expiry; VKE returns during the delay → delay
 * cancelled, Q stays 1.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

const PROGRAM = 'U E 0.0\nL S5T#200MS\nSA T 14\nU T 14\n= M 10.0';

describe('SA — Ausschaltverzögerung', () => {
  it('Q=1 immediately while VKE=1, no timer running', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(14)).toMatchObject({ kind: 'SA', q: true, running: false });
    stepN(em, 5);
    expect(em.peekBit('M 10.0')).toBe(true);
  });

  it('VKE 1→0 starts the off-delay; Q falls at expiry', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: Q=1
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 2: falling edge → delay starts
    expect(em.peekBit('M 10.0')).toBe(true);       // Q stays 1 during the delay
    expect(em.getTimer(14)).toMatchObject({ running: true, presetMs: 200 });
    stepN(em, 3);                                  // scans 3..5: still delaying
    expect(em.peekBit('M 10.0')).toBe(true);
    em.step(50);                                   // scan 6: 200 ms after the fall → Q=0
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(14)).toMatchObject({ q: false, running: false });
  });

  it('VKE returns during the delay → delay cancelled, Q stays 1', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // delay running
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // VKE back → timer cleared
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(14)).toMatchObject({ q: true, running: false, remainingMs: 0 });
    em.setInputBit(bit('E 0.0'), false);
    stepN(em, 3);                                  // new delay from the new falling edge
    expect(em.peekBit('M 10.0')).toBe(true);
    stepN(em, 2);
    expect(em.peekBit('M 10.0')).toBe(false);      // full 200 ms after the second fall
  });

  it('starts from an idle cold state only via a falling edge (no spontaneous Q)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.step(50);                                   // VKE=0 from the start, no edge
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(14).running).toBe(false);
  });
});
