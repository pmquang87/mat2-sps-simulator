/**
 * The Parameters tab, end to end: shipped `ParametersPanel` → shipped parameter host
 * (`ui/pumpProfile.ts`) → REAL `PumpCoordinator` + `PumpPlant` → a key-value store.
 *
 * No doubles in the chain, because the property under test spans all of it: a student types
 * a value, the plant clamps it, the CONTROLS show what the plant accepted (never the
 * keystroke), the accepted value is persisted, and the next boot restores it. A panel test
 * against a fake host could pass while the plant refused every value.
 *
 * The corrupted-storage case closes the loop the other way: a hand-edited entry must cost a
 * setting, not the boot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../../src/pedagogy';
import {
  PUMP_PARAM_DEFAULTS,
  PUMP_PARAM_KEYS,
  PUMP_PARAM_RANGES,
  PUMP_PARAMS_STORAGE_KEY,
  createPumpStack,
} from '../../src/pump';
import { de } from '../../src/ui/i18n/de';
import { en } from '../../src/ui/i18n/en';
import { setLocale } from '../../src/ui/i18n/i18n';
import {
  createPumpParameterHost,
  pumpParameterSpecs,
  readStoredPumpParams,
} from '../../src/ui/pumpProfile';
import { installFakeDocument, walk, type FakeElement } from './support/fakeDom';

let uninstall: (() => void) | null = null;

beforeAll(() => {
  uninstall = installFakeDocument();
});

afterAll(() => {
  uninstall?.();
  setLocale('en');
});

beforeEach(() => {
  setLocale('en');
});

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

interface Harness {
  root: FakeElement;
  stack: ReturnType<typeof createPumpStack>;
  store: ReturnType<typeof memoryStore>;
  /** Slider + number input of one parameter, in document order. */
  inputs(key: string): { slider: FakeElement; number: FakeElement };
  /** What a student does: type into the number field and let it fire `change`. */
  type(key: string, text: string): void;
  drag(key: string, text: string): void;
  resetButton(): FakeElement;
  /** Persistence is debounced (`PERSIST_DEBOUNCE_MS`); the shell flushes it on teardown and
   *  before the experiment switch's reload, and so does every storage assertion here. */
  flush(): void;
  /** The events the plant has queued but not yet published. */
  pendingEvents(): unknown[];
}

async function build(seed: Record<string, string> = {}): Promise<Harness> {
  const { ParametersPanel } = await import('../../src/ui/panels/ParametersPanel');
  const store = memoryStore(seed);
  const stack = createPumpStack({ params: readStoredPumpParams(store) });
  const host = createPumpParameterHost(stack.coordinator, store);
  const panel = new ParametersPanel({
    onChange: (key, value) => host.set(key, value),
    onResetDefaults: () => host.resetDefaults(),
  });
  panel.setParameters(host.specs, host.values());
  const root = panel.element as unknown as FakeElement;

  const inputs = (key: string): { slider: FakeElement; number: FakeElement } => {
    const found = walk(root).filter((node) => node.tagName === 'input'
      && (node.getAttribute('id') === `param-${key}`
        || node.getAttribute('aria-label')?.startsWith(labelOf(key)) === true));
    const slider = found.find((node) => node.getAttribute('type') === 'range');
    const number = found.find((node) => node.getAttribute('type') === 'number');
    if (slider === undefined || number === undefined) {
      throw new Error(`ParametersPanel has no slider+number pair for "${key}"`);
    }
    return { slider, number };
  };

  return {
    root,
    stack,
    store,
    inputs,
    type: (key, text) => {
      const { number } = inputs(key);
      number.value = text;
      number.dispatchEvent({ type: 'change' });
    },
    drag: (key, text) => {
      const { slider } = inputs(key);
      slider.value = text;
      slider.dispatchEvent({ type: 'input' });
    },
    resetButton: () => {
      const button = walk(root).find((node) => node.tagName === 'button'
        && node.textContent === en['params.reset']);
      if (button === undefined) throw new Error('ParametersPanel has no reset button');
      return button;
    },
    flush: () => host.flush(),
    pendingEvents: () => stack.plant.drainEvents(),
  };
}

