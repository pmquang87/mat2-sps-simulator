/**
 * Interaction contract of the pump scene.
 *
 * Two properties matter and both are checked against the BUILT graph, not against a list of
 * names typed out here:
 *
 *  - TOTALITY: every mesh the user can hit resolves to an action, and the set of actions is
 *    exactly the plant's buttons ∪ toggles ∪ valves. A control that the resolver does not
 *    know is a dead control on the pedestal.
 *  - MOMENTARY BUTTONS: S1/S0 go to 1 on `pointerdown` and back to 0 on `pointerup` (or when
 *    the pointer leaves). That is the behaviour the Anleitung's self-hold example teaches;
 *    a button that latched would make the exercise pass for the wrong reason.
 *
 * The scene never touches the plant here either: the assertions are on the CALLBACKS.
 */
import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import {
  PUMP_BUTTON_IDS,
  PUMP_TOGGLE_IDS,
  PUMP_VALVE_IDS,
} from '../../../src/pump';
import type { PumpButtonId, PumpToggleId, PumpValveId } from '../../../src/pump';
import {
  PUMP_PICK_PREFIX,
  PumpPointer,
  panelNormal,
  buildPumpSceneGraph,
  pumpPickKey,
  pumpPickName,
  resolvePumpPick,
  type PumpPickTarget,
} from '../../../src/pump/scene';
import { plantAt, requireObject, worldPosition } from './fixture';

interface Recorded {
  buttons: { id: PumpButtonId; pressed: boolean }[];
  toggles: { id: PumpToggleId; value: boolean }[];
  valves: { id: PumpValveId; open: boolean }[];
  highlights: (string | null)[];
  cursors: boolean[];
}

function recorder(): { rec: Recorded; cb: ConstructorParameters<typeof PumpPointer>[2] } {
  const rec: Recorded = { buttons: [], toggles: [], valves: [], highlights: [], cursors: [] };
  return {
    rec,
    cb: {
      onButton: (id, pressed) => rec.buttons.push({ id, pressed }),
      onToggle: (id, value) => rec.toggles.push({ id, value }),
      onValve: (id, open) => rec.valves.push({ id, open }),
      onCursor: (over) => rec.cursors.push(over),
      onHighlight: (t) => rec.highlights.push(t ? pumpPickKey(t) : null),
    },
  };
}

/** A camera parked on the control's own normal, so the control is dead centre and clear. */
function cameraLookingAt(object: Object3D, normal: Vector3, distance = 0.5): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, 1, 0.01, 20);
  const at = worldPosition(object);
  camera.position.copy(at).addScaledVector(normal, distance);
  camera.lookAt(at);
  camera.updateMatrixWorld(true);
  return camera;
}

const CENTRE = { x: 0, y: 0 };

describe('pick-target resolution', () => {
  it('round-trips every target and rejects everything else', () => {
    const targets: PumpPickTarget[] = [
      ...PUMP_BUTTON_IDS.map((id) => ({ kind: 'button', id }) as const),
      ...PUMP_TOGGLE_IDS.map((id) => ({ kind: 'toggle', id }) as const),
      ...PUMP_VALVE_IDS.map((id) => ({ kind: 'valve', id }) as const),
    ];
    for (const target of targets) {
      expect(resolvePumpPick(pumpPickName(target))).toEqual(target);
    }
    expect(resolvePumpPick('pump:liquid:A')).toBeNull();
    expect(resolvePumpPick('label:S1 (E 0.0)')).toBeNull();
    expect(resolvePumpPick('pick:')).toBeNull();
    expect(resolvePumpPick('pick:button:')).toBeNull();
    // a spelling that exists in the plant's OTHER id space must not resolve
    expect(resolvePumpPick('pick:button:E1.0')).toBeNull();
    expect(resolvePumpPick('pick:valve:S1')).toBeNull();
    expect(resolvePumpPick('pick:lamp:A0.2')).toBeNull();
  });

  it('is total over the interactive meshes the graph actually builds', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const picked: string[] = [];
      graph.root.traverse((o) => {
        if (o.name.startsWith(PUMP_PICK_PREFIX)) picked.push(o.name);
      });
      expect(picked.length).toBeGreaterThan(0);
      const unresolved = picked.filter((name) => resolvePumpPick(name) === null);
      expect(unresolved, `unresolvable pick names: ${unresolved.join(', ')}`).toEqual([]);

      const keys = new Set(picked.map((n) => pumpPickKey(resolvePumpPick(n) as PumpPickTarget)));
      const expected = new Set([
        ...PUMP_BUTTON_IDS.map((id) => `button:${id}`),
        ...PUMP_TOGGLE_IDS.map((id) => `toggle:${id}`),
        ...PUMP_VALVE_IDS.map((id) => `valve:${id}`),
      ]);
      expect([...keys].sort()).toEqual([...expected].sort());
    } finally {
      graph.dispose();
    }
  });
});

