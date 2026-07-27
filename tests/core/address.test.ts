/**
 * §9.1 address.test.ts: parse/format round-trip for E 1.7, M 100.4, M100.4, AW 6, MW 131,
 * T 10, Z 1; rejects M 100.8, Q 0.0, AW 6.1, negative bytes; range checks (M byte ≤ 255).
 */
import { describe, expect, it } from 'vitest';
import {
  bitAddressEquals, formatAddress, parseAddress, parseAddressDetailed,
} from '../../src/core';

describe('parseAddress / formatAddress round-trip', () => {
  it.each([
    ['E 1.7',  { kind: 'bit', area: 'E', byte: 1, bit: 7 }],
    ['M 100.4', { kind: 'bit', area: 'M', byte: 100, bit: 4 }],
    ['M100.4', { kind: 'bit', area: 'M', byte: 100, bit: 4 }],
    ['A 4.0',  { kind: 'bit', area: 'A', byte: 4, bit: 0 }],
    ['AW 6',   { kind: 'word', area: 'AW', byte: 6 }],
    ['AW6',    { kind: 'word', area: 'AW', byte: 6 }],
    ['MW 131', { kind: 'word', area: 'MW', byte: 131 }],
    ['EW 0',   { kind: 'word', area: 'EW', byte: 0 }],
    ['T 10',   { kind: 'timer', n: 10 }],
    ['T10',    { kind: 'timer', n: 10 }],
    ['Z 1',    { kind: 'counter', n: 1 }],
    ['Z1',     { kind: 'counter', n: 1 }],
  ] as const)('parses %s', (text, expected) => {
    expect(parseAddress(text)).toEqual(expected);
  });

  it('tolerates the Variablenliste double-space form "M  100.5"', () => {
    expect(parseAddress('M  100.5')).toEqual({ kind: 'bit', area: 'M', byte: 100, bit: 5 });
  });

  it.each([
    ['E 1.7'], ['M 100.4'], ['AW 6'], ['MW 131'], ['T 10'], ['Z 1'],
  ])('format(parse(%s)) is canonical', (text) => {
    expect(formatAddress(parseAddress(text)!)).toBe(text);
  });

  it('canonicalizes compact forms', () => {
    expect(formatAddress(parseAddress('M100.4')!)).toBe('M 100.4');
    expect(formatAddress(parseAddress('T10')!)).toBe('T 10');
  });
});

describe('rejections', () => {
  it.each([
    ['M 100.8'],      // bit > 7
    ['Q 0.0'],        // unknown area
    ['AW 6.1'],       // word with bit
    ['M -1.0'],       // negative byte
    ['E -2.3'],
    ['T -1'],
    [''],
    ['M'],
    ['M 100'],        // bit address without bit
    ['100.4'],
    ['DB 1'],         // block, not an Address
  ])('rejects %s', (text) => {
    expect(parseAddress(text)).toBeNull();
  });

  it.each([
    ['M 256.0'],      // M byte ≤ 255
    ['E 16.0'],       // E bytes 0..15
    ['A 16.7'],
    ['T 128'],        // T 0..127
    ['Z 128'],
    ['AW 15'],        // word needs byte+1 ≤ 15
    ['EW 15'],
    ['MW 255'],       // word needs byte+1 ≤ 255
  ])('rejects out-of-range %s', (text) => {
    expect(parseAddress(text)).toBeNull();
  });
});

describe('parseAddressDetailed failure classification (E-ADR-001 vs E-ADR-002)', () => {
  it('classifies malformed', () => {
    expect(parseAddressDetailed('Q 0.0')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseAddressDetailed('AW 6.1')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseAddressDetailed('M -1.0')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('classifies out-of-range', () => {
    expect(parseAddressDetailed('M 256.0')).toEqual({ ok: false, reason: 'range' });
    expect(parseAddressDetailed('M 100.8')).toEqual({ ok: false, reason: 'range' });
    expect(parseAddressDetailed('T 128')).toEqual({ ok: false, reason: 'range' });
    expect(parseAddressDetailed('AW 15')).toEqual({ ok: false, reason: 'range' });
  });
});

describe('bitAddressEquals', () => {
  it('compares area/byte/bit', () => {
    const a = parseAddress('M 1.4')!;
    const b = parseAddress('M1.4')!;
    const c = parseAddress('M 1.5')!;
    const d = parseAddress('E 1.4')!;
    expect(a.kind === 'bit' && b.kind === 'bit' && bitAddressEquals(a, b)).toBe(true);
    expect(a.kind === 'bit' && c.kind === 'bit' && bitAddressEquals(a, c)).toBe(false);
    expect(a.kind === 'bit' && d.kind === 'bit' && bitAddressEquals(a, d)).toBe(false);
  });
});
