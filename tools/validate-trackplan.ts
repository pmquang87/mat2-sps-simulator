/**
 * tools/validate-trackplan.ts — graph checker + §8 route re-walk (ARCHITECTURE.md §3,
 * §7.1, §8).
 *
 * Structural checks: edge endpoints exist; polyline endpoints coincide with node
 * coordinates; node arity (buffer 1 / plain 2 / switch 3, toe + both branches listed and
 * incident); every `wired: true` reed has a Variablenliste symbol and the wired set is
 * exactly the documented 23; reed offsets inside their edge; landscape/start references.
 *
 * Route re-walk (§8, binding): the Aufgabenstellung route scripts for Gruppe A and B
 * (PUBLIC task files — trigger reed → commanded coils) are replayed through the mapped
 * graph. Every leg must reach its trigger reed; facing moves follow the commanded
 * coil→branch mapping, so a wrong `coilToBranch` entry derails the walk. The walker also
 * records per-edge traversal directions per traction command and proves the See-Kehre
 * consistency claim: no edge is traversed in opposite directions under the SAME command
 * across the A and B walks (§7.1/§8).
 *
 * CLI (repo root, Node ≥ 22.18 native type stripping):
 *
 *     node tools/validate-trackplan.ts
 *
 * Also imported by tests/data/trackplan.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReedSpec, SwitchSpec, TrackplanFile, Vec2 } from '../src/plant';

/** Node process accessor without @types/node (see node-shim.d.ts for the module shims). */
const proc = (globalThis as unknown as {
  process: { argv: readonly (string | undefined)[]; exit(code?: number): never };
}).process;

// ───────────────────────────────────── structural checks ──────────────────────────────────

export interface VariablesDocLike {
  entries: ReadonlyArray<{ symbol: string; address: string; type: string }>;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polyLengthMm(pts: readonly Vec2[], mmPerUnit: number): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += dist(pts[i] as Vec2, pts[i - 1] as Vec2) * mmPerUnit;
  return acc;
}

