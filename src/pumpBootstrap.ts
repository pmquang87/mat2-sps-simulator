/**
 * Pump-experiment bootstrap — the second entry path `main.ts` routes to.
 *
 * Same job as the railway bootstrap: assemble the stack, implement the shell's `SimHost`
 * over it, construct the `App`, start the `RafDriver`. It is a SEPARATE function (and file)
 * rather than a generalisation of the railway one for the same reason `PumpCoordinator` is
 * a parallel loop: the railway is delivered and pinned by tests and by the solution oracle,
 * so the pump must not be able to move it.
 *
 * What differs from the railway is declared once, in the `SimProfile` that
 * `ui/pumpProfile.ts` builds: no emergency stop, no start-track chooser, one camera, no
 * graded exercise browser (the Anleitung's teaching example is not marked), plus a
 * Parameters tab the railway does not have. The shell reads that profile; it does not know
 * what a pump is. This file only owns what needs a browser — storage, the scene, the render
 * loop — which is why the profile lives next door and stays testable headlessly.
 *
 * A second bootstrap file at `src/` root introduces no module boundary — it is `main.ts`'s
 * second half, split out so the railway bootstrap stays readable and its diff stays a move.
 * ARCHITECTURE.md §3 lists it.
 */
import { RafDriver, SimClock } from './app';
import type { BitAddress, Diagnostic } from './core';
import {
  ProgressStore,
  exampleAsEditorSource,
  findExample,
  loadExamplesForExperiment,
} from './pedagogy';
import type { ExampleSpec, KeyValueStore } from './pedagogy';
import { PumpScene, createPumpStack, forciblePumpProgramInputs } from './pump';
import type { PumpButtonId, PumpStack, PumpToggleId, PumpValveId } from './pump';
import {
  App,
  buildPumpProfile,
  createPumpParameterHost,
  getLocale,
  readStoredPumpParams,
  t,
} from './ui';
import type {
  PedagogyHost,
  ProgramLoadOutcome,
  SimHost,
  SimStatus,
  WatchReader,
} from './ui';

const examplesJson: unknown =
  (import.meta.glob('./data/examples.json', { eager: true, import: 'default' }))['./data/examples.json'];

/** First-run editor buffer for this experiment: the manual's own first pump program. */
const PUMP_STARTER_EXAMPLE_ID = 'pump-sr';

const SCAN_INTERVAL_MS = 50;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeDiagnostic(message: string): Diagnostic {
  return {
    code: 'R-RUN-000',
    severity: 'error',
    line: 1,
    col: 1,
    message: { de: message, en: message },
  };
}

/** Run `fn`, returning `fallback` if it throws. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    /* the UI reports availability separately; a failed command must not kill the frame */
  }
}

// ── storage ──────────────────────────────────────────────────────────────────

/** localStorage-backed store; an in-memory map when storage is blocked (private mode). */
function browserKeyValueStore(): KeyValueStore {
  try {
    const probeKey = 'mat2sps.storage.probe';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
      remove: (key) => localStorage.removeItem(key),
    };
  } catch {
    const map = new Map<string, string>();
    return {
      get: (key) => map.get(key) ?? null,
      set: (key, value) => map.set(key, value),
      remove: (key) => map.delete(key),
    };
  }
}

// ── bootstrap ────────────────────────────────────────────────────────────────

