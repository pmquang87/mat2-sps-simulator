/**
 * Label plates of the pump scene (the D15 contract of `docs/REVIEW_SCENE.md`, applied to the
 * second experiment): the ground (XZ) footprints of all plates are pairwise disjoint, so no
 * plate can render on top of another and no signal can be read off the wrong plate.
 *
 * The overlap metric is computed from the BUILT graph with its own clipping code, exactly
 * like `tests/scene/labelPlacement.test.ts` — deliberately independent of `deconflictPlates`,
 * so a bug there cannot hide here. The planted-defect case proves the metric can fail.
 *
 * Plate TEXT is checked too: it is the didactic payload (symbol + absolute address), and the
 * addresses come from the same variables list `buildPumpWiring` verifies against the manual.
 */
import { describe, expect, it } from 'vitest';
import { Mesh, Object3D, PlaneGeometry, Vector2, Vector3 } from 'three';
import {
  PUMP_ACTUATOR_IDS,
  PUMP_BUTTON_IDS,
  PUMP_SENSOR_IDS,
  PUMP_TOGGLE_IDS,
} from '../../../src/pump';
import {
  PUMP_ACTUATOR_SYMBOL,
  PUMP_BUTTON_SYMBOL,
  PUMP_SENSOR_SYMBOL,
  PUMP_TOGGLE_SYMBOL,
  buildPumpSceneGraph,
  signalPlateText,
} from '../../../src/pump/scene';
import { plantAt } from './fixture';

/** World XZ corners of a plate's `PlaneGeometry` footprint. */
function plateQuadXZ(mesh: Mesh): Vector2[] {
  const { width, height } = (mesh.geometry as PlaneGeometry).parameters;
  mesh.updateWorldMatrix(true, false);
  return [
    new Vector3(-width / 2, -height / 2, 0),
    new Vector3(width / 2, -height / 2, 0),
    new Vector3(width / 2, height / 2, 0),
    new Vector3(-width / 2, height / 2, 0),
  ].map((c) => {
    const w = c.applyMatrix4(mesh.matrixWorld);
    return new Vector2(w.x, w.z);
  });
}

/** Sutherland–Hodgman clip of convex `subject` against convex `clip`. */
function clipPolygon(subject: Vector2[], clip: Vector2[]): Vector2[] {
  const area2 = (poly: Vector2[]): number => {
    let a = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i] as Vector2;
      const q = poly[(i + 1) % poly.length] as Vector2;
      a += p.x * q.y - q.x * p.y;
    }
    return a;
  };
  let output = subject.slice();
  const c = area2(clip) < 0 ? clip.slice().reverse() : clip;
  for (let i = 0; i < c.length && output.length > 0; i += 1) {
    const a = c[i] as Vector2;
    const b = c[(i + 1) % c.length] as Vector2;
    const input = output;
    output = [];
    const inside = (p: Vector2): boolean =>
      (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
    for (let j = 0; j < input.length; j += 1) {
      const cur = input[j] as Vector2;
      const prev = input[(j + input.length - 1) % input.length] as Vector2;
      if (inside(cur) !== inside(prev)) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        const denom = (b.y - a.y) * dx - (b.x - a.x) * dy;
        const t = denom === 0
          ? 0
          : ((b.x - a.x) * (prev.y - a.y) - (b.y - a.y) * (prev.x - a.x)) / denom;
        output.push(new Vector2(prev.x + t * dx, prev.y + t * dy));
      }
      if (inside(cur)) output.push(cur);
    }
  }
  return output;
}

/** Intersection area of two convex quads, in mm² (world units are metres). */
function overlapAreaMm2(a: Vector2[], b: Vector2[]): number {
  const poly = clipPolygon(a, b);
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i] as Vector2;
    const q = poly[(i + 1) % poly.length] as Vector2;
    area += p.x * q.y - q.x * p.y;
  }
  return (Math.abs(area / 2) * 1e6);
}

function collectPlates(root: Object3D): Mesh[] {
  root.updateWorldMatrix(true, true);
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith('label:')) out.push(o);
  });
  return out;
}

/** A graph settled on a real snapshot — probe plates move with their thresholds. */
function settledGraph(): ReturnType<typeof buildPumpSceneGraph> {
  const graph = buildPumpSceneGraph({ quality: 'low' });
  graph.update(plantAt({ volA: 100, volB: 0 }).snapshot(), 0);
  return graph;
}

