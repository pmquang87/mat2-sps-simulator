/**
 * HintPanel (ARCHITECTURE.md §3, §10.2): progressive hint reveal for the selected network.
 *
 * Level gating is pedagogy's `HintGate` (level 1 free; each failed check run, "I'm stuck"
 * click or full 5-minute window unlocks one more level — §5.5). The panel consults
 * `availableLevels()` before calling `reveal()` (which throws on locked levels by design)
 * and calls `visit()` when a network is shown so the 5-minute clock starts.
 */
import type { HintSpec, NetworkSpec, ProgressStore } from '../../pedagogy';
import { HintGate, MAX_HINT_LEVEL } from '../../pedagogy';
import { append, clear, el } from '../dom';
import { lt, t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';
import { contentNodes } from './contentView';

export interface HintPanelOptions {
  /** Deep link §10.2: a hint's `exampleId` jumps to the ExamplesPanel. */
  onShowExample?: (exampleId: string) => void;
}

const LEVEL_NAME_KEYS: Record<1 | 2 | 3, MsgKey> = {
  1: 'hints.levelName.1',
  2: 'hints.levelName.2',
  3: 'hints.levelName.3',
};

export class HintPanel {
  readonly element: HTMLElement;

  private readonly options: HintPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly bodyNode: HTMLElement;

  private network: NetworkSpec | null = null;
  private progress: ProgressStore | null = null;
  private gate: HintGate | null = null;

  constructor(options: HintPanelOptions = {}) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('hints.title') });
    this.bodyNode = el('div', { className: 'tool-body' });
    this.element = el('section', {
      className: 'panel panel-hints',
      children: [
        el('header', { className: 'panel-head', children: [this.titleNode] }),
        this.bodyNode,
      ],
    });
    this.render();
  }

  setProgress(progress: ProgressStore | null): void {
    this.progress = progress;
    this.rebuildGate();
    this.render();
  }

  /** Follow the ExercisePanel selection. */
  setNetwork(network: NetworkSpec | null): void {
    this.network = network;
    this.rebuildGate();
    this.render();
  }

  /** Re-evaluate gate state (call after check runs — a failed run unlocks a level). */
  refresh(): void {
    this.render();
  }

  retranslate(): void {
    this.titleNode.textContent = t('hints.title');
    this.render();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private rebuildGate(): void {
    if (this.network === null || this.progress === null) {
      this.gate = null;
      return;
    }
    this.gate = new HintGate(this.network.id, this.progress);
    this.gate.visit();                 // §5.5: starts the 5-minute unlock clock (once)
  }

  private render(): void {
    clear(this.bodyNode);
    if (this.network === null) {
      append(this.bodyNode, el('p', { className: 'tool-empty', text: t('hints.noNetwork') }));
      return;
    }
    append(this.bodyNode, el('h3', {
      className: 'tool-heading',
      text: t('hints.forNetwork', { network: this.network.id }),
    }));

    const hints = this.network.hints;
    if (hints.length === 0) {
      append(this.bodyNode, el('p', { className: 'tool-empty', text: t('hints.none') }));
      return;
    }

    const gate = this.gate;
    const available = gate?.availableLevels() ?? [1];
    const revealed = gate?.revealedLevels() ?? [];
    const total = Math.min(hints.length, MAX_HINT_LEVEL);

    for (const hint of hints) {
      const levelHead = el('div', {
        className: 'hint-head',
        children: [
          el('span', {
            className: 'hint-level',
            text: t('hints.level', { level: hint.level, total }),
          }),
          el('span', { className: 'hint-kind', text: t(LEVEL_NAME_KEYS[hint.level]) }),
          el('span', { className: 'spacer' }),
        ],
      });
      const box = el('div', { className: 'hint-box', children: [levelHead] });

      if (revealed.includes(hint.level)) {
        this.renderHintBody(box, hint);
      } else if (available.includes(hint.level)) {
        append(box, el('button', {
          className: 'btn',
          attrs: { type: 'button' },
          text: `${t('hints.show')} — ${lt(hint.title)}`,
          onClick: () => {
            this.gate?.reveal(hint.level);
            this.render();
          },
        }));
      } else {
        box.classList.add('is-locked');
        append(levelHead, el('span', { className: 'chip', text: t('hints.locked') }));
        append(box, el('p', { className: 'tool-note', text: t('hints.lockedInfo') }));
      }
      append(this.bodyNode, box);
    }

    // "I'm stuck" — §5.5 unlock trigger (c); only shown while something is still locked.
    if (gate !== null && gate.nextLockedLevel() !== null) {
      append(this.bodyNode, el('button', {
        className: 'btn hint-stuck',
        attrs: { type: 'button' },
        text: t('hints.stuck'),
        onClick: () => {
          gate.requestUnlock();
          this.render();
        },
      }));
    }
  }

  private renderHintBody(box: HTMLElement, hint: HintSpec): void {
    append(box,
      el('h4', { className: 'tool-subheading', text: lt(hint.title) }),
      ...contentNodes(hint.body),
    );
    if (hint.anleitungRef !== undefined) {
      append(box, el('p', {
        className: 'tool-note',
        text: t('hints.reference', { label: lt(hint.anleitungRef.label) }),
      }));
    }
    if (hint.exampleId !== undefined && this.options.onShowExample !== undefined) {
      const exampleId = hint.exampleId;
      append(box, el('button', {
        className: 'btn btn-ghost',
        attrs: { type: 'button' },
        text: t('hints.openExample'),
        onClick: () => this.options.onShowExample?.(exampleId),
      }));
    }
  }
}
