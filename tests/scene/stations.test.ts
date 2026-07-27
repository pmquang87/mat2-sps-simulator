/**
 * Station derivation: platforms and name boards are derived from the reed naming
 * convention (`xR01BH1G2` → station BH1, track G2) instead of an extra trackplan field, so
 * the boards show exactly the tokens that appear in the students' AWL operands.
 */
import { describe, expect, it } from 'vitest';
import { deriveStations } from '../../src/scene';
import { straightPlan } from './fixture';

describe('deriveStations', () => {
  const stations = deriveStations(straightPlan());

  it('groups reeds into stations and tracks', () => {
    expect(stations.map((s) => s.key)).toEqual(['BH1', 'BH2']);
    const bh1 = stations.find((s) => s.key === 'BH1');
    expect(bh1?.lanes.map((l) => l.laneKey)).toEqual(['G1', 'G2']);
  });

  it('ignores plain line reeds without a BHx Gy name', () => {
    const all = stations.flatMap((s) => s.lanes.flatMap((l) => l.reedIds));
    expect(all).not.toContain('xR01A');
  });

  it('picks the edge carrying the most reeds of a track', () => {
    const g1 = deriveStations(straightPlan())
      .find((s) => s.key === 'BH1')
      ?.lanes.find((l) => l.laneKey === 'G1');
    // e1 holds xR01BH1G1 + xR02BH1G1, e3 only xR03BH1G1
    expect(g1?.edgeId).toBe('e1');
    expect(g1?.reedIds).toEqual(['xR01BH1G1', 'xR02BH1G1']);
  });

  it('spans the reeds with a margin, and pads a single-reed track', () => {
    const bh1 = stations.find((s) => s.key === 'BH1');
    const g1 = bh1?.lanes.find((l) => l.laneKey === 'G1');
    expect(g1?.startMm).toBeCloseTo(40 - 80, 9);
    expect(g1?.endMm).toBeCloseTo(160 + 80, 9);

    const g2 = bh1?.lanes.find((l) => l.laneKey === 'G2');
    expect(g2?.startMm).toBeCloseTo(100 - 180, 9);
    expect(g2?.endMm).toBeCloseTo(100 + 180, 9);
  });

  it('is order stable (trackplan array order drives the result)', () => {
    const a = deriveStations(straightPlan());
    const b = deriveStations(straightPlan());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns nothing when no reed carries a station name', () => {
    const tp = straightPlan();
    tp.reeds = tp.reeds.map((r, i) => ({ ...r, id: `xR0${i}A` }));
    expect(deriveStations(tp)).toEqual([]);
  });
});
