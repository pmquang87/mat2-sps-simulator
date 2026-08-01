/**
 * The `SimProfile` drives the shipped `ControlPanel` (§ Experiments).
 *
 * The claim under test is two-sided, and both sides are asserted here because either alone
 * can pass vacuously: the PUMP shell must not carry an emergency-stop button, a start-track
 * chooser or a camera selector — and the RAILWAY shell must still carry all three. A test
 * that only checked the pump would also pass if the profile removed those controls from
 * every experiment.
 *
 * Built against `tests/ui/support/fakeDom.ts` (jsdom is not a dependency here) with the
 * REAL panel and the real profile constants, so a profile field that stops being honoured
 * fails here rather than in the browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import { startTrackOptions } from '../../src/scene';
import { createPumpStack } from '../../src/pump';
import type { PumpStack } from '../../src/pump';
import { RAILWAY_PROFILE } from '../../src/ui/App';
import type { SimProfile } from '../../src/ui/App';
import { de } from '../../src/ui/i18n/de';
import { en } from '../../src/ui/i18n/en';
import { setLocale } from '../../src/ui/i18n/i18n';
import type { ControlPanel } from '../../src/ui/panels/ControlPanel';
import { buildPumpProfile, createPumpParameterHost } from '../../src/ui/pumpProfile';
import { installFakeDocument, walk, type FakeElement } from './support/fakeDom';

const plan = trackplanJson as unknown as TrackplanFile;
const startTracks = startTrackOptions(plan);

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

/** A pump profile over a REAL stack, plus the stack itself so a test can read the plant. */
function pumpSetup(): { profile: SimProfile; stack: PumpStack } {
  const stack = createPumpStack();
  const store = new Map<string, string>();
  const profile = buildPumpProfile({
    wiring: stack.wiring,
    parameters: createPumpParameterHost(stack.coordinator, {
      get: (key) => store.get(key) ?? null,
      set: (key, value) => {
        store.set(key, value);
      },
      remove: (key) => {
        store.delete(key);
      },
    }),
    // Exactly what the bootstrap hands the 3D console as its pick callbacks.
    plant: {
      onButton: (id, pressed) => stack.coordinator.setButton(id, pressed),
      onToggle: (id, value) => stack.coordinator.setToggle(id, value),
      onValve: (id, open) => stack.coordinator.setValve(id, open),
      snapshot: () => stack.coordinator.snapshot(),
    },
  });
  return { profile, stack };
}

function pumpProfile(): SimProfile {
  return pumpSetup().profile;
}

/** Build the shipped ControlPanel the way `App` does, for a given profile. */
async function build(profile: SimProfile): Promise<{ panel: ControlPanel; root: FakeElement }> {
  const module = await import('../../src/ui/panels/ControlPanel');
  const panel = new module.ControlPanel({
    onRun: () => undefined,
    onStop: () => undefined,
    onReset: () => undefined,
    onScanIntervalChange: () => undefined,
    onTimeScaleChange: () => undefined,
    onNotausChange: () => undefined,
    onCameraModeChange: () => undefined,
    startTracks,
    onStartTrackChange: () => undefined,
    onLabelsChange: () => undefined,
    onForceInput: () => true,
    onResetLayout: () => undefined,
    showNotaus: profile.showNotaus,
    showStartTrack: profile.showStartTrack,
    cameraModes: profile.cameraModes,
    inputsNoteKey: profile.inputsNoteKey,
    plantControls: profile.plantControls,
  });
  return { panel, root: panel.element as unknown as FakeElement };
}

/** Just the element, for the assertions that do not drive the panel. */
async function buildRoot(profile: SimProfile): Promise<FakeElement> {
  return (await build(profile)).root;
}

function has(root: FakeElement, className: string): boolean {
  return walk(root).some((node) => node.className.includes(className));
}

