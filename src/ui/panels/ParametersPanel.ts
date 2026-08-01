/**
 * ParametersPanel — the plant parameters a student may change while the simulation runs.
 *
 * It exists for the pump experiment (the manual gives the signal map but no dynamics, so
 * the model's rates, switch points and dry-run delay are OURS and therefore fair game to
 * play with), but nothing here is pump-specific: the panel renders whatever `ParameterSpec`
 * list the host hands it. The pump's ranges and defaults live in `pump/params.ts`.
 *
 * The binding rule is the one the ControlPanel's start-track chooser already follows: the
 * controls display the values THE PLANT REPORTS, never the raw keystroke. Every edit goes
 * to the host, the host clamps it through the plant's own validation, and the returned
 * values are written back into both inputs — so typing 999 lands visibly on the range end
 * instead of leaving the UI claiming a value the model never accepted.
 *
 * Each parameter is operable two ways (slider for exploring, number field for a precise
 * value), both labelled, so the panel is fully keyboard-usable.
 *
 * `step` is a UI granularity, NOT a plant constraint, and the two controls can therefore
 * disagree by less than one step. The plant clamps to the range but does not snap: type 4.3
 * where the step is 0.5 and the model really runs on 4.3, which the number field shows —
 * while the `<input type="range">` element snaps its own thumb to the nearest valid step and
 * reads back 4.5. That is deliberate. Snapping the value before it reaches the plant would
 * silently apply an edit the student never made (the same objection as clamping a cleared
 * field to 0, see `apply`), and snapping only the DISPLAY would break the one rule this panel
 * exists to keep: what you see is what the plant runs on. The number field is the exact
 * reading; the slider is the coarse one.
 */
