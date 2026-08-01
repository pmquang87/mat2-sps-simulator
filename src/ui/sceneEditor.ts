/**
 * Scene-editor draft logic (docs/DESIGN_SCENE_EDITOR.md §14.3/§14.4): pure functions over
 * `TrackplanFile` — no DOM, no scene, no persistence. The panel and main.ts are thin
 * shells around these.
 *
 * Design decisions carried here:
 *  - A flip is a TOGGLE: `flipCoilToBranch` applied twice returns a plan deep-equal to the
 *    original (the evidence marker is added on flip and removed on flip-back), so the
 *    editor never accumulates state it cannot undo and the identity control in the tests
 *    is exact.
 *  - The patch is a full, drop-in `trackplan.json` replacement. The editor NEVER writes
 *    into src/ — the file travels through the owner's hands and lands as a reviewed diff.
 *  - The note is a generated technical document (English, like `mappingEvidence` itself —
 *    plant data, not UI prose): per flipped switch it states which pinned oracle
 *    expectation entries would move, from the generated `src/data/oracleSwitchIndex.json`
 *    (pinned against the real expectation tables by tests/data/oracleSwitchIndex.test.ts).
 */
import type { SwitchSpec, TrackplanFile } from '../plant';

/** Appended to `mappingEvidence` on flip; removed again on flip-back. */
export const FLIP_EVIDENCE_MARKER =
  ' [G/R flipped in the scene editor - settle mappingSource/evidence and move the oracle expectations in the same commit]';

/** Per-switch references mirrored from the oracle expectation tables. */
export interface OracleSwitchRefs {
  trailed?: { count: number };
  pulses?: readonly { afterReed: string; closure: number; coil: string }[];
}

export interface OracleSwitchIndexFile {
  version: number;
  generatedFrom: string;
  switches: Record<string, { gruppeA?: OracleSwitchRefs; gruppeB?: OracleSwitchRefs }>;
}

export function findSwitch(plan: TrackplanFile, switchId: string): SwitchSpec | null {
  return plan.switches.find((s) => s.id === switchId) ?? null;
}

/** A switch the editor can flip: placed and commandable (the `(xW)` stump is not). */
export function isFlippable(spec: SwitchSpec | null): spec is SwitchSpec & { coilToBranch: NonNullable<SwitchSpec['coilToBranch']> } {
  return spec !== null && spec.coilToBranch !== null;
}

/**
 * Returns a NEW plan with the switch's G/R→branch mapping swapped; the input is never
 * mutated. Throws on an unknown or non-commandable switch — the callers gate on
 * `isFlippable`, so reaching the throw is a bug, not a user path.
 */
export function flipCoilToBranch(plan: TrackplanFile, switchId: string): TrackplanFile {
  const spec = findSwitch(plan, switchId);
  if (spec === null) throw new Error(`unknown switch: ${switchId}`);
  const mapping = spec.coilToBranch;
  if (mapping === null) throw new Error(`switch ${switchId} has no coils (fixed switch)`);

  const next = structuredClone(plan);
  const target = next.switches.find((s) => s.id === switchId);
  if (target === undefined || target.coilToBranch === null) {
    throw new Error(`clone lost switch ${switchId}`);       // structurally impossible
  }
  target.coilToBranch = { G: mapping.R, R: mapping.G };

  const evidence = target.mappingEvidence ?? '';
  if (evidence.endsWith(FLIP_EVIDENCE_MARKER)) {
    // Flip-back: restore the original evidence text. An empty rest means the field was
    // absent before the flip (no real entry carries an empty evidence STRING), so drop it —
    // that keeps flip∘flip deep-equal to the input.
    const restored = evidence.slice(0, evidence.length - FLIP_EVIDENCE_MARKER.length);
    if (restored === '') delete target.mappingEvidence;
    else target.mappingEvidence = restored;
  } else {
    target.mappingEvidence = evidence + FLIP_EVIDENCE_MARKER;
  }
  return next;
}

/** The draft plan after toggling every id in `flippedIds` (applied in sorted order). */
export function applyFlips(plan: TrackplanFile, flippedIds: ReadonlySet<string>): TrackplanFile {
  let draft = plan;
  for (const id of [...flippedIds].sort()) draft = flipCoilToBranch(draft, id);
  return draft;
}

/** Drop-in serialization of a (patched) trackplan — the src/data/trackplan.json format. */
export function serializeTrackplan(plan: TrackplanFile): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function describeGroup(refs: OracleSwitchRefs | undefined, group: string): string[] {
  if (refs === undefined) return [`- ${group}: not referenced.`];
  const lines: string[] = [];
  if (refs.trailed !== undefined) {
    lines.push(
      `- ${group}: trailedSwitches entry { count: ${refs.trailed.count} } WOULD MOVE - ` +
        'whether a pass trails depends on blade vs entry branch, which the flip inverts.',
    );
  }
  for (const pulse of refs.pulses ?? []) {
    lines.push(
      `- ${group}: commanded after ${pulse.afterReed} closure ${pulse.closure} (coil ${pulse.coil}) - ` +
        'the command itself stays (the program is unchanged), but the pulse now throws the OTHER branch.',
    );
  }
  if (lines.length === 0) return [`- ${group}: not referenced.`];
  return lines;
}

/**
 * The written note of which pinned expectation entries a set of flips would move
 * (§14.4 double-edit discipline). One section per flipped switch, sorted.
 */
export function buildFlipNote(
  plan: TrackplanFile,
  index: OracleSwitchIndexFile,
  flippedIds: ReadonlySet<string>,
): string {
  const lines: string[] = [
    '# G/R mapping flips - expectation impact note',
    '',
    'Generated by the scene editor (docs/DESIGN_SCENE_EDITOR.md 14.4). The oracle',
    'expectation tables (tests/oracle/expectations/gruppeA.json, gruppeB.json) are pinned',
    'ground truth: trackplan.json and the tables move together, in ONE reviewed commit,',
    "and regenerating a table needs the owner's sign-off per fix.",
  ];
  for (const id of [...flippedIds].sort()) {
    const spec = findSwitch(plan, id);
    lines.push('', `## ${id}`);
    if (spec === null) {
      lines.push('- UNKNOWN switch id - not in trackplan.json; nothing to report.');
      continue;
    }
    lines.push(`- mappingSource: ${spec.mappingSource}`);
    const mapping = spec.coilToBranch;
    if (mapping !== null) {
      const g = spec.branchEdgeIds[mapping.G];
      const r = spec.branchEdgeIds[mapping.R];
      lines.push(`- mapping: G -> ${g}, R -> ${r}; patched: G -> ${r}, R -> ${g}`);
    }
    if (spec.mappingSource === 'derived') {
      lines.push(
        '- WARNING: this mapping is DERIVED from route evidence (see mappingEvidence in',
        '  trackplan.json). Flipping it contradicts that evidence - the replayed oracle run',
        '  diverges after the first faced traversal. Almost always a data bug, not a fix.',
      );
    }
    const refs = index.switches[id];
    if (refs === undefined) {
      lines.push(
        '- Not referenced by either expectation table: the flip is ORACLE-INVISIBLE',
        '  (exactly why it is a coin flip). Only trackplan.json moves; no expectation',
        '  entry constrains this switch.',
      );
      continue;
    }
    lines.push(...describeGroup(refs.gruppeA, 'Gruppe A'));
    lines.push(...describeGroup(refs.gruppeB, 'Gruppe B'));
  }
  return `${lines.join('\n')}\n`;
}