/** The plant-control button with this key; throws rather than returning undefined. */
function control(root: FakeElement, key: string): FakeElement {
  const found = walk(root).find((node) => node.getAttribute('data-control') === key);
  if (found === undefined) throw new Error(`ControlPanel has no plant control "${key}"`);
  return found;
}

/** Text of every button in the tree — the camera selector's labels live here. */
function buttonTexts(root: FakeElement): string[] {
  return walk(root)
    .filter((node) => node.tagName === 'button')
    .map((node) => node.textContent);
}

describe('ControlPanel under the RAILWAY profile (unchanged)', () => {
  it('keeps the Notaus button, the start-track chooser and all four cameras', async () => {
    const root = await buildRoot(RAILWAY_PROFILE);
    expect(has(root, 'btn-notaus')).toBe(true);
    expect(has(root, 'field-start-track')).toBe(true);
    const texts = buttonTexts(root);
    for (const camera of ['Orbit', 'Bird', 'Cab', 'Trackside']) {
      expect(texts, camera).toContain(camera);
    }
  });

  it('is what a host without a profile gets', () => {
    expect(RAILWAY_PROFILE.experiment).toBe('railway');
    expect(RAILWAY_PROFILE.showNotaus).toBe(true);
    expect(RAILWAY_PROFILE.showStartTrack).toBe(true);
    expect(RAILWAY_PROFILE.showDerailedChip).toBe(true);
    expect(RAILWAY_PROFILE.tools).toEqual(['exercises', 'hints', 'examples']);
    expect(RAILWAY_PROFILE.taskDoc).toBeNull();
    expect(RAILWAY_PROFILE.parameters).toBeNull();
    expect(RAILWAY_PROFILE.watchSections).toBeNull();
  });
});

