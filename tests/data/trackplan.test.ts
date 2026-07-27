/**
 * tests/data/trackplan.test.ts — schema validity, graph consistency, wired-reed set,
 * coil-mapping provenance, and the §8 route re-walk (ARCHITECTURE.md §7.1, §8, §9.3).
 *
 * The re-walk replays BOTH Aufgabenstellung route scripts (public task files) through the
 * mapped graph: every leg must reach its trigger reed, and no edge may be traversed in
 * opposite directions under the same traction command across the A and B walks (the
 * See-Kehre consistency proof).
 */
import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../../src/plant';
import type { TrackplanFile } from '../../src/plant';
import {
  ROUTE_A,
  ROUTE_B,
  directionConflicts,
  initialLapClosed,
  validateTrackplan,
  walkRoute,
} from '../../tools/validate-trackplan';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';

const plan = trackplanJson as unknown as TrackplanFile;
const unplaced = (trackplanJson as unknown as { unplacedSwitches: Array<{ id: string; note: string }> })
  .unplacedSwitches;

const symbols = new Set(variablesJson.entries.map((e) => e.symbol));

describe('trackplan.json schema & graph consistency', () => {
  it('passes the standalone structural validator (incl. variables cross-check)', () => {
    expect(validateTrackplan(plan, variablesJson)).toEqual([]);
  });

  it('is accepted by the real consumer (plant TrackGraph constructor)', () => {
    expect(() => new TrackGraph(plan)).not.toThrow();
  });

  it('meta carries the binding 300 ms switch actuation and plausible physics', () => {
    expect(plan.meta.units).toBe('gleisplanPt');
    expect(plan.meta.switchActuationMs).toBe(300);
    expect(plan.meta.mmPerUnit).toBeGreaterThan(0);
    expect(plan.meta.speedsMmS['1']).toBeLessThan(plan.meta.speedsMmS['2']);
    expect(plan.meta.speedsMmS['2']).toBeLessThan(plan.meta.speedsMmS['3']);
  });

  it('starts on BH1 Gleis 1 heading west (IU)', () => {
    expect(plan.start.edgeId).toBe('e23');
    expect(plan.start.direction).toBe(1);
  });

  it('landscape references only existing edges', () => {
    // `landscape.tunnels` is empty by owner decision (docs/REVIEW_SCENE.md D11): the portal sat
    // where e68 runs 45 mm from the open e49, so that neighbour's rock cutting left knife-thin
    // blades beside the mouth, and the reed on e68 capped how far the hill could move. The
    // tunnel and its hill were removed rather than shipped looking broken. The schema still
    // accepts tunnels — anything listed must name a real edge — and the scene machinery stays
    // covered by `straightPlan` in tests/scene/fixture.ts.
    const edgeIds = new Set(plan.edges.map((e) => e.id));
    const tunnelEdges = plan.landscape.tunnels.flatMap((t) => t.edgeIds);
    for (const id of tunnelEdges) expect(edgeIds.has(id), id).toBe(true);
    expect(plan.edges.some((e) => e.tunnel === true), 'no per-edge tunnel flag may survive, or tunnelEdgeIds() would fall back to it').toBe(false);
    expect(plan.landscape.lake).toBeDefined();
    expect(plan.landscape.mountains.length).toBeGreaterThan(0);
    expect(plan.landscape.buildings.some((b) => b.kind === 'lokschuppen')).toBe(true);
  });
});

describe('reeds: 45 plan positions, 23 wired', () => {
  it('wired reeds are exactly the documented Variablenliste inputs', () => {
    const wired = plan.reeds.filter((r) => r.wired).map((r) => r.id).sort();
    const documented = variablesJson.entries
      .filter((e) => e.symbol.startsWith('xR'))
      .map((e) => e.symbol)
      .sort();
    expect(wired).toEqual(documented);
    expect(wired).toHaveLength(23);
  });

  it('carries the 22 unwired plan positions as decoration', () => {
    expect(plan.reeds).toHaveLength(45);
    const unwired = plan.reeds.filter((r) => !r.wired);
    expect(unwired).toHaveLength(22);
    for (const r of unwired) expect(symbols.has(r.id), `${r.id} must NOT be a PLC input`).toBe(false);
    // the PDF's duplicated "xR02BH2G1" label on the BH3 stump is stored under the
    // corrected id (gleisplan.md §9.1)
    expect(unwired.some((r) => r.id === 'xR02BH3G1')).toBe(true);
  });

  it('only xR01D bounces (the A-NW8 Entprellen reed)', () => {
    const bouncing = plan.reeds.filter((r) => r.bounce === true).map((r) => r.id);
    expect(bouncing).toEqual(['xR01D']);
  });
});

