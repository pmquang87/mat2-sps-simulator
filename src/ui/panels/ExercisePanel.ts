/**
 * ExercisePanel (ARCHITECTURE.md §3, §10.1): the exercise browser — Gruppe A / Gruppe B →
 * 11 networks with points and status chips, the network view with the official DE task
 * text plus its EN translation (both always visible regardless of UI locale — the German
 * text is exam-relevant), `symbolNotes` callouts, the "Run checks" button and the check
 * result list.
 *
 * The panel owns no simulation state: the actual check run is delegated to the injected
 * `onRunChecks` (implemented in main.ts over a fresh headless stack, §10.1) and progress
 * comes from the injected pedagogy ProgressStore.
 */
import type {
  CheckResult,
  CheckSummary,
  ExerciseSpec,
  NetworkSpec,
  ProgressStore,
} from '../../pedagogy';
import { append, clear, el } from '../dom';
import { lt, t } from '../i18n/i18n';
import { contentNodes } from './contentView';

/** Outcome of one "Run checks" click — produced by main.ts, rendered here. */
export interface CheckRunReport {
  status: 'ok' | 'noProgram' | 'error';
  message?: string;                        // error text for status 'error'
  results: CheckResult[];
  summary: CheckSummary | null;
  simTimeMs: number;                       // length of the simulated run
}

export interface NetworkSelection {
  exerciseId: string;
  network: NetworkSpec;
}

export interface ExercisePanelOptions {
  /** Run the network's checks; null when the simulation stack is unavailable. */
  onRunChecks: (networkId: string) => CheckRunReport | null;
  /** Notify the shell (HintPanel follows the selection). */
  onSelectNetwork?: (selection: NetworkSelection | null) => void;
}

export class ExercisePanel {
  readonly element: HTMLElement;

  private readonly options: ExercisePanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly bodyNode: HTMLElement;

  private exercises: readonly ExerciseSpec[] | null = null;
  private progress: ProgressStore | null = null;
  private unavailableReason = '';
  private selectedId: string | null = null;
  /** Last network opened from the tree — the row keeps `aria-current` after "← All networks",
   *  which is honest: that network is still the one the Hints tab shows. */
  private lastOpenedId: string | null = null;
  private lastReport: CheckRunReport | null = null;
  /** Network id the last report belongs to (results are per-network). */
  private lastReportNetworkId: string | null = null;

