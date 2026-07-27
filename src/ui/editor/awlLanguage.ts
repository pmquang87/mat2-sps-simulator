/**
 * CodeMirror 6 language mode for AWL/STL (ARCHITECTURE.md §3, §5.1.4).
 *
 * A StreamLanguage is deliberate: AWL is line-oriented (one instruction per line, no
 * nesting in M1), so a stream tokenizer covers the whole M1 mnemonic set without a lezer
 * grammar. Token classes: line comments, the M1 mnemonics, compare/assign operators,
 * addresses (E/A/M bits, EW/AW/MW words, T, Z), S5T#/C#/integer literals, quoted symbolic
 * operands (exact case preserved — the §5.1.2 practicum trap) and jump labels.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { StreamParser, StringStream } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

/** The Milestone-1 mnemonic set (§5.1.4 `Mnemonic`), in menu order. */
export const AWL_MNEMONICS: readonly string[] = [
  'U', 'UN', 'O', 'ON', 'X', 'XN',
  '=', 'S', 'R',
  'L', 'T',
  'SI', 'SV', 'SE', 'SS', 'SA', 'FR',
  'FP', 'FN',
  'ZV', 'ZR',
  '==I', '<>I', '>I', '>=I', '<I', '<=I',
  'SPA', 'SPB', 'SPBN',
  'NOP',
];

/** Word-shaped mnemonics only (the operator-shaped ones are matched by regex). */
const WORD_MNEMONICS = new Set(
  AWL_MNEMONICS.filter((m) => /^[A-Z]+$/.test(m)),
);
const JUMP_MNEMONICS = new Set(['SPA', 'SPB', 'SPBN']);

interface AwlState {
  /** Set after SPA/SPB/SPBN so the following word is highlighted as a jump target. */
  afterJump: boolean;
  /** False until the first non-whitespace token of the current line was consumed. */
  lineHasToken: boolean;
}

/** `stream.match(regexp)` is typed as `boolean | RegExpMatchArray | null`; narrow it. */
function matchText(stream: StringStream, pattern: RegExp): string | null {
  const result = stream.match(pattern);
  if (result === null || typeof result === 'boolean') return null;
  return result[0] ?? null;
}

const awlParser: StreamParser<AwlState> = {
  name: 'awl',

  startState: (): AwlState => ({ afterJump: false, lineHasToken: false }),

  token(stream, state): string | null {
    if (stream.sol()) {
      state.afterJump = false;
      state.lineHasToken = false;
    }
    if (stream.eatSpace()) return null;

    // Comments run to the end of the line.
    if (stream.match('//') === true) {
      stream.skipToEnd();
      return 'lineComment';
    }

    const firstOnLine = !state.lineHasToken;
    state.lineHasToken = true;

    // Label definition, only as the first token of a line: "M001:".
    if (firstOnLine && matchText(stream, /^[A-Za-z][A-Za-z0-9_]{0,3}\s*:/) !== null) {
      return 'labelName';
    }

    // Quoted symbolic operand — case is significant (§5.1.2).
    if (stream.peek() === '"') {
      stream.next();
      let closed = false;
      while (!stream.eol()) {
        if (stream.next() === '"') {
          closed = true;
          break;
        }
      }
      return closed ? 'string' : 'invalid';       // E-LEX-002 shape: unterminated symbol
    }

    // Jump target after SPA/SPB/SPBN.
    if (state.afterJump && matchText(stream, /^[A-Za-z][A-Za-z0-9_]{0,3}(?![\w.])/) !== null) {
      state.afterJump = false;
      return 'labelName';
    }

    // Literals: S5T#…, C#…
    if (matchText(stream, /^S5T#\d+(?:MS|H|M|S)(?:\d+(?:MS|H|M|S))*(?![\w#])/i) !== null) return 'number';
    if (matchText(stream, /^S5T#[\w.#]*/i) !== null) return 'invalid';        // E-SYN-003 shape
    if (matchText(stream, /^C#\d{1,3}(?![\w#])/) !== null) return 'number';
    if (matchText(stream, /^C#[\w.#]*/i) !== null) return 'invalid';

    // Compare operators (the Anleitung also prints "== I" with a space) and assignment.
    if (matchText(stream, /^(?:==|<>|>=|<=|>|<)[ \t]?I(?![\w])/i) !== null) return 'compareOperator';
    if (matchText(stream, /^=(?!=)/) !== null) return 'definitionOperator';

    // Addresses: word areas first (EW/AW/MW), then bit areas, then timers/counters.
    if (matchText(stream, /^(?:EW|AW|MW)[ \t]*\d+(?![\w.])/i) !== null) return 'typeName';
    if (matchText(stream, /^[EAM][ \t]*\d+\.\d(?![\w.])/i) !== null) return 'typeName';
    if (matchText(stream, /^[TZ][ \t]*\d+(?![\w.])/i) !== null) return 'typeName';

    // Mnemonic or unquoted symbol.
    const word = matchText(stream, /^[A-Za-z][A-Za-z0-9_]*/);
    if (word !== null) {
      const upper = word.toUpperCase();
      if (JUMP_MNEMONICS.has(upper)) {
        state.afterJump = true;
        return 'keyword';
      }
      return WORD_MNEMONICS.has(upper) ? 'keyword' : 'variableName';
    }

    if (matchText(stream, /^[+-]?\d+/) !== null) return 'integer';

    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '//' },
  },
};

export const awlLanguage = StreamLanguage.define(awlParser);

/** Colours come from CSS custom properties in ui/styles.css, so the editor follows the
 *  app palette (and a future light theme) without a second colour table. */
export const awlHighlightStyle = HighlightStyle.define([
  { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.compareOperator, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.definitionOperator, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syn-address)' },
  { tag: tags.string, color: 'var(--syn-symbol)' },
  { tag: tags.number, color: 'var(--syn-literal)' },
  { tag: tags.integer, color: 'var(--syn-literal)' },
  { tag: tags.labelName, color: 'var(--syn-label)', fontWeight: '600' },
  { tag: tags.variableName, color: 'var(--syn-plain)' },
  { tag: tags.invalid, color: 'var(--syn-invalid)', textDecoration: 'underline wavy' },
]);

/** Language + highlighting, ready to drop into the EditorView extensions. */
export function awl(): Extension {
  return [awlLanguage, syntaxHighlighting(awlHighlightStyle)];
}
