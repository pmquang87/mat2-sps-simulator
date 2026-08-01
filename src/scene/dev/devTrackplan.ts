/**
 * FIXTURE — NOT the shipped trackplan.
 *
 * A `TrackplanFile`-shaped object used only by the scene dev harness
 * (`src/scene/dev/harness.html`) so the 3D scene can be inspected before
 * `src/data/trackplan.json` exists. The authoritative trackplan is owned by the data agent
 * (ARCHITECTURE.md §4/§7.1); nothing in `src/` outside this folder imports this file.
 *
 * Geometry is a deliberate simplification of the documented Gleisplan
 * (`reference/research/gleisplan.md`, 960 × 540 pt space): the two main rings become rounded
 * rectangles, the Wendeschleife a circle, station tracks straight lanes. Node/switch/reed
 * names and coordinates are the documented ones so the rendering is recognisable, but:
 *
 * - `coilToBranch` is a **blanket assumption** (`G → branch 0`) with
 *   `mappingSource: 'assumed'` — no route knowledge is encoded here (§8 is the data agent's
 *   job).
 * - `wired` is fixture-only (two reeds are marked unwired purely to exercise the grey-plate
 *   rendering path); the real set comes from `variables.json`.
 */
import type {
  ReedSpec,
  SwitchSpec,
  TrackEdgeSpec,
  TrackNodeSpec,
  TrackplanFile,
  Vec2,
} from '../../plant';

const DEG = Math.PI / 180;

function v(x: number, y: number): Vec2 {
  return { x, y };
}