describe('ControlPanel under the PUMP profile', () => {
  it('has no Notaus button, no start-track chooser and no camera selector', async () => {
    const root = await buildRoot(pumpProfile());
    expect(has(root, 'btn-notaus')).toBe(false);
    expect(has(root, 'field-start-track')).toBe(false);
    const texts = buttonTexts(root);
    for (const camera of ['Orbit', 'Bird', 'Cab', 'Trackside']) {
      expect(texts, camera).not.toContain(camera);
    }
  });

  it('still has the controls both plants share', async () => {
    const root = await buildRoot(pumpProfile());
    const texts = buttonTexts(root);
    expect(texts).toContain('Run');
    expect(texts).toContain('Stop');
    expect(texts).toContain('Reset');
    expect(has(root, 'control-inputs')).toBe(true);      // "Try it" input forcing
  });

  /**
   * The 3D console is raycast pick targets only — no tab stop, no accessible name — so
   * without this strip the pump cannot be operated without a mouse at all. Every assertion
   * below runs against the REAL panel over the REAL plant, so "the button drives the plant"
   * is a measurement, not a wiring diagram.
   */
  it('offers a labelled DOM control for every button, toggle and hand valve', async () => {
    const { root } = await build(pumpProfile());
    const controls = walk(root)
      .filter((node) => node.getAttribute('data-control') !== null);
    expect(controls.map((node) => node.getAttribute('data-control'))).toEqual([
      'button:S1', 'button:S0',
      'toggle:E0.7', 'toggle:E1.0', 'toggle:E1.1', 'toggle:E1.2',
      'toggle:E1.3', 'toggle:E1.4', 'toggle:E1.7',
      'valve:inA', 'valve:outB',
    ]);
    for (const node of controls) {
      expect(node.tagName, node.getAttribute('data-control') ?? '').toBe('button');
      expect(node.textContent.trim(), node.getAttribute('data-control') ?? '').not.toBe('');
      expect(node.title.trim(), node.getAttribute('data-control') ?? '').not.toBe('');
    }
    // The operand the student types is what the button is called (as on the 3D name plate).
    expect(control(root, 'button:S1').textContent).toBe('S1 (E 0.0)');
    expect(control(root, 'toggle:E0.7').textContent).toBe('E 0.7');
    expect(control(root, 'valve:inA').textContent).toBe(en['plant.valve.inA']);
  });

  it('the railway shell carries no such strip', async () => {
    const root = await buildRoot(RAILWAY_PROFILE);
    expect(walk(root).some((node) => node.getAttribute('data-control') !== null)).toBe(false);
    expect(has(root, 'control-plant')).toBe(false);
    expect(RAILWAY_PROFILE.plantControls).toBeNull();
  });

  it('S1 is MOMENTARY: down presses the plant button, up releases it', async () => {
    const { profile, stack } = pumpSetup();
    const { root } = await build(profile);
    const s1 = control(root, 'button:S1');

    s1.dispatchEvent({ type: 'pointerdown' });
    expect(stack.coordinator.snapshot().buttons.S1).toBe(true);
    s1.dispatchEvent({ type: 'pointerup' });
    expect(stack.coordinator.snapshot().buttons.S1).toBe(false);

    // …and from the keyboard, which is the whole point of the strip.
    s1.dispatchEvent({ type: 'keydown', key: ' ' });
    expect(stack.coordinator.snapshot().buttons.S1).toBe(true);
    s1.dispatchEvent({ type: 'keydown', key: ' ' });     // auto-repeat must not re-press
    expect(stack.coordinator.snapshot().buttons.S1).toBe(true);
    s1.dispatchEvent({ type: 'keyup', key: ' ' });
    expect(stack.coordinator.snapshot().buttons.S1).toBe(false);

    // Losing focus while held must not leave the plant with a stuck button.
    s1.dispatchEvent({ type: 'pointerdown' });
    s1.dispatchEvent({ type: 'blur' });
    expect(stack.coordinator.snapshot().buttons.S1).toBe(false);
    // A momentary control is not a latch, so it carries no aria-pressed.
    expect(s1.getAttribute('aria-pressed')).toBeNull();
  });

  it('the toggles and valves latch, and report aria-pressed from the PLANT', async () => {
    const { profile, stack } = pumpSetup();
    const { panel, root } = await build(profile);
    const toggle = control(root, 'toggle:E0.7');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.dispatchEvent({ type: 'click' });
    expect(stack.coordinator.snapshot().toggles['E0.7']).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.dispatchEvent({ type: 'click' });
    expect(stack.coordinator.snapshot().toggles['E0.7']).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    const valve = control(root, 'valve:outB');
    valve.dispatchEvent({ type: 'click' });
    expect(stack.coordinator.snapshot().valves.outB).toBe(true);

    // One state, two operating surfaces: a switch thrown "in the 3D view" (i.e. through the
    // same coordinator call the pick callbacks make) lights the strip up on the next refresh.
    stack.coordinator.setToggle('E1.4', true);
    panel.refreshPlantControls();
    expect(control(root, 'toggle:E1.4').getAttribute('aria-pressed')).toBe('true');
    expect(control(root, 'toggle:E1.4').className).toContain('is-active');
  });

  it('is localized in both languages', async () => {
    setLocale('de');
    const { root } = await build(pumpProfile());
    expect(control(root, 'valve:inA').textContent).toBe(de['plant.valve.inA']);
    expect(control(root, 'toggle:E1.0').title).toBe(
      de['plant.toggleTitle'].replace('{name}', 'E 1.0'),
    );
    setLocale('en');
  });

  it('carries its own note under the "Try it" toggles (the railway text names reeds)', async () => {
    const railwayNote = walk(await buildRoot(RAILWAY_PROFILE))
      .find((node) => node.className.includes('inputs-note'))?.textContent ?? '';
    const pumpNote = walk(await buildRoot(pumpProfile()))
      .find((node) => node.className.includes('inputs-note'))?.textContent ?? '';
    expect(railwayNote).toContain('reed');
    expect(pumpNote).not.toBe('');
    expect(pumpNote).not.toBe(railwayNote);
    expect(pumpNote).not.toContain('reed');
  });
});