export function validateTrackplan(plan: TrackplanFile, variables?: VariablesDocLike): string[] {
  const errors: string[] = [];
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
  if (nodeById.size !== plan.nodes.length) errors.push('duplicate node ids');
  if (edgeById.size !== plan.edges.length) errors.push('duplicate edge ids');

  const incident = new Map<string, string[]>(plan.nodes.map((n) => [n.id, []]));
  for (const e of plan.edges) {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (!from) errors.push(`edge ${e.id}: unknown from-node ${e.from}`);
    if (!to) errors.push(`edge ${e.id}: unknown to-node ${e.to}`);
    if (e.pts.length < 2) errors.push(`edge ${e.id}: polyline needs >= 2 points`);
    if (from && dist(e.pts[0] as Vec2, from.pt) > 0.01) {
      errors.push(`edge ${e.id}: polyline start does not coincide with node ${e.from}`);
    }
    if (to && dist(e.pts[e.pts.length - 1] as Vec2, to.pt) > 0.01) {
      errors.push(`edge ${e.id}: polyline end does not coincide with node ${e.to}`);
    }
    incident.get(e.from)?.push(e.id);
    incident.get(e.to)?.push(e.id);
  }

  for (const n of plan.nodes) {
    const deg = (incident.get(n.id) ?? []).length;
    const want = n.kind === 'buffer' ? 1 : n.kind === 'plain' ? 2 : 3;
    if (deg !== want) errors.push(`${n.kind} node ${n.id}: degree ${deg}, expected ${want}`);
  }

  const switchByNode = new Map<string, SwitchSpec>();
  for (const sw of plan.switches) {
    const node = nodeById.get(sw.nodeId);
    if (!node || node.kind !== 'switch') {
      errors.push(`switch ${sw.id}: node ${sw.nodeId} missing or not kind "switch"`);
      continue;
    }
    if (switchByNode.has(sw.nodeId)) errors.push(`node ${sw.nodeId}: more than one switch`);
    switchByNode.set(sw.nodeId, sw);
    const inc = incident.get(sw.nodeId) ?? [];
    const legs = [sw.toeEdgeId, ...sw.branchEdgeIds];
    if (new Set(legs).size !== 3) errors.push(`switch ${sw.id}: toe/branch edges not distinct`);
    for (const leg of legs) {
      if (!edgeById.has(leg)) errors.push(`switch ${sw.id}: unknown edge ${leg}`);
      else if (!inc.includes(leg)) errors.push(`switch ${sw.id}: edge ${leg} not incident to ${sw.nodeId}`);
    }
    if ([...inc].sort().join() !== [...legs].sort().join()) {
      errors.push(`switch ${sw.id}: incident edges of ${sw.nodeId} differ from toe+branches`);
    }
    if (sw.coilToBranch !== null && sw.coilToBranch.G === sw.coilToBranch.R) {
      errors.push(`switch ${sw.id}: G and R map to the same branch`);
    }
    if (sw.mappingSource === 'derived' && !sw.mappingEvidence) {
      errors.push(`switch ${sw.id}: derived mapping without evidence`);
    }
  }
  for (const n of plan.nodes) {
    if (n.kind === 'switch' && !switchByNode.has(n.id)) errors.push(`switch node ${n.id}: no switch spec`);
  }

  const reedIds = new Set<string>();
  for (const r of plan.reeds) {
    if (reedIds.has(r.id)) errors.push(`duplicate reed id ${r.id}`);
    reedIds.add(r.id);
    const edge = edgeById.get(r.edgeId);
    if (!edge) {
      errors.push(`reed ${r.id}: unknown edge ${r.edgeId}`);
      continue;
    }
    const len = polyLengthMm(edge.pts, plan.meta.mmPerUnit);
    if (r.offsetMm < 0 || r.offsetMm > len) {
      errors.push(`reed ${r.id}: offset ${r.offsetMm} outside edge ${r.edgeId} (0..${len.toFixed(1)} mm)`);
    }
  }

  if (variables) {
    const symbols = new Set(variables.entries.map((e) => e.symbol));
    const documentedReeds = new Set(
      variables.entries.filter((e) => e.symbol.startsWith('xR')).map((e) => e.symbol),
    );
    const wired = plan.reeds.filter((r) => r.wired).map((r) => r.id);
    for (const id of wired) {
      if (!documentedReeds.has(id)) errors.push(`wired reed ${id} has no Variablenliste symbol`);
    }
    if (wired.length !== documentedReeds.size) {
      errors.push(`wired reeds (${wired.length}) != documented reed inputs (${documentedReeds.size})`);
    }
    for (const sw of plan.switches) {
      if (sw.coilToBranch === null) continue;
      for (const coil of ['G', 'R'] as const) {
        const plain = `${sw.id}${coil}`;
        const upper = `X${sw.id.slice(1)}${coil}`; // the two capital-X traps
        if (!symbols.has(plain) && !symbols.has(upper)) {
          errors.push(`switch ${sw.id}: coil symbol ${plain} missing from variables.json`);
        }
      }
    }
  }

  const start = edgeById.get(plan.start.edgeId);
  if (!start) errors.push(`start: unknown edge ${plan.start.edgeId}`);
  else {
    const len = polyLengthMm(start.pts, plan.meta.mmPerUnit);
    if (plan.start.offsetMm < 0 || plan.start.offsetMm > len) errors.push('start offset outside edge');
  }
  for (const t of plan.landscape.tunnels) {
    for (const id of t.edgeIds) if (!edgeById.has(id)) errors.push(`landscape tunnel: unknown edge ${id}`);
  }
  return errors;
}

// ─────────────────────────────── §8 route scripts (task-derived) ──────────────────────────

export interface RouteLeg {
  /** Provenance: which network's trigger/commands this leg encodes. */
  note: string;
  /** Coil commands applied (in order) BEFORE walking — the network's switch list. */
  commands?: ReadonlyArray<{ switchId: string; coil: 'G' | 'R' }>;
  /** Sägefahrt: flip travel direction before walking. */
  reverse?: boolean;
  /** Traction command while walking (for the direction-consistency ledger). */
  command: 'IU' | 'GU';
  /** Walk until this reed is passed. */
  toReed: string;
}

