/**
 * Memory / process image (ARCHITECTURE.md §5.1.6).
 *
 * Process image semantics: the COORDINATOR writes physical input states into `inputs`
 * before calling Emulator.step() (the PAE latch) and reads `outputs` + relevant `flags`
 * after the scan (PAA + wired Merker). The emulator itself performs no I/O.
 */
import type { BitAddress, WordAddress } from './address';
import { MEMORY_BOUNDS } from './address';

export class MemoryAreas {
  readonly inputs:  Uint8Array = new Uint8Array(MEMORY_BOUNDS.E);   // E  0..15  — PAE
  readonly outputs: Uint8Array = new Uint8Array(MEMORY_BOUNDS.A);   // A  0..15  — PAA, AW 6 here
  readonly flags:   Uint8Array = new Uint8Array(MEMORY_BOUNDS.M);   // M  0..255 — Merker

  private bufferFor(area: 'E' | 'A' | 'M' | 'EW' | 'AW' | 'MW'): Uint8Array {
    switch (area) {
      case 'E': case 'EW': return this.inputs;
      case 'A': case 'AW': return this.outputs;
      case 'M': case 'MW': return this.flags;
    }
  }

  getBit(a: BitAddress): boolean {
    const buf = this.bufferFor(a.area);
    return ((buf[a.byte]! >> a.bit) & 1) === 1;
  }

  setBit(a: BitAddress, v: boolean): void {
    const buf = this.bufferFor(a.area);
    if (v) buf[a.byte] = buf[a.byte]! | (1 << a.bit);
    else buf[a.byte] = buf[a.byte]! & ~(1 << a.bit);
  }

  getWord(a: WordAddress): number {          // unsigned 0..0xFFFF, big-endian byte pair
    const buf = this.bufferFor(a.area);
    return ((buf[a.byte]! << 8) | buf[a.byte + 1]!) >>> 0;
  }

  setWord(a: WordAddress, v: number): void {
    const buf = this.bufferFor(a.area);
    const word = v & 0xffff;
    buf[a.byte] = (word >> 8) & 0xff;        // high byte at `byte` (big-endian)
    buf[a.byte + 1] = word & 0xff;
  }

  reset(): void {                            // all zero
    this.inputs.fill(0);
    this.outputs.fill(0);
    this.flags.fill(0);
  }
}
