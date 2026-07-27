/**
 * Shared renderer for pedagogy's markdown-lite content model (ARCHITECTURE.md §5.5:
 * hint/example bodies are "paragraphs + fenced awl blocks"; §10.2/§10.3 render them).
 *
 * pedagogy/ parses the block structure (`localizedContent`), this module turns it into DOM.
 * Everything goes through text nodes (ui/dom.ts has no innerHTML path), so content can
 * never be interpreted as markup.
 *
 * Deviation note (§3 file list): helper file, not a §3 panel — same rationale as ui/dom.ts
 * (no new module boundary, no new public contract).
 */
import type { ContentBlock, LocalizedText } from '../../pedagogy';
import { localizedContent } from '../../pedagogy';
import { el } from '../dom';
import { getLocale } from '../i18n/i18n';

function blockNode(block: ContentBlock): HTMLElement {
  switch (block.kind) {
    case 'paragraph':
      return el('p', { className: 'content-paragraph', text: block.text });
    case 'list':
      return el('ul', {
        className: 'content-list',
        children: block.items.map((item) => el('li', { text: item })),
      });
    case 'code':
      return el('pre', {
        className: 'content-code',
        children: [el('code', { text: block.code })],
      });
  }
}

/** Render a LocalizedText body in the current UI locale. */
export function contentNodes(text: LocalizedText): HTMLElement[] {
  const lang = getLocale() === 'de' ? 'de' : 'en';
  return localizedContent(text, lang).map(blockNode);
}

/** Render a raw AWL snippet as a code block (examples' `awl` field is not markdown). */
export function codeNode(code: string): HTMLElement {
  return el('pre', { className: 'content-code', children: [el('code', { text: code })] });
}