export interface RouteScript {
  id: 'A' | 'B';
  legs: readonly RouteLeg[];
}

const c = (switchId: string, coil: 'G' | 'R') => ({ switchId, coil });

/** Gruppe A (Gruppe_A_Aufgabe_SS2026.txt): Rangierfahrt aufs Abstellgleis, 2 Runden. */
export const ROUTE_A: RouteScript = {
  id: 'A',
  legs: [
    { note: 'start -> A-NW3 trigger', command: 'IU', toReed: 'xR01BH1G1' },
    { note: 'A-NW3: exit BH1 G1 onto Gleis A', command: 'IU', toReed: 'xR03A',
      commands: [c('xW01BH1G1', 'G'), c('xW02BH1G1', 'R')] },
    { note: 'A-NW4: full speed (no switches)', command: 'IU', toReed: 'xR01A' },
    { note: 'A-NW5: route through BH2 G3', command: 'IU', toReed: 'xR02BH2G3',
      commands: [c('xW02BH2G1', 'R'), c('xW04BH2G2', 'R'), c('xW03BH2G2', 'R'), c('xW02BH2G3', 'R'), c('xW03BH2G3', 'G')] },
    { note: 'A-NW6: exit BH2 east', command: 'IU', toReed: 'xR03D',
      commands: [c('xW01BH2G3', 'R'), c('xW02BH2G2', 'G'), c('xW01BH2G2', 'R')] },
    { note: 'A-NW7: down Gleis D', command: 'IU', toReed: 'xR01D',
      commands: [c('xW02D', 'G'), c('xW05D', 'G'), c('xW04D', 'R'), c('xW01D', 'R'), c('xW03D', 'G')] },
    { note: 'A-NW8: reverse, push back toward BH3', command: 'GU', toReed: 'xR01BH3G2', reverse: true,
      commands: [c('xW02D', 'R'), c('xW01D', 'G')] },
    { note: 'A-NW9: onto BH3 Gleis 3 (Abstellgleis)', command: 'GU', toReed: 'xR02BH3G3',
      commands: [c('xW02BH3G2', 'R')] },
    { note: 'A-NW10: reverse, back to BH1 G1 via Ostkopf', command: 'IU', toReed: 'xR01BH1G1', reverse: true,
      commands: [c('xW03BH1G4', 'G'), c('xW05BH1G3', 'G'), c('xW04BH1G2', 'G'), c('xW05BH1G2', 'G')] },
    // Runde 2 — same reed-triggered networks fire again, but NW8 (Rangierfahrt) is
    // round-gated and must NOT re-trigger ("nur in der ersten Runde").
    { note: 'round 2, A-NW3', command: 'IU', toReed: 'xR03A',
      commands: [c('xW01BH1G1', 'G'), c('xW02BH1G1', 'R')] },
    { note: 'round 2, A-NW5', command: 'IU', toReed: 'xR02BH2G3',
      commands: [c('xW02BH2G1', 'R'), c('xW04BH2G2', 'R'), c('xW03BH2G2', 'R'), c('xW02BH2G3', 'R'), c('xW03BH2G3', 'G')] },
    { note: 'round 2, A-NW6', command: 'IU', toReed: 'xR03D',
      commands: [c('xW01BH2G3', 'R'), c('xW02BH2G2', 'G'), c('xW01BH2G2', 'R')] },
    { note: 'round 2, A-NW7', command: 'IU', toReed: 'xR01D',
      commands: [c('xW02D', 'G'), c('xW05D', 'G'), c('xW04D', 'R'), c('xW01D', 'R'), c('xW03D', 'G')] },
    { note: 'round 2, no Rangierfahrt — through D/Ostkopf to Start/Ziel (A-NW11 stop)', command: 'IU', toReed: 'xR01BH1G1' },
  ],
};

