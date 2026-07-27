/**
 * Localized rendering of core's template-normalization facts (ARCHITECTURE.md §5.1.5,
 * `I-TPL-001` / `W-TPL-001`).
 *
 * `core/template.ts` reports STRUCTURED facts (counts, note kinds, original line numbers) and
 * carries no message catalog — exactly the split `W-SWI-001` uses (§5.1.5, §5.6): UI strings
 * belong to the layer that owns them. Unlike `W-SWI-001` these diagnostics are built once per
 * "Load into PLC" rather than per frame, so both languages are filled in via `tIn` — a
 * diagnostic that stored only the active locale's text would freeze the language it was
 * created in and survive the EN/DE toggle unchanged.
 */
import type { Diagnostic, NormalizedSource } from '../core';
import { mapDiagnostics } from '../core';
import type { MsgKey } from './i18n/i18n';
import { tIn } from './i18n/i18n';

/** §5.1.5: informational summary of what the normalizer did to the loaded buffer. */
export const TEMPLATE_INFO_CODE = 'I-TPL-001';
/** §5.1.5: an ignored line that looks like a misplaced instruction (safety net). */
export const TEMPLATE_STRAY_CODE = 'W-TPL-001';

function both(key: MsgKey, params: Record<string, string | number>): { de: string; en: string } {
  return { de: tIn('de', key, params), en: tIn('en', key, params) };
}

/**
 * One informational message plus one warning per safety-net note.
 *
 * `instructionCount` comes from the compile of the extracted program, so the student is told
 * how much of their file actually reached the PLC — the number that matters when a whole
 * network went missing because its marker was deleted.
 */
export function templateNoticeDiagnostics(
  normalized: NormalizedSource,
  instructionCount: number,
): Diagnostic[] {
  const { stats, isTemplate, notes } = normalized;
  const out: Diagnostic[] = [];

  if (isTemplate) {
    out.push({
      code: TEMPLATE_INFO_CODE,
      severity: 'info',
      line: 1,
      col: 1,
      message: both('template.detected', {
        networks: stats.networks,
        instructions: instructionCount,
        ignored: stats.ignoredLines,
      }),
    });
  } else if (stats.scaffoldLines > 0) {
    // Not a template, but the buffer carried template debris (a separator rule, a bare
    // "Netzwerk 3" header). Those are silently tolerated instead of being lexer errors, so
    // say so — a student must be able to see why a line had no effect.
    out.push({
      code: TEMPLATE_INFO_CODE,
      severity: 'info',
      line: 1,
      col: 1,
      message: both('template.cleaned', {
        instructions: instructionCount,
        ignored: stats.scaffoldLines,
      }),
    });
  }

  for (const note of notes) {
    out.push({
      code: TEMPLATE_STRAY_CODE,
      severity: 'warning',
      line: note.line,
      col: note.col,
      length: note.length,
      message: both('template.stray', { text: note.text }),
      hint: both('template.strayHint', {}),
    });
  }

  return out;
}

/**
 * Runtime diagnostic codes whose `line` is a line of the COMPILED program (§5.1.5) and may
 * therefore be re-anchored through the template line map. Everything else the UI raises is
 * position-less by construction — `W-SWI-001` (the coordinator records the coil command without
 * a source line) and `R-RUN-000` (a bootstrap failure, unrelated to the program) are both
 * hard-coded to line 1 / col 1 in `main.ts`.
 */
const POSITIONED_RUNTIME_CODES: ReadonlySet<string> = new Set<string>(['R-RUN-001', 'R-RUN-002']);

/**
 * Re-anchor ONLY the runtime diagnostics that genuinely carry a program position.
 *
 * Mapping the whole list would give the position-less ones a fabricated one: with a filled
 * template whose first extracted line is line 6, a `W-SWI-001` nominally on line 1 would be
 * underlined on the student's `Netzwerk 1` header and jump there when clicked. Leaving them on
 * line 1 keeps the message list honest — they belong to the program as a whole, not to a line.
 */
export function mapRuntimeDiagnostics(
  runtime: readonly Diagnostic[],
  lineMap: readonly number[] | undefined,
): readonly Diagnostic[] {
  if (lineMap === undefined) return runtime;
  return runtime.map((d) => (POSITIONED_RUNTIME_CODES.has(d.code)
    ? mapDiagnostics([d], lineMap)[0] ?? d
    : d));
}
