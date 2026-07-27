/**
 * S5TIME (ARCHITECTURE.md §5.1.3): 16-bit word, bits 13–12 = time base (0b00=10 ms,
 * 0b01=100 ms, 0b10=1 s, 0b11=10 s), bits 11–0 = BCD value 000–999.
 * Range 10 ms … 9 990 s (2 h 46 min 30 s).
 */

const BASE_MS = [10, 100, 1000, 10000] as const;

/** Upper bound of the representable range: 999 × 10 s = 9 990 000 ms. */
export const S5TIME_MAX_MS = 9_990_000;

function toBcd(value: number): number {
  const h = Math.floor(value / 100);
  const t = Math.floor((value % 100) / 10);
  const u = value % 10;
  return (h << 8) | (t << 4) | u;
}

/** ms → S5TIME word. Picks the smallest base that fits; TRUNCATES ms toward zero to the
 *  chosen base's tick (STEP 7 semantics — non-multiples are cut off ("abgeschnitten"),
 *  never rounded up). 0..9 ms clamps to the 10 ms minimum. Throws RangeError above
 *  9_990_000 ms or below 0. */
export function encodeS5Time(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0 || ms > S5TIME_MAX_MS) {
    throw new RangeError(`S5TIME out of range (0..${S5TIME_MAX_MS} ms): ${ms}`);
  }
  const clamped = ms < 10 ? 10 : ms;
  for (let base = 0; base < BASE_MS.length; base++) {
    const value = Math.floor(clamped / BASE_MS[base]!);
    if (value <= 999) return (base << 12) | toBcd(value);
  }
  /* istanbul ignore next -- unreachable: max ms fits base 3 */
  throw new RangeError(`S5TIME out of range: ${ms}`);
}

/** True iff `word` is a well-formed 16-bit S5TIME (three valid BCD digits; bits 15–14
 *  are irrelevant and ignored, as on the real PLC). Used for the R-RUN-001 check. */
export function isValidS5Time(word: number): boolean {
  if (!Number.isInteger(word) || word < 0 || word > 0xffff) return false;
  const v = word & 0x0fff;
  return ((v >> 8) & 0xf) <= 9 && ((v >> 4) & 0xf) <= 9 && (v & 0xf) <= 9;
}

export function decodeS5Time(word: number): number {              // → ms
  if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
    throw new RangeError(`S5TIME word out of range: ${word}`);
  }
  if (!isValidS5Time(word)) {
    throw new RangeError(`invalid BCD digits in S5TIME word 0x${word.toString(16)}`);
  }
  const v = word & 0x0fff;
  const value = ((v >> 8) & 0xf) * 100 + ((v >> 4) & 0xf) * 10 + (v & 0xf);
  return value * BASE_MS[(word >> 12) & 0x3]!;
}

const LITERAL_RE = /^S5T#(.+)$/i;
const PART_RE = /^(\d+)(MS|H|M|S)/;
const PART_ORDER: Record<string, number> = { H: 0, M: 1, S: 2, MS: 3 };
const PART_MS: Record<string, number> = { H: 3_600_000, M: 60_000, S: 1000, MS: 1 };

/** "S5T#4S500MS", "S5T#300MS", "S5T#1H10M" (order H,M,S,MS; parts optional) → ms; null if malformed. */
export function parseS5TimeLiteral(text: string): number | null {
  const m = LITERAL_RE.exec(text.trim());
  if (!m) return null;
  let rest = m[1]!.toUpperCase().replace(/_/g, '');
  let lastOrder = -1;
  let total = 0;
  let any = false;
  while (rest.length > 0) {
    const pm = PART_RE.exec(rest);
    if (!pm) return null;
    const unit = pm[2]!;
    const order = PART_ORDER[unit]!;
    if (order <= lastOrder) return null;      // enforce H,M,S,MS order, no repeats
    lastOrder = order;
    total += Number(pm[1]) * PART_MS[unit]!;
    any = true;
    rest = rest.slice(pm[0].length);
  }
  if (!any || total > S5TIME_MAX_MS) return null;
  return total;
}

export function formatS5Time(ms: number): string {                // canonical "S5T#4S500MS"
  if (!Number.isFinite(ms) || ms < 0 || ms > S5TIME_MAX_MS) {
    throw new RangeError(`S5TIME out of range (0..${S5TIME_MAX_MS} ms): ${ms}`);
  }
  let rem = Math.floor(ms);
  const h = Math.floor(rem / 3_600_000); rem %= 3_600_000;
  const min = Math.floor(rem / 60_000);  rem %= 60_000;
  const s = Math.floor(rem / 1000);
  const msPart = rem % 1000;
  let out = 'S5T#';
  if (h > 0) out += `${h}H`;
  if (min > 0) out += `${min}M`;
  if (s > 0) out += `${s}S`;
  if (msPart > 0) out += `${msPart}MS`;
  return out === 'S5T#' ? 'S5T#0MS' : out;
}
