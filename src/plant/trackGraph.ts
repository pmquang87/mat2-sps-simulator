/**
 * TrackGraph (ARCHITECTURE.md §3, §5.3, §7.1): nodes/edges/adjacency of the trackplan,
 * next-edge resolution through switches, validated on construction.
 *
 * Orientation convention (§7.1/§8 — DATA, not physics): every edge's from→to is the
 * direction the documented IU route walks pass it. The reversing loop (See-Kehre) needs
 * NO special handling here: the Train re-derives its per-edge travel sign from node
 * continuity at every transition, so the sign flip around the loop is absorbed
 * naturally. No global command↔geometry rule exists anywhere in this module.
 */
import { Polyline } from './geometry';
import type { SwitchPosition } from './switches';
import type {
  ReedSpec,
  SwitchSpec,
  TrackEdgeSpec,
  TrackNodeSpec,
  TrackplanFile,
  TrackplanMeta,
  TrainStartSpec,
  Vec2,
} from './types';

/**
 * The track a consist occupies, sampled at a fixed arc-length spacing (`docs/REVIEW_SCENE.md`
 * D12). `pts[i]` is the centre-line point at arc length `startMm + i * stepMm` measured from the
 * train, positive in the train's direction of travel. Purely geometric: it carries no vehicle
 * dimensions, so the renderer decides what sits where.
 */
export interface ConsistPath {
  readonly startMm: number;
  readonly stepMm: number;
  readonly pts: readonly Vec2[];
}

/** Result of resolving the continuation past a node. */
export type NextEdgeResult =
  | {
      kind: 'edge';
      edgeId: string;
      /** Set when the node was a switch entered from a branch (trailing move). */
      trailedSwitchId?: string;
      /** True when the switch position did not match the branch being left (§5.3). */
      trailedMismatch?: boolean;
    }
  | { kind: 'buffer'; nodeId: string };

function fail(msg: string): never {
  throw new Error(`trackplan: ${msg}`);
}

export class TrackGraph {
  readonly meta: TrackplanMeta;
  private readonly nodesById = new Map<string, TrackNodeSpec>();
  private readonly edgesById = new Map<string, TrackEdgeSpec>();
  private readonly polylines = new Map<string, Polyline>();
  /** nodeId → incident edge ids, trackplan order (stable iteration, §6.3). */
  private readonly incident = new Map<string, string[]>();
  private readonly switchByNode = new Map<string, SwitchSpec>();
  private readonly switchesById = new Map<string, SwitchSpec>();
  private readonly switchList: readonly SwitchSpec[];
  private readonly reedList: readonly ReedSpec[];
  /** Not readonly: `setStart` re-seats the train when the student switches exercise
   *  (§7.1 `exerciseStarts`, D13). Every write goes through the constructor's validation. */
  private startSpec: TrainStartSpec;

  constructor(plan: TrackplanFile) {
    this.meta = { ...plan.meta, speedsMmS: { ...plan.meta.speedsMmS } };

    for (const n of plan.nodes) {
      if (this.nodesById.has(n.id)) fail(`duplicate node id "${n.id}"`);
      this.nodesById.set(n.id, n);
      this.incident.set(n.id, []);
    }
    for (const e of plan.edges) {
      if (this.edgesById.has(e.id)) fail(`duplicate edge id "${e.id}"`);
      if (!this.nodesById.has(e.from)) fail(`edge "${e.id}" references unknown node "${e.from}"`);
      if (!this.nodesById.has(e.to)) fail(`edge "${e.id}" references unknown node "${e.to}"`);
      this.edgesById.set(e.id, e);
      this.polylines.set(e.id, new Polyline(e.pts, plan.meta.mmPerUnit));
      (this.incident.get(e.from) as string[]).push(e.id);
      (this.incident.get(e.to) as string[]).push(e.id);
    }

    // Node arity: buffer = 1, plain = 2 (dead ends must be buffers), switch = 3.
    for (const n of plan.nodes) {
      const deg = (this.incident.get(n.id) as string[]).length;
      const want = n.kind === 'buffer' ? 1 : n.kind === 'plain' ? 2 : 3;
      if (deg !== want) {
        fail(`${n.kind} node "${n.id}" has ${deg} incident edges, expected ${want}`);
      }
    }

    for (const sw of plan.switches) {
      if (this.switchesById.has(sw.id)) fail(`duplicate switch id "${sw.id}"`);
      const node = this.nodesById.get(sw.nodeId);
      if (!node) fail(`switch "${sw.id}" references unknown node "${sw.nodeId}"`);
      if (node.kind !== 'switch') fail(`switch "${sw.id}" node "${sw.nodeId}" is kind "${node.kind}"`);
      if (this.switchByNode.has(sw.nodeId)) fail(`node "${sw.nodeId}" has more than one switch`);
      const [b0, b1] = sw.branchEdgeIds;
      if (sw.toeEdgeId === b0 || sw.toeEdgeId === b1 || b0 === b1) {
        fail(`switch "${sw.id}" toe/branch edges are not distinct`);
      }
      const inc = this.incident.get(sw.nodeId) as string[];
      for (const eid of [sw.toeEdgeId, b0, b1]) {
        if (!this.edgesById.has(eid)) fail(`switch "${sw.id}" references unknown edge "${eid}"`);
        if (!inc.includes(eid)) fail(`switch "${sw.id}" edge "${eid}" is not incident to node "${sw.nodeId}"`);
      }
      this.switchesById.set(sw.id, sw);
      this.switchByNode.set(sw.nodeId, sw);
    }
    for (const n of plan.nodes) {
      if (n.kind === 'switch' && !this.switchByNode.has(n.id)) {
        fail(`switch node "${n.id}" has no switch spec`);
      }
    }

    const reedIds = new Set<string>();
    for (const r of plan.reeds) {
      if (reedIds.has(r.id)) fail(`duplicate reed id "${r.id}"`);
      reedIds.add(r.id);
      const poly = this.polylines.get(r.edgeId);
      if (!poly) fail(`reed "${r.id}" references unknown edge "${r.edgeId}"`);
      if (r.offsetMm < 0 || r.offsetMm > poly.lengthMm) {
        fail(`reed "${r.id}" offset ${r.offsetMm} mm outside edge "${r.edgeId}" (0..${poly.lengthMm} mm)`);
      }
    }

    this.switchList = [...plan.switches];
    this.reedList = [...plan.reeds];
    this.startSpec = this.validatedStart(plan.start);
  }

