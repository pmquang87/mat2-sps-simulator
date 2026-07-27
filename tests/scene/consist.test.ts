/**
 * Consist rendering under reversal (`docs/REVIEW_SCENE.md` D10).
 *
 * The plant was exonerated: at the reported cycle 1454 its state is a valid on-track point. What
 * left the baseboard was the *rendered* consist. `TrainVisual` places each vehicle at a fixed arc
 * length behind the loco along a **path buffer** of past loco positions, and while the train
 * reverses the vehicles move to *decreasing* arc length — onto track the loco recorded before the
 * reversal began. The buffer kept only 672 mm of history, and `pointAt` extrapolated a straight
 * line past its end, so the error grew linearly with the reversal distance: 1,09 m at cycle 1454,
 * 590 mm of it beyond the plate.
 *
 * These tests drive `TrainVisual` directly with scripted 10 ms poses, exactly as the SceneManager
 * does, and compare every vehicle against the analytic truth.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import { DIM, MM, PlanFrame, buildTrain, createMaterials } from '../../src/scene';

const plan = trackplanJson as unknown as TrackplanFile;

/** Vehicle centre offsets behind the loco centre, in mm (loco, coach1, coach2). */
const OFFSETS_MM = [
  0,
  DIM.locoLength / 2 + DIM.coupling + DIM.coachLength / 2,
  DIM.locoLength / 2 + DIM.coupling + DIM.coachLength * 1.5 + DIM.coupling,
];

interface Board {
  readonly halfW: number;
  readonly halfD: number;
}

function board(): Board {
  const frame = PlanFrame.fromTrackplan(plan);
  return {
    halfW: frame.widthM / 2 + frame.units(26),
    halfD: frame.depthM / 2 + frame.units(26),
  };
}

function onBoard(p: Vector3, b: Board): boolean {
  return Math.abs(p.x) <= b.halfW && Math.abs(p.z) <= b.halfD;
}

/** A track shape the test can evaluate analytically: `at(sMm)` is the point at arc length s. */
interface Track {
  at(sMm: number): Vector3;
  headingAt(sMm: number): number;
}

/** Straight line along world +x through the origin (plan heading 0). */
function straightTrack(): Track {
  return {
    at: (s) => new Vector3(s * MM, 0, 0),
    headingAt: () => 0,
  };
}

/**
 * Circle of radius `rMm` centred on the origin — a realistic model-railway curve that also keeps
 * the scripted loco on the baseboard however far it runs, so "is it on the plate?" stays a
 * statement about the *renderer* and not about the script.
 */
function arcTrack(rMm: number): Track {
  return {
    at: (s) => {
      const a = s / rMm;
      return new Vector3(Math.cos(a) * rMm * MM, 0, Math.sin(a) * rMm * MM);
    },
    // plan heading of the tangent: world +x → plan +x, world +z → plan +y
    headingAt: (s) => Math.atan2(Math.cos(s / rMm), -Math.sin(s / rMm)),
  };
}

interface Run {
  /** loco arc positions in mm, one per 10 ms step */
  readonly script: readonly number[];
  readonly track: Track;
}

/** Drives the visual over a script and returns the per-step rendered vehicle centres. */
function drive(run: Run): { centres: Vector3[][]; visual: ReturnType<typeof buildTrain> } {
  const visual = buildTrain(createMaterials('low'), 'low');
  const centres: Vector3[][] = [];
  for (const s of run.script) {
    visual.update({
      position: run.track.at(s),
      headingRad: run.track.headingAt(s),
      speedMmS: 280,
      alphaMs: 0,
      hidden: false,
      derailed: false,
    });
    centres.push(
      visual.object.children.map((c) => {
        const p = c.position.clone();
        p.y -= DIM.railTop * MM; // vehicle origins sit on the rail heads
        return p;
      }),
    );
  }
  return { centres, visual };
}

/**
 * Forward `fwdMm` then reverse `revMm`, in 2.8 mm steps (280 mm/s at 10 ms), starting at `fromMm`.
 *
 * For the render to be *exact* the reversal must stay inside track the loco actually recorded, so
 * `fwdMm` has to exceed `revMm` plus the consist length — the same condition the real plant meets
 * (the Gruppe A train ran forward for 55 s before reversing for 17 s).
 */
function forwardThenReverse(fwdMm: number, revMm: number, fromMm = 0): number[] {
  const step = 2.8;
  const script: number[] = [];
  for (let s = fromMm; s <= fromMm + fwdMm; s += step) script.push(s);
  const top = script[script.length - 1] ?? 0;
  for (let s = top - step; s >= top - revMm; s -= step) script.push(s);
  return script;
}

