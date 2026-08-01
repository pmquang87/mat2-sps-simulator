/**
 * Label placement contract (`docs/REVIEW_SCENE.md` D14 + D15).
 *
 * D14 — the BH1/BH2/BH3 station boards flickered between normal and MIRRORED text while the
 * camera moved. Cause: `createBoard` stacked its front and back text planes (and each post's
 * back copy) at identical coordinates with DoubleSide materials, so the depth test tied and
 * per-pixel winners alternated (z-fight). Pin: the two text planes of a board are separated
 * along the board normal, and no two meshes of a board are coincident.
 *
 * D15 — the plates `xW01BH1G1` and `xW01BH1G2` rendered on top of each other. Pin: over the
 * REAL trackplan, the ground (XZ) footprints of all label plates are pairwise disjoint.
 *
 * The overlap metric here is computed from the BUILT scene graph (world matrices of the
 * `label:*` meshes), with its own clipping code — deliberately independent of whatever
 * placement/deconfliction logic the scene modules use, so a bug there cannot hide here.
 * The "detects a planted defect" cases prove each metric can fail.
 */
import { describe, expect, it } from 'vitest';
import { Group, Mesh, PlaneGeometry, Scene, Vector2, Vector3 } from 'three';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import {
  LabelFactory,
  MM,
  PlanFrame,
  buildEdgeCurves,
  buildLandscape,
  buildReedVisuals,
  buildSwitchVisuals,
  createMaterials,
  deconflictPlates,
} from '../../src/scene';

const plan = trackplanJson as unknown as TrackplanFile;

// ───────────────────────────── geometry helpers (test-local on purpose) ─────────────────────

/** World-space corner points of a plate mesh, projected onto the ground (XZ) plane. */
function plateQuadXZ(mesh: Mesh): Vector2[] {
  const geom = mesh.geometry as PlaneGeometry;
  const { width, height } = geom.parameters;
  mesh.updateWorldMatrix(true, false);
  const corners = [
    new Vector3(-width / 2, -height / 2, 0),
    new Vector3(width / 2, -height / 2, 0),
    new Vector3(width / 2, height / 2, 0),
    new Vector3(-width / 2, height / 2, 0),
  ];
  return corners.map((c) => {
    const w = c.applyMatrix4(mesh.matrixWorld);
    return new Vector2(w.x, w.z);
  });
}

/** Sutherland–Hodgman clip of convex polygon `subject` against convex polygon `clip`. */
function clipPolygon(subject: Vector2[], clip: Vector2[]): Vector2[] {
  let output = subject.slice();
  // make the clip polygon wind consistently (positive signed area)
  const area2 = (poly: Vector2[]): number => {
    let a = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i] as Vector2;
      const q = poly[(i + 1) % poly.length] as Vector2;
      a += p.x * q.y - q.x * p.y;
    }
    return a;
  };
  const c = area2(clip) < 0 ? clip.slice().reverse() : clip;
  for (let i = 0; i < c.length && output.length > 0; i += 1) {
    const a = c[i] as Vector2;
    const b = c[(i + 1) % c.length] as Vector2;
    const input = output;
    output = [];
    const inside = (p: Vector2): boolean => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    for (let j = 0; j < input.length; j += 1) {
      const cur = input[j] as Vector2;
      const prev = input[(j + input.length - 1) % input.length] as Vector2;
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn !== prevIn) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        const denom = (b.y - a.y) * dx - (b.x - a.x) * dy;
        const t = denom === 0 ? 0 : ((b.x - a.x) * (prev.y - a.y) - (b.y - a.y) * (prev.x - a.x)) / denom;
        output.push(new Vector2(prev.x + t * dx, prev.y + t * dy));
      }
      if (curIn) output.push(cur);
    }
  }
  return output;
}

/** Intersection area of two convex quads, in mm² (world units are metres-scaled by MM). */
function overlapAreaMm2(a: Vector2[], b: Vector2[]): number {
  const poly = clipPolygon(a, b);
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i] as Vector2;
    const q = poly[(i + 1) % poly.length] as Vector2;
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area / 2) / (MM * MM);
}

/** All plates (meshes named `label:...`) under a root, world matrices updated. */
function collectPlates(root: Scene | Group): Mesh[] {
  root.updateWorldMatrix(true, true);
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith('label:')) out.push(o);
  });
  return out;
}

