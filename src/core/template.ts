/**
 * Course-template normalizer (ARCHITECTURE.md §5.1.4, §5.1.5 `I-TPL-001` / `W-TPL-001`).
 *
 * The practicum hands the students a TEMPLATE, not an empty file: a title line, a `====`
 * rule, `//` header comments, then per network a `_______` separator, a bare `Netzwerk n`
 * header, the German task text, an `Erreichbare Punktzahl: 2P` line, the marker
 * `--Bitte hier programmieren--`, the student's AWL, and finally `Gesamt 27P`. Pasting that
 * file into the editor used to produce hundreds of E-LEX-001 errors, because the tokenizer
 * is right to reject prose — nothing upstream of it knew the file format.
 *
 * This module is that missing step: pure text → text, no DOM, no wall clock, no messages.
 * It extracts the program sections, rewrites the bare `Netzwerk n` headers into the parser's
 * `// Netzwerk n` grouping comments (§5.1.4) and returns a LINE MAP so every diagnostic can
 * be reported on the line the student actually sees. Notes are STRUCTURED FACTS only — the
 * localized text lives in `ui/i18n` (same split as `W-SWI-001`, §5.1.5), so core keeps no
 * second message catalog.
 *
 * Nothing here relaxes the language: inside a program section the source is handed to the
 * tokenizer verbatim, so an unknown token is still an error. Only the template scaffolding
 * (separator runs, network headers, point lines, the marker itself) is skipped, and it is
 * skipped in ordinary AWL buffers too — a student who keeps a `_______` ruler between their
 * networks should not be punished for it.
 *
 * SAFETY NET: dropping text silently would be a pedagogical trap — a program section whose
 * marker the student deleted would vanish without a word. Every ignored line that LOOKS like
 * an instruction (first word within edit distance 1 of an M1 mnemonic plus an AWL-shaped
 * operand) therefore yields a `strayInstruction` note. Prose is counted, not flagged.
 */
import type { Diagnostic } from './diagnostics';
import { WORD_MNEMONICS, MNEMONICS } from './ast';

// ───────────────────────────── line classification ──────────────────────────

/** The marker in front of every program section of the course template. */
const PROGRAM_MARKER = /--[ \t]*Bitte[ \t]+hier[ \t]+programmieren[ \t]*--/i;
/** Bare `Netzwerk 7` / `Netzwerk: 7` header — tolerant of spacing and of the colon. */
const NETWORK_HEADER = /^[ \t]*Netzwerk[ \t]*:?[ \t]*(\d{1,3})\b/i;
/** The `_______` rule that CLOSES a program section in the template. */
const SECTION_END = /^[ \t]*_{3,}[ \t]*$/;
/** Any pure separator run (`====`, `-----`, mixed) — never program text. */
const SEPARATOR_ANY = /^[ \t]*[-=_]{3,}[ \t]*$/;
/** `Erreichbare Punktzahl: 2P`, `Erreichbare Punkte:4P`. */
const POINTS = /^[ \t]*Erreichbare[ \t]+Punkt[A-Za-zäöüÄÖÜß]*[ \t]*:?[ \t]*\d+[ \t]*P?\b/i;
/** `Gesamt 27P` closes the whole file. */
const FILE_END = /^[ \t]*Gesamt\b/i;
/** Detection-strength variant of {@link FILE_END}: the point total, not just the word. */
const TOTAL_POINTS = /^[ \t]*Gesamt[ \t]*:?[ \t]*\d+[ \t]*P\b/i;
/** Detection-strength variant of {@link POINTS}: the wording alone is evidence enough. */
const POINTS_LOOSE = /^[ \t]*Erreichbare[ \t]+Punkt/i;

type LineKind = 'marker' | 'header' | 'sectionEnd' | 'skip' | 'text';

function classify(line: string): LineKind {
  if (PROGRAM_MARKER.test(line)) return 'marker';
  if (NETWORK_HEADER.test(line)) return 'header';
  if (SECTION_END.test(line) || FILE_END.test(line)) return 'sectionEnd';
  if (SEPARATOR_ANY.test(line) || POINTS.test(line)) return 'skip';
  return 'text';
}