  /** Shared by the constructor and `setStart` — a re-seat is validated exactly like the
   *  trackplan's own `start`, so a bad `exerciseStarts` entry fails the same way (§7.1). */
  private validatedStart(spec: TrainStartSpec): TrainStartSpec {
    const poly = this.polylines.get(spec.edgeId);
    if (!poly) fail(`start references unknown edge "${spec.edgeId}"`);
    if (spec.offsetMm < 0 || spec.offsetMm > poly.lengthMm) {
      fail(`start offset ${spec.offsetMm} mm outside edge "${spec.edgeId}" (0..${poly.lengthMm} mm)`);
    }
    return { ...spec };
  }

  /**
   * Move the seat a fresh `Train` takes (§7.1 `exerciseStarts`, D13). Validates first, so a
   * rejected spec leaves the previous start in place; the caller decides when to re-init.
   */
  setStart(spec: TrainStartSpec): void {
    this.startSpec = this.validatedStart(spec);
  }

  node(id: string): TrackNodeSpec {
    const n = this.nodesById.get(id);
    if (!n) fail(`unknown node "${id}"`);
    return n;
  }

  edge(id: string): TrackEdgeSpec {
    const e = this.edgesById.get(id);
    if (!e) fail(`unknown edge "${id}"`);
    return e;
  }

  polyline(edgeId: string): Polyline {
    const p = this.polylines.get(edgeId);
    if (!p) fail(`unknown edge "${edgeId}"`);
    return p;
  }

  edgeLengthMm(edgeId: string): number {
    return this.polyline(edgeId).lengthMm;
  }

  edgesAtNode(nodeId: string): readonly string[] {
    const inc = this.incident.get(nodeId);
    if (!inc) fail(`unknown node "${nodeId}"`);
    return inc;
  }

  switchAtNode(nodeId: string): SwitchSpec | undefined {
    return this.switchByNode.get(nodeId);
  }

  switchById(id: string): SwitchSpec | undefined {
    return this.switchesById.get(id);
  }

  /** Switch specs, trackplan order (stable, §6.3). */
  get switches(): readonly SwitchSpec[] {
    return this.switchList;
  }

  /** Reed specs, trackplan order (stable, §6.3). */
  get reeds(): readonly ReedSpec[] {
    return this.reedList;
  }

  get start(): TrainStartSpec {
    return this.startSpec;
  }

  /**
   * Continuation past `viaNodeId` when leaving `fromEdgeId` (§5.3 train motion rules):
   * plain → the unique other edge; switch from toe side → current position's branch;
   * switch from branch side → toe edge (trailing, mismatch flagged); buffer → buffer.
   */
  nextEdge(
    fromEdgeId: string,
    viaNodeId: string,
    positionOf: (switchId: string) => SwitchPosition,
  ): NextEdgeResult {
    const node = this.node(viaNodeId);
    const edge = this.edge(fromEdgeId);
    if (edge.from !== viaNodeId && edge.to !== viaNodeId) {
      fail(`edge "${fromEdgeId}" is not incident to node "${viaNodeId}"`);
    }
    if (node.kind === 'buffer') {
      return { kind: 'buffer', nodeId: viaNodeId };
    }
    if (node.kind === 'plain') {
      const other = (this.incident.get(viaNodeId) as string[]).find((id) => id !== fromEdgeId);
      /* c8 ignore next — plain arity 2 is validated in the constructor */
      if (!other) fail(`plain node "${viaNodeId}" has no continuation`);
      return { kind: 'edge', edgeId: other };
    }
    const sw = this.switchByNode.get(viaNodeId) as SwitchSpec; // validated: every switch node has one
    if (fromEdgeId === sw.toeEdgeId) {
      return { kind: 'edge', edgeId: sw.branchEdgeIds[positionOf(sw.id)] };
    }
    const idx = sw.branchEdgeIds.indexOf(fromEdgeId);
    /* c8 ignore next — incident set == {toe, b0, b1} is validated in the constructor */
    if (idx !== 0 && idx !== 1) fail(`edge "${fromEdgeId}" is neither toe nor branch of switch "${sw.id}"`);
    const branch = idx as SwitchPosition;
    return {
      kind: 'edge',
      edgeId: sw.toeEdgeId,
      trailedSwitchId: sw.id,
      trailedMismatch: positionOf(sw.id) !== branch,
    };
  }

