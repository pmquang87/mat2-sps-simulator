/**
 * §9.1 timers-ss.test.ts — SS (speichernde Einschaltverzögerung): Q latches after expiry
 * although VKE dropped (5 s wait pattern); retrigger during run restarts; Q persists
 * arbitrarily many cycles; mandatory reset: only R T n clears; the `U T x / R T x`
 * self-reset idiom works.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

const PROGRAM = 'U E 0.0\nL S5T#150MS\nSS T 13\nU T 13\n= M 10.0\nU E 0.1\nR T 13';

describe('SS — speichernde Einschaltverzögerung', () => {
  it('Q latches after expiry although VKE dropped right away', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start (input pulse)
    em.setInputBit(bit('E 0.0'), false);
    expect(em.peekBit('M 10.0')).toBe(false);      // delaying, Q=0
    stepN(em, 2);                                  // scans 2..3: 100 ms — still delaying
    expect(em.peekBit('M 10.0')).toBe(false);
    em.step(50);                                   // scan 4: 150 ms over → Q=1 LATCHED
    expect(em.peekBit('M 10.0')).toBe(true);
    stepN(em, 50);                                 // persists arbitrarily many cycles
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(13)).toMatchObject({ kind: 'SS', q: true, running: false });
  });

  it('retrigger during the run restarts from the full preset', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start; would expire at scan 4
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 2
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 3: retrigger — full 150 ms again
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 4: 100 ms of new window left
    expect(em.peekBit('M 10.0')).toBe(false);      // original expiry time passed without Q
    em.step(50);                                   // scan 5
    em.step(50);                                   // scan 6: new window over → Q=1
    expect(em.peekBit('M 10.0')).toBe(true);
  });

  it('mandatory reset: only R T n clears the latch', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 4);
    em.setInputBit(bit('E 0.0'), false);
    stepN(em, 10);
    expect(em.peekBit('M 10.0')).toBe(true);       // still latched — the brief's explicit case
    em.setInputBit(bit('E 0.1'), true);            // fire the reset string
    em.step(50);
    // latch cleared within this scan; the mirror bit was written before the reset
    // string in program order and follows at the next scan
    expect(em.getTimer(13)).toMatchObject({ q: false, running: false, remainingMs: 0 });
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
    em.setInputBit(bit('E 0.1'), false);
    stepN(em, 5);
    expect(em.peekBit('M 10.0')).toBe(false);      // stays cleared
  });

  it('the U T x / R T x self-reset idiom: Q observed high exactly until the reset string runs', () => {
    const em = makeEmulator();
    const selfReset = 'U E 0.0\nL S5T#100MS\nSS T 13\nU T 13\n= M 10.0\nU T 13\nR T 13';
    loadOrThrow(em, selfReset);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 2: 50 ms
    expect(em.peekBit('M 10.0')).toBe(false);
    em.step(50);                                   // scan 3: expiry → = M10.0 writes 1, then self-reset
    expect(em.peekBit('M 10.0')).toBe(true);       // observed high for exactly this scan
    expect(em.getTimer(13).q).toBe(false);         // already reset by the later string
    em.step(50);                                   // scan 4
    expect(em.peekBit('M 10.0')).toBe(false);
  });
});
