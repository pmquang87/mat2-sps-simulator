/**
 * App shell (ARCHITECTURE.md §3): the layout — 3D viewport, AWL editor, message list,
 * watch table, control bar — plus the top-right EN/DE language toggle.
 *
 * The shell owns no simulation state. Everything it drives goes through the injected
 * `SimHost`, which `main.ts` implements over app/ (SimCoordinator, SimClock, RafDriver) and
 * scene/. That keeps the UI usable — and honest about what is missing — while sibling
 * modules are still being built: a host that reports `available: false` yields a fully
 * rendered, clearly labelled shell instead of a blank page.
 */
import type { BitAddress, Diagnostic, NormalizedSource, SymbolTable } from '../core';
import { mapDiagnostics, normalizeSource } from '../core';
import type { Wiring } from '../app';
import type { ExampleSpec, ExerciseSpec, ProgressStore } from '../pedagogy';
import type { CameraMode, StartTrackOption } from '../scene';
import { append, clear, el } from './dom';
import { EditorPanel } from './editor/EditorPanel';
import {
  EXPERIMENT_IDS, editorStorageKeyFor, switchExperiment, writeStoredExperiment,
} from './experiment';
import type { ExperimentId } from './experiment';
import { formatNumber, getLocale, onLocaleChange, setLocale, t } from './i18n/i18n';
import type { Locale, MsgKey } from './i18n/i18n';
import { LayoutController } from './layout/LayoutController';
import { ControlPanel, DEFAULT_CAMERA_MODES } from './panels/ControlPanel';
import type { PlantControlsSpec } from './panels/ControlPanel';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';
import { ExamplesPanel } from './panels/ExamplesPanel';
import { ExercisePanel } from './panels/ExercisePanel';
import type { CheckRunReport } from './panels/ExercisePanel';
import { HintPanel } from './panels/HintPanel';
import { ParametersPanel } from './panels/ParametersPanel';
import type { ParameterSpec, ParameterValues } from './panels/ParametersPanel';
import { TaskPanel } from './panels/TaskPanel';
import type { TaskDoc } from './panels/TaskPanel';
import { WatchPanel, buildDefaultWatchSections } from './panels/WatchPanel';
import type { WatchReader, WatchSectionSpec } from './panels/WatchPanel';
import { mapRuntimeDiagnostics, templateNoticeDiagnostics } from './templateNotice';

/** UI refresh rate for the status line and the watch table (independent of the render loop). */
const REFRESH_INTERVAL_MS = 100;

export interface ProgramLoadOutcome {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  instructionCount: number;
  /** Input bits of the loaded program the "Try it" toggles may force (§10.3); [] on error. */
  forcibleInputs: readonly BitAddress[];
}

/**
 * Which station track the loco stands on (§10.1 start-track chooser). `exerciseId` is set
 * while the seat came from opening a Gruppe A/B network (§7.1 `exerciseStarts`) and unset
 * once the student picked a track directly.
 */
export interface SeatedTrack {
  stationKey: string;
  laneKey: string;
  exerciseId?: string;
}

export interface SimStatus {
  running: boolean;
  simTimeMs: number;
  cycle: number;
  scanIntervalMs: number;
  notausActive: boolean;
  derailed: boolean;
  /** Station track the plant is seated on: the start-track chooser renders THIS, never its
   *  own click, so it also follows a re-seat triggered by opening a network (D13). `null`
   *  when the loco stands on plain line, which no station board names. */
  seatedTrack: SeatedTrack | null;
  programLoaded: boolean;
  instructionCount: number;
  runtimeDiagnostics: readonly Diagnostic[];
}

/** Pedagogy data + check runs (§10.1–§10.3), implemented in main.ts; every field may be
 *  null/empty when the data JSONs or the sim stack are unavailable — the panels then show
 *  a labelled empty state instead of breaking the shell. */
export interface PedagogyHost {
  readonly exercises: readonly ExerciseSpec[] | null;
  readonly exercisesUnavailableReason: string;
  readonly examples: readonly ExampleSpec[] | null;
  readonly examplesUnavailableReason: string;
  readonly progress: ProgressStore | null;
  /** Deterministic headless check run (§10.1); null when the sim stack is unavailable. */
  runChecks(networkId: string): CheckRunReport | null;
  /** First-run editor buffer (a runnable example from examples.json), if available. */
  readonly editorDefaultSource: string | null;
}

