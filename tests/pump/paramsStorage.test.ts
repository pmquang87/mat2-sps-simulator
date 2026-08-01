/**
 * Persistence of the student-adjustable plant parameters (`pump/paramsStorage.ts`).
 *
 * The contract is deliberately lopsided: writing is exact, reading is total. A hand-edited,
 * truncated or foreign payload must cost the student a SETTING, never the boot — so every
 * malformed shape below has to come back as "no patch", which `clampPumpParams` then fills
 * from the documented defaults.
 */
import { describe, expect, it } from 'vitest';
import {
  PUMP_PARAM_DEFAULTS,
  PUMP_PARAM_KEYS,
  PUMP_PARAMS_STORAGE_KEY,
  PumpPlant,
  clampPumpParams,
  parsePumpParams,
  serializePumpParams,
} from '../../src/pump';

describe('pump parameter storage', () => {
  it('uses a versioned key', () => {
    expect(PUMP_PARAMS_STORAGE_KEY).toBe('mat2sps.pump.params.v1');
  });

  it('round-trips every parameter', () => {
    const params = clampPumpParams({ pumpRatePctS: 9, llsThresholdPct: 5, initialVolBPct: 25 });
    const restored = parsePumpParams(serializePumpParams(params));
    expect(restored).toEqual({ ...params });
    for (const key of PUMP_PARAM_KEYS) expect(restored[key]).toBe(params[key]);
  });

  it('serializes in a stable key order', () => {
    const text = serializePumpParams(PUMP_PARAM_DEFAULTS);
    expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual([...PUMP_PARAM_KEYS]);
  });

  it('falls back to an empty patch for anything unusable', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '   ',
      '{ not json',
      '[]',
      'null',
      '42',
      '"pumpRatePctS"',
    ]) {
      expect(parsePumpParams(raw), String(raw)).toEqual({});
    }
  });

  it('drops individual bad fields but keeps the good ones', () => {
    const patch = parsePumpParams(JSON.stringify({
      pumpRatePctS: 7,
      refillRatePctS: 'fast',
      drainRatePctS: Number.NaN,
      dryRunDelayS: null,
      hlsThresholdPct: Infinity,
      unrelated: 3,
    }));
    expect(patch).toEqual({ pumpRatePctS: 7 });
  });

  /** The whole point of the fallback: a corrupted entry must still boot a usable plant. */
  it('a corrupted payload boots the plant on its documented defaults', () => {
    const plant = new PumpPlant({ params: clampPumpParams(parsePumpParams('{"pumpRatePctS":')) });
    expect(plant.params).toEqual(PUMP_PARAM_DEFAULTS);
  });

  /** An out-of-range stored value is not rejected, it is clamped — the plant decides. */
  it('an out-of-range stored value lands on the range end, not on the default', () => {
    const patch = parsePumpParams(JSON.stringify({ pumpRatePctS: 9999 }));
    expect(patch.pumpRatePctS).toBe(9999);
    expect(new PumpPlant({ params: patch }).params.pumpRatePctS).toBe(20);
  });
});
