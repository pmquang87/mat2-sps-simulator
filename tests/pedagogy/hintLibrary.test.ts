/**
 * The shipped hint content (ARCHITECTURE.md §5.5 HintSpec, §7.3 content rules, §10.2):
 * completeness for all 22 networks of Gruppe A and B, bilingual authoring, the required
 * shape per level, and the neutral-operand rule for every level-2 example snippet.
 *
 * The forbidden-operand scan itself lives in `hints.test.ts` (§9.3).
 */
import { describe, expect, it } from 'vitest';

import {
  HINT_LIBRARY,
  HINT_LIBRARY_NETWORK_IDS,
  codeBlocks,
  hintsForNetwork,
  parseContent,
  referencedExampleIds,
  loadExamples,
  type HintSpec,
} from '../../src/pedagogy';
import { readJsonIfPresent } from './support/repoFiles';

const EXPECTED_IDS = [
  ...Array.from({ length: 11 }, (_, i) => `A-NW${i + 1}`),
  ...Array.from({ length: 11 }, (_, i) => `B-NW${i + 1}`),
];

/** Example ids ARCHITECTURE.md §7.4 documents by name — the only ones hints may deep-link. */
const DOCUMENTED_EXAMPLE_IDS = ['pump-selfhold', 'sv-pulse', 'weichenstrasse-template'];