/** Gruppe B (Gruppe_B_Aufgabe_SS2026.txt): See-Kehre + Rangieren in Bahnhof 1. */
export const ROUTE_B: RouteScript = {
  id: 'B',
  legs: [
    { note: 'start west out of BH1 G1 up the A connector', command: 'IU', toReed: 'xR03A' },
    { note: 'B-NW7: reverse, push back into BH1 G3', command: 'GU', toReed: 'xR03BH1G3', reverse: true,
      commands: [c('xW02BH1G1', 'G'), c('xW02BH1G2', 'R'), c('xW03BH1G2', 'G'), c('xW02BH1G3', 'R'), c('xW03BH1G3', 'R')] },
    { note: 'B-NW8: reverse, out west onto Gleis B', command: 'IU', toReed: 'xR03B', reverse: true,
      commands: [c('xW03BH1G2', 'R'), c('xW01BH1G2', 'R')] },
    { note: 'B-NW9: over BH2 G2 and down Gleis D', command: 'IU', toReed: 'xR01D',
      commands: [c('xW04BH2G2', 'G'), c('xW03BH2G2', 'G'), c('xW02BH2G2', 'R'), c('xW01BH2G2', 'R'), c('xW04D', 'G'), c('xW05D', 'G'), c('xW02D', 'G')] },
    { note: 'first xR01D closure — B-NW10 waits for the SECOND; into BH1 G4 on initial positions', command: 'IU', toReed: 'xR03BH1G4' },
    { note: 'B-NW3: into the See-Kehre', command: 'IU', toReed: 'xR01K',
      commands: [c('xW02BH1G4', 'R'), c('xW03C', 'G'), c('xW04C', 'G')] },
    { note: 'B-NW4: around the loop, out toward BH3', command: 'IU', toReed: 'xR01BH3G2',
      commands: [c('xW03C', 'R'), c('xW03BH3G2', 'R'), c('xW02BH3G2', 'G'), c('xW04C', 'R'), c('xW02C', 'R')] },
    { note: 'B-NW5: onto the Hauptstrecke (second D pass)', command: 'IU', toReed: 'xR01D',
      commands: [c('xW01D', 'G'), c('xW02D', 'R'), c('xW03D', 'G'), c('xW03BH1G4', 'G'), c('xW05BH1G3', 'G'), c('xW04BH1G2', 'G'), c('xW05BH1G2', 'G')] },
    { note: 'B-NW10: second xR01D — back into the original Gleis 4 (B-NW11 stop)', command: 'IU', toReed: 'xR03BH1G4',
      commands: [c('xW03BH1G4', 'R')] },
  ],
};

// ─────────────────────────────────────── route walker ─────────────────────────────────────

export interface WalkResult {
  ok: boolean;
  errors: string[];
  /** switchTrailed-style warnings: trailing entries whose position did not match. */
  trailingWarnings: string[];
  /** every edge traversal: edgeId, sign relative to from→to, traction command. */
  traversals: Array<{ edgeId: string; sign: 1 | -1; command: 'IU' | 'GU'; leg: string }>;
  log: string[];
}

interface WalkerState {
  edgeId: string;
  offsetMm: number;
  sign: 1 | -1;
}

