/**
 * examples.json → ExampleSpec[] for the ExamplesPanel (ARCHITECTURE.md §5.5, schema §7.4),
 * plus the pure-logic half of the examples library (§10.3): category grouping, lookup, and
 * turning an example into a runnable editor buffer.
 */
import type { ExampleSpec, LocalizedText } from './types';
import {
  asBoolean,
  asInt,
  asLocalizedText,
  asNonEmptyArray,
  asRecord,
  asString,
  fail,
  noExtraKeys,
  oneOf,
} from './validate';

export const EXAMPLES_FILE_VERSION = 1;

export type ExampleCategory = ExampleSpec['category'];

/** Display order in the ExamplesPanel: from the simplest binary logic to composed patterns. */
export const EXAMPLE_CATEGORIES: readonly ExampleCategory[] = [
  'binary',
  'memory',
  'timer',
  'edge',
  'counter',
  'compare',
  'jump',
  'pattern',
];

/** Localized category headings — pedagogy content, so bilingual inline (§10.6). */
export const EXAMPLE_CATEGORY_TITLES: Readonly<Record<ExampleCategory, LocalizedText>> = {
  binary: { de: 'Binäre Verknüpfungen', en: 'Binary logic' },
  memory: { de: 'Speicherfunktionen', en: 'Memory functions' },
  timer: { de: 'Zeitfunktionen', en: 'Timer functions' },
  edge: { de: 'Flankenauswertung', en: 'Edge evaluation' },
  counter: { de: 'Zählfunktionen', en: 'Counter functions' },
  compare: { de: 'Vergleichsfunktionen', en: 'Comparison functions' },
  jump: { de: 'Sprungoperationen', en: 'Jump operations' },
  pattern: { de: 'Zusammengesetzte Muster', en: 'Composed patterns' },
};

export function loadExamples(json: unknown): ExampleSpec[] {
  const root = asRecord(json, 'examples.json');
  noExtraKeys(root, 'examples.json', ['version', 'examples']);
  const version = asInt(root['version'], 'examples.json.version');
  if (version !== EXAMPLES_FILE_VERSION) {
    fail(
      'examples.json.version',
      `unsupported version ${version} (expected ${EXAMPLES_FILE_VERSION})`,
    );
  }

  const raw = asNonEmptyArray(root['examples'], 'examples.json.examples');
  const seen = new Set<string>();
  let starterId: string | null = null;
  return raw.map((rawExample, i) => {
    const path = `examples[${i}]`;
    const rec = asRecord(rawExample, path);
    noExtraKeys(rec, path, ['id', 'category', 'title', 'body', 'awl', 'source', 'starter']);
    const id = asString(rec['id'], `${path}.id`);
    if (seen.has(id)) fail(`${path}.id`, `duplicate example id "${id}"`);
    seen.add(id);
    const example: ExampleSpec = {
      id,
      category: oneOf(rec['category'], `${path}.category`, EXAMPLE_CATEGORIES),
      title: asLocalizedText(rec['title'], `${path}.title`),
      body: asLocalizedText(rec['body'], `${path}.body`),
      awl: asString(rec['awl'], `${path}.awl`),
      source: asString(rec['source'], `${path}.source`),
    };
    if (rec['starter'] !== undefined) {
      example.starter = asBoolean(rec['starter'], `${path}.starter`);
      if (example.starter) {
        if (starterId !== null) {
          fail(`${path}.starter`, `a second starter example ("${starterId}" is already flagged)`);
        }
        starterId = id;
      }
    }
    return example;
  });
}

/**
 * The first-run editor buffer (§7.4): the example flagged `starter`, or null if the library
 * has none. It exists so the very first "Load into PLC" is warning-free — the Anleitung
 * examples are kept verbatim and therefore write outside the student resource whitelist
 * (W-RES-001, §5.1.5).
 */
export function starterExample(examples: readonly ExampleSpec[]): ExampleSpec | null {
  for (const example of examples) {
    if (example.starter === true) return example;
  }
  return null;
}

/** Tolerant variant for optional data: `[]` when the file is absent. */
export function loadExamplesOrEmpty(json: unknown): ExampleSpec[] {
  if (json === undefined || json === null) return [];
  return loadExamples(json);
}

export function findExample(examples: readonly ExampleSpec[], id: string): ExampleSpec | null {
  for (const example of examples) {
    if (example.id === id) return example;
  }
  return null;
}

export interface ExampleGroup {
  category: ExampleCategory;
  title: LocalizedText;
  examples: readonly ExampleSpec[];
}

/** Group by category in `EXAMPLE_CATEGORIES` order, dropping empty groups. */
export function groupExamplesByCategory(examples: readonly ExampleSpec[]): ExampleGroup[] {
  const out: ExampleGroup[] = [];
  for (const category of EXAMPLE_CATEGORIES) {
    const members = examples.filter((example) => example.category === category);
    if (members.length === 0) continue;
    out.push({ category, title: EXAMPLE_CATEGORY_TITLES[category], examples: members });
  }
  return out;
}

/**
 * The "Load into editor" payload (§10.3): the snippet with a provenance header, so a scratch
 * tab always says where the code came from. `lang` is a LocalizedText key — pedagogy does not
 * import ui's `Locale` type (§2 rule 5).
 */
export function exampleAsEditorSource(example: ExampleSpec, lang: keyof LocalizedText): string {
  const header = [`// ${example.title[lang]}`, `// ${example.source}`].join('\n');
  return `${header}\n${example.awl.replace(/\s+$/, '')}\n`;
}

/** Line count of a snippet — the ExamplesPanel shows it as a "size" hint. */
export function exampleLineCount(example: ExampleSpec): number {
  return example.awl.split('\n').filter((line) => line.trim() !== '').length;
}

/** Ids referenced nowhere else — helper for the data-consistency tests. */
export function exampleIds(examples: readonly ExampleSpec[]): string[] {
  return examples.map((example) => example.id);
}

/** Guard for tests/dev: examples must stay operand-neutral (§7.4 "NEUTRAL operands"). */
export function examplesWithPlantSymbols(examples: readonly ExampleSpec[]): ExampleSpec[] {
  const plantSymbol = /\b(xW\w*|xR\w*|Speed[123](IU|GU))\b|XW03CR|XW05BH1G3R/;
  const out: ExampleSpec[] = [];
  for (const example of examples) {
    if (plantSymbol.test(example.awl)) out.push(example);
  }
  return out;
}

/** Snippet split into lines — the panel renders one row per AWL line. */
export function exampleAwlLines(example: ExampleSpec): string[] {
  return example.awl.split('\n');
}
