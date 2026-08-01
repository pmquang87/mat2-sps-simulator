/**
 * tests/data/stationLanes.test.ts — which STATION TRACK each Aufgabenstellung route occupies.
 *
 * This is the property an owner reads off the 3D board ("the train is on Gleis 2"), and the
 * only §8 `coilToBranch` error class that is both invisible to the existing suites and
 * user-visible: `tests/data/trackplan.test.ts` proves both route scripts REPLAY (every leg
 * reaches its trigger reed) and the oracle proves the reed/speed SEQUENCE — but a route that
 * runs through the wrong platform track still reaches the same trigger reeds downstream, so
 * neither notices. Reported 2026-08-01 as "at BH2 the train goes into G3 or G2?"; the answer
 * is pinned here instead of being re-derived by hand.
 *
 * Lane→edge comes from the reed naming convention (`xR02BH2G3` ⇒ station BH2, track G3),
 * the same rule `scene/landscape.ts#deriveStations` uses to place the platform and its label
 * plate — so these assertions bind the routing, the reed data and what the scene draws to one
 * another. The `y` ordering test pins that the lane NAMES follow the plan's north→south track
 * order (`reference/research/gleisplan.md` §2.2): without it a G2/G3 label swap in the reed data
 * would satisfy every route assertion below.
 *
 * Each route assertion carries a mutation control: the switch flip that would produce the
 * OTHER track must actually be observed to break it. An assertion that cannot fail is not
 * evidence (`reference/HANDOFF.md`, scene-review discipline).
 */
import { describe, expect, it } from 'vitest';
import type { TrackplanFile } from '../../src/plant';
import { ROUTE_A, ROUTE_B, walkRoute } from '../../tools/validate-trackplan';
import trackplanJson from '../../src/data/trackplan.json';

const plan = trackplanJson as unknown as TrackplanFile;

/**
 * The edge carrying a station track, derived from its reeds: the edge most of the
 * `xR..<station><lane>` reeds sit on. Approach edges carry at most one such reed (BH3 G2's
 * `xR01BH3G2` on `e9`, `xR05BH3G2` on `e68`), the platform edge carries the rest.
 */
function laneEdge(tp: TrackplanFile, station: string, lane: string): string {
  const tally = new Map<string, number>();
  for (const reed of tp.reeds) {
    if (!reed.id.toUpperCase().endsWith(`${station}${lane}`.toUpperCase())) continue;
    tally.set(reed.edgeId, (tally.get(reed.edgeId) ?? 0) + 1);
  }
  let best: { edgeId: string; n: number } | null = null;
  for (const [edgeId, n] of tally) if (best === null || n > best.n) best = { edgeId, n };
  if (best === null) throw new Error(`no reeds name station track ${station} ${lane}`);
  return best.edgeId;
}

/** Mean plan-space y of an edge's polyline (plan y grows southwards, gleisplan.md §1). */
function meanY(tp: TrackplanFile, edgeId: string): number {
  const edge = tp.edges.find((e) => e.id === edgeId);
  if (edge === undefined) throw new Error(`unknown edge ${edgeId}`);
  return edge.pts.reduce((sum, p) => sum + p.y, 0) / edge.pts.length;
}

/**
 * Follows the track out of `edgeId` at `nodeId` through PLAIN nodes only and reports whether
 * it dead-ends at a buffer stop. A siding may reach its buffer over a short connector chain
 * (BH3 G3 does: e74 → e73 → e86 → the buffer n77), so a one-edge look is not enough.
 */
function endsAtBuffer(tp: TrackplanFile, edgeId: string, nodeId: string, maxSteps = 6): boolean {
  const nodeById = new Map(tp.nodes.map((n) => [n.id, n]));
  let here = edgeId;
  let at = nodeId;
  for (let step = 0; step < maxSteps; step += 1) {
    const kind = nodeById.get(at)?.kind;
    if (kind === 'buffer') return true;
    if (kind !== 'plain') return false;                 // a switch: not a dead end
    const next = tp.edges.find((e) => e.id !== here && (e.from === at || e.to === at));
    if (next === undefined) return false;
    at = next.from === at ? next.to : next.from;
    here = next.id;
  }
  return false;
}

/** Deep clone with one switch's G/R→branch mapping swapped (mutation control input). */
function planWithFlip(switchId: string): TrackplanFile {
  const clone = JSON.parse(JSON.stringify(plan)) as TrackplanFile;
  const sw = clone.switches.find((s) => s.id === switchId);
  if (sw?.coilToBranch == null) throw new Error(`${switchId} is not a commandable switch`);
  const g = sw.coilToBranch.G;
  sw.coilToBranch.G = sw.coilToBranch.R;
  sw.coilToBranch.R = g;
  return clone;
}

interface LaneUse { errors: string[]; edges: Set<string> }

/** Edge ids the walk traverses, optionally restricted to one traction command. */
function occupied(tp: TrackplanFile, route: typeof ROUTE_A, command?: 'IU' | 'GU'): LaneUse {
  const walk = walkRoute(tp, route);
  return {
    errors: walk.errors,
    edges: new Set(
      walk.traversals
        .filter((t) => command === undefined || t.command === command)
        .map((t) => t.edgeId),
    ),
  };
}

