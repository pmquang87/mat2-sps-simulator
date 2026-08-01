/**
 * Scene-editor activation flag (docs/DESIGN_SCENE_EDITOR.md §14.2): `?editor=1` and
 * NOTHING else turns the owner tool on. Both directions pinned — the off-control matters
 * as much as the on-case, because a flag that misreads garbage as "on" would put a
 * plant-mutating tool in front of students.
 */
import { describe, expect, it } from 'vitest';
import { readEditorFlag } from '../../src/ui/editorFlag';

describe('readEditorFlag (§14.2)', () => {
  it('turns on for ?editor=1, with or without other params', () => {
    expect(readEditorFlag('?editor=1')).toBe(true);
    expect(readEditorFlag('editor=1')).toBe(true);
    expect(readEditorFlag('?foo=bar&editor=1')).toBe(true);
  });

  it('stays off for everything else (control)', () => {
    expect(readEditorFlag('')).toBe(false);
    expect(readEditorFlag('?')).toBe(false);
    expect(readEditorFlag('?editor=0')).toBe(false);
    expect(readEditorFlag('?editor')).toBe(false);         // present but valueless
    expect(readEditorFlag('?editor=true')).toBe(false);    // only the documented '1'
    expect(readEditorFlag('?Editor=1')).toBe(false);       // query keys are case-sensitive
    expect(readEditorFlag('?editorx=1')).toBe(false);
    expect(readEditorFlag('?foo=editor%3D1')).toBe(false); // encoded inside another value
  });
});
