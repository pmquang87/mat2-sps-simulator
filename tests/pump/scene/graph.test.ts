/**
 * What the pump scene must show, measured on the BUILT graph in the node environment (no
 * WebGL): the graph builder and the animation live in `pump/scene/graph.ts`, only the
 * renderer and the DOM listeners live in `PumpScene`, so everything below judges the same
 * objects the browser draws.
 *
 * Each metric is computed independently of the code under test (world bounding boxes and
 * world matrices, not the scene's own scale factors), and each block carries a
 * planted-defect control where the metric could otherwise be vacuous.
 */
import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { PUMP_SENSOR_IDS } from '../../../src/pump';
import type { PumpSensorId } from '../../../src/pump';
import {
  LIQUID_HEIGHT,
  PUMP_DIM,
  buildPumpSceneGraph,
  dischargeOutlet,
  drainOutlet,
  levelY,
  refillOutlet,
} from '../../../src/pump/scene';
import {
  plantAt,
  pumpingSnapshot,
  requireObject,
  snapshotAt,
  worldBox,
  worldHeight,
  worldMatrixDigest,
  worldPosition,
} from './fixture';

function ledMaterial(root: Group, id: PumpSensorId): MeshStandardMaterial {
  const led = requireObject(root, `pump:probeLed:${id}`) as Mesh;
  return led.material as MeshStandardMaterial;
}

describe('liquid columns track the tank levels', () => {
  it.each([0, 37, 100])('tank A at %i %% is that fraction of the column height', (pct) => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      graph.update(snapshotAt({ volA: pct, volB: 0 }), 0);
      const height = worldHeight(requireObject(graph.root, 'pump:liquid:A'));
      // Absolute tolerance, 0.01 mm: an empty column is parked at a 1 µm scale rather than
      // at 0, because a zero scale makes the world matrix singular.
      expect(Math.abs(height - (LIQUID_HEIGHT * pct) / 100)).toBeLessThan(1e-5);
    } finally {
      graph.dispose();
    }
  });

  it('is strictly proportional (37 % is 0.37 of 100 %) and hides an empty tank', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      graph.update(snapshotAt({ volA: 100 }), 0);
      const full = worldHeight(requireObject(graph.root, 'pump:liquid:A'));
      graph.update(snapshotAt({ volA: 37 }), 0);
      const part = worldHeight(requireObject(graph.root, 'pump:liquid:A'));
      expect(part / full).toBeCloseTo(0.37, 9);

      graph.update(snapshotAt({ volA: 0 }), 0);
      expect(requireObject(graph.root, 'pump:liquid:A').visible).toBe(false);
      expect(requireObject(graph.root, 'pump:surface:A').visible).toBe(false);
      expect(worldHeight(requireObject(graph.root, 'pump:liquid:A'))).toBeLessThan(1e-4);
    } finally {
      graph.dispose();
    }
  });

  it('puts the surface disc on top of the column', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      graph.update(snapshotAt({ volB: 62 }), 0);
      const column = worldBox(requireObject(graph.root, 'pump:liquid:B'));
      const surface = worldPosition(requireObject(graph.root, 'pump:surface:B'));
      // within the shimmer amplitude (≈ 3 mm) of the column top
      expect(Math.abs(surface.y - column.max.y)).toBeLessThan(0.006);
    } finally {
      graph.dispose();
    }
  });

  it('detects a planted defect (control: the height metric can fail)', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      graph.update(snapshotAt({ volA: 100 }), 0);
      const liquid = requireObject(graph.root, 'pump:liquid:A');
      const before = worldHeight(liquid);
      liquid.scale.y *= 0.5;
      expect(worldHeight(liquid)).toBeLessThan(before * 0.75);
    } finally {
      graph.dispose();
    }
  });
});

