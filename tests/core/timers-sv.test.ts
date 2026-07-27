/**
 * §9.1 timers-sv.test.ts — SV (verlängerter Impuls): Q high for the full preset although
 * VKE dropped after one scan (reed-pulse case); retrigger restarts the full duration;
 * R T n aborts immediately; duration accuracy ± one scan at 50 ms.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

const PROGRAM = 'U E 0.0\nL S5T#300MS\nSV T 12\nU T 12\n= M 10.0';
const PROGRAM_WITH_RESET = `${PROGRAM}\nU E 0.1\nR T 12`;

describe('SV — verlängerter Impuls', () => {
  it('Q stays high for the full preset although VKE dropped after one scan (reed pulse)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);           // input was only a 1-scan pulse
    stepN(em, 5);                                  // scans 2..6 — 300 ms not yet over
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.getTimer(12)).toMatchObject({ kind: 'SV', running: true });
    em.step(50);                                   // scan 7: 300 ms elapsed → Q falls
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('duration accuracy: Q high for 300 ms / 50 ms = 6 scans (± one scan)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    let high = 0;
    em.step(50);
    if (em.peekBit('M 10.0')) high += 1;
    em.setInputBit(bit('E 0.0'), false);
    for (let i = 0; i < 20; i++) {
      em.step(50);
      if (em.peekBit('M 10.0')) high += 1;
    }
    expect(Math.abs(high - 6)).toBeLessThanOrEqual(1);
  });

  it('retrigger during the run restarts the FULL duration', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start (expiry would be scan 7)
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 2
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 3: retrigger — full 300 ms again
    em.setInputBit(bit('E 0.0'), false);
    stepN(em, 5);                                  // scans 4..8 — within the new window
    expect(em.peekBit('M 10.0')).toBe(true);
    em.step(50);                                   // scan 9: new window over
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('R T n aborts immediately', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM_WITH_RESET);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.setInputBit(bit('E 0.1'), true);            // reset string fires
    em.step(50);
    // aborted immediately — Q and timer state are down within this scan …
    expect(em.getTimer(12)).toMatchObject({ q: false, running: false, remainingMs: 0 });
    // … the mirror bit was written BEFORE the reset string in program order, so it
    // follows at the next scan (far before the 300 ms preset would have ended).
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('VKE drop alone has no effect on the running pulse', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.getTimer(12).running).toBe(true);    // still running, unlike SI
    expect(em.peekBit('M 10.0')).toBe(true);
  });
});
