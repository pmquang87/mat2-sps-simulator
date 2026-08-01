/**
 * The pump experiment's `SimProfile` — what the shell has to know about that plant, and
 * nothing more: no emergency stop, no start-track chooser, one camera rig, a static task
 * document instead of the graded exercise browser, its own watch layout, and a Parameters
 * tab the railway does not have.
 *
 * It lives in `ui/` (which may import every module's public API, §2 rule 4) rather than in
 * `pump/` (which imports `core/` only) — and separately from `pumpBootstrap.ts`, because
 * everything here is DOM-free and therefore testable in the node environment: the parameter
 * round trip "edit → plant clamps → persisted → restored" is a property of THIS file plus
 * the real `PumpPlant`, and `tests/ui/parametersPanel.test.ts` drives exactly that pair
 * (the plant-control strip likewise, from `tests/ui/controlPanelProfile.test.ts`).
 *
 * The types it produces (`SimProfile`, `ParameterSpec`, `WatchSectionSpec`, `PlantControlSpec`)
 * are imported type-only, so no CodeMirror reaches this module. Three.js does, because the
 * `pump` barrel re-exports the pump renderer (ARCHITECTURE.md §2 rule 7) — that costs the node
 * suites load time and nothing else: nothing here touches the DOM, a wall clock or a canvas.
 */
import { formatAddress } from '../core';
import type { KeyValueStore } from '../pedagogy';
import {
  PUMP_BUTTON_IDS,
  PUMP_PARAM_DEFAULTS,
  PUMP_PARAM_KEYS,
  PUMP_PARAM_RANGES,
  PUMP_PARAMS_STORAGE_KEY,
  PUMP_TASK,
  PUMP_VALVE_IDS,
  parsePumpParams,
  pumpInputAddresses,
  pumpOutputAddresses,
  serializePumpParams,
} from '../pump';
import type {
  PumpButtonId,
  PumpParamKey,
  PumpParams,
  PumpSnapshot,
  PumpToggleId,
  PumpValveId,
  PumpWiring,
} from '../pump';
import type { ProfileParameters, SimProfile } from './App';
import type { MsgKey } from './i18n/i18n';
import type { PlantControlSpec, PlantControlsSpec } from './panels/ControlPanel';
import type { ParameterSpec, ParameterValues } from './panels/ParametersPanel';
import type { WatchRowSpec, WatchSectionSpec } from './panels/WatchPanel';

/**
 * The slice of `PumpCoordinator` the parameter host needs. Structural on purpose: the host
 * must go through the coordinator (so a live change reaches the running plant), but nothing
 * here should be able to reach the rest of the simulation.
 */
export interface PumpParamPort {
  readonly params: PumpParams;
  setParams(patch: Partial<PumpParams>): PumpParams;
}

/**
 * How each model parameter is presented. The RANGES and defaults are the plant's
 * (`pump/params.ts`); this table adds only label, unit, slider granularity and the honest
 * statement of when a change takes effect.
 */
const PARAMETER_UI: Readonly<Record<PumpParamKey, {
  labelKey: MsgKey; unitKey: MsgKey; step: number; onReset: boolean;
}>> = {
  pumpRatePctS:    { labelKey: 'params.field.pumpRatePctS',    unitKey: 'params.unit.pctPerS', step: 0.5, onReset: false },
  refillRatePctS:  { labelKey: 'params.field.refillRatePctS',  unitKey: 'params.unit.pctPerS', step: 0.5, onReset: false },
  drainRatePctS:   { labelKey: 'params.field.drainRatePctS',   unitKey: 'params.unit.pctPerS', step: 0.5, onReset: false },
  llsThresholdPct: { labelKey: 'params.field.llsThresholdPct', unitKey: 'params.unit.pct',     step: 1,   onReset: false },
  hlsThresholdPct: { labelKey: 'params.field.hlsThresholdPct', unitKey: 'params.unit.pct',     step: 1,   onReset: false },
  dryRunDelayS:    { labelKey: 'params.field.dryRunDelayS',    unitKey: 'params.unit.s',       step: 0.5, onReset: false },
  initialVolAPct:  { labelKey: 'params.field.initialVolAPct',  unitKey: 'params.unit.pct',     step: 1,   onReset: true },
  initialVolBPct:  { labelKey: 'params.field.initialVolBPct',  unitKey: 'params.unit.pct',     step: 1,   onReset: true },
};

