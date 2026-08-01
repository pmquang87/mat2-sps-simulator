/**
 * WatchPanel (ARCHITECTURE.md §10.4): the watch table — live E/A/M bit values, the
 * Fahrstrom word, the S5 timers T 10–T 20 and counter Z 1.
 *
 * Backed entirely by the `Emulator` inspection API and `Plant.snapshot()` through the
 * injected `WatchReader` — the panel adds no new core surface. Bytes of the Merker areas are
 * shown as 8-bit rows so 100+ single-bit rows do not drown the useful ones.
 */
import type { BitAddress, BitArea, CounterView, SymbolEntry, SymbolTable, TimerView, WordAddress } from '../../core';
import type { Wiring } from '../../app';
import { append, clear, el } from '../dom';
import { t } from '../i18n/i18n';
import type { MsgKey } from '../i18n/i18n';

export type WatchRowSpec =
  | { kind: 'bit'; address: BitAddress; name?: string }
  | { kind: 'word'; address: WordAddress; name?: string }
  | { kind: 'byteBits'; area: BitArea; byte: number; name?: string }
  | { kind: 'timer'; n: number; name?: string }
  | { kind: 'counter'; n: number; name?: string };

export interface WatchSectionSpec {
  titleKey: MsgKey;
  rows: WatchRowSpec[];
  open?: boolean;
}

/** Live value access, implemented over the Emulator by the app bootstrap. */
export interface WatchReader {
  bit(address: BitAddress): boolean;
  word(address: WordAddress): number;
  byte(area: BitArea, byte: number): number;
  timer(n: number): TimerView;
  counter(n: number): CounterView;
}

