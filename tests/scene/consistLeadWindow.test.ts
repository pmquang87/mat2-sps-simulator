/**
 * OccupiedPath nose-window pin (`docs/REVIEW_SCENE.md` D16, adversarial finding).
 *
 * The record must claim NOTHING ahead of the loco's nose while the coaches trail
 * (`OCCUPIED_NOSE_MM` = 0): the nose has not driven over that track, so freezing it violates
 * the record's own rule. With a frozen nose window a switch completing its 300 ms actuation
 * inside it was baked in with the PRE-throw position while the train crossed on the
 * POST-throw one; the record then followed the wrong branch until `RECORD_STRAY_MM` cut and
 * re-grew it — a teleport of every vehicle (measured with a 100 mm window: 9 jumps, worst
 * 113,7 mm, drawn loco 144,7 mm off). These cases fail on any reintroduced nose window.
 *
 * Paired on purpose: the same throw 300 mm ahead (outside any plausible window) is clean, so
 * the suite isolates the window and cannot pass vacuously.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { OCCUPIED_LEAD_MM, Plant, TrackGraph } from '../../src/plant';
import type { PlantSnapshot, TrackplanFile, Vec2 } from '../../src/plant';
import trackplanJson from '../../src/data/trackplan.json';
import { DIM, MM, PlanFrame, buildTrain, createMaterials } from '../../src/scene';

const plan = trackplanJson as unknown as TrackplanFile;
const frame = PlanFrame.fromTrackplan(plan);
/** 280 mm/s × 10 ms = 2,8 mm of legitimate motion per step; 10 mm is 3,5× that. */
const JUMP_MM = 10;
/** A vehicle further than this from every rail centre line is not on the plant. */
const OFF_RAIL_MM = 25;

const SEGS = plan.edges.flatMap((e) =>
  (e.pts as readonly Vec2[]).slice(1).map((b, i) => ({ a: (e.pts as readonly Vec2[])[i] as Vec2, b })),
);

function railDistMm(px: number, py: number): number {
  let best = Infinity;
  for (const { a, b } of SEGS) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy)));
  }
  return best * plan.meta.mmPerUnit;
}

interface Run { worstJumpMm: number; jumps: number; worstOffRailMm: number; worstLagMm: number; moving: number }

/** Approach n3 along e36 at speed 3 and let xW02E complete `leadMm` before the loco gets there. */
function approachAndThrow(leadMm: number): Run {
  const plant = new Plant({ trackplan: plan, seed: 42 });
  const g = new TrackGraph(plan);
  const visual = buildTrain(createMaterials('low'), 'low');
  const place = (s: PlantSnapshot): Vector3[] => {
    const t = s.train;
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

  plant.setFahrstromWord(3);
  let prev = place(plant.snapshot());
  let armed = false;
  const out: Run = { worstJumpMm: 0, jumps: 0, worstOffRailMm: 0, worstLagMm: 0, moving: 0 };
  for (let i = 0; i < 4000; i += 1) {
    const s0 = plant.snapshot();
    if (!armed && s0.train.edgeId === 'e36') {
      // 300 ms of actuation at 280 mm/s covers 84 mm of the approach.
      if (g.edgeLengthMm('e36') - s0.train.offsetMm <= leadMm + 84) {
        armed = true;
        plant.setSwitchCoil('xW02E', 'R', true);
      }
    }
    if (armed && i % 20 === 0) plant.setSwitchCoil('xW02E', 'R', false);
    plant.step(10);
    plant.drainEvents();
    const s = plant.snapshot();
    const now = place(s);
    const truth = new Vector3(frame.x(s.train.worldPos.x), 0, frame.z(s.train.worldPos.y));
    out.worstLagMm = Math.max(out.worstLagMm, (now[0] as Vector3).distanceTo(truth) / MM);
    for (let v = 0; v < now.length; v += 1) {
      const p = now[v] as Vector3;
      const d = p.distanceTo(prev[v] as Vector3) / MM;
      if (d > 0.1) out.moving += 1;
      if (d > JUMP_MM) out.jumps += 1;
      out.worstJumpMm = Math.max(out.worstJumpMm, d);
      out.worstOffRailMm = Math.max(out.worstOffRailMm, railDistMm(frame.planX(p.x), frame.planY(p.z)));
    }
    prev = now;
  }
  return out;
}

describe('OccupiedPath lead window vs renderer geometry', () => {
  it('OCCUPIED_LEAD_MM covers the rearmost render probe with smoothing headroom', () => {
    // The frozen coach-side window is sized in the plant, but what samples it is the scene:
    // the rearmost vehicle centre plus its 0,75 · half-length probe. Nothing else ties the
    // two layers together, so this pin does — growing the consist without growing the window
    // would silently reintroduce D16 for the rear coach.
    const rearCentre = DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2
      + DIM.coachLength + DIM.coupling;
    const rearProbe = rearCentre + 0.75 * (DIM.coachLength / 2);
    // headroom: alpha smoothing shifts sampling by up to ~28 mm (280 mm/s × 100 ms)
    expect(OCCUPIED_LEAD_MM).toBeGreaterThanOrEqual(rearProbe + 50);
  });
});

describe('OccupiedPath: a switch completing inside the record lead (D16 follow-up)', () => {
  it('is clean when the switch completes 300 mm ahead — outside the lead', () => {
    const r = approachAndThrow(300);
    expect(r.moving).toBeGreaterThan(10_000);      // anti-vacuity
    expect(r.jumps, `worst ${r.worstJumpMm.toFixed(1)} mm`).toBe(0);
    expect(r.worstOffRailMm).toBeLessThan(OFF_RAIL_MM);
  });

  for (const leadMm of [40, 60, 95]) {
    it(`must also be clean when it completes ${leadMm} mm ahead — inside the lead`, () => {
      const r = approachAndThrow(leadMm);
      expect(r.moving).toBeGreaterThan(10_000);
      expect(
        r.jumps,
        `worst jump ${r.worstJumpMm.toFixed(1)} mm, drawn loco ${r.worstLagMm.toFixed(1)} mm ` +
          `from its true position, worst ${r.worstOffRailMm.toFixed(1)} mm off every rail`,
      ).toBe(0);
      expect(r.worstOffRailMm).toBeLessThan(OFF_RAIL_MM);
      // the drawn loco must not leave its own track
      expect(r.worstLagMm).toBeLessThan(50);
    });
  }
});
