/**
 * Switch indication: the blade blend is a pure function of `SwitchState` + `alphaMs` — the
 * scene has no clock of its own (ARCHITECTURE.md §5.4), so a 300 ms actuation
 * (`switchActuationMs`, Anleitung V.1) must be reconstructible from `remainingMs` alone.
 */
import { describe, expect, it } from 'vitest';
import { coilColourOfBranch, switchBlend } from '../../src/scene';
import type { SwitchState } from '../../src/plant';

function state(over: Partial<SwitchState> = {}): SwitchState {
  return {
    id: 'xW01TEST',
    position: 0,
    moving: false,
    coilG: false,
    coilR: false,
    ...over,
  };
}

describe('switchBlend', () => {
  it('rests exactly on the current position', () => {
    expect(switchBlend(state({ position: 0 }), 300)).toBe(0);
    expect(switchBlend(state({ position: 1 }), 300)).toBe(1);
  });

  it('interpolates from remainingMs over the actuation time', () => {
    const s = state({ position: 0, moving: true, movingToward: 1, remainingMs: 300 });
    expect(switchBlend(s, 300)).toBeCloseTo(0, 9);
    expect(switchBlend({ ...s, remainingMs: 150 }, 300)).toBeCloseTo(0.5, 9);
    expect(switchBlend({ ...s, remainingMs: 0 }, 300)).toBeCloseTo(1, 9);
  });

  it('moves the other way when throwing back to branch 0', () => {
    const s = state({ position: 1, moving: true, movingToward: 0, remainingMs: 75 });
    expect(switchBlend(s, 300)).toBeCloseTo(0.25, 9);
  });

  it('advances with the render alpha but never overshoots', () => {
    const s = state({ position: 0, moving: true, movingToward: 1, remainingMs: 150 });
    expect(switchBlend(s, 300, 75)).toBeCloseTo(0.75, 9);
    expect(switchBlend(s, 300, 10_000)).toBeCloseTo(1, 9);
    expect(switchBlend(s, 300, -50)).toBeCloseTo(0.5, 9);
  });

  it('falls back to a full actuation when remainingMs is absent', () => {
    const s = state({ position: 0, moving: true, movingToward: 1 });
    expect(switchBlend(s, 300)).toBeCloseTo(0, 9);
  });

  it('tolerates a zero actuation time from the trackplan meta', () => {
    const s = state({ position: 0, moving: true, movingToward: 1, remainingMs: 0 });
    expect(switchBlend(s, 0)).toBeCloseTo(1, 9);
  });
});

describe('coilColourOfBranch', () => {
  it('maps branch indices back to the G/R coil', () => {
    const spec = { coilToBranch: { G: 0 as const, R: 1 as const } };
    expect(coilColourOfBranch(spec, 0)).toBe('G');
    expect(coilColourOfBranch(spec, 1)).toBe('R');
  });

  it('reports no colour for a non-commandable switch (coilToBranch null)', () => {
    expect(coilColourOfBranch({ coilToBranch: null }, 0)).toBeNull();
    expect(coilColourOfBranch({ coilToBranch: null }, 1)).toBeNull();
  });

  it('handles both coils mapped to the same branch', () => {
    const spec = { coilToBranch: { G: 1 as const, R: 1 as const } };
    expect(coilColourOfBranch(spec, 1)).toBe('G');
    expect(coilColourOfBranch(spec, 0)).toBeNull();
  });
});
