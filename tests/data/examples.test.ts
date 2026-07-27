/**
 * tests/data/examples.test.ts — the shipped examples library (ARCHITECTURE.md §7.4).
 *
 * Focus: the first-run UX. The editor is seeded from the example flagged `starter`, so that
 * one must translate WITHOUT a single diagnostic — no error and, above all, no W-RES-001
 * resource warning (§5.1.5). The Anleitung snippets are kept verbatim and therefore do warn;
 * the last case pins that, so "the starter is warning-free" can never pass vacuously.
 */
import { describe, expect, it } from 'vitest';
import { Emulator, SymbolTable } from '../../src/core';
import type { Diagnostic, VariablesFile } from '../../src/core';
import { exampleAsEditorSource, findExample, loadExamples, starterExample } from '../../src/pedagogy';
import examplesJson from '../../src/data/examples.json';
import variablesJson from '../../src/data/variables.json';

const examples = loadExamples(examplesJson);
const symbols = SymbolTable.fromVariables(variablesJson as unknown as VariablesFile);

function loadIntoPlc(source: string): { ok: boolean; diagnostics: Diagnostic[] } {
  const result = new Emulator(symbols).load(source);
  return { ok: result.ok, diagnostics: result.diagnostics };
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => `${d.code}@${d.line}`);
}

describe('examples.json starter example (§7.4)', () => {
  it('flags exactly one starter', () => {
    const flagged = examples.filter((e) => e.starter === true);
    expect(flagged).toHaveLength(1);
    expect(starterExample(examples)?.id).toBe(flagged[0]?.id);
  });

  it('translates without any diagnostic — in both editor languages', () => {
    const starter = starterExample(examples);
    expect(starter).not.toBeNull();
    if (starter === null) return;
    for (const lang of ['en', 'de'] as const) {
      const outcome = loadIntoPlc(exampleAsEditorSource(starter, lang));
      expect(codes(outcome.diagnostics), `${starter.id} (${lang})`).toEqual([]);
      expect(outcome.ok).toBe(true);
    }
  });

  it('teaches the S/R latch plus a timer with student resources only', () => {
    const starter = starterExample(examples);
    expect(starter).not.toBeNull();
    if (starter === null) return;
    expect(starter.awl).toMatch(/^S\s+M\s+10\./m);
    expect(starter.awl).toMatch(/^R\s+M\s+10\./m);
    expect(starter.awl).toMatch(/^(SI|SV|SE|SS|SA)\s+T\s+1[0-9]\b/m);
    expect(starter.title.de).not.toBe('');
    expect(starter.title.en).not.toBe('');
    expect(starter.body.de).not.toBe('');
    expect(starter.body.en).not.toBe('');
  });

  it('every example is free of ERRORS (the library ships runnable snippets)', () => {
    for (const example of examples) {
      const outcome = loadIntoPlc(example.awl);
      const errors = outcome.diagnostics.filter((d) => d.severity === 'error');
      expect(codes(errors), example.id).toEqual([]);
    }
  });

  it('the Anleitung pump example is unchanged and still warns — hence the starter', () => {
    const pump = findExample(examples, 'pump-sr');
    expect(pump).not.toBeNull();
    if (pump === null) return;
    expect(pump.starter).toBeUndefined();
    expect(pump.awl).toContain('S    M    0.0');
    expect(pump.awl).toContain('=    A    0.1');
    const warnings = loadIntoPlc(pump.awl).diagnostics.filter((d) => d.code === 'W-RES-001');
    expect(warnings).toHaveLength(3);
  });
});
