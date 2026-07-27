/**
 * §9.1 edges.test.ts: FP exactly one cycle on 0→1; the edge-operand bit is updated on
 * every evaluation; FN symmetric; FP under a held input never re-fires; string
 * continuation after FP (FP then UN then = computes the conjunction); two FPs with
 * distinct operands are independent.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

describe('FP — rising edge', () => {
  const PROGRAM = 'U E 0.0\nFP M 11.0\n= M 10.0';

  it('fires for exactly ONE cycle on 0→1', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // the rising-edge scan
    expect(em.peekBit('M 10.0')).toBe(true);
    em.step(50);                                   // input still high → no pulse
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('never re-fires under a held input', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    stepN(em, 20);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('fires again after the input dropped and rose again', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
  });

  it('updates the edge-operand bit to the VKE on every evaluation', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 11.0')).toBe(true);       // operand ← VKE
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 11.0')).toBe(false);
  });
});

describe('FN — falling edge (symmetric)', () => {
  const PROGRAM = 'U E 0.0\nFN M 11.1\n= M 10.1';

  it('fires exactly one cycle on 1→0', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.1')).toBe(false);      // rising is not a falling edge
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 10.1')).toBe(true);       // the falling-edge scan
    em.step(50);
    expect(em.peekBit('M 10.1')).toBe(false);      // held low → no pulse
  });
});

describe('string continuation after FP (ERAB stays true)', () => {
  it('FP then UN then = computes the conjunction', () => {
    const em = makeEmulator();
    // pulse AND (NOT E 0.1) — the `U "xR01D" / FP M11.0 / UN T14 / = M11.1` shape
    loadOrThrow(em, 'U E 0.0\nFP M 11.0\nUN E 0.1\n= M 10.2');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.2')).toBe(false);      // pulse AND ¬1 = 0
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), false);
    em.step(50);
    expect(em.peekBit('M 10.2')).toBe(true);       // pulse AND ¬0 = 1
  });

  it('the UN T14 variant of the shape works too', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nFP M 11.0\nUN T 14\n= M 10.2');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.2')).toBe(true);       // T14 idle → Q=0 → ¬0 = 1, pulse = 1
  });
});

describe('independence', () => {
  it('two FPs with distinct operands are independent', () => {
    const em = makeEmulator();
    loadOrThrow(em, [
      'U E 0.0', 'FP M 11.0', '= M 10.0',
      'U E 0.1', 'FP M 11.2', '= M 10.3',
    ].join('\n'));
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.peekBit('M 10.3')).toBe(false);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);      // first pulse already consumed
    expect(em.peekBit('M 10.3')).toBe(true);       // second fires independently
  });
});
