/**
 * Source normalizer (ARCHITECTURE.md §5.1.4a, §5.1.5 `I-TPL-001` / `W-TPL-001`).
 *
 * The regression this pins: a student pasted their real practicum file — the FILLED-IN course
 * template — and got 947 E-LEX-001 errors, because nothing under `src/` knew the file format.
 * The fixtures here are the two COMMITTED, unfilled task templates, so the format is under
 * test without any solution content in the repository. The synthetic filled template below
 * uses neutral operands only (student Merker + one input symbol), never task content.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/core';
import {
  detectTemplate, mapDiagnostics, normalizeSource, parseProgram, tokenize,
} from '../../src/core';
import { makeSymbols } from './fixtures';

/** The course templates from the local-only `reference/` folder, read as latin1 — they are
 *  cp1252 with German umlauts. Absent in a public checkout: suites using them run only
 *  where the files exist (`TEMPLATES_PRESENT`); the synthetic fixtures cover the format
 *  everywhere. */
function templatePath(which: 'A' | 'B'): string {
  return fileURLToPath(
    new URL(`../../reference/Gruppe_${which}_Aufgabe_SS2026.txt`, import.meta.url),
  );
}

const TEMPLATES_PRESENT = existsSync(templatePath('A')) && existsSync(templatePath('B'));

function taskTemplate(which: 'A' | 'B'): string {
  return readFileSync(templatePath(which), 'latin1');
}

/**
 * A filled template in miniature: header block, two networks, neutral AWL, one deliberate
 * lexer error. Line numbers are 1-based and asserted below, so the comments are load-bearing.
 */
const FILLED_LINES: readonly string[] = [
  'SPS-Praktikum SS2026 - Aufgabenstellung GRUPPE X(AWL)',   //  1
  '=====================================================',   //  2
  '// Symbolik (Trivialnamen) gemaess Variablenliste.',       //  3
  '',                                                        //  4
  '______________________________________',                  //  5
  'Netzwerk 1',                                              //  6
  '',                                                        //  7
  'Not-Aus HALT!  (2P)',                                     //  8
  'Wenn E 1.7 (NotausBit) logisch 0 ist, soll M 10.0 setzen.',//  9
  'Erreichbare Punktzahl: 2P',                               // 10
  '',                                                        // 11
  '--Bitte hier programmieren--',                            // 12
  '',                                                        // 13
  '      UN   "NotausBit"        // fail-safe: E 1.7 = 0',    // 14
  '      =    M 10.0',                                       // 15
  '',                                                        // 16
  '______________________________________',                  // 17
  'Netzwerk 2',                                              // 18
  '',                                                        // 19
  'Erreichbare Punktzahl:1P',                                // 20
  '',                                                        // 21
  '--Bitte hier programmieren--',                            // 22
  '      U    "xR01A"',                                      // 23
  '      &&   M 10.1',                                       // 24  ← deliberate lexer error
  '',                                                        // 25
  'Gesamt 3P',                                               // 26
];
const FILLED = FILLED_LINES.join('\n');

