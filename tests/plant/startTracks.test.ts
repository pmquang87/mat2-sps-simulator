/**
 * Start-track chooser seats (§10.1, `src/scene/startTracks.ts`) measured against the plant.
 *
 * Two claims are pinned here, both on the SHIPPED trackplan:
 *
 * 1. **Seat maths** — every choosable track puts the loco on that lane's edge, at the
 *    mid-lane point pulled UPSTREAM of the lane's first wired reed (D19 guard (a), owner
 *    decision 2026-08-01 — the mid-lane seat on BH1 G4 sat past the B-NW3 trigger reed),
 *    and `Plant.setStart` accepts all of them (train on rail, not derailed).
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

  /**
   * D19 guard (a), owner decision 2026-08-01: the mid-lane seat pulled UPSTREAM of the
   * lane's first WIRED reed (margin 100 mm), floored 100 mm from the lane ends — the same
   * convention as the §7.1 exercise seats (pinned at e23 @ 105 mm and e43 @ 100 mm from
   * their lane start). Two pins that must fail independently:
   *
   * - the LITERAL offsets, measured once from the shipped trackplan — moving either the
   *   rule or the data breaks this table loudly, as a deliberate double edit;
   * - the same rule re-derived here from the RAW json (raw polyline arc length, raw reed
   *   list), so the shipped implementation cannot drift from the stated rule unnoticed.
   */
  it('seats each lane at its pinned upstream-of-first-wired-reed offset (0,5 mm)', () => {
    const expected: Record<string, number> = {
      'BH1 G1': 100,     // xR02BH1G1 @ 49.4 unprotectable → floor (the e23 @ 105 pattern)
      'BH1 G2': 1093.6,  // dir −1 lane: first reed 993.6, upstream = HIGHER offset
      'BH1 G3': 296.9,
      'BH1 G4': 246.8,   // the D19 lane: mid 611.3 sat past xR03BH1G4 @ 346.8
      'BH2 G1': 297.3,
      'BH2 G2': 100,     // xR02BH2G2 @ 49.7 unprotectable → floor
      'BH2 G3': 100,     // reed @ 113.4: 13.4 mm spawn gap > the 5 mm closure radius
      'BH2 G4': 197.8,   // no wired reed on e100 → mid-lane, unchanged
      'BH2 G5': 100,     // stub; xR02BH2G5 @ 49.4 unprotectable → floor
      'BH3 G1': 301.2,   // stub; no wired reed on e72 → mid-lane, unchanged
      'BH3 G2': 632.6,   // xR01BH3G2 sits on e9, NOT on lane edge e70 → mid-lane
      'BH3 G3': 160.8,
    };
    for (const option of options) {
      const label = `${option.stationKey} ${option.laneKey}`;
      const spec = startSpecForTrack(plan, option);
      expect(spec, label).not.toBeNull();
      expect(spec?.edgeId).toBe(option.edgeId);
      expect(Math.abs((spec?.offsetMm ?? 0) - (expected[label] ?? Number.NaN)), label)
        .toBeLessThan(0.5);

      // independent re-derivation from the RAW json (arc length over the raw polyline —
      // NOT option.lengthMm — and the raw wired-reed list)
      const edge = plan.edges.find((e) => e.id === option.edgeId);
      expect(edge).toBeDefined();
      let rawMm = 0;
      const pts = edge?.pts ?? [];
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1] as { x: number; y: number };
        const b = pts[i] as { x: number; y: number };
        rawMm += Math.hypot(b.x - a.x, b.y - a.y) * plan.meta.mmPerUnit;
      }
      const wired = plan.reeds.filter((r) => r.wired && r.edgeId === option.edgeId);
      let raw = rawMm / 2;
      if (wired.length > 0) {
        raw = option.direction === 1
          ? Math.max(Math.min(rawMm / 2, Math.min(...wired.map((r) => r.offsetMm)) - 100),
              Math.min(100, rawMm / 2))
          : Math.min(Math.max(rawMm / 2, Math.max(...wired.map((r) => r.offsetMm)) + 100),
              Math.max(rawMm - 100, rawMm / 2));
      }
      expect(Math.abs((spec?.offsetMm ?? 0) - raw), label).toBeLessThan(0.5);
    }
  });

  /** The rule's unconditional invariants — on every lane, not only the ones that move:
   *  the seat stays strictly inside the lane and only ever moves UPSTREAM from mid, so no
   *  reed the retired mid seat had ahead is ever lost. */
  it('never seats outside the lane and never moves downstream of mid', () => {
    for (const option of options) {
      const label = `${option.stationKey} ${option.laneKey}`;
      const spec = startSpecForTrack(plan, option) as TrainStartSpec;
      expect(spec.offsetMm, label).toBeGreaterThan(0);
      expect(spec.offsetMm, label).toBeLessThan(option.lengthMm);
      if (option.direction === 1) {
        expect(spec.offsetMm, label).toBeLessThanOrEqual(option.lengthMm / 2 + 0.001);
      } else {
        expect(spec.offsetMm, label).toBeGreaterThanOrEqual(option.lengthMm / 2 - 0.001);
      }
    }
  });

  /**
   * Synthetic short-lane control (adversarial review of guard (a)): on a lane shorter
   * than 2× the 100 mm clearance, a BARE floor would push the seat DOWNSTREAM of mid —
   * out of the invariant above and past a reed the mid seat had ahead. The fixture is a
   * 180 mm lane with wired reeds at 40 mm (unprotectable) and 95 mm (ahead of mid): the
   * seat must yield to mid (90 mm), keeping the 95 mm reed ahead. The shipped plan has no
   * lane under 322 mm, so only a synthetic plan can exercise this branch.
   */
  it('yields the floor to mid on a lane shorter than twice the clearance', () => {
    const shortPlan = {
      meta: { mmPerUnit: 1 },
      nodes: [
        { id: 'n0', kind: 'plain' }, { id: 'n1', kind: 'plain' },
        { id: 'n2', kind: 'plain' }, { id: 'n3', kind: 'plain' },
      ],
      // both edges sweep the same sense about the bbox centre → direction 1 for the lane
      edges: [
        { id: 'e0', from: 'n0', to: 'n1', pts: [{ x: 0, y: 200 }, { x: 180, y: 200 }] },
        { id: 'eS', from: 'n2', to: 'n3', pts: [{ x: 180, y: 0 }, { x: 0, y: 0 }] },
      ],
      switches: [],
      reeds: [
        { id: 'xR01BH9G1', edgeId: 'eS', offsetMm: 40, wired: true },
        { id: 'xR02BH9G1', edgeId: 'eS', offsetMm: 95, wired: true },
      ],
      start: { edgeId: 'e0', offsetMm: 10, direction: 1 },
    } as unknown as TrackplanFile;
    const spec = startSpecForTrack(shortPlan, { stationKey: 'BH9', laneKey: 'G1' });
    expect(spec).not.toBeNull();
    expect(spec?.edgeId).toBe('eS');
    expect(spec?.offsetMm).toBeCloseTo(90, 3);      // mid of 180 — NOT the 100 mm floor
    expect(spec?.offsetMm ?? 0).toBeLessThanOrEqual(90);  // monotone even here
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
      expect(train.offsetMm).toBeCloseTo(spec.offsetMm, 3);
      expect(plant.snapshot().derailed).toBe(false);
      // D19 guard (a): a fresh seat never spawns ON a closed reed — every wired reed of
      // the lane starts open (tightest real case: BH2 G3, 13,4 mm gap vs 5 mm radius)
      const laneReeds = plan.reeds.filter((r) => r.wired && r.edgeId === option.edgeId);
      for (const reed of laneReeds) {
        const state = plant.snapshot().reeds.find((s) => s.id === reed.id);
        expect(state?.closed, `${reed.id} closed at spawn`).toBe(false);
      }
    }
  });

  it('has no track for an unknown station or lane', () => {
    expect(startSpecForTrack(plan, { stationKey: 'BH9', laneKey: 'G1' })).toBeNull();
    expect(startSpecForTrack(plan, { stationKey: 'BH1', laneKey: 'G9' })).toBeNull();
  });

  /**
   * D19 guard (a) — the falsifiable core, measured against the driving plant: from every
   * chooser seat, Speed1IU must FIRE every wired reed of the lane that lies ahead of the
   * seat, and (control) the retired mid-lane seat on BH1 G4 misses its trigger reed —
   * which is verbatim the user report ("skips BH3 G2, goes direct to BH2": B-NW3 never
   * saw xR03BH1G4 on lap 1).
   */
  describe('no chooser seat skips a wired reed of its own lane (D19 guard a)', () => {
    /** 20 s at Speed1 ≈ 1,6 m — enough for the farthest ahead-reed on the shipped plan
     *  (xR01BH2G1, 1191,6 mm from the BH2 G1 seat) and far short of a full lap, so the
     *  mid-seat CONTROL below cannot be rescued by the loco coming around again. */
    function reedsFired(start: TrainStartSpec): Set<string> {
      const plant = new Plant({ trackplan: plan, seed: 1 });
      plant.setStart(start);
      plant.setFahrstromWord(SPEED1_IU);
      const fired = new Set<string>();
      for (let i = 0; i < 2000; i += 1) {
        plant.step(10);
        for (const event of plant.drainEvents()) {
          if (event.type === 'reedClosed') fired.add(event.reedId);
        }
      }
      return fired;
    }

    /** Wired reeds of the lane the IU run still has ahead of the seat. */
    function reedsAhead(edgeId: string, spec: TrainStartSpec): string[] {
      return plan.reeds
        .filter((r) => r.wired && r.edgeId === edgeId)
        .filter((r) => (spec.direction === 1
          ? r.offsetMm > spec.offsetMm
          : r.offsetMm < spec.offsetMm))
        .map((r) => r.id);
    }

    const lanesWithAhead = options
      .map((o) => [o, reedsAhead(o.edgeId, startSpecForTrack(plan, o) as TrainStartSpec)] as const)
      .filter(([, ahead]) => ahead.length > 0);

    it('covers most lanes — the rule would be vacuous if nothing lay ahead', () => {
      // 8 of 12 lanes have a wired reed ahead of the seat: three lanes have no wired reed
      // on their own edge (BH2 G4, BH3 G1, BH3 G2) and the BH2 G5 stub's only wired reed
      // is an unprotectable arrival reed behind the floor — pinned so a data change surfaces.
      expect(lanesWithAhead.map(([o]) => `${o.stationKey} ${o.laneKey}`)).toEqual([
        'BH1 G1', 'BH1 G2', 'BH1 G3', 'BH1 G4',
        'BH2 G1', 'BH2 G2', 'BH2 G3',
        'BH3 G3',
      ]);
    });

    it.each(lanesWithAhead.map(([o, ahead]) =>
      [`${o.stationKey} ${o.laneKey}`, o, ahead] as const))(
      '%s fires every wired lane reed ahead of its seat',
      (_label, option, ahead) => {
        const spec = startSpecForTrack(plan, option) as TrainStartSpec;
        const fired = reedsFired(spec);
        for (const id of ahead) {
          expect(fired.has(id), `${id} must fire from the chooser seat`).toBe(true);
        }
      },
    );

    it('CONTROL: the retired mid-lane seat on BH1 G4 misses xR03BH1G4 — the D19 report', () => {
      const lane = options.find((o) => o.stationKey === 'BH1' && o.laneKey === 'G4');
      expect(lane).toBeDefined();
      if (lane === undefined) return;
      const mid: TrainStartSpec = {
        edgeId: lane.edgeId,
        offsetMm: lane.lengthMm / 2,   // 611.3 — past xR03BH1G4 at 346.8
        direction: lane.direction,
      };
      const fired = reedsFired(mid);
      expect(fired.has('xR03BH1G4')).toBe(false);   // B-NW3 never triggers…
      expect(fired.size).toBeGreaterThan(0);        // …while the loco demonstrably drives on
    });
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