  constructor(options: ExercisePanelOptions) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('exercise.title') });
    this.bodyNode = el('div', { className: 'tool-body' });
    this.element = el('section', {
      className: 'panel panel-exercises',
      children: [
        el('header', { className: 'panel-head', children: [this.titleNode] }),
        this.bodyNode,
      ],
    });
    this.render();
  }

  /** Supply the loaded exercise data (null = unavailable, with a reason). */
  setData(
    exercises: readonly ExerciseSpec[] | null,
    progress: ProgressStore | null,
    unavailableReason = '',
  ): void {
    this.exercises = exercises;
    this.progress = progress;
    this.unavailableReason = unavailableReason;
    this.render();
  }

  retranslate(): void {
    this.titleNode.textContent = t('exercise.title');
    this.render();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private findNetwork(id: string): NetworkSelection | null {
    if (this.exercises === null) return null;
    for (const exercise of this.exercises) {
      for (const network of exercise.networks) {
        if (network.id === id) return { exerciseId: exercise.id, network };
      }
    }
    return null;
  }

  private select(id: string | null): void {
    this.selectedId = id;
    if (id !== null) this.lastOpenedId = id;
    const selection = id === null ? null : this.findNetwork(id);
    this.options.onSelectNetwork?.(selection);
    this.render();
  }

  private runChecks(network: NetworkSpec): void {
    const report = this.options.onRunChecks(network.id);
    this.lastReport = report;
    this.lastReportNetworkId = network.id;
    this.render();
  }

  private render(): void {
    clear(this.bodyNode);
    if (this.exercises === null) {
      append(this.bodyNode, el('p', {
        className: 'tool-empty',
        text: t('exercise.unavailable', { reason: this.unavailableReason }),
      }));
      return;
    }
    const selection = this.selectedId === null ? null : this.findNetwork(this.selectedId);
    if (selection === null) this.renderTree();
    else this.renderNetwork(selection.network);
  }

  private statusChip(networkId: string): HTMLElement {
    const status = this.progress?.networkStatus(networkId) ?? 'untouched';
    const key = status === 'passed'
      ? 'exercise.status.passed'
      : status === 'attempted'
        ? 'exercise.status.attempted'
        : 'exercise.status.untouched';
    return el('span', { className: `chip chip-status chip-status-${status}`, text: t(key) });
  }

  private renderTree(): void {
    if (this.exercises === null) return;
    for (const exercise of this.exercises) {
      append(this.bodyNode,
        el('h3', { className: 'tool-heading', text: lt(exercise.title) }),
        el('p', { className: 'tool-intro', text: lt(exercise.intro) }),
      );
      const list = el('ul', { className: 'network-list' });
      for (const network of exercise.networks) {
        // The row IS a button (click / Enter / Space open the network view), so it must say
        // so: a plain <li tabindex="0"> is announced as a list item with no action.
        const row = el('li', {
          className: 'network-row',
          attrs: { role: 'button' },
          children: [
            el('span', { className: 'network-id', text: network.id }),
            el('span', { className: 'network-title', text: lt(network.title) }),
            el('span', { className: 'spacer' }),
            el('span', {
              className: 'network-points',
              text: t('exercise.points', { points: network.points }),
            }),
            this.statusChip(network.id),
          ],
          onClick: () => this.select(network.id),
        });
        row.tabIndex = 0;
        if (network.id === this.lastOpenedId) row.setAttribute('aria-current', 'true');
        row.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            this.select(network.id);
          }
        });
        list.appendChild(row);
      }
      append(this.bodyNode, list);
    }
  }

  private renderNetwork(network: NetworkSpec): void {
    const runButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'button' },
      text: t('exercise.runChecks'),
      title: t('exercise.runChecksTitle'),
      onClick: () => this.runChecks(network),
    });

    append(this.bodyNode,
      el('div', {
        className: 'network-head',
        children: [
          el('button', {
            className: 'btn btn-ghost',
            attrs: { type: 'button' },
            text: t('exercise.back'),
            onClick: () => this.select(null),
          }),
          el('span', { className: 'spacer' }),
          this.statusChip(network.id),
        ],
      }),
      el('h3', {
        className: 'tool-heading',
        text: `${network.id} — ${lt(network.title)}`,
      }),
      el('p', {
        className: 'network-points-line',
        text: t('exercise.points', { points: network.points }),
      }),
      el('h4', { className: 'tool-subheading', text: t('exercise.taskDe') }),
      ...contentTextNodes(network.task.de),
      el('h4', { className: 'tool-subheading', text: t('exercise.taskEn') }),
      ...contentTextNodes(network.task.en),
    );

    if (network.symbolNotes !== undefined) {
      append(this.bodyNode, el('div', {
        className: 'callout callout-note',
        children: [
          el('strong', { text: t('exercise.symbolNotes') }),
          ...contentNodes(network.symbolNotes),
        ],
      }));
    }

    append(this.bodyNode,
      el('div', { className: 'network-actions', children: [runButton] }),
      el('p', { className: 'tool-note', text: t('exercise.runInfo') }),
    );

    if (this.lastReport !== null && this.lastReportNetworkId === network.id) {
      this.renderReport(this.lastReport);
    }
  }

  private renderReport(report: CheckRunReport): void {
    if (report.status === 'noProgram') {
      append(this.bodyNode, el('p', { className: 'callout callout-warn', text: t('exercise.noProgram') }));
      return;
    }
    if (report.status === 'error') {
      append(this.bodyNode, el('p', {
        className: 'callout callout-warn',
        text: t('exercise.checkError', { reason: report.message ?? '' }),
      }));
      return;
    }

    append(this.bodyNode, el('h4', { className: 'tool-subheading', text: t('exercise.results') }));
    if (report.summary !== null) {
      append(this.bodyNode, el('p', {
        className: 'tool-note',
        text: t('exercise.resultSummary', {
          passed: report.summary.passed,
          failed: report.summary.failed,
          pending: report.summary.pending,
        }),
      }));
      if (report.summary.allPassed) {
        append(this.bodyNode, el('p', { className: 'callout callout-ok', text: t('exercise.allPassed') }));
      }
    }
    const list = el('ul', { className: 'check-list' });
    for (const result of report.results) {
      const label = result.status === 'pass'
        ? t('exercise.result.pass')
        : result.status === 'fail'
          ? t('exercise.result.fail')
          : t('exercise.result.pending');
      append(list, el('li', {
        className: `check-row check-${result.status}`,
        children: [
          el('span', { className: 'check-status', text: label }),
          el('div', {
            className: 'check-body',
            children: [
              el('span', { className: 'check-id', text: result.checkId }),
              result.detail === undefined
                ? null
                : el('span', { className: 'check-detail', text: lt(result.detail) }),
            ],
          }),
        ],
      }));
    }
    append(this.bodyNode, list);
  }
}

/** Task texts are plain prose with line breaks — render one <p> per paragraph. */
function contentTextNodes(text: string): HTMLElement[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => el('p', { className: 'content-paragraph', text: paragraph }));
}