function errorsOf(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

// ───────────────────────────────── detection ────────────────────────────────

describe('detectTemplate', () => {
  it.runIf(TEMPLATES_PRESENT)('recognizes both local course templates', () => {
    expect(detectTemplate(taskTemplate('A'))).toBe(true);
    expect(detectTemplate(taskTemplate('B'))).toBe(true);
  });

  it('recognizes the program marker alone', () => {
    expect(detectTemplate('--Bitte hier programmieren--\nU  M 10.0\n')).toBe(true);
  });

  it('recognizes a Netzwerk header plus point bookkeeping', () => {
    expect(detectTemplate('Netzwerk 3\nErreichbare Punktzahl: 2P\n')).toBe(true);
    expect(detectTemplate('Netzwerk 3\nprose\nGesamt 27P\n')).toBe(true);
  });

  it('tolerates spacing, a colon after Netzwerk, and CRLF', () => {
    expect(detectTemplate('  Netzwerk:  7\r\nErreichbare  Punkte:4P\r\n')).toBe(true);
    expect(detectTemplate('\t--  Bitte   hier programmieren  --\r\n')).toBe(true);
  });

  it('does NOT mistake plain AWL for a template', () => {
    expect(detectTemplate('')).toBe(false);
    expect(detectTemplate('// Netzwerk 1\nU  "NotausBit"\n=  M 10.0\n')).toBe(false);
    // A bare header on its own is not enough — no marker, no point bookkeeping.
    expect(detectTemplate('Netzwerk 2\nU  M 10.0\n')).toBe(false);
    // "// Netzwerk 1" grouping comments must never look like a bare header (§5.1.4).
    expect(detectTemplate('// Netzwerk 1\nErreichbare Punktzahl: 2P\n')).toBe(false);
  });
});

// ────────────────────── extraction: committed task templates ────────────────

describe.runIf(TEMPLATES_PRESENT)('extraction from the local task templates', () => {
  it('is the regression: the RAW template floods the lexer with errors', () => {
    // The bug report, reproduced — the tokenizer is right, the ingest step was missing.
    for (const which of ['A', 'B'] as const) {
      expect(errorsOf(tokenize(taskTemplate(which)).diagnostics).length).toBeGreaterThan(100);
    }
  });

  it.each(['A', 'B'] as const)('finds 11 networks in Gruppe %s and lexes clean', (which) => {
    const raw = taskTemplate(which);
    const result = normalizeSource(raw);

    expect(result.isTemplate).toBe(true);
    expect(result.stats.networks).toBe(11);
    expect(result.stats.sections).toBe(11);
    expect(tokenize(result.program).diagnostics).toEqual([]);
  });

  it.each(['A', 'B'] as const)('Gruppe %s: unfilled → empty program, no diagnostics', (which) => {
    const result = normalizeSource(taskTemplate(which));
    const parsed = parseProgram(result.program, makeSymbols());

    expect(result.stats.programLines).toBe(0);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.program).not.toBeNull();
    expect(parsed.program?.instructions).toEqual([]);
    // The task text is gone but the network structure survives as grouping comments (§5.1.4).
    expect(parsed.program?.networks.map((n) => n.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.program.trim().split('\n')).toEqual([
      '// Netzwerk 1', '// Netzwerk 2', '// Netzwerk 3', '// Netzwerk 4', '// Netzwerk 5',
      '// Netzwerk 6', '// Netzwerk 7', '// Netzwerk 8', '// Netzwerk 9', '// Netzwerk 10',
      '// Netzwerk 11',
    ]);
  });

  it.each(['A', 'B'] as const)('Gruppe %s: counts prose, flags none of it', (which) => {
    const result = normalizeSource(taskTemplate(which));
    // ~150 lines of German task text: counted, never warned about line by line.
    expect(result.stats.ignoredLines).toBeGreaterThan(50);
    expect(result.notes).toEqual([]);
  });
});

// ───────────── regression: a real template whose markers are gone ────────────

/**
 * The plain-AWL fallback must NOT fire on a real template (§5.1.4a "Plain-AWL fallback").
 *
 * Falling back re-compiles the WHOLE buffer, ~98 lines of German task text included, which is
 * verbatim the reported bug: 220 `E-LEX-001` errors on `-`, `!`, `ü`, `,`. Staying in template
 * mode instead yields zero errors and one `W-TPL-001` per misplaced line — the line the student
 * has to move. `mode` covers the three ways the marker stops being found.
 */
describe.runIf(TEMPLATES_PRESENT)('local template with its program markers gone', () => {
  const STUDENT_AWL = ['      U    "NotausBit"', '      =    M 10.0'];

  /** Rewrite every marker line: replace it, keep it but put the AWL above, or misspell it. */
  function markersGone(which: 'A' | 'B', mode: 'replaced' | 'above' | 'mistyped'): string {
    return taskTemplate(which).replace(/\r\n?/g, '\n').split('\n').map((line) => {
      if (!/--[ \t]*Bitte[ \t]+hier[ \t]+programmieren[ \t]*--/i.test(line)) return line;
      if (mode === 'replaced') return STUDENT_AWL.join('\n');
      if (mode === 'above') return [...STUDENT_AWL, line].join('\n');
      return [...STUDENT_AWL, '--Bitte hier programieren--'].join('\n');   // student's typo
    }).join('\n');
  }

  it.each([
    ['A', 'replaced'], ['A', 'above'], ['A', 'mistyped'],
    ['B', 'replaced'], ['B', 'above'], ['B', 'mistyped'],
  ] as const)('Gruppe %s / %s: stays in template mode, zero errors, warns per line', (w, mode) => {
    const source = markersGone(w, mode);
    expect(detectTemplate(source)).toBe(true);

    const result = normalizeSource(source);
    // The fallback would flip this to false and compile the German task text as AWL.
    expect(result.isTemplate).toBe(true);
    expect(result.stats.programLines).toBe(0);

    const parsed = parseProgram(result.program, makeSymbols());
    expect(errorsOf(parsed.diagnostics)).toEqual([]);
    expect(errorsOf(tokenize(result.program).diagnostics)).toEqual([]);

    // Nothing is lost silently: every misplaced AWL line is reported where the student sees it.
    expect(result.notes.length).toBeGreaterThanOrEqual(2 * 11);
    const original = source.split('\n');
    for (const note of result.notes) {
      expect(note.kind).toBe('strayInstruction');
      expect(original[note.line - 1]).toContain(note.text);
      expect(STUDENT_AWL.map((l) => l.trim())).toContain(note.text);
    }
  });

  it('the ratio guard, not the mere presence of a note, decides the fallback', () => {
    // Prose-dominated (a real template): stay in template mode.
    const prose = normalizeSource(markersGone('A', 'replaced'));
    expect(prose.notes.length * 2).toBeLessThan(prose.stats.ignoredLines);
    expect(prose.isTemplate).toBe(true);

    // Code-dominated (scaffolding pasted around plain AWL): fall back and compile.
    const code = normalizeSource([
      'Netzwerk 1', 'Erreichbare Punktzahl: 2P',
      'U     "NotausBit"', '=     M 10.0', 'Gesamt 2P',
    ].join('\n'));
    expect(code.notes).toEqual([]);              // nothing is "outside" after the fallback
    expect(code.isTemplate).toBe(false);
    expect(parseProgram(code.program, makeSymbols()).program?.instructions.length).toBe(2);
  });
});

// ──────────────────────────── extraction + line map ─────────────────────────

describe('extraction from a filled template', () => {
  it('extracts only the program sections, with rewritten network headers', () => {
    const result = normalizeSource(FILLED);
    expect(result.isTemplate).toBe(true);
    expect(result.stats.networks).toBe(2);
    expect(result.stats.sections).toBe(2);
    expect(result.program).toBe([
      '// Netzwerk 1',
      '',
      '      UN   "NotausBit"        // fail-safe: E 1.7 = 0',
      '      =    M 10.0',
      '',
      '// Netzwerk 2',
      '      U    "xR01A"',
      '      &&   M 10.1',
      '',
      '',
    ].join('\n'));
  });

  it('maps every extracted line back to its original line number', () => {
    const result = normalizeSource(FILLED);
    //             NW1 hdr, blank, UN, =, blank, NW2 hdr, U, &&, blank
    expect(result.lineMap).toEqual([6, 13, 14, 15, 16, 18, 23, 24, 25]);
    // Every mapped line must really be the line it claims, in the ORIGINAL text.
    const original = FILLED.split('\n');
    const program = result.program.split('\n');
    result.lineMap.forEach((originalLine, i) => {
      const emitted = program[i]!;
      if (emitted.startsWith('// Netzwerk')) {
        expect(original[originalLine - 1]).toMatch(/^Netzwerk \d+$/);
      } else {
        expect(original[originalLine - 1]).toBe(emitted);
      }
    });
  });

  it('reports an error INSIDE a section on its true original line', () => {
    const result = normalizeSource(FILLED);
    const parsed = parseProgram(result.program, makeSymbols());
    const raw = errorsOf(parsed.diagnostics);
    expect(raw.length).toBeGreaterThan(0);

    // Control: unmapped, the error sits on program line 8 — so the mapping cannot pass
    // vacuously by the two numbers happening to agree.
    expect(raw.every((d) => d.line === 8)).toBe(true);

    const mapped = errorsOf(mapDiagnostics(parsed.diagnostics, result.lineMap));
    expect(mapped.every((d) => d.line === 24)).toBe(true);
    const lex = mapped.find((d) => d.code === 'E-LEX-001');
    expect(lex).toBeDefined();
    expect(lex?.line).toBe(24);
    expect(lex?.col).toBe(7);                     // six spaces, then "&&"
    expect(FILLED_LINES[23]).toContain('&&');     // the line the student sees
  });

  it('keeps the clean network compilable: NW1 loads without diagnostics', () => {
    const clean = FILLED.replace('      &&   M 10.1', '      U    M 10.1');
    const result = normalizeSource(clean);
    const parsed = parseProgram(result.program, makeSymbols());
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.program?.instructions.map((i) => i.op)).toEqual(['UN', '=', 'U', 'U']);
  });

  it('is CRLF- and latin1-agnostic', () => {
    const crlf = normalizeSource(FILLED.replace(/\n/g, '\r\n'));
    expect(crlf.program).toBe(normalizeSource(FILLED).program);
    expect(crlf.lineMap).toEqual(normalizeSource(FILLED).lineMap);

    // latin1 bytes in the task prose must not disturb the extraction (§9: cp1252 source).
    const latin1 = FILLED.replace('Not-Aus HALT!', 'Not-Aus HALT über Größe!');
    expect(normalizeSource(latin1).program).toBe(normalizeSource(FILLED).program);
  });

  // Regression: a second marker under the same header used to re-emit the previous network's
  // grouping comment anchored on the OLD header line — duplicate NetworkMarkers with the same
  // index and a non-monotonic line map, which stats.networks then contradicted.
  it('emits each network header once and keeps the line map monotonic', () => {
    const result = normalizeSource([
      'Netzwerk 1',                       // 1
      'Erreichbare Punktzahl: 2P',        // 2
      '--Bitte hier programmieren--',     // 3
      '      U    "xR01A"',               // 4
      '_______',                          // 5  closes the network, not just the section
      '--Bitte hier programmieren--',     // 6  second marker, no header of its own
      '      =    M 10.0',                // 7
      'Gesamt 2P',                        // 8
    ].join('\n'));

    expect(result.stats.sections).toBe(2);
    expect(result.stats.networks).toBe(1);
    expect(result.program.trim().split('\n').filter((l) => l.startsWith('// Netzwerk')))
      .toEqual(['// Netzwerk 1']);
    expect(result.lineMap).toEqual([1, 4, 7]);
    // Monotonic, so no diagnostic can be mapped backwards onto an earlier line.
    expect([...result.lineMap].sort((a, b) => a - b)).toEqual(result.lineMap);

    const parsed = parseProgram(result.program, makeSymbols());
    expect(parsed.program?.networks.map((n) => n.index)).toEqual([1]);
    expect(parsed.program?.instructions.map((i) => i.op)).toEqual(['U', '=']);
  });

  it('is idempotent', () => {
    const sources = TEMPLATES_PRESENT
      ? [FILLED, taskTemplate('A'), taskTemplate('B')]
      : [FILLED];
    for (const source of sources) {
      const once = normalizeSource(source);
      const twice = normalizeSource(once.program);
      expect(twice.program).toBe(once.program);
      expect(normalizeSource(twice.program).program).toBe(once.program);
    }
  });
});