export function bootstrapPump(parent: HTMLElement): void {
  const store = browserKeyValueStore();
  // A hand-edited or truncated stored value must cost a setting, never the boot: the reader
  // drops unusable fields and the plant clamps whatever survives.
  const storedParams = readStoredPumpParams(store);

  let stack: PumpStack | null = null;
  let buildFailure = '';
  try {
    stack = createPumpStack({ params: storedParams, scanIntervalMs: SCAN_INTERVAL_MS });
    // Effect check, as in the railway bootstrap: one real step before the loop is started.
    stack.coordinator.advanceSteps(1);
    stack.coordinator.reset();
  } catch (error) {
    stack = null;
    buildFailure = errorText(error);
  }

  const clock = new SimClock();
  let scene: PumpScene | null = null;
  let sceneFailure: string | null = null;
  let appliedViewport = { width: 0, height: 0 };
  let timeScale = 1;
  let running = false;
  let programLoaded = false;
  let instructionCount = 0;

  // ── examples library, filtered to this experiment ──────────────────────────
  let examples: ExampleSpec[] | null = null;
  let examplesReason = '';
  try {
    examples = loadExamplesForExperiment(examplesJson, 'pump');
  } catch (error) {
    examples = null;
    examplesReason = examplesJson === undefined ? t('status.dataMissing') : errorText(error);
  }

  const editorDefaultSource: string | null = (() => {
    if (examples === null) return null;
    const seed = findExample(examples, PUMP_STARTER_EXAMPLE_ID) ?? examples[0];
    if (seed === undefined || seed === null) return null;
    return exampleAsEditorSource(seed, getLocale() === 'de' ? 'de' : 'en');
  })();

  const pedagogyHost: PedagogyHost = {
    // No graded networks here: the Exercises tab renders PUMP_TASK instead (see the profile).
    exercises: null,
    exercisesUnavailableReason: '',
    get examples() {
      return examples;
    },
    get examplesUnavailableReason() {
      return examplesReason;
    },
    progress: new ProgressStore(store, () => Date.now()),
    runChecks: () => null,
    editorDefaultSource,
  };

  const parameters = createPumpParameterHost(
    stack === null ? null : stack.coordinator,
    store,
  );

  /**
   * The plant-input callbacks. ONE object, handed both to the 3D console (as its pick
   * callbacks) and to the profile (as the DOM control strip's port), so the two operating
   * surfaces cannot drift apart: every press, switch and valve goes through the same
   * coordinator call, and both render the resulting snapshot.
   */
  const live = stack;
  const plantInput = live === null ? null : {
    onButton: (id: PumpButtonId, pressed: boolean) =>
      attempt(() => live.coordinator.setButton(id, pressed)),
    onToggle: (id: PumpToggleId, value: boolean) =>
      attempt(() => live.coordinator.setToggle(id, value)),
    onValve: (id: PumpValveId, open: boolean) =>
      attempt(() => live.coordinator.setValve(id, open)),
    snapshot: () => live.coordinator.snapshot(),
  };

  const profile = buildPumpProfile({
    wiring: stack === null ? null : stack.wiring,
    parameters,
    plant: plantInput,
  });

  const watchReader: WatchReader | null = stack === null ? null : {
    bit: (address) => stack.emulator.memory.getBit(address),
    word: (address) => stack.emulator.memory.getWord(address),
    byte: (area, byte) => {
      const memory = stack.emulator.memory;
      const bank = area === 'E' ? memory.inputs : area === 'A' ? memory.outputs : memory.flags;
      return bank[byte] ?? 0;
    },
    timer: (n) => stack.emulator.getTimer(n),
    counter: (n) => stack.emulator.getCounter(n),
  };

  const host: SimHost = {
    profile,

    get available(): boolean {
      return stack !== null;
    },
    get unavailableReason(): string {
      return buildFailure;
    },
    get sceneAvailable(): boolean {
      return scene !== null;
    },
    get sceneUnavailableReason(): string {
      if (sceneFailure !== null) return sceneFailure;
      return host.unavailableReason;
    },
    get symbols() {
      return stack?.symbols ?? null;
    },
    /** The railway's `Wiring`; the pump has its own shape, and the profile supplies the
     *  watch layout directly, so nothing in the shell needs it. */
    wiring: null,
    pedagogy: pedagogyHost,
    startTracks: [],

    loadProgram(source: string): ProgramLoadOutcome {
      if (stack === null) {
        return { ok: false, diagnostics: [], instructionCount: 0, forcibleInputs: [] };
      }
      try {
        const result = stack.emulator.load(source);
        programLoaded = result.ok;
        instructionCount = result.program?.instructions.length ?? 0;
        const forcibleInputs: readonly BitAddress[] = result.program === undefined
          ? []
          : forciblePumpProgramInputs(result.program);
        return { ok: result.ok, diagnostics: result.diagnostics, instructionCount, forcibleInputs };
      } catch (error) {
        programLoaded = false;
        instructionCount = 0;
        return {
          ok: false,
          diagnostics: [runtimeDiagnostic(errorText(error))],
          instructionCount: 0,
          forcibleInputs: [],
        };
      }
    },

    setRunning(next: boolean): void {
      running = next;
      clock.timeScale = next ? timeScale : 0;
    },

    reset(): void {
      if (stack === null) return;
      attempt(() => stack.coordinator.reset());
      clock.reset();
      clock.timeScale = running ? timeScale : 0;
    },

    /** No graded exercises on this experiment — nothing to seat, nothing moves. */
    setExercise: () => false,
    setStartTrack: () => false,

    setScanInterval(ms: number): void {
      if (stack === null) return;
      attempt(() => stack.coordinator.setScanInterval(ms));
    },

    setTimeScale(scale: number): void {
      timeScale = scale;
      if (running) clock.timeScale = scale;
    },

    /** The pump plant has no emergency stop; the profile hides the button that calls this. */
    setNotaus: () => undefined,

    forceInputBit(address: BitAddress, value: boolean): boolean {
      if (stack === null) return false;
      let applied = false;
      attempt(() => {
        applied = stack.coordinator.forceInputBit(address, value);
      });
      return applied;
    },

    clearForcedInputs(): void {
      if (stack === null) return;
      attempt(() => stack.coordinator.clearForcedInputs());
    },

    /** One camera rig: the selector is hidden, and a stray call is simply not a change. */
    setCameraMode: () => undefined,

    setLabelsVisible(visible: boolean): void {
      const target = scene;
      if (target !== null) attempt(() => target.setLabelsVisible(visible));
    },

    /** No per-symbol glow on this plant: every signal already carries its own name plate
     *  in the 3D view, so there is nothing a hover could reveal that is not already shown. */
    highlightSymbol: () => undefined,

    resizeViewport(width: number, height: number): void {
      const target = scene;
      if (target === null) return;
      appliedViewport = { width, height };
      attempt(() => target.resize(width, height));
    },

    status(): SimStatus {
      if (stack === null) throw new Error('simulation unavailable');
      return {
        running,
        simTimeMs: safe(() => stack.coordinator.simTimeMs, 0),
        cycle: safe(() => stack.emulator.cycleCount, 0),
        scanIntervalMs: safe(() => stack.coordinator.scanInterval, SCAN_INTERVAL_MS),
        notausActive: false,
        derailed: false,
        seatedTrack: null,
        programLoaded,
        instructionCount,
        runtimeDiagnostics: safe(() => stack.coordinator.lastScan?.diagnostics ?? [], []),
      };
    },

    reader(): WatchReader | null {
      return watchReader;
    },
  };

  const app = new App({ parent, host });

  // ── scene + render loop ────────────────────────────────────────────────────
  if (live !== null && plantInput !== null) {
    const size = app.viewportSize();
    try {
      scene = new PumpScene({
        canvas: app.canvas,
        // The scene reports INTENT; the plant only changes because the host applies it here,
        // and the visual follows on the next `update` (pump/scene contract). Same object the
        // DOM control strip drives, so the console and the strip are one state.
        callbacks: plantInput,
      });
      scene.resize(size.width, size.height);
      scene.render();
    } catch (error) {
      scene = null;
      sceneFailure = errorText(error);
    }

    const driver = new RafDriver(clock, live.coordinator, (alphaMs) => {
      const target = scene;
      if (target === null) return;
      try {
        const width = app.canvas.clientWidth;
        const height = app.canvas.clientHeight;
        if (width > 0 && height > 0
            && (width !== appliedViewport.width || height !== appliedViewport.height)) {
          appliedViewport = { width, height };
          target.resize(width, height);
        }
        target.update(live.coordinator.snapshot(), alphaMs);
        target.render();
      } catch (error) {
        scene = null;
        sceneFailure = errorText(error);
        app.refresh();
      }
    });
    host.setRunning(false);          // start paused: timeScale 0, but the loop keeps rendering
    driver.start();
  }

  app.refresh();
}
