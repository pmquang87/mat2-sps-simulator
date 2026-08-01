/**
 * Pump plant parameters — MODEL PHYSICS, not course data (the Anleitung gives the signal
 * map and the start/stop conditions, but no dynamics at all). They live in typed TS with
 * documented defaults and ranges instead of in `src/data/*.json` for exactly that reason.
 *
 * Every parameter is student-adjustable so the learner can see the effect of a change
 * (doubling the pump rate halves the fill time, moving a threshold moves the probe and the
 * point where the sensor bit flips). Input is CLAMPED, never rejected: an out-of-range or
 * non-numeric value falls back inside the range, so a slider or a text field can never put
 * the model into a state the scene cannot draw.
 *
 * Application semantics (binding, pinned by tests):
 *   - rates, thresholds and the dry-run delay apply LIVE (next physics step);
 *   - `initialVolAPct` / `initialVolBPct` apply on the NEXT reset — changing them must not
 *     teleport the liquid while a program is running.
 */

export interface PumpParams {
  /** Transfer rate A → B while the pump output is on, % of tank capacity per second. */
  pumpRatePctS: number;
  /** Refill valve into tank A (plant-side, not PLC-controlled), %/s. */
  refillRatePctS: number;
  /** Drain valve out of tank B (plant-side, not PLC-controlled), %/s. */
  drainRatePctS: number;
  /** LLS trip level: the empty bit is 1 at or below this level, %. */
  llsThresholdPct: number;
  /** HLS trip level: the full bit is 1 at or above this level, %. */
  hlsThresholdPct: number;
  /** How long the pump must run with tank A empty before the dry-run guard reports dry, s. */
  dryRunDelayS: number;
  /** Level of tank A after a reset, %. */
  initialVolAPct: number;
  /** Level of tank B after a reset, %. */
  initialVolBPct: number;
}

export type PumpParamKey = keyof PumpParams;

export interface PumpParamRange {
  min: number;
  max: number;
  /** Documented default — `PUMP_PARAM_DEFAULTS` is derived from this table. */
  default: number;
}

/**
 * Ranges are chosen so that no combination can produce a degenerate plant:
 * `llsThresholdPct` stays below `hlsThresholdPct` by construction (20 < 80), with room for
 * the sensor hysteresis band on both sides, and no rate can be zero (a zero rate would make
 * "the pump is running" indistinguishable from "the pump is off" in the scene).
 *
 * `initialVolAPct` is 90, not 100, and that is STRUCTURAL rather than taste. The two tanks
 * have one capacity and one transfer rate, so what leaves A arrives in B: with A full and B
 * empty the manual's two end conditions — "Tank A leer" (level ≤ `llsThresholdPct` = 2) and
 * "Tank B voll" (level ≥ `hlsThresholdPct` = 98) — are reached in the SAME physics step,
 * because 100 − 2 = 98. A student watching the pump stop could then not tell which condition
 * stopped it, and a program that implements only one of the two would look correct.
 * Starting A at 90 separates them: B tops out at 90, so a plain pump-down always ends on
 * "Tank A leer", and "Tank B voll" is reached only when the hand valve refills A while the
 * pump runs — which is exactly the manipulation the second condition exists to teach.
 */
export const PUMP_PARAM_RANGES: Readonly<Record<PumpParamKey, PumpParamRange>> = {
  pumpRatePctS:   { min: 0.5, max: 20,  default: 4 },
  refillRatePctS: { min: 0.5, max: 20,  default: 6 },
  drainRatePctS:  { min: 0.5, max: 20,  default: 6 },
  llsThresholdPct: { min: 1,  max: 20,  default: 2 },
  hlsThresholdPct: { min: 80, max: 99,  default: 98 },
  dryRunDelayS:    { min: 0,  max: 10,  default: 2 },
  initialVolAPct:  { min: 0,  max: 100, default: 90 },
  initialVolBPct:  { min: 0,  max: 100, default: 0 },
};

/** Stable key order — the UI renders one control per key in this order. */
export const PUMP_PARAM_KEYS: readonly PumpParamKey[] = [
  'pumpRatePctS',
  'refillRatePctS',
  'drainRatePctS',
  'llsThresholdPct',
  'hlsThresholdPct',
  'dryRunDelayS',
  'initialVolAPct',
  'initialVolBPct',
];

function defaultsFromRanges(): PumpParams {
  const out = {} as Record<PumpParamKey, number>;
  for (const key of PUMP_PARAM_KEYS) out[key] = PUMP_PARAM_RANGES[key].default;
  return out as PumpParams;
}

export const PUMP_PARAM_DEFAULTS: PumpParams = defaultsFromRanges();

/** Clamp one parameter into its range; a non-finite value falls back to `fallback`. */
export function clampPumpParam(key: PumpParamKey, value: number, fallback: number): number {
  const range = PUMP_PARAM_RANGES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < range.min) return range.min;
  if (value > range.max) return range.max;
  return value;
}

/**
 * Merge `patch` over `base` (defaults unless given) and clamp every field. Never throws —
 * an invalid field keeps the base value, an out-of-range field lands on the range end.
 */
export function clampPumpParams(
  patch?: Partial<PumpParams> | null,
  base: PumpParams = PUMP_PARAM_DEFAULTS,
): PumpParams {
  const out = {} as Record<PumpParamKey, number>;
  for (const key of PUMP_PARAM_KEYS) {
    const fallback = clampPumpParam(key, base[key], PUMP_PARAM_RANGES[key].default);
    const raw = patch?.[key];
    out[key] = raw === undefined ? fallback : clampPumpParam(key, raw, fallback);
  }
  return out as PumpParams;
}
