/**
 * Shared test fixtures for tests/core/** — a neutral symbol table shaped like the
 * Variablenliste (schema §7.2) plus emulator helpers. Uses only symbols that appear in
 * committed docs (ARCHITECTURE.md §7.2 / §9.1); addresses of made-up helper symbols are
 * arbitrary but consistent.
 */
import type { BitAddress, VariablesFile } from '../../src/core';
import { Emulator, SymbolTable, parseAddress } from '../../src/core';

export const FIXTURE_VARIABLES: VariablesFile = {
  version: 1,
  generatedFrom: 'fixture',
  generatedAt: '2026-07-27',
  entries: [
    { symbol: 'xW04BH1G4G', address: 'M 100.5', type: 'BOOL', comment: '' },
    { symbol: 'xW04BH1G4R', address: 'M 106.5', type: 'BOOL', comment: '' },
    { symbol: 'XW03CR',     address: 'M 109.7', type: 'BOOL', comment: '',
      note: 'uppercase X exactly as in Variablenliste — case-sensitivity trap' },
    { symbol: 'XW05BH1G3R', address: 'M 107.0', type: 'BOOL', comment: '',
      note: 'uppercase X exactly as in Variablenliste — case-sensitivity trap' },
    { symbol: 'xR01A',      address: 'E 1.4',   type: 'BOOL', comment: '' },
    { symbol: 'xR01D',      address: 'E 2.0',   type: 'BOOL', comment: '' },
    { symbol: 'NotausBit',  address: 'E 1.7',   type: 'BOOL',
      comment: 'Notaus', commentEn: 'Emergency stop (fail-safe: 0 = active)' },
    { symbol: 'NotausNF',   address: 'M 121.0', type: 'BOOL', comment: '' },
    { symbol: 'STOP',       address: 'M 120.3', type: 'BOOL',
      comment: 'Stillstand des Zuges', commentEn: 'Train standstill' },
    { symbol: 'Fahrstrom',  address: 'AW 6',    type: 'WORD',
      comment: 'Fahrstrom der Lok', commentEn: 'Traction current word' },
    { symbol: 'Schaltzeit', address: 'T 1',     type: 'TIMER',
      comment: 'systemseitig', commentEn: 'system timer — not for students' },
    { symbol: 'Zaehler1',   address: 'Z 1',     type: 'COUNTER', comment: '' },
    { symbol: 'FahrstromFB', address: 'FB 1',   type: 'BLOCK', comment: '' },
  ],
};

export function makeSymbols(): SymbolTable {
  return SymbolTable.fromVariables(FIXTURE_VARIABLES);
}

export function makeEmulator(): Emulator {
  return new Emulator(makeSymbols());
}

/** Parse a bit address or fail the test loudly. */
export function bit(text: string): BitAddress {
  const a = parseAddress(text);
  if (!a || a.kind !== 'bit') throw new Error(`fixture: not a bit address: ${text}`);
  return a;
}

/** Load a program and throw on diagnostics-with-errors — for tests where loading must work. */
export function loadOrThrow(em: Emulator, source: string): void {
  const res = em.load(source);
  if (!res.ok) {
    const msgs = res.diagnostics.map((d) => `${d.code}@${d.line}: ${d.message.en}`).join('; ');
    throw new Error(`fixture: program failed to load: ${msgs}`);
  }
}

/** Step the emulator n times with a fixed dt (default 50 ms scan). */
export function stepN(em: Emulator, n: number, dtMs = 50): void {
  for (let i = 0; i < n; i++) em.step(dtMs);
}
