/**
 * Fahrstrom (ARCHITECTURE.md §5.3): M120 bits → AW6 word (FB1 sim) and
 * AW6 → speed mm/s + command (IU/GU/STOP).
 *
 * AW6 encoding is OUR definition (§12 #3 — the real FB1 encoding is unknown; only the
 * M120-bit interface is documented): 0 = stop; low byte = level 1..3; bit 8 set = GU.
 * Multi-bit priority is an assumption too (§12 #4); the `speedConflict` warning event is
 * emitted by the SimCoordinator (§5.2 step 2c) — both functions here stay pure.
 */
import type { TrackplanMeta } from './types';

export interface FahrstromState { word: number; level: 0 | 1 | 2 | 3; direction: 'IU' | 'GU' | 'STOP'; }

/** MB 120 bit layout (Variablenliste): bit number per system symbol. */
export const M120_BIT = {
  Speed3IU: 0,
  Speed2IU: 1,
  Speed1IU: 2,
  STOP: 3,
  Speed1GU: 4,
  Speed2GU: 5,
  Speed3GU: 6,
} as const;

/** AW 6 word: this bit set = GU command (our encoding, §12 #3). */
export const AW6_GU_FLAG = 0x100;

/** FB1 simulation: M120 byte → AW6 word. Priority when multiple bits set (ASSUMPTION,
 *  §12): STOP > Speed1IU > Speed2IU > Speed3IU > Speed1GU > Speed2GU > Speed3GU. The
 *  'speedConflict' warning event is emitted by the SimCoordinator during its FB1 sim
 *  step (§5.2 step 2c) whenever >1 bit is set — bitsToWord itself is pure. No bit set
 *  → 0 (stop). */
export function bitsToWord(m120Byte: number): number {
  const b = m120Byte & 0xff;
  const bit = (n: number): boolean => (b & (1 << n)) !== 0;
  if (bit(M120_BIT.STOP)) return 0;
  if (bit(M120_BIT.Speed1IU)) return 1;
  if (bit(M120_BIT.Speed2IU)) return 2;
  if (bit(M120_BIT.Speed3IU)) return 3;
  if (bit(M120_BIT.Speed1GU)) return AW6_GU_FLAG | 1;
  if (bit(M120_BIT.Speed2GU)) return AW6_GU_FLAG | 2;
  if (bit(M120_BIT.Speed3GU)) return AW6_GU_FLAG | 3;
  return 0;
}

/** AW6 encoding (our definition — real value unknown, §12): 0 = stop;
 *  low byte = level 1..3; bit 8 set = GU. Returns the COMMAND, not a geometric sign —
 *  the Train maps command → per-edge travel sign at node transitions (§8). Words whose
 *  low byte is not a valid level 1..3 decode defensively to STOP. */
export function wordToTarget(aw6: number, meta: TrackplanMeta): { speedMmS: number; command: 'IU' | 'GU' | 'STOP' } {
  const word = aw6 & 0xffff;
  if (word === 0) return { speedMmS: 0, command: 'STOP' };
  const level = word & 0xff;
  if (level < 1 || level > 3) return { speedMmS: 0, command: 'STOP' };
  const speedMmS = meta.speedsMmS[String(level) as '1' | '2' | '3'];
  return { speedMmS, command: (word & AW6_GU_FLAG) !== 0 ? 'GU' : 'IU' };
}
