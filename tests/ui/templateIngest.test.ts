/**
 * Ingest wiring (ARCHITECTURE.md §5.1.4a, §5.1.5, §5.6): the "Load into PLC" path.
 *
 * `App.loadProgram` does exactly three things — normalize, compile the EXTRACTED program,
 * re-anchor the diagnostics — and then renders the facts through `ui/templateNotice`. The App
 * shell itself needs a DOM (none of the §9 suites run in one), so this file pins the two
 * DOM-free seams it is built from: the pipeline, and the localized diagnostics it produces.
 *
 * Imports are deep on purpose: `src/ui/index.ts` pulls in the stylesheet, which the node test
 * environment has no loader for (the §2 rule 7 boundary is about src/ → src/ coupling).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Text } from '@codemirror/state';
import { beforeEach, describe, expect, it } from 'vitest';
import { Emulator, SymbolTable, mapDiagnostics, normalizeSource } from '../../src/core';
import type { Diagnostic } from '../../src/core';
import { toCmDiagnostic } from '../../src/ui/editor/lint';
import { de } from '../../src/ui/i18n/de';
import { en } from '../../src/ui/i18n/en';
import { setLocale } from '../../src/ui/i18n/i18n';
import {
  TEMPLATE_INFO_CODE, TEMPLATE_STRAY_CODE, mapRuntimeDiagnostics, templateNoticeDiagnostics,
} from '../../src/ui/templateNotice';
import { FIXTURE_VARIABLES } from '../core/fixtures';

function templatePath(which: 'A' | 'B'): string {
  return fileURLToPath(new URL(`../../Gruppe_${which}_Aufgabe_SS2026.txt`, import.meta.url));
}

/**
 * The course templates are not published (the public repository carries code only), so the
 * three tests that ingest a REAL template skip in a clone. The rest of this file drives the
 * same pipeline with synthetic sources and keeps running, so the ingest wiring stays covered.
 */
const TEMPLATES_PRESENT = (['A', 'B'] as const).every((which) => existsSync(templatePath(which)));

function taskTemplate(which: 'A' | 'B'): string {
  return readFileSync(templatePath(which), 'latin1');
}

/** The whole ingest path, exactly as App.loadProgram performs it. */
function loadIntoPlc(source: string): {
  ok: boolean;
  diagnostics: Diagnostic[];
  instructionCount: number;
  notices: Diagnostic[];
} {
  const emulator = new Emulator(SymbolTable.fromVariables(FIXTURE_VARIABLES));
  const normalized = normalizeSource(source);
  const result = emulator.load(normalized.program);
  const instructionCount = result.program?.instructions.length ?? 0;
  return {
    ok: result.ok,
    diagnostics: mapDiagnostics(result.diagnostics, normalized.lineMap),
    instructionCount,
    notices: templateNoticeDiagnostics(normalized, instructionCount),
  };
}

