/**
 * Generator for `src/data/oracleSwitchIndex.json` — the per-switch view of the oracle
 * expectation tables (`tests/oracle/expectations/gruppe{A,B}.json`) that the scene editor
 * needs at RUNTIME to say which pinned entries a coilToBranch flip would move
 * (docs/DESIGN_SCENE_EDITOR.md §14.4).
 *
 * Why a generated copy instead of importing the tables: `src/` must not import `tests/`
 * (the boundary runs the other way), and bundling the full event tables for two lines of
 * per-switch summary would be waste. The duplication is PINNED, never silent:
 * `tests/data/oracleSwitchIndex.test.ts` rebuilds the index from the real expectation
 * files through this very builder and fails on any drift, with a mutation control.
 *
 * Regenerate: `node tools/gen-oracle-switch-index.ts` (Node ≥ 23.6 strips the erasable
 * type syntax natively; this file deliberately uses nothing beyond it).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The slice of an expectation table this builder reads (structural — extra fields pass). */
export interface ExpectationTable {
  trailedSwitches?: { switchId: string; count: number }[];
  pulseGroups?: {
    afterReed: string;
    closure: number;
    pulses: { switchId: string; coil: string }[];
  }[];
}

export interface OracleSwitchRefs {
  /** The exact-multiset pin: this many trailing passes of the switch are expected. */
  trailed?: { count: number };
  /** Commanded coil pulses referencing the switch (afterReed + n-th closure + coil). */
  pulses?: { afterReed: string; closure: number; coil: string }[];
}

export interface OracleSwitchIndexFile {
  version: number;
  generatedFrom: string;
  switches: Record<string, { gruppeA?: OracleSwitchRefs; gruppeB?: OracleSwitchRefs }>;
}

const GROUPS = ['gruppeA', 'gruppeB'] as const;

export function buildOracleSwitchIndex(
  tables: Record<(typeof GROUPS)[number], ExpectationTable>,
): OracleSwitchIndexFile {
  const perSwitch = new Map<string, { gruppeA?: OracleSwitchRefs; gruppeB?: OracleSwitchRefs }>();
  const refsFor = (switchId: string, group: (typeof GROUPS)[number]): OracleSwitchRefs => {
    const entry = perSwitch.get(switchId) ?? {};
    const refs = entry[group] ?? {};
    entry[group] = refs;
    perSwitch.set(switchId, entry);
    return refs;
  };

  for (const group of GROUPS) {
    const table = tables[group];
    for (const trailed of table.trailedSwitches ?? []) {
      refsFor(trailed.switchId, group).trailed = { count: trailed.count };
    }
    for (const pg of table.pulseGroups ?? []) {
      for (const pulse of pg.pulses) {
        const refs = refsFor(pulse.switchId, group);
        (refs.pulses ??= []).push({
          afterReed: pg.afterReed,
          closure: pg.closure,
          coil: pulse.coil,
        });
      }
    }
  }

  // Deterministic output: switch ids sorted; pulse order stays file order (meaningful).
  const switches: OracleSwitchIndexFile['switches'] = {};
  for (const id of [...perSwitch.keys()].sort()) {
    const entry = perSwitch.get(id);
    if (entry !== undefined) switches[id] = entry;
  }
  return { version: 1, generatedFrom: 'tests/oracle/expectations', switches };
}

/** CLI entry: rebuild the committed index in place. */
function main(): void {
  const root = new URL('..', import.meta.url);
  const read = (rel: string): ExpectationTable =>
    JSON.parse(readFileSync(fileURLToPath(new URL(rel, root)), 'utf8')) as ExpectationTable;
  const index = buildOracleSwitchIndex({
    gruppeA: read('tests/oracle/expectations/gruppeA.json'),
    gruppeB: read('tests/oracle/expectations/gruppeB.json'),
  });
  const target = fileURLToPath(new URL('src/data/oracleSwitchIndex.json', root));
  writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`gen-oracle-switch-index: wrote ${Object.keys(index.switches).length} switches to ${target}`);
}

// Run only as a CLI, not when the test suite imports the builder.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
