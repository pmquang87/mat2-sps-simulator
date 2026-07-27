/**
 * §9.1 symbols.test.ts: case-sensitive lookup("xW03CR") → undefined but suggest("xW03CR")
 * → XW03CR; XW05BH1G3R likewise; reverse byAddress; 42-switch / 23-reed counts from the
 * real generated file (skipped cleanly while src/data/variables.json does not exist yet).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VariablesFile } from '../../src/core';
import { SymbolTable, parseAddress, parseBlockRef } from '../../src/core';
import { FIXTURE_VARIABLES, makeSymbols } from './fixtures';

describe('SymbolTable — case-sensitive lookup with suggestions', () => {
  const table = makeSymbols();

  it('finds exact spellings', () => {
    expect(table.lookup('XW03CR')?.target).toEqual(parseAddress('M 109.7'));
    expect(table.lookup('XW05BH1G3R')).toBeDefined();
    expect(table.lookup('xR01A')?.target).toEqual(parseAddress('E 1.4'));
  });

  it('lookup("xW03CR") does NOT find "XW03CR" (the practicum trap)', () => {
    expect(table.lookup('xW03CR')).toBeUndefined();
  });

  it('suggest("xW03CR") → XW03CR', () => {
    const suggestions = table.suggest('xW03CR');
    expect(suggestions.map((s) => s.symbol)).toEqual(['XW03CR']);
  });

  it('XW05BH1G3R likewise: wrong-case lookup fails, suggestion finds it', () => {
    expect(table.lookup('xW05BH1G3R')).toBeUndefined();
    expect(table.suggest('xW05BH1G3R').map((s) => s.symbol)).toEqual(['XW05BH1G3R']);
    expect(table.suggest('xw05bh1g3r').map((s) => s.symbol)).toEqual(['XW05BH1G3R']);
  });

  it('suggest of an unknown name returns []', () => {
    expect(table.suggest('DoesNotExist')).toEqual([]);
  });

  it('reverse byAddress', () => {
    expect(table.byAddress(parseAddress('M 109.7')!)?.symbol).toBe('XW03CR');
    expect(table.byAddress(parseAddress('M 100.5')!)?.symbol).toBe('xW04BH1G4G');
    expect(table.byAddress(parseAddress('AW 6')!)?.symbol).toBe('Fahrstrom');
    expect(table.byAddress(parseAddress('T 1')!)?.symbol).toBe('Schaltzeit');
    expect(table.byAddress(parseAddress('M 0.0')!)).toBeUndefined();
  });

  it('all() preserves entries and order', () => {
    expect(table.all().length).toBe(FIXTURE_VARIABLES.entries.length);
    expect(table.all()[0]?.symbol).toBe('xW04BH1G4G');
  });

  it('block entries resolve to BlockRef and are excluded from byAddress', () => {
    expect(table.lookup('FahrstromFB')?.target).toEqual({ kind: 'block', blockType: 'FB', n: 1 });
  });
});

describe('SymbolTable.fromVariables validation', () => {
  it('throws on invalid address', () => {
    const doc: VariablesFile = {
      version: 1, generatedFrom: 'x', generatedAt: 'x',
      entries: [{ symbol: 'Bad', address: 'Q 0.0', type: 'BOOL' }],
    };
    expect(() => SymbolTable.fromVariables(doc)).toThrow(/Bad/);
  });

  it('throws on unknown data type', () => {
    const doc = {
      version: 1, generatedFrom: 'x', generatedAt: 'x',
      entries: [{ symbol: 'Bad', address: 'M 10.0', type: 'REAL' }],
    } as unknown as VariablesFile;
    expect(() => SymbolTable.fromVariables(doc)).toThrow(/data type/);
  });
});

describe('parseBlockRef', () => {
  it('parses block references', () => {
    expect(parseBlockRef('FB 1')).toEqual({ kind: 'block', blockType: 'FB', n: 1 });
    expect(parseBlockRef('OB 121')).toEqual({ kind: 'block', blockType: 'OB', n: 121 });
    expect(parseBlockRef('UDT1')).toEqual({ kind: 'block', blockType: 'UDT', n: 1 });
    expect(parseBlockRef('M 10.0')).toBeNull();
  });
});

// ── the real generated file (data agent's output) — skip cleanly if absent ──
const variablesJsonPath = resolve('src/data/variables.json');   // vitest cwd = project root
const haveRealFile = existsSync(variablesJsonPath);

describe.skipIf(!haveRealFile)('real variables.json invariants (42 switches / 23 reeds)', () => {
  const doc = haveRealFile
    ? (JSON.parse(readFileSync(variablesJsonPath, 'utf8')) as VariablesFile)
    : ({ version: 1, generatedFrom: '', generatedAt: '', entries: [] } as VariablesFile);
  const table = SymbolTable.fromVariables(doc);

  it('has 84 switch-coil bits (42 switches × G+R)', () => {
    const coils = table.all().filter((e) => /^xW/i.test(e.symbol) && e.dataType === 'BOOL');
    expect(coils.length).toBe(84);
    expect(coils.filter((e) => e.symbol.endsWith('G')).length).toBe(42);
    expect(coils.filter((e) => e.symbol.endsWith('R')).length).toBe(42);
  });

  it('has 23 reed inputs', () => {
    const reeds = table.all().filter((e) => /^xR/i.test(e.symbol) && e.dataType === 'BOOL');
    expect(reeds.length).toBe(23);
  });

  it('keeps the two uppercase-X trap spellings', () => {
    expect(table.lookup('XW03CR')).toBeDefined();
    expect(table.lookup('XW05BH1G3R')).toBeDefined();
    expect(table.lookup('xW03CR')).toBeUndefined();
    expect(table.lookup('xW05BH1G3R')).toBeUndefined();
  });
});
