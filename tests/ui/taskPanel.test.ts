/**
 * The pump experiment's Exercises tab: a STATIC task document instead of the railway's
 * graded exercise browser (`SimProfile.taskDoc`).
 *
 * Scope note: the tab SWAP itself lives in `App`, which cannot be constructed in the node
 * environment (it builds a CodeMirror `EditorView`). What is checkable headlessly — and is
 * checked here — is that the profile carries the document, that the shipped `TaskPanel`
 * renders it, and that the content is complete in BOTH languages: the signal map is the
 * Anleitung's and non-negotiable, so a missing address is a factual error, not a typo.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUMP_TASK } from '../../src/pump';
import { setLocale } from '../../src/ui/i18n/i18n';
import { installFakeDocument, walk, type FakeElement } from './support/fakeDom';

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
});

afterEach(() => {
  setLocale('en');
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

async function render(): Promise<FakeElement> {
  const { TaskPanel } = await import('../../src/ui/panels/TaskPanel');
  return new TaskPanel(PUMP_TASK).element as unknown as FakeElement;
}

function text(root: FakeElement): string {
  return walk(root).map((node) => node.textContent).join('\n');
}

describe('PUMP_TASK content', () => {
  it('is complete in both languages', () => {
    for (const lang of ['de', 'en'] as const) {
      expect(PUMP_TASK.title[lang].trim()).not.toBe('');
      expect(PUMP_TASK.intro[lang].trim()).not.toBe('');
      for (const section of PUMP_TASK.sections) {
        expect(section.heading[lang].trim()).not.toBe('');
        expect(section.body[lang].trim()).not.toBe('');
      }
    }
    expect(PUMP_TASK.sections.length).toBeGreaterThanOrEqual(3);
  });

  /** The Anleitung's map (IV.2.5.2, Abbildung 4) — every address must be stated verbatim. */
  it('states the manual’s full signal map in both languages', () => {
    const addresses = ['E 0.0', 'E 0.1', 'E 0.2', 'E 0.3', 'E 0.4', 'E 0.5', 'E 0.6', 'A 0.1'];
    for (const lang of ['de', 'en'] as const) {
      const body = PUMP_TASK.sections.map((s) => s.body[lang]).join('\n');
      for (const address of addresses) {
        expect(body, `${lang}: ${address}`).toContain(address);
      }
      // …and the extra pedestal signals the model adds beyond the figure.
      expect(body, lang).toContain('E 1.0');
      expect(body, lang).toContain('A 0.2');
    }
  });

  it('states the start and stop conditions', () => {
    const de = PUMP_TASK.sections.map((s) => s.body.de).join('\n');
    const en = PUMP_TASK.sections.map((s) => s.body.en).join('\n');
    expect(de).toContain('Startbedingungen');
    expect(de).toContain('Endbedingungen');
    expect(en.toLowerCase()).toContain('start:');
    expect(en.toLowerCase()).toContain('stop:');
  });
});

describe('TaskPanel', () => {
  it('renders the document in the active locale', async () => {
    setLocale('en');
    const english = text(await render());
    expect(english).toContain(PUMP_TASK.title.en);
    expect(english).toContain('E 0.5');

    setLocale('de');
    const german = text(await render());
    expect(german).toContain(PUMP_TASK.title.de);
    expect(german).toContain('Trockenlaufschutz');
    expect(german).not.toContain(PUMP_TASK.intro.en);
  });

  it('says the experiment is not graded — there is no check run to offer', async () => {
    const root = await render();
    expect(walk(root).some((node) => node.className.includes('callout-note'))).toBe(true);
    // No "Run checks" affordance anywhere: this panel has no buttons at all.
    expect(walk(root).filter((node) => node.tagName === 'button')).toEqual([]);
  });

  it('renders the manual’s AWL snippet as a code block, not as prose', async () => {
    const root = await render();
    const blocks = walk(root).filter((node) => node.tagName === 'pre');
    expect(blocks.length).toBeGreaterThan(0);
    // The snippet text sits on the nested <code>, which `walk` reaches.
    const code = blocks.flatMap((block) => walk(block).map((node) => node.textContent)).join('\n');
    expect(code).toContain('=    A    0.1');
  });

  it('renders nothing but its head when no document is supplied', async () => {
    const { TaskPanel } = await import('../../src/ui/panels/TaskPanel');
    const root = new TaskPanel(null).element as unknown as FakeElement;
    const body = walk(root).find((node) => node.className.includes('tool-body'));
    expect(body?.childNodes).toEqual([]);
  });
});
