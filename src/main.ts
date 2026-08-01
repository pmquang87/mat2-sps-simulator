/**
 * Entry point (ARCHITECTURE.md §3): load the data JSONs, construct the SimCoordinator,
 * SceneManager and UI shell, then start the RafDriver.
 *
 * The bootstrap is fault-tolerant by design. `src/data/*.json` is owned by the data agent
 * and the pure modules are built in parallel, so every construction step is probed and any
 * failure is surfaced in the UI (banner + status chip) instead of leaving a blank page. The
 * probe is a real effect check, not a claim: the coordinator must survive one physics step
 * before the render loop is started.
 *
 * Since the second experiment landed this file also ROUTES: the persisted
 * `mat2sps.experiment` selects either `bootstrapRailway` below — unchanged, only wrapped in
 * a function — or the pump bootstrap in `./pumpBootstrap`. Anything unrecognised is the
 * railway (`readStoredExperiment`), so a corrupted storage value can never leave the student
 * without an app.
 */
import {
  EventBus,
  RafDriver,
  SimClock,
  SimCoordinator,
  buildWiring,
  forcibleProgramInputs,
} from './app';
import type { Wiring } from './app';
import { Emulator, SymbolTable } from './core';
import type { BitAddress, Diagnostic, VariablesFile } from './core';
import {
  BehaviorChecker,
  ProgressStore,
  loadExamplesForExperiment,
  loadExercises,
  runTimeoutMsOf,
  starterExample,
  summarizeResults,
  exampleAsEditorSource,
} from './pedagogy';
import type { ExampleSpec, ExerciseSpec, KeyValueStore, NetworkSpec } from './pedagogy';
import { Plant, startForExercise, trackplanForExercise } from './plant';
import type { TrackplanFile, TrainStartSpec } from './plant';
import { SceneManager, startSpecForTrack, startTrackOf, startTrackOptions } from './scene';
import type { CameraMode, StartTrackOption, StartTrackRef } from './scene';
import { bootstrapPump } from './pumpBootstrap';
import {
  App,
  SceneEditorPanel,
  getLocale,
  initLocale,
  readEditorFlag,
  readStoredExperiment,
  t,
  triggerDownload,
} from './ui';
import type {
  CheckRunReport,
  OracleSwitchIndexFile,
  PedagogyHost,
  ProgramLoadOutcome,
  SeatedTrack,
  SimHost,
  SimStatus,
  WatchReader,
} from './ui';

/** Static JSON data (§7). A glob keeps the bootstrap compiling while `src/data/` is still
 *  being generated — a missing file becomes a labelled UI state, not a build error. */
const dataFiles: Record<string, unknown> =
  import.meta.glob('./data/*.json', { eager: true, import: 'default' });

function dataFile(name: string): unknown {
  return dataFiles[`./data/${name}`];
}

/** Run `fn`, returning `fallback` if it throws (reads from not-yet-built modules). */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Fire-and-forget variant of `safe` for void calls. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    /* the UI reports availability separately; a failed command must not kill the frame */
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wrap a bootstrap/runtime failure as a Diagnostic so it can use the existing message list. */
function runtimeDiagnostic(message: string): Diagnostic {
  return {
    code: 'R-RUN-000',
    severity: 'error',
    line: 1,
    col: 1,
    message: { de: message, en: message },
  };
}

/**
 * W-SWI-001 (§5.1.5): coil commands that went to a switch this board model does not have
 * (trackplan `unplacedSwitches`, §7.1). The coordinator records the structured fact once per
 * coil per program run; the localized text is built HERE because UI strings belong to the
 * i18n layer (§5.6) — app/ stays free of message catalogs. Both message languages carry the
 * active locale's text (as for `runtimeDiagnostic`); a locale switch re-renders the list.
 */