/**
 * The shape a healthy run has: the script replays end to end, the route occupies `wanted`
 * and never touches `forbidden`. The mutation controls assert exactly its NEGATION, so a
 * control cannot pass by breaking the walk in some unrelated way while the lane stays right.
 */
function runsOn(
  tp: TrackplanFile,
  route: typeof ROUTE_A,
  wanted: string,
  forbidden: string,
  command?: 'IU' | 'GU',
): boolean {
  const use = occupied(tp, route, command);
  return use.errors.length === 0 && use.edges.has(wanted) && !use.edges.has(forbidden);
}

describe('station tracks are named in plan order (north → south)', () => {
  it('BH2 G1…G5 are five distinct edges, increasing in plan y', () => {
    const edges = ['G1', 'G2', 'G3', 'G4', 'G5'].map((lane) => laneEdge(plan, 'BH2', lane));
    expect(new Set(edges).size, `BH2 lane edges must be distinct: ${edges.join(',')}`).toBe(5);
    const ys = edges.map((e) => meanY(plan, e));
    expect(ys, `BH2 lane y: ${ys.join(', ')}`).toEqual([...ys].sort((a, b) => a - b));
    // the two the routes discriminate, pinned to the plan (gleisplan.md §2.2: 43,2 / 57,4)
    expect(meanY(plan, laneEdge(plan, 'BH2', 'G2'))).toBeCloseTo(43.2, 1);
    expect(meanY(plan, laneEdge(plan, 'BH2', 'G3'))).toBeCloseTo(57.4, 1);
  });

  it('BH3 G3 (the Abstellgleis) lies north of BH3 G2 and is a dead end', () => {
    const g3 = laneEdge(plan, 'BH3', 'G3');
    const g2 = laneEdge(plan, 'BH3', 'G2');
    expect(g3).not.toBe(g2);
    expect(meanY(plan, g3)).toBeLessThan(meanY(plan, g2));
    // the push-back end of the siding runs out through plain nodes into a buffer stop
    const edge = plan.edges.find((e) => e.id === g3);
    expect(edge, g3).toBeDefined();
    const ends = [edge?.from, edge?.to].filter((n): n is string => n !== undefined);
    expect(ends.some((n) => endsAtBuffer(plan, g3, n)), `${g3} must be a Stumpfgleis`).toBe(true);
  });
});

describe('§8 routes occupy the station tracks the Aufgabenstellung names', () => {
  const bh2G2 = laneEdge(plan, 'BH2', 'G2');
  const bh2G3 = laneEdge(plan, 'BH2', 'G3');
  const bh3G2 = laneEdge(plan, 'BH3', 'G2');
  const bh3G3 = laneEdge(plan, 'BH3', 'G3');

  it('Gruppe A passes BH2 on Gleis 3 (A-NW5 commands the two xW..BH2G3 drives)', () => {
    const use = occupied(plan, ROUTE_A);
    expect(use.errors).toEqual([]);
    expect(use.edges.has(bh2G3), `A must occupy BH2 G3 (${bh2G3})`).toBe(true);
    expect(use.edges.has(bh2G2), `A must NOT occupy BH2 G2 (${bh2G2})`).toBe(false);
  });

  it('Gruppe B passes BH2 on Gleis 2 (B-NW9 commands only xW..BH2G2 drives)', () => {
    const use = occupied(plan, ROUTE_B);
    expect(use.errors).toEqual([]);
    expect(use.edges.has(bh2G2), `B must occupy BH2 G2 (${bh2G2})`).toBe(true);
    expect(use.edges.has(bh2G3), `B must NOT occupy BH2 G3 (${bh2G3})`).toBe(false);
  });

  it('Gruppe A pushes BACKWARD onto BH3 Gleis 3, the Abstellgleis (A-NW8/NW9)', () => {
    const use = occupied(plan, ROUTE_A, 'GU');
    expect(use.errors).toEqual([]);
    expect(use.edges.has(bh3G3), `the GU legs must reach BH3 G3 (${bh3G3})`).toBe(true);
    expect(use.edges.has(bh3G2), `the GU legs must NOT run onto BH3 G2 (${bh3G2})`).toBe(false);
  });

  // Controls: the flip that would produce the OTHER track must destroy the pattern above.
  it.each([
    ['xW03BH2G2', 'A', ROUTE_A, bh2G3, bh2G2, undefined],
    ['xW03BH2G2', 'B', ROUTE_B, bh2G2, bh2G3, undefined],
    ['xW02BH3G2', 'A (push-back)', ROUTE_A, bh3G3, bh3G2, 'GU'],
  ] as const)(
    'mutation control: flipping %s breaks the Gruppe %s station-track assertion',
    (switchId, _who, route, wanted, forbidden, command) => {
      expect(runsOn(plan, route, wanted, forbidden, command), 'the shipped plan is the baseline')
        .toBe(true);
      expect(
        runsOn(planWithFlip(switchId), route, wanted, forbidden, command),
        `flipping ${switchId} must not still look like a healthy run on ${wanted}`,
      ).toBe(false);
    },
  );
});
