/**
 * §9.2 geometry.test.ts: polyline length; point/tangent at offset incl. vertices;
 * mm/unit conversion.
 */
import { describe, expect, it } from 'vitest';
import { Polyline, mmToUnits, unitsToMm } from '../../src/plant';

describe('unit conversion', () => {
  it('converts plan units to mm and back', () => {
    expect(unitsToMm(2, 3.5)).toBeCloseTo(7, 12);
    expect(mmToUnits(7, 3.5)).toBeCloseTo(2, 12);
    expect(mmToUnits(unitsToMm(123.4, 3.5), 3.5)).toBeCloseTo(123.4, 12);
  });
});

describe('Polyline', () => {
  // L-shape: 3 units right, 4 units up; mmPerUnit 10 → 30 mm + 40 mm = 70 mm.
  const L = new Polyline([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], 10);

  it('computes arc length in mm across segments', () => {
    expect(L.lengthMm).toBeCloseTo(70, 12);
  });

  it('computes length of a diagonal segment (3-4-5 triangle)', () => {
    const d = new Polyline([{ x: 0, y: 0 }, { x: 3, y: 4 }], 1);
    expect(d.lengthMm).toBeCloseTo(5, 12);
  });

  it('returns points at offsets, including mid-segment and vertices', () => {
    expect(L.pointAtMm(0)).toEqual({ x: 0, y: 0 });
    expect(L.pointAtMm(15).x).toBeCloseTo(1.5, 12);
    expect(L.pointAtMm(15).y).toBeCloseTo(0, 12);
    expect(L.pointAtMm(30).x).toBeCloseTo(3, 12);   // exactly at the vertex
    expect(L.pointAtMm(30).y).toBeCloseTo(0, 12);
    expect(L.pointAtMm(50).x).toBeCloseTo(3, 12);
    expect(L.pointAtMm(50).y).toBeCloseTo(2, 12);
    expect(L.pointAtMm(70).x).toBeCloseTo(3, 12);
    expect(L.pointAtMm(70).y).toBeCloseTo(4, 12);
  });

  it('clamps offsets outside [0, lengthMm]', () => {
    expect(L.pointAtMm(-5)).toEqual({ x: 0, y: 0 });
    expect(L.pointAtMm(9999).x).toBeCloseTo(3, 12);
    expect(L.pointAtMm(9999).y).toBeCloseTo(4, 12);
  });

  it('returns unit tangents; at an interior vertex the following segment wins', () => {
    expect(L.tangentAtMm(10)).toEqual({ x: 1, y: 0 });
    expect(L.tangentAtMm(30)).toEqual({ x: 0, y: 1 }); // vertex → following segment
    expect(L.tangentAtMm(50)).toEqual({ x: 0, y: 1 });
    expect(L.tangentAtMm(70)).toEqual({ x: 0, y: 1 }); // end → last segment
  });

  it('applies mmPerUnit to the arc-length parameterization', () => {
    const p = new Polyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    expect(p.lengthMm).toBeCloseTo(20, 12);
    expect(p.pointAtMm(10).x).toBeCloseTo(5, 12); // 10 mm = 5 plan units
  });

  it('rejects degenerate inputs', () => {
    expect(() => new Polyline([{ x: 0, y: 0 }], 1)).toThrow(/at least 2/);
    expect(() => new Polyline([{ x: 1, y: 1 }, { x: 1, y: 1 }], 1)).toThrow(/zero length/);
    expect(() => new Polyline([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0)).toThrow(/mmPerUnit/);
  });

  it('skips zero-length interior segments when locating', () => {
    const p = new Polyline(
      [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
      1,
    );
    expect(p.lengthMm).toBeCloseTo(10, 12);
    expect(p.pointAtMm(5)).toEqual({ x: 5, y: 0 });
    expect(p.tangentAtMm(5)).toEqual({ x: 0, y: 1 }); // following non-degenerate segment
    expect(p.pointAtMm(7).y).toBeCloseTo(2, 12);
  });
});