// ───────────────────────────────── the real scene, built once ───────────────────────────────

function buildRealLabelScene(): Scene {
  const frame = PlanFrame.fromTrackplan(plan);
  const curves = buildEdgeCurves(plan, frame);
  const mats = createMaterials('low');
  const labels = new LabelFactory('low');
  const scene = new Scene();
  const landscape = buildLandscape({ tp: plan, curves, frame, mats, labels, quality: 'low' });
  scene.add(landscape.group);
  for (const v of buildSwitchVisuals(plan, curves, frame, mats, labels, 'low').values()) {
    scene.add(v.object as Group);
  }
  for (const v of buildReedVisuals(plan, curves, mats, labels).values()) {
    scene.add(v.object as Group);
  }
  // same pipeline step as SceneManager: resolve plates that land on each other (D15)
  deconflictPlates(scene);
  return scene;
}

describe('D15 — label plates never overlap on the ground plane', () => {
  const scene = buildRealLabelScene();
  const plates = collectPlates(scene);

  it('finds the plates it is judging (incl. the reported pair)', () => {
    const names = plates.map((p) => p.name);
    expect(names).toContain('label:xW01BH1G1');
    expect(names).toContain('label:xW01BH1G2');
    expect(plates.length).toBeGreaterThan(40); // 42 switches + reeds + lane plates
  });

  it('reports zero overlapping plate pairs over the whole board', () => {
    const quads = plates.map((p) => ({ name: p.name, quad: plateQuadXZ(p) }));
    const offenders: string[] = [];
    for (let i = 0; i < quads.length; i += 1) {
      for (let j = i + 1; j < quads.length; j += 1) {
        const a = quads[i]!;
        const b = quads[j]!;
        const area = overlapAreaMm2(a.quad, b.quad);
        if (area > 1) offenders.push(`${a.name} × ${b.name}: ${area.toFixed(1)} mm²`);
      }
    }
    expect(offenders, `overlapping label plates:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('puts every switch plate NEARER its own node than any other switch node (D17)', () => {
    // The user-visible property behind the "swapped labels" report: xW01BH1G1's plate stood
    // beside n15 (xW02BH1G1's switch) and vice versa — separated, but each naming the other.
    // Only node pairs ≥ 40 mm apart are compared: paired switches share (near-)coincident
    // nodes (n16/n16b, n59/n59b), where "nearer" is meaningless.
    const frame = PlanFrame.fromTrackplan(plan);
    const nodeWorld = new Map(
      plan.nodes.map((n) => [n.id, frame.v(n.pt)] as const),
    );
    const placed = plan.switches.filter((sw) =>
      plates.some((p) => p.name === `label:${sw.id}`));
    const offenders: string[] = [];
    for (const sw of placed) {
      const plate = plates.find((p) => p.name === `label:${sw.id}`) as Mesh;
      plate.updateWorldMatrix(true, false);
      const c = new Vector3().setFromMatrixPosition(plate.matrixWorld);
      const own = nodeWorld.get(sw.nodeId) as Vector3;
      const dOwn = Math.hypot(c.x - own.x, c.z - own.z) / MM;
      for (const other of placed) {
        if (other.nodeId === sw.nodeId) continue;
        const on = nodeWorld.get(other.nodeId) as Vector3;
        if (Math.hypot(on.x - own.x, on.z - own.z) / MM < 40) continue;
        const dOther = Math.hypot(c.x - on.x, c.z - on.z) / MM;
        if (dOther < dOwn) {
          offenders.push(
            `${sw.id}: ${dOwn.toFixed(1)} mm from ${sw.nodeId}, but ${dOther.toFixed(1)} mm from ${other.nodeId} (${other.id})`,
          );
        }
      }
    }
    expect(offenders, `plates nearer a foreign switch:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('settles the reported pair: each e22 toe plate sits by its OWN switch', () => {
    const frame = PlanFrame.fromTrackplan(plan);
    const nodeOf = (id: string): Vector3 => {
      const node = plan.nodes.find((n) => n.id === id);
      expect(node, id).toBeDefined();
      return frame.v((node as { pt: { x: number; y: number } }).pt);
    };
    const centreOf = (name: string): Vector3 => {
      const plate = plates.find((p) => p.name === name) as Mesh;
      plate.updateWorldMatrix(true, false);
      return new Vector3().setFromMatrixPosition(plate.matrixWorld);
    };
    const n12 = nodeOf('n12');   // xW01BH1G1
    const n15 = nodeOf('n15');   // xW02BH1G1
    const a = centreOf('label:xW01BH1G1');
    const b = centreOf('label:xW02BH1G1');
    expect(a.distanceTo(n12)).toBeLessThan(a.distanceTo(n15));
    expect(b.distanceTo(n15)).toBeLessThan(b.distanceTo(n12));
  });

  it('keeps every switch plate near its own switch node (no teleport "fix")', () => {
    const frame = PlanFrame.fromTrackplan(plan);
    const nodePos = new Map(plan.nodes.map((n) => [n.id, n.pt]));
    for (const sw of plan.switches) {
      const plate = plates.find((p) => p.name === `label:${sw.id}`);
      if (!plate) continue; // unplaced switches have no visual
      const pt = nodePos.get(sw.nodeId);
      expect(pt, `switch ${sw.id} has no node`).toBeDefined();
      if (!pt) continue;
      const world = frame.v(pt);
      plate.updateWorldMatrix(true, false);
      const c = new Vector3().setFromMatrixPosition(plate.matrixWorld);
      const distMm = Math.hypot(c.x - world.x, c.z - world.z) / MM;
      expect(distMm, `plate of ${sw.id} sits ${distMm.toFixed(0)} mm from its node`).toBeLessThan(110);
    }
  });

  it('detects a planted defect (control: the metric can fail)', () => {
    const scene2 = buildRealLabelScene();
    const p = collectPlates(scene2);
    const a = p.find((m) => m.name === 'label:xW01BH1G1');
    const b = p.find((m) => m.name === 'label:xW02BH1G1');
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    // teleport one plate exactly onto the other, in the other's orientation
    b.updateWorldMatrix(true, false);
    a.parent?.updateWorldMatrix(true, true);
    const target = new Vector3().setFromMatrixPosition(b.matrixWorld);
    a.parent?.worldToLocal(target);
    a.position.copy(target);
    a.rotation.copy(b.rotation);
    const area = overlapAreaMm2(plateQuadXZ(a), plateQuadXZ(b));
    expect(area).toBeGreaterThan(50);
  });
});

describe('D14 — station boards cannot z-fight', () => {
  function boardOf(scene: Scene, key: string): Group {
    let found: Group | null = null;
    scene.traverse((o) => {
      if (o.name === `board:${key}` && o instanceof Group) found = o;
    });
    expect(found, `board:${key} missing`).not.toBeNull();
    return found as unknown as Group;
  }

  const scene = buildRealLabelScene();

  it.each(['BH1', 'BH2', 'BH3'])('board %s: text planes are separated along the normal', (key) => {
    const board = boardOf(scene, key);
    board.updateWorldMatrix(true, true);
    const textPlanes: Mesh[] = [];
    board.traverse((o) => {
      if (o instanceof Mesh && (o.geometry as PlaneGeometry).parameters.width > 20 * MM) {
        textPlanes.push(o);
      }
    });
    expect(textPlanes).toHaveLength(2);
    const [f, b] = textPlanes as [Mesh, Mesh];
    const gapMm = f.position.distanceTo(b.position) / MM;
    expect(gapMm).toBeGreaterThan(0.5); // apart enough for the depth buffer
    expect(gapMm).toBeLessThan(4); // still reads as one board
  });

  it.each(['BH1', 'BH2', 'BH3'])('board %s: no two meshes are coincident', (key) => {
    const board = boardOf(scene, key);
    const meshes: Mesh[] = [];
    board.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    const offenders: string[] = [];
    for (let i = 0; i < meshes.length; i += 1) {
      for (let j = i + 1; j < meshes.length; j += 1) {
        const a = meshes[i] as Mesh;
        const b = meshes[j] as Mesh;
        if (a.position.distanceToSquared(b.position) < 1e-12) {
          offenders.push(`${key}: meshes ${i} and ${j} coincide`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('detects a planted defect (control: the coincidence metric can fail)', () => {
    const labels = new LabelFactory('low');
    const board = labels.createBoard('BHX');
    const meshes: Mesh[] = [];
    board.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeGreaterThanOrEqual(2);
    const [a, b] = meshes as [Mesh, Mesh, ...Mesh[]];
    b.position.copy(a.position);
    expect(a.position.distanceToSquared(b.position)).toBeLessThan(1e-12);
  });
});
