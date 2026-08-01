/**
 * Serialization of the student-adjustable plant parameters, so a chosen pump rate survives
 * a reload. Pure string ↔ object translation: the host owns `localStorage` (pump/ stays
 * headless), and CLAMPING stays with the plant — `parsePumpParams` only decides which
 * fields are usable at all.
 *
 * The parser never throws. A hand-edited, truncated or foreign value yields a patch without
 * that field, which `clampPumpParams` then fills from the documented defaults — a corrupted
 * entry must cost the student a setting, never the boot.
 */
import { PUMP_PARAM_KEYS } from './params';
import type { PumpParams } from './params';

export const PUMP_PARAMS_STORAGE_KEY = 'mat2sps.pump.params.v1';

/**
 * Read a stored payload into a parameter patch. Unknown keys, non-finite numbers and
 * non-numeric values are dropped; malformed JSON, `null` and a non-object payload yield an
 * empty patch (= "use the defaults").
 */
export function parsePumpParams(raw: string | null | undefined): Partial<PumpParams> {
  if (raw === null || raw === undefined || raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  const out: Partial<PumpParams> = {};
  for (const key of PUMP_PARAM_KEYS) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/** Canonical payload: every key, in `PUMP_PARAM_KEYS` order, so stored text is stable. */
export function serializePumpParams(params: PumpParams): string {
  const out: Record<string, number> = {};
  for (const key of PUMP_PARAM_KEYS) out[key] = params[key];
  return JSON.stringify(out);
}