const STUDENT_FLAG_BYTES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const COIL_FLAG_BYTES = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
const STUDENT_TIMERS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Display form of an address (same canonical shape as core's formatAddress, §5.1.1). */
function addressText(row: WatchRowSpec): string {
  switch (row.kind) {
    case 'bit':      return `${row.address.area} ${row.address.byte}.${row.address.bit}`;
    case 'word':     return `${row.address.area} ${row.address.byte}`;
    case 'byteBits': return `${row.area}B ${row.byte}`;
    case 'timer':    return `T ${row.n}`;
    case 'counter':  return `Z ${row.n}`;
  }
}

function symbolKey(entry: SymbolEntry): string | null {
  const target = entry.target;
  switch (target.kind) {
    case 'bit':     return `${target.area}${target.byte}.${target.bit}`;
    case 'word':    return `${target.area}${target.byte}`;
    case 'timer':   return `T${target.n}`;
    case 'counter': return `Z${target.n}`;
    default:        return null;      // block refs have no watchable value
  }
}

/** symbol name index keyed by address — avoids one try/catch per byAddress() call. */
function buildSymbolIndex(symbols: SymbolTable | null): Map<string, string> {
  const index = new Map<string, string>();
  if (symbols === null) return index;
  let entries: readonly SymbolEntry[] = [];
  try {
    entries = symbols.all();
  } catch {
    return index;
  }
  for (const entry of entries) {
    const key = symbolKey(entry);
    if (key !== null && !index.has(key)) index.set(key, entry.symbol);
  }
  return index;
}

function rowKey(row: WatchRowSpec): string | null {
  switch (row.kind) {
    case 'bit':      return `${row.address.area}${row.address.byte}.${row.address.bit}`;
    case 'word':     return `${row.address.area}${row.address.byte}`;
    case 'timer':    return `T${row.n}`;
    case 'counter':  return `Z${row.n}`;
    case 'byteBits': return null;
  }
}

/**
 * Default watch layout. With a Wiring present the input section lists exactly the wired
 * reeds plus the Notaus input; without it (core/plant still stubs, or a trackplan without
 * reeds) it falls back to the raw input bytes so the table is never empty.
 */
export function buildDefaultWatchSections(
  symbols: SymbolTable | null,
  wiring: Wiring | null,
): WatchSectionSpec[] {
  const inputs: WatchRowSpec[] = [];
  if (wiring !== null) {
    inputs.push({ kind: 'bit', address: wiring.notausInput });
    for (const address of wiring.reedInput.values()) inputs.push({ kind: 'bit', address });
  } else {
    for (const byte of [0, 1, 2]) inputs.push({ kind: 'byteBits', area: 'E', byte });
  }

  const output: WatchRowSpec[] = [{
    kind: 'word',
    address: wiring?.fahrstromWord ?? { kind: 'word', area: 'AW', byte: 6 },
  }];

  const system: WatchRowSpec[] = [];
  if (wiring !== null) {
    const speed = wiring.speedBits;
    for (const address of [speed.stop, speed.s3iu, speed.s2iu, speed.s1iu,
                           speed.s1gu, speed.s2gu, speed.s3gu]) {
      system.push({ kind: 'bit', address });
    }
  } else {
    system.push({ kind: 'byteBits', area: 'M', byte: 120 });
  }
  system.push({ kind: 'bit', address: { kind: 'bit', area: 'M', byte: 121, bit: 0 } });

  return [
    { titleKey: 'watch.section.inputs', rows: inputs, open: true },
    { titleKey: 'watch.section.output', rows: output, open: true },
    { titleKey: 'watch.section.system', rows: system, open: true },
    {
      titleKey: 'watch.section.student',
      rows: STUDENT_FLAG_BYTES.map((byte): WatchRowSpec => ({ kind: 'byteBits', area: 'M', byte })),
      open: true,
    },
    {
      titleKey: 'watch.section.timers',
      rows: STUDENT_TIMERS.map((n): WatchRowSpec => ({ kind: 'timer', n })),
      open: true,
    },
    { titleKey: 'watch.section.counters', rows: [{ kind: 'counter', n: 1 }], open: true },
    {
      titleKey: 'watch.section.coils',
      rows: COIL_FLAG_BYTES.map((byte): WatchRowSpec => ({ kind: 'byteBits', area: 'M', byte })),
      open: false,
    },
  ];
}

interface RenderedRow {
  spec: WatchRowSpec;
  element: HTMLElement;
  searchText: string;
  valueNode: HTMLElement;
  bitNodes: HTMLElement[];
}

interface RenderedSection {
  spec: WatchSectionSpec;
  details: HTMLDetailsElement;
  summaryTitle: HTMLElement;
  rows: RenderedRow[];
}

export interface WatchPanelOptions {
  /** Pointer/keyboard focus entered a row carrying a plant symbol (null = left it).
   *  Feeds the scene's hover glow (§5.4 `SceneManager.highlight`): finding xR02BH2G3 on
   *  the plan is exactly the orientation problem the 3D view exists to solve. */
  onHoverSymbol?: (name: string | null) => void;
}

export class WatchPanel {
  readonly element: HTMLElement;

  private readonly options: WatchPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly filterInput: HTMLInputElement;
  private readonly filterLabelNode: HTMLElement;
  private readonly noteNode: HTMLElement;
  private readonly body: HTMLElement;

  private sections: RenderedSection[] = [];
  private symbolIndex = new Map<string, string>();
  private filter = '';
  private readFailed: string | null = null;

  constructor(options: WatchPanelOptions = {}) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title', text: t('watch.title') });
    this.filterLabelNode = el('span', { className: 'field-label', text: t('watch.filter') });
    this.filterInput = el('input', {
      className: 'field-input',
      attrs: { type: 'search', placeholder: t('watch.filterPlaceholder') },
      onInput: () => {
        this.filter = this.filterInput.value.trim().toLowerCase();
        this.applyFilter();
      },
    });
    this.noteNode = el('p', { className: 'panel-note' });
    this.body = el('div', { className: 'watch-body' });

    this.element = el('section', {
      className: 'panel panel-watch',
      children: [
        el('header', {
          className: 'panel-head',
          children: [
            this.titleNode,
            el('span', { className: 'spacer' }),
            el('label', {
              className: 'field field-inline',
              children: [this.filterLabelNode, this.filterInput],
            }),
          ],
        }),
        this.noteNode,
        this.body,
      ],
    });
  }

  /** Rebuild the table. Call once at startup and whenever the wiring/symbols change. */
  setLayout(sections: readonly WatchSectionSpec[], symbols: SymbolTable | null): void {
    this.symbolIndex = buildSymbolIndex(symbols);
    clear(this.body);
    this.sections = [];

    for (const section of sections) {
      const summaryTitle = el('span', { text: t(section.titleKey) });
      const summary = el('summary', {
        className: 'watch-section-head',
        children: [summaryTitle, el('span', { className: 'watch-count', text: section.rows.length })],
      });
      const table = el('div', { className: 'watch-table' });
      const details = el('details', { className: 'watch-section', children: [summary, table] });
      details.open = section.open !== false;

      const rendered: RenderedRow[] = [];
      for (const row of section.rows) {
        const built = this.buildRow(row);
        table.appendChild(built.element);
        rendered.push(built);
      }
      this.body.appendChild(details);
      this.sections.push({ spec: section, details, summaryTitle, rows: rendered });
    }
    this.applyFilter();
  }

  /** Refresh all live values. Cheap enough to call at ~10 Hz. */
  update(reader: WatchReader | null): void {
    if (reader === null) {
      this.setNote(t('watch.unavailable', { reason: t('status.noProgram') }));
      return;
    }
    if (this.readFailed !== null) return;                 // a stub threw — do not spam
    try {
      for (const section of this.sections) {
        if (!section.details.open) continue;              // collapsed: skip the work
        for (const row of section.rows) this.updateRow(row, reader);
      }
      this.setNote('');
    } catch (error) {
      this.readFailed = error instanceof Error ? error.message : String(error);
      this.setNote(t('watch.unavailable', { reason: this.readFailed }));
    }
  }

  /** Allow a retry after a reset/reload cleared the earlier failure. */
  clearReadFailure(): void {
    this.readFailed = null;
  }

  retranslate(): void {
    this.titleNode.textContent = t('watch.title');
    this.filterLabelNode.textContent = t('watch.filter');
    this.filterInput.placeholder = t('watch.filterPlaceholder');
    for (const section of this.sections) {
      section.summaryTitle.textContent = t(section.spec.titleKey);
      for (const row of section.rows) {
        if (row.spec.kind === 'timer' || row.spec.kind === 'counter') row.valueNode.textContent = '';
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private buildRow(spec: WatchRowSpec): RenderedRow {
    const key = rowKey(spec);
    const name = spec.name ?? (key === null ? '' : this.symbolIndex.get(key) ?? '');
    const address = addressText(spec);
    const bitNodes: HTMLElement[] = [];
    const valueNode = el('span', { className: 'watch-value' });

    if (spec.kind === 'byteBits') {
      const bits = el('span', { className: 'watch-bits', title: t('watch.bitsHint') });
      for (let bit = 7; bit >= 0; bit--) {
        const dot = el('span', { className: 'bit', title: `${spec.area} ${spec.byte}.${bit}` });
        bits.appendChild(dot);
        bitNodes[bit] = dot;
      }
      valueNode.appendChild(bits);
    }

    const element = el('div', {
      className: 'watch-row',
      children: [
        el('span', { className: 'watch-name', text: name === '' ? '—' : name }),
        el('span', { className: 'watch-addr', text: address }),
        valueNode,
      ],
    });

    // Hover glow (§5.4): only named rows can identify a plant object. Byte rows (M 100…)
    // carry no single symbol, so they never highlight.
    const hover = this.options.onHoverSymbol;
    if (hover !== undefined && name !== '') {
      element.addEventListener('pointerenter', () => hover(name));
      element.addEventListener('pointerleave', () => hover(null));
    }

    // Byte rows display as "MB 10", but the S7-canonical spelling students type is
    // "M 10" (the byte behind "U M 10.0") — index both, so the filter finds them either way.
    const byteAlias = spec.kind === 'byteBits' ? ` ${spec.area} ${spec.byte}` : '';
    return {
      spec,
      element,
      searchText: `${name} ${address}${byteAlias}`.toLowerCase(),
      valueNode,
      bitNodes,
    };
  }

  private updateRow(row: RenderedRow, reader: WatchReader): void {
    const spec = row.spec;
    switch (spec.kind) {
      case 'bit': {
        this.renderBit(row, reader.bit(spec.address));
        return;
      }
      case 'byteBits': {
        const value = reader.byte(spec.area, spec.byte);
        for (let bit = 0; bit < 8; bit++) {
          const node = row.bitNodes[bit];
          if (node === undefined) continue;
          node.classList.toggle('is-on', (value & (1 << bit)) !== 0);
        }
        return;
      }
      case 'word': {
        const value = reader.word(spec.address);
        const hex = value.toString(16).toUpperCase().padStart(4, '0');
        row.valueNode.textContent = `0x${hex} · ${value}`;
        return;
      }
      case 'timer': {
        const view = reader.timer(spec.n);
        row.valueNode.textContent =
          `${view.q ? '●' : '○'} ${t('watch.timer', {
            remaining: Math.round(view.remainingMs),
            preset: Math.round(view.presetMs),
          })}`;
        row.valueNode.classList.toggle('is-on', view.q);
        return;
      }
      case 'counter': {
        const view = reader.counter(spec.n);
        row.valueNode.textContent = `${view.q ? '●' : '○'} ${t('watch.counter', { value: view.value })}`;
        row.valueNode.classList.toggle('is-on', view.q);
        return;
      }
    }
  }

  private renderBit(row: RenderedRow, value: boolean): void {
    row.valueNode.textContent = value ? '●' : '○';
    row.valueNode.classList.toggle('is-on', value);
  }

  private setNote(text: string): void {
    if (this.noteNode.textContent === text) return;
    clear(this.noteNode);
    if (text !== '') append(this.noteNode, text);
  }

  private applyFilter(): void {
    for (const section of this.sections) {
      let visible = 0;
      for (const row of section.rows) {
        const show = this.filter === '' || row.searchText.includes(this.filter);
        row.element.hidden = !show;
        if (show) visible++;
      }
      section.details.hidden = visible === 0;
      if (this.filter !== '' && visible > 0) section.details.open = true;
    }
  }
}
