/**
 * §9.1 compare.test.ts: all six operators, signed 16-bit semantics (−1 < 3), VKE
 * replacement, chaining U after a compare (AND); compares leave the accus unchanged.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator } from './fixtures';

function runCompare(op: string, a2: number, a1: number): boolean {
  const em = makeEmulator();
  loadOrThrow(em, `L ${a2}\nL ${a1}\n${op}\n= M 10.0`);
  em.step(50);
  return em.peekBit('M 10.0');
}

describe('all six operators, accu2 OP accu1', () => {
  it('==I', () => {
    expect(runCompare('==I', 5, 5)).toBe(true);
    expect(runCompare('==I', 5, 3)).toBe(false);
  });
  it('<>I', () => {
    expect(runCompare('<>I', 5, 3)).toBe(true);
    expect(runCompare('<>I', 5, 5)).toBe(false);
  });
  it('>I', () => {
    expect(runCompare('>I', 5, 3)).toBe(true);
    expect(runCompare('>I', 3, 5)).toBe(false);
    expect(runCompare('>I', 5, 5)).toBe(false);
  });
  it('>=I', () => {
    expect(runCompare('>=I', 5, 5)).toBe(true);
    expect(runCompare('>=I', 3, 5)).toBe(false);
  });
  it('<I', () => {
    expect(runCompare('<I', 3, 5)).toBe(true);
    expect(runCompare('<I', 5, 3)).toBe(false);
    expect(runCompare('<I', 5, 5)).toBe(false);
  });
  it('<=I', () => {
    expect(runCompare('<=I', 5, 5)).toBe(true);
    expect(runCompare('<=I', 5, 3)).toBe(false);
  });

  it('accepts the PDF spelling with a space ("== I")', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 5\nL 5\n== I\n= M 10.0');
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
  });
});

describe('signed 16-bit semantics', () => {
  it('−1 < 3 (not unsigned 0xFFFF)', () => {
    expect(runCompare('<I', -1, 3)).toBe(true);
    expect(runCompare('>I', -1, 3)).toBe(false);
  });

  it('−32768 is the minimum', () => {
    expect(runCompare('<I', -32768, 32767)).toBe(true);
    expect(runCompare('<=I', -32768, -32768)).toBe(true);
  });
});

describe('VKE handling', () => {
  it('compare REPLACES the VKE (prior string state does not leak in)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL 1\nL 2\n<I\n= M 10.0');
    // E 0.0 = 0, but 1 < 2 → the compare result wins
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
  });

  it('a following U chains with AND', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 1\nL 2\n<I\nU E 0.0\n= M 10.0');
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // true AND E0.0(0)
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // true AND 1
  });

  it('a false compare keeps the AND chain false regardless of the input', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 2\nL 1\n<I\nU E 0.0\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });
});

describe('accus unchanged', () => {
  it('compare leaves accu1/accu2 as loaded', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 7\nL 9\n>I');
    em.step(50);
    const st = em.getStatus();
    expect(st.accu2).toBe(7);
    expect(st.accu1).toBe(9);
    expect(st.vke).toBe(false);                     // 7 > 9 is false
    expect(st.erab).toBe(true);                     // string stays open for chaining
  });
});
