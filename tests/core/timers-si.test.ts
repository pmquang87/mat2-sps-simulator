/**
 * §9.1 timers-si.test.ts — SI (Impuls): start at VKE edge, Q=1 during run; VKE drop
 * kills Q and timer; expiry ends Q with VKE still high.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

const PROGRAM = 'U E 0.0\nL S5T#200MS\nSI T 10\nU T 10\n= M 10.0';

describe('SI — Impuls', () => {
  it('starts on the VKE rising edge with Q=1 and runs for the preset', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(10)).toMatchObject({ kind: 'SI', q: true, running: true, presetMs: 200 });

    stepN(em, 3);                                  // scans 2..4 — still inside 200 ms
    expect(em.peekBit('M 10.0')).toBe(true);

    em.step(50);                                   // scan 5: 200 ms elapsed → expired
    expect(em.peekBit('M 10.0')).toBe(false);      // Q ends although VKE is still high
    expect(em.getTimer(10)).toMatchObject({ q: false, running: false, remainingMs: 0 });
  });

  it('holding VKE does not retrigger after expiry (edge-triggered start)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 10);                                 // long past expiry, input held
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(10).running).toBe(false);
  });

  it('VKE drop during the run kills Q and stops the timer', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // VKE falls → abort
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(10)).toMatchObject({ q: false, running: false, remainingMs: 0 });
  });

  it('a new rising edge restarts the pulse', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 6);                                  // pulse ran out
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // new edge
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(10).running).toBe(true);
  });
});
