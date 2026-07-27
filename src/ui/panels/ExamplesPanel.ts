/**
 * ExamplesPanel (ARCHITECTURE.md §3, §10.3): the examples library browser — read-only AWL
 * snippets grouped by category, with a copy button and "Insert into editor".
 *
 * §10.3 asks for a scratch tab so student code is never overwritten; M1 has a single
 * editor buffer, so the insert action confirms first when it would replace non-empty,
 * differing content (the buffer also stays in the CodeMirror undo history). Documented
 * deviation — a real scratch tab is an M2 refinement.
 */
import type { ExampleSpec } from '../../pedagogy';
import {
  exampleAsEditorSource,
  findExample,
  groupExamplesByCategory,
} from '../../pedagogy';
import { append, clear, el } from '../dom';
import { getLocale, lt, t } from '../i18n/i18n';
import { codeNode, contentNodes } from './contentView';

export interface ExamplesPanelOptions {
  /** Insert a runnable snippet into the editor (the shell asks for confirmation). */
  onLoadIntoEditor: (source: string) => void;
}

export class ExamplesPanel {
  readonly element: HTMLElement;

  private readonly options: ExamplesPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly bodyNode: HTMLElement;

  private examples: readonly ExampleSpec[] | null = null;
  private unavailableReason = '';
  private readonly cardById = new Map<string, HTMLElement>();

  constructor(options: ExamplesPanelOptions) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('examples.title') });
    this.bodyNode = el('div', { className: 'tool-body' });
    this.element = el('section', {
      className: 'panel panel-examples',
      children: [
        el('header', { className: 'panel-head', children: [this.titleNode] }),
        this.bodyNode,
      ],
    });
    this.render();
  }

  setExamples(examples: readonly ExampleSpec[] | null, unavailableReason = ''): void {
    this.examples = examples;
    this.unavailableReason = unavailableReason;
    this.render();
  }

  /** Deep link from a hint (§10.2): expand + scroll the example into view. */
  showExample(id: string): void {
    const card = this.cardById.get(id);
    if (card === undefined) return;
    if (card instanceof HTMLDetailsElement) card.open = true;
    card.scrollIntoView({ block: 'nearest' });
    card.classList.add('is-highlighted');
    window.setTimeout(() => card.classList.remove('is-highlighted'), 1600);
  }

  hasExample(id: string): boolean {
    return this.examples !== null && findExample([...this.examples], id) !== null;
  }

  retranslate(): void {
    this.titleNode.textContent = t('examples.title');
    this.render();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private render(): void {
    clear(this.bodyNode);
    this.cardById.clear();
    if (this.examples === null) {
      append(this.bodyNode, el('p', {
        className: 'tool-empty',
        text: t('examples.unavailable', { reason: this.unavailableReason }),
      }));
      return;
    }

    for (const group of groupExamplesByCategory([...this.examples])) {
      append(this.bodyNode, el('h3', { className: 'tool-heading', text: lt(group.title) }));
      for (const example of group.examples) {
        const card = this.renderExample(example);
        this.cardById.set(example.id, card);
        append(this.bodyNode, card);
      }
    }
  }

  private renderExample(example: ExampleSpec): HTMLElement {
    const lang = getLocale() === 'de' ? 'de' : 'en';
    const copyButton = el('button', {
      className: 'btn btn-ghost',
      attrs: { type: 'button' },
      text: t('examples.copy'),
      title: t('examples.copyTitle'),
      onClick: () => {
        void navigator.clipboard?.writeText(example.awl).catch(() => { /* clipboard blocked */ });
      },
    });
    const loadButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      text: t('examples.load'),
      title: t('examples.loadTitle'),
      onClick: () => this.options.onLoadIntoEditor(exampleAsEditorSource(example, lang)),
    });

    const details = el('details', {
      className: 'example-card',
      children: [
        el('summary', { className: 'example-summary', text: lt(example.title) }),
        el('div', {
          className: 'example-body',
          children: [
            ...contentNodes(example.body),
            codeNode(example.awl),
            el('div', {
              className: 'example-actions',
              children: [
                el('span', {
                  className: 'tool-note',
                  text: t('examples.source', { source: example.source }),
                }),
                el('span', { className: 'spacer' }),
                copyButton,
                loadButton,
              ],
            }),
          ],
        }),
      ],
    });
    return details;
  }
}
