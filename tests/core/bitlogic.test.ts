/**
 * §9.1 bitlogic.test.ts: truth tables for U/UN/O/ON/X/XN chains; Erstabfrage (first test
 * after =/S/R/timer-op loads instead of combining); `=` writes every cycle incl. 0;
 * S/R no-op at VKE=0; S-then-R precedence by program order (Selbsthaltung).
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator } from './fixtures';

function runCombine(op: string, a: boolean, b: boolean): boolean {
  const em = makeEmulator();
  loadOrThrow(em, `U E 0.0\n${op} E 0.1\n= M 10.0`);
  em.setInputBit(bit('E 0.0'), a);
  em.setInputBit(bit('E 0.1'), b);
  em.step(50);
  return em.peekBit('M 10.0');
}

describe('truth tables', () => {
  const cases: [boolean, boolean][] = [
    [false, false], [false, true], [true, false], [true, true],
  ];

  it.each(cases)('U (AND) with %s,%s', (a, b) => {
    expect(runCombine('U', a, b)).toBe(a && b);
  });
  it.each(cases)('UN with %s,%s', (a, b) => {
    expect(runCombine('UN', a, b)).toBe(a && !b);
  });
  it.each(cases)('O (OR) with %s,%s', (a, b) => {
    expect(runCombine('O', a, b)).toBe(a || b);
  });
  it.each(cases)('ON with %s,%s', (a, b) => {
    expect(runCombine('ON', a, b)).toBe(a || !b);
  });
  it.each(cases)('X (XOR) with %s,%s', (a, b) => {
    expect(runCombine('X', a, b)).toBe(a !== b);
  });
  it.each(cases)('XN with %s,%s', (a, b) => {
    expect(runCombine('XN', a, b)).toBe(a === b);
  });

  it('longer chains combine left to right', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nU E 0.1\nO E 0.2\n= M 10.0');
    // (e0 AND e1) OR e2
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), false);
    em.setInputBit(bit('E 0.2'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.2'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('negated first check loads ¬v (UN as first instruction of a string)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'UN E 0.0\n= M 10.0');
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });
});

describe('Erstabfrage (first-check) semantics', () => {
  it('first test after = loads VKE instead of combining', () => {
    const em = makeEmulator();
    // If ERAB were not reset, the second string would OR with the first string's VKE=1.
    loadOrThrow(em, 'U E 0.0\n= M 10.0\nO E 0.1\n= M 10.1');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.peekBit('M 10.1')).toBe(false);      // fresh load of E 0.1 = 0
  });

  it('first test after S/R loads VKE instead of combining', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nS M 10.0\nU E 0.1\n= M 10.1');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    expect(em.peekBit('M 10.1')).toBe(false);
  });

  it('first test after a timer op loads VKE instead of combining', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL S5T#100MS\nSV T 10\nU E 0.1\n= M 10.1');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), false);
    em.step(50);
    expect(em.peekBit('M 10.1')).toBe(false);
  });
});

describe('= assignment', () => {
  it('writes every cycle, including writing 0', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);      // actively written back to 0
  });
});

describe('S / R', () => {
  it('S sets only at VKE=1 and the bit stays set (no-op at VKE=0)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nS M 10.0');
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);      // VKE=0 → no-op, not a write of 0
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);       // remains set — the brief's explicit case
  });

  it('R clears only at VKE=1 (no-op at VKE=0)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nS M 10.0\nU E 0.1\nR M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                    // R with VKE=0 → no-op
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('S then R precedence by program order (Selbsthaltung: R later wins)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nS M 10.0\nU E 0.1\nR M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);      // both fired; R is later in the scan
  });
});
