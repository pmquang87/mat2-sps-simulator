/**
 * Pin for the generated `src/data/oracleSwitchIndex.json` (docs/DESIGN_SCENE_EDITOR.md
 * §14.4): the scene editor's runtime view of the oracle expectation tables is a COPY
 * (src/ must not import tests/), and a copy is only tolerable when a gate fails on drift.
 * This suite rebuilds the index from the real expectation files through the same builder
 * the generator CLI uses and requires deep equality — plus a mutation control so the
 * comparison itself is proven to bite, and two shape pins that the editor's note logic
 * depends on (xW04D is trailed-pinned; the coin-flips are absent = oracle-invisible).
 */
import { describe, expect, it } from 'vitest';
import {
  buildOracleSwitchIndex,
  type ExpectationTable,
} from '../../tools/gen-oracle-switch-index';
import committed from '../../src/data/oracleSwitchIndex.json';
import gruppeA from '../oracle/expectations/gruppeA.json';
import gruppeB from '../oracle/expectations/gruppeB.json';

function rebuild(): ReturnType<typeof buildOracleSwitchIndex> {
  return buildOracleSwitchIndex({
    gruppeA: gruppeA as ExpectationTable,
    gruppeB: gruppeB as ExpectationTable,
  });
}

describe('oracleSwitchIndex.json stays in lockstep with the expectation tables', () => {
  it('the committed index equals a fresh rebuild (drift gate)', () => {
    // JSON round-trip normalizes the rebuild exactly like the generator's file write.
    expect(committed).toEqual(JSON.parse(JSON.stringify(rebuild())));
  });

  it('mutation control: a tampered count is detected', () => {
    const tampered = JSON.parse(JSON.stringify(rebuild())) as typeof committed & {
      switches: Record<string, { gruppeA?: { trailed?: { count: number } } }>;
    };
    const xw04d = tampered.switches['xW04D']?.gruppeA?.trailed;
    expect(xw04d).toBeDefined();
    if (xw04d !== undefined) xw04d.count += 1;
    expect(committed).not.toEqual(tampered);
  });

  it('shape pins the editor note relies on', () => {
    const index = committed as {
      switches: Record<string, { gruppeA?: { trailed?: { count: number } } }>;
    };
    // xW04D: the trailed-only switch whose multiset entry a flip would move (§14.4).
    expect(index.switches['xW04D']?.gruppeA?.trailed).toEqual({ count: 2 });
    // The five coin-flips are referenced by NEITHER table — that absence is the
    // "oracle-invisible" statement in the flip note, so it is pinned here.
    for (const id of ['xW01BH2G1', 'xW01BH2G4', 'xW01E', 'xW02E', 'xW03E']) {
      expect(index.switches[id], `${id} must stay unreferenced`).toBeUndefined();
    }
  });
});
