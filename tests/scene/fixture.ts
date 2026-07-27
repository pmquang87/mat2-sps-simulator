/**
 * Minimal `TrackplanFile` fixtures for the scene unit tests (ARCHITECTURE.md §4: the scene
 * agent owns `src/scene/**` and `tests/scene/**`).
 *
 * Kept tiny and hand-computable: one straight edge of 100 plan units and one L-shaped edge,
 * so expected lengths/offsets can be asserted exactly.
 */
import type { TrackplanFile, TrackplanMeta } from '../../src/plant';

export const META: TrackplanMeta = {
  units: 'gleisplanPt',
  mmPerUnit: 2,
  speedsMmS: { '1': 80, '2': 160, '3': 280 },
  trainAccelMmS2: 150,
  switchActuationMs: 300,
  reedWindowMm: 20,
  magnetOffsetMm: 0,
};

/** Straight edge n1→n2 (100 units along +x) plus an L-shaped edge n2→n3 (100 + 100). */
export function straightPlan(): TrackplanFile {
  return {
    version: 1,
    meta: META,
    nodes: [
      { id: 'n1', pt: { x: 0, y: 0 }, kind: 'plain' },
      { id: 'n2', pt: { x: 100, y: 0 }, kind: 'switch' },
      { id: 'n3', pt: { x: 200, y: 100 }, kind: 'buffer' },
      { id: 'n4', pt: { x: 100, y: -100 }, kind: 'plain' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      {
        id: 'e2',
        from: 'n2',
        to: 'n3',
        pts: [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }],
      },
      { id: 'e3', from: 'n2', to: 'n4', pts: [{ x: 100, y: 0 }, { x: 100, y: -100 }] },
    ],
    switches: [
      {
        id: 'xW01TEST',
        nodeId: 'n2',
        toeEdgeId: 'e1',
        branchEdgeIds: ['e2', 'e3'],
        coilToBranch: { G: 0, R: 1 },
        mappingSource: 'assumed',
        initialPosition: 0,
      },
      {
        id: 'xW02TEST',
        nodeId: 'n2',
        toeEdgeId: 'e1',
        branchEdgeIds: ['e2', 'e3'],
        coilToBranch: null,
        mappingSource: 'assumed',
        initialPosition: 1,
      },
    ],
    reeds: [
      { id: 'xR01BH1G1', edgeId: 'e1', offsetMm: 40, wired: true },
      { id: 'xR02BH1G1', edgeId: 'e1', offsetMm: 160, wired: true },
      { id: 'xR01BH1G2', edgeId: 'e2', offsetMm: 100, wired: true },
      { id: 'xR01BH2G3', edgeId: 'e3', offsetMm: 50, wired: true },
      { id: 'xR03BH1G1', edgeId: 'e3', offsetMm: 90, wired: false },
      { id: 'xR01A', edgeId: 'e2', offsetMm: 20, wired: true },
    ],
    start: { edgeId: 'e1', offsetMm: 0, direction: 1 },
    landscape: {
      tunnels: [{ edgeIds: ['e2'] }],
      lake: { center: { x: 50, y: 50 }, radiusPt: 10 },
      buildings: [{ kind: 'lokschuppen', pt: { x: 20, y: 60 }, rotDeg: 0 }],
      mountains: [{ center: { x: 150, y: 50 }, radiusPt: 30, heightPt: 20 }],
    },
  };
}