function unplacedCoilDiagnostics(coordinator: SimCoordinator): Diagnostic[] {
  return coordinator.unplacedCoilCommands.map((command) => {
    const text = t('runtime.unplacedSwitch',
                   { switchId: command.switchId, coil: command.coil });
    const hint = t('runtime.unplacedSwitchHint');
    return {
      code: 'W-SWI-001',
      severity: 'warning',
      line: 1,
      col: 1,
      message: { de: text, en: text },
      hint: { de: hint, en: hint },
    };
  });
}

interface SimStack {
  symbols: SymbolTable;
  emulator: Emulator;
  plant: Plant;
  wiring: Wiring;
  bus: EventBus;
  clock: SimClock;
  coordinator: SimCoordinator;
  trackplan: TrackplanFile;
}

interface BuildOutcome {
  stack: SimStack | null;
  failure: { kind: 'data' | 'error'; message: string } | null;
}

function buildSimStack(variables: VariablesFile, trackplan: TrackplanFile): SimStack {
  const symbols = SymbolTable.fromVariables(variables);
  const emulator = new Emulator(symbols);
  const plant = new Plant({ trackplan, seed: 1 });
  const wiring = buildWiring(symbols, trackplan);
  const bus = new EventBus();
  const clock = new SimClock();
  const coordinator = new SimCoordinator(emulator, plant, wiring, bus,
                                         { scanIntervalMs: 50, seed: 1 });
  // Effect check (see file header): one real step must work before the loop is started.
  coordinator.advanceSteps(1);
  coordinator.reset();
  clock.reset();
  return { symbols, emulator, plant, wiring, bus, clock, coordinator, trackplan };
}

function build(): BuildOutcome {
  const variables = dataFile('variables.json') as VariablesFile | undefined;
  const trackplan = dataFile('trackplan.json') as TrackplanFile | undefined;
  if (variables === undefined || trackplan === undefined) {
    return { stack: null, failure: { kind: 'data', message: '' } };
  }
  try {
    return { stack: buildSimStack(variables, trackplan), failure: null };
  } catch (error) {
    return { stack: null, failure: { kind: 'error', message: errorText(error) } };
  }
}

/** Symbol name (lower-cased) → the plant object the 3D view can glow (§5.4). Reeds are
 *  keyed by their own id; a switch is reachable through its base name and through either
 *  coil symbol (`…G` / `…R`), which is how the Variablenliste spells them. Lower-casing is
 *  deliberate: this index only resolves a hover target, so the case traps (XW03CR,
 *  XW05BH1G3R) must not make an object unreachable — the case-SENSITIVE lookup that the
 *  student's program is graded on stays in core's SymbolTable. */
type HighlightTarget = { kind: 'reed' | 'switch'; id: string };

function buildHighlightIndex(wiring: Wiring): Map<string, HighlightTarget> {
  const index = new Map<string, HighlightTarget>();
  for (const reedId of wiring.reedInput.keys()) {
    index.set(reedId.toLowerCase(), { kind: 'reed', id: reedId });
  }
  for (const switchId of wiring.switchCoils.keys()) {
    const target: HighlightTarget = { kind: 'switch', id: switchId };
    const base = switchId.toLowerCase();
    index.set(base, target);
    index.set(`${base}g`, target);
    index.set(`${base}r`, target);
  }
  return index;
}

/** localStorage-backed KeyValueStore for pedagogy's ProgressStore (§5.5: ui supplies the
 *  browser implementations); in-memory fallback when storage is blocked (private mode). */
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

interface LoadedData<T> { value: T | null; reason: string; }

/**
 * Which exercise the untouched §7.1 `start` belongs to. Gruppe A has no `exerciseStarts`
 * entry precisely because the default start IS its seat (Bahnhof 1 Gleis 1) — asserted in
 * tests/plant/exerciseStart.test.ts — so before the first selection the start-track chooser
 * truthfully reports Gruppe A as the seat's provenance.
 */
const DEFAULT_START_EXERCISE_ID = 'gruppeA';

