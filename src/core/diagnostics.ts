/**
 * Diagnostics (ARCHITECTURE.md §5.1.5). The code registry lives in the architecture file
 * (§5.1.5 table) — extend, never renumber. Codes: E-LEX-001/002, E-SYN-001..003,
 * E-ADR-001/002, E-SYM-001/002, E-TYP-001, E-JMP-001/002, W-LOG-001, W-TIM-001,
 * W-RES-001 (resource-whitelist warning, pedagogy-critical), R-RUN-001/002 (runtime).
 *
 * Core diagnostics ship DE+EN in this message catalog (§10.6) — that is core's i18n
 * mechanism; the UI picks the active language from `message.de` / `message.en`.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;                       // registry in ARCHITECTURE.md §5.1.5
  severity: Severity;
  line: number; col: number; length?: number;
  message: { de: string; en: string };
  hint?:   { de: string; en: string };   // e.g. suggestion for case-mismatch
}

export type DiagnosticCode =
  | 'E-LEX-001' | 'E-LEX-002'
  | 'E-SYN-001' | 'E-SYN-002' | 'E-SYN-003'
  | 'E-ADR-001' | 'E-ADR-002'
  | 'E-SYM-001' | 'E-SYM-002'
  | 'E-TYP-001'
  | 'E-JMP-001' | 'E-JMP-002'
  | 'W-LOG-001' | 'W-TIM-001' | 'W-RES-001'
  | 'R-RUN-001' | 'R-RUN-002';

type Args = Record<string, string | number>;

interface CatalogEntry {
  severity: Severity;
  en: (a: Args) => string;
  de: (a: Args) => string;
}

const CATALOG: Record<DiagnosticCode, CatalogEntry> = {
  'E-LEX-001': {
    severity: 'error',
    en: (a) => `Unknown token ${quoteArg(a.text)}`,
    de: (a) => `Unbekanntes Zeichen ${quoteArg(a.text)}`,
  },
  'E-LEX-002': {
    severity: 'error',
    en: () => 'Unterminated quoted symbol name',
    de: () => 'Nicht geschlossener Symbolname',
  },
  'E-SYN-001': {
    severity: 'error',
    en: (a) => `Unknown instruction ${quoteArg(a.text)}`,
    de: (a) => `Unbekannte Anweisung ${quoteArg(a.text)}`,
  },
  'E-SYN-002': {
    severity: 'error',
    en: (a) => `Missing or extra operand for instruction ${quoteArg(a.op)}`,
    de: (a) => `Fehlender oder überzähliger Operand für die Anweisung ${quoteArg(a.op)}`,
  },
  'E-SYN-003': {
    severity: 'error',
    en: (a) => `Malformed constant ${quoteArg(a.text)}`,
    de: (a) => `Fehlerhafte Konstante ${quoteArg(a.text)}`,
  },
  'E-ADR-001': {
    severity: 'error',
    en: (a) => `Malformed address ${quoteArg(a.text)}`,
    de: (a) => `Fehlerhafte Adresse ${quoteArg(a.text)}`,
  },
  'E-ADR-002': {
    severity: 'error',
    en: (a) => `Address out of range: ${quoteArg(a.text)}`,
    de: (a) => `Adresse außerhalb des Bereichs: ${quoteArg(a.text)}`,
  },
  'E-SYM-001': {
    severity: 'error',
    en: (a) => `Unknown symbol ${quoteArg(a.symbol)}`,
    de: (a) => `Unbekanntes Symbol ${quoteArg(a.symbol)}`,
  },
  'E-SYM-002': {
    severity: 'error',
    en: (a) => `Unknown symbol ${quoteArg(a.symbol)} — symbols are case-sensitive`,
    de: (a) => `Unbekanntes Symbol ${quoteArg(a.symbol)} — Groß-/Kleinschreibung beachten`,
  },
  'E-TYP-001': {
    severity: 'error',
    en: (a) => `Operand type not valid for instruction ${quoteArg(a.op)}`,
    de: (a) => `Operandtyp passt nicht zur Anweisung ${quoteArg(a.op)}`,
  },
  'E-JMP-001': {
    severity: 'error',
    en: (a) => `Unknown jump label ${quoteArg(a.label)}`,
    de: (a) => `Unbekannte Sprungmarke ${quoteArg(a.label)}`,
  },
  'E-JMP-002': {
    severity: 'error',
    en: (a) => `Duplicate label ${quoteArg(a.label)}`,
    de: (a) => `Doppelte Sprungmarke ${quoteArg(a.label)}`,
  },
  'W-LOG-001': {
    severity: 'warning',
    en: () => 'Assignment with never-set VKE (dead store)',
    de: () => 'Zuweisung, ohne dass das VKE je gesetzt wurde (tote Zuweisung)',
  },
  'W-TIM-001': {
    severity: 'warning',
    en: () => 'Timer started without a preceding L S5T#… in the same logic string',
    de: () => 'Timerstart ohne vorhergehendes L S5T#… in derselben Verknüpfungskette',
  },
  'W-RES-001': {
    severity: 'warning',
    en: (a) => `Write target ${quoteArg(a.target)} is outside the allowed resource range`,
    de: (a) => `Schreibziel ${quoteArg(a.target)} liegt außerhalb der erlaubten Ressourcen`,
  },
  'R-RUN-001': {
    severity: 'error',
    en: () => 'Accu 1 does not hold a valid S5TIME value on timer start',
    de: () => 'Akku 1 enthält beim Timerstart keinen gültigen S5TIME-Wert',
  },
  'R-RUN-002': {
    severity: 'error',
    en: () => 'Instruction budget exceeded: more than 10 000 instructions in one scan (runaway loop guard)',
    de: () => 'Anweisungsbudget überschritten: mehr als 10 000 Anweisungen in einem Zyklus (Endlosschleifen-Schutz)',
  },
};

function quoteArg(v: string | number | undefined): string {
  return v === undefined ? '?' : `"${v}"`;
}

export interface DiagnosticPosition { line: number; col: number; length?: number; }

/** Build a localized Diagnostic from the DE+EN catalog. */
export function makeDiagnostic(
  code: DiagnosticCode,
  pos: DiagnosticPosition,
  args: Args = {},
  hint?: { de: string; en: string },
): Diagnostic {
  const entry = CATALOG[code];
  const d: Diagnostic = {
    code,
    severity: entry.severity,
    line: pos.line,
    col: pos.col,
    message: { de: entry.de(args), en: entry.en(args) },
  };
  if (pos.length !== undefined) d.length = pos.length;
  if (hint) d.hint = hint;
  return d;
}
