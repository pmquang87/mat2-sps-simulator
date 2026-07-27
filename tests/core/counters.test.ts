/**
 * §9.1 counters.test.ts: ZV increments only on VKE rising edge (held VKE over many scans
 * → one count); ZV Z1 then L Z1 in the SAME cycle reads the incremented value; ZR
 * decrement; saturation 0/999; S Z presets from C#010 on edge; R Z levels; U Z n =
 * value ≠ 0.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

describe('ZV / ZR edge counting', () => {
  const PROGRAM = 'U E 0.0\nZV Z 1\nU E 0.1\nZR Z 1';

  it('ZV counts once per rising edge — held VKE over many scans is ONE count', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 10);
    expect(em.getCounter(1).value).toBe(1);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(2);
  });

  it('ZR decrements on its own rising edge', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                    // value 2
    em.setInputBit(bit('E 0.0'), false);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);                                    // ZR edge
    expect(em.getCounter(1).value).toBe(1);
  });

  it('ZV and ZR edges are independent (both in one scan cancel out)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nZV Z 1\nU E 0.0\nZR Z 1');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(0);         // +1 then −1 in the same scan
  });

  it('saturates at 0 (ZR below zero stays 0)', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.1'), true);
    stepN(em, 3);
    expect(em.getCounter(1).value).toBe(0);
  });

  it('saturates at 999 (ZV above the C# preset ceiling stays 999)', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.2\nL C#999\nS Z 1\nU E 0.0\nZV Z 1');
    em.setInputBit(bit('E 0.2'), true);
    em.step(50);                                    // preset 999
    expect(em.getCounter(1).value).toBe(999);
    em.setInputBit(bit('E 0.2'), false);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                    // ZV at 999
    expect(em.getCounter(1).value).toBe(999);
  });
});

describe('same-cycle read (the Gruppe A/B NW 3 pattern)', () => {
  it('ZV Z1 then L Z1 in the same cycle reads the incremented value', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nZV Z 1\nL Z 1\nT MW 12');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekWord('MW 12')).toBe(1);           // not the stale 0
    expect(em.getCounter(1).value).toBe(1);
  });

  it('compare on the same-cycle value switches within the counting scan', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nZV Z 1\nL Z 1\nL 3\n>=I\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // 1 >= 3 is false
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                    // 2
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                    // 3 — flips in THIS scan
    expect(em.peekBit('M 10.0')).toBe(true);
  });
});

describe('S Z (BCD preset) and R Z (level reset)', () => {
  const PROGRAM = 'U E 0.2\nL C#010\nS Z 1\nU E 0.3\nR Z 1\nU E 0.0\nZV Z 1';

  it('S Z presets from C#010 on the rising edge only', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.2'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(10);
    em.setInputBit(bit('E 0.0'), true);             // count up to 11
    em.step(50);
    expect(em.getCounter(1).value).toBe(11);
    stepN(em, 3);                                   // E 0.2 still held: no re-preset
    expect(em.getCounter(1).value).toBe(11);
    em.setInputBit(bit('E 0.2'), false);
    em.step(50);
    em.setInputBit(bit('E 0.2'), true);
    em.step(50);                                    // new edge → preset again
    expect(em.getCounter(1).value).toBe(10);
  });

  it('R Z clears by level while VKE=1', () => {
    const em = makeEmulator();
    loadOrThrow(em, PROGRAM);
    em.setInputBit(bit('E 0.2'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(10);
    em.setInputBit(bit('E 0.2'), false);
    em.setInputBit(bit('E 0.3'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(0);
    // program order decides within a scan: ZV comes AFTER R Z here, so a fresh ZV edge
    // still counts in that scan …
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.getCounter(1).value).toBe(1);
    // … but the held R level clears again next scan (no new ZV edge)
    em.step(50);
    expect(em.getCounter(1).value).toBe(0);
  });
});

describe('U Z n — counter status bit', () => {
  it('is value ≠ 0', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nZV Z 1\nU E 0.1\nZR Z 1\nU Z 1\n= M 10.0');
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // 0
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // 1
    expect(em.getCounter(1)).toMatchObject({ value: 1, q: true });
    em.setInputBit(bit('E 0.0'), false);
    em.setInputBit(bit('E 0.1'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);       // back to 0, same scan visibility
  });
});