describe('consist under reversal', () => {
  it('renders every vehicle on its true track point through the reported 1.4 m reversal', () => {
    // Gruppe A's Rangierfahrt: ≈ 1,4 m of reverse, twice the old 672 mm buffer. On a straight
    // line even the synthetic initial tail is exact, so the render must match to the millimetre.
    const track = straightTrack();
    // 2,6 m forward then 1,4 m of reverse, kept inside the plate (the rear coach reaches
    // 292 mm beyond the loco, so the usable span is ±1678 − 292 mm)
    const script = forwardThenReverse(2600, 1400, -1200);
    const { centres } = drive({ script, track });
    const b = board();

    let worst = 0;
    let worstAt = '';
    for (let i = 0; i < script.length; i += 1) {
      const head = script[i]!;
      const rendered = centres[i]!;
      expect(rendered).toHaveLength(OFFSETS_MM.length);
      for (let v = 0; v < OFFSETS_MM.length; v += 1) {
        const truth = track.at(head - OFFSETS_MM[v]!);
        const err = rendered[v]!.distanceTo(truth) / MM;
        if (err > worst) {
          worst = err;
          worstAt = `step ${i} head ${head.toFixed(0)}mm vehicle ${v}`;
        }
        expect(onBoard(rendered[v]!, b), `off board at ${worstAt}`).toBe(true);
      }
    }
    expect(worst, `worst error at ${worstAt}`).toBeLessThan(1);
  });

  it('holds through a 2.6 m reversal on a curve, where heading alone cannot place a coach', () => {
    const track = arcTrack(600);
    const script = forwardThenReverse(3200, 2600);
    const { centres } = drive({ script, track });
    const b = board();

    let worst = 0;
    for (let i = 0; i < script.length; i += 1) {
      const head = script[i]!;
      // skip the first `lengthMm` while the synthetic straight tail is still being flushed out
      if (head < 500 && i < script.length / 2) continue;
      for (let v = 0; v < OFFSETS_MM.length; v += 1) {
        const rendered = centres[i]![v]!;
        const truth = track.at(head - OFFSETS_MM[v]!);
        worst = Math.max(worst, rendered.distanceTo(truth) / MM);
        expect(onBoard(rendered, b)).toBe(true);
      }
    }
    // a rigid vehicle is a chord across the arc, so its centre sits a few mm inside the
    // centre line by construction — nothing like the 1090 mm of D10
    expect(worst).toBeLessThan(5);
  });

  it('keeps pathS strictly increasing across reversal and re-anchor', () => {
    const track = arcTrack(600);
    const script = forwardThenReverse(1500, 1200);
    // …and then forward again, which is where the old code appended below pathS[0]
    const top = script[script.length - 1] ?? 0;
    for (let s = top + 2.8; s <= top + 900; s += 2.8) script.push(s);

    const visual = buildTrain(createMaterials('low'), 'low');
    for (const s of script) {
      visual.update({
        position: track.at(s),
        headingRad: track.headingAt(s),
        speedMmS: 280,
        alphaMs: 0,
        hidden: false,
        derailed: false,
      });
      const { s: arc, points } = visual.pathSnapshot();
      // scan without expect() per element: a few hundred thousand matcher calls would time out
      let violation = -1;
      for (let i = 1; i < arc.length; i += 1) {
        if (!(arc[i]! > arc[i - 1]!)) {
          violation = i;
          break;
        }
      }
      if (violation >= 0 || arc.length !== points.length || arc.length < 2) {
        expect(
          { head: s.toFixed(0), violation, sLen: arc.length, ptLen: points.length },
          'pathS must stay strictly increasing and aligned with pathPts',
        ).toEqual({ head: s.toFixed(0), violation: -1, sLen: arc.length, ptLen: arc.length });
      }
    }
  });

  it('degrades bounded when a reversal outruns the retained history', () => {
    // 4 m of reverse after only 500 mm forward: the track behind was never recorded, so the
    // consist cannot be exact — but it must clamp to the known path, not fly off the plate
    const track = arcTrack(600);
    const script = forwardThenReverse(500, 4000);
    const { centres } = drive({ script, track });
    const b = board();
    for (let i = 0; i < script.length; i += 1) {
      for (const p of centres[i]!) {
        expect(onBoard(p, b), `off board at step ${i}`).toBe(true);
      }
    }
    // …and the degradation is bunching, not stretching: every vehicle stays near the rails and
    // within the consist length of the loco, instead of being flung along a stale tangent
    for (let i = 0; i < script.length; i += 1) {
      const loco = centres[i]![0]!;
      for (const p of centres[i]!) {
        expect(p.distanceTo(loco) / MM).toBeLessThan(OFFSETS_MM[OFFSETS_MM.length - 1]! + 80);
      }
    }
  });

  it('bounds the error independently of how far the reversal outruns the history', () => {
    // this is the property the old code lacked: its straight-line extrapolation grew with the
    // reversal distance (0 → 21 → 335 → 1090 mm as Gruppe A reversed further)
    const track = arcTrack(600);
    const deviation = (revMm: number): number => {
      const { centres } = drive({ script: forwardThenReverse(500, revMm), track });
      let worst = 0;
      for (const step of centres) {
        for (const p of step) {
          worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.z) / MM - 600));
        }
      }
      return worst;
    };
    const short = deviation(4000);
    const long = deviation(8000);
    // a stress case, not a scenario the exercises reach: 8 m of reverse after 0,5 m forward, i.e.
    // 16x more reversal than recorded history. The point is that the bound does not grow with it.
    expect(short).toBeLessThan(250);
    expect(long).toBeLessThan(250);
    // doubling the overrun must not move the bound — the old extrapolation scaled with it
    expect(Math.abs(long - short)).toBeLessThan(2);
  });
});