describe('sensor probes', () => {
  it('lights exactly the probes whose bit is 1', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      // A empty, B full: llsA, hlsB and ls (the pump is off → wetted) are the 1-bits.
      const snapshot = snapshotAt({ volA: 0, volB: 100 });
      graph.update(snapshot, 0);
      for (const id of PUMP_SENSOR_IDS) {
        const lit = ledMaterial(graph.root, id).emissiveIntensity > 0;
        expect(lit, `probe ${id} lit=${String(lit)} bit=${String(snapshot.sensors[id])}`)
          .toBe(snapshot.sensors[id]);
      }
      expect(snapshot.sensors.llsA).toBe(true);
      expect(snapshot.sensors.hlsB).toBe(true);
      expect(snapshot.sensors.hlsA).toBe(false);
    } finally {
      graph.dispose();
    }
  });

  it('follows every bit through a state change', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const first = snapshotAt({ volA: 100, volB: 0 });
      graph.update(first, 0);
      expect(ledMaterial(graph.root, 'hlsA').emissiveIntensity).toBeGreaterThan(0);
      expect(ledMaterial(graph.root, 'llsA').emissiveIntensity).toBe(0);

      const second = snapshotAt({ volA: 0, volB: 100 });
      graph.update(second, 0);
      expect(ledMaterial(graph.root, 'hlsA').emissiveIntensity).toBe(0);
      expect(ledMaterial(graph.root, 'llsA').emissiveIntensity).toBeGreaterThan(0);
    } finally {
      graph.dispose();
    }
  });

  it('places each probe at the height of ITS OWN threshold', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const snapshot = snapshotAt({});
      graph.update(snapshot, 0);
      expect(worldPosition(requireObject(graph.root, 'pump:probe:llsA')).y)
        .toBeCloseTo(levelY(snapshot.params.llsThresholdPct), 9);
      expect(worldPosition(requireObject(graph.root, 'pump:probe:hlsB')).y)
        .toBeCloseTo(levelY(snapshot.params.hlsThresholdPct), 9);
    } finally {
      graph.dispose();
    }
  });

  it('moves the probe when the student moves the threshold', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({});
      graph.update(plant.snapshot(), 0);
      const before = worldPosition(requireObject(graph.root, 'pump:probe:llsA')).y;

      plant.setParams({ llsThresholdPct: 18, hlsThresholdPct: 82 });
      const moved = plant.snapshot();
      graph.update(moved, 0);
      const afterLow = worldPosition(requireObject(graph.root, 'pump:probe:llsA')).y;
      const afterHigh = worldPosition(requireObject(graph.root, 'pump:probe:hlsA')).y;

      expect(afterLow).toBeGreaterThan(before + 0.05);
      expect(afterLow).toBeCloseTo(levelY(18), 9);
      expect(afterHigh).toBeCloseTo(levelY(82), 9);
      // the label plate rides with its probe, or it names the wrong height
      const plates: number[] = [];
      graph.root.traverse((o) => {
        if (o.name === 'label:LLS_TankA (E 0.1)') plates.push(worldPosition(o).y);
      });
      expect(plates).toHaveLength(1);
      expect(plates[0] ?? Number.NaN).toBeCloseTo(levelY(18), 9);
    } finally {
      graph.dispose();
    }
  });
});

