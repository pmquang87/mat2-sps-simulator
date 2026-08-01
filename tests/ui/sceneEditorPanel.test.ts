/**
 * SceneEditorPanel (docs/DESIGN_SCENE_EDITOR.md §14.3) against the fakeDom stub — the real
 * panel, not a model beside it. Downloads are an injected spy, so the tests assert the
 * EXACT payloads (patched trackplan JSON, expectation note). Controls: buttons disabled
 * before a selection / before a flip, the toggle un-flips, unknown picks clear, and the
 * fixed `(xW)`-style switch cannot be flipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrackplanFile } from '../../src/plant';
import type { OracleSwitchIndexFile } from '../../src/ui/sceneEditor';
import { setLocale } from '../../src/ui/i18n/i18n';
import { installFakeDocument, walk, type FakeElement } from './support/fakeDom';
import { straightPlan } from '../scene/fixture';

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
  setLocale('en');
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

const EMPTY_INDEX: OracleSwitchIndexFile = { version: 1, generatedFrom: 'test', switches: {} };

interface Harness {
  root: FakeElement;
  downloads: { filename: string; text: string }[];
  highlights: (string | null)[];
  panel: {
    selectSwitch(id: string | null): void;
    dispose(): void;
  };
  buttonByText(text: string): FakeElement;
  texts(): string[];
}

async function build(plan?: TrackplanFile): Promise<Harness> {
  const { SceneEditorPanel } = await import('../../src/ui/panels/SceneEditorPanel');
  const downloads: { filename: string; text: string }[] = [];
  const highlights: (string | null)[] = [];
  const panel = new SceneEditorPanel({
    trackplan: plan ?? straightPlan(),
    oracleIndex: EMPTY_INDEX,
    download: (filename, text) => downloads.push({ filename, text }),
    onSelectionHighlight: (id) => highlights.push(id),
  });
  const root = panel.element as unknown as FakeElement;
  return {
    root,
    downloads,
    highlights,
    panel,
    buttonByText(text: string): FakeElement {
      const button = walk(root).find((n) => n.tagName === 'button' && n.textContent === text);
      if (button === undefined) throw new Error(`no button labelled ${text}`);
      return button;
    },
    texts(): string[] {
      return walk(root).map((n) => n.textContent).filter((s) => s !== '');
    },
  };
}

function click(node: FakeElement): void {
  node.dispatchEvent({ type: 'click' });
}

describe('SceneEditorPanel (§14.3)', () => {
  it('starts with no selection and everything disabled (control state)', async () => {
    const h = await build();
    expect(h.texts()).toContain('No switch selected.');
    expect(h.buttonByText('Flip G/R mapping').disabled).toBe(true);
    expect(h.buttonByText('Download patched trackplan.json').disabled).toBe(true);
    expect(h.buttonByText('Download expectation note').disabled).toBe(true);
  });

  it('selecting a switch shows its draft mapping; flipping toggles it', async () => {
    const h = await build();
    h.panel.selectSwitch('xW01TEST');
    expect(h.highlights).toEqual(['xW01TEST']);
    expect(h.texts()).toContain('xW01TEST');
    expect(h.texts()).toContain('G → e2, R → e3');            // {G:0,R:1} over [e2,e3]

    const flip = h.buttonByText('Flip G/R mapping');
    expect(flip.disabled).toBe(false);
    click(flip);
    expect(h.texts()).toContain('G → e3, R → e2');            // the DRAFT mapping is shown
    expect(h.texts()).toContain('Flipped: xW01TEST');
    expect(h.buttonByText('Download patched trackplan.json').disabled).toBe(false);

    // The flip is a toggle: a second click restores the un-flipped state (control).
    click(flip);
    expect(h.texts()).toContain('G → e2, R → e3');
    expect(h.texts()).toContain('No flips yet.');
    expect(h.buttonByText('Download patched trackplan.json').disabled).toBe(true);
  });

  it('downloads the patched plan and the note with the recorded flip', async () => {
    const h = await build();
    h.panel.selectSwitch('xW01TEST');
    click(h.buttonByText('Flip G/R mapping'));
    click(h.buttonByText('Download patched trackplan.json'));
    click(h.buttonByText('Download expectation note'));

    expect(h.downloads.map((d) => d.filename)).toEqual(['trackplan.json', 'trackplan-flip-note.md']);
    const patched = JSON.parse(h.downloads[0]?.text ?? '') as TrackplanFile;
    const flipped = patched.switches.find((s) => s.id === 'xW01TEST');
    expect(flipped?.coilToBranch).toEqual({ G: 1, R: 0 });
    // Control: the other fixture switch is untouched in the payload.
    expect(patched.switches.find((s) => s.id === 'xW02TEST')).toEqual(
      straightPlan().switches.find((s) => s.id === 'xW02TEST'),
    );
    const note = h.downloads[1]?.text ?? '';
    expect(note).toContain('## xW01TEST');
    expect(note).toContain('ORACLE-INVISIBLE');               // empty index → unreferenced
  });

  it('cannot flip the fixed switch, clears on unknown picks and on null', async () => {
    const h = await build();
    h.panel.selectSwitch('xW02TEST');                          // coilToBranch: null
    expect(h.texts()).toContain('This switch has no coils (fixed) — nothing to flip.');
    expect(h.buttonByText('Flip G/R mapping').disabled).toBe(true);

    h.panel.selectSwitch('xW99NOPE');                          // unknown → cleared
    expect(h.texts()).toContain('No switch selected.');
    h.panel.selectSwitch('xW01TEST');
    h.panel.selectSwitch(null);                                // empty-scenery click
    expect(h.texts()).toContain('No switch selected.');
    expect(h.highlights).toEqual(['xW02TEST', null, 'xW01TEST', null]);
  });
});