describe('switches: 35 commandable + the unlabeled "(xW)" + 7 unplaced', () => {
  const mapped = plan.switches.filter((s) => s.coilToBranch !== null);
  const nullMapped = plan.switches.filter((s) => s.coilToBranch === null);

  it('has 36 placed switches, exactly one non-commandable "(xW)"', () => {
    expect(plan.switches).toHaveLength(36);
    expect(mapped).toHaveLength(35);
    expect(nullMapped.map((s) => s.id)).toEqual(['(xW)']);
    expect(nullMapped[0]!.mappingSource).toBe('assumed');
  });

  it('every commandable switch has both coil symbols in variables.json (case traps included)', () => {
    for (const sw of mapped) {
      for (const coil of ['G', 'R'] as const) {
        const plain = `${sw.id}${coil}`;
        const trap = `X${sw.id.slice(1)}${coil}`;
        expect(
          symbols.has(plain) || symbols.has(trap),
          `coil symbol for ${sw.id} ${coil}`,
        ).toBe(true);
      }
    }
    // the two documented uppercase traps map onto placed switches xW03C / xW05BH1G3
    expect(symbols.has('XW03CR')).toBe(true);
    expect(mapped.some((s) => s.id === 'xW03C')).toBe(true);
    expect(symbols.has('XW05BH1G3R')).toBe(true);
    expect(mapped.some((s) => s.id === 'xW05BH1G3')).toBe(true);
  });

  it('G and R always map to different branches', () => {
    for (const sw of mapped) {
      expect(sw.coilToBranch!.G, sw.id).not.toBe(sw.coilToBranch!.R);
    }
  });

  it('mapping provenance: 29 derived (with evidence), 6 assumed', () => {
    const derived = mapped.filter((s) => s.mappingSource === 'derived');
    const assumed = mapped.filter((s) => s.mappingSource === 'assumed');
    expect(derived).toHaveLength(29);
    expect(assumed.map((s) => s.id).sort()).toEqual(
      ['xW01BH2G1', 'xW01BH2G4', 'xW01E', 'xW02E', 'xW03E', 'xW04D'].sort(),
    );
    for (const sw of plan.switches) {
      expect(sw.mappingEvidence, `evidence for ${sw.id}`).toBeTruthy();
    }
    // §8 default for assumed switches: G = branch 0
    for (const sw of assumed) {
      expect(sw.coilToBranch!.G, `${sw.id} assumed default`).toBe(0);
    }
  });

  it('the 7 Variablenliste switches without a plan position are listed unplaced (W1)', () => {
    expect(unplaced.map((u) => u.id).sort()).toEqual(
      ['xW01BH1G3', 'xW01BH1G4', 'xW01BH3G2', 'xW01C', 'xW04BH1G3', 'xW04BH1G4', 'xW04BH3G2'].sort(),
    );
    const placedIds = new Set(mapped.map((s) => s.id));
    for (const u of unplaced) {
      expect(placedIds.has(u.id), `${u.id} must not also be placed`).toBe(false);
      expect(symbols.has(`${u.id}G`), `${u.id}G exists in Variablenliste`).toBe(true);
      expect(u.note).toBeTruthy();
    }
    // placed commandable + unplaced = the 42 Variablenliste pairs
    expect(mapped.length + unplaced.length).toBe(42);
  });
});

describe('§8 route re-walk (both Aufgabenstellung scripts)', () => {
  const walkA = walkRoute(plan, ROUTE_A);
  const walkB = walkRoute(plan, ROUTE_B);

  it('route A replays end to end (2 laps, Rangierfahrt in lap 1 only)', () => {
    expect(walkA.errors).toEqual([]);
    expect(walkA.ok).toBe(true);
    expect(walkA.log).toHaveLength(ROUTE_A.legs.length);
  });

  it('route B replays end to end (See-Kehre, BH3, final stop on Gleis 4)', () => {
    expect(walkB.errors).toEqual([]);
    expect(walkB.ok).toBe(true);
    expect(walkB.log).toHaveLength(ROUTE_B.legs.length);
  });

  it('trailing warnings are exactly the documented xW04D/xW01D cases (A-NW7, both laps)', () => {
    expect(walkB.trailingWarnings).toEqual([]);
    expect(walkA.trailingWarnings).toHaveLength(4);
    for (const w of walkA.trailingWarnings) {
      expect(w).toMatch(/trailing (xW04D|xW01D) /);
    }
  });

  it('See-Kehre consistency: no edge traversed in both directions under the same command', () => {
    expect(directionConflicts([walkA, walkB])).toEqual([]);
  });

  it('initial positions close the outer mainline circuit (program-less laps, §8)', () => {
    const lap = initialLapClosed(plan);
    expect(lap.ok).toBe(true);
    // the lap must actually go out and come home on Gleis 1
    expect(lap.edges[0]).toBe('e23');
    expect(lap.edges[lap.edges.length - 1]).toBe('e23');
    expect(lap.edges.length).toBeGreaterThan(10);
  });
});