describe('flow cues exist exactly while their flow does', () => {
  it('draws the discharge stream and its ripple only while liquid moves A → B', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const idle = snapshotAt({ volA: 100, volB: 0 });
      graph.update(idle, 0);
      expect(idle.flowPctS.pump).toBe(0);
      expect(requireObject(graph.root, 'pump:stream:discharge').visible).toBe(false);
      for (const ring of requireObject(graph.root, 'pump:ripple:discharge').children) {
        expect(ring.visible).toBe(false);
      }

      const moving = pumpingSnapshot({ volA: 100, volB: 0 }, 5);
      expect(moving.flowPctS.pump).toBeGreaterThan(0);
      graph.update(moving, 0);
      expect(requireObject(graph.root, 'pump:stream:discharge').visible).toBe(true);
      for (const ring of requireObject(graph.root, 'pump:ripple:discharge').children) {
        expect(ring.visible).toBe(true);
      }
    } finally {
      graph.dispose();
    }
  });

  it('draws nothing for a deadheaded pump (B full: the bit is on, the flow is zero)', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const deadhead = pumpingSnapshot({ volA: 100, volB: 100 }, 3);
      expect(deadhead.actuators.pump).toBe(true);
      expect(deadhead.flowPctS.pump).toBe(0);
      graph.update(deadhead, 0);
      expect(requireObject(graph.root, 'pump:stream:discharge').visible).toBe(false);
    } finally {
      graph.dispose();
    }
  });

  it('lets the stream reach the CURRENT surface of tank B', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const mouthY = dischargeOutlet().y;
      for (const volB of [0, 45, 90]) {
        const moving = pumpingSnapshot({ volA: 100, volB }, 1);
        graph.update(moving, 0);
        const stream = worldBox(requireObject(graph.root, 'pump:stream:discharge'));
        const surface = levelY(moving.volBPct);
        expect(stream.max.y).toBeCloseTo(mouthY, 6);
        expect(stream.min.y).toBeCloseTo(surface, 6);
        const ripple = worldPosition(requireObject(graph.root, 'pump:ripple:discharge'));
        expect(ripple.y).toBeCloseTo(surface + 0.003, 6);
      }
    } finally {
      graph.dispose();
    }
  });

  it('drives the refill and drain cues off their own valves', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({ volA: 20, volB: 60 });
      plant.setValve('inA', true);
      plant.step(10);
      const refilling = plant.snapshot();
      graph.update(refilling, 0);
      expect(refilling.flowPctS.refill).toBeGreaterThan(0);
      expect(requireObject(graph.root, 'pump:stream:refill').visible).toBe(true);
      expect(requireObject(graph.root, 'pump:stream:drain').visible).toBe(false);
      const refill = worldBox(requireObject(graph.root, 'pump:stream:refill'));
      expect(refill.max.y).toBeCloseTo(refillOutlet().y, 6);
      expect(refill.min.y).toBeCloseTo(levelY(refilling.volAPct), 6);

      plant.setValve('inA', false);
      plant.setValve('outB', true);
      plant.step(10);
      const draining = plant.snapshot();
      graph.update(draining, 0);
      expect(requireObject(graph.root, 'pump:stream:refill').visible).toBe(false);
      expect(requireObject(graph.root, 'pump:stream:drain').visible).toBe(true);
      const drain = worldBox(requireObject(graph.root, 'pump:stream:drain'));
      expect(drain.max.y).toBeCloseTo(drainOutlet().y, 6);
      expect(drain.min.y).toBeCloseTo(PUMP_DIM.floorDrainY, 6);
    } finally {
      graph.dispose();
    }
  });

  it('cuts every cue in the frame its flow stops', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      // levels chosen so all three flows are genuinely non-zero: A has room to take refill,
      // B has product to drain, and B is not full so the pump is not deadheaded.
      const plant = plantAt({ volA: 60, volB: 50 });
      plant.setActuator('pump', true);
      plant.setValve('inA', true);
      plant.setValve('outB', true);
      plant.step(10);
      graph.update(plant.snapshot(), 0);
      for (const name of ['discharge', 'refill', 'drain']) {
        expect(requireObject(graph.root, `pump:stream:${name}`).visible).toBe(true);
      }

      plant.setActuator('pump', false);
      plant.setValve('inA', false);
      plant.setValve('outB', false);
      plant.step(10);
      graph.update(plant.snapshot(), 0);
      for (const name of ['discharge', 'refill', 'drain']) {
        expect(requireObject(graph.root, `pump:stream:${name}`).visible).toBe(false);
      }
      for (const line of ['pump', 'refill', 'drain']) {
        const beads = requireObject(graph.root, `pump:line:${line}:flow`);
        expect(beads.children.every((c) => !c.visible), `${line} beads still moving`).toBe(true);
      }
    } finally {
      graph.dispose();
    }
  });
});

