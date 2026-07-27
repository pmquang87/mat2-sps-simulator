/**
 * §9.1 s5time.test.ts: bases, BCD, truncation toward the chosen base (never round up),
 * clamping, base promotion, range errors, literal permutations, canonical formatting.
 */
import { describe, expect, it } from 'vitest';
import {
  S5TIME_MAX_MS, decodeS5Time, encodeS5Time, formatS5Time, isValidS5Time, parseS5TimeLiteral,
} from '../../src/core';

describe('encodeS5Time', () => {
  it('S5T#300MS → base 10 ms, value 30', () => {
    const word = encodeS5Time(300);
    expect((word >> 12) & 0x3).toBe(0b00);          // 10 ms base
    expect(word & 0x0fff).toBe(0x030);              // BCD 030
  });

  it('4500 ms → base 10 ms, BCD 450', () => {
    expect(encodeS5Time(4500)).toBe(0x0450);
  });

  it('15300 ms → base 100 ms, BCD 153', () => {
    expect(encodeS5Time(15_300)).toBe(0x1153);
  });

  it('max 9990 s → base 10 s, BCD 999', () => {
    expect(encodeS5Time(9_990_000)).toBe(0x3999);
  });

  it('TRUNCATES toward the chosen base tick (STEP 7 "abgeschnitten")', () => {
    expect(decodeS5Time(encodeS5Time(305))).toBe(300);        // base 10 ms
    expect(decodeS5Time(encodeS5Time(12_345))).toBe(12_300);  // base 100 ms
    expect(decodeS5Time(encodeS5Time(9_999))).toBe(9_990);    // never rounds up
  });

  it('0..9 ms clamps to the 10 ms minimum', () => {
    expect(decodeS5Time(encodeS5Time(0))).toBe(10);
    expect(decodeS5Time(encodeS5Time(9))).toBe(10);
  });

  it('base promotion: 12 s no longer fits 10 ms base → 100 ms base', () => {
    const word = encodeS5Time(12_000);
    expect((word >> 12) & 0x3).toBe(0b01);
    expect(word & 0x0fff).toBe(0x120);
  });

  it('throws above 9990 s and below 0', () => {
    expect(() => encodeS5Time(S5TIME_MAX_MS + 1)).toThrow(RangeError);
    expect(() => encodeS5Time(-1)).toThrow(RangeError);
    expect(() => encodeS5Time(Number.NaN)).toThrow(RangeError);
  });
});

describe('decodeS5Time', () => {
  it('decodes base and BCD', () => {
    expect(decodeS5Time(0x0030)).toBe(300);
    expect(decodeS5Time(0x1153)).toBe(15_300);
    expect(decodeS5Time(0x2005)).toBe(5000);
    expect(decodeS5Time(0x3999)).toBe(9_990_000);
  });

  it('decode∘encode is identity on representable values', () => {
    for (const ms of [10, 50, 300, 990, 4500, 9990, 12_300, 100_000, 999_000, 9_990_000]) {
      expect(decodeS5Time(encodeS5Time(ms))).toBe(ms);
    }
  });

  it('rejects invalid BCD digits and out-of-range words', () => {
    expect(() => decodeS5Time(0x00af)).toThrow(RangeError);
    expect(() => decodeS5Time(-1)).toThrow(RangeError);
    expect(() => decodeS5Time(0x1_0000)).toThrow(RangeError);
  });

  it('ignores the irrelevant bits 15–14', () => {
    expect(decodeS5Time(0x0030 | 0x8000)).toBe(300);
  });
});

describe('isValidS5Time', () => {
  it('accepts valid words, rejects bad BCD', () => {
    expect(isValidS5Time(0x0030)).toBe(true);
    expect(isValidS5Time(0x3999)).toBe(true);
    expect(isValidS5Time(0x0003)).toBe(true);
    expect(isValidS5Time(0x000f)).toBe(false);
    expect(isValidS5Time(0x0a00)).toBe(false);
    expect(isValidS5Time(-1)).toBe(false);
    expect(isValidS5Time(0x1_0000)).toBe(false);
  });
});

describe('parseS5TimeLiteral', () => {
  it.each([
    ['S5T#300MS', 300],
    ['S5T#4S500MS', 4500],
    ['S5T#15S300MS', 15_300],
    ['S5T#1H10M', 4_200_000],
    ['S5T#2H46M30S', 9_990_000],
    ['S5T#1H', 3_600_000],
    ['S5T#5S', 5000],
    ['S5T#10M', 600_000],
    ['s5t#300ms', 300],                 // case-insensitive
    ['S5T#2S_500MS', 2500],             // underscore separators tolerated
  ])('parses %s → %d ms', (text, ms) => {
    expect(parseS5TimeLiteral(text)).toBe(ms);
  });

  it.each([
    ['S5T#'],           // empty
    ['S5T#XX'],
    ['S5T#5X'],
    ['S5T#MS'],         // unit without digits
    ['S5T#1MS2S'],      // wrong order
    ['S5T#1S1S'],       // repeated unit
    ['4S500MS'],        // missing prefix
    ['S5T#3H'],         // above the representable range
    ['T#300MS'],
  ])('rejects %s', (text) => {
    expect(parseS5TimeLiteral(text)).toBeNull();
  });
});

describe('formatS5Time', () => {
  it('canonical formatting', () => {
    expect(formatS5Time(4500)).toBe('S5T#4S500MS');
    expect(formatS5Time(300)).toBe('S5T#300MS');
    expect(formatS5Time(3_600_000)).toBe('S5T#1H');
    expect(formatS5Time(9_990_000)).toBe('S5T#2H46M30S');
    expect(formatS5Time(0)).toBe('S5T#0MS');
  });

  it('round-trips through the literal parser', () => {
    for (const ms of [10, 300, 4500, 15_300, 600_000, 9_990_000]) {
      expect(parseS5TimeLiteral(formatS5Time(ms))).toBe(ms);
    }
  });
});
