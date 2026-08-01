/**
 * SceneEditorPanel (docs/DESIGN_SCENE_EDITOR.md §14.3) — the owner-facing overlay for the
 * scene editor's first increment: inspect a picked switch, toggle its G/R mapping in an
 * in-memory draft, download the patched trackplan.json and the expectation-impact note.
 *
 * Deliberately dumb: every decision (what a flip means, what the note says, what the patch
 * contains) lives in the pure logic of ../sceneEditor.ts; downloads happen through an
 * INJECTED callback so main.ts supplies the Blob mechanics and tests intercept the exact
 * payloads. The panel never touches src/data and never mutates the live plant.
 *
 * Mounted by main.ts ONLY when the `?editor=1` flag is set — App knows nothing about it,
 * which is the strongest form of "flag off = the shipped shell is untouched".
 */
import type { TrackplanFile } from '../../plant';
import { clear, el } from '../dom';
import { onLocaleChange, t } from '../i18n/i18n';
import {
  applyFlips,
  buildFlipNote,
  findSwitch,
  isFlippable,
  serializeTrackplan,
  type OracleSwitchIndexFile,
} from '../sceneEditor';

export interface SceneEditorPanelOptions {
  trackplan: TrackplanFile;
  oracleIndex: OracleSwitchIndexFile;
  /** Receives the picked/cleared switch id — main.ts mirrors it as the scene glow. */
  onSelectionHighlight?: (id: string | null) => void;
  /** Download mechanics (Blob + anchor in the browser; a spy in tests). */
  download: (filename: string, text: string) => void;
}

export class SceneEditorPanel {
  readonly element: HTMLElement;

  private readonly options: SceneEditorPanelOptions;
  private readonly titleNode: HTMLElement;
  private readonly hintNode: HTMLElement;
  private readonly infoNode: HTMLElement;
  private readonly flipButton: HTMLButtonElement;
  private readonly flippedNode: HTMLElement;
  private readonly downloadPlanButton: HTMLButtonElement;
  private readonly downloadNoteButton: HTMLButtonElement;
  private readonly unsubscribeLocale: () => void;

  private selected: string | null = null;
  private readonly flipped = new Set<string>();

  constructor(options: SceneEditorPanelOptions) {
    this.options = options;
    this.titleNode = el('h2', { className: 'panel-title' });
    this.hintNode = el('p', { className: 'panel-note' });
    this.infoNode = el('div', { className: 'scene-editor-info' });
    this.flipButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () => this.flipSelected(),
    });
    this.flippedNode = el('p', { className: 'scene-editor-flips' });
    this.downloadPlanButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () => this.options.download('trackplan.json', serializeTrackplan(this.draft())),
    });
    this.downloadNoteButton = el('button', {
      className: 'btn',
      attrs: { type: 'button' },
      onClick: () =>
        this.options.download(
          'trackplan-flip-note.md',
          buildFlipNote(this.options.trackplan, this.options.oracleIndex, this.flipped),
        ),
    });

    this.element = el('section', {
      className: 'scene-editor-overlay',
      children: [
        this.titleNode,
        this.hintNode,
        this.infoNode,
        el('div', { className: 'scene-editor-actions', children: [this.flipButton] }),
        this.flippedNode,
        el('div', {
          className: 'scene-editor-actions',
          children: [this.downloadPlanButton, this.downloadNoteButton],
        }),
      ],
    });
    this.unsubscribeLocale = onLocaleChange(() => this.render());
    this.render();
  }

  dispose(): void {
    this.unsubscribeLocale();
    this.element.remove();
  }

  /** Canvas pick result (null = clicked empty scenery). Unknown ids clear the selection. */
  selectSwitch(id: string | null): void {
    this.selected = id !== null && findSwitch(this.options.trackplan, id) !== null ? id : null;
    this.options.onSelectionHighlight?.(this.selected);
    this.render();
  }

  /** The draft plan with all recorded flips applied — what the download serializes. */
  private draft(): TrackplanFile {
    return applyFlips(this.options.trackplan, this.flipped);
  }

  private flipSelected(): void {
    const spec = this.selected === null ? null : findSwitch(this.options.trackplan, this.selected);
    if (!isFlippable(spec)) return;
    if (this.flipped.has(spec.id)) this.flipped.delete(spec.id);
    else this.flipped.add(spec.id);
    this.render();
  }

  private render(): void {
    this.titleNode.textContent = t('editor3d.title');
    this.hintNode.textContent = t('editor3d.hint');
    this.flipButton.textContent = t('editor3d.flip');
    this.flipButton.title = t('editor3d.flipTitle');
    this.downloadPlanButton.textContent = t('editor3d.downloadPlan');
    this.downloadPlanButton.title = t('editor3d.downloadPlanTitle');
    this.downloadNoteButton.textContent = t('editor3d.downloadNote');
    this.downloadNoteButton.title = t('editor3d.downloadNoteTitle');

    const spec = this.selected === null ? null : findSwitch(this.options.trackplan, this.selected);
    clear(this.infoNode);
    if (spec === null) {
      this.infoNode.appendChild(el('p', { className: 'panel-note', text: t('editor3d.none') }));
    } else {
      // The draft mapping (post-flip when recorded), so the panel shows what the PATCH says.
      const draftSpec = findSwitch(this.draft(), spec.id) ?? spec;
      this.infoNode.appendChild(el('p', { className: 'scene-editor-id', text: spec.id }));
      this.infoNode.appendChild(
        el('p', { text: t('editor3d.source', { source: spec.mappingSource }) }),
      );
      const mapping = draftSpec.coilToBranch;
      if (mapping === null) {
        this.infoNode.appendChild(el('p', { text: t('editor3d.fixed') }));
      } else {
        this.infoNode.appendChild(
          el('p', {
            text: t('editor3d.mapping', {
              g: draftSpec.branchEdgeIds[mapping.G],
              r: draftSpec.branchEdgeIds[mapping.R],
            }),
          }),
        );
      }
      if (spec.mappingEvidence !== undefined) {
        // Plant data, shown verbatim like the switch tooltips do — not UI prose.
        this.infoNode.appendChild(
          el('p', { className: 'scene-editor-evidence', text: spec.mappingEvidence }),
        );
      }
    }

    this.flipButton.disabled = !isFlippable(spec);
    const flips = [...this.flipped].sort();
    this.flippedNode.textContent =
      flips.length === 0 ? t('editor3d.noFlips') : t('editor3d.flipped', { list: flips.join(', ') });
    this.downloadPlanButton.disabled = flips.length === 0;
    this.downloadNoteButton.disabled = flips.length === 0;
  }
}
