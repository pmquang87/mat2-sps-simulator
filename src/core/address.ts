/**
 * Address model (ARCHITECTURE.md §5.1.1): E/A/M bits, EW/AW/MW words, T, Z.
 *
 * Memory bounds (M1): E bytes 0–15, A bytes 0–15 (AW 6 lives here), M bytes 0–255,
 * T 0–127, Z 0–127. Out-of-range operands are parse-time errors (E-ADR-002).
 */

/** Bit-addressable areas: Eingänge, Ausgänge, Merker. */
export type BitArea = 'E' | 'A' | 'M';
/** Word areas (16 bit, big-endian: high byte at `byte`, low byte at `byte + 1`). */
export type WordArea = 'EW' | 'AW' | 'MW';

export interface BitAddress  { kind: 'bit';  area: BitArea;  byte: number; bit: number /* 0..7 */; }
export interface WordAddress { kind: 'word'; area: WordArea; byte: number; }
export interface TimerAddress   { kind: 'timer';   n: number; }   // T 0..127
export interface CounterAddress { kind: 'counter'; n: number; }   // Z 0..127
export type Address = BitAddress | WordAddress | TimerAddress | CounterAddress;

export interface BlockRef { kind: 'block'; blockType: 'FB' | 'FC' | 'DB' | 'OB' | 'UDT'; n: number; }

/** M1 memory bounds: bytes for the bit areas, unit count for T/Z. */
export const MEMORY_BOUNDS = { E: 16, A: 16, M: 256, T: 128, Z: 128 } as const;

export type AddressParseFailure = 'malformed' | 'range';
export type AddressParseResult =
  | { ok: true; address: Address }
  | { ok: false; reason: AddressParseFailure };

const WORD_RE    = /^([EAM]W)\s*(\d+)$/i;
const BIT_RE     = /^([EAM])\s*(\d+)\.(\d+)$/i;
const TIMER_RE   = /^T\s*(\d+)$/i;
const COUNTER_RE = /^Z\s*(\d+)$/i;

/**
 * Like {@link parseAddress}, but distinguishes syntactically malformed text from a
 * syntactically valid address outside the M1 memory bounds — the parser maps these to
 * E-ADR-001 vs E-ADR-002 (§5.1.5).
 */
export function parseAddressDetailed(text: string): AddressParseResult {
  const t = text.trim();

  let m = WORD_RE.exec(t);
  if (m) {
    const area = m[1]!.toUpperCase() as WordArea;
    const byte = Number(m[2]);
    const bytes = area === 'MW' ? MEMORY_BOUNDS.M : MEMORY_BOUNDS.E;
    if (byte + 1 >= bytes) return { ok: false, reason: 'range' };
    return { ok: true, address: { kind: 'word', area, byte } };
  }

  m = BIT_RE.exec(t);
  if (m) {
    const area = m[1]!.toUpperCase() as BitArea;
    const byte = Number(m[2]);
    const bit = Number(m[3]);
    const bytes = area === 'M' ? MEMORY_BOUNDS.M : MEMORY_BOUNDS.E;
    if (byte >= bytes || bit > 7) return { ok: false, reason: 'range' };
    return { ok: true, address: { kind: 'bit', area, byte, bit } };
  }

  m = TIMER_RE.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (n >= MEMORY_BOUNDS.T) return { ok: false, reason: 'range' };
    return { ok: true, address: { kind: 'timer', n } };
  }

  m = COUNTER_RE.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (n >= MEMORY_BOUNDS.Z) return { ok: false, reason: 'range' };
    return { ok: true, address: { kind: 'counter', n } };
  }

  return { ok: false, reason: 'malformed' };
}

/** "M 100.4" | "M100.4" | "AW 6" | "T 10" | "Z 1" → Address; null if malformed. */
export function parseAddress(text: string): Address | null {
  const r = parseAddressDetailed(text);
  return r.ok ? r.address : null;
}

/** Canonical formatting: "M 100.4", "AW 6", "T 10", "Z 1". */
export function formatAddress(a: Address): string {
  switch (a.kind) {
    case 'bit':     return `${a.area} ${a.byte}.${a.bit}`;
    case 'word':    return `${a.area} ${a.byte}`;
    case 'timer':   return `T ${a.n}`;
    case 'counter': return `Z ${a.n}`;
  }
}

export function bitAddressEquals(a: BitAddress, b: BitAddress): boolean {
  return a.area === b.area && a.byte === b.byte && a.bit === b.bit;
}
