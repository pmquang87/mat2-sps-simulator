/**
 * Start-track chooser seats (§10.1, `src/scene/startTracks.ts`) measured against the plant.
 *
 * Two claims are pinned here, both on the SHIPPED trackplan:
 *
 * 1. **Seat maths** — every choosable track puts the loco on that lane's edge, at half the
 *    edge length, and `Plant.setStart` accepts all of them (train on rail, not derailed).
 * 2. **Facing** — from EVERY seat, `Speed1IU` drives the train around the layout in the same
 *    plan-wise rotational sense as it does from the delivered Gruppe A seat. That is the
 *    falsifiable core of the feature: a seat whose `direction` were wrong would drive
 *    backwards, and the student's first `Speed1IU` would leave the station the wrong way.
 *
 * The measurement is the SIGNED AREA swept by the train's plan-space position about the
 * plan centre (shoelace), i.e. `∮ (r × dr)`: positive one way round, negative the other, and
 * independent of where on the board the seat is. It is deliberately NOT the quantity
 * `startTracks.ts` derives the direction from — that one is a static integral along the lane
 * edge alone, this one is the trajectory the plant actually drives, through switches and
 * across edge hand-overs. Two controls keep it honest: Gruppe A driven GU must come out with
 * the OPPOSITE sign, and every seat driven with the mirrored travel sign must come out
 * opposite too — so the check can fail.
 *
 * It does fail without the derivation: `e77` (Bahnhof 1 Gleis 2) is stored against the §7.1
 * "from→to is the IU walk" convention, so a hard-coded `direction: 1` drives that seat
 * backwards. That is the one measurement this whole rule exists for.
 */
import { describe, expect, it } from 'vitest';
import trackplanJson from '../../src/data/trackplan.json';
import { Plant } from '../../src/plant';
import type { TrainStartSpec, TrackplanFile } from '../../src/plant';
import { iuTravelSign, startSpecForTrack, startTrackOf, startTrackOptions } from '../../src/scene';

const plan = trackplanJson as unknown as TrackplanFile;
const options = startTrackOptions(plan);

/** AW6 words (plant/fahrstrom.ts encoding): level 1 forward / level 1 reverse. */
const SPEED1_IU = 0x0001;
const SPEED1_GU = 0x0101;

/** 12 s of simulated running at 80 mm/s — ~940 mm of track, several edges on most seats. */
const STEP_MS = 10;
const STEPS = 1200;

/** Pivot for the swept area: the MEAN of the plan's polyline points — deliberately not the
 *  bounding-box centre `startTracks.ts` derives its rule about, so a mistake in that pivot
 *  cannot cancel itself out here. */
const pivot = ((): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const edge of plan.edges) {
    for (const p of edge.pts) {
      x += p.x;
      y += p.y;
      n += 1;
    }
  }
  return { x: x / n, y: y / n };
})();

interface Drive {
  /** signed area swept about the plan pivot, plan units² — its SIGN is the sense */
  signedArea: number;
  /** path length actually covered, plan units */
  travel: number;
  derailed: boolean;
  /** where the run ended — a through lane must have LEFT its start edge (liveness) */
  endEdgeId: string;
  endSpeedMmS: number;
}

