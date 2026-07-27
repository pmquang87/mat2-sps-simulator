/**
 * AWL lexer (ARCHITECTURE.md §3, §5.1.4): mnemonics, quoted symbols, literals, label
 * definitions, `//` comments. Pure text → token stream; no symbol resolution here.
 *
 * Compare mnemonics: `==I`, `<>I`, `>I`, `>=I`, `<I`, `<=I` — the PDF spelling with a
 * space (`== I`) is accepted and normalized (§9.1 tokenizer.test).
 */
import type { Diagnostic } from './diagnostics';
import { makeDiagnostic } from './diagnostics';

export type TokenKind =
  | 'word'         // bare identifier or address chunk: "U", "M", "M100.4", "T10", "M001"
  | 'number'       // "3", "-5", "100.4" (address tail), "0"
  | 'quoted'       // quoted symbol; `text` is the INNER name with exact case
  | 's5time'       // "S5T#4S500MS" (content validated by the parser)
  | 'counterLit'   // "C#010"
  | 'compare'      // normalized: "==I" | "<>I" | ">I" | ">=I" | "<I" | "<=I"
  | 'assign'       // "="
  | 'labelDef'     // "M001:" at line start; `text` is the name without the colon
  | 'comment';     // "// …" to end of line, incl. the slashes

export interface Token {
  kind: TokenKind;
  text: string;
  line: number;    // 1-based
  col: number;     // 1-based
  length: number;  // source length incl. quotes / colon
}

export interface TokenizeResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const COMPARE_RE = /^(==|<>|>=|<=|<|>)\s*I(?![A-Za-z0-9_])/i;
const S5TIME_RE  = /^S5T#[A-Za-z0-9_]*/i;
const COUNTER_RE = /^C#[A-Za-z0-9]*/i;
const WORD_RE    = /^[A-Za-z][A-Za-z0-9]*(?:\.[0-9]+)?/;
const NUMBER_RE  = /^-?[0-9]+(?:\.[0-9]+)?/;
const LABEL_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;   // 1–4 alphanumeric, starts with letter

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  for (let li = 0; li < lines.length; li++) {
    const lineText = lines[li]!;
    const lineNo = li + 1;
    let i = 0;
    let firstOnLine = true;

    while (i < lineText.length) {
      const ch = lineText[i]!;
      if (ch === ' ' || ch === '\t') { i += 1; continue; }
      const rest = lineText.slice(i);
      const col = i + 1;

      if (rest.startsWith('//')) {
        tokens.push({ kind: 'comment', text: rest, line: lineNo, col, length: rest.length });
        break;
      }

      if (ch === '"') {
        const close = lineText.indexOf('"', i + 1);
        if (close < 0) {
          diagnostics.push(makeDiagnostic('E-LEX-002', { line: lineNo, col, length: rest.length }));
          break;                                    // rest of the line is unusable
        }
        tokens.push({
          kind: 'quoted', text: lineText.slice(i + 1, close),
          line: lineNo, col, length: close - i + 1,
        });
        i = close + 1; firstOnLine = false; continue;
      }

      let m = COMPARE_RE.exec(rest);
      if (m) {
        tokens.push({ kind: 'compare', text: `${m[1]}I`, line: lineNo, col, length: m[0].length });
        i += m[0].length; firstOnLine = false; continue;
      }

      if (ch === '=') {
        if (rest.startsWith('==')) {                // '==' not followed by I
          diagnostics.push(makeDiagnostic('E-LEX-001', { line: lineNo, col, length: 2 }, { text: '==' }));
          i += 2; continue;
        }
        tokens.push({ kind: 'assign', text: '=', line: lineNo, col, length: 1 });
        i += 1; firstOnLine = false; continue;
      }

      if (ch === '<' || ch === '>') {               // comparator not followed by I
        const two = rest.slice(0, 2);
        const len = two === '<>' || two === '<=' || two === '>=' ? 2 : 1;
        diagnostics.push(
          makeDiagnostic('E-LEX-001', { line: lineNo, col, length: len }, { text: rest.slice(0, len) }),
        );
        i += len; continue;
      }

      m = S5TIME_RE.exec(rest);
      if (m) {
        tokens.push({ kind: 's5time', text: m[0], line: lineNo, col, length: m[0].length });
        i += m[0].length; firstOnLine = false; continue;
      }

      m = COUNTER_RE.exec(rest);
      if (m) {
        tokens.push({ kind: 'counterLit', text: m[0], line: lineNo, col, length: m[0].length });
        i += m[0].length; firstOnLine = false; continue;
      }

      m = WORD_RE.exec(rest);
      if (m) {
        const text = m[0];
        const after = lineText[i + text.length];
        if (after === ':' && firstOnLine && LABEL_NAME_RE.test(text)) {
          tokens.push({ kind: 'labelDef', text, line: lineNo, col, length: text.length + 1 });
          i += text.length + 1; firstOnLine = false; continue;
        }
        tokens.push({ kind: 'word', text, line: lineNo, col, length: text.length });
        i += text.length; firstOnLine = false; continue;
      }

      m = NUMBER_RE.exec(rest);
      if (m) {
        tokens.push({ kind: 'number', text: m[0], line: lineNo, col, length: m[0].length });
        i += m[0].length; firstOnLine = false; continue;
      }

      diagnostics.push(makeDiagnostic('E-LEX-001', { line: lineNo, col, length: 1 }, { text: ch }));
      i += 1;
    }
  }

  return { tokens, diagnostics };
}
