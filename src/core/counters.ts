/**
 * Counter bank (ARCHITECTURE.md §5.1.8): ZV/ZR edge counting with separate per-counter
 * edge memories, S Z (BCD preset on edge), R Z (level), FR Z. Values saturate at 0/999.
 * A ZV/ZR result is visible to `L Z n` in the same scan (the Gruppe A/B NW 3 pattern).
 */
import { MEMORY_BOUNDS } from './address';
import type { CounterView } from './emulator';

interface CounterState {
  value: number;           // 0..999
  prevUpVke: boolean;      // ZV edge memory
  prevDownVke: boolean;    // ZR edge memory
  prevSetVke: boolean;     // S Z edge memory
  prevFrVke: boolean;      // FR edge memory
}

function freshState(): CounterState {
  return { value: 0, prevUpVke: false, prevDownVke: false, prevSetVke: false, prevFrVke: false };
}

/** BCD low 12 bits → 0..999 (invalid nibbles clamp to 9 — defensive, cannot arise from C# literals). */
function bcdToValue(word: number): number {
  const h = Math.min((word >> 8) & 0xf, 9);
  const t = Math.min((word >> 4) & 0xf, 9);
  const u = Math.min(word & 0xf, 9);
  return h * 100 + t * 10 + u;
}

export class CounterBank {
  private readonly states: CounterState[];

  constructor() {
    this.states = Array.from({ length: MEMORY_BOUNDS.Z }, freshState);
  }

  private state(n: number): CounterState {
    const st = this.states[n];
    if (!st) throw new RangeError(`counter number out of range: Z ${n}`);
    return st;
  }

  /** `ZV Z n`: +1 on rising edge of VKE, saturating at 999. */
  countUp(n: number, vke: boolean): void {
    const st = this.state(n);
    const rising = vke && !st.prevUpVke;
    st.prevUpVke = vke;
    if (rising && st.value < 999) st.value += 1;
  }

  /** `ZR Z n`: −1 on rising edge of VKE, saturating at 0. */
  countDown(n: number, vke: boolean): void {
    const st = this.state(n);
    const rising = vke && !st.prevDownVke;
    st.prevDownVke = vke;
    if (rising && st.value > 0) st.value -= 1;
  }

  /** `S Z n`: on rising edge of VKE → value ← BCD preset from accu1 (C#…). */
  setPreset(n: number, vke: boolean, accu1: number): void {
    const st = this.state(n);
    const rising = vke && !st.prevSetVke;
    st.prevSetVke = vke;
    if (rising) st.value = bcdToValue(accu1 & 0xfff);
  }

  /** `R Z n`: if VKE=1 (level) → value ← 0. */
  resetCounter(n: number, vke: boolean): void {
    const st = this.state(n);
    if (vke) st.value = 0;
  }

  /** `FR Z n`: on rising edge of VKE clears the ZV/ZR/S edge memories. */
  free(n: number, vke: boolean): void {
    const st = this.state(n);
    const rising = vke && !st.prevFrVke;
    st.prevFrVke = vke;
    if (rising) {
      st.prevUpVke = false;
      st.prevDownVke = false;
      st.prevSetVke = false;
    }
  }

  /** Current count (same-cycle visible to `L Z n`). */
  value(n: number): number {
    return this.state(n).value;
  }

  /** Counter status bit (U Z n): value ≠ 0. */
  q(n: number): boolean {
    return this.state(n).value !== 0;
  }

  view(n: number): CounterView {
    const st = this.state(n);
    return { n, value: st.value, q: st.value !== 0 };
  }

  /** Clear all counters incl. edge memories (Emulator.reset()). */
  resetAll(): void {
    for (let i = 0; i < this.states.length; i++) this.states[i] = freshState();
  }
}