/** One control per plant parameter, in `PUMP_PARAM_KEYS` order. */
export function pumpParameterSpecs(): ParameterSpec[] {
  return PUMP_PARAM_KEYS.map((key): ParameterSpec => {
    const range = PUMP_PARAM_RANGES[key];
    const ui = PARAMETER_UI[key];
    return {
      key,
      labelKey: ui.labelKey,
      unitKey: ui.unitKey,
      min: range.min,
      max: range.max,
      step: ui.step,
      onReset: ui.onReset,
    };
  });
}

/** `PumpParams` as the panel's plain value bag (an interface carries no index signature). */
export function pumpParameterValues(params: PumpParams): ParameterValues {
  const out: Record<string, number> = {};
  for (const key of PUMP_PARAM_KEYS) out[key] = params[key];
  return out;
}

/**
 * The stored parameter patch, if any. Reading is total: a blocked store, a missing entry,
 * malformed JSON or a hand-edited nonsense value all yield "no patch", and the plant then
 * boots on its documented defaults. Whatever survives is still CLAMPED by the plant.
 */
export function readStoredPumpParams(store: KeyValueStore | null): Partial<PumpParams> {
  if (store === null) return {};
  try {
    return parsePumpParams(store.get(PUMP_PARAMS_STORAGE_KEY));
  } catch {
    return {};
  }
}

/**
 * How long a parameter write waits before it reaches the store. A slider drag produces one
 * `set()` per pointer sample, and each one would otherwise serialize and write the whole
 * parameter set; `localStorage.setItem` is synchronous, so that is dozens of blocking writes
 * per second on the drag itself. The plant still sees every value immediately — only the
 * PERSISTENCE is coalesced.
 */
const PERSIST_DEBOUNCE_MS = 500;

/**
 * The Parameters tab's host. Every edit goes through the plant, and what the PLANT reports
 * back is what gets displayed and persisted — so a stored value can never be one the model
 * would refuse on the next boot, and the panel can never show a value the plant rejected.
 *
 * The write is debounced (above). `flush()` forces the pending one out; the shell calls it
 * wherever the page is about to stop existing — teardown and the experiment switch's reload —
 * which is the same point at which the editor buffer is flushed.
 */
export function createPumpParameterHost(
  port: PumpParamPort | null,
  store: KeyValueStore | null,
): ProfileParameters {
  let pending: PumpParams | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (params: PumpParams): void => {
    if (store === null) return;
    try {
      store.set(PUMP_PARAMS_STORAGE_KEY, serializePumpParams(params));
    } catch {
      /* quota or private mode — the change still applies to the running plant */
    }
  };
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const params = pending;
    pending = null;
    write(params);
  };
  const persist = (params: PumpParams): void => {
    if (store === null) return;
    pending = params;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, PERSIST_DEBOUNCE_MS);
  };
  const apply = (patch: Partial<PumpParams>): ParameterValues => {
    if (port === null) return pumpParameterValues(PUMP_PARAM_DEFAULTS);
    let inForce = port.params;
    try {
      inForce = port.setParams(patch);
    } catch {
      inForce = port.params;             // a refused patch leaves the plant untouched
    }
    persist(inForce);
    return pumpParameterValues(inForce);
  };

  return {
    specs: pumpParameterSpecs(),
    values: () => pumpParameterValues(port?.params ?? PUMP_PARAM_DEFAULTS),
    set: (key, value) => apply({ [key]: value } as Partial<PumpParams>),
    resetDefaults: () => apply(PUMP_PARAM_DEFAULTS),
    flush,
  };
}

/**
 * Watch layout for the pump. The railway default lists reeds, switch coils and the
 * Fahrstrom word — none of which exist here — so the profile brings its own: every wired E
 * bit, the three A bits, the flag bytes the manual writes (its snippets use M 0.0), and the
 * student timer/counter range.
 */
export function pumpWatchSections(wiring: PumpWiring): WatchSectionSpec[] {
  const inputs = pumpInputAddresses(wiring)
    .map((address): WatchRowSpec => ({ kind: 'bit', address }));
  const outputs = pumpOutputAddresses(wiring)
    .map((address): WatchRowSpec => ({ kind: 'bit', address }));
  // M 0 … M 20, complete: the section is headed "M 0 – M 20", and a table that silently
  // skipped M 1 – M 9 would make a student's own flag look like it was never written.
  const flagBytes = Array.from({ length: 21 }, (_, byte) => byte);
  const timers = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  return [
    { titleKey: 'watch.section.pumpInputs', rows: inputs, open: true },
    { titleKey: 'watch.section.pumpOutputs', rows: outputs, open: true },
    {
      titleKey: 'watch.section.pumpFlags',
      rows: flagBytes.map((byte): WatchRowSpec => ({ kind: 'byteBits', area: 'M', byte })),
      open: true,
    },
    {
      titleKey: 'watch.section.timers',
      rows: timers.map((n): WatchRowSpec => ({ kind: 'timer', n })),
      open: true,
    },
    { titleKey: 'watch.section.counters', rows: [{ kind: 'counter', n: 1 }], open: true },
  ];
}

