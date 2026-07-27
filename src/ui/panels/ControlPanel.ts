/**
 * ControlPanel (ARCHITECTURE.md §3): run/stop/reset, time scale, scan interval, the Notaus
 * button, the camera mode switch — and the "Try it" input toggles of §10.3.
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
import type { CameraMode } from '../../scene';
import { clear, el, selectField } from '../dom';
import { t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';

/** Allowed scan intervals (§5.2: 10…200 ms, multiple of the 10 ms physics step). */
export const SCAN_INTERVALS: readonly number[] = [10, 20, 50, 100, 200];
/** Time scales (§6.1: 0.25× … 8×; pausing is Stop, not scale 0). */
export const TIME_SCALES: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

const CAMERA_MODES: readonly { mode: CameraMode; key: MsgKey }[] = [
  { mode: 'orbit', key: 'camera.orbit' },
  { mode: 'bird', key: 'camera.bird' },
  { mode: 'cab', key: 'camera.cab' },
  { mode: 'trackside', key: 'camera.trackside' },
];

export interface ControlPanelOptions {
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onScanIntervalChange: (ms: number) => void;
  onTimeScaleChange: (scale: number) => void;
  onNotausChange: (active: boolean) => void;
  onCameraModeChange: (mode: CameraMode) => void;
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
  private readonly labelsToggle: HTMLInputElement;
  private readonly labelsText: HTMLElement;
  private readonly layoutLegend: HTMLElement;
  private readonly layoutResetButton: HTMLButtonElement;
  private readonly inputsGroup: HTMLElement;
  private readonly inputsLegend: HTMLElement;
  private readonly inputsRow: HTMLElement;
  private readonly inputsNote: HTMLElement;
  private readonly inputButtons = new Map<number, HTMLButtonElement>();

  private running = false;
  private notausActive = false;
  private enabled = true;
  private inputAddresses: readonly BitAddress[] = [];
  private readonly forcedInputs = new Set<number>();

  constructor(options: ControlPanelOptions) {
    this.options = options;

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
    for (const item of CAMERA_MODES) {
      const button = el('button', {
        className: 'seg-btn',
        attrs: { type: 'button' },
        onClick: () => this.selectCamera(item.mode),
      });
      this.cameraButtons.set(item.mode, button);
      cameraGroup.appendChild(button);
    }

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
    this.inputsNote = el('p', { className: 'inputs-note', text: t('inputs.note') });
    this.inputsGroup = el('div', {
      className: 'control-group control-inputs',
      children: [
        el('div', { className: 'field', children: [this.inputsLegend, this.inputsRow] }),
        this.inputsNote,
      ],
    });
    this.inputsGroup.hidden = true;

    this.element = el('section', {
      className: 'panel panel-controls',
      children: [
        el('div', {
          className: 'control-group',
          children: [this.runButton, this.stopButton, this.resetButton],
        }),
        el('div', { className: 'control-group', children: [scan.wrapper, speed.wrapper] }),
        el('div', {
          className: 'control-group',
          children: [
            el('div', { className: 'field', children: [this.cameraLegend, cameraGroup] }),
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
        this.inputsGroup,
        el('span', { className: 'spacer' }),
        el('div', { className: 'control-group', children: [this.notausButton] }),
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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const control of [this.runButton, this.stopButton, this.resetButton, this.notausButton]) {
      control.disabled = !enabled;
    }
    this.scanSelect.disabled = !enabled;
    for (const button of this.inputButtons.values()) button.disabled = !enabled;
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
    for (const item of CAMERA_MODES) {
      const button = this.cameraButtons.get(item.mode);
      if (button !== undefined) button.textContent = t(item.key);
    }
    this.inputsLegend.textContent = t('inputs.title');
    this.inputsRow.setAttribute('aria-label', t('inputs.title'));
    this.inputsNote.textContent = t('inputs.note');
    for (const address of this.inputAddresses) {
      const button = this.inputButtons.get(inputKey(address));
      if (button !== undefined) {
        button.title = t('inputs.toggleTitle', { address: formatAddress(address) });
      }
    }
    this.updateRunState();
    this.updateNotausState();
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