/** Split into lines, CRLF/CR tolerant, without the phantom line a trailing newline adds. */
function toLines(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ───────────────────────────────── detection ────────────────────────────────

/**
 * Is this text a filled-in (or empty) course template rather than plain AWL?
 *
 * True when the program marker is present, or when a bare `Netzwerk n` header appears
 * together with the point bookkeeping (`Erreichbare Punktzahl…` / `Gesamt nP`). A plain AWL
 * buffer whose networks are commented `// Netzwerk 3` never matches: the header pattern is
 * anchored at the line start, so the comment slashes keep it out.
 */
export function detectTemplate(source: string): boolean {
  let header = false;
  let points = false;
  let total = false;
  for (const line of toLines(source)) {
    if (PROGRAM_MARKER.test(line)) return true;
    if (NETWORK_HEADER.test(line)) header = true;
    else if (POINTS_LOOSE.test(line)) points = true;
    else if (TOTAL_POINTS.test(line)) total = true;
  }
  return header && (points || total);
}

// ─────────────────────────────── normalization ──────────────────────────────

export type TemplateNoteKind = 'strayInstruction';

/** A structured fact about an ignored line; `ui/` turns it into a localized warning. */
export interface TemplateNote {
  kind: TemplateNoteKind;
  /** 1-based line in the ORIGINAL source — what the student sees in the editor. */
  line: number;
  col: number;
  length: number;
  /** The offending line, trimmed, so the message can quote it back. */
  text: string;
}

export interface TemplateStats {
  /** Distinct `Netzwerk n` headers found. */
  networks: number;
  /** Program sections (marker occurrences) found. */
  sections: number;
  /** Extracted lines that carry code (neither blank nor comment-only). */
  programLines: number;
  /** Non-blank, non-comment lines of task text that were dropped. Template mode only —
   *  plain AWL has no "outside a section", so nothing there can be ignored. */
  ignoredLines: number;
  /** Template scaffolding lines that did not become instructions: separator runs, bare
   *  `Netzwerk n` headers (rewritten to grouping comments), point lines, markers. */
  scaffoldLines: number;
}

export interface NormalizedSource {
  /** The text to compile: program sections only, with `// Netzwerk n` grouping comments. */
  program: string;
  isTemplate: boolean;
  /** `lineMap[i]` = 1-based ORIGINAL line of program line `i + 1`. */
  lineMap: number[];
  notes: TemplateNote[];
  stats: TemplateStats;
}

/**
 * Extract the compilable program from `source`.
 *
 * Template mode collects only the text after each `--Bitte hier programmieren--` marker, up
 * to the next `_______` rule / `Gesamt` / EOF. Plain-AWL mode keeps every line and merely
 * neutralizes the scaffolding a student may have pasted along (separator runs, point lines),
 * which makes the line map the identity — a diagnostic then needs no translation at all.
 *
 * A template mode that extracts NOTHING is redone as plain AWL, but only under the ratio guard
 * in {@link fallsBackToPlainAwl} — see there for why that guard is load-bearing.
 *
 * Idempotent: normalizing the extracted program again returns it unchanged.
 */
export function normalizeSource(source: string): NormalizedSource {
  const lines = toLines(source);
  const templateMode = detectTemplate(source);
  const first = extract(lines, templateMode);
  return fallsBackToPlainAwl(first) ? extract(lines, false) : first;
}

/**
 * Should a template-mode extraction that produced NOTHING be redone as plain AWL?
 *
 * A file that carries template scaffolding but no surviving marker (the student typed over the
 * `--Bitte hier programmieren--` lines, deleted them, or pasted only the middle of the file)
 * extracts to nothing in template mode — a total loss of their program. Re-running as plain
 * AWL still neutralizes the scaffolding, so a buffer that IS essentially AWL compiles.
 *
 * The guard is the ratio, not the mere presence of a note: the whole file is compiled in the
 * fallback, German task text included, so it may only fire when the ignored text is
 * PREDOMINANTLY instruction-shaped. A real course template with its markers typed over has
 * ~20 instruction lines against ~98 lines of prose — recompiling that whole buffer is exactly
 * the 200-plus `E-LEX-001` flood this module exists to remove. Staying in template mode
 * instead turns every one of those lines into a `W-TPL-001` pointing at the line the student
 * has to move, which is the pedagogically useful answer. An UNFILLED template never reaches
 * here at all: it has markers, and its ignored text is prose, so it yields no notes.
 */
function fallsBackToPlainAwl(first: NormalizedSource): boolean {
  if (!first.isTemplate || first.stats.programLines > 0) return false;
  if (first.notes.length === 0) return false;
  return first.notes.length * 2 >= first.stats.ignoredLines;
}

function extract(lines: readonly string[], isTemplate: boolean): NormalizedSource {
  const out: string[] = [];
  const lineMap: number[] = [];
  const notes: TemplateNote[] = [];
  const networks = new Set<number>();
  let sections = 0;
  let ignoredLines = 0;
  let scaffoldLines = 0;
  let network: number | null = null;
  let networkLine = 0;
  /** Has the current header already contributed its `// Netzwerk n` grouping comment? A second
   *  marker under the same header must not emit a duplicate anchored on the old header line. */
  let networkEmitted = false;
  /** Template mode starts outside a section; plain AWL is program from the first line. */
  let collecting = !isTemplate;

  const emit = (text: string, originalLine: number): void => {
    out.push(text);
    lineMap.push(originalLine);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const kind = classify(raw);
    if (kind !== 'text') scaffoldLines += 1;

    if (kind === 'header') {
      const n = Number(NETWORK_HEADER.exec(raw)![1]);
      networks.add(n);
      network = n;
      networkLine = lineNo;
      networkEmitted = false;
      if (isTemplate) collecting = false;
      else emit(`// Netzwerk ${n}`, lineNo);
      continue;
    }

    if (kind === 'marker') {
      sections += 1;
      collecting = true;
      // The grouping comment is anchored on the ORIGINAL header line, so a diagnostic on it
      // points at the "Netzwerk n" line the student wrote, not at a line that never existed.
      // Once per header only: emitting it again for a second marker would produce a duplicate
      // NetworkMarker with the same index and a non-monotonic line map.
      if (isTemplate && network !== null && !networkEmitted) {
        emit(`// Netzwerk ${network}`, networkLine);
        networkEmitted = true;
      } else if (!isTemplate) emit('', lineNo);
      continue;
    }

    if (kind === 'sectionEnd') {
      if (isTemplate) {
        collecting = false;
        // The `_______` rule / `Gesamt` ends the network, not just its section: a later marker
        // with no header of its own belongs to no network and must not re-emit this one.
        network = null;
        networkLine = 0;
        networkEmitted = false;
      } else emit('', lineNo);
      continue;
    }

    if (kind === 'skip') {
      // Point lines and stray rulers never close a section: a marker whose section happens to
      // contain one must not lose the rest of its program.
      if (!isTemplate) emit('', lineNo);
      continue;
    }

    if (collecting) {
      emit(raw, lineNo);
      continue;
    }

    // ── ignored task text ────────────────────────────────────────────────────
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('//')) continue;      // a deliberate comment, not lost content
    ignoredLines += 1;
    const stray = strayInstruction(raw);
    if (stray !== null) {
      notes.push({ kind: 'strayInstruction', line: lineNo, col: stray.col,
                   length: stray.length, text: trimmed });
    }
  }

  const programLines = out.filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('//');
  }).length;

  return {
    program: `${out.join('\n')}\n`,
    isTemplate,
    lineMap,
    notes,
    stats: { networks: networks.size, sections, programLines, ignoredLines, scaffoldLines },
  };
}

