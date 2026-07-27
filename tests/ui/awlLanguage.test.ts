/**
 * AWL syntax-highlighting tests (ARCHITECTURE.md §3 editor, §5.1.4 mnemonic set).
 *
 * The StreamLanguage parser is pure JS, so it runs in the node environment: parse a snippet
 * and assert the token classes the highlighter will colour.
 */
import { describe, expect, it } from 'vitest';
import { AWL_MNEMONICS, awlLanguage } from '../../src/ui/editor/awlLanguage';

interface Token { name: string; text: string; }

function tokens(source: string): Token[] {
  const tree = awlLanguage.parser.parse(source);
  const out: Token[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Document') return;
      out.push({ name: node.name, text: source.slice(node.from, node.to) });
    },
  });
  return out;
}

function classOf(source: string, text: string): string | undefined {
  return tokens(source).find((token) => token.text === text)?.name;
}

describe('AWL mnemonic set', () => {
  it('covers the Milestone-1 instruction set (§5.1.4)', () => {
    for (const mnemonic of ['U', 'UN', 'O', 'ON', 'X', 'XN', '=', 'S', 'R', 'L', 'T',
                            'SI', 'SV', 'SE', 'SS', 'SA', 'FR', 'FP', 'FN', 'ZV', 'ZR',
                            '==I', '<>I', '>I', '>=I', '<I', '<=I',
                            'SPA', 'SPB', 'SPBN', 'NOP']) {
      expect(AWL_MNEMONICS).toContain(mnemonic);
    }
  });
});

describe('tokenizer', () => {
  it('highlights comments to the end of the line', () => {
    expect(classOf('U E 0.0   // Netzwerk 1', '// Netzwerk 1')).toBe('lineComment');
  });

  it('recognises bit, word, timer and counter addresses', () => {
    expect(classOf('U E 0.0', 'E 0.0')).toBe('typeName');
    expect(classOf('=     M 120.3', 'M 120.3')).toBe('typeName');
    expect(classOf('T AW 6', 'AW 6')).toBe('typeName');
    expect(classOf('U T 10', 'T 10')).toBe('typeName');
    expect(classOf('L Z 1', 'Z 1')).toBe('typeName');
  });

  it('keeps mnemonics and addresses apart for the T/M overlap', () => {
    expect(classOf('T AW 6', 'T')).toBe('keyword');
    expect(classOf('SV T 10', 'SV')).toBe('keyword');
  });

  it('recognises quoted symbolic operands and flags unterminated ones', () => {
    expect(classOf('U "NotausBit"', '"NotausBit"')).toBe('string');
    expect(classOf('U "NotausBit', '"NotausBit')).toBe('invalid');
  });

  it('recognises S5TIME and counter literals', () => {
    expect(classOf('L S5T#300MS', 'S5T#300MS')).toBe('number');
    expect(classOf('L S5T#4S500MS', 'S5T#4S500MS')).toBe('number');
    expect(classOf('L C#010', 'C#010')).toBe('number');
    expect(classOf('L S5T#nonsense', 'S5T#nonsense')).toBe('invalid');
  });

  it('recognises compare and assignment operators', () => {
    expect(classOf('<I', '<I')).toBe('compareOperator');
    expect(classOf('==I', '==I')).toBe('compareOperator');
    expect(classOf('>=I', '>=I')).toBe('compareOperator');
    expect(classOf('=  M 10.0', '=')).toBe('definitionOperator');
  });

  it('recognises label definitions and jump targets', () => {
    expect(classOf('M001: NOP 0', 'M001:')).toBe('labelName');
    expect(classOf('SPA M001', 'M001')).toBe('labelName');
    expect(classOf('SPBN M002', 'SPBN')).toBe('keyword');
  });

  it('treats unknown words as plain identifiers, not instructions', () => {
    expect(classOf('UND E 0.0', 'UND')).toBe('variableName');
  });

  it('parses a multi-line network without invalid tokens', () => {
    const source = [
      '// Netzwerk 1',
      'U     E 0.0        // Reedkontakt',
      'L     S5T#300MS',
      'SV    T 10',
      'U     T 10',
      '=     M 100.0',
      'L     Z 1',
      'L     3',
      '<I',
      'S     M 10.0',
    ].join('\n');
    expect(tokens(source).filter((token) => token.name === 'invalid')).toEqual([]);
  });
});
