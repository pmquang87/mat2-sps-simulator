/**
 * §9.1 tokenizer.test.ts: mnemonics vs symbols, `//` comments, quoted symbols with exact
 * case, S5T#/C#/int literals, label definitions "M001:", compare mnemonics (`==I`, `<>I`,
 * also the PDF spelling `== I` with space → accepted), position tracking.
 */
import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/core';

describe('token classes', () => {
  it('mnemonic words vs quoted symbols', () => {
    const { tokens, diagnostics } = tokenize('U "xR01D"');
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['word', 'U'],
      ['quoted', 'xR01D'],
    ]);
  });

  it('quoted symbols keep exact case (XW03CR trap)', () => {
    const { tokens } = tokenize('UN "XW03CR"');
    expect(tokens[1]).toMatchObject({ kind: 'quoted', text: 'XW03CR' });
  });

  it('// comments run to end of line, full-line and trailing', () => {
    const { tokens, diagnostics } = tokenize('// Netzwerk 1\nU E 1.4 // trailing');
    expect(diagnostics).toEqual([]);
    expect(tokens[0]).toMatchObject({ kind: 'comment', text: '// Netzwerk 1', line: 1, col: 1 });
    const trailing = tokens.filter((t) => t.kind === 'comment' && t.line === 2);
    expect(trailing).toHaveLength(1);
    expect(trailing[0]!.text).toBe('// trailing');
    expect(tokens.filter((t) => t.line === 2).map((t) => t.kind)).toEqual([
      'word', 'word', 'number', 'comment',
    ]);
  });

  it('literals: S5T#, C#, int, negative int', () => {
    const { tokens, diagnostics } = tokenize('L S5T#4S500MS\nL C#010\nL 3\nL -5');
    expect(diagnostics).toEqual([]);
    const kinds = tokens.map((t) => [t.kind, t.text]);
    expect(kinds).toContainEqual(['s5time', 'S5T#4S500MS']);
    expect(kinds).toContainEqual(['counterLit', 'C#010']);
    expect(kinds).toContainEqual(['number', '3']);
    expect(kinds).toContainEqual(['number', '-5']);
  });

  it('address chunks: split and combined forms', () => {
    const { tokens } = tokenize('U M 100.4\nU M100.4\nU T10');
    expect(tokens.filter((t) => t.line === 1).map((t) => [t.kind, t.text])).toEqual([
      ['word', 'U'], ['word', 'M'], ['number', '100.4'],
    ]);
    expect(tokens.filter((t) => t.line === 2).map((t) => [t.kind, t.text])).toEqual([
      ['word', 'U'], ['word', 'M100.4'],
    ]);
    expect(tokens.filter((t) => t.line === 3).map((t) => [t.kind, t.text])).toEqual([
      ['word', 'U'], ['word', 'T10'],
    ]);
  });

  it('label definitions M001: at line start', () => {
    const { tokens, diagnostics } = tokenize('M001: NOP 0');
    expect(diagnostics).toEqual([]);
    expect(tokens.map((t) => [t.kind, t.text])).toEqual([
      ['labelDef', 'M001'], ['word', 'NOP'], ['number', '0'],
    ]);
  });

  it('a colon not in label position is E-LEX-001', () => {
    const { diagnostics } = tokenize('U M 1.0 : X');
    expect(diagnostics.map((d) => d.code)).toContain('E-LEX-001');
  });
});

describe('compare mnemonics', () => {
  it.each([
    ['==I', '==I'], ['<>I', '<>I'], ['>I', '>I'], ['>=I', '>=I'], ['<I', '<I'], ['<=I', '<=I'],
  ])('tokenizes %s', (src, normalized) => {
    const { tokens, diagnostics } = tokenize(src);
    expect(diagnostics).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'compare', text: normalized });
  });

  it('accepts the PDF spelling "== I" with a space, normalized to ==I', () => {
    const { tokens, diagnostics } = tokenize('== I');
    expect(diagnostics).toEqual([]);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'compare', text: '==I', length: 4 });
  });

  it('bare "=" stays the assignment mnemonic', () => {
    const { tokens } = tokenize('= M 10.0');
    expect(tokens[0]).toMatchObject({ kind: 'assign', text: '=' });
  });

  it('"<" without I is E-LEX-001', () => {
    const { diagnostics } = tokenize('<');
    expect(diagnostics.map((d) => d.code)).toEqual(['E-LEX-001']);
  });
});

describe('error positions', () => {
  it('unterminated quoted symbol → E-LEX-002 with position', () => {
    const { diagnostics } = tokenize('U E 1.4\nU "xR01D');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'E-LEX-002', line: 2, col: 3 });
    expect(diagnostics[0]!.message.de.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.message.en.length).toBeGreaterThan(0);
  });

  it('unknown character → E-LEX-001 with position', () => {
    const { diagnostics } = tokenize('U E 1.4\nU @ M 1.0');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'E-LEX-001', line: 2, col: 3 });
  });
});

describe('position tracking', () => {
  it('records 1-based line and column for every token', () => {
    const src = 'U "xR01A"\n  L S5T#300MS\nSV T 10';
    const { tokens } = tokenize(src);
    expect(tokens[0]).toMatchObject({ line: 1, col: 1 });        // U
    expect(tokens[1]).toMatchObject({ line: 1, col: 3, length: 7 }); // "xR01A"
    expect(tokens[2]).toMatchObject({ line: 2, col: 3 });        // L (indented)
    expect(tokens[3]).toMatchObject({ line: 2, col: 5 });        // S5T#300MS
    expect(tokens[4]).toMatchObject({ line: 3, col: 1 });        // SV
    expect(tokens[5]).toMatchObject({ line: 3, col: 4 });        // T
    expect(tokens[6]).toMatchObject({ line: 3, col: 6 });        // 10
  });

  it('handles CRLF and CR line endings', () => {
    const { tokens } = tokenize('U E 1.4\r\nO E 1.5\rON E 1.6');
    expect(tokens.filter((t) => t.text === 'O')[0]).toMatchObject({ line: 2, col: 1 });
    expect(tokens.filter((t) => t.text === 'ON')[0]).toMatchObject({ line: 3, col: 1 });
  });
});