/**
 * The plant-input slice that BOTH the 3D pedestal and the DOM control strip drive.
 *
 * The first three members are exactly `PumpPointerCallbacks` (pump/scene/picking), so the
 * bootstrap can hand the very same object to the scene and to this profile — that is what
 * makes "one state, two ways to operate it" structural rather than a promise. `snapshot` is
 * the read-back: the strip renders what the PLANT reports, never its own click, so a switch
 * thrown in the 3D view shows up on the buttons.
 */
export interface PumpPlantPort {
  onButton(id: PumpButtonId, pressed: boolean): void;
  onToggle(id: PumpToggleId, value: boolean): void;
  onValve(id: PumpValveId, open: boolean): void;
  snapshot(): PumpSnapshot;
}

/** Localized name of each hand valve — they carry no PLC operand, so they have no plate text. */
const VALVE_LABEL_KEY: Readonly<Record<PumpValveId, MsgKey>> = {
  inA: 'plant.valve.inA',
  outB: 'plant.valve.outB',
};

/**
 * The pump's controls as keyboard-reachable DOM (§ Experiments): the two momentary pedestal
 * buttons, every pedestal toggle, and the two hand valves — in the order they sit on the
 * console.
 *
 * The 3D console is raycast pick targets only: no tab stop, no accessible name, nothing a
 * screen reader can announce. Without this strip the pump experiment cannot be operated at
 * all without a mouse, which would make the manual's own examples unreachable.
 *
 * Buttons and toggles are labelled with symbol and/or ADDRESS, not with a translated name:
 * that string is the operand the student types, and it is what the 3D name plate shows.
 * Returns `null` when there is no plant to drive.
 */
export function pumpPlantControls(
  port: PumpPlantPort | null,
  wiring: PumpWiring | null,
): PlantControlsSpec | null {
  if (port === null || wiring === null) return null;
  const controls: PlantControlSpec[] = [];

  for (const id of PUMP_BUTTON_IDS) {
    const address = wiring.buttonInput.get(id);
    if (address === undefined) continue;
    controls.push({
      key: `button:${id}`,
      kind: 'momentary',
      label: `${id} (${formatAddress(address)})`,
      labelKey: null,
      set: (pressed) => port.onButton(id, pressed),
      read: () => port.snapshot().buttons[id],
    });
  }

  // Address order, i.e. the order the toggles sit on the console (pump/scene/pedestal).
  for (const [id, address] of wiring.toggleInput) {
    controls.push({
      key: `toggle:${id}`,
      kind: 'latching',
      label: formatAddress(address),
      labelKey: null,
      set: (value) => port.onToggle(id, value),
      read: () => port.snapshot().toggles[id],
    });
  }

  for (const id of PUMP_VALVE_IDS) {
    controls.push({
      key: `valve:${id}`,
      kind: 'latching',
      label: null,
      labelKey: VALVE_LABEL_KEY[id],
      set: (open) => port.onValve(id, open),
      read: () => port.snapshot().valves[id],
    });
  }

  return { legendKey: 'plant.title', noteKey: 'plant.note', controls };
}

export interface PumpProfileConfig {
  /** `null` when the stack failed to build — the watch table then falls back to the shell's. */
  wiring: PumpWiring | null;
  parameters: ProfileParameters;
  /** The plant-input callbacks the 3D scene also gets; `null` when there is no stack. */
  plant?: PumpPlantPort | null;
}

export function buildPumpProfile(cfg: PumpProfileConfig): SimProfile {
  return {
    experiment: 'pump',
    subtitleKey: 'app.subtitlePump',
    showNotaus: false,          // the pump plant has no emergency stop
    showStartTrack: false,      // …and no station tracks to seat a loco on
    cameraModes: ['orbit'],     // one damped orbit rig (pump/scene/orbit.ts)
    showDerailedChip: false,
    inputsNoteKey: 'inputs.notePump',
    plantControls: pumpPlantControls(cfg.plant ?? null, cfg.wiring),
    tools: ['exercises', 'examples', 'parameters'],
    taskDoc: PUMP_TASK,
    parameters: cfg.parameters,
    watchSections: cfg.wiring === null ? null : pumpWatchSections(cfg.wiring),
  };
}