// ─────────────────── tolerance inside NON-template sources ──────────────────

describe('scaffolding tolerance in plain AWL', () => {
  const PLAIN = [
    '// Netzwerk 1',            // 1
    'U     "NotausBit"',        // 2
    '=     M 10.0',             // 3
    '-----------------',        // 4  separator run
    '===_---',                  // 5  mixed separator run
    'Netzwerk 2',               // 6  bare header → grouping comment
    'U     "xR01A"',            // 7
    '=     M 10.1',             // 8
  ].join('\n');

  it('is not classified as a template', () => {
    expect(detectTemplate(PLAIN)).toBe(false);
    expect(normalizeSource(PLAIN).isTemplate).toBe(false);
  });

  it('never lets separators or a bare header reach the lexer as errors', () => {
    const result = normalizeSource(PLAIN);
    expect(tokenize(result.program).diagnostics).toEqual([]);
    const parsed = parseProgram(result.program, makeSymbols());
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.program?.instructions.length).toBe(4);
    expect(parsed.program?.networks.map((n) => n.index)).toEqual([1, 2]);
  });

  it('keeps the line map an identity, so plain sources need no translation', () => {
    const result = normalizeSource(PLAIN);
    expect(result.lineMap).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.stats.scaffoldLines).toBe(3);   // two rulers + one bare header
  });

  it('tolerates point lines and the total without any Netzwerk header', () => {
    const source = [
      'U     "NotausBit"',
      'Erreichbare Punktzahl: 2P',
      '=     M 10.0',
      'Gesamt 27P',
    ].join('\n');
    expect(detectTemplate(source)).toBe(false);
    const result = normalizeSource(source);
    expect(tokenize(result.program).diagnostics).toEqual([]);
    expect(parseProgram(result.program, makeSymbols()).diagnostics).toEqual([]);
  });

  it('still rejects genuinely unknown tokens inside real AWL', () => {
    const result = normalizeSource('U     "NotausBit"\n=     M 10.0 !\n');
    const errors = errorsOf(tokenize(result.program).diagnostics);
    expect(errors.map((d) => d.code)).toEqual(['E-LEX-001']);
    expect(errors[0]?.line).toBe(2);
  });

  it('falls back to plain AWL when template scaffolding lost all its markers', () => {
    // Headers + point total present, every "--Bitte hier programmieren--" deleted: template
    // mode would extract nothing at all, which would silently throw the program away.
    const source = [
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      'U     "NotausBit"',
      '=     M 10.0',
      'Gesamt 2P',
    ].join('\n');
    expect(detectTemplate(source)).toBe(true);
    const result = normalizeSource(source);
    expect(result.isTemplate).toBe(false);        // fell back
    expect(result.notes).toEqual([]);             // nothing is "outside" any more
    expect(tokenize(result.program).diagnostics).toEqual([]);
    expect(parseProgram(result.program, makeSymbols()).program?.instructions.length).toBe(2);
  });
});

