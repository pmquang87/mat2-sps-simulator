/**
 * Markdown-lite content model (ARCHITECTURE.md §5.5: `body` is "markdown-lite: paragraphs
 * + fenced awl blocks"; §10.2/§10.3 render hint bodies and example explanations).
 *
 * pedagogy/ is pure logic — it produces the BLOCK STRUCTURE, ui/ renders it. Keeping the
 * parser here means the HintPanel and the ExamplesPanel share one rendering contract and
 * the leak guard (hints.ts) can reason about fenced code blocks separately from prose,
 * which the §7.3 rule set requires (`STOP` is forbidden only INSIDE fenced awl blocks).
 */
import type { LocalizedText } from './types';

export type ContentBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lang: string; code: string };

const FENCE_RE = /^\s*```(\w*)\s*$/;
/** `–` (en dash, used by the §7.3 example hints), `-`, `*`, `•` followed by a space. */
const BULLET_RE = /^\s*[-–*•]\s+(.*)$/;

/**
 * Parse markdown-lite: fenced code blocks, bullet lists, blank-line separated paragraphs.
 * Unterminated fences are treated as running to the end of the text (tolerant by design —
 * a malformed hint body must still render).
 */
export function parseContent(md: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };
  const flushText = (): void => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushText();
      const lang = fence[1] ?? '';
      const code: string[] = [];
      i += 1;
      while (i < lines.length) {
        const codeLine = lines[i] ?? '';
        if (FENCE_RE.test(codeLine)) break;
        code.push(codeLine);
        i += 1;
      }
      blocks.push({ kind: 'code', lang, code: code.join('\n') });
      continue;
    }

    if (line.trim() === '') {
      flushText();
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      items.push((bullet[1] ?? '').trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushText();
  return blocks;
}

/** Parse the given language variant of a LocalizedText. */
export function localizedContent(text: LocalizedText, lang: keyof LocalizedText): ContentBlock[] {
  return parseContent(text[lang]);
}

/** The fenced code blocks of a markdown-lite text, optionally filtered by language tag. */
export function codeBlocks(md: string, lang?: string): string[] {
  const out: string[] = [];
  for (const block of parseContent(md)) {
    if (block.kind !== 'code') continue;
    if (lang !== undefined && block.lang !== lang) continue;
    out.push(block.code);
  }
  return out;
}

/** Everything that is NOT inside a fenced code block, joined — prose only. */
export function proseOnly(md: string): string {
  const out: string[] = [];
  for (const block of parseContent(md)) {
    if (block.kind === 'paragraph') out.push(block.text);
    else if (block.kind === 'list') out.push(block.items.join('\n'));
  }
  return out.join('\n');
}