describe('pump label plates', () => {
  it('carries one plate per signal, naming symbol AND absolute address', () => {
    const graph = settledGraph();
    try {
      const names = new Set(collectPlates(graph.root).map((p) => p.name));
      for (const id of PUMP_SENSOR_IDS) {
        expect(names).toContain(`label:${signalPlateText(PUMP_SENSOR_SYMBOL[id])}`);
      }
      for (const id of PUMP_BUTTON_IDS) {
        expect(names).toContain(`label:${signalPlateText(PUMP_BUTTON_SYMBOL[id])}`);
      }
      for (const id of PUMP_TOGGLE_IDS) {
        expect(names).toContain(`label:${signalPlateText(PUMP_TOGGLE_SYMBOL[id])}`);
      }
      for (const id of PUMP_ACTUATOR_IDS) {
        expect(names).toContain(`label:${signalPlateText(PUMP_ACTUATOR_SYMBOL[id])}`);
      }
      // plus the two vessels and the two hand valves
      expect(names).toContain('label:Tank A');
      expect(names).toContain('label:Tank B');
      expect(names).toContain('label:V1 (inA)');
      expect(names).toContain('label:V2 (outB)');
      expect(names.size).toBeGreaterThanOrEqual(20);
    } finally {
      graph.dispose();
    }
  });

  it('spells the address exactly as the Anleitung wires it', () => {
    expect(signalPlateText('S1')).toBe('S1 (E 0.0)');
    expect(signalPlateText('LS_Pumpe')).toBe('LS_Pumpe (E 0.5)');
    expect(signalPlateText('Pumpe')).toBe('Pumpe (A 0.1)');
    expect(() => signalPlateText('KeinSymbol')).toThrow(/variables list/);
  });

  it('reports zero overlapping plate pairs over the whole plant', () => {
    const graph = settledGraph();
    try {
      const plates = collectPlates(graph.root);
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
    } finally {
      graph.dispose();
    }
  });

  it('stays disjoint after the student moves the thresholds', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({ volA: 50, volB: 50 });
      plant.setParams({ llsThresholdPct: 20, hlsThresholdPct: 80 });
      graph.update(plant.snapshot(), 0);
      const quads = collectPlates(graph.root).map((p) => ({ name: p.name, quad: plateQuadXZ(p) }));
      const offenders: string[] = [];
      for (let i = 0; i < quads.length; i += 1) {
        for (let j = i + 1; j < quads.length; j += 1) {
          const a = quads[i]!;
          const b = quads[j]!;
          if (overlapAreaMm2(a.quad, b.quad) > 1) offenders.push(`${a.name} × ${b.name}`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    } finally {
      graph.dispose();
    }
  });

  it('keeps every plate near what it names', () => {
    const graph = settledGraph();
    try {
      for (const plate of collectPlates(graph.root)) {
        const anchor = plate.userData['anchorWorld'] as Vector3 | undefined;
        expect(anchor, `${plate.name} has no anchor`).toBeDefined();
        if (!anchor) continue;
        plate.updateWorldMatrix(true, false);
        const centre = new Vector3().setFromMatrixPosition(plate.matrixWorld);
        expect(centre.distanceTo(anchor), `${plate.name} drifted from its referent`)
          .toBeLessThan(0.32);
      }
    } finally {
      graph.dispose();
    }
  });

  it('detects a planted defect (control: the overlap metric can fail)', () => {
    const graph = settledGraph();
    try {
      const plates = collectPlates(graph.root);
      const a = plates.find((p) => p.name === 'label:Tank A');
      const b = plates.find((p) => p.name === 'label:Tank B');
      expect(a && b).toBeTruthy();
      if (!a || !b) return;
      b.updateWorldMatrix(true, false);
      a.parent?.updateWorldMatrix(true, true);
      const target = new Vector3().setFromMatrixPosition(b.matrixWorld);
      a.parent?.worldToLocal(target);
      a.position.copy(target);
      a.rotation.copy(b.rotation);
      expect(overlapAreaMm2(plateQuadXZ(a), plateQuadXZ(b))).toBeGreaterThan(50);
    } finally {
      graph.dispose();
    }
  });
});