function arc(
  cx: number,
  cy: number,
  r: number,
  a0Deg: number,
  a1Deg: number,
  steps: number,
): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (a0Deg + ((a1Deg - a0Deg) * i) / steps) * DEG;
    out.push(v(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return out;
}

/** Closed rounded rectangle, clockwise in plan space (y downwards). */
function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Vec2[] {
  const s = 8;
  return [
    v(x0 + r, y0),
    v(x1 - r, y0),
    ...arc(x1 - r, y0 + r, r, -90, 0, s),
    v(x1, y1 - r),
    ...arc(x1 - r, y1 - r, r, 0, 90, s),
    v(x0 + r, y1),
    ...arc(x0 + r, y1 - r, r, 90, 180, s),
    v(x0, y0 + r),
    ...arc(x0 + r, y0 + r, r, 180, 270, s),
    v(x0 + r, y0),
  ];
}

interface SplitSpec {
  readonly id: string;
  readonly pt: Vec2;
  readonly kind?: TrackNodeSpec['kind'];
}

interface ChainOptions {
  readonly startNode?: string;
  readonly endNode?: string;
  readonly startKind?: TrackNodeSpec['kind'];
  readonly endKind?: TrackNodeSpec['kind'];
  readonly splits?: readonly SplitSpec[];
}

/** Assembles a node/edge graph, splitting polylines at named points. */
class GraphBuilder {
  readonly nodes = new Map<string, TrackNodeSpec>();
  readonly edges: TrackEdgeSpec[] = [];

  node(id: string, pt: Vec2, kind: TrackNodeSpec['kind'] = 'plain'): string {
    const existing = this.nodes.get(id);
    if (existing) {
      if (kind === 'switch') this.nodes.set(id, { id, pt: existing.pt, kind });
      return id;
    }
    this.nodes.set(id, { id, pt, kind });
    return id;
  }

  private pointOf(id: string): Vec2 | undefined {
    return this.nodes.get(id)?.pt;
  }

  /**
   * Adds a chain of edges along `pts`, cutting it at each split point and naming the
   * resulting nodes. Returns the created edge ids in walking order.
   */
  chain(prefix: string, pts: readonly Vec2[], opts: ChainOptions = {}): string[] {
    const poly = pts.map((p) => v(p.x, p.y));
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (!first || !last || poly.length < 2) return [];

    const startId = opts.startNode ?? `${prefix}-a`;
    const endId = opts.endNode ?? `${prefix}-b`;
    const startPt = this.pointOf(startId) ?? first;
    const endPt = this.pointOf(endId) ?? last;
    poly[0] = v(startPt.x, startPt.y);
    poly[poly.length - 1] = v(endPt.x, endPt.y);
    this.node(startId, startPt, opts.startKind ?? 'plain');
    this.node(endId, endPt, opts.endKind ?? 'plain');

    // project every split onto the polyline, then cut in walking order
    const cuts: { id: string; seg: number; t: number; pt: Vec2 }[] = [];
    for (const split of opts.splits ?? []) {
      const hit = project(poly, split.pt);
      cuts.push({ id: split.id, seg: hit.seg, t: hit.t, pt: split.pt });
      this.node(split.id, split.pt, split.kind ?? 'plain');
    }
    cuts.sort((a, b) => (a.seg === b.seg ? a.t - b.t : a.seg - b.seg));

    const ids: string[] = [];
    let cursorSeg = 0;
    let cursorPt = poly[0] ?? first;
    let fromId = startId;
    let n = 0;
    for (const cut of cuts) {
      const segment: Vec2[] = [cursorPt];
      for (let i = cursorSeg + 1; i <= cut.seg; i += 1) {
        const p = poly[i];
        if (p) segment.push(p);
      }
      segment.push(cut.pt);
      const id = `${prefix}-${n}`;
      n += 1;
      this.edges.push({ id, from: fromId, to: cut.id, pts: dedupe(segment) });
      ids.push(id);
      fromId = cut.id;
      cursorSeg = cut.seg;
      cursorPt = cut.pt;
    }
    const tail: Vec2[] = [cursorPt];
    for (let i = cursorSeg + 1; i < poly.length; i += 1) {
      const p = poly[i];
      if (p) tail.push(p);
    }
    const id = `${prefix}-${n}`;
    this.edges.push({ id, from: fromId, to: endId, pts: dedupe(tail) });
    ids.push(id);
    return ids;
  }

  /** Marks edges as tunnel edges. */
  tunnel(...edgeIds: string[]): void {
    for (const id of edgeIds) {
      const idx = this.edges.findIndex((e) => e.id === id);
      const e = this.edges[idx];
      if (e) this.edges[idx] = { ...e, tunnel: true };
    }
  }

  /**
   * Derives a `SwitchSpec` for a degree-3 node: the toe is the leg pointing away from the
   * other two, the remaining legs become the branches (trackplan order).
   */
  autoSwitch(id: string, nodeId: string): SwitchSpec | null {
    const incident = this.edges.filter((e) => e.from === nodeId || e.to === nodeId);
    if (incident.length !== 3) return null;
    const dirs = incident.map((e) => outgoingDir(e, nodeId));
    let toeIdx = 0;
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i += 1) {
      const d = dirs[i];
      if (!d) continue;
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        const o = dirs[k];
        if (!o || k === i) continue;
        sum += d.x * o.x + d.y * o.y;
      }
      if (sum < worst) {
        worst = sum;
        toeIdx = i;
      }
    }
    const toe = incident[toeIdx];
    const branches = incident.filter((_, i) => i !== toeIdx);
    const b0 = branches[0];
    const b1 = branches[1];
    if (!toe || !b0 || !b1) return null;
    return {
      id,
      nodeId,
      toeEdgeId: toe.id,
      branchEdgeIds: [b0.id, b1.id],
      coilToBranch: { G: 0, R: 1 },
      mappingSource: 'assumed',
      mappingEvidence: 'fixture default — real mapping is derived by the data agent (§8)',
      initialPosition: 0,
    };
  }

  /** Places a reed at the point of the nearest edge, converting to an mm offset. */
  reed(id: string, pt: Vec2, mmPerUnit: number, wired = true): ReedSpec | null {
    let best: { edgeId: string; offset: number; dist: number } | null = null;
    for (const e of this.edges) {
      const hit = project(e.pts, pt);
      if (!best || hit.dist < best.dist) {
        best = { edgeId: e.id, offset: hit.cum, dist: hit.dist };
      }
    }
    if (!best) return null;
    return { id, edgeId: best.edgeId, offsetMm: best.offset * mmPerUnit, wired, bounce: false };
  }
}

function dedupe(pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6) continue;
    out.push(v(p.x, p.y));
  }
  return out;
}

function outgoingDir(e: TrackEdgeSpec, nodeId: string): Vec2 | null {
  const n = e.pts.length;
  if (e.from === nodeId) {
    const a = e.pts[0];
    const b = e.pts[1];
    if (!a || !b) return null;
    return norm(b.x - a.x, b.y - a.y);
  }
  if (e.to === nodeId) {
    const a = e.pts[n - 1];
    const b = e.pts[n - 2];
    if (!a || !b) return null;
    return norm(b.x - a.x, b.y - a.y);
  }
  return null;
}

function norm(x: number, y: number): Vec2 {
  const l = Math.hypot(x, y) || 1;
  return v(x / l, y / l);
}

