/**
 * Autocompletion tests (ARCHITECTURE.md §3 editor): the completion source must reproduce the
 * practicum's Atom + variablen.txt workflow — typing a quote offers the plant symbols with
 * their EXACT spelling, including the upper-case-X traps (§5.1.2).
 *
 * CompletionContext only needs an EditorState, so this runs headless in the node environment.
 */
import { CompletionContext } from '@codemirror/autocomplete';
import type { CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { SymbolEntry, SymbolTable } from '../../src/core';
import { awlCompletion, completionSymbolCount } from '../../src/ui/editor/completion';

const ENTRIES: SymbolEntry[] = [
  { symbol: 'xR01A', target: { kind: 'bit', area: 'E', byte: 1, bit: 4 }, dataType: 'BOOL' },
  { symbol: 'XW03CR', target: { kind: 'bit', area: 'M', byte: 109, bit: 7 }, dataType: 'BOOL' },
  {
    symbol: 'STOP',
    target: { kind: 'bit', area: 'M', byte: 120, bit: 3 },
    dataType: 'BOOL',
    comment: 'Stillstand des Zuges',
    commentEn: 'Train standstill',
  },
  { symbol: 'Fahrstrom', target: { kind: 'word', area: 'AW', byte: 6 }, dataType: 'WORD' },
  { symbol: 'Schaltzeit', target: { kind: 'timer', n: 1 }, dataType: 'TIMER' },
  { symbol: 'FahrstromFB', target: { kind: 'block', blockType: 'FB', n: 1 }, dataType: 'BLOCK' },
];

function fakeSymbols(entries: readonly SymbolEntry[]): SymbolTable {
  return {
    lookup: () => undefined,
    suggest: () => [],
    byAddress: () => undefined,
    all: () => entries,
  } as unknown as SymbolTable;
}

/** A SymbolTable whose all() throws — core is still a stub; completion must degrade. */
function brokenSymbols(): SymbolTable {
  return {
    all: () => {
      throw new Error('not implemented');
    },
  } as unknown as SymbolTable;
}

/** The AWL completion source is synchronous by design (a static symbol list). */
function complete(doc: string, symbols: SymbolTable | null): CompletionResult | null {
  const state = EditorState.create({ doc, selection: { anchor: doc.length } });
  const context = new CompletionContext(state, doc.length, true);
  const result = awlCompletion(symbols)(context);
  if (result instanceof Promise) throw new Error('awlCompletion must resolve synchronously');
  return result;
}

describe('awlCompletion', () => {
  it('offers only symbols inside a quoted operand, with the quote kept', () => {
    const result = complete('U     "xR', fakeSymbols(ENTRIES));
    expect(result).not.toBeNull();
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('"xR01A"');
    expect(labels).not.toContain('UN');
    expect(result?.from).toBe('U     '.length);      // replaces from the opening quote
  });

  it('preserves the exact spelling of the case-trap symbols', () => {
    const labels = complete('U "', fakeSymbols(ENTRIES))?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('"XW03CR"');
    expect(labels).not.toContain('"xW03CR"');
  });

  it('shows the address as the completion detail and the comment as info', () => {
    const options = complete('U "', fakeSymbols(ENTRIES))?.options ?? [];
    expect(options.find((o) => o.label === '"STOP"')?.detail).toBe('M 120.3');
    expect(options.find((o) => o.label === '"STOP"')?.info).toBe('Train standstill');
    expect(options.find((o) => o.label === '"Fahrstrom"')?.detail).toBe('AW 6');
    expect(options.find((o) => o.label === '"Schaltzeit"')?.detail).toBe('T 1');
    expect(options.find((o) => o.label === '"FahrstromFB"')?.detail).toBe('FB 1');
  });

  it('offers mnemonics and literals outside quotes', () => {
    const labels = complete('S', fakeSymbols(ENTRIES))?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('SV');
    expect(labels).toContain('SPBN');
    expect(labels).toContain('==I');
    expect(labels).toContain('S5T#300MS');
    expect(labels).toContain('"xR01A"');
  });

  it('works without a symbol table (mnemonics only)', () => {
    const labels = complete('U', null)?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('UN');
    expect(labels.filter((l) => l.startsWith('"'))).toEqual([]);
    expect(completionSymbolCount(null)).toBe(0);
  });

  it('degrades instead of throwing when the symbol table is not ready', () => {
    expect(() => complete('U "', brokenSymbols())).not.toThrow();
    expect(completionSymbolCount(brokenSymbols())).toBe(0);
  });
});