describe('momentary buttons', () => {
  it.each(PUMP_BUTTON_IDS)('%s presses on pointerdown and releases on pointerup', (id) => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const cap = requireObject(graph.root, pumpPickName({ kind: 'button', id }));
      const camera = cameraLookingAt(cap, panelNormal());
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);
      pointer.setSnapshot(plantAt({}).snapshot());

      expect(pointer.down(CENTRE)).toBe(true);
      expect(rec.buttons).toEqual([{ id, pressed: true }]);
      expect(pointer.isPressed()).toBe(true);

      pointer.up(CENTRE);
      expect(rec.buttons).toEqual([{ id, pressed: true }, { id, pressed: false }]);
      expect(pointer.isPressed()).toBe(false);
    } finally {
      graph.dispose();
    }
  });

  it('releases when the pointer leaves the canvas mid-press', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const cap = requireObject(graph.root, pumpPickName({ kind: 'button', id: 'S1' }));
      const camera = cameraLookingAt(cap, panelNormal());
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);
      pointer.setSnapshot(plantAt({}).snapshot());

      pointer.down(CENTRE);
      pointer.leave();
      expect(rec.buttons).toEqual([
        { id: 'S1', pressed: true },
        { id: 'S1', pressed: false },
      ]);
      expect(pointer.isPressed()).toBe(false);
    } finally {
      graph.dispose();
    }
  });

  it('never reports a button twice for one press', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const cap = requireObject(graph.root, pumpPickName({ kind: 'button', id: 'S0' }));
      const camera = cameraLookingAt(cap, panelNormal());
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);
      pointer.setSnapshot(plantAt({}).snapshot());

      pointer.down(CENTRE);
      pointer.move(CENTRE);
      pointer.move({ x: 0.05, y: 0.05 });
      pointer.up(CENTRE);
      pointer.up(CENTRE);
      expect(rec.buttons).toHaveLength(2);
    } finally {
      graph.dispose();
    }
  });
});

describe('toggles and hand valves', () => {
  it('flips a toggle to the INVERSE of its current snapshot value, on click', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const lever = requireObject(graph.root, pumpPickName({ kind: 'toggle', id: 'E1.2' }));
      const camera = cameraLookingAt(lever, panelNormal(), 0.4);
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);

      const plant = plantAt({});
      pointer.setSnapshot(plant.snapshot());
      pointer.down(CENTRE);
      expect(rec.toggles).toEqual([]);           // nothing fires before the release
      pointer.up(CENTRE);
      expect(rec.toggles).toEqual([{ id: 'E1.2', value: true }]);

      plant.setToggle('E1.2', true);
      pointer.setSnapshot(plant.snapshot());
      pointer.down(CENTRE);
      pointer.up(CENTRE);
      expect(rec.toggles).toEqual([
        { id: 'E1.2', value: true },
        { id: 'E1.2', value: false },
      ]);
    } finally {
      graph.dispose();
    }
  });

  it('does not flip when the release lands somewhere else', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const lever = requireObject(graph.root, pumpPickName({ kind: 'toggle', id: 'E1.0' }));
      const camera = cameraLookingAt(lever, panelNormal(), 0.4);
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);
      pointer.setSnapshot(plantAt({}).snapshot());

      pointer.down(CENTRE);
      pointer.up({ x: -0.95, y: -0.95 });
      expect(rec.toggles).toEqual([]);
    } finally {
      graph.dispose();
    }
  });

  it('opens and closes a hand valve', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const handle = requireObject(graph.root, pumpPickName({ kind: 'valve', id: 'outB' }));
      const camera = cameraLookingAt(handle, new Vector3(0, 1, 0), 0.4);
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);

      const plant = plantAt({});
      pointer.setSnapshot(plant.snapshot());
      pointer.down(CENTRE);
      pointer.up(CENTRE);
      expect(rec.valves).toEqual([{ id: 'outB', open: true }]);
    } finally {
      graph.dispose();
    }
  });
});

describe('hover and camera hand-off', () => {
  it('reports the hovered control once and highlights it in the graph', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const cap = requireObject(graph.root, pumpPickName({ kind: 'button', id: 'S1' }));
      const camera = cameraLookingAt(cap, panelNormal());
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, {
        ...cb,
        onHighlight: (t) => {
          cb.onHighlight?.(t);
          graph.setHighlight(t);
        },
      });
      pointer.setSnapshot(plantAt({}).snapshot());

      const ring = requireObject(graph.root, 'pump:highlight:button:S1');
      expect(ring.visible).toBe(false);
      pointer.move(CENTRE);
      pointer.move(CENTRE);                       // no change → no second report
      expect(rec.highlights).toEqual(['button:S1']);
      expect(rec.cursors).toEqual([true]);
      expect(ring.visible).toBe(true);

      pointer.move({ x: -0.98, y: -0.98 });
      expect(rec.highlights).toEqual(['button:S1', null]);
      expect(ring.visible).toBe(false);
    } finally {
      graph.dispose();
    }
  });

  it('hands the gesture to the camera when nothing interactive is hit', () => {
    const graph = buildPumpSceneGraph({ quality: 'low' });
    try {
      const cap = requireObject(graph.root, pumpPickName({ kind: 'button', id: 'S1' }));
      const camera = cameraLookingAt(cap, panelNormal());
      const { rec, cb } = recorder();
      const pointer = new PumpPointer(graph.root, camera, cb);
      pointer.setSnapshot(plantAt({}).snapshot());

      expect(pointer.down({ x: -0.98, y: -0.98 })).toBe(false);
      expect(rec.buttons).toEqual([]);
      expect(rec.toggles).toEqual([]);
      expect(rec.valves).toEqual([]);
    } finally {
      graph.dispose();
    }
  });
});