describe('hint library coverage', () => {
  it('covers all 22 networks of Gruppe A and Gruppe B', () => {
    expect([...HINT_LIBRARY_NETWORK_IDS].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('provides exactly the three levels per network', () => {
    for (const id of EXPECTED_IDS) {
      const hints = hintsForNetwork(id);
      expect(hints.map((h) => h.level), id).toEqual([1, 2, 3]);
    }
  });

  it('returns an empty list for unknown networks', () => {
    expect(hintsForNetwork('C-NW1')).toEqual([]);
  });
});

describe('hint authoring rules', () => {
  const allHints: Array<{ id: string; hint: HintSpec }> = EXPECTED_IDS.flatMap((id) =>
    hintsForNetwork(id).map((hint) => ({ id, hint })),
  );

  it('is authored bilingually — DE and EN present and distinct', () => {
    for (const { id, hint } of allHints) {
      const where = `${id} level ${hint.level}`;
      expect(hint.title.de.trim().length, where).toBeGreaterThan(3);
      expect(hint.title.en.trim().length, where).toBeGreaterThan(3);
      expect(hint.body.de.trim().length, where).toBeGreaterThan(40);
      expect(hint.body.en.trim().length, where).toBeGreaterThan(40);
      expect(hint.body.de, where).not.toBe(hint.body.en);
    }
  });

  it('cites the manual on every level', () => {
    for (const { id, hint } of allHints) {
      const ref = hint.anleitungRef;
      expect(ref, `${id} level ${hint.level}`).toBeDefined();
      expect(ref?.section).toMatch(/^(IV|V)\./);
      expect(ref?.label.de.length).toBeGreaterThan(5);
      expect(ref?.label.en.length).toBeGreaterThan(5);
    }
  });

  it('level 1 is prose only — no code block, so it points at the concept', () => {
    for (const id of EXPECTED_IDS) {
      const level1 = hintsForNetwork(id)[0];
      expect(codeBlocks(level1?.body.de ?? ''), id).toEqual([]);
      expect(codeBlocks(level1?.body.en ?? ''), id).toEqual([]);
    }
  });

  it('level 2 carries a runnable AWL block in both languages plus a guiding question', () => {
    for (const id of EXPECTED_IDS) {
      const level2 = hintsForNetwork(id)[1];
      expect(codeBlocks(level2?.body.de ?? '', 'awl').length, id).toBeGreaterThan(0);
      expect(codeBlocks(level2?.body.en ?? '', 'awl').length, id).toBeGreaterThan(0);
      expect(level2?.body.de, id).toContain('?');
      expect(level2?.body.en, id).toContain('?');
    }
  });

  it('level 3 is a checklist of at least four items', () => {
    for (const id of EXPECTED_IDS) {
      const level3 = hintsForNetwork(id)[2];
      for (const lang of ['de', 'en'] as const) {
        const lists = parseContent(level3?.body[lang] ?? '').filter((b) => b.kind === 'list');
        expect(lists.length, `${id}.${lang}`).toBe(1);
        const first = lists[0];
        expect(first?.kind === 'list' ? first.items.length : 0, `${id}.${lang}`).toBeGreaterThan(3);
      }
    }
  });
});

// ── the neutral-operand rule for the example snippets (§10.2) ─────────────────────────────

const NEUTRAL_LINE_PATTERNS: readonly RegExp[] = [
  /^(U|UN|O|ON|X|XN|=|S|R|FP|FN)\s+(E|A|M)\s+(\d+)\.([0-7])$/,
  /^(U|UN|O|ON|X|XN)\s+T\s+(\d+)$/,
  /^(SI|SV|SE|SS|SA|R)\s+T\s+(\d+)$/,
  /^(ZV|ZR|R|S)\s+Z\s+(\d+)$/,
  /^L\s+S5T#[0-9A-Z]+$/,
  /^L\s+Z\s+(\d+)$/,
  /^L\s+\d+$/,
  /^(==I|<>I|>I|>=I|<I|<=I)$/,
  /^NOP\s+[01]$/,
];

interface OperandProblem {
  where: string;
  line: string;
  why: string;
}

function checkSnippet(where: string, code: string): OperandProblem[] {
  const problems: OperandProblem[] = [];
  for (const raw of code.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') continue;
    const matched = NEUTRAL_LINE_PATTERNS.some((re) => re.test(line));
    if (!matched) {
      problems.push({ where, line, why: 'not a recognised neutral-operand instruction' });
      continue;
    }
    // Byte/number ranges: students may use E/A 0.x–1.x, M 10.x–M 20.x, T 10–T 20, Z 1–Z 9.
    const bit = /^(?:U|UN|O|ON|X|XN|=|S|R|FP|FN)\s+(E|A|M)\s+(\d+)\.[0-7]$/.exec(line);
    if (bit !== null) {
      const area = bit[1];
      const byte = Number(bit[2]);
      if (area === 'M' && (byte < 10 || byte > 20)) {
        problems.push({ where, line, why: `flag byte M ${byte} is outside the student range 10…20` });
      }
      if ((area === 'E' || area === 'A') && byte > 1) {
        problems.push({ where, line, why: `${area} byte ${byte} is not a neutral example byte` });
      }
    }
    const timer = /\bT\s+(\d+)$/.exec(line);
    if (timer !== null) {
      const number = Number(timer[1]);
      if (number < 10 || number > 20) {
        problems.push({ where, line, why: `timer T ${number} is outside the student range 10…20` });
      }
    }
    const counter = /\bZ\s+(\d+)$/.exec(line);
    if (counter !== null && !line.startsWith('L ')) {
      const number = Number(counter[1]);
      if (number < 1 || number > 9) {
        problems.push({ where, line, why: `counter Z ${number} is outside the neutral range 1…9` });
      }
    }
  }
  return problems;
}

describe('level-2 example snippets', () => {
  it('use only neutral student operands (E 0.x, A 0.x, M 10…20, T 10…20, Z 1)', () => {
    const problems: OperandProblem[] = [];
    for (const [id, hints] of Object.entries(HINT_LIBRARY)) {
      for (const hint of hints) {
        for (const lang of ['de', 'en'] as const) {
          for (const [i, code] of codeBlocks(hint.body[lang]).entries()) {
            problems.push(...checkSnippet(`${id} level ${hint.level} ${lang} block ${i}`, code));
          }
        }
      }
    }
    expect(problems.map((p) => `${p.where}: "${p.line}" — ${p.why}`)).toEqual([]);
  });

  it('keeps the DE and EN snippets structurally identical (same instructions)', () => {
    for (const [id, hints] of Object.entries(HINT_LIBRARY)) {
      for (const hint of hints) {
        const de = codeBlocks(hint.body.de).map((code) => stripComments(code));
        const en = codeBlocks(hint.body.en).map((code) => stripComments(code));
        expect(en, `${id} level ${hint.level}`).toEqual(de);
      }
    }
  });
});

function stripComments(code: string): string {
  return code
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n');
}

// ── deep links into the examples library ─────────────────────────────────────────────────

describe('example deep links', () => {
  const examplesJson = readJsonIfPresent('src/data/examples.json');
  const shippedIds =
    examplesJson === null ? null : loadExamples(examplesJson).map((example) => example.id);

  it('every level-2 hint links a worked example', () => {
    for (const id of EXPECTED_IDS) {
      expect(hintsForNetwork(id)[1]?.exampleId, id).toBeDefined();
    }
  });

  it('resolve against the examples library (or the ids §7.4 documents by name)', () => {
    const known = shippedIds ?? DOCUMENTED_EXAMPLE_IDS;
    for (const id of referencedExampleIds()) {
      expect(known, `hint deep link "${id}"`).toContain(id);
    }
  });
});