/** The tools column tabs (Exercises / Hints / Examples, §10.1–§10.3; Parameters on the pump). */
export type ToolTab = 'exercises' | 'hints' | 'examples' | 'parameters';

const TOOL_TAB_KEYS: Readonly<Record<ToolTab, MsgKey>> = {
  exercises: 'tabs.exercises',
  hints: 'tabs.hints',
  examples: 'tabs.examples',
  parameters: 'tabs.parameters',
};

/** Student-adjustable plant parameters, if this experiment has any (see ParametersPanel). */
export interface ProfileParameters {
  readonly specs: readonly ParameterSpec[];
  /** The values in force right now. */
  values(): ParameterValues;
  /** Apply one value; returns the values in force AFTERWARDS (the plant clamps). */
  set(key: string, value: number): ParameterValues;
  /** Put every parameter back to its documented default; returns the values in force. */
  resetDefaults(): ParameterValues;
  /** Write out any deferred persistence NOW. The shell calls this wherever the page is about
   *  to stop existing (teardown, the experiment switch's reload), so a debounced write cannot
   *  be lost between the last edit and the unload. */
  flush(): void;
}

/**
 * What this experiment's plant HAS — the one place the shell learns that a pump has no
 * emergency stop, no station tracks and no graded networks.
 *
 * The profile only ever SUBTRACTS or SWAPS: the railway keeps `RAILWAY_PROFILE`, which is
 * exactly today's shell, and a host that supplies no profile gets it by default. That is
 * what makes "the railway is unchanged" checkable rather than merely intended.
 */
export interface SimProfile {
  readonly experiment: ExperimentId;
  /** Sub-headline under the app title — it names the plant. */
  readonly subtitleKey: MsgKey;
  /** Latching Notaus button in the ControlPanel. */
  readonly showNotaus: boolean;
  /** Start-track chooser in the ControlPanel. */
  readonly showStartTrack: boolean;
  /** Camera rigs offered; one entry hides the selector. */
  readonly cameraModes: readonly CameraMode[];
  /** "Train derailed" status chip. */
  readonly showDerailedChip: boolean;
  /** Explanatory line under the "Try it" toggles (the railway text names reed contacts). */
  readonly inputsNoteKey: MsgKey;
  /** Keyboard-reachable duplicates of the plant's own controls (buttons, switches, valves);
   *  `null` = this plant has none in the DOM. The railway's plant is driven by the program
   *  alone, the pump's by a 3D console that a keyboard cannot reach. */
  readonly plantControls: PlantControlsSpec | null;
  /** Tool tabs, in display order. */
  readonly tools: readonly ToolTab[];
  /** Static task text for the Exercises tab; `null` = the graded exercise browser. */
  readonly taskDoc: TaskDoc | null;
  /** Parameters tab host; `null` = this plant exposes none. */
  readonly parameters: ProfileParameters | null;
  /** Watch table layout; `null` = the railway default derived from symbols + wiring. */
  readonly watchSections: readonly WatchSectionSpec[] | null;
}

/** The delivered shell, unchanged — also the fallback for a host that supplies no profile. */
export const RAILWAY_PROFILE: SimProfile = {
  experiment: 'railway',
  subtitleKey: 'app.subtitle',
  showNotaus: true,
  showStartTrack: true,
  cameraModes: DEFAULT_CAMERA_MODES,
  showDerailedChip: true,
  inputsNoteKey: 'inputs.note',
  plantControls: null,
  tools: ['exercises', 'hints', 'examples'],
  taskDoc: null,
  parameters: null,
  watchSections: null,
};

