/**
 * §9.1 loadtransfer.test.ts: `L 7 / L 9` → accu2=7 accu1=9 (Anleitung example); `T AW 6`
 * writes big-endian; L/T change neither VKE nor ERAB mid-string (the `L Z1 / L 3 / <I /
 * U x` pattern from the solutions works).
 */
import { describe, expect, it } from 'vitest';
import { parseAddress } from '../../src/core';
import { bit, loadOrThrow, makeEmulator } from './fixtures';

describe('accu shift', () => {
  it('L 7 / L 9 → accu2=7, accu1=9 (Anleitung example)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 7\nL 9');
    em.step(50);
    const st = em.getStatus();
    expect(st.accu2).toBe(7);
    expect(st.accu1).toBe(9);
  });

  it('int literals are sign-extended 16→32', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L -1\nL -32768');
    em.step(50);
    const st = em.getStatus();
    expect(st.accu2).toBe(0xffffffff);
    expect(st.accu1).toBe(0xffff8000);
  });

  it('L S5T# loads the encoded word, L C# loads BCD', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L S5T#300MS\nL C#010');
    em.step(50);
    const st = em.getStatus();
    expect(st.accu2).toBe(0x0030);     // S5T#300MS: base 10 ms, BCD 030
    expect(st.accu1).toBe(0x0010);     // C#010 as BCD
  });
});

describe('T transfer', () => {
  it('T AW 6 writes big-endian (high byte at 6, low byte at 7)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 258\nT AW 6');   // 258 = 0x0102
    em.step(50);
    expect(em.memory.outputs[6]).toBe(0x01);
    expect(em.memory.outputs[7]).toBe(0x02);
    expect(em.peekWord('AW 6')).toBe(258);
    expect(em.peekWord('Fahrstrom')).toBe(258);     // symbol resolution in peekWord
  });

  it('T MW round-trips through L MW', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 4660\nT MW 12\nL 0\nL MW 12\nT MW 14');
    em.step(50);
    expect(em.peekWord('MW 12')).toBe(4660);
    expect(em.peekWord('MW 14')).toBe(4660);
    expect(em.memory.flags[12]).toBe(0x12);         // 4660 = 0x1234, big-endian
    expect(em.memory.flags[13]).toBe(0x34);
  });

  it('T writes only the low word of accu1', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L -1\nT MW 12');
    em.step(50);
    expect(em.peekWord('MW 12')).toBe(0xffff);
  });
});

describe('VKE-neutrality of L and T', () => {
  it('L inside a string does not break the AND chain', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL 3\nU E 0.1\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // still ANDed, not a fresh load
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // first operand still participates
  });

  it('the solutions pattern L Z1 / L 3 / <I / U x works', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L Z 1\nL 3\n<I\nU E 0.0\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // Z1=0 < 3 AND E0.0
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('T inside a string does not reset ERAB either', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL 5\nT MW 12\nU E 0.1\n= M 10.0');
    em.setInputBit(bit('E 0.0'), false);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // 0 AND 1 — E 0.0 still counts
  });

  it('L/T leave VKE and ERAB values untouched (status view)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL 7\nT MW 12');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    const st = em.getStatus();
    expect(st.vke).toBe(true);
    expect(st.erab).toBe(true);                     // string still open after L/T
  });

  it('peekWord accepts WordAddress objects too', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'L 99\nT MW 12');
    em.step(50);
    const a = parseAddress('MW 12')!;
    expect(a.kind).toBe('word');
    if (a.kind === 'word') expect(em.peekWord(a)).toBe(99);
  });
});