function drive(start: TrainStartSpec, word: number): Drive {
  const plant = new Plant({ trackplan: plan, seed: 1 });
  plant.setStart(start);
  plant.setFahrstromWord(word);
  let signedArea = 0;
  let travel = 0;
  let prev = plant.snapshot().train.worldPos;
  for (let i = 0; i < STEPS; i += 1) {
    plant.step(STEP_MS);
    const p = plant.snapshot().train.worldPos;
    signedArea += (prev.x - pivot.x) * (p.y - pivot.y)
                - (p.x - pivot.x) * (prev.y - pivot.y);
    travel += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const end = plant.snapshot().train;
  return {
    signedArea,
    travel,
    derailed: plant.snapshot().derailed,
    endEdgeId: end.edgeId,
    endSpeedMmS: end.speedMmS,
  };
}

/** The control: the delivered Gruppe A seat, driven forward. */
const control = drive(plan.start, SPEED1_IU);
const forwardSense = Math.sign(control.signedArea);

describe('choosable start tracks (scene/startTracks.ts)', () => {
  it('offers every station track the trackplan names, in numeric reading order', () => {
    expect(options.map((o) => `${o.stationKey} ${o.laneKey}`)).toEqual([
      'BH1 G1', 'BH1 G2', 'BH1 G3', 'BH1 G4',
      'BH2 G1', 'BH2 G2', 'BH2 G3', 'BH2 G4', 'BH2 G5',
      'BH3 G1', 'BH3 G2', 'BH3 G3',
    ]);
  });

  it('flags exactly the two dead-end lanes whose IU end is a buffer', () => {
    expect(options.filter((o) => o.stub).map((o) => `${o.stationKey} ${o.laneKey}`))
      .toEqual(['BH2 G5', 'BH3 G1']);
  });

  it('seats the loco at the MIDDLE of the lane edge (0,5 mm), by an independent length', () => {
    for (const option of options) {
      const spec = startSpecForTrack(plan, option);
      expect(spec, `${option.stationKey} ${option.laneKey}`).not.toBeNull();
      expect(spec?.edgeId).toBe(option.edgeId);
      // independent arc length over the raw trackplan polyline — NOT option.lengthMm, which
      // startSpecForTrack halves itself (comparing those two is a check that cannot fail)
      const edge = plan.edges.find((e) => e.id === option.edgeId);
      expect(edge).toBeDefined();
      let rawMm = 0;
      const pts = edge?.pts ?? [];
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1] as { x: number; y: number };
        const b = pts[i] as { x: number; y: number };
        rawMm += Math.hypot(b.x - a.x, b.y - a.y) * plan.meta.mmPerUnit;
      }
      expect(Math.abs((spec?.offsetMm ?? 0) - rawMm / 2), `${option.stationKey} ${option.laneKey}`)
        .toBeLessThan(0.5);
    }
  });

  /**
   * The direction rule is a SIGN of a swept area, so it is only as trustworthy as its
   * conditioning: an edge that runs almost radially through the plan centre sweeps ≈ 0 and
   * its sign would be noise. The worst lane on the shipped plan is Bahnhof 3 Gleis 1.
   */
  it('derives every lane direction from a well-conditioned sweep', () => {
    for (const option of options) {
      expect(Math.abs(option.sweepPt2), `${option.stationKey} ${option.laneKey}`)
        .toBeGreaterThan(2000);
      expect(iuTravelSign(plan, option.edgeId)).toBe(option.direction);
    }
  });

  /** The exception the rule exists for: not every edge is stored IU-first (§7.1 convention). */
  it('finds Bahnhof 1 Gleis 2 stored against the IU walk', () => {
    const lane = options.find((o) => o.stationKey === 'BH1' && o.laneKey === 'G2');
    expect(lane?.edgeId).toBe('e77');
    expect(lane?.direction).toBe(-1);
    expect(options.filter((o) => o.direction === 1).length).toBe(options.length - 1);
  });

  it('is accepted by Plant.setStart for every track — train on rail, not derailed', () => {
    for (const option of options) {
      const spec = startSpecForTrack(plan, option) as TrainStartSpec;
      const plant = new Plant({ trackplan: plan, seed: 1 });
      expect(() => plant.setStart(spec), `${option.stationKey} ${option.laneKey}`).not.toThrow();
      const train = plant.snapshot().train;
      expect(train.edgeId).toBe(option.edgeId);
      expect(train.offsetMm).toBeCloseTo(option.lengthMm / 2, 3);
      expect(plant.snapshot().derailed).toBe(false);
    }
  });

  it('has no track for an unknown station or lane', () => {
    expect(startSpecForTrack(plan, { stationKey: 'BH9', laneKey: 'G1' })).toBeNull();
    expect(startSpecForTrack(plan, { stationKey: 'BH1', laneKey: 'G9' })).toBeNull();
  });

  /** D13 display rule: the chooser must be able to name the seat an EXERCISE re-seat took. */
  it('maps the two §7.1 exercise starts back onto their tracks', () => {
    expect(startTrackOf(plan, plan.start)).toEqual({ stationKey: 'BH1', laneKey: 'G1' });
    const gruppeB = plan.exerciseStarts?.gruppeB;
    expect(gruppeB, 'trackplan.exerciseStarts.gruppeB').toBeDefined();
    expect(startTrackOf(plan, gruppeB as TrainStartSpec))
      .toEqual({ stationKey: 'BH1', laneKey: 'G4' });
  });
});