/**
 * Re-anchor diagnostics produced on the NORMALIZED program onto the original source lines.
 * Columns are untouched: extracted lines are copied verbatim, so they already agree.
 */
export function mapDiagnostics(
  diagnostics: readonly Diagnostic[],
  lineMap: readonly number[],
): Diagnostic[] {
  return diagnostics.map((d) => {
    const original = lineMap[d.line - 1];
    if (original === undefined || original === d.line) return d;
    return { ...d, line: original };
  });
}

// ──────────────────────────────── safety net ────────────────────────────────

const MNEMONIC_SET: ReadonlySet<string> = new Set<string>(MNEMONICS);
const JUMP_SET: ReadonlySet<string> = new Set<string>(['SPA', 'SPB', 'SPBN']);
const LABEL_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;
/** A label DEFINITION at the head of a line (`M001:  U "xR01A"`) — valid AWL, so it must be
 *  stripped before the head token is tested, otherwise the head is the label and no mnemonic
 *  is ever looked at: the line would be dropped without a single word. */
const LABEL_PREFIX = /^[A-Za-z][A-Za-z0-9]{0,3}:[ \t]*/;
/** An unquoted symbol name — `U xR01A` instead of `U "xR01A"`, a frequent student slip. */
const BARE_WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Operand shapes an AWL line can carry (the split form `M 10.0` included). */
const OPERAND_SHAPES: readonly RegExp[] = [
  /^"[^"]*"$/,                       // quoted symbol
  /^[EAM][ \t]*\d{1,3}\.\d$/i,       // E 1.7, M 120.3, M120.3
  /^[EAM]W[ \t]*\d{1,3}$/i,          // AW 6
  /^[TZ][ \t]*\d{1,3}$/i,            // T 10, Z 1
  /^S5T#[A-Za-z0-9_]*$/i,            // L S5T#300MS
  /^C#\d{1,3}$/i,                    // L C#010
  /^-?\d{1,5}$/,                     // L 3, NOP 0
];