describe('the console mirrors the process image', () => {
  it('presses the buttons, throws the toggles and lights the lamps from the snapshot', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({});
      graph.update(plant.snapshot(), 0);
      const lamp = requireObject(graph.root, 'pump:lamp:A0.2') as Mesh;
      expect((lamp.material as MeshStandardMaterial).emissiveIntensity).toBe(0);
      const toggleRest = (requireObject(graph.root, 'pick:toggle:E1.0') as Group).rotation.x;

      plant.setActuator('A0.2', true);
      plant.setToggle('E1.0', true);
      plant.pressS1(true);
      graph.update(plant.snapshot(), 0);
      expect((lamp.material as MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(0);
      expect((requireObject(graph.root, 'pick:toggle:E1.0') as Group).rotation.x)
        .not.toBeCloseTo(toggleRest, 6);
      const cap = requireObject(graph.root, 'pick:button:S1') as Mesh;
      const pressedY = worldPosition(cap).y;
      plant.pressS1(false);
      graph.update(plant.snapshot(), 0);
      expect(worldPosition(cap).y).toBeGreaterThan(pressedY);
    } finally {
      graph.dispose();
    }
  });

  it('turns the impeller only while the pump output is on', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({ volA: 100 });
      graph.update(plant.snapshot(), 0);
      plant.step(500);
      graph.update(plant.snapshot(), 0);
      const idle = (requireObject(graph.root, 'pump:impeller') as Group).rotation.z;
      expect(idle).toBe(0);

      plant.setActuator('pump', true);
      plant.step(120);
      graph.update(plant.snapshot(), 0);
      expect((requireObject(graph.root, 'pump:impeller') as Group).rotation.z).toBeGreaterThan(0);
    } finally {
      graph.dispose();
    }
  });
});

describe('determinism', () => {
  it('changes nothing when the same snapshot and sim time are applied twice', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const moving = pumpingSnapshot({ volA: 80, volB: 10 }, 4);
      graph.update(moving, 17);
      const first = worldMatrixDigest(graph.root);
      graph.update(moving, 17);
      const second = worldMatrixDigest(graph.root);
      expect(second).toEqual(first);
    } finally {
      graph.dispose();
    }
  });

  it('renders two graphs identically for the same snapshot sequence', () => {
    const a = buildPumpSceneGraph({ quality: 'low' });
    const b = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({ volA: 100, volB: 0 });
      plant.setActuator('pump', true);
      plant.setValve('outB', true);
      for (let i = 0; i < 40; i += 1) {
        plant.step(10);
        const snapshot = plant.snapshot();
        const alpha = (i % 5) * 3;
        a.update(snapshot, alpha);
        b.update(snapshot, alpha);
      }
      expect(worldMatrixDigest(b.root)).toEqual(worldMatrixDigest(a.root));
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('detects a planted defect (control: the digest can fail)', () => {
    const a = buildPumpSceneGraph({ quality: 'low' });
    const b = buildPumpSceneGraph({ quality: 'low' });
    try {
      const snapshot = pumpingSnapshot({ volA: 80, volB: 10 }, 4);
      a.update(snapshot, 0);
      b.update(snapshot, 0);
      expect(worldMatrixDigest(b.root)).toEqual(worldMatrixDigest(a.root));
      requireObject(b.root, 'pump:liquid:B').position.y += 1e-6;
      expect(worldMatrixDigest(b.root)).not.toEqual(worldMatrixDigest(a.root));
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it('advances the animation with SIM time, not with the number of frames', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const plant = plantAt({ volA: 100, volB: 0 });
      plant.setActuator('pump', true);
      plant.step(10);
      const snapshot = plant.snapshot();
      graph.update(snapshot, 0);
      const stalled = worldMatrixDigest(graph.root);
      for (let i = 0; i < 20; i += 1) graph.update(snapshot, 0);
      expect(worldMatrixDigest(graph.root)).toEqual(stalled);

      graph.update(snapshot, 40);
      expect(worldMatrixDigest(graph.root)).not.toEqual(stalled);
    } finally {
      graph.dispose();
    }
  });
});