describe('Load into PLC — course template ingest', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it.skipIf(!TEMPLATES_PRESENT).each(['A', 'B'] as const)('accepts the unfilled Gruppe %s template without errors', (w) => {
    const outcome = loadIntoPlc(taskTemplate(w));
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.instructionCount).toBe(0);
  });

  it.skipIf(!TEMPLATES_PRESENT)('reports ONE informational message naming networks, instructions and ignored prose', () => {
    const outcome = loadIntoPlc(taskTemplate('A'));
    const info = outcome.notices.filter((d) => d.severity === 'info');
    expect(info).toHaveLength(1);
    expect(info[0]?.code).toBe(TEMPLATE_INFO_CODE);
    expect(info[0]?.message.en).toContain('11 network(s)');
    expect(info[0]?.message.en).toContain('0 instruction(s)');
    expect(info[0]?.message.de).toContain('11 Netzwerk(e)');
    // No per-line noise: 150+ lines of task text produce no warnings at all.
    expect(outcome.notices.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('accepts a filled template and counts what actually reached the PLC', () => {
    const outcome = loadIntoPlc([
      'SPS-Praktikum SS2026 - Aufgabenstellung GRUPPE X(AWL)',
      '=====================================================',
      '_________________________________',
      'Netzwerk 1',
      'Not-Aus HALT!  (2P)',
      'Erreichbare Punktzahl: 2P',
      '--Bitte hier programmieren--',
      '      UN   "NotausBit"',
      '      =    M 10.0',
      '_________________________________',
      'Netzwerk 2',
      'Erreichbare Punktzahl: 1P',
      '--Bitte hier programmieren--',
      '      U    M 10.0',
      '      =    M 10.1',
      'Gesamt 3P',
    ].join('\n'));

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.instructionCount).toBe(4);
    expect(outcome.notices[0]?.message.en).toContain('4 instruction(s)');
  });

  it('points a compile error at the line the student sees, not at the extract', () => {
    const outcome = loadIntoPlc([
      'Netzwerk 1',                       // 1
      'Erreichbare Punktzahl: 2P',        // 2
      '--Bitte hier programmieren--',     // 3
      '      U    "NotausBit"',           // 4
      '      =    "Tippfehler"',          // 5  ← unknown symbol
    ].join('\n'));

    expect(outcome.ok).toBe(false);
    const errors = outcome.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toMatch(/^E-SYM-00[12]$/);
    expect(errors[0]?.line).toBe(5);         // the extract had it on line 3
    expect(errors[0]?.col).toBe(12);
  });

  it('warns instead of silently dropping AWL that sits outside a section', () => {
    const outcome = loadIntoPlc([
      'Netzwerk 1',                       // 1
      'Erreichbare Punktzahl: 2P',        // 2
      '      Uu   "xR01A"',               // 3  ← misplaced AND misspelled
      '--Bitte hier programmieren--',     // 4
      '      U    "NotausBit"',           // 5
      '      =    M 10.0',                // 6
    ].join('\n'));

    expect(outcome.ok).toBe(true);
    expect(outcome.instructionCount).toBe(2);
    const warnings = outcome.notices.filter((d) => d.severity === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe(TEMPLATE_STRAY_CODE);
    expect(warnings[0]?.line).toBe(3);
    expect(warnings[0]?.message.en).toContain('Uu   "xR01A"');
    expect(warnings[0]?.message.en).toContain('outside');
    expect(warnings[0]?.hint).toBeDefined();
  });

  it('stays silent for a plain AWL buffer', () => {
    const outcome = loadIntoPlc('// Netzwerk 1\nU   "NotausBit"\n=   M 10.0\n');
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.notices).toEqual([]);
    expect(outcome.instructionCount).toBe(2);
  });

  it('explains tolerated template debris in an otherwise plain buffer', () => {
    const outcome = loadIntoPlc([
      'U   "NotausBit"',
      '=   M 10.0',
      '-----------------------',
      'Netzwerk 2',
      'U   M 10.0',
      '=   M 10.1',
    ].join('\n'));
    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]?.severity).toBe('info');
    expect(outcome.notices[0]?.message.en).toContain('2 template line(s)');
  });
});

describe('editor lint ranges land on the student’s own lines', () => {
  /**
   * The gutter/underline contract. `EditorPanel` lints the buffer the student SEES, so the
   * document offsets must be computed against the original template — a diagnostic still
   * carrying the extract's line number would underline a line of German task text.
   */
  const SOURCE = [
    'Netzwerk 1',                       // 1
    'Erreichbare Punktzahl: 2P',        // 2
    'Prosa mit E 1.7 und "xR01A".',     // 3
    '--Bitte hier programmieren--',     // 4
    '      U    "NotausBit"',           // 5
    '      &&   M 10.0',                // 6  ← the only broken line
  ].join('\n');

  it('underlines the broken line, not the prose the extract shifted it onto', () => {
    const outcome = loadIntoPlc(SOURCE);
    const doc = Text.of(SOURCE.split('\n'));
    const lex = outcome.diagnostics.find((d) => d.code === 'E-LEX-001');
    expect(lex?.line).toBe(6);

    const cm = toCmDiagnostic(doc, lex!);
    const line = doc.lineAt(cm.from);
    expect(line.number).toBe(6);
    expect(SOURCE.slice(cm.from, cm.to)).toBe('&');
    // Unmapped, the same diagnostic (program line 2) would have hit the point line.
    expect(doc.lineAt(toCmDiagnostic(doc, { ...lex!, line: 2 }).from).text)
      .toContain('Erreichbare');
  });

  it('underlines a stray-instruction warning at its original position', () => {
    const outcome = loadIntoPlc([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      '      Uu   "xR01A"',
      '--Bitte hier programmieren--',
      '      U    "NotausBit"',
    ].join('\n'));
    const original = [
      'Netzwerk 1', 'Erreichbare Punktzahl: 2P', '      Uu   "xR01A"',
      '--Bitte hier programmieren--', '      U    "NotausBit"',
    ];
    const doc = Text.of(original);
    const warning = outcome.notices.find((d) => d.code === TEMPLATE_STRAY_CODE);
    const cm = toCmDiagnostic(doc, warning!);
    expect(doc.lineAt(cm.from).number).toBe(3);
    expect(cm.severity).toBe('warning');
    expect(original.join('\n').slice(cm.from, cm.to)).toBe('Uu   "xR01A"');
  });
});

