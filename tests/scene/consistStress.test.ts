/**
 * Adversarial stress for the consist record (`docs/REVIEW_SCENE.md` D16 Folgearbeit): a switch
 * thrown out from under a train that is PUSHING BACK over it, so the coaches cross the node on one
 * branch and the loco is about to cross it on the other.
 *
 * That is the shape of the owner's report â€” "the drawn train backs into BH3 Gleis 2 while the
 * plant runs into Gleis 3" â€” and of the constructed runs the D16 write-up recorded, where the
 * record kept the old branch under the leading coaches, drifted from the loco's real route, and
 * was eventually cut and re-grown by `RECORD_STRAY_MM` (worst 156,4 mm).
 *
 * It runs on the `miniPlan` fixture rather than the real trackplan, and that is deliberate: the
 * reversal has to FACE the switch for the case to exist at all. Sweeping the real plan's 42
 * switches under a backing train does not produce it â€” measured, such a sweep lands 22 throws
 * inside the leading footprint and moves the record by 6,8 mm either way, before and after the
 * change, i.e. it measures nothing. On `miniPlan` the geometry is under control: the toe edge `eB`
 * runs to `nSw`, branch 0 (`eC`) continues straight and branch 1 (`eD`) climbs away, so "which
 * branch is the record on" is answerable in millimetres.
 *
 * Metrics, both in baseboard mm: how far a drawn vehicle body moves between two consecutive 10 ms
 * steps, and â€” far more sensitive â€” how far the record's own track UNDER THE LOCO has drifted from
 * the position the plant publishes.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Plant } from '../../src/plant';
import type { ConsistPath, PlantSnapshot, TrackplanFile, Vec2 } from '../../src/plant';
import { PlanFrame, buildTrain, createMaterials, MM } from '../../src/scene';
import { miniPlan } from '../plant/fixtures/miniplan';

/** Physics step, ms. */
const STEP_MS = 10;
/** Level 1 on the fixture is 100 mm/s â‡’ 1 mm of legitimate motion per step. */
const TRAVEL_PER_STEP_MM = 1;
/**
 * Displacement above which a drawn vehicle has been RE-ROUTED rather than moved, mm per step.
 * Ten times one step of travel here, and the same absolute threshold the Gruppe A jump oracle uses.
 */
const JUMP_MM = 10;
/**
 * How far the record under the loco may drift from the published position, mm. The renderer reads
 * the loco from the midpoint of two path samples 84 mm apart, so on a curve that midpoint cuts the
 * corner by the sagitta; on this fixture the only curve is the `eD` bend and 12 mm covers it. A
 * record that has kept the wrong branch blows straight through this.
 */
const RECORD_LAG_MM = 15;

const SWITCH_ID = 'xW01T';
const NODE_X = 1000;

function speedWord(level: 1 | 2 | 3, direction: 'IU' | 'GU'): number {
  return direction === 'IU' ? level : level | 0x0100;
}