/** Everything the shell needs from the simulation side (implemented in main.ts). */
export interface SimHost {
  /** Which experiment this host drives and which controls it has; absent = the railway. */
  readonly profile?: SimProfile;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly sceneAvailable: boolean;
  readonly sceneUnavailableReason: string;
  readonly symbols: SymbolTable | null;
  readonly wiring: Wiring | null;
  readonly pedagogy: PedagogyHost;
  /** Station tracks the start-track chooser may offer, derived from the trackplan; empty
   *  when the simulation core is unavailable. */
  readonly startTracks: readonly StartTrackOption[];
  loadProgram(source: string): ProgramLoadOutcome;
  setRunning(running: boolean): void;
  reset(): void;
  /** Seat the live plant for the selected exercise (§7.1 `exerciseStarts`, D13): Gruppe A
   *  starts on Bahnhof 1 Gleis 1, Gruppe B on Gleis 4. Returns whether the loco moved —
   *  the shell mirrors the effect instead of assuming the call did something. */
  setExercise(exerciseId: string): boolean;
  /** Seat the loco on a chosen station track at the §10.1 seat rule's offset — upstream
   *  of the track's first wired reed where possible (D19 guard (a)).
   *  Returns whether it moved; a refused seat leaves the loco — and the chooser display —
   *  where they were. */
  setStartTrack(ref: { stationKey: string; laneKey: string }): boolean;
  setScanInterval(ms: number): void;
  setTimeScale(scale: number): void;
  setNotaus(active: boolean): void;
  /** Force (true) or release (false) a PAE bit for the "Try it" mini-mode (§10.3).
   *  Returns whether the coordinator applied it — the UI mirrors the effect, not the click. */
  forceInputBit(address: BitAddress, value: boolean): boolean;
  /** Release every forced input bit (a new program run starts without forces). */
  clearForcedInputs(): void;
  setCameraMode(mode: CameraMode): void;
  setLabelsVisible(visible: boolean): void;
  /** Hover glow in the 3D view for the plant object a symbol belongs to (§5.4);
   *  `null` clears it. Unknown symbols clear it too — the UI does not classify them. */
  highlightSymbol(name: string | null): void;
  resizeViewport(width: number, height: number): void;
  status(): SimStatus;
  reader(): WatchReader | null;
}

export interface AppOptions {
  parent: HTMLElement;
  host: SimHost;
}

/** Localized name of an experiment for the header switcher. */
export function experimentName(experiment: ExperimentId): string {
  return experiment === 'pump' ? t('experiment.pump') : t('experiment.railway');
}

export class App {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;

  private readonly host: SimHost;
  private readonly profile: SimProfile;
  private readonly titleNode: HTMLElement;
  private readonly subtitleNode: HTMLElement;
  private readonly statusNode: HTMLElement;
  private readonly bannerNode: HTMLElement;
  private readonly viewportNode: HTMLElement;
  private readonly localeButtons = new Map<Locale, HTMLButtonElement>();
  private readonly experimentButtons = new Map<ExperimentId, HTMLButtonElement>();
  private readonly experimentGroup: HTMLElement;
  private readonly editor: EditorPanel;
  private readonly diagnostics: DiagnosticsPanel;
  private readonly watch: WatchPanel;
  private readonly controls: ControlPanel;
  private readonly exercisePanel: ExercisePanel;
  private readonly hintPanel: HintPanel;
  private readonly examplesPanel: ExamplesPanel;
  /** Only built when the profile carries a task document / a parameter set. */
  private readonly taskPanel: TaskPanel | null = null;
  private readonly parametersPanel: ParametersPanel | null = null;
  private readonly tabButtons = new Map<ToolTab, HTMLButtonElement>();
  private readonly toolPanels = new Map<ToolTab, HTMLElement>();
  private readonly layout: LayoutController;
  private activeTab: ToolTab;

  private readonly unsubscribeLocale: () => void;
  private readonly resizeObserver: ResizeObserver | null = null;
  private refreshTimer: number | null = null;

  private compileDiagnostics: readonly Diagnostic[] = [];
  /** Normalization result of the last "Load into PLC" (§5.1.5): its line map re-anchors every
   *  diagnostic onto the line the student sees, and its counts feed the I-TPL-001 summary. */
  private normalized: NormalizedSource | null = null;
  private loadedInstructionCount = 0;
  /** null = force re-render on the next sync (an empty list's signature is '', so the
   *  sentinel must be distinguishable from it — '' would swallow the error→empty edge). */
  private diagnosticsSignature: string | null = null;

