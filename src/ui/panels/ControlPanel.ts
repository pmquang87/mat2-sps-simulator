/**
 * ControlPanel (ARCHITECTURE.md §3): run/stop/reset, time scale, scan interval, the Notaus
 * button, the camera mode switch, the start-track chooser — and the "Try it" input toggles
 * of §10.3.
 *
 * The start-track chooser (Bahnhof + Gleis, next to Reset because both put the plant into a
 * defined starting state) seats the loco on any station track the trackplan yields, at the
 * §10.1 seat rule's offset — upstream of the track's first wired reed where possible (D19
 * guard (a)). It renders the SEAT THE HOST REPORTS, never its own click: opening a
 * Gruppe A/B network re-seats the loco too (§7.1 `exerciseStarts`), and a host that refuses
 * a seat must leave the previous one on screen — D13.
 *
 * Scan interval and time scale are separate on purpose (§6.1): the scan interval is the
 * SIMULATED PLC cycle time (10…200 ms, multiple of the 10 ms physics step), the time scale
 * only changes how fast simulated time runs relative to the wall clock.
 *
 * The input toggles appear only for the E bits the LOADED program actually addresses (§10.3:
 * "wires E 0.x to clickable toggle buttons in the ControlPanel"), so a plant program shows
 * none and an Anleitung example shows exactly its own inputs. The panel mirrors what the host
 * accepted: a toggle lights up only when the force was really applied.
 */