export function walkRoute(plan: TrackplanFile, route: RouteScript): WalkResult {
  const res: WalkResult = { ok: true, errors: [], trailingWarnings: [], traversals: [], log: [] };
  const edgeById = new Map(plan.edges.map((e) => [e.id, e]));
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const switchById = new Map(plan.switches.map((s) => [s.id, s]));
  const switchByNode = new Map(plan.switches.map((s) => [s.nodeId, s]));
  const reedById = new Map<string, ReedSpec>(plan.reeds.map((r) => [r.id, r]));
  const incident = new Map<string, string[]>(plan.nodes.map((n) => [n.id, []]));
  for (const e of plan.edges) {
    incident.get(e.from)?.push(e.id);
    incident.get(e.to)?.push(e.id);
  }
  const lengthMm = (edgeId: string): number =>
    polyLengthMm((edgeById.get(edgeId) as { pts: readonly Vec2[] }).pts, plan.meta.mmPerUnit);

  const positions = new Map<string, 0 | 1>(plan.switches.map((s) => [s.id, s.initialPosition]));
  const state: WalkerState = {
    edgeId: plan.start.edgeId,
    offsetMm: plan.start.offsetMm,
    sign: plan.start.direction,
  };

  const fail = (msg: string): void => {
    res.ok = false;
    res.errors.push(msg);
  };

  for (const leg of route.legs) {
    for (const cmd of leg.commands ?? []) {
      const sw = switchById.get(cmd.switchId);
      if (!sw) {
        fail(`${leg.note}: command references unknown switch ${cmd.switchId}`);
        continue;
      }
      if (sw.coilToBranch === null) {
        fail(`${leg.note}: command on non-commandable switch ${cmd.switchId}`);
        continue;
      }
      positions.set(sw.id, sw.coilToBranch[cmd.coil]);
    }
    if (leg.reverse) state.sign = state.sign === 1 ? -1 : 1;

    const reed = reedById.get(leg.toReed);
    if (!reed) {
      fail(`${leg.note}: unknown reed ${leg.toReed}`);
      break;
    }

    let reached = false;
    for (let steps = 0; steps < 200; steps++) {
      // reed on current edge and ahead in travel direction?
      if (state.edgeId === reed.edgeId) {
        const ahead = state.sign === 1 ? reed.offsetMm >= state.offsetMm - 1e-6 : reed.offsetMm <= state.offsetMm + 1e-6;
        if (ahead) {
          res.traversals.push({ edgeId: state.edgeId, sign: state.sign, command: leg.command, leg: leg.note });
          state.offsetMm = reed.offsetMm;
          reached = true;
          res.log.push(`${route.id} | ${leg.note}: reached ${leg.toReed} on ${reed.edgeId}`);
          break;
        }
      }
      // advance to the node at the end of the edge in travel direction
      res.traversals.push({ edgeId: state.edgeId, sign: state.sign, command: leg.command, leg: leg.note });
      const edge = edgeById.get(state.edgeId) as { id: string; from: string; to: string };
      const nodeId = state.sign === 1 ? edge.to : edge.from;
      const node = nodeById.get(nodeId);
      if (!node) {
        fail(`${leg.note}: edge ${state.edgeId} references unknown node ${nodeId}`);
        break;
      }
      let nextEdgeId: string;
      if (node.kind === 'buffer') {
        fail(`${leg.note}: hit buffer ${nodeId} before reaching ${leg.toReed}`);
        break;
      } else if (node.kind === 'plain') {
        const other = (incident.get(nodeId) ?? []).find((id) => id !== state.edgeId);
        if (!other) {
          fail(`${leg.note}: plain node ${nodeId} has no continuation`);
          break;
        }
        nextEdgeId = other;
      } else {
        const sw = switchByNode.get(nodeId) as SwitchSpec;
        if (state.edgeId === sw.toeEdgeId) {
          nextEdgeId = sw.branchEdgeIds[positions.get(sw.id) as 0 | 1];
        } else {
          const idx = sw.branchEdgeIds.indexOf(state.edgeId) as 0 | 1;
          if (positions.get(sw.id) !== idx) {
            res.trailingWarnings.push(
              `${route.id} | ${leg.note}: trailing ${sw.id} from ${state.edgeId} while set to branch ${positions.get(sw.id)}`,
            );
          }
          nextEdgeId = sw.toeEdgeId;
        }
      }
      const next = edgeById.get(nextEdgeId);
      if (!next) {
        fail(`${leg.note}: unknown continuation edge ${nextEdgeId}`);
        break;
      }
      // entry orientation on the next edge
      if (next.from === nodeId) {
        state.edgeId = nextEdgeId;
        state.sign = 1;
        state.offsetMm = 0;
      } else {
        state.edgeId = nextEdgeId;
        state.sign = -1;
        state.offsetMm = lengthMm(nextEdgeId);
      }
      if (!res.ok) break;
    }
    if (!reached && res.ok) fail(`${leg.note}: step cap hit before reaching ${leg.toReed}`);
    if (!res.ok) break;
  }
  return res;
}