function labelOf(key: string): string {
  const spec = pumpParameterSpecs().find((s) => s.key === key);
  if (spec === undefined) throw new Error(`no spec for ${key}`);
  return en[spec.labelKey];
}

describe('parameter specs', () => {
  it('offers one control per plant parameter, inside the plant’s own range', () => {
    const specs = pumpParameterSpecs();
    expect(specs.map((s) => s.key)).toEqual([...PUMP_PARAM_KEYS]);
    for (const spec of specs) {
      const range = PUMP_PARAM_RANGES[spec.key as keyof typeof PUMP_PARAM_RANGES];
      expect(spec.min, spec.key).toBe(range.min);
      expect(spec.max, spec.key).toBe(range.max);
      expect(spec.step, spec.key).toBeGreaterThan(0);
      expect(en[spec.labelKey], spec.key).toBeTruthy();
      expect(de[spec.labelKey], spec.key).toBeTruthy();
    }
  });

  it('marks exactly the two initial levels as "applies on reset"', () => {
    const onReset = pumpParameterSpecs().filter((s) => s.onReset).map((s) => s.key);
    expect(onReset).toEqual(['initialVolAPct', 'initialVolBPct']);
  });
});

describe('ParametersPanel round trip', () => {
  it('an edit reaches the plant, the controls follow, the value is persisted', async () => {
    const h = await build();
    expect(h.stack.coordinator.params.pumpRatePctS).toBe(PUMP_PARAM_DEFAULTS.pumpRatePctS);

    h.type('pumpRatePctS', '12');
    expect(h.stack.coordinator.params.pumpRatePctS).toBe(12);
    expect(h.inputs('pumpRatePctS').number.value).toBe('12');
    expect(h.inputs('pumpRatePctS').slider.value).toBe('12');
    h.flush();
    expect(readStoredPumpParams(h.store).pumpRatePctS).toBe(12);
    expect(h.store.map.has(PUMP_PARAMS_STORAGE_KEY)).toBe(true);
  });

  it('the slider drives the same path', async () => {
    const h = await build();
    h.drag('drainRatePctS', '15');
    expect(h.stack.coordinator.params.drainRatePctS).toBe(15);
    expect(h.inputs('drainRatePctS').number.value).toBe('15');
  });

  /** The binding rule: the controls show what the PLANT accepted, never the keystroke. */
  it('an out-of-range entry is clamped and the clamped value is displayed AND stored', async () => {
    const h = await build();
    h.type('pumpRatePctS', '9999');
    expect(h.stack.coordinator.params.pumpRatePctS).toBe(PUMP_PARAM_RANGES.pumpRatePctS.max);
    expect(h.inputs('pumpRatePctS').number.value).toBe(String(PUMP_PARAM_RANGES.pumpRatePctS.max));
    h.flush();
    expect(readStoredPumpParams(h.store).pumpRatePctS)
      .toBe(PUMP_PARAM_RANGES.pumpRatePctS.max);

    h.type('llsThresholdPct', '-40');
    expect(h.stack.coordinator.params.llsThresholdPct)
      .toBe(PUMP_PARAM_RANGES.llsThresholdPct.min);
  });

  it('a cleared field redisplays the value in force instead of sending NaN', async () => {
    const h = await build();
    h.type('dryRunDelayS', '5');
    h.type('dryRunDelayS', '');
    expect(h.stack.coordinator.params.dryRunDelayS).toBe(5);
    expect(h.inputs('dryRunDelayS').number.value).toBe('5');
  });

  it('a stored value is restored on the next boot', async () => {
    const first = await build();
    first.type('refillRatePctS', '3');
    first.flush();
    const seed = Object.fromEntries(first.store.map);

    const second = await build(seed);
    expect(second.stack.coordinator.params.refillRatePctS).toBe(3);
    expect(second.inputs('refillRatePctS').number.value).toBe('3');
  });

  it('a corrupted stored payload falls back to the defaults without throwing', async () => {
    const h = await build({ [PUMP_PARAMS_STORAGE_KEY]: '{"pumpRatePctS": ' });
    expect(h.stack.coordinator.params).toEqual(PUMP_PARAM_DEFAULTS);
    expect(h.inputs('pumpRatePctS').number.value)
      .toBe(String(PUMP_PARAM_DEFAULTS.pumpRatePctS));
  });

  it('"reset to defaults" puts every parameter back and persists that', async () => {
    const h = await build();
    h.type('pumpRatePctS', '18');
    h.type('hlsThresholdPct', '85');
    h.resetButton().dispatchEvent({ type: 'click' });
    expect(h.stack.coordinator.params).toEqual(PUMP_PARAM_DEFAULTS);
    expect(h.inputs('hlsThresholdPct').number.value)
      .toBe(String(PUMP_PARAM_DEFAULTS.hlsThresholdPct));
    h.flush();
    expect(readStoredPumpParams(h.store)).toEqual({ ...PUMP_PARAM_DEFAULTS });
  });

  /** A moved threshold must flip the level bit at the level the probe now sits at. */
  it('a threshold change is visible in the snapshot the scene draws', async () => {
    const h = await build();
    expect(h.stack.coordinator.snapshot().params.llsThresholdPct)
      .toBe(PUMP_PARAM_DEFAULTS.llsThresholdPct);
    h.type('llsThresholdPct', '15');
    const snapshot = h.stack.coordinator.snapshot();
    expect(snapshot.params.llsThresholdPct).toBe(15);
    // Tank B starts empty, so raising the "empty" trip level keeps its bit set; tank A is
    // full, so its bit must stay clear — the bits follow the probe, not the click.
    expect(snapshot.sensors.llsB).toBe(true);
    expect(snapshot.sensors.llsA).toBe(false);
  });

  /**
   * A slider drag produces one `set()` per pointer sample. Nothing downstream may see one
   * entry per sample: `paramsChanged` means "the probes moved, re-place them", and
   * `localStorage.setItem` is a synchronous write of the whole parameter set.
   */
  it('100 set() calls with the value already in force queue no plant events at all', async () => {
    const h = await build();
    h.pendingEvents();                      // start from an empty queue
    const inForce = h.stack.coordinator.params.pumpRatePctS;
    for (let i = 0; i < 100; i++) h.type('pumpRatePctS', String(inForce));
    expect(h.stack.coordinator.params.pumpRatePctS).toBe(inForce);
    expect(h.pendingEvents()).toEqual([]);
  });

  it('CONTROL: a value that really changes still publishes exactly one paramsChanged', async () => {
    const h = await build();
    h.pendingEvents();
    h.type('pumpRatePctS', '7');
    expect(h.pendingEvents()).toEqual([{ t: 0, type: 'paramsChanged' }]);
  });

  it('a drag reaches the store once, on flush — not once per pointer sample', async () => {
    const h = await build();
    for (const value of ['5', '6', '7', '8', '9']) h.drag('pumpRatePctS', value);
    expect(h.stack.coordinator.params.pumpRatePctS).toBe(9);        // the plant is live …
    expect(h.store.map.has(PUMP_PARAMS_STORAGE_KEY)).toBe(false);   // … the write is not
    h.flush();
    expect(readStoredPumpParams(h.store).pumpRatePctS).toBe(9);
  });

  it('every control is labelled in both languages (keyboard + screen reader)', async () => {
    const h = await build();
    for (const spec of pumpParameterSpecs()) {
      const { slider, number } = h.inputs(spec.key);
      expect(slider.getAttribute('aria-label'), spec.key).toContain(en[spec.labelKey]);
      expect(number.getAttribute('aria-label'), spec.key).toContain(en[spec.labelKey]);
      expect(number.getAttribute('id'), spec.key).toBe(`param-${spec.key}`);
      expect(slider.getAttribute('min'), spec.key).toBe(String(spec.min));
      expect(slider.getAttribute('max'), spec.key).toBe(String(spec.max));
    }
    const labelFor = walk(h.root).filter((node) => node.tagName === 'label')
      .map((node) => node.getAttribute('for'));
    for (const spec of pumpParameterSpecs()) {
      expect(labelFor, spec.key).toContain(`param-${spec.key}`);
    }
  });
});