// ───────────────────────────────── safety net ───────────────────────────────

describe('safety net for lines outside a program section', () => {
  /** Put `line` into a template ABOVE the marker, i.e. outside every program section. */
  function outside(line: string): ReturnType<typeof normalizeSource> {
    return normalizeSource([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      line,
      '--Bitte hier programmieren--',
      '      U    "NotausBit"',
      '      =    M 10.0',
      'Gesamt 2P',
    ].join('\n'));
  }

  it('fires on a misspelled mnemonic (edit distance 1)', () => {
    const result = outside('      Uu   "xR01A"');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({
      kind: 'strayInstruction', line: 3, col: 7, text: 'Uu   "xR01A"',
    });
    // …and the program itself still compiled.
    expect(result.stats.programLines).toBe(2);
  });

  it.each([
    '      U    "xR01A"',
    '      UN   M 10.0',
    '      L    S5T#300MS',
    '      SV   T 10',
    '      =    M 10.1',
    '      S    "STOP"',
    '      ZV   Z 1',
    '      SPA  M001',
    '      NOP  0',
    '      Uu   "xR01A"    // mit Kommentar',
    '      Un   M 10.0',
  ])('flags the misplaced instruction %j', (line) => {
    expect(outside(line).notes).toHaveLength(1);
  });

  it.each([
    'Die Weichen "xW02BH1G4R" und "xW03CG" sind zu stellen.',
    ' sowie "xW03DG"',
    ' "xW02BH1G1R"',
    'Wenn E 1.7 (NotausBit) logisch 0 ist, soll M 120.3 den Zug stoppen.',
    'Not-Aus HALT!',
    'HALT Abstellgleis',
    'Ausfahrt Bhf 1',
    '2.Runde',
    'Anmerkungen:',
    'in 1.7',
    'zu stellen',
    'Erreichbare Punkte: 2P',
    '- Die Reedkontakte sind analog mit xR kodiert.',
  ])('stays quiet on ordinary prose %j', (line) => {
    expect(outside(line).notes).toEqual([]);
  });

  it('counts prose instead of warning about it', () => {
    const result = outside('Auf freier Strecke darf die Lok voll fahren.');
    expect(result.notes).toEqual([]);
    expect(result.stats.ignoredLines).toBe(1);
  });

  // Regression: these three forms were swallowed with no diagnostic at all. The label form is
  // VALID AWL — the head token was the label, so no mnemonic was ever tested.
  it.each([
    ['   M001: U "xR01A"', 'M001: U "xR01A"'],   // label definition + instruction
    ['   M001:', 'M001:'],                       // bare label definition
    ['   U  xR01A', 'U  xR01A'],                 // unquoted symbol name
    ['   U  "xR01A";', 'U  "xR01A";'],           // trailing semicolon
    ['   SPA  M001;', 'SPA  M001;'],             // jump with a trailing semicolon
  ])('flags the misplaced %j instead of dropping it silently', (line, text) => {
    const result = outside(line);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ kind: 'strayInstruction', line: 3, col: 4, text });
  });

  // Regression: the fallback is gated on `notes.length > 0`, so a student whose misplaced lines
  // were ALL label-prefixed got an empty program with not one warning — announced only by
  // "0 instruction(s)" inside the info line. Now the label form is seen either way.
  it('never leaves a label-prefixed program both empty and unannounced', () => {
    // Code-dominated: the notes make the ratio guard fire, so the buffer compiles after all.
    const code = normalizeSource([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      '   M001: U  "xR01A"',
      '   M002: =  M 10.0',
      '--Bitte hier programmieren--',
      'Gesamt 2P',
    ].join('\n'));
    expect(code.stats.programLines).toBe(2);
    expect(errorsOf(parseProgram(code.program, makeSymbols()).diagnostics)).toEqual([]);

    // Prose-dominated: template mode stands, and the label lines are warned about by line.
    const prose = normalizeSource([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      'Die Lok steht im Bahnhof 1 und soll losfahren.',
      'Auf freier Strecke darf die Lok voll fahren.',
      'Wenn E 1.7 logisch 0 ist, soll der Zug stoppen.',
      '   M001: U  "xR01A"',
      '   M002: =  M 10.0',
      '--Bitte hier programmieren--',
      'Gesamt 2P',
    ].join('\n'));
    expect(prose.isTemplate).toBe(true);
    expect(prose.stats.programLines).toBe(0);
    expect(prose.notes.map((n) => n.line)).toEqual([6, 7]);
  });

  it.each([
    'und "xR01A"',            // ↔ UN, distance 1
    'an E 1.7',               // ↔ ON / UN
    'so M 10.0',              // ↔ S / O
    'zu M 10.0',              // ↔ ZV
    'mit M 10.0',             // ↔ T? — a German function word either way
    'im 1.7',
  ])('does not mistake the German function word in %j for a mnemonic', (line) => {
    expect(outside(line).notes).toEqual([]);
  });

  it('still flags the same shapes behind a real mnemonic', () => {
    // The stop-word list must not blunt the safety net itself.
    expect(outside('      UN   "xR01A"').notes).toHaveLength(1);
    expect(outside('      S    M 10.0').notes).toHaveLength(1);
    expect(outside('      ZV   Z 1').notes).toHaveLength(1);
  });

  it('never fires inside a program section — there the parser has jurisdiction', () => {
    const result = normalizeSource([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      '--Bitte hier programmieren--',
      '      Uu   "xR01A"',
      'Gesamt 2P',
    ].join('\n'));
    expect(result.notes).toEqual([]);
    const errors = errorsOf(parseProgram(result.program, makeSymbols()).diagnostics);
    expect(errors.map((d) => d.code)).toEqual(['E-SYN-001']);   // "Uu" is an unknown instruction
    expect(mapDiagnostics(errors, result.lineMap)[0]?.line).toBe(4);
  });
});

// ──────────────────────────────── mapDiagnostics ─────────────────────────────

describe('mapDiagnostics', () => {
  const diagnostic = (line: number): Diagnostic => ({
    code: 'E-LEX-001', severity: 'error', line, col: 3, length: 1,
    message: { de: 'x', en: 'x' },
  });

  it('re-anchors lines and preserves everything else', () => {
    const mapped = mapDiagnostics([diagnostic(2)], [10, 20, 30]);
    expect(mapped[0]).toEqual({
      code: 'E-LEX-001', severity: 'error', line: 20, col: 3, length: 1,
      message: { de: 'x', en: 'x' },
    });
  });

  it('leaves a line without a mapping untouched', () => {
    expect(mapDiagnostics([diagnostic(9)], [10, 20]).map((d) => d.line)).toEqual([9]);
    expect(mapDiagnostics([diagnostic(1)], []).map((d) => d.line)).toEqual([1]);
  });

  it('is a no-op on an identity map', () => {
    const input = [diagnostic(1), diagnostic(3)];
    expect(mapDiagnostics(input, [1, 2, 3])).toEqual(input);
  });
});