  /**
   * The track the CONSIST occupies, as plan-space samples of the centre line at a fixed arc-length
   * spacing, from `behindMm` behind the train to `aheadMm` in front of it (`docs/REVIEW_SCENE.md`
   * D12).
   *
   * Why this lives in the graph and not in the renderer: a coach's position is a *track* question,
   * not a history question. The scene used to place coaches along a buffer of the loco's past
   * positions, which is wrong in two ways that both showed up on the real plant — at spawn there is
   * no history at all (the buffer laid down a straight guess and the coaches left the rails on the
   * first curve), and during a push-back the coaches LEAD the loco onto whatever the switches are
   * set to now, which the loco has never driven over. Walking the live graph answers both: a switch
   * thrown behind the loco moves the coaches with it, exactly as on the real plant.
   *
   * Sampling walks outward from the train in both senses, resolving every node with the same
   * `nextEdge` the train itself uses, so the consist can never occupy a route the train could not.
   * A buffer end stops the walk and the remaining samples clamp to it — a consist standing against
   * the stops, which is what the plant does too.
   */
  consistPath(
    at: { edgeId: string; offsetMm: number; direction: 1 | -1 },
    span: { aheadMm: number; behindMm: number; stepMm: number },
    positionOf: (switchId: string) => SwitchPosition,
  ): ConsistPath {
    const step = span.stepMm;
    const nBehind = Math.ceil(span.behindMm / step);
    const nAhead = Math.ceil(span.aheadMm / step);
    const back = this.walkSamples(at, -1, nBehind, step, positionOf);
    const fwd = this.walkSamples(at, +1, nAhead, step, positionOf);
    back.reverse();
    return { startMm: -nBehind * step, stepMm: step, pts: [...back, ...fwd.slice(1)] };
  }

  /**
   * `count + 1` samples (including the train itself) walking `sense` × the train's direction, at
   * `stepMm` spacing. Clamps at a buffer instead of running off the graph.
   */
  private walkSamples(
    at: { edgeId: string; offsetMm: number; direction: 1 | -1 },
    sense: 1 | -1,
    count: number,
    stepMm: number,
    positionOf: (switchId: string) => SwitchPosition,
  ): Vec2[] {
    let edgeId = at.edgeId;
    let offsetMm = at.offsetMm;
    let dir: 1 | -1 = (at.direction * sense) as 1 | -1;
    const out: Vec2[] = [this.polyline(edgeId).pointAtMm(offsetMm)];
    for (let i = 0; i < count; i += 1) {
      offsetMm += dir * stepMm;
      // resolve node transitions exactly as Train.resolveTransitions does
      let stuck = false;
      for (let guard = 0; guard < 64; guard += 1) {
        const len = this.edgeLengthMm(edgeId);
        const edge = this.edge(edgeId);
        let exitNodeId: string;
        let overshootMm: number;
        if (dir > 0 && offsetMm > len) {
          exitNodeId = edge.to;
          overshootMm = offsetMm - len;
        } else if (dir < 0 && offsetMm < 0) {
          exitNodeId = edge.from;
          overshootMm = -offsetMm;
        } else {
          break;
        }
        const res = this.nextEdge(edgeId, exitNodeId, positionOf);
        if (res.kind === 'buffer') {
          offsetMm = dir > 0 ? len : 0;
          stuck = true;
          break;
        }
        const next = this.edge(res.edgeId);
        edgeId = res.edgeId;
        if (next.from === exitNodeId) {
          offsetMm = overshootMm;
          dir = 1;
        } else {
          offsetMm = this.edgeLengthMm(res.edgeId) - overshootMm;
          dir = -1;
        }
      }
      out.push(this.polyline(edgeId).pointAtMm(offsetMm));
      if (stuck) {
        // against the stops: every remaining sample sits at the buffer
        const last = out[out.length - 1] as Vec2;
        for (let k = i + 1; k < count; k += 1) out.push(last);
        break;
      }
    }
    return out;
  }
}
