/**
 * Scene-editor activation flag (docs/DESIGN_SCENE_EDITOR.md §14.2).
 *
 * The editor is an OWNER instrument, so activation is a URL query only — `?editor=1` —
 * never a UI control and never persisted state:
 *  - it works on the shipped `dist/index.html` without a rebuild (browsers pass query
 *    strings on `file://` URLs),
 *  - students cannot stumble into it by clicking around,
 *  - unlike a localStorage flag it cannot leak into a later session; closing the tab
 *    ends editor mode.
 *
 * Pure function of the query string so the both-direction contract is testable without a
 * browser (tests/ui/editorFlag.test.ts).
 */
export function readEditorFlag(search: string): boolean {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return params.get('editor') === '1';
  } catch {
    return false;
  }
}
