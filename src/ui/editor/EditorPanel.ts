/**
 * EditorPanel (ARCHITECTURE.md §3): the CodeMirror 6 AWL editor, the "Load into PLC" action
 * and the dirty-state indicator.
 *
 * "Dirty" means: the buffer differs from the source last handed to the emulator — the same
 * distinction as uploading the txt file in the real practicum. The buffer is mirrored into
 * localStorage so a page reload never costs a student their program.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, placeholder,
} from '@codemirror/view';
import type { Diagnostic, SymbolTable } from '../../core';
import { append, clear, el } from '../dom';
import { getLocale, t } from '../i18n/i18n';
import { awl } from './awlLanguage';
import { EditorBufferStore } from './bufferStore';
import { awlCompletion, completionSymbolCount } from './completion';
import { awlLinter, refreshLint } from './lint';

/** Railway buffer key. The pump experiment passes its own (`mat2sps.editor.pump.v1`) so the
 *  two programs cannot overwrite each other — they address different plants. */
export const DEFAULT_EDITOR_STORAGE_KEY = 'mat2sps.editor.v1';

export interface EditorPanelOptions {
  symbols: SymbolTable | null;
  /** Called with the current buffer when the student presses "Load into PLC" (or Ctrl+Enter). */
  onLoad: (source: string) => void;
  /** First-run buffer when nothing is stored yet — main.ts passes a runnable example from
   *  examples.json (§10.3); falls back to the built-in neutral starter snippet. */
  defaultSource?: string;
  /** localStorage key of the mirrored buffer; defaults to the railway's. */
  storageKey?: string;
}

/** Neutral starter buffer — syntax demonstration only, never task content (§10.2 guard). */
function starterSource(): string {
  return getLocale() === 'de'
    ? [
        '// Netzwerk 1 — Beispiel mit neutralen Operanden',
        'U     E 0.0        // Eingang abfragen',
        '=     M 10.0       // Zuweisung',
        '',
      ].join('\n')
    : [
        '// Network 1 — example with neutral operands',
        'U     E 0.0        // query an input',
        '=     M 10.0       // assignment',
        '',
      ].join('\n');
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--text-faint)',
    border: 'none',
    borderRight: '1px solid var(--border-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--surface-hi)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hi)', color: 'var(--text-dim)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-3)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text-strong)',
  },
  '.cm-completionLabel': { fontFamily: 'var(--font-mono)' },
  '.cm-completionDetail': { color: 'var(--text-dim)', fontStyle: 'normal', marginLeft: '0.75em' },
}, { dark: true });

export class EditorPanel {
  readonly element: HTMLElement;

  private readonly view: EditorView;
  private readonly options: EditorPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly stateNode: HTMLElement;
  private readonly symbolsNode: HTMLElement;
  private readonly placeholderCompartment = new Compartment();
  /** Debounced mirror of the buffer (`ui/editor/bufferStore.ts`). */
  private readonly buffer: EditorBufferStore;

  private diagnostics: readonly Diagnostic[] = [];
  private loadedSource: string | null = null;

  constructor(options: EditorPanelOptions) {
    this.options = options;
    this.buffer = new EditorBufferStore(
      options.storageKey ?? DEFAULT_EDITOR_STORAGE_KEY,
      () => this.getSource(),
    );

    this.titleNode = el('h2', { className: 'panel-title', text: t('editor.title') });
    this.stateNode = el('span', { className: 'panel-badge' });
    this.symbolsNode = el('span', { className: 'panel-note' });
    this.loadButton = el('button', {
      className: 'btn btn-primary',
      attrs: { type: 'button' },
      onClick: () => this.emitLoad(),
    });
    this.clearButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () => this.setSource(''),
    });

    const host = el('div', { className: 'editor-host' });
    this.element = el('section', {
      className: 'panel panel-editor',
      children: [
        el('header', {
          className: 'panel-head',
          children: [
            this.titleNode,
            this.stateNode,
            el('span', { className: 'spacer' }),
            this.clearButton,
            this.loadButton,
          ],
        }),
        host,
        el('footer', { className: 'panel-foot', children: [this.symbolsNode] }),
      ],
    });

    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: this.buffer.stored() ?? options.defaultSource ?? starterSource(),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          EditorState.allowMultipleSelections.of(true),
          awl(),
          autocompletion({ override: [awlCompletion(options.symbols)], activateOnTyping: true }),
          awlLinter(() => this.diagnostics),
          this.placeholderCompartment.of(placeholder(t('editor.label'))),
          keymap.of([
            { key: 'Mod-Enter', preventDefault: true, run: () => { this.emitLoad(); return true; } },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            this.scheduleSave();
            this.renderState();
          }),
        ],
      }),
    });

    this.retranslate();
  }

  // ── content ────────────────────────────────────────────────────────────────

  getSource(): string {
    return this.view.state.doc.toString();
  }

  setSource(source: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: source },
    });
    this.scheduleSave();
    this.renderState();
  }

  /** Mark the current buffer as the one running in the PLC (clears the dirty badge). */
  markLoaded(source: string): void {
    this.loadedSource = source;
    this.renderState();
  }

  isDirty(): boolean {
    return this.loadedSource === null || this.loadedSource !== this.getSource();
  }

  // ── diagnostics ────────────────────────────────────────────────────────────

  setDiagnostics(diagnostics: readonly Diagnostic[]): void {
    this.diagnostics = diagnostics;
    refreshLint(this.view);
  }

  /** Put the cursor on a diagnostic's position and scroll it into view. */
  focusLine(line: number, col = 1): void {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    const pos = Math.min(target.from + Math.max(col - 1, 0), target.to);
    this.view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    this.view.focus();
  }

  // ── localization ───────────────────────────────────────────────────────────

  retranslate(): void {
    this.titleNode.textContent = t('editor.title');
    this.loadButton.textContent = t('editor.load');
    this.loadButton.title = t('editor.loadTitle');
    this.clearButton.textContent = t('editor.clear');
    this.clearButton.title = t('editor.clearTitle');
    const count = completionSymbolCount(this.options.symbols);
    clear(this.symbolsNode);
    append(this.symbolsNode, count > 0 ? t('editor.symbols', { count }) : t('editor.symbolsNone'));
    this.view.dispatch({
      effects: this.placeholderCompartment.reconfigure(placeholder(t('editor.label'))),
    });
    this.renderState();
    refreshLint(this.view);
  }

  /**
   * Mirror the buffer to storage NOW, cancelling the pending debounced save.
   *
   * The debounce is 500 ms, and the experiment switcher reloads the page — which destroys the
   * timer instead of running it. Anything typed in that window would be gone, so the shell
   * flushes here before it reloads (and `dispose()` does the same on teardown).
   */
  flush(): void {
    this.flushSave();
  }

  dispose(): void {
    this.flushSave();
    this.view.destroy();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private emitLoad(): void {
    this.flushSave();
    this.options.onLoad(this.getSource());
  }

  private renderState(): void {
    const dirty = this.isDirty();
    this.stateNode.textContent = dirty ? t('editor.dirty') : t('editor.saved');
    this.stateNode.classList.toggle('is-dirty', dirty);
  }

  private scheduleSave(): void {
    this.buffer.schedule();
  }

  private flushSave(): void {
    this.buffer.flush();
  }
}