/** Plan point at arc length `s` on the published path â€” `TrainVisual.pointAt`, in plan space. */
function pathPointAt(path: ConsistPath, s: number): Vec2 {
  const n = path.pts.length;
  if (n < 2) return (path.pts[0] as Vec2) ?? { x: 0, y: 0 };
  const raw = (s - path.startMm) / path.stepMm;
  const i = Math.min(n - 2, Math.max(0, Math.floor(raw)));
  const t = Math.min(1, Math.max(0, raw - i));
  const a = path.pts[i] as Vec2;
  const b = path.pts[i + 1] as Vec2;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

interface Stress {
  steps: number;
  movingSamples: number;
  /** Distance from the node when the coil was pulsed, mm ahead of the loco. */
  throwLeadMm: number;
  crossedOntoBranch1: boolean;
  jumps: { step: number; vehicle: string; mm: number }[];
  maxMoveMm: number[];
  maxRecordLagMm: number;
  maxRecordLagAtStep: number;
  maxPlantMoveMm: number;
}

/**
 * Seats the loco on the toe edge with its coaches LEADING toward the switch, pushes back over it,
 * and throws the switch to the other branch when the node is `throwLeadMm` ahead of the loco â€”
 * i.e. on track the loco has not crossed yet but is about to.
 */
function straddleRun(throwLeadMm: number): Stress {
  const plan: TrackplanFile = miniPlan();
  plan.start = { edgeId: 'eB', offsetMm: 300, direction: -1 };
  const frame = PlanFrame.fromTrackplan(plan);
  const plant = new Plant({ trackplan: plan, seed: 42 });
  const visual = buildTrain(createMaterials('low'), 'low');

  const draw = (snapshot: PlantSnapshot): Vector3[] => {
    const t = snapshot.train;
    const cp = t.consistPath;
    visual.update({
      position: new Vector3(frame.x(t.worldPos.x), 0, frame.z(t.worldPos.y)),
      headingRad: t.headingRad,
      speedMmS: t.speedMmS,
      alphaMs: 0,
      hidden: false,
      derailed: false,
      path: {
        startMm: cp.startMm,
        stepMm: cp.stepMm,
        pts: cp.pts.map((p) => new Vector3(frame.x(p.x), 0, frame.z(p.y))),
      },
    });
    return visual.object.children.map((c) => c.position.clone());
  };
  const plantPos = (s: PlantSnapshot): Vector3 =>
    new Vector3(frame.x(s.train.worldPos.x), 0, frame.z(s.train.worldPos.y));

  // GU while seated at travel sign âˆ’1 flips the frame: +s now points at nSw and the coaches lead.
  plant.setFahrstromWord(speedWord(1, 'GU'));
  const vehicles = visual.object.children.map((c) => c.name);
  const out: Stress = {
    steps: 0,
    movingSamples: 0,
    throwLeadMm: 0,
    crossedOntoBranch1: false,
    jumps: [],
    maxMoveMm: vehicles.map(() => 0),
    maxRecordLagMm: 0,
    maxRecordLagAtStep: 0,
    maxPlantMoveMm: 0,
  };
  let prev = draw(plant.snapshot());
  let prevPlant = plantPos(plant.snapshot());
  let thrownAt = -1;

  for (let step = 1; step <= 1_400; step += 1) {
    const before = plant.snapshot();
    if (thrownAt < 0 && before.train.edgeId === 'eB' && NODE_X - before.train.offsetMm <= throwLeadMm) {
      plant.setSwitchCoil(SWITCH_ID, 'R', true);
      thrownAt = step;
      out.throwLeadMm = NODE_X - before.train.offsetMm;
    }
    if (thrownAt > 0 && step === thrownAt + 40) plant.setSwitchCoil(SWITCH_ID, 'R', false);

    plant.step(STEP_MS);
    plant.drainEvents();
    const snapshot = plant.snapshot();
    if (snapshot.train.edgeId === 'eD') out.crossedOntoBranch1 = true;

    const now = draw(snapshot);
    const nowPlant = plantPos(snapshot);
    out.steps += 1;
    out.maxPlantMoveMm = Math.max(out.maxPlantMoveMm, nowPlant.distanceTo(prevPlant) / MM);
    for (let v = 0; v < now.length; v += 1) {
      const d = (now[v] as Vector3).distanceTo(prev[v] as Vector3) / MM;
      if (d > 0.1) out.movingSamples += 1;
      if (d > (out.maxMoveMm[v] as number)) out.maxMoveMm[v] = d;
      if (d > JUMP_MM) out.jumps.push({ step, vehicle: vehicles[v] ?? `#${v}`, mm: d });
    }

    // the renderer's loco probe: midpoint of the samples 0,75 Â· half a loco either side of s = 0
    const cp = snapshot.train.consistPath;
    const fore = pathPointAt(cp, 42);
    const aft = pathPointAt(cp, -42);
    const lag = Math.hypot(
      (fore.x + aft.x) / 2 - snapshot.train.worldPos.x,
      (fore.y + aft.y) / 2 - snapshot.train.worldPos.y,
    );                                              // mmPerUnit is 1 on this fixture
    if (lag > out.maxRecordLagMm) {
      out.maxRecordLagMm = lag;
      out.maxRecordLagAtStep = step;
    }
    prev = now;
    prevPlant = nowPlant;
  }
  return out;
}

function report(r: Stress): string {
  const worst = r.jumps.reduce((m, j) => Math.max(m, j.mm), 0);
  const per = r.maxMoveMm.map((m) => m.toFixed(1)).join(' / ');
  return (
    `switch thrown ${r.throwLeadMm.toFixed(0)} mm ahead of the loco; ` +
    `${r.jumps.length} vehicle jumps > ${JUMP_MM} mm (worst ${worst.toFixed(1)} mm; ` +
    `largest step per vehicle ${per} mm); record under the loco worst ` +
    `${r.maxRecordLagMm.toFixed(1)} mm from the published position at step ${r.maxRecordLagAtStep}`
  );
}

describe('a switch thrown under the LEADING coaches of a backing train (D16 Folgearbeit)', () => {
  // Both cases measured on the PRE-change record: 5 vehicle jumps, worst 307,7 mm (loco 88,1 /
  // coach1 236,5 / coach2 307,7), record under the loco 149,6 mm off — the stray guard cutting and
  // re-growing the chain, which is the 156,4 mm failure the D16 write-up recorded.
  //
  // 400 mm: the node is inside the recorded lead but beyond every vehicle body (the rear coach
  //   reaches 366 mm), so the re-resolution moves recorded track only and no vehicle moves at all.
  // 200 mm: coach 2 is already PAST the node, so the correction has to move it — once, by the
  //   branch separation where it stands. It is 77,2 mm here because this fixture's branch leaves
  //   at ~37°; the same event on the real plan costs 13,7 mm (`consistJump.oracle.test.ts`).
  for (const { leadMm, jumps, worstMm } of [
    { leadMm: 400, jumps: 0, worstMm: 2 },
    { leadMm: 200, jumps: 1, worstMm: 90 },
  ]) {
    describe(`thrown ${leadMm} mm ahead of the loco`, () => {
      const run = straddleRun(leadMm);

      it('really drives the scenario it claims to (anti-vacuity)', () => {
        expect(run.steps).toBe(1_400);
        expect(run.movingSamples).toBeGreaterThan(1_000);
        expect(run.throwLeadMm).toBeGreaterThan(0);
        // the loco must really end up on the OTHER branch â€” otherwise nothing is under test
        expect(run.crossedOntoBranch1, 'the loco must take the newly set branch').toBe(true);
        // and the physics itself never teleports
        expect(run.maxPlantMoveMm).toBeLessThan(TRAVEL_PER_STEP_MM + 0.1);
      });

      it('keeps the record under the loco on the branch the loco really takes', () => {
        expect(run.maxRecordLagMm, report(run)).toBeLessThan(RECORD_LAG_MM);
      });

      it('costs at most one re-resolution correction, bounded by the branch separation', () => {
        expect(run.jumps.length, report(run)).toBe(jumps);
        for (const j of run.jumps) {
          expect(j.vehicle, report(run)).toBe('coach2');
          expect(j.mm, report(run)).toBeLessThan(worstMm);
        }
        // the loco is never the one corrected: the record is re-walked from the node outward
        expect(run.maxMoveMm[0] as number, report(run)).toBeLessThan(TRAVEL_PER_STEP_MM + 0.1);
      });
    });
  }
});

