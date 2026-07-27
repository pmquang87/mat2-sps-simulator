/**
 * CM6 lint source adapter over the core Diagnostics (ARCHITECTURE.md §3, §5.1.5).
 *
 * core produces `Diagnostic { code, severity, line, col, length?, message{de,en}, hint? }`
 * with 1-based line/col; CodeMirror wants absolute document offsets. Messages are picked by
 * the current locale — the diagnostics catalog already ships DE+EN (§5.6).
 */
import { forceLinting, linter } from '@codemirror/lint';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import type { Diagnostic, Severity } from '../../core';
import { getLocale, t } from '../i18n/i18n';

function cmSeverity(severity: Severity): CmDiagnostic['severity'] {
  switch (severity) {
    case 'error':   return 'error';
    case 'warning': return 'warning';
    case 'info':    return 'info';
  }
}

/** Localized message text, with the code prefixed so students can look it up. */
export function diagnosticText(diagnostic: Diagnostic): string {
  const locale = getLocale();
  const message = locale === 'de' ? diagnostic.message.de : diagnostic.message.en;
  return `${diagnostic.code}: ${message}`;
}

/** Localized hint text, if the diagnostic carries one. */
export function diagnosticHint(diagnostic: Diagnostic): string | undefined {
  if (diagnostic.hint === undefined) return undefined;
  return getLocale() === 'de' ? diagnostic.hint.de : diagnostic.hint.en;
}

/** Map one core Diagnostic onto a document range, clamped into the current document. */
export function toCmDiagnostic(doc: Text, diagnostic: Diagnostic): CmDiagnostic {
  const lineNumber = Math.min(Math.max(diagnostic.line, 1), doc.lines);
  const line = doc.line(lineNumber);
  const from = Math.min(line.from + Math.max(diagnostic.col - 1, 0), line.to);
  const to = Math.min(from + Math.max(diagnostic.length ?? 1, 1), line.to);
  const hint = diagnosticHint(diagnostic);
  return {
    from,
    to: to > from ? to : Math.min(from + 1, line.to),
    severity: cmSeverity(diagnostic.severity),
    message: hint === undefined
      ? diagnosticText(diagnostic)
      : `${diagnosticText(diagnostic)}\n${t('diagnostics.hint')}: ${hint}`,
  };
}

/**
 * Lint extension driven by a getter, not by re-parsing in the editor: the single source of
 * truth for diagnostics is the emulator's `load()` result (plus runtime diagnostics from
 * `coordinator.lastScan`), which the panel refreshes via `refreshLint`.
 */
export function awlLinter(getDiagnostics: () => readonly Diagnostic[]): Extension {
  return linter(
    (view) => getDiagnostics().map((d) => toCmDiagnostic(view.state.doc, d)),
    { delay: 100 },
  );
}

/** Re-run the lint source now (after a new load result arrived, or on locale change). */
export function refreshLint(view: EditorView): void {
  forceLinting(view);
}