import { append, clear, el } from '../dom';
import { formatNumber, t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';

export interface ParameterSpec {
  /** Host-side identity of the parameter (a `PumpParamKey` for the pump). */
  key: string;
  labelKey: MsgKey;
  unitKey: MsgKey;
  min: number;
  max: number;
  /** Slider/number granularity. */
  step: number;
  /** true = the value is stored and applies on the NEXT reset; false = it applies live. */
  onReset: boolean;
}

/** Values in force, keyed like `ParameterSpec.key`. */
export type ParameterValues = Readonly<Record<string, number>>;

/**
 * The control the student is typing in right now, if any. Defensive on purpose: this panel is
 * also constructed in the node test environment against a `document` stub that has no
 * `activeElement`, and a missing focus owner simply means "nothing to protect".
 */
function focusedElement(): unknown {
  if (typeof document === 'undefined') return null;
  return (document as unknown as { activeElement?: unknown }).activeElement ?? null;
}

export interface ParametersPanelOptions {
  /** Apply one parameter. Returns the values IN FORCE afterwards (clamped by the plant). */
  onChange: (key: string, value: number) => ParameterValues;
  /** Put every parameter back to its documented default; returns the values in force. */
  onResetDefaults: () => ParameterValues;
}

interface RenderedParameter {
  spec: ParameterSpec;
  element: HTMLElement;
  slider: HTMLInputElement;
  number: HTMLInputElement;
}

export class ParametersPanel {
  readonly element: HTMLElement;

  private readonly options: ParametersPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly noteNode: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly bodyNode: HTMLElement;

  private specs: readonly ParameterSpec[] = [];
  private values: ParameterValues = {};
  private rows: RenderedParameter[] = [];
  private enabled = true;
  private unavailableReason: string | null = null;

  constructor(options: ParametersPanelOptions) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('params.title') });
    this.noteNode = el('p', { className: 'tool-note', text: t('params.note') });
    this.resetButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      text: t('params.reset'),
      title: t('params.resetTitle'),
      onClick: () => this.resetDefaults(),
    });
    this.bodyNode = el('div', { className: 'tool-body param-body' });
    this.element = el('section', {
      className: 'panel panel-parameters',
      children: [
        el('header', { className: 'panel-head', children: [this.titleNode] }),
        this.noteNode,
        this.bodyNode,
        el('div', { className: 'param-actions', children: [this.resetButton] }),
      ],
    });
    this.render();
  }

  /** Supply the parameter set and the values currently in force. */
  setParameters(specs: readonly ParameterSpec[], values: ParameterValues): void {
    this.specs = [...specs];
    this.values = { ...values };
    this.unavailableReason = null;
    this.render();
  }

  /** No parameter host (simulation core unavailable): show a labelled empty state. */
  setUnavailable(reason: string): void {
    this.specs = [];
    this.values = {};
    this.unavailableReason = reason;
    this.render();
  }

  /**
   * Refresh the displayed values without rebuilding the controls.
   *
   * The control that currently has focus is left alone: this is the FOREIGN refresh path (a
   * locale switch, a host push, another parameter's clamp), and writing into a field the
   * student is typing in would move the caret and swallow half-typed digits. The field is
   * brought back in step the moment it fires `change` — `apply` re-displays the value in
   * force, including into the focused control (see `showValue`'s `force`).
   */
  setValues(values: ParameterValues): void {
    this.display(values, null);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.resetButton.disabled = !enabled;
    for (const row of this.rows) {
      row.slider.disabled = !enabled;
      row.number.disabled = !enabled;
    }
  }

  retranslate(): void {
    this.titleNode.textContent = t('params.title');
    this.noteNode.textContent = t('params.note');
    this.resetButton.textContent = t('params.reset');
    this.resetButton.title = t('params.resetTitle');
    this.render();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private resetDefaults(): void {
    if (!this.enabled) return;
    // The reset button holds the focus here, not a field, so nothing is being typed into.
    this.setValues(this.options.onResetDefaults());
  }

  /** Write `values` into the controls; `forceKey` names the row whose own edit produced them,
   *  which is displayed even while focused (that is the clamp the student must see). */
  private display(values: ParameterValues, forceKey: string | null): void {
    this.values = { ...values };
    for (const row of this.rows) this.showValue(row, row.spec.key === forceKey);
  }

  private apply(spec: ParameterSpec, raw: string): void {
    if (!this.enabled) return;
    // A cleared or half-typed number field must not travel to the plant: redisplay the
    // value in force instead, which is what the model is actually running on. The emptiness
    // test is explicit because `Number('')` is 0 — silently clamping a cleared field to zero
    // would be an edit the student never made, and for a parameter whose range starts at 0
    // (the dry-run delay) it would even be accepted.
    const parsed = raw.trim() === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed)) {
      const row = this.rows.find((candidate) => candidate.spec.key === spec.key);
      if (row !== undefined) this.showValue(row, true);
      return;
    }
    this.display(this.options.onChange(spec.key, parsed), spec.key);
  }

  private showValue(row: RenderedParameter, force: boolean): void {
    const value = this.values[row.spec.key];
    const text = value === undefined ? '' : String(value);
    const focused = force ? null : focusedElement();
    if (row.slider !== focused) row.slider.value = text;
    if (row.number !== focused) row.number.value = text;
  }

  private render(): void {
    clear(this.bodyNode);
    this.rows = [];
    if (this.unavailableReason !== null) {
      append(this.bodyNode, el('p', {
        className: 'tool-empty',
        text: t('params.unavailable', { reason: this.unavailableReason }),
      }));
      this.resetButton.disabled = true;
      return;
    }
    this.resetButton.disabled = !this.enabled;
    for (const spec of this.specs) {
      const row = this.buildRow(spec);
      this.rows.push(row);
      append(this.bodyNode, row.element);
    }
  }

  private buildRow(spec: ParameterSpec): RenderedParameter {
    const label = t(spec.labelKey);
    const unit = t(spec.unitKey);
    const numberId = `param-${spec.key}`;
    const value = this.values[spec.key];
    const text = value === undefined ? '' : String(value);

    const labelNode = el('label', {
      className: 'field-label param-label',
      text: label,
      attrs: { for: numberId },
    });
    const slider = el('input', {
      className: 'param-slider',
      attrs: {
        type: 'range',
        min: String(spec.min),
        max: String(spec.max),
        step: String(spec.step),
        'aria-label': t('params.sliderLabel', { label }),
      },
      onInput: () => this.apply(spec, slider.value),
    });
    const number = el('input', {
      className: 'param-number',
      attrs: {
        type: 'number',
        id: numberId,
        min: String(spec.min),
        max: String(spec.max),
        step: String(spec.step),
        'aria-label': t('params.valueLabel', { label }),
      },
      onChange: () => this.apply(spec, number.value),
    });
    slider.value = text;
    number.value = text;
    slider.disabled = !this.enabled;
    number.disabled = !this.enabled;

    const unitNode = el('span', { className: 'param-unit', text: unit });
    const rangeNode = el('span', {
      className: 'param-range',
      text: `${t('params.range', {
        min: formatNumber(spec.min),
        max: formatNumber(spec.max),
        unit,
      })} · ${spec.onReset ? t('params.applyOnReset') : t('params.applyLive')}`,
    });

    const element = el('div', {
      className: 'param-row',
      children: [
        labelNode,
        el('div', { className: 'param-controls', children: [slider, number, unitNode] }),
        rangeNode,
      ],
    });

    return { spec, element, slider, number };
  }
}