/** Closest point on a polyline: segment index, parameter, distance and arc length. */
function project(
  poly: readonly Vec2[],
  p: Vec2,
): { seg: number; t: number; dist: number; cum: number } {
  let best = { seg: 0, t: 0, dist: Number.POSITIVE_INFINITY, cum: 0 };
  let cum = 0;
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const dist = Math.hypot(p.x - qx, p.y - qy);
    if (dist < best.dist) {
      best = { seg: i, t, dist, cum: cum + Math.sqrt(len2) * t };
    }
    cum += Math.sqrt(len2);
  }
  return best;
}

/** Builds the harness fixture. */
export function createDevTrackplan(): TrackplanFile {
  const mmPerUnit = 3.5;
  const g = new GraphBuilder();

  // ── two main rings (Gleis A/E outer, Gleis B/D inner) ──
  g.chain('e-ring-a', roundedRect(26.4, 14.9, 933.5, 525.1, 95), {
    startNode: 'n-a-loop',
    endNode: 'n-a-loop',
    splits: [
      { id: 'n-a-r1', pt: v(933.5, 300) },
      { id: 'n-a-r2', pt: v(500, 525.1) },
      { id: 'n-a-r3', pt: v(26.4, 300) },
    ],
  });
  g.chain('e-ring-b', roundedRect(40.7, 29.0, 919.3, 496.8, 80), {
    startNode: 'n-b-loop',
    endNode: 'n-b-loop',
    splits: [
      { id: 'n-b-ost', pt: v(791.8, 29.0), kind: 'switch' },
      { id: 'n2', pt: v(919.3, 312.5), kind: 'switch' },
      { id: 'n59', pt: v(706.8, 496.8), kind: 'switch' },
      { id: 'n16', pt: v(224.9, 496.8), kind: 'switch' },
    ],
  });

  // ── Gleis C: bow down from BH2 Gleis 3 into the Wendeschleife ──
  const cChain = g.chain(
    'e-c',
    [
      v(423.4, 57.4),
      v(370, 57.4),
      v(330, 64),
      v(300, 85),
      v(285, 110),
      v(281.5, 128.3),
      v(281.5, 366.2),
    ],
    {
      startNode: 'n61',
      startKind: 'switch',
      endNode: 'n-k-south',
      endKind: 'switch',
      splits: [
        { id: 'n-c-tun-a', pt: v(281.5, 186) },
        { id: 'n-c-tun-b', pt: v(281.5, 284) },
        { id: 'n55', pt: v(281.5, 301.7), kind: 'switch' },
        { id: 'n-k-north', pt: v(281.5, 338.7), kind: 'switch' },
      ],
    },
  );
  const cTunnel = cChain[1];
  if (cTunnel) g.tunnel(cTunnel);

  // ── Wendeschleife (See-Kehre) around the Badesee ──
  const loopK = g.chain(
    'e-k',
    arc(154, 355, 127.5, -7.3, -352.7, 96),
    {
      startNode: 'n-k-north',
      endNode: 'n-k-south',
      splits: [
        { id: 'n-k-p1', pt: v(154 + 127.5 * Math.cos(-25 * DEG), 355 + 127.5 * Math.sin(-25 * DEG)) },
        { id: 'n-k-p2', pt: v(154 + 127.5 * Math.cos(-115 * DEG), 355 + 127.5 * Math.sin(-115 * DEG)) },
        { id: 'n-k-mid', pt: v(26.5, 355) },
        { id: 'n-k-p3', pt: v(154, 482.5) },
      ],
    },
  );
  const kTunnel = loopK[1];
  if (kTunnel) g.tunnel(kTunnel);

  // ── Bahnhof 1: Gleis 3 (stub to the west) and Gleis 4 ──
  g.chain('e-bh1g3', [v(118.6, 482.6), v(749.3, 482.6)], {
    startNode: 'n-bh1g3-buf',
    startKind: 'buffer',
    endNode: 'n33',
    endKind: 'switch',
    splits: [
      { id: 'n58', pt: v(310.0, 482.6), kind: 'switch' },
      { id: 'n58b', pt: v(355.0, 482.6), kind: 'switch' },
    ],
  });
  g.chain('e-bh1g4', [v(394.9, 454.1), v(749.2, 454.3)], {
    startNode: 'n57',
    startKind: 'switch',
    endNode: 'n13',
  });
  g.chain('e-bh1-w1', [v(224.9, 496.8), v(310.0, 482.6)], { startNode: 'n16', endNode: 'n58' });
  g.chain('e-bh1-w2', [v(355.0, 482.6), v(394.9, 454.1)], { startNode: 'n58b', endNode: 'n57' });
  g.chain('e-bh1-o1', [v(706.8, 496.8), v(749.3, 482.6)], { startNode: 'n59', endNode: 'n33' });
  g.chain('e-bh1-o2', [v(749.2, 454.3), v(749.3, 482.6)], { startNode: 'n13', endNode: 'n33' });
  // diagonale Gleis 4 West → Gleis C (e51)
  g.chain('e-bh1-c', [v(394.9, 454.1), v(281.5, 366.2)], {
    startNode: 'n57',
    endNode: 'n-k-south',
  });

  // ── Bahnhof 2: Überholgleise 3/4 and the Gleis-5 stub ──
  g.chain('e-bh2g3', [v(423.4, 57.4), v(706.8, 57.4)], {
    startNode: 'n61',
    endNode: 'n62',
    endKind: 'switch',
  });
  g.chain('e-bh2g4', [v(508.4, 85.7), v(621.4, 85.7)], {
    startNode: 'n65',
    startKind: 'switch',
    endNode: 'n83',
  });
  g.chain('e-bh2-w', [v(423.4, 57.4), v(508.4, 85.7)], { startNode: 'n61', endNode: 'n65' });
  g.chain('e-bh2-o', [v(621.4, 85.7), v(706.8, 57.4)], { startNode: 'n83', endNode: 'n62' });
  g.chain('e-bh2-b', [v(706.8, 57.4), v(760, 40), v(791.8, 29.0)], {
    startNode: 'n62',
    endNode: 'n-b-ost',
  });
  g.chain('e-bh2g5', [v(508.4, 85.7), v(553, 100), v(643, 100)], {
    startNode: 'n65',
    endNode: 'n-bh2g5-buf',
    endKind: 'buffer',
  });

  // ── Bahnhof 3: Durchfahrgleis 2, Überholgleis 3, Stumpfgleis ──
  g.chain('e-bh3g2', [v(422.8, 199.2), v(784.3, 199.2)], {
    startNode: 'n68',
    startKind: 'switch',
    endNode: 'n69',
    endKind: 'switch',
  });
  g.chain(
    'e-bh3-w',
    [v(281.5, 301.7), v(290, 270), v(310, 240), v(345, 215), v(385, 201), v(422.8, 199.2)],
    { startNode: 'n55', endNode: 'n68' },
  );
  g.chain('e-bh3-stub', [v(422.8, 199.2), v(470, 213.4), v(650.1, 213.4)], {
    startNode: 'n68',
    endNode: 'n-bh3-buf',
    endKind: 'buffer',
  });
  g.chain('e-bh3g3', [v(430.5, 184.9), v(706.9, 184.9)], {
    startNode: 'n-bh3g3-buf',
    startKind: 'buffer',
    endNode: 'n74',
  });
  g.chain('e-bh3-o', [v(706.9, 184.9), v(784.3, 199.2)], { startNode: 'n74', endNode: 'n69' });
  g.chain(
    'e-bh3-d',
    [v(784.3, 199.2), v(830, 205), v(870, 225), v(900, 265), v(915, 300), v(919.3, 312.5)],
    { startNode: 'n69', endNode: 'n2' },
  );

  // ── switches: documented names on the documented nodes (mapping = assumed, see header) ──
  const switchNames: [string, string][] = [
    ['xW02BH1G2', 'n16'],
    ['xW02BH1G3', 'n58'],
    ['xW03BH1G3', 'n58b'],
    ['xW02BH1G4', 'n57'],
    ['xW05BH1G3', 'n33'],
    ['xW04BH1G2', 'n59'],
    ['xW02BH2G3', 'n61'],
    ['xW01BH2G3', 'n62'],
    ['xW01BH2G4', 'n65'],
    ['xW02BH2G2', 'n-b-ost'],
    ['xW03BH3G2', 'n68'],
    ['xW02BH3G2', 'n69'],
    ['xW02D', 'n2'],
    ['xW02C', 'n55'],
    ['xW03C', 'n-k-north'],
    ['xW04C', 'n-k-south'],
  ];
  const switches: SwitchSpec[] = [];
  for (const [id, nodeId] of switchNames) {
    const spec = g.autoSwitch(id, nodeId);
    if (spec) switches.push(spec);
  }

  // ── reeds: documented positions (reference/research/gleisplan.md §2/§3) ──
  const reedPoints: [string, Vec2, boolean][] = [
    ['xR01BH1G1', v(373.7, 525.2), true],
    ['xR02BH1G1', v(607.6, 525.2), true],
    ['xR01BH1G2', v(387.9, 496.8), true],
    ['xR02BH1G2', v(621.8, 496.8), true],
    ['xR01BH1G3', v(402.1, 482.6), true],
    ['xR03BH1G3', v(635.9, 482.6), true],
    ['xR01BH1G4', v(324.2, 433.1), true],
    ['xR02BH1G4', v(416.2, 454.3), true],
    ['xR03BH1G4', v(650.1, 454.3), true],
    ['xR01BH2G1', v(706.9, 14.9), true],
    ['xR02BH2G1', v(395.0, 14.9), true],
    ['xR01BH2G2', v(685.6, 43.3), true],
    ['xR02BH2G2', v(437.6, 43.3), true],
    ['xR01BH2G3', v(657.2, 57.4), true],
    ['xR02BH2G3', v(458.8, 57.4), true],
    ['xR01BH2G4', v(607.6, 85.9), true],
    ['xR02BH2G4', v(551.0, 85.9), true],
    ['xR01BH2G5', v(593.5, 100.0), true],
    ['xR02BH2G5', v(565.1, 100.0), true],
    ['xR01BH3G2', v(862.8, 213.4), true],
    ['xR03BH3G2', v(692.7, 199.1), true],
    ['xR04BH3G2', v(536.7, 199.1), true],
    ['xR05BH3G2', v(331.3, 213.4), true],
    ['xR01BH3G3', v(706.9, 185.0), true],
    ['xR02BH3G3', v(430.5, 185.0), true],
    ['xR01A', v(217.9, 43.3), true],
    ['xR02A', v(62.0, 220.4), true],
    ['xR03A', v(54.9, 496.9), true],
    ['xR01B', v(217.9, 71.6), true],
    ['xR02B', v(76.1, 227.5), true],
    ['xR03B', v(69.1, 489.8), true],
    ['xR01C', v(288.7, 100.0), true],
    ['xR02C', v(281.6, 199.1), true],
    ['xR03C', v(260.4, 433.0), true],
    ['xR01D', v(891.1, 454.3), true],
    ['xR02D', v(919.4, 241.7), true],
    ['xR03D', v(914.8, 73.3), true],
    ['xR01E', v(905.2, 475.6), true],
    ['xR02E', v(933.6, 270.1), true],
    ['xR03E', v(914.8, 45.2), true],
    // fixture-only: unwired so the grey-plate path is visible in the harness
    ['xR01K', v(146.9, 241.7), false],
    ['xR02K', v(111.5, 461.5), false],
  ];
  const reeds: ReedSpec[] = [];
  for (const [id, pt, wired] of reedPoints) {
    const spec = g.reed(id, pt, mmPerUnit, wired);
    if (spec) reeds.push(spec);
  }

  const startEdge = g.edges.find((e) => e.id === 'e-ring-a-1') ?? g.edges[0];

  return {
    version: 1,
    meta: {
      units: 'gleisplanPt',
      mmPerUnit,
      speedsMmS: { '1': 80, '2': 160, '3': 280 },
      trainAccelMmS2: 150,
      switchActuationMs: 300,
      reedWindowMm: 20,
      magnetOffsetMm: 0,
    },
    nodes: [...g.nodes.values()],
    edges: g.edges,
    switches,
    reeds,
    start: { edgeId: startEdge?.id ?? '', offsetMm: 200, direction: 1 },
    landscape: {
      tunnels: [],
      lake: { center: v(154, 355), radiusPt: 55 },
      buildings: [
        { kind: 'lokschuppen', pt: v(620, 300), rotDeg: 0 },
        { kind: 'bahnhof', pt: v(500, 262), rotDeg: 0 },
        { kind: 'bahnhof', pt: v(500, 400), rotDeg: 0 },
        { kind: 'bahnhof', pt: v(600, 132), rotDeg: 0 },
        { kind: 'baeckerei', pt: v(720, 380), rotDeg: 25 },
        { kind: 'aussichtsturm', pt: v(150, 110), rotDeg: 0 },
      ],
      mountains: [
        { center: v(200, 235), radiusPt: 95, heightPt: 52 },
        { center: v(150, 110), radiusPt: 52, heightPt: 30 },
      ],
    },
  };
}