/**
 * §8 See-Kehre consistency proof: across BOTH walks, no edge is traversed in opposite
 * directions under the same traction command. Returns violation strings (empty = proven).
 */
export function directionConflicts(walks: readonly WalkResult[]): string[] {
  const seen = new Map<string, Map<'IU' | 'GU', Set<1 | -1>>>();
  for (const w of walks) {
    for (const t of w.traversals) {
      const byCmd = seen.get(t.edgeId) ?? new Map<'IU' | 'GU', Set<1 | -1>>();
      const signs = byCmd.get(t.command) ?? new Set<1 | -1>();
      signs.add(t.sign);
      byCmd.set(t.command, signs);
      seen.set(t.edgeId, byCmd);
    }
  }
  const conflicts: string[] = [];
  for (const [edgeId, byCmd] of seen) {
    for (const [command, signs] of byCmd) {
      if (signs.size > 1) conflicts.push(`edge ${edgeId} traversed in both directions under ${command}`);
    }
  }
  return conflicts;
}

/**
 * §8 initialPosition rule: with NO commands, the outer mainline circuit must be closed —
 * a program-less walk from the start returns to the start edge within a lap.
 */
export function initialLapClosed(plan: TrackplanFile): { ok: boolean; error?: string; edges: string[] } {
  const lap = walkRoute(plan, {
    id: 'A',
    legs: [
      { note: 'program-less lap out', command: 'IU', toReed: 'xR03A' },
      { note: 'program-less lap home', command: 'IU', toReed: 'xR02BH1G1' },
    ],
  });
  return {
    ok: lap.ok,
    ...(lap.ok ? {} : { error: lap.errors.join('; ') }),
    edges: lap.traversals.map((t) => t.edgeId),
  };
}

// ─────────────────────────────────────────── CLI ──────────────────────────────────────────

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const plan = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'trackplan.json'), 'utf8')) as TrackplanFile;
  const variables = JSON.parse(
    readFileSync(join(here, '..', 'src', 'data', 'variables.json'), 'utf8'),
  ) as VariablesDocLike;

  const errors = validateTrackplan(plan, variables);
  const walkA = walkRoute(plan, ROUTE_A);
  const walkB = walkRoute(plan, ROUTE_B);
  const conflicts = directionConflicts([walkA, walkB]);
  const lap = initialLapClosed(plan);

  for (const line of [...walkA.log, ...walkB.log]) console.log(line);
  for (const w of [...walkA.trailingWarnings, ...walkB.trailingWarnings]) console.log(`WARN ${w}`);

  const allErrors = [
    ...errors,
    ...walkA.errors.map((e) => `route A: ${e}`),
    ...walkB.errors.map((e) => `route B: ${e}`),
    ...conflicts,
    ...(lap.ok ? [] : [`initial-position lap: ${lap.error ?? 'not closed'}`]),
  ];
  if (allErrors.length > 0) {
    console.error(`validate-trackplan: ${allErrors.length} error(s):`);
    for (const e of allErrors) console.error(`  - ${e}`);
    proc.exit(1);
  }
  console.log(
    `validate-trackplan: OK — ${plan.nodes.length} nodes, ${plan.edges.length} edges, ` +
      `${plan.switches.length} switches, ${plan.reeds.length} reeds; ` +
      `route A ${walkA.traversals.length} edge traversals, route B ${walkB.traversals.length}; ` +
      `${walkA.trailingWarnings.length + walkB.trailingWarnings.length} trailing warnings (expected, see §8)`,
  );
}

const isMain = proc.argv[1] !== undefined
  && /validate-trackplan\.(ts|js|mts|mjs)$/.test(proc.argv[1].replace(/\\/g, '/'));
if (isMain) main();
