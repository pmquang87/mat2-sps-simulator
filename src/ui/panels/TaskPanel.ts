/**
 * TaskPanel — a STATIC, bilingual task document, rendered where the railway shows its
 * graded exercise browser.
 *
 * The pump experiment has no networks, no points and no check runs: it is the manual's
 * teaching example, and its whole purpose is that every instruction can be tried against a
 * live plant. Showing the railway's ExercisePanel there would promise grading that does not
 * exist, so the profile swaps in this panel instead (see `App.SimProfile`).
 *
 * Bodies use the same markdown-lite dialect as hints and examples (§5.5), so they render
 * through `contentView` with no special case and no innerHTML path.
 */
import type { LocalizedText } from '../../pedagogy';
import { append, clear, el } from '../dom';
import { lt, t } from '../i18n/i18n';
import { contentNodes } from './contentView';

export interface TaskDocSection {
  heading: LocalizedText;
  body: LocalizedText;
}

export interface TaskDoc {
  title: LocalizedText;
  intro: LocalizedText;
  sections: readonly TaskDocSection[];
}

export class TaskPanel {
  readonly element: HTMLElement;

  private readonly titleNode: HTMLElement;
  private readonly bodyNode: HTMLElement;
  private doc: TaskDoc | null = null;

  constructor(doc: TaskDoc | null = null) {
    this.titleNode = el('h2', { className: 'panel-title', text: t('task.title') });
    this.bodyNode = el('div', { className: 'tool-body' });
    this.element = el('section', {
      className: 'panel panel-task',
      children: [
        el('header', { className: 'panel-head', children: [this.titleNode] }),
        this.bodyNode,
      ],
    });
    this.setDoc(doc);
  }

  setDoc(doc: TaskDoc | null): void {
    this.doc = doc;
    this.render();
  }

  retranslate(): void {
    this.titleNode.textContent = t('task.title');
    this.render();
  }

  private render(): void {
    clear(this.bodyNode);
    const doc = this.doc;
    if (doc === null) return;
    append(this.bodyNode,
      el('h3', { className: 'tool-heading', text: lt(doc.title) }),
      el('p', { className: 'tool-intro', text: lt(doc.intro) }),
      el('p', { className: 'callout callout-note', text: t('task.note') }),
    );
    for (const section of doc.sections) {
      append(this.bodyNode,
        el('h4', { className: 'tool-subheading', text: lt(section.heading) }),
        ...contentNodes(section.body),
      );
    }
  }
}
