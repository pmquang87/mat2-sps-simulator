/**
 * DiagnosticsPanel (ARCHITECTURE.md §3): the localized parse/runtime diagnostics list;
 * clicking a row jumps to the offending editor line.
 *
 * Compile diagnostics come from `Emulator.load()`, runtime diagnostics (R-RUN-001/002) from
 * `SimCoordinator.lastScan` — those are NOT SimEvents (§5.2 step 3, §6.3).
 */
import type { Diagnostic } from '../../core';
import { append, clear, el } from '../dom';
import { diagnosticHint, diagnosticText } from '../editor/lint';
import { t } from '../i18n/i18n';

export interface DiagnosticsPanelOptions {
  /** Jump to a source position (1-based line/col). */
  onSelect?: (line: number, col: number) => void;
}

function severityLabel(diagnostic: Diagnostic): string {
  switch (diagnostic.severity) {
    case 'error':   return t('diagnostics.error');
    case 'warning': return t('diagnostics.warning');
    case 'info':    return t('diagnostics.info');
  }
}

export class DiagnosticsPanel {
  readonly element: HTMLElement;

  private readonly options: DiagnosticsPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly summaryNode: HTMLElement;
  private readonly listNode: HTMLElement;

  private diagnostics: readonly Diagnostic[] = [];

  constructor(options: DiagnosticsPanelOptions = {}) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('diagnostics.title') });
    this.summaryNode = el('span', { className: 'panel-note' });
    this.listNode = el('ul', { className: 'diag-list' });
    this.element = el('section', {
      className: 'panel panel-diagnostics',
      children: [
        el('header', {
          className: 'panel-head',
          children: [this.titleNode, el('span', { className: 'spacer' }), this.summaryNode],
        }),
        this.listNode,
      ],
    });
    this.render();
  }

  setDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.diagnostics = diagnostics;
    this.render();
  }

  retranslate(): void {
    this.titleNode.textContent = t('diagnostics.title');
    this.render();
  }

  private render(): void {
    clear(this.listNode);
    const errors = this.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = this.diagnostics.filter((d) => d.severity === 'warning').length;
    this.summaryNode.textContent = this.diagnostics.length === 0
      ? ''
      : t('diagnostics.summary', { errors, warnings });

    if (this.diagnostics.length === 0) {
      this.listNode.appendChild(el('li', { className: 'diag-empty', text: t('diagnostics.none') }));
      return;
    }

    for (const diagnostic of this.diagnostics) {
      const hint = diagnosticHint(diagnostic);
      const row = el('li', {
        className: `diag-row diag-${diagnostic.severity}`,
        children: [
          el('span', { className: 'diag-severity', text: severityLabel(diagnostic) }),
          el('div', {
            className: 'diag-body',
            children: [
              el('span', { className: 'diag-message', text: diagnosticText(diagnostic) }),
              el('span', {
                className: 'diag-where',
                text: t('diagnostics.at', { line: diagnostic.line, col: diagnostic.col }),
              }),
              hint === undefined
                ? null
                : el('span', { className: 'diag-hint', text: `${t('diagnostics.hint')}: ${hint}` }),
            ],
          }),
        ],
      });
      if (this.options.onSelect !== undefined) {
        row.classList.add('is-clickable');
        row.title = t('diagnostics.jumpTo');
        row.tabIndex = 0;
        // Announced as an actionable row, not as a plain list item (same rule as the
        // exercise network rows): the row activates on click / Enter / Space.
        row.setAttribute('role', 'button');
        const jump = (): void => this.options.onSelect?.(diagnostic.line, diagnostic.col);
        row.addEventListener('click', jump);
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            jump();
          }
        });
      }
      append(this.listNode, row);
    }
  }
}
