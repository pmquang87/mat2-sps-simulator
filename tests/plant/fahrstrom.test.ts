/**
 * §9.2 fahrstrom.test.ts: each single M120 bit → correct word/level/command; STOP
 * dominates; multi-bit priority; word→speed/command uses the meta table. (The
 * `speedConflict` EVENT is the SimCoordinator's job — §5.2 — and is asserted in
 * coordinator.test.ts, not here.)
 */
import { describe, expect, it } from 'vitest';
import { AW6_GU_FLAG, M120_BIT, bitsToWord, wordToTarget } from '../../src/plant';
import { miniPlan } from './fixtures/miniplan';

const bit = (n: number): number => 1 << n;
const meta = miniPlan().meta; // speeds 100/200/600

describe('bitsToWord (FB1 sim)', () => {
  it('maps each single M120 bit to its AW6 word', () => {
    expect(bitsToWord(bit(M120_BIT.STOP))).toBe(0);
    expect(bitsToWord(bit(M120_BIT.Speed1IU))).toBe(1);
    expect(bitsToWord(bit(M120_BIT.Speed2IU))).toBe(2);
    expect(bitsToWord(bit(M120_BIT.Speed3IU))).toBe(3);
    expect(bitsToWord(bit(M120_BIT.Speed1GU))).toBe(AW6_GU_FLAG | 1);
    expect(bitsToWord(bit(M120_BIT.Speed2GU))).toBe(AW6_GU_FLAG | 2);
    expect(bitsToWord(bit(M120_BIT.Speed3GU))).toBe(AW6_GU_FLAG | 3);
  });

  it('returns 0 (stop) when no bit is set', () => {
    expect(bitsToWord(0)).toBe(0);
  });

  it('lets STOP dominate every speed bit', () => {
    expect(bitsToWord(bit(M120_BIT.STOP) | bit(M120_BIT.Speed3IU))).toBe(0);
    expect(bitsToWord(bit(M120_BIT.STOP) | bit(M120_BIT.Speed1GU) | bit(M120_BIT.Speed2IU))).toBe(0);
    expect(bitsToWord(0x7f)).toBe(0); // all seven bits
  });

  it('applies the §12 priority on multi-set: 1IU > 2IU > 3IU > 1GU > 2GU > 3GU', () => {
    expect(bitsToWord(bit(M120_BIT.Speed1IU) | bit(M120_BIT.Speed3IU))).toBe(1);
    expect(bitsToWord(bit(M120_BIT.Speed2IU) | bit(M120_BIT.Speed3IU))).toBe(2);
    expect(bitsToWord(bit(M120_BIT.Speed3IU) | bit(M120_BIT.Speed1GU))).toBe(3); // any IU beats any GU
    expect(bitsToWord(bit(M120_BIT.Speed1GU) | bit(M120_BIT.Speed3GU))).toBe(AW6_GU_FLAG | 1);
    expect(bitsToWord(bit(M120_BIT.Speed2GU) | bit(M120_BIT.Speed3GU))).toBe(AW6_GU_FLAG | 2);
  });

  it('ignores bits above the M120 interface byte', () => {
    expect(bitsToWord(0x100 | bit(M120_BIT.Speed1IU))).toBe(1);
  });
});

describe('wordToTarget', () => {
  it('decodes 0 as STOP', () => {
    expect(wordToTarget(0, meta)).toEqual({ speedMmS: 0, command: 'STOP' });
  });

  it('decodes IU levels via the meta speed table', () => {
    expect(wordToTarget(1, meta)).toEqual({ speedMmS: 100, command: 'IU' });
    expect(wordToTarget(2, meta)).toEqual({ speedMmS: 200, command: 'IU' });
    expect(wordToTarget(3, meta)).toEqual({ speedMmS: 600, command: 'IU' });
  });

  it('decodes GU levels (bit 8 set) via the meta speed table', () => {
    expect(wordToTarget(AW6_GU_FLAG | 1, meta)).toEqual({ speedMmS: 100, command: 'GU' });
    expect(wordToTarget(AW6_GU_FLAG | 2, meta)).toEqual({ speedMmS: 200, command: 'GU' });
    expect(wordToTarget(AW6_GU_FLAG | 3, meta)).toEqual({ speedMmS: 600, command: 'GU' });
  });

  it('decodes invalid words defensively as STOP', () => {
    expect(wordToTarget(4, meta)).toEqual({ speedMmS: 0, command: 'STOP' });
    expect(wordToTarget(0xff, meta)).toEqual({ speedMmS: 0, command: 'STOP' });
    expect(wordToTarget(AW6_GU_FLAG, meta)).toEqual({ speedMmS: 0, command: 'STOP' }); // GU flag, level 0
    expect(wordToTarget(AW6_GU_FLAG | 9, meta)).toEqual({ speedMmS: 0, command: 'STOP' });
  });

  it('round-trips every single-bit M120 command through both functions', () => {
    const cases: { m120: number; speedMmS: number; command: 'IU' | 'GU' | 'STOP' }[] = [
      { m120: bit(M120_BIT.STOP), speedMmS: 0, command: 'STOP' },
      { m120: bit(M120_BIT.Speed1IU), speedMmS: 100, command: 'IU' },
      { m120: bit(M120_BIT.Speed2IU), speedMmS: 200, command: 'IU' },
      { m120: bit(M120_BIT.Speed3IU), speedMmS: 600, command: 'IU' },
      { m120: bit(M120_BIT.Speed1GU), speedMmS: 100, command: 'GU' },
      { m120: bit(M120_BIT.Speed2GU), speedMmS: 200, command: 'GU' },
      { m120: bit(M120_BIT.Speed3GU), speedMmS: 600, command: 'GU' },
    ];
    for (const c of cases) {
      expect(wordToTarget(bitsToWord(c.m120), meta)).toEqual({ speedMmS: c.speedMmS, command: c.command });
    }
  });
});
