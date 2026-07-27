/**
 * §9.2 trackgraph.test.ts: next-edge resolution at plain/switch/buffer nodes for both
 * directions; switch toe vs branch entry; construction validation.
 */
import { describe, expect, it } from 'vitest';
import { TrackGraph } from '../../src/plant';
import type { SwitchPosition } from '../../src/plant';
import { miniPlan, opposedPlan } from './fixtures/miniplan';

const at = (p: SwitchPosition) => () => p;

describe('TrackGraph construction + lookups', () => {
  it('builds from a valid plan and exposes lookups', () => {
    const g = new TrackGraph(miniPlan());
    expect(g.edgeLengthMm('eB')).toBeCloseTo(1000, 9);
    expect(g.edgeLengthMm('eD')).toBeCloseTo(900, 9);
    expect(g.edgesAtNode('nSw')).toEqual(['eB', 'eC', 'eD']);
    expect(g.switchAtNode('nSw')?.id).toBe('xW01T');
    expect(g.switchById('xW01T')?.toeEdgeId).toBe('eB');
    expect(g.switches.map((s) => s.id)).toEqual(['xW01T']);
    expect(g.reeds.map((r) => r.id)).toEqual(['xR01T', 'xR02T', 'xR03T']);
    expect(g.start).toEqual({ edgeId: 'eB', offsetMm: 100, direction: 1 });
  });

  it('passes the tunnel flag through', () => {
    const g = new TrackGraph(miniPlan());
    expect(g.edge('eD').tunnel).toBe(true);
    expect(g.edge('eC').tunnel).toBeUndefined();
  });

  it('rejects an edge referencing an unknown node', () => {
    const plan = miniPlan();
    (plan.edges[0] as { from: string }).from = 'nope';
    expect(() => new TrackGraph(plan)).toThrow(/unknown node "nope"/);
  });

  it('rejects wrong node arity (switch node without 3 incident edges)', () => {
    const plan = miniPlan();
    plan.edges = plan.edges.filter((e) => e.id !== 'eD');
    plan.reeds = plan.reeds.filter((r) => r.edgeId !== 'eD');
    plan.landscape.tunnels = [];
    expect(() => new TrackGraph(plan)).toThrow(/switch node "nSw" has 2 incident edges/);
  });

  it('rejects a plain node used as a dead end', () => {
    const plan = opposedPlan();
    plan.edges = plan.edges.filter((e) => e.id !== 'e2');
    expect(() => new TrackGraph(plan)).toThrow(/plain node "n2" has 1 incident edges/);
  });

  it('rejects duplicate ids', () => {
    const plan = miniPlan();
    plan.edges.push({ ...plan.edges[1]! });
    expect(() => new TrackGraph(plan)).toThrow(/duplicate edge id/);
  });

  it('rejects a reed on an unknown edge or outside the edge', () => {
    const p1 = miniPlan();
    (p1.reeds[0] as { edgeId: string }).edgeId = 'eXX';
    expect(() => new TrackGraph(p1)).toThrow(/reed "xR01T" references unknown edge/);

    const p2 = miniPlan();
    (p2.reeds[0] as { offsetMm: number }).offsetMm = 1500;
    expect(() => new TrackGraph(p2)).toThrow(/outside edge "eB"/);
  });

  it('rejects a switch whose branch edge is not incident to its node', () => {
    const plan = miniPlan();
    // Make eD not incident to nSw anymore (retarget it from nA), keeping arity errors out
    // of the way is impossible here — arity check fires first, which is fine too.
    (plan.switches[0] as { branchEdgeIds: [string, string] }).branchEdgeIds = ['eC', 'eA'];
    expect(() => new TrackGraph(plan)).toThrow(/not incident/);
  });

  it('rejects a switch node without a switch spec', () => {
    const plan = miniPlan();
    plan.switches = [];
    expect(() => new TrackGraph(plan)).toThrow(/switch node "nSw" has no switch spec/);
  });

  it('rejects a start position outside its edge', () => {
    const plan = miniPlan();
    plan.start.offsetMm = 5000;
    expect(() => new TrackGraph(plan)).toThrow(/start offset/);
  });
});

describe('TrackGraph.nextEdge', () => {
  const g = new TrackGraph(miniPlan());

  it('resolves a plain node to the unique other edge (both directions)', () => {
    expect(g.nextEdge('eB', 'nA', at(0))).toEqual({ kind: 'edge', edgeId: 'eA' });
    expect(g.nextEdge('eA', 'nA', at(0))).toEqual({ kind: 'edge', edgeId: 'eB' });
  });

  it('resolves a buffer node', () => {
    expect(g.nextEdge('eC', 'nBufC', at(0))).toEqual({ kind: 'buffer', nodeId: 'nBufC' });
    expect(g.nextEdge('eA', 'nBuf0', at(0))).toEqual({ kind: 'buffer', nodeId: 'nBuf0' });
  });

  it('resolves toe-side entry to the branch selected by the current position', () => {
    expect(g.nextEdge('eB', 'nSw', at(0))).toEqual({ kind: 'edge', edgeId: 'eC' });
    expect(g.nextEdge('eB', 'nSw', at(1))).toEqual({ kind: 'edge', edgeId: 'eD' });
  });

  it('resolves branch-side entry to the toe, flagging trailing mismatch', () => {
    expect(g.nextEdge('eC', 'nSw', at(0))).toEqual({
      kind: 'edge',
      edgeId: 'eB',
      trailedSwitchId: 'xW01T',
      trailedMismatch: false,
    });
    expect(g.nextEdge('eC', 'nSw', at(1))).toEqual({
      kind: 'edge',
      edgeId: 'eB',
      trailedSwitchId: 'xW01T',
      trailedMismatch: true,
    });
    expect(g.nextEdge('eD', 'nSw', at(1)).kind === 'edge').toBe(true);
    const d = g.nextEdge('eD', 'nSw', at(0));
    expect(d.kind === 'edge' && d.trailedMismatch).toBe(true);
  });

  it('rejects resolving from an edge not incident to the node', () => {
    expect(() => g.nextEdge('eA', 'nSw', at(0))).toThrow(/not incident/);
  });

  it('handles opposed edge orientations at a plain node', () => {
    const og = new TrackGraph(opposedPlan());
    expect(og.nextEdge('e1', 'n2', at(0))).toEqual({ kind: 'edge', edgeId: 'e2' });
    expect(og.nextEdge('e2', 'n2', at(0))).toEqual({ kind: 'edge', edgeId: 'e1' });
  });
});