/** Levenshtein distance, early-out at 2 — the safety net only cares about ≤ 1. */
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }
  return previous[b.length]! <= 1;
}

/**
 * German function words that sit within edit distance 1 of a mnemonic (`und`↔`UN`, `an`↔`ON`,
 * `so`↔`S`, `zu`↔`ZV`). A student's own un-commented German note must not be reported as a
 * misplaced instruction. None of these is itself a mnemonic, so only FUZZY matching is
 * affected — `U`, `UN`, `O`, `ON`, `S`, `T`, `ZV`… still match exactly.
 */
const GERMAN_STOP_WORDS: ReadonlySet<string> = new Set<string>([
  'UND', 'ODER', 'AN', 'AM', 'IM', 'IN', 'SO', 'ZU', 'MIT', 'BEI', 'ALS', 'UM', 'AUF', 'AUS',
]);

function isNearMnemonic(word: string): boolean {
  if (word.length > 5) return false;                 // ≤ 4-char mnemonics + one typo
  if (GERMAN_STOP_WORDS.has(word)) return false;
  return WORD_MNEMONICS.some((m) => nearlyEqual(word, m));
}

/**
 * Does an ignored line look like it was MEANT to be an instruction?
 *
 * Both halves have to agree — a mnemonic-shaped first word AND an AWL-shaped operand. The
 * task text is full of quoted symbols and of addresses like `E 1.7`, so either half on its
 * own would flag ordinary prose (`sowie "xW03DG"`) and drown the real finding.
 *
 * A leading label definition is stripped first (`M001: U "xR01A"` is valid AWL), and a
 * trailing `;`/`.` does not by itself make a line prose — but a line that ENDS like a sentence
 * is only kept when its head is an EXACT mnemonic, which is what keeps German prose quiet.
 */
function strayInstruction(raw: string): { col: number; length: number } | null {
  const stripped = raw.replace(/\/\/.*$/, '').trim();
  if (stripped === '') return null;

  const position = (): { col: number; length: number } => {
    const col = raw.length - raw.trimStart().length + 1;
    return { col, length: Math.max(raw.trimEnd().length - col + 1, 1) };
  };

  const labelled = LABEL_PREFIX.test(stripped);
  const body = stripped.replace(LABEL_PREFIX, '');
  // A bare `M001:` is a label definition and therefore code, not prose.
  if (body === '') return labelled ? position() : null;

  const sentence = /[,.;:!?]$/.test(body);
  const code = sentence ? body.slice(0, -1).trimEnd() : body;
  if (code === '') return null;
  const tokens = code.split(/[ \t]+/);
  if (tokens.length > 3) return null;                // `SV T 10` is the longest AWL shape

  const head = tokens[0]!.toUpperCase();
  const exact = MNEMONIC_SET.has(head);
  if (!exact) {
    if (sentence) return null;                       // a sentence with a fuzzy head is prose
    if (!isNearMnemonic(head)) return null;
  }

  if (tokens.length === 1) {
    // A lone fuzzy word is prose ("so", "und", "zu"); a lone exact mnemonic is code.
    return exact || labelled ? position() : null;
  }

  const rest = tokens.slice(1).join(' ');
  if (JUMP_SET.has(head) && LABEL_RE.test(rest)) return position();
  if (OPERAND_SHAPES.some((re) => re.test(rest))) return position();
  // Unquoted symbol name: accepted only behind an EXACT mnemonic and as the sole operand, so
  // that ordinary two-word German prose ("zu stellen", "an Bahnhof") stays quiet.
  return exact && tokens.length === 2 && BARE_WORD.test(rest) ? position() : null;
}