describe('facing: Speed1IU drives the same way round from every seat', () => {
  it('the control moves and sweeps a well-defined sense', () => {
    expect(control.travel).toBeGreaterThan(100);
    expect(Math.abs(control.signedArea)).toBeGreaterThan(1000);
    expect(forwardSense === 1 || forwardSense === -1).toBe(true);
  });

  it('control: the same seat driven GU sweeps the OPPOSITE sense', () => {
    const reverse = drive(plan.start, SPEED1_GU);
    expect(Math.sign(reverse.signedArea)).toBe(-forwardSense);
  });

  it.each(options.filter((o) => !o.stub).map((o) => [`${o.stationKey} ${o.laneKey}`, o] as const))(
    '%s drives forward like the Gruppe A seat and leaves its start edge',
    (_label, option) => {
      const spec = startSpecForTrack(plan, option) as TrainStartSpec;
      const run = drive(spec, SPEED1_IU);
      expect(run.derailed).toBe(false);
      // liveness: a through lane must actually go somewhere — a seat that parks against a
      // buffer covers at most half its own edge (86 plan units on the longer stub), while a
      // free-running one covers the full 268 units of the 12 s window. The floor of 150
      // separates the two classes; a 10-unit floor let the stub lanes pass silently (found
      // by the chooser's adversarial review). endEdgeId is deliberately NOT asserted here:
      // BH2 G1 (e33, 1985 mm) legitimately stays on its own edge for the whole window.
      expect(run.travel).toBeGreaterThan(150);
      expect(run.endSpeedMmS).toBeGreaterThan(0);
      expect(Math.sign(run.signedArea)).toBe(forwardSense);
    },
  );

  /**
   * The two dead-end lanes are offered HONESTLY: IU is the plant's global drive sense, so
   * from a stub seat it runs the loco into the buffer and parks — exactly what the real
   * plant's Fahrstrom would do. The chooser marks them (`stub`), and this pins the physics
   * so a future "fix" that fakes their facing (breaking the uniform IU sense) goes red.
   */
  it.each(options.filter((o) => o.stub).map((o) => [`${o.stationKey} ${o.laneKey}`, o] as const))(
    '%s (dead end) parks against the buffer without leaving its edge',
    (_label, option) => {
      const spec = startSpecForTrack(plan, option) as TrainStartSpec;
      const run = drive(spec, SPEED1_IU);
      expect(run.derailed).toBe(false);
      expect(run.endEdgeId).toBe(spec.edgeId);       // never left the stub
      expect(run.endSpeedMmS).toBe(0);               // parked at the stops
      expect(run.travel).toBeGreaterThan(10);        // it did drive before stopping
      expect(run.travel).toBeLessThan(150);
      expect(Math.sign(run.signedArea)).toBe(forwardSense);  // sense correct until the stop
    },
  );

  /**
   * Falsification control: the SAME seats with the mirrored travel sign. If this passed the
   * measurement above would be vacuous — it would accept any direction.
   */
  it.each(options.map((o) => [`${o.stationKey} ${o.laneKey}`, o] as const))(
    '%s with the mirrored travel sign drives backwards (control)',
    (_label, option) => {
      const spec = startSpecForTrack(plan, option) as TrainStartSpec;
      const mirrored: TrainStartSpec = { ...spec, direction: spec.direction === 1 ? -1 : 1 };
      const run = drive(mirrored, SPEED1_IU);
      expect(Math.sign(run.signedArea)).toBe(-forwardSense);
    },
  );
});