  constructor(options: AppOptions) {
    this.host = options.host;
    this.profile = options.host.profile ?? RAILWAY_PROFILE;
    this.activeTab = this.profile.tools[0] ?? 'exercises';

    // ── header ───────────────────────────────────────────────────────────────
    this.titleNode = el('h1', { className: 'app-title', text: t('app.title') });
    this.subtitleNode = el('p', {
      className: 'app-subtitle',
      text: t(this.profile.subtitleKey),
    });
    this.statusNode = el('div', { className: 'status-line', attrs: { role: 'status' } });

    // Experiment switcher: persist + reload (see ui/experiment.ts for why a reload).
    this.experimentGroup = el('div', {
      className: 'segmented experiment-toggle',
      attrs: { role: 'group', 'aria-label': t('experiment.label') },
    });
    for (const experiment of EXPERIMENT_IDS) {
      const button = el('button', {
        className: 'seg-btn',
        attrs: { type: 'button' },
        text: experimentName(experiment),
        onClick: () => this.selectExperiment(experiment),
      });
      this.experimentButtons.set(experiment, button);
      this.experimentGroup.appendChild(button);
    }

    const localeGroup = el('div', {
      className: 'segmented locale-toggle',
      attrs: { role: 'group', 'aria-label': t('lang.label') },
    });
    for (const locale of ['en', 'de'] as const) {
      const button = el('button', {
        className: 'seg-btn',
        attrs: { type: 'button' },
        text: locale === 'en' ? t('lang.en') : t('lang.de'),
        onClick: () => setLocale(locale),
      });
      this.localeButtons.set(locale, button);
      localeGroup.appendChild(button);
    }

    const header = el('header', {
      className: 'app-header',
      children: [
        el('div', { className: 'app-brand', children: [this.titleNode, this.subtitleNode] }),
        this.statusNode,
        this.experimentGroup,
        localeGroup,
      ],
    });

    // ── panels ───────────────────────────────────────────────────────────────
    const editorOptions: ConstructorParameters<typeof EditorPanel>[0] = {
      symbols: this.host.symbols,
      onLoad: (source) => this.loadProgram(source),
      storageKey: editorStorageKeyFor(this.profile.experiment),
    };
    const defaultSource = this.host.pedagogy.editorDefaultSource;
    if (defaultSource !== null) editorOptions.defaultSource = defaultSource;
    this.editor = new EditorPanel(editorOptions);
    this.diagnostics = new DiagnosticsPanel({
      onSelect: (line, col) => this.editor.focusLine(line, col),
    });
    this.watch = new WatchPanel({
      onHoverSymbol: (name) => this.host.highlightSymbol(name),
    });
    this.controls = new ControlPanel({
      onRun: () => this.setRunning(true),
      onStop: () => this.setRunning(false),
      onReset: () => this.resetSimulation(),
      onScanIntervalChange: (ms) => this.host.setScanInterval(ms),
      onTimeScaleChange: (scale) => this.host.setTimeScale(scale),
      onNotausChange: (active) => this.host.setNotaus(active),
      onCameraModeChange: (mode) => this.host.setCameraMode(mode),
      startTracks: this.host.startTracks,
      onStartTrackChange: (ref) => {
        // Same effect as opening a network: re-seat, then bring the shell back in step.
        // `setStartTrack` reports whether the loco actually moved.
        if (this.host.setStartTrack(ref)) this.resetSimulation();
      },
      onLabelsChange: (visible) => this.host.setLabelsVisible(visible),
      onForceInput: (address, value) => this.host.forceInputBit(address, value),
      onResetLayout: () => this.layout.reset(),
      showNotaus: this.profile.showNotaus,
      showStartTrack: this.profile.showStartTrack,
      cameraModes: this.profile.cameraModes,
      inputsNoteKey: this.profile.inputsNoteKey,
      plantControls: this.profile.plantControls,
    });

    // ── tools column (Exercises / Hints / Examples, §10.1–§10.3) ─────────────
    this.exercisePanel = new ExercisePanel({
      onRunChecks: (networkId) => this.runChecks(networkId),
      onSelectNetwork: (selection) => {
        this.hintPanel.setNetwork(selection?.network ?? null);
        // D19 note context first: the panel derives the mismatch note from this and the
        // host-reported seat, and the re-seat below refreshes that seat synchronously.
        // Without a live plant there is no seat to disagree with — the note would warn
        // about a loco that does not exist, next to the simUnavailable banner.
        this.controls.setOpenExercise(
          this.host.available ? selection?.exerciseId ?? null : null,
        );
        // Opening a network of the other Aufgabenstellung re-seats the loco (§7.1
        // `exerciseStarts`, D13). A re-seat resets the plant, so the controls, the force
        // mask and the watch list have to follow — same path as the Reset button.
        if (selection !== null && this.host.available && this.host.setExercise(selection.exerciseId)) {
          this.resetSimulation();
        }
      },
    });
    this.hintPanel = new HintPanel({
      onShowExample: (exampleId) => {
        this.selectTab('examples');
        this.examplesPanel.showExample(exampleId);
      },
    });
    this.examplesPanel = new ExamplesPanel({
      onLoadIntoEditor: (source) => this.insertIntoEditor(source),
    });
    // The Exercises tab shows the graded browser OR a static task document — an experiment
    // without networks must not offer a "Run checks" button that can never grade anything.
    if (this.profile.taskDoc !== null) this.taskPanel = new TaskPanel(this.profile.taskDoc);
    const parameters = this.profile.parameters;
    if (parameters !== null) {
      this.parametersPanel = new ParametersPanel({
        onChange: (key, value) => parameters.set(key, value),
        onResetDefaults: () => parameters.resetDefaults(),
      });
    }

    const tabBar = el('div', {
      className: 'segmented tool-tabs',
      attrs: { role: 'tablist' },
    });
    for (const tab of this.profile.tools) {
      const panel = this.panelForTab(tab);
      if (panel === null) continue;                 // profile asked for a tab it has no data for
      const button = el('button', {
        className: 'seg-btn',
        attrs: { type: 'button', role: 'tab' },
        text: t(TOOL_TAB_KEYS[tab]),
        onClick: () => this.selectTab(tab),
      });
      this.tabButtons.set(tab, button);
      tabBar.appendChild(button);
      this.toolPanels.set(tab, panel);
    }
    if (!this.toolPanels.has(this.activeTab)) {
      this.activeTab = [...this.toolPanels.keys()][0] ?? 'exercises';
    }

    const toolsColumn = el('div', {
      className: 'app-column app-column-tools',
      children: [tabBar, ...this.toolPanels.values()],
    });

    this.canvas = el('canvas', { className: 'scene-canvas', attrs: { id: 'scene-canvas' } });
    this.bannerNode = el('div', { className: 'banner' });
    this.bannerNode.hidden = true;
    this.viewportNode = el('section', {
      className: 'panel panel-viewport',
      children: [this.canvas, this.bannerNode],
    });

    // ── resizable layout (§5.7) ──────────────────────────────────────────────
    // The splitters are grid items BETWEEN the panels, so they must exist before the columns
    // are built. The controller owns them (and all the geometry); the shell only places them.
    const centreColumn = el('div', { className: 'app-column app-column-left' });
    const rightColumn = el('div', { className: 'app-column app-column-right' });
    this.layout = new LayoutController({
      columns: [toolsColumn, centreColumn, rightColumn],
      centreRows: [this.editor.element, this.diagnostics.element],
      rightRows: [this.viewportNode, this.watch.element],
    });
    append(centreColumn,
           this.editor.element, this.layout.splitters.centreRows[0], this.diagnostics.element);
    append(rightColumn,
           this.viewportNode, this.layout.splitters.rightRows[0], this.watch.element);

    const main = el('div', {
      className: 'app-main',
      children: [
        toolsColumn,
        this.layout.splitters.columns[0],
        centreColumn,
        this.layout.splitters.columns[1],
        rightColumn,
      ],
    });

    this.element = el('div', {
      className: 'app-shell',
      children: [header, main, this.controls.element],
    });
    options.parent.appendChild(this.element);
    // Mount AFTER the shell is in the document: restoring a persisted layout has to measure
    // what this display actually offers, so an over-narrow stored split gets repaired (§5.7).
    this.layout.mount(main);

    // ── wiring up ────────────────────────────────────────────────────────────
    this.unsubscribeLocale = onLocaleChange(() => this.retranslate());
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.reportViewportSize());
      this.resizeObserver.observe(this.viewportNode);
    } else {
      window.addEventListener('resize', () => this.reportViewportSize());
    }

    this.selectTab(this.activeTab);
    this.refresh();
    this.retranslate();
    this.refreshTimer = window.setInterval(() => this.refreshLive(), REFRESH_INTERVAL_MS);
  }

  /** Re-read host availability: call after main.ts finished building scene/simulation. */
  refresh(): void {
    this.watch.clearReadFailure();
    this.watch.setLayout(
      this.profile.watchSections
        ?? buildDefaultWatchSections(this.host.symbols, this.host.wiring),
      this.host.symbols,
    );
    this.controls.setEnabled(this.host.available);
    const pedagogy = this.host.pedagogy;
    this.exercisePanel.setData(pedagogy.exercises, pedagogy.progress,
                               pedagogy.exercisesUnavailableReason);
    this.hintPanel.setProgress(pedagogy.progress);
    this.examplesPanel.setExamples(pedagogy.examples, pedagogy.examplesUnavailableReason);
    this.refreshParameters();
    this.renderBanner();
    this.reportViewportSize();
    this.refreshLive();
  }

  /** Push the values IN FORCE into the Parameters tab (the panel never trusts its own input). */
  private refreshParameters(): void {
    const panel = this.parametersPanel;
    const parameters = this.profile.parameters;
    if (panel === null || parameters === null) return;
    if (!this.host.available) {
      panel.setUnavailable(this.host.unavailableReason);
      return;
    }
    panel.setParameters(parameters.specs, parameters.values());
    panel.setEnabled(true);
  }

  /** The element a tab renders; `null` when the profile has no content for it. */
  private panelForTab(tab: ToolTab): HTMLElement | null {
    switch (tab) {
      case 'exercises': return (this.taskPanel ?? this.exercisePanel).element;
      case 'hints':     return this.hintPanel.element;
      case 'examples':  return this.examplesPanel.element;
      case 'parameters': return this.parametersPanel?.element ?? null;
    }
  }

  /**
   * Persist the experiment and reload. The reload is the mechanism, not a shortcut: it
   * guarantees a clean WebGL context, editor view and simulation loop instead of a disposal
   * dance across two plant types (see ui/experiment.ts).
   *
   * Everything that persists on a DEBOUNCE has to be flushed first: the editor mirrors its
   * buffer 500 ms after the last keystroke and the parameter host writes on the same delay,
   * so switching within half a second of an edit used to reload over the unsaved work. The
   * reload destroys the timers, it does not run them. That ordering is the policy of
   * `switchExperiment` (ui/experiment.ts), where it is testable without a DOM.
   */
  private selectExperiment(experiment: ExperimentId): void {
    switchExperiment({
      current: this.profile.experiment,
      next: experiment,
      flush: () => this.flushPendingWrites(),
      persist: writeStoredExperiment,
      reload: () => {
        if (typeof location !== 'undefined') location.reload();
      },
    });
  }

  /** Force every debounced write out (see `selectExperiment`). Safe to call repeatedly. */
  private flushPendingWrites(): void {
    this.editor.flush();
    this.profile.parameters?.flush();
  }

  /** Current canvas size in CSS pixels (SceneManager handles devicePixelRatio itself).
   *  Measured on the canvas, not on the enclosing panel: the panel is 1px larger on each
   *  side (border), and feeding the panel size to `SceneManager.resize` would make the
   *  drawing buffer disagree with the displayed size and skew the camera aspect. */
  viewportSize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      width: Math.max(Math.round(rect.width), 1),
      height: Math.max(Math.round(rect.height), 1),
    };
  }

  dispose(): void {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.resizeObserver?.disconnect();
    this.unsubscribeLocale();
    this.profile.parameters?.flush();
    this.layout.dispose();
    this.editor.dispose();          // flushes the editor buffer itself
    this.element.remove();
  }

  // ── actions ────────────────────────────────────────────────────────────────

  private selectTab(tab: ToolTab): void {
    this.activeTab = tab;
    for (const [candidate, button] of this.tabButtons) {
      const active = candidate === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const [candidate, panel] of this.toolPanels) {
      panel.hidden = candidate !== tab;
    }
  }

  /** "Run checks" (§10.1): delegate to the host, then refresh the hint gate — a failed
   *  run is an unlock trigger (§5.5). */
  private runChecks(networkId: string): CheckRunReport | null {
    const report = this.host.pedagogy.runChecks(networkId);
    this.hintPanel.refresh();
    this.refreshLive();
    return report;
  }

  /** Insert an example into the editor (§10.3); confirms before replacing student code. */
  private insertIntoEditor(source: string): void {
    const current = this.editor.getSource();
    if (current.trim() !== '' && current !== source) {
      // eslint-disable-next-line no-alert -- deliberate, small M1 stand-in for a scratch tab
      if (!window.confirm(t('examples.confirmReplace'))) return;
    }
    this.editor.setSource(source);
  }

  /**
   * "Load into PLC" (§5.1.5): normalize FIRST, compile the extracted program, then re-anchor
   * every diagnostic onto the original buffer.
   *
   * The students' real practicum file is the filled-in course template — task prose around
   * `--Bitte hier programmieren--` sections — so the buffer that goes to the tokenizer is not
   * the buffer the student typed. The editor is deliberately NOT rewritten: they keep seeing
   * their own file, and the line map (plus the I-TPL-001 summary) carries the translation.
   */
  private loadProgram(source: string): void {
    if (!this.host.available) {
      this.renderBanner();
      return;
    }
    const normalized = normalizeSource(source);
    const outcome = this.host.loadProgram(normalized.program);
    this.normalized = normalized;
    this.loadedInstructionCount = outcome.instructionCount;
    this.compileDiagnostics = mapDiagnostics(outcome.diagnostics, normalized.lineMap);
    this.editor.setDiagnostics([...this.templateDiagnostics(), ...this.compileDiagnostics]);
    // A new program run starts unforced, and its toggle row is rebuilt from its own inputs
    // (§10.3) — dropping the host-side forces first keeps buttons and force mask in step.
    this.host.clearForcedInputs();
    this.controls.setForcibleInputs(outcome.forcibleInputs);
    // The STUDENT's buffer is what "in sync with PLC" refers to, not the extracted program.
    if (outcome.ok) this.editor.markLoaded(source);
    this.diagnosticsSignature = null;     // force a re-render of the message list
    this.refreshLive();
  }

  private templateDiagnostics(): readonly Diagnostic[] {
    if (this.normalized === null) return [];
    return templateNoticeDiagnostics(this.normalized, this.loadedInstructionCount);
  }

  private setRunning(running: boolean): void {
    if (!this.host.available) return;
    this.host.setRunning(running);
    this.controls.setRunning(running);
    this.refreshLive();
  }

  private resetSimulation(): void {
    if (!this.host.available) return;
    this.controls.setRunning(false);
    this.controls.setNotaus(false);
    this.host.setRunning(false);
    this.host.reset();                    // also drops the force mask (coordinator.reset)
    this.controls.clearForcedInputs();
    this.watch.clearReadFailure();
    this.refreshLive();
  }

  // ── periodic refresh ───────────────────────────────────────────────────────

  private refreshLive(): void {
    if (!this.host.available) {
      this.renderStatus(null);
      return;
    }
    let status: SimStatus | null = null;
    try {
      status = this.host.status();
    } catch {
      status = null;
    }
    this.renderStatus(status);
    if (status !== null) {
      this.controls.setNotaus(status.notausActive);
      this.controls.setRunning(status.running);
      this.controls.setSeatedTrack(status.seatedTrack);
      this.syncDiagnostics(status.runtimeDiagnostics);
    }
    // The plant's own controls render the state the PLANT reports, so a switch thrown in the
    // 3D view shows up on the strip and vice versa — one state, two ways to operate it.
    this.controls.refreshPlantControls();
    this.watch.update(this.host.reader());
  }

  private syncDiagnostics(runtime: readonly Diagnostic[]): void {
    // Runtime diagnostics R-RUN-001/002 carry lines of the COMPILED program, so they need the
    // same re-anchoring as the compile diagnostics. The UI-raised, position-less ones
    // (W-SWI-001, R-RUN-000 — nominally line 1) must NOT be mapped: they would be given a
    // fabricated position on whatever line the extract happens to start at.
    const mappedRuntime = mapRuntimeDiagnostics(runtime, this.normalized?.lineMap);
    const merged = [...this.templateDiagnostics(), ...this.compileDiagnostics, ...mappedRuntime];
    const signature = merged.map((d) => `${d.code}@${d.line}:${d.col}:${d.severity}`).join('|');
    if (signature === this.diagnosticsSignature) return;
    this.diagnosticsSignature = signature;
    this.diagnostics.setDiagnostics(merged);
  }

  private renderStatus(status: SimStatus | null): void {
    clear(this.statusNode);
    if (status === null) {
      append(this.statusNode, el('span', {
        className: 'chip chip-warn',
        text: t('status.simUnavailable', { reason: this.host.unavailableReason }),
      }));
      return;
    }

    append(
      this.statusNode,
      el('span', {
        className: `chip ${status.running ? 'chip-run' : 'chip-idle'}`,
        text: status.running ? t('status.running') : t('status.paused'),
      }),
      el('span', {
        className: 'chip',
        text: t('status.simTime', { value: formatNumber(status.simTimeMs / 1000, 1) }),
      }),
      el('span', { className: 'chip', text: t('status.cycle', { value: status.cycle }) }),
      el('span', { className: 'chip', text: t('status.scan', { value: status.scanIntervalMs }) }),
      el('span', {
        className: 'chip',
        text: status.programLoaded
          ? t('status.programLoaded', { count: status.instructionCount })
          : t('status.noProgram'),
      }),
      // Plant-specific alarms: the pump has neither an emergency stop nor a derailment,
      // so its profile switches both chips off rather than relying on them staying false.
      this.profile.showNotaus && status.notausActive
        ? el('span', { className: 'chip chip-alarm', text: t('status.notausActive') })
        : null,
      this.profile.showDerailedChip && status.derailed
        ? el('span', { className: 'chip chip-alarm', text: t('status.derailed') })
        : null,
    );
  }

  private renderBanner(): void {
    const messages: string[] = [];
    if (!this.host.available) {
      // The status chip already names the simulation failure; the banner then only has to
      // explain the empty viewport, so the same sentence is not printed twice.
      messages.push(t('viewport.unavailable', { reason: this.host.unavailableReason }));
    } else if (!this.host.sceneAvailable) {
      messages.push(t('viewport.unavailable', { reason: this.host.sceneUnavailableReason }));
    }
    clear(this.bannerNode);
    this.bannerNode.hidden = messages.length === 0;
    for (const message of messages) {
      this.bannerNode.appendChild(el('p', { className: 'banner-line', text: message }));
    }
  }

  private reportViewportSize(): void {
    const size = this.viewportSize();
    this.host.resizeViewport(size.width, size.height);
  }

  private retranslate(): void {
    const locale = getLocale();
    this.titleNode.textContent = t('app.title');
    this.subtitleNode.textContent = t(this.profile.subtitleKey);
    this.experimentGroup.setAttribute('aria-label', t('experiment.label'));
    for (const [candidate, button] of this.experimentButtons) {
      const active = candidate === this.profile.experiment;
      const name = experimentName(candidate);
      button.textContent = name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.title = t('experiment.switchTo', { name });
    }
    for (const [candidate, button] of this.localeButtons) {
      const active = candidate === locale;
      button.textContent = candidate === 'en' ? t('lang.en') : t('lang.de');
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.title = t('lang.switchTo', { lang: candidate === 'en' ? t('lang.en') : t('lang.de') });
    }
    this.editor.retranslate();
    this.diagnostics.retranslate();
    this.watch.retranslate();
    this.controls.retranslate();
    this.exercisePanel.retranslate();
    this.hintPanel.retranslate();
    this.examplesPanel.retranslate();
    this.taskPanel?.retranslate();
    // ONE rebuild of the Parameters tab per locale switch: the panel's `retranslate` already
    // re-renders every row from the values it holds, which are the values in force. Calling
    // `refreshParameters()` here as well built the whole tab twice — visible as a flicker and
    // as a second round of value writes into the controls.
    this.parametersPanel?.retranslate();
    this.layout.retranslate();
    for (const [tab, button] of this.tabButtons) {
      button.textContent = t(TOOL_TAB_KEYS[tab]);
    }
    this.renderBanner();
    this.diagnosticsSignature = null;
    this.refreshLive();
  }
}