import { formatAddress } from '../../core';
import type { BitAddress } from '../../core';
import type { CameraMode, StartTrackOption, StartTrackRef } from '../../scene';
import type { SeatedTrack } from '../App';
import { clear, el, selectField } from '../dom';
import { t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';

/** Allowed scan intervals (§5.2: 10…200 ms, multiple of the 10 ms physics step). */
export const SCAN_INTERVALS: readonly number[] = [10, 20, 50, 100, 200];
/** Time scales (§6.1: 0.25× … 8×; pausing is Stop, not scale 0). */
export const TIME_SCALES: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

const CAMERA_MODE_KEYS: Readonly<Record<CameraMode, MsgKey>> = {
  orbit: 'camera.orbit',
  bird: 'camera.bird',
  cab: 'camera.cab',
  trackside: 'camera.trackside',
};

/** Railway default — the four rigs of §5.4, in the order the panel has always shown them. */
export const DEFAULT_CAMERA_MODES: readonly CameraMode[] = ['orbit', 'bird', 'cab', 'trackside'];

/**
 * A control on the plant itself — a pedestal button, a switch, a hand valve.
 *
 * `momentary` is held: the bit is 1 while the pointer or the key is down and 0 again when it
 * is released, exactly like the 3D pedestal's `pointerdown`/`pointerup` (pump/scene/picking).
 * `latching` flips on activation and carries `aria-pressed`.
 *
 * `set` states the DESIRED NEW value, never "toggle" — same contract as the 3D pick callbacks,
 * so a host that drops one call cannot get out of phase. `read` is the state the PLANT
 * reports: the strip renders that, which is what keeps it and the 3D console showing one
 * state even though either can be operated.
 */
export type PlantControlKind = 'momentary' | 'latching';

export interface PlantControlSpec {
  /** Stable identity; also the DOM `data-control` value the tests address. */
  key: string;
  kind: PlantControlKind;
  /** Plant identifier (symbol and/or absolute address). NOT translated — it is the operand
   *  the student types. `null` for a control that has no operand (the hand valves). */
  label: string | null;
  /** Localized name, used when `label` is null. */
  labelKey: MsgKey | null;
  set(value: boolean): void;
  read(): boolean;
}

export interface PlantControlsSpec {
  legendKey: MsgKey;
  noteKey: MsgKey;
  controls: readonly PlantControlSpec[];
}

export interface ControlPanelOptions {
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onScanIntervalChange: (ms: number) => void;
  onTimeScaleChange: (scale: number) => void;
  onNotausChange: (active: boolean) => void;
  onCameraModeChange: (mode: CameraMode) => void;
  /** Station tracks the chooser offers (`scene/startTracks.ts`), trackplan order. Empty
   *  disables the chooser — there is nothing to seat on. */
  startTracks: readonly StartTrackOption[];
  /** Seat the loco on this station track at the §10.1 seat rule's offset — upstream of
   *  the track's first wired reed where possible. Resets the plant, so the
   *  shell treats it like the Reset button. */
  onStartTrackChange: (ref: StartTrackRef) => void;
  onLabelsChange: (visible: boolean) => void;
  /** Force (true) or release (false) an input bit; returns whether it was applied (§10.3). */
  onForceInput: (address: BitAddress, value: boolean) => boolean;
  /** "Reset layout" (§5.7): restore the default panel sizes. Never disabled — the layout is
   *  usable even when the simulation core failed to build. */
  onResetLayout: () => void;
  scanIntervalMs?: number;
  timeScale?: number;
  cameraMode?: CameraMode;
  labelsVisible?: boolean;

  // ── experiment profile (§ Experiments): which controls this plant HAS ─────
  // Every flag defaults to the railway behaviour, so the delivered panel is unchanged when
  // no profile is passed — a second experiment subtracts controls, it never rewrites them.
  /** Latching Notaus button (railway only — the pump plant has no emergency stop). */
  showNotaus?: boolean;
  /** Start-track chooser (railway only — the pump has no station tracks to seat on). */
  showStartTrack?: boolean;
  /** Camera modes to offer; one entry or none hides the selector entirely. */
  cameraModes?: readonly CameraMode[];
  /** Explanatory line under the "Try it" toggles; the railway text names reed contacts. */
  inputsNoteKey?: MsgKey;
  /** Keyboard-reachable duplicates of the plant's own controls. `null`/absent = this plant
   *  has none in the DOM (the railway is driven entirely by the program). */
  plantControls?: PlantControlsSpec | null;
}

/** E is a single byte area, so byte·8 + bit identifies an input bit (mirrors app/). */
function inputKey(address: BitAddress): number {
  return address.byte * 8 + address.bit;
}

export class ControlPanel {
  readonly element: HTMLElement;

  private readonly options: ControlPanelOptions;
  private readonly runButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly notausButton: HTMLButtonElement;
  private readonly scanLabel: HTMLElement;
  private readonly scanSelect: HTMLSelectElement;
  private readonly speedLabel: HTMLElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly cameraLegend: HTMLElement;
  private readonly cameraButtons = new Map<CameraMode, HTMLButtonElement>();
  private readonly startField: HTMLElement;
  private readonly startNote: HTMLElement;
  private readonly stationLabel: HTMLElement;
  private readonly stationSelect: HTMLSelectElement;
  private readonly laneLabel: HTMLElement;
  private readonly laneSelect: HTMLSelectElement;
  private readonly labelsToggle: HTMLInputElement;
  private readonly labelsText: HTMLElement;
  private readonly layoutLegend: HTMLElement;
  private readonly layoutResetButton: HTMLButtonElement;
  private readonly inputsGroup: HTMLElement;
  private readonly inputsLegend: HTMLElement;
  private readonly inputsRow: HTMLElement;
  private readonly inputsNote: HTMLElement;
  private readonly inputButtons = new Map<number, HTMLButtonElement>();
  private readonly plantControls: PlantControlsSpec | null;
  private readonly plantLegend: HTMLElement;
  private readonly plantRow: HTMLElement;
  private readonly plantNote: HTMLElement;
  private readonly plantButtons = new Map<string, HTMLButtonElement>();
  /** Momentary controls the pointer or the keyboard is holding down right now. */
  private readonly heldControls = new Set<string>();

  private running = false;
  private notausActive = false;
  private enabled = true;
  private readonly cameraModes: readonly CameraMode[];
  private readonly inputsNoteKey: MsgKey;
  private readonly startTracks: readonly StartTrackOption[];
  /** The seat the panel currently DISPLAYS. Written only by `setSeatedTrack`, i.e. by the
   *  host status — never by a click (D13: the display may not disagree with the plant). */
  private seatedTrack: SeatedTrack | null = null;
  /** Exercise whose network is open in the ExercisePanel; `null` when none is. Only used
   *  to derive the D19 mismatch note — never to move or conclude a seat. */
  private openExerciseId: string | null = null;
  private inputAddresses: readonly BitAddress[] = [];
  private readonly forcedInputs = new Set<number>();

  constructor(options: ControlPanelOptions) {
    this.options = options;
    this.cameraModes = [...(options.cameraModes ?? DEFAULT_CAMERA_MODES)];
    this.inputsNoteKey = options.inputsNoteKey ?? 'inputs.note';
    this.startTracks = [...options.startTracks];

    this.runButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'button' },
      onClick: () => options.onRun(),
    });
    this.stopButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () => options.onStop(),
    });
    this.resetButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () => options.onReset(),
    });

    const scan = selectField(
      t('controls.scan'),
      SCAN_INTERVALS.map((ms) => ({ value: String(ms), label: `${ms} ms` })),
      String(options.scanIntervalMs ?? 50),
      (value) => options.onScanIntervalChange(Number(value)),
    );
    this.scanLabel = scan.label;
    this.scanSelect = scan.select;

    const speed = selectField(
      t('controls.speed'),
      TIME_SCALES.map((scale) => ({ value: String(scale), label: `${scale}×` })),
      String(options.timeScale ?? 1),
      (value) => options.onTimeScaleChange(Number(value)),
    );
    this.speedLabel = speed.label;
    this.speedSelect = speed.select;

    this.cameraLegend = el('span', { className: 'field-label', text: t('controls.camera') });
    const cameraGroup = el('div', { className: 'segmented', attrs: { role: 'group' } });
    for (const mode of this.cameraModes) {
      const button = el('button', {
        className: 'seg-btn',
        attrs: { type: 'button' },
        onClick: () => this.selectCamera(mode),
      });
      this.cameraButtons.set(mode, button);
      cameraGroup.appendChild(button);
    }
    // One rig (or none) is not a choice: the pump has a single orbit camera, so the
    // selector would be a control the student can only confirm.
    const showCamera = this.cameraModes.length > 1;

    // Start-track chooser (§10.1): Bahnhof + Gleis, both plant identifiers (the tokens on the
    // station boards and in the students' AWL operands), so the option texts are NOT
    // translated — only the two field labels are.
    const station = selectField(
      t('controls.startStation'),
      this.stationKeys().map((key) => ({ value: key, label: key })),
      this.stationKeys()[0] ?? '',
      (value) => this.chooseStation(value),
    );
    this.stationLabel = station.label;
    this.stationSelect = station.select;
    const lane = selectField(
      t('controls.startLane'),
      [],
      '',
      (value) => this.chooseLane(value),
    );
    this.laneLabel = lane.label;
    this.laneSelect = lane.select;
    this.startField = el('div', {
      className: 'field field-start-track',
      attrs: { role: 'group', 'aria-label': t('controls.startTrack') },
      children: [station.wrapper, lane.wrapper],
    });
    // D19 mismatch note: "Run checks" replays the OPEN exercise's pinned start, and the
    // station/track display alone cannot distinguish a chooser seat from the pinned seat
    // on the SAME lane — so a lost provenance must say so visibly, not in a tooltip.
    this.startNote = el('p', { className: 'start-note', attrs: { role: 'status' } });
    this.startNote.hidden = true;
    this.renderLanes(this.stationKeys()[0] ?? '', '');

    this.labelsToggle = el('input', { attrs: { type: 'checkbox' } });
    this.labelsToggle.checked = options.labelsVisible ?? true;
    this.labelsToggle.addEventListener('change', () => {
      options.onLabelsChange(this.labelsToggle.checked);
    });
    this.labelsText = el('span', { text: t('controls.labels') });

    this.layoutLegend = el('span', { className: 'field-label', text: t('layout.title') });
    this.layoutResetButton = el('button', {
      className: 'btn btn-ghost',
      attrs: { type: 'button' },
      onClick: () => options.onResetLayout(),
    });

    this.notausButton = el('button', {
      className: 'btn btn-notaus',
      attrs: { type: 'button' },
      onClick: () => this.toggleNotaus(),
    });

    this.inputsLegend = el('span', { className: 'field-label', text: t('inputs.title') });
    this.inputsRow = el('div', {
      className: 'input-toggles',
      attrs: { role: 'group', 'aria-label': t('inputs.title') },
    });
    this.inputsNote = el('p', { className: 'inputs-note', text: t(this.inputsNoteKey) });
    this.inputsGroup = el('div', {
      className: 'control-group control-inputs',
      children: [
        el('div', { className: 'field', children: [this.inputsLegend, this.inputsRow] }),
        this.inputsNote,
      ],
    });
    this.inputsGroup.hidden = true;

    // ── the plant's own controls, as DOM (profile-driven) ────────────────────
    this.plantControls = options.plantControls ?? null;
    this.plantLegend = el('span', { className: 'field-label' });
    this.plantRow = el('div', { className: 'plant-controls', attrs: { role: 'group' } });
    this.plantNote = el('p', { className: 'plant-note' });
    const plantGroup = this.plantControls === null ? null : el('div', {
      className: 'control-group control-plant',
      children: [
        el('div', { className: 'field', children: [this.plantLegend, this.plantRow] }),
        this.plantNote,
      ],
    });
    this.renderPlantControls();

    this.element = el('section', {
      className: 'panel panel-controls',
      children: [
        el('div', {
          className: 'control-group',
          children: [this.runButton, this.stopButton, this.resetButton],
        }),
        // Next to Reset on purpose: both put the plant back to a defined starting state.
        options.showStartTrack === false
          ? null
          : el('div', {
              className: 'control-group control-start',
              children: [this.startField, this.startNote],
            }),
        el('div', { className: 'control-group', children: [scan.wrapper, speed.wrapper] }),
        el('div', {
          className: 'control-group',
          children: [
            showCamera
              ? el('div', { className: 'field', children: [this.cameraLegend, cameraGroup] })
              : null,
            el('label', {
              className: 'field field-inline',
              title: t('controls.labelsTitle'),
              children: [this.labelsToggle, this.labelsText],
            }),
            el('div', {
              className: 'field',
              children: [this.layoutLegend, this.layoutResetButton],
            }),
          ],
        }),
        plantGroup,
        this.inputsGroup,
        el('span', { className: 'spacer' }),
        options.showNotaus === false
          ? null
          : el('div', { className: 'control-group', children: [this.notausButton] }),
      ],
    });

    this.selectCamera(options.cameraMode ?? 'orbit', false);
    this.retranslate();
  }

  setRunning(running: boolean): void {
    if (this.running === running) return;
    this.running = running;
    this.updateRunState();
  }

  setNotaus(active: boolean): void {
    if (this.notausActive === active) return;
    this.notausActive = active;
    this.updateNotausState();
  }

  setScanInterval(ms: number): void {
    this.scanSelect.value = String(ms);
  }

  setTimeScale(scale: number): void {
    this.speedSelect.value = String(scale);
  }

  setCameraMode(mode: CameraMode): void {
    this.selectCamera(mode, false);
  }

  /**
   * Show which station track the plant is seated on. Driven by the HOST STATUS, never by the
   * click: opening a network in the ExercisePanel re-seats the loco too (§7.1
   * `exerciseStarts`, D13), and a host that refuses a seat must leave the old one displayed.
   * `null` (loco on plain line, which no station board names) deselects both selects — a
   * visibly unnamed seat, not a stale claim about a track the loco is not on.
   */
  setSeatedTrack(seat: SeatedTrack | null): void {
    this.seatedTrack = seat;
    this.updateSeatNote();
    this.startField.title = seat?.exerciseId === undefined
      ? t('controls.startTrackTitle')
      : `${t('controls.startTrackTitle')} — ${t('controls.startTrackFromExercise')}`;
    if (seat === null) {
      this.stationSelect.selectedIndex = -1;
      this.laneSelect.selectedIndex = -1;
      return;
    }
    this.stationSelect.value = seat.stationKey;
    this.renderLanes(seat.stationKey, seat.laneKey);
  }

  /**
   * Which exercise's network is open in the ExercisePanel (`null` when none). Combined
   * with the HOST-reported seat provenance this drives the D19 mismatch note: "Run
   * checks" replays the open exercise's §7.1 pinned start, so a live seat without that
   * provenance means the live run can differ from the graded checks — visibly, not in a
   * tooltip, because the same station/track label can name both seats (a chooser BH1 G4
   * reads exactly like the pinned Gruppe B seat).
   */
  setOpenExercise(exerciseId: string | null): void {
    this.openExerciseId = exerciseId;
    this.updateSeatNote();
  }

  /** Derived state only (D13 extended by one pixel): note = f(host seat, open exercise).
   *  A plain-line seat (`null`) mismatches too — the loco is not on ANY pinned start. */
  private updateSeatNote(): void {
    const hidden = this.openExerciseId === null
      || this.seatedTrack?.exerciseId === this.openExerciseId;
    this.startNote.hidden = hidden;
    // Text is written on SHOW and cleared on hide: a `role="status"` live region announces
    // CONTENT changes, and a bare `hidden` flip with unchanged text is routinely missed by
    // screen readers — the warning would appear visually and stay silent.
    this.startNote.textContent = hidden ? '' : t('controls.seatMismatch');
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const control of [this.runButton, this.stopButton, this.resetButton, this.notausButton]) {
      control.disabled = !enabled;
    }
    this.scanSelect.disabled = !enabled;
    const seatable = enabled && this.startTracks.length > 0;
    this.stationSelect.disabled = !seatable;
    this.laneSelect.disabled = !seatable;
    for (const button of this.inputButtons.values()) button.disabled = !enabled;
    for (const button of this.plantButtons.values()) button.disabled = !enabled;
  }

  /** The forcible input bits of the loaded program (§10.3); an empty list hides the group. */
  setForcibleInputs(addresses: readonly BitAddress[]): void {
    this.inputAddresses = [...addresses];
    this.forcedInputs.clear();
    this.renderInputs();
  }

  /** Visual release of every toggle — used after the host dropped the forces (reset/load). */
  clearForcedInputs(): void {
    this.forcedInputs.clear();
    for (const address of this.inputAddresses) this.updateInputState(address);
  }

  /**
   * Re-read the plant's own controls (§ Experiments): the strip shows what the PLANT reports,
   * so a switch thrown in the 3D view lights up here too — and a press the coordinator has
   * not consumed yet does not look consumed. Called from the shell's periodic refresh.
   */
  refreshPlantControls(): void {
    const spec = this.plantControls;
    if (spec === null) return;
    for (const control of spec.controls) {
      const button = this.plantButtons.get(control.key);
      if (button === undefined) continue;
      let on = false;
      try {
        on = control.read();
      } catch {
        on = false;                     // an unavailable plant reads as "nothing energised"
      }
      button.classList.toggle('is-active', on);
      if (control.kind === 'latching') {
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  retranslate(): void {
    this.runButton.title = t('controls.runTitle');
    this.stopButton.textContent = t('controls.stop');
    this.stopButton.title = t('controls.stopTitle');
    this.resetButton.textContent = t('controls.reset');
    this.resetButton.title = t('controls.resetTitle');
    this.scanLabel.textContent = t('controls.scan');
    this.scanSelect.title = t('controls.scanTitle');
    this.speedLabel.textContent = t('controls.speed');
    this.speedSelect.title = t('controls.speedTitle');
    this.cameraLegend.textContent = t('controls.camera');
    this.labelsText.textContent = t('controls.labels');
    this.layoutLegend.textContent = t('layout.title');
    this.layoutResetButton.textContent = t('layout.reset');
    this.layoutResetButton.title = t('layout.resetTitle');
    for (const [mode, button] of this.cameraButtons) {
      button.textContent = t(CAMERA_MODE_KEYS[mode]);
    }
    this.startField.setAttribute('aria-label', t('controls.startTrack'));
    this.updateSeatNote();                 // rewrites the note text in the new locale
    this.stationLabel.textContent = t('controls.startStation');
    this.stationSelect.title = t('controls.startStationTitle');
    this.laneLabel.textContent = t('controls.startLane');
    this.laneSelect.title = t('controls.startLaneTitle');
    // re-render the seat only when one is known: retranslate also runs at construction,
    // before the first host status, and must not deselect the initial default preview
    if (this.seatedTrack !== null) this.setSeatedTrack(this.seatedTrack);
    else this.startField.title = t('controls.startTrackTitle');
    this.inputsLegend.textContent = t('inputs.title');
    this.inputsRow.setAttribute('aria-label', t('inputs.title'));
    this.inputsNote.textContent = t(this.inputsNoteKey);
    this.retranslatePlantControls();
    for (const address of this.inputAddresses) {
      const button = this.inputButtons.get(inputKey(address));
      if (button !== undefined) {
        button.title = t('inputs.toggleTitle', { address: formatAddress(address) });
      }
    }
    this.updateRunState();
    this.updateNotausState();
  }

  // ── start-track chooser (§10.1) ────────────────────────────────────────────

  /** Station keys in trackplan order, deduplicated (BH1, BH2, BH3). */
  private stationKeys(): string[] {
    const out: string[] = [];
    for (const option of this.startTracks) {
      if (!out.includes(option.stationKey)) out.push(option.stationKey);
    }
    return out;
  }

  private lanesOf(stationKey: string): StartTrackOption[] {
    return this.startTracks.filter((option) => option.stationKey === stationKey);
  }

  /** Rebuild the Gleis options for a station; `selected` falls back to its first track. */
  private renderLanes(stationKey: string, selected: string): void {
    const lanes = this.lanesOf(stationKey);
    const value = lanes.some((l) => l.laneKey === selected) ? selected : lanes[0]?.laneKey ?? '';
    clear(this.laneSelect);
    for (const lane of lanes) {
      // a dead-end track is offered honestly, but says so: IU parks against the buffer there
      const text = lane.stub
        ? `${lane.laneKey} (${t('controls.startLaneDeadEnd')})`
        : lane.laneKey;
      const option = el('option', { text, attrs: { value: lane.laneKey } });
      if (lane.laneKey === value) option.selected = true;
      this.laneSelect.appendChild(option);
    }
    this.laneSelect.value = value;
  }

  /**
   * Picking a Bahnhof seats the loco on that station's FIRST track: a station alone is not a
   * seat, and leaving the plant on the old track while the chooser shows a new station would
   * be exactly the display-disagrees-with-plant defect this panel exists to avoid.
   *
   * The lane list is rebuilt before the host answers — the student must see the station's
   * tracks immediately — so a host that refuses leaves the wrong lane list standing for up to
   * one status refresh, until `setSeatedTrack` re-renders the old seat. Pinned in
   * tests/ui/controlPanel.test.ts ("station pick the host refuses").
   */
  private chooseStation(stationKey: string): void {
    const laneKey = this.lanesOf(stationKey)[0]?.laneKey;
    if (laneKey === undefined) return;
    this.renderLanes(stationKey, laneKey);
    this.options.onStartTrackChange({ stationKey, laneKey });
  }

  private chooseLane(laneKey: string): void {
    const stationKey = this.stationSelect.value;
    if (!this.lanesOf(stationKey).some((l) => l.laneKey === laneKey)) return;
    this.options.onStartTrackChange({ stationKey, laneKey });
  }

  // ── the plant's own controls, keyboard-reachable (§ Experiments) ───────────

  /**
   * One labelled button per plant control. The 3D pedestal is a pick-target-only surface —
   * no tab stop, no name, nothing a screen reader can announce — so this strip is what makes
   * the plant operable without a mouse. Both routes call the SAME host callbacks.
   *
   * Momentary controls are held rather than clicked (`pointerdown` → 1, `pointerup`/leave →
   * 0, Space/Enter down → 1, key up → 0), because that is what the manual's self-hold example
   * teaches: a program that only latches on S1 must visibly drop when the button is released.
   * The keydown default is suppressed so the browser does not additionally synthesize a
   * `click` from the same key press.
   */
  private renderPlantControls(): void {
    const spec = this.plantControls;
    if (spec === null) return;
    clear(this.plantRow);
    this.plantButtons.clear();
    this.heldControls.clear();
    for (const control of spec.controls) {
      const button = el('button', {
        className: `btn btn-input btn-plant btn-plant-${control.kind}`,
        attrs: { type: 'button', 'data-control': control.key },
      });
      if (control.kind === 'latching') {
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => this.togglePlantControl(control));
      } else {
        this.bindMomentary(button, control);
      }
      button.disabled = !this.enabled;
      this.plantButtons.set(control.key, button);
      this.plantRow.appendChild(button);
    }
    this.retranslatePlantControls();
    this.refreshPlantControls();
  }

  private bindMomentary(button: HTMLButtonElement, control: PlantControlSpec): void {
    const press = (): void => {
      if (!this.enabled || this.heldControls.has(control.key)) return;
      this.heldControls.add(control.key);
      control.set(true);
    };
    const release = (): void => {
      if (!this.heldControls.delete(control.key)) return;
      control.set(false);
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointerleave', release);
    button.addEventListener('pointercancel', release);
    // `blur` catches the case the key-up never arrives because focus moved away while held.
    button.addEventListener('blur', release);
    button.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      press();
    });
    button.addEventListener('keyup', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      release();
    });
  }

  private togglePlantControl(control: PlantControlSpec): void {
    if (!this.enabled) return;
    // Ask for the inverse of what the PLANT reports, not of what the button looks like: the
    // same switch can have been thrown in the 3D view since the last refresh.
    let current = false;
    try {
      current = control.read();
    } catch {
      current = false;
    }
    control.set(!current);
    this.refreshPlantControls();
  }

  private retranslatePlantControls(): void {
    const spec = this.plantControls;
    if (spec === null) return;
    this.plantLegend.textContent = t(spec.legendKey);
    this.plantNote.textContent = t(spec.noteKey);
    this.plantRow.setAttribute('aria-label', t(spec.legendKey));
    for (const control of spec.controls) {
      const button = this.plantButtons.get(control.key);
      if (button === undefined) continue;
      const name = control.label ?? (control.labelKey === null ? control.key : t(control.labelKey));
      button.textContent = name;
      button.title = control.kind === 'momentary'
        ? t('plant.holdTitle', { name })
        : t('plant.toggleTitle', { name });
    }
  }

  // ── "Try it" input toggles (§10.3) ─────────────────────────────────────────

  private renderInputs(): void {
    clear(this.inputsRow);
    this.inputButtons.clear();
    for (const address of this.inputAddresses) {
      const label = formatAddress(address);
      const button = el('button', {
        className: 'btn btn-input',
        attrs: { type: 'button' },
        text: label,
        title: t('inputs.toggleTitle', { address: label }),
        onClick: () => this.toggleInput(address),
      });
      button.disabled = !this.enabled;
      this.inputButtons.set(inputKey(address), button);
      this.inputsRow.appendChild(button);
      this.updateInputState(address);
    }
    this.inputsGroup.hidden = this.inputAddresses.length === 0;
  }

  private toggleInput(address: BitAddress): void {
    const key = inputKey(address);
    const next = !this.forcedInputs.has(key);
    // Mirror the host, not the click: an input the coordinator refuses stays untouched.
    if (!this.options.onForceInput(address, next)) return;
    if (next) this.forcedInputs.add(key);
    else this.forcedInputs.delete(key);
    this.updateInputState(address);
  }

  private updateInputState(address: BitAddress): void {
    const key = inputKey(address);
    const button = this.inputButtons.get(key);
    if (button === undefined) return;
    const forced = this.forcedInputs.has(key);
    button.classList.toggle('is-active', forced);
    button.setAttribute('aria-pressed', forced ? 'true' : 'false');
  }

  private updateRunState(): void {
    this.runButton.textContent = t('controls.run');
    this.runButton.classList.toggle('is-active', this.running);
    this.stopButton.classList.toggle('is-active', !this.running);
  }

  private updateNotausState(): void {
    this.notausButton.textContent = this.notausActive
      ? t('controls.notausRelease')
      : t('controls.notaus');
    this.notausButton.title = t('controls.notausTitle');
    this.notausButton.classList.toggle('is-latched', this.notausActive);
    this.notausButton.setAttribute('aria-pressed', this.notausActive ? 'true' : 'false');
  }

  private toggleNotaus(): void {
    this.notausActive = !this.notausActive;
    this.updateNotausState();
    this.options.onNotausChange(this.notausActive);
  }

  private selectCamera(mode: CameraMode, notify = true): void {
    for (const [candidate, button] of this.cameraButtons) {
      const active = candidate === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (notify) this.options.onCameraModeChange(mode);
  }
}
