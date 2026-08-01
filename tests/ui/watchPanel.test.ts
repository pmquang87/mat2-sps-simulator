/**
 * WatchPanel row filter (ARCHITECTURE.md §10.4).
 *
 * Two halves, one contract: `applyFilter` marks non-matching rows with the `hidden`
 * attribute, and the stylesheet must make that attribute actually remove the row from
 * layout. The second half is not decorative: `.watch-row` is `display: grid`, and a class
 * rule beats the UA sheet's `[hidden] { display: none }` — shipped without a counter-rule
 * the filter looked wired but changed nothing on screen. Found 2026-08-01 in the live pump
 * plant: typing "Schalter" left S1/LLS_TankA/… visible, only section-level hiding (via
 * `<details hidden>`, which no class rule overrides) ever worked.
 *
 * fakeDom cannot compute styles (and jsdom is deliberately not a dependency, see
 * tests/ui/layout.test.ts), so the stylesheet must carry an explicit
 * `.watch-row[hidden] { display: none }` counter-rule and this suite pins BOTH halves:
 * the attribute logic against the shipped panel, the counter-rule as text. The live
 * effect (computed `display: none` in Chrome) was measured once by hand when the rule
 * was introduced; if either half regresses, one of these tests fails.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/ui/i18n/i18n';
import { installFakeDocument, walk, type FakeElement } from './support/fakeDom';
import type { WatchSectionSpec } from '../../src/ui/panels/WatchPanel';

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
  setLocale('en');
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

const LAYOUT: WatchSectionSpec[] = [
  {
    titleKey: 'watch.section.inputs',
    open: true,
    rows: [
      { kind: 'bit', address: { kind: 'bit', area: 'E', byte: 0, bit: 0 }, name: 'S1' },
      { kind: 'bit', address: { kind: 'bit', area: 'E', byte: 1, bit: 0 }, name: 'Schalter1' },
    ],
  },
  // A section with no match must disappear entirely (its <details> hides).
  { titleKey: 'watch.section.timers', open: true, rows: [{ kind: 'timer', n: 10 }] },
];

interface Harness {
  root: FakeElement;
  filter: FakeElement;
  rowByName(name: string): FakeElement;
  sections(): FakeElement[];
}

async function build(): Promise<Harness> {
  const { WatchPanel } = await import('../../src/ui/panels/WatchPanel');
  const panel = new WatchPanel();
  panel.setLayout(LAYOUT, null);
  const root = panel.element as unknown as FakeElement;
  const filter = walk(root).find((n) => n.tagName === 'input');
  if (filter === undefined) throw new Error('WatchPanel lost its filter input');
  return {
    root,
    filter,
    rowByName(name: string): FakeElement {
      const row = walk(root).find(
        (n) =>
          n.className.split(/\s+/).includes('watch-row') &&
          n.childNodes[0]?.textContent === name,
      );
      if (row === undefined) throw new Error(`no watch-row named ${name}`);
      return row;
    },
    sections(): FakeElement[] {
      return walk(root).filter((n) => n.tagName === 'details');
    },
  };
}

function type(filter: FakeElement, text: string): void {
  filter.value = text;
  filter.dispatchEvent({ type: 'input' });
}

describe('WatchPanel filter — attribute half', () => {
  it('hides non-matching rows and whole sections without a match', async () => {
    const h = await build();

    // Control: before any filter every row and section is visible — the later
    // assertions can only fail because filtering changed something.
    expect(h.rowByName('S1').hidden).toBe(false);
    expect(h.rowByName('Schalter1').hidden).toBe(false);
    expect(h.sections().map((s) => s.hidden)).toEqual([false, false]);

    type(h.filter, 'Schalter');
    expect(h.rowByName('Schalter1').hidden).toBe(false);
    expect(h.rowByName('S1').hidden).toBe(true);
    // the timer section has no match: it hides as a whole
    expect(h.sections().map((s) => s.hidden)).toEqual([false, true]);

    // Clearing restores everything (round-trip control).
    type(h.filter, '');
    expect(h.rowByName('S1').hidden).toBe(false);
    expect(h.rowByName('Schalter1').hidden).toBe(false);
    expect(h.sections().map((s) => s.hidden)).toEqual([false, false]);
  });

  it('matches case-insensitively and by address text', async () => {
    const h = await build();

    type(h.filter, 'SCHALTER');
    expect(h.rowByName('Schalter1').hidden).toBe(false);
    expect(h.rowByName('S1').hidden).toBe(true);

    // "E 0.0" is S1's address; the name no longer matches but the address does.
    type(h.filter, 'e 0.0');
    expect(h.rowByName('S1').hidden).toBe(false);
    expect(h.rowByName('Schalter1').hidden).toBe(true);
  });
});

describe('WatchPanel filter — stylesheet half', () => {
  it('styles.css carries the [hidden] counter-rule that .watch-row{display:grid} needs', () => {
    const css = readFileSync(new URL('../../src/ui/styles.css', import.meta.url), 'utf8');
    // Without this rule the attribute half is invisible: `.watch-row { display: grid }`
    // outweighs the UA sheet's `[hidden] { display: none }` (attribute selectors add no
    // specificity advantage — both are 0-1-0, and the author sheet wins).
    expect(css).toMatch(/\.watch-row\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});
