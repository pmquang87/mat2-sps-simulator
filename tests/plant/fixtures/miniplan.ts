/**
 * Miniature trackplan fixtures for plant/ unit tests (ARCHITECTURE.md §9.2 — used until
 * the real data/trackplan.json exists; the graph shape follows the §7.1 schema).
 *
 * miniPlan() layout (mmPerUnit = 1, so plan units == mm):
 *
 *   nBuf0 ──eA──▶ nA ──eB──▶ nSw ──eC (branch 0)──▶ nBufC
 *   (buffer)    (plain)    (switch)└─eD (branch 1, tunnel)──▶ nBufD
 *
 *   eA: 500 mm   eB: 1000 mm   eC: 1000 mm   eD: 900 mm (polyline with a bend)
 *   switch xW01T at nSw: toe eB, branches [eC, eD], G→0 R→1, initial 0
 *   reeds: xR01T on eB@500 (wired), xR02T on eC@500 (wired, bounce), xR03T on eD@450
 *   start: eB @ 100 mm, direction 1 (IU sense)
 *
 * Physics numbers are chosen for round arithmetic at the 10 ms step:
 *   accel 1000 mm/s² → Δv = 10 mm/s per step
 *   speeds 100/200/600 mm/s → 1/2/6 mm per step at full speed
 *   speed 3 = 600 mm/s crosses the 20 mm reed window in ~33 ms (< one 50 ms scan).
 *
 * Every call returns a fresh deep object — tests may mutate freely.
 */
import type { TrackplanFile } from '../../../src/plant';

export function miniPlan(): TrackplanFile {
  return {
    version: 1,
    meta: {
      units: 'testPt',
      mmPerUnit: 1,
      speedsMmS: { '1': 100, '2': 200, '3': 600 },
      trainAccelMmS2: 1000,
      switchActuationMs: 300,
      reedWindowMm: 20,
      magnetOffsetMm: 0,
    },
    nodes: [
      { id: 'nBuf0', pt: { x: -500, y: 0 }, kind: 'buffer' },
      { id: 'nA', pt: { x: 0, y: 0 }, kind: 'plain' },
      { id: 'nSw', pt: { x: 1000, y: 0 }, kind: 'switch' },
      { id: 'nBufC', pt: { x: 2000, y: 0 }, kind: 'buffer' },
      { id: 'nBufD', pt: { x: 1800, y: 300 }, kind: 'buffer' },
    ],
    edges: [
      { id: 'eA', from: 'nBuf0', to: 'nA', pts: [{ x: -500, y: 0 }, { x: 0, y: 0 }] },
      { id: 'eB', from: 'nA', to: 'nSw', pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
      { id: 'eC', from: 'nSw', to: 'nBufC', pts: [{ x: 1000, y: 0 }, { x: 2000, y: 0 }] },
      {
        id: 'eD',
        from: 'nSw',
        to: 'nBufD',
        // 500 mm + 400 mm segments → 900 mm total
        pts: [{ x: 1000, y: 0 }, { x: 1400, y: 300 }, { x: 1800, y: 300 }],
        tunnel: true,
      },
    ],
    switches: [
      {
        id: 'xW01T',
        nodeId: 'nSw',
        toeEdgeId: 'eB',
        branchEdgeIds: ['eC', 'eD'],
        coilToBranch: { G: 0, R: 1 },
        mappingSource: 'derived',
        mappingEvidence: 'test fixture',
        initialPosition: 0,
      },
    ],
    reeds: [
      { id: 'xR01T', edgeId: 'eB', offsetMm: 500, wired: true, bounce: false },
      { id: 'xR02T', edgeId: 'eC', offsetMm: 500, wired: true, bounce: true },
      { id: 'xR03T', edgeId: 'eD', offsetMm: 450, wired: false, bounce: false },
    ],
    start: { edgeId: 'eB', offsetMm: 100, direction: 1 },
    landscape: { tunnels: [{ edgeIds: ['eD'] }], buildings: [], mountains: [] },
  };
}

/**
 * Two edges meeting at a plain node with OPPOSED orientations (e2 points backwards):
 *
 *   n1 ──e1──▶ n2 ◀──e2── n3
 * (buffer)   (plain)    (buffer)
 *
 * A train crossing n2 in +1 sense on e1 must enter e2 at its `to` end → offset
 * len − overshoot, direction −1 (continuity-derived sign, §8).
 */
export function opposedPlan(): TrackplanFile {
  return {
    version: 1,
    meta: {
      units: 'testPt',
      mmPerUnit: 1,
      speedsMmS: { '1': 100, '2': 200, '3': 600 },
      trainAccelMmS2: 1000,
      switchActuationMs: 300,
      reedWindowMm: 20,
      magnetOffsetMm: 0,
    },
    nodes: [
      { id: 'n1', pt: { x: 0, y: 0 }, kind: 'buffer' },
      { id: 'n2', pt: { x: 400, y: 0 }, kind: 'plain' },
      { id: 'n3', pt: { x: 800, y: 0 }, kind: 'buffer' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }] },
      { id: 'e2', from: 'n3', to: 'n2', pts: [{ x: 800, y: 0 }, { x: 400, y: 0 }] },
    ],
    switches: [],
    reeds: [],
    start: { edgeId: 'e1', offsetMm: 200, direction: 1 },
    landscape: { tunnels: [], buildings: [], mountains: [] },
  };
}