function loadData<T>(name: string, parse: (json: unknown) => T): LoadedData<T> {
  const raw = dataFile(name);
  if (raw === undefined) return { value: null, reason: t('status.dataMissing') };
  try {
    return { value: parse(raw), reason: '' };
  } catch (error) {
    return { value: null, reason: errorText(error) };
  }
}

function bootstrapRailway(parent: HTMLElement): void {
  const { stack, failure } = build();

  let scene: SceneManager | null = null;
  let sceneFailure: string | null = null;
  let cameraMode: CameraMode = 'orbit';
  /** Last size handed to `SceneManager.resize`, so the render loop can notice a layout
   *  change the ResizeObserver never reported. `ResizeObserver` callbacks are part of the
   *  rendering steps, so a resize that happens while the document is not rendered (hidden
   *  tab, minimized window) is dropped: the drawing buffer then keeps the stale size and
   *  the scene stays stretched after the tab is shown again. Re-checking the canvas' CSS
   *  size once per frame is two layout reads and makes the viewport self-correcting. */
  let appliedViewport = { width: 0, height: 0 };
  let timeScale = 1;
  let running = false;
  let programLoaded = false;
  let instructionCount = 0;
  /** Last source that parsed OK — check runs replay it in a fresh emulator (§10.1). */
  let lastGoodSource: string | null = null;
  /** Exercise the live plant is currently seated for (§7.1 `exerciseStarts`, D13); null
   *  until the student opens a network, i.e. the plant sits on the §7.1 default start. Also
   *  cleared by a direct track choice, so re-opening that exercise re-seats the loco. */
  let seatedExerciseId: string | null = null;
  /** Still on the untouched §7.1 `start` — which IS the Gruppe A seat, so the chooser may
   *  truthfully report `DEFAULT_START_EXERCISE_ID` as its provenance until something moves. */
  let seatIsDefault = true;
  /** Station track the loco stands on; `null` when the seat is not on a derived lane. */
  let seatedTrack: StartTrackRef | null =
    stack === null ? null : safe(() => startTrackOf(stack.trackplan, stack.trackplan.start), null);
  const startTracks: readonly StartTrackOption[] =
    stack === null ? [] : safe(() => startTrackOptions(stack.trackplan), []);

  /**
   * Move the live plant onto `start` and put the shell's clock back to zero — the one path
   * both re-seat routes take (opening an exercise network, §7.1 `exerciseStarts`; choosing a
   * station track, §10.1). `Plant.setStart` validates first, so a rejected spec leaves the
   * loco AND the reported seat untouched, and the caller reports "nothing moved".
   */
  function reseat(start: TrainStartSpec): boolean {
    if (stack === null) return false;
    let seated = false;
    attempt(() => {
      stack.plant.setStart(start);          // validates, then re-inits the plant
      seated = true;
    });
    if (!seated) return false;
    seatedTrack = safe(() => startTrackOf(stack.trackplan, start), null);
    seatIsDefault = false;
    attempt(() => stack.coordinator.reset());
    stack.clock.reset();
    stack.clock.timeScale = running ? timeScale : 0;
    return true;
  }

  /**
   * The seat the start-track chooser renders. The exercise id is carried only while the seat
   * really came from an exercise: the untouched §7.1 start IS the Gruppe A seat (asserted in
   * tests/plant/exerciseStart.test.ts), a direct track choice has no exercise behind it.
   */
  function seatedTrackStatus(): SeatedTrack | null {
    if (seatedTrack === null) return null;
    const exerciseId = seatedExerciseId ?? (seatIsDefault ? DEFAULT_START_EXERCISE_ID : null);
    return exerciseId === null
      ? { ...seatedTrack }
      : { ...seatedTrack, exerciseId };
  }

  // ── pedagogy data + progress (§10.1–§10.3) ─────────────────────────────────
  const exercisesData = loadData<ExerciseSpec[]>('exercises.json', loadExercises);
  // Filtered for THIS experiment (§13.5): an example tagged `pump` addresses hardware the
  // railway does not have, so offering it here would hand the student a snippet that cannot
  // compile against this symbol table. The pump bootstrap filters the same way.
  const examplesData = loadData<ExampleSpec[]>(
    'examples.json',
    (json) => loadExamplesForExperiment(json, 'railway'),
  );
  const progress = new ProgressStore(browserKeyValueStore(), () => Date.now());

  /** First-run editor buffer (§7.4): the example flagged `starter` — deliberately built from
   *  student-area operands so the very first "Load into PLC" is warning-free. Falls back to
   *  the first entry if no example carries the flag. */
  const editorDefaultSource: string | null = (() => {
    const examples = examplesData.value;
    if (examples === null) return null;
    const seed = starterExample(examples) ?? examples[0];
    if (seed === undefined) return null;
    return exampleAsEditorSource(seed, getLocale() === 'de' ? 'de' : 'en');
  })();

  /** §10.1 "Run checks": a deterministic headless replay on a FRESH emulator+plant pair
   *  (seed 1, scan 50 ms, the exercise's bounceEnabled), so the live 3D scene stays
   *  untouched and Gruppe A's reed bounce is active regardless of the live plant config. */
  function runChecks(networkId: string): CheckRunReport | null {
    if (stack === null || exercisesData.value === null) return null;
    let location: { exercise: ExerciseSpec; network: NetworkSpec } | null = null;
    for (const exercise of exercisesData.value) {
      const network = exercise.networks.find((n) => n.id === networkId);
      if (network !== undefined) {
        location = { exercise, network };
        break;
      }
    }
    if (location === null) return null;
    if (lastGoodSource === null) {
      return { status: 'noProgram', results: [], summary: null, simTimeMs: 0 };
    }
    try {
      const emulator = new Emulator(stack.symbols);
      const load = emulator.load(lastGoodSource);
      if (!load.ok) {
        return { status: 'noProgram', results: [], summary: null, simTimeMs: 0 };
      }
      const plant = new Plant({
        trackplan: trackplanForExercise(stack.trackplan, location.exercise.id),
        seed: 1,
        bounceEnabled: location.exercise.bounceEnabled,
      });
      const bus = new EventBus();
      const checker = new BehaviorChecker(location.network.checks);
      bus.on((e) => checker.onEvent(e));
      const coordinator = new SimCoordinator(emulator, plant, stack.wiring, bus,
                                             { scanIntervalMs: 50, seed: 1 });
      coordinator.loadScenario(location.network.scenario ?? []);
      const timeoutMs = runTimeoutMsOf(location.network);
      coordinator.advanceSteps(Math.ceil(timeoutMs / 10));
      const results = checker.finalize(timeoutMs);
      const summary = summarizeResults(results);
      if (summary.allPassed) progress.recordPassedRun(networkId);
      else progress.recordFailedRun(networkId);
      return { status: 'ok', results, summary, simTimeMs: timeoutMs };
    } catch (error) {
      return {
        status: 'error',
        message: errorText(error),
        results: [],
        summary: null,
        simTimeMs: 0,
      };
    }
  }

  const pedagogyHost: PedagogyHost = {
    get exercises() {
      return exercisesData.value;
    },
    get exercisesUnavailableReason() {
      return exercisesData.reason;
    },
    get examples() {
      return examplesData.value;
    },
    get examplesUnavailableReason() {
      return examplesData.reason;
    },
    progress,
    runChecks,
    editorDefaultSource,
  };

  const highlightIndex: Map<string, HighlightTarget> =
    stack === null ? new Map() : buildHighlightIndex(stack.wiring);

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
    get available(): boolean {
      return stack !== null;
    },
    get unavailableReason(): string {
      if (failure === null) return '';
      return failure.kind === 'data' ? t('status.dataMissing') : failure.message;
    },
    get sceneAvailable(): boolean {
      return scene !== null;
    },
    get sceneUnavailableReason(): string {
      if (sceneFailure !== null) return sceneFailure;
      return host.unavailableReason;
    },
    get symbols(): SymbolTable | null {
      return stack?.symbols ?? null;
    },
    get wiring(): Wiring | null {
      return stack?.wiring ?? null;
    },
    pedagogy: pedagogyHost,
    startTracks,

    loadProgram(source: string): ProgramLoadOutcome {
      if (stack === null) {
        return { ok: false, diagnostics: [], instructionCount: 0, forcibleInputs: [] };
      }
      try {
        const result = stack.emulator.load(source);
        programLoaded = result.ok;
        if (result.ok) lastGoodSource = source;
        instructionCount = result.program?.instructions.length ?? 0;
        // A new program run warns again about coils of switches the board lacks (§7.1).
        attempt(() => stack.coordinator.clearUnplacedCoilCommands());
        const forcibleInputs: readonly BitAddress[] = result.program === undefined
          ? []
          : forcibleProgramInputs(stack.wiring, result.program);
        return {
          ok: result.ok,
          diagnostics: result.diagnostics,
          instructionCount,
          forcibleInputs,
        };
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
      if (stack !== null) stack.clock.timeScale = next ? timeScale : 0;
    },

    reset(): void {
      if (stack === null) return;
      attempt(() => stack.coordinator.reset());
      stack.clock.reset();
      stack.clock.timeScale = running ? timeScale : 0;
    },

    /**
     * Seat the LIVE plant for the exercise the student has open (§7.1 `exerciseStarts`).
     * Gruppe A stands on Bahnhof 1 Gleis 1, Gruppe B on Gleis 4 — before D13 only the
     * headless check runs honoured that, so the visible loco always waited on Gleis 1 and
     * a Gruppe B program's first trigger ("xR03BH1G4") never came under the magnet.
     *
     * Returns whether the loco actually moved, so the shell resets its controls only when
     * there was an effect — re-selecting a network of the same exercise leaves a running
     * simulation alone.
     */
    setExercise(exerciseId: string): boolean {
      if (stack === null || exerciseId === seatedExerciseId) return false;
      const start = startForExercise(stack.trackplan, exerciseId);
      if (!reseat(start)) return false;     // rejected spec: loco stayed where it was
      seatedExerciseId = exerciseId;
      return true;
    },

    /**
     * Seat the loco in the middle of a chosen station track (§10.1 start-track chooser). This
     * is NOT an exercise start: the §7.1 `exerciseStarts` offsets stay pinned for the graded
     * check runs, and choosing a track drops the exercise provenance so re-opening that
     * network re-seats the loco on its own start again.
     */
    setStartTrack(ref: StartTrackRef): boolean {
      if (stack === null) return false;
      const start = safe(() => startSpecForTrack(stack.trackplan, ref), null);
      if (start === null) return false;     // not a track of this board
      if (!reseat(start)) return false;
      seatedExerciseId = null;
      return true;
    },

    setScanInterval(ms: number): void {
      if (stack === null) return;
      attempt(() => stack.coordinator.setScanInterval(ms));
    },

    setTimeScale(scale: number): void {
      timeScale = scale;
      if (stack !== null && running) stack.clock.timeScale = scale;
    },

    setNotaus(active: boolean): void {
      if (stack === null) return;
      attempt(() => stack.plant.setNotaus(active));
    },

    /** "Try it" input forcing (§10.3) — the coordinator owns the force mask, so a forced bit
     *  survives the per-scan PAE write instead of fighting it. */
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

    setCameraMode(mode: CameraMode): void {
      cameraMode = mode;
      const target = scene;
      if (target !== null) attempt(() => target.setCameraMode(mode));
    },

    setLabelsVisible(visible: boolean): void {
      const target = scene;
      if (target !== null) attempt(() => target.setLabelsVisible(visible));
    },

    highlightSymbol(name: string | null): void {
      const target = scene;
      if (target === null) return;
      const hit = name === null ? undefined : highlightIndex.get(name.toLowerCase());
      attempt(() => {
        // Exactly one object glows at a time: clear the kind that is not the hit.
        target.highlight('reed', hit?.kind === 'reed' ? hit.id : null);
        target.highlight('switch', hit?.kind === 'switch' ? hit.id : null);
      });
    },

    resizeViewport(width: number, height: number): void {
      const target = scene;
      if (target === null) return;
      appliedViewport = { width, height };
      attempt(() => target.resize(width, height));
    },

    status(): SimStatus {
      if (stack === null) throw new Error('simulation unavailable');
      const snapshot = safe(() => stack.coordinator.snapshot(), null);
      return {
        running,
        simTimeMs: safe(() => stack.coordinator.simTimeMs, 0),
        cycle: safe(() => stack.emulator.cycleCount, 0),
        scanIntervalMs: safe(() => stack.coordinator.scanInterval, 50),
        notausActive: snapshot?.notausActive ?? false,
        derailed: snapshot?.derailed ?? false,
        seatedTrack: seatedTrackStatus(),
        programLoaded,
        instructionCount,
        runtimeDiagnostics: safe(() => [
          ...(stack.coordinator.lastScan?.diagnostics ?? []),
          ...unplacedCoilDiagnostics(stack.coordinator),
        ], []),
      };
    },

    reader(): WatchReader | null {
      return watchReader;
    },
  };

  const app = new App({ parent, host });

  // ── scene + render loop ────────────────────────────────────────────────────
  if (stack !== null) {
    const size = app.viewportSize();
    try {
      scene = new SceneManager({ canvas: app.canvas, trackplan: stack.trackplan });
      scene.resize(size.width, size.height);
      scene.setCameraMode(cameraMode);
      scene.render();
    } catch (error) {
      scene = null;
      sceneFailure = errorText(error);
    }

    const driver = new RafDriver(stack.clock, stack.coordinator, (alphaMs) => {
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
        target.update(stack.coordinator.snapshot(), alphaMs);
        target.render();
      } catch (error) {
        // Disable the scene after the first failure instead of throwing every frame.
        scene = null;
        sceneFailure = errorText(error);
        app.refresh();
      }
    });
    host.setRunning(false);          // start paused: timeScale 0, but the loop keeps rendering
    driver.start();

    // ── scene editor (owner tool, ?editor=1 — docs/DESIGN_SCENE_EDITOR.md) ────────────
    // Mounted here, not in App: with the flag off this whole block is dead and the shipped
    // shell is untouched. Needs a live scene (picking) and the trackplan (the draft).
    if (scene !== null && readEditorFlag(globalThis.location?.search ?? '')) {
      const editorScene = scene;
      const editorPanel = new SceneEditorPanel({
        trackplan: stack.trackplan,
        oracleIndex: dataFile('oracleSwitchIndex.json') as OracleSwitchIndexFile,
        download: triggerDownload,
        onSelectionHighlight: (id) => attempt(() => editorScene.highlight('switch', id)),
      });
      app.canvas.parentElement?.appendChild(editorPanel.element);

      // Click = pointerdown/up pair that barely moved; a real orbit drag must NOT pick
      // (OrbitControls shares this canvas).
      let downAt: { x: number; y: number } | null = null;
      app.canvas.addEventListener('pointerdown', (ev) => {
        downAt = { x: ev.clientX, y: ev.clientY };
      });
      app.canvas.addEventListener('pointerup', (ev) => {
        const start = downAt;
        downAt = null;
        if (start === null) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (dx * dx + dy * dy > 25) return;               // > 5 px: an orbit drag
        const rect = app.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const ndc = {
          x: ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          y: -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
        };
        editorPanel.selectSwitch(safe(() => editorScene.pickSwitchAt(ndc), null));
      });
    }
  }

  app.refresh();
}

/** Route to the experiment the student last chose (default: the railway). */
function bootstrap(): void {
  initLocale();
  const parent = document.getElementById('app');
  if (parent === null) throw new Error('#app mount point missing from index.html');
  if (readStoredExperiment() === 'pump') bootstrapPump(parent);
  else bootstrapRailway(parent);
}

bootstrap();
