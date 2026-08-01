/**
 * Scene-editor draft logic (docs/DESIGN_SCENE_EDITOR.md §14.3/§14.4): the flip is a pure,
 * surgical toggle; the serialization is a drop-in trackplan.json; the note states exactly
 * which pinned oracle-expectation entries a flip would move. Controls per behaviour:
 * flip∘flip identity, everything-else-untouched deep-equal, zero-flip identity, and one
 * note assertion per constraint class (trailed / derived / oracle-invisible / unknown).
 */
import { describe, expect, it } from 'vitest';
import type { TrackplanFile } from '../../src/plant';
import {
  FLIP_EVIDENCE_MARKER,
  applyFlips,
  buildFlipNote,
  findSwitch,
  flipCoilToBranch,
  isFlippable,
  serializeTrackplan,
  type OracleSwitchIndexFile,
} from '../../src/ui/sceneEditor';
import trackplanJson from '../../src/data/trackplan.json';
import oracleIndexJson from '../../src/data/oracleSwitchIndex.json';
import { straightPlan } from '../scene/fixture';

const realPlan = trackplanJson as unknown as TrackplanFile;
const realIndex = oracleIndexJson as unknown as OracleSwitchIndexFile;

describe('flipCoilToBranch (§14.3)', () => {
  it('swaps G/R, appends the evidence marker, and leaves the input plan unmutated', () => {
    const plan = straightPlan();
    const before = structuredClone(plan);
    const flipped = flipCoilToBranch(plan, 'xW01TEST');

    expect(plan).toEqual(before);                             // input untouched
    const spec = findSwitch(flipped, 'xW01TEST');
    expect(spec?.coilToBranch).toEqual({ G: 1, R: 0 });       // was { G: 0, R: 1 }
    expect(spec?.mappingEvidence).toBe(FLIP_EVIDENCE_MARKER); // fixture had none
  });

  it('changes ONLY the flipped switch (surgical-diff control)', () => {
    const plan = straightPlan();
    const flipped = flipCoilToBranch(plan, 'xW01TEST');
    // Put the original switch entry back: the result must be deep-equal to the input.
    const restored = structuredClone(flipped);
    const original = findSwitch(plan, 'xW01TEST');
    restored.switches = restored.switches.map((s) =>
      s.id === 'xW01TEST' ? structuredClone(original as NonNullable<typeof original>) : s,
    );
    expect(restored).toEqual(plan);
  });

  it('is a toggle: flipping twice restores the plan byte-for-byte, evidence included', () => {
    const fixture = straightPlan();
    expect(flipCoilToBranch(flipCoilToBranch(fixture, 'xW01TEST'), 'xW01TEST')).toEqual(fixture);
    // Same property on the REAL plan, where xW04D carries recorded evidence text.
    expect(flipCoilToBranch(flipCoilToBranch(realPlan, 'xW04D'), 'xW04D')).toEqual(realPlan);
    // And the single flip really appends after the existing evidence.
    const once = findSwitch(flipCoilToBranch(realPlan, 'xW04D'), 'xW04D');
    const evidence = findSwitch(realPlan, 'xW04D')?.mappingEvidence ?? '';
    expect(once?.mappingEvidence).toBe(evidence + FLIP_EVIDENCE_MARKER);
    expect(evidence.length).toBeGreaterThan(0);               // the control controls something
  });

  it('rejects unknown ids and the non-commandable (xW) stump', () => {
    const plan = straightPlan();
    expect(() => flipCoilToBranch(plan, 'xW99NOPE')).toThrow(/unknown switch/);
    expect(() => flipCoilToBranch(plan, 'xW02TEST')).toThrow(/no coils/);
    expect(isFlippable(findSwitch(plan, 'xW01TEST'))).toBe(true);
    expect(isFlippable(findSwitch(plan, 'xW02TEST'))).toBe(false);
    expect(isFlippable(null)).toBe(false);
  });
});

describe('applyFlips + serializeTrackplan (§14.3)', () => {
  it('zero flips = identity, and the serialization round-trips the real plan', () => {
    expect(applyFlips(realPlan, new Set())).toEqual(realPlan);
    expect(JSON.parse(serializeTrackplan(realPlan))).toEqual(realPlan);
  });

  it('a recorded flip reaches the serialized patch (and only that switch moves)', () => {
    const patched = JSON.parse(
      serializeTrackplan(applyFlips(realPlan, new Set(['xW01E']))),
    ) as TrackplanFile;
    const original = findSwitch(realPlan, 'xW01E');
    const flipped = findSwitch(patched, 'xW01E');
    expect(original?.coilToBranch).toEqual({ G: 0, R: 1 });
    expect(flipped?.coilToBranch).toEqual({ G: 1, R: 0 });
    // Control: a switch that was not flipped is byte-identical.
    expect(findSwitch(patched, 'xW04D')).toEqual(findSwitch(realPlan, 'xW04D'));
  });
});

describe('buildFlipNote (§14.4 double-edit discipline)', () => {
  it('names the trailed-multiset entry that moves for xW04D', () => {
    const note = buildFlipNote(realPlan, realIndex, new Set(['xW04D']));
    expect(note).toContain('## xW04D');
    expect(note).toContain('trailedSwitches entry { count: 2 } WOULD MOVE');
    expect(note).toContain('Gruppe A: commanded after');      // its coil pulses are listed
    expect(note).toContain("owner's sign-off");
  });

  it('declares the coin-flips oracle-invisible', () => {
    const note = buildFlipNote(realPlan, realIndex, new Set(['xW01E']));
    expect(note).toContain('## xW01E');
    expect(note).toContain('ORACLE-INVISIBLE');
    expect(note).not.toContain('WOULD MOVE');                 // control: no phantom entries
  });

  it('warns loudly when a DERIVED mapping is flipped', () => {
    const note = buildFlipNote(realPlan, realIndex, new Set(['xW01BH1G1']));
    expect(note).toContain('WARNING');
    expect(note).toContain('DERIVED');
  });

  it('controls: empty set yields no sections, unknown ids are called out', () => {
    expect(buildFlipNote(realPlan, realIndex, new Set())).not.toContain('## ');
    expect(buildFlipNote(realPlan, realIndex, new Set(['xW99NOPE']))).toContain(
      'UNKNOWN switch id',
    );
  });
});