describe('runtime diagnostics and the template line map', () => {
  /**
   * Regression: `syncDiagnostics` used to push ALL runtime diagnostics through the line map, so
   * the position-less UI-raised ones (`W-SWI-001`, `R-RUN-000`, both hard-coded to line 1 in
   * main.ts) were re-anchored onto whatever line the extract started at — a lint underline and
   * a click target on an unrelated line of the student's file.
   */
  const FILLED = [
    'SPS-Praktikum SS2026 - Aufgabenstellung GRUPPE X(AWL)',   // 1
    '=====================================================',   // 2
    '_________________________________',                       // 3
    'Netzwerk 1',                                              // 4
    'Erreichbare Punktzahl: 2P',                               // 5
    '--Bitte hier programmieren--',                            // 6
    '      U    "NotausBit"',                                  // 7
    '      =    M 10.0',                                       // 8
  ].join('\n');

  const runtime = (code: string, line: number): Diagnostic => ({
    code, severity: code.startsWith('W') ? 'warning' : 'error', line, col: 1,
    message: { de: 'x', en: 'x' },
  });

  it('does not fabricate a position for the position-less UI diagnostics', () => {
    const lineMap = normalizeSource(FILLED).lineMap;
    expect(lineMap[0]).toBe(4);                    // the extract starts on the header line

    const mapped = mapRuntimeDiagnostics(
      [runtime('W-SWI-001', 1), runtime('R-RUN-000', 1)], lineMap,
    );
    expect(mapped.map((d) => d.line)).toEqual([1, 1]);
  });

  it('still re-anchors the runtime diagnostics that DO carry a program position', () => {
    const lineMap = normalizeSource(FILLED).lineMap;
    //  program line 2 = "U \"NotausBit\"" = original line 7
    expect(lineMap[1]).toBe(7);
    const mapped = mapRuntimeDiagnostics([runtime('R-RUN-001', 2), runtime('R-RUN-002', 3)],
                                         lineMap);
    expect(mapped.map((d) => d.line)).toEqual([7, 8]);
  });

  it('is a pass-through when no template line map exists', () => {
    const input = [runtime('R-RUN-001', 3), runtime('W-SWI-001', 1)];
    expect(mapRuntimeDiagnostics(input, undefined)).toEqual(input);
    expect(mapRuntimeDiagnostics(input, [1, 2, 3])).toEqual(input);   // identity map
  });
});

describe('template notices are fully localized (§5.6)', () => {
  it('carries BOTH languages, so the EN/DE toggle re-renders them', () => {
    const outcome = loadIntoPlc([
      'Netzwerk 1',
      'Erreichbare Punktzahl: 2P',
      '      Uu   "xR01A"',
      '--Bitte hier programmieren--',
      '      U    "NotausBit"',
    ].join('\n'));

    for (const notice of outcome.notices) {
      expect(notice.message.en.trim()).not.toBe('');
      expect(notice.message.de.trim()).not.toBe('');
      expect(notice.message.de).not.toBe(notice.message.en);
      expect(notice.message.en).not.toMatch(/\{\w+\}/);   // every placeholder filled
      expect(notice.message.de).not.toMatch(/\{\w+\}/);
    }
  });

  it.skipIf(!TEMPLATES_PRESENT)('does not depend on the locale active when it was built', () => {
    setLocale('de');
    const german = loadIntoPlc(taskTemplate('B')).notices;
    setLocale('en');
    const english = loadIntoPlc(taskTemplate('B')).notices;
    expect(german).toEqual(english);
  });

  it('registers its keys in both dictionaries', () => {
    for (const key of ['template.detected', 'template.cleaned',
                       'template.stray', 'template.strayHint'] as const) {
      expect(en[key]).toBeDefined();
      expect(de[key]).toBeDefined();
    }
  });
});
