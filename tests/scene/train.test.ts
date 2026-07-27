/**
 * Consist placement: the loco pose comes from the snapshot, the two coaches follow a
 * directed path buffer (ARCHITECTURE.md §5.4 — "animation driven by snapshot deltas", no
 * scene-side physics). The reversal case is the interesting one: the practicum's Sägefahrten
 * reverse the train, and the coaches must then lead instead of folding onto the loco.
 *
 * Runs headless (node): `TrainVisual` builds plain Three.js meshes, no renderer or canvas.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DIM, MM, buildTrain, createMaterials, type TrainUpdate } from '../../src/scene';

function feed(
  train: ReturnType<typeof buildTrain>,
  from: number,
  to: number,
  stepMm: number,
  headingRad: number,
): void {
  const dir = Math.sign(to - from) || 1;
  for (let x = from; dir > 0 ? x <= to : x >= to; x += dir * stepMm) {
    const u: TrainUpdate = {
      position: new Vector3(x * MM, 0, 0),
      headingRad,
      speedMmS: 200,
      alphaMs: 0,
      hidden: false,
      derailed: false,
    };
    train.update(u);
  }
}

const OFFSETS = {
  coach1: DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2,
  coach2: DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2 + DIM.coachLength + DIM.coupling,
};

describe('TrainVisual', () => {
  it('places loco and coaches at their designed spacing behind the loco', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 1200, 10, 0);
    const [loco, coach1, coach2] = train.object.children;
    expect(loco && coach1 && coach2).toBeTruthy();
    if (!loco || !coach1 || !coach2) return;
    // travelling towards +x ⇒ coaches trail at -x
    expect((loco.position.x - coach1.position.x) / MM).toBeCloseTo(OFFSETS.coach1, 3);
    expect((loco.position.x - coach2.position.x) / MM).toBeCloseTo(OFFSETS.coach2, 3);
    for (const v of [loco, coach1, coach2]) {
      expect(v.position.z).toBeCloseTo(0, 9);
      expect(v.position.y / MM).toBeCloseTo(DIM.railTop, 6);
    }
  });

  it('keeps the spacing when the train reverses (coaches lead, no fold-in)', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 1200, 10, 0);
    // reverse: heading flips, the loco retraces the recorded path
    feed(train, 1190, 800, 10, Math.PI);
    const [loco, coach1, coach2] = train.object.children;
    if (!loco || !coach1 || !coach2) return;
    // the coaches are still on the same side of the path (now ahead in travel direction)
    expect((loco.position.x - coach1.position.x) / MM).toBeCloseTo(OFFSETS.coach1, 3);
    expect((loco.position.x - coach2.position.x) / MM).toBeCloseTo(OFFSETS.coach2, 3);
    expect(loco.position.x / MM).toBeCloseTo(800, 3);
  });

  it('interpolates with alphaMs without moving the plant state', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 500, 10, 0);
    const [loco] = train.object.children;
    if (!loco) return;
    const before = loco.position.x;
    train.update({
      position: new Vector3(500 * MM, 0, 0),
      headingRad: 0,
      speedMmS: 200, // 200 mm/s × 50 ms = 10 mm
      alphaMs: 50,
      hidden: false,
      derailed: false,
    });
    expect((loco.position.x - before) / MM).toBeCloseTo(10, 3);
  });

  it('hides the whole consist inside a tunnel edge', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 200, 10, 0);
    expect(train.object.visible).toBe(true);
    train.update({
      position: new Vector3(0.2, 0, 0),
      headingRad: 0,
      speedMmS: 0,
      alphaMs: 0,
      hidden: true,
      derailed: false,
    });
    expect(train.object.visible).toBe(false);
  });

  it('recovers from a teleport (plant reset) with finite poses', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 600, 10, 0);
    train.update({
      position: new Vector3(-2.5, 0, 1.5), // far jump ⇒ path buffer re-initialises
      headingRad: Math.PI / 2,
      speedMmS: 0,
      alphaMs: 0,
      hidden: false,
      derailed: false,
    });
    for (const v of train.object.children) {
      expect(Number.isFinite(v.position.x)).toBe(true);
      expect(Number.isFinite(v.position.y)).toBe(true);
      expect(Number.isFinite(v.position.z)).toBe(true);
    }
    const [loco] = train.object.children;
    expect(loco?.position.x).toBeCloseTo(-2.5, 6);
  });

  it('rolls the loco when derailed and exposes a cab pose ahead of its centre', () => {
    const train = buildTrain(createMaterials('low'), 'low');
    feed(train, 0, 400, 10, 0);
    const [loco] = train.object.children;
    if (!loco) return;
    expect(loco.rotation.z).toBe(0);
    train.update({
      position: new Vector3(0.4, 0, 0),
      headingRad: 0,
      speedMmS: 0,
      alphaMs: 0,
      hidden: false,
      derailed: true,
    });
    expect(loco.rotation.z).toBeGreaterThan(0);
    expect(train.getCabPosition().x).toBeGreaterThan(loco.position.x);
    expect(train.getCabForward().x).toBeCloseTo(1, 6);
  });
});
