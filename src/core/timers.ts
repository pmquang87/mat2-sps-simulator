/**
 * S5 timer bank (ARCHITECTURE.md §5.1.8): SI/SV/SE/SS/SA as sim-time state machines with
 * per-timer edge memory. Timer advancement happens once per scan BEFORE the program runs;
 * expiries land exactly in simulated time and are observed at the next instruction that
 * reads the timer.
 */
import { MEMORY_BOUNDS } from './address';
import { decodeS5Time, encodeS5Time, isValidS5Time } from './s5time';
import type { TimerView } from './emulator';

export type TimerStartKind = 'SI' | 'SV' | 'SE' | 'SS' | 'SA';

interface TimerState {
  kind?: TimerStartKind;
  presetMs: number;
  remainingMs: number;
  running: boolean;
  q: boolean;
  latched: boolean;        // SS latch
  prevStartVke: boolean;   // edge memory of the start input
  prevFrVke: boolean;      // edge memory of the FR input
}

function freshState(): TimerState {
  return {
    presetMs: 0, remainingMs: 0, running: false,
    q: false, latched: false, prevStartVke: false, prevFrVke: false,
  };
}

export type TimerStartError = 'invalid-s5time';

export class TimerBank {
  private readonly states: TimerState[];

  constructor() {
    this.states = Array.from({ length: MEMORY_BOUNDS.T }, freshState);
  }

  private state(n: number): TimerState {
    const st = this.states[n];
    if (!st) throw new RangeError(`timer number out of range: T ${n}`);
    return st;
  }

  /** Advance all running timers by dtMs (called once per scan, before the program). */
  advance(dtMs: number): void {
    for (const st of this.states) {
      if (!st.running) continue;
      st.remainingMs -= dtMs;
      if (st.remainingMs > 0) continue;
      st.remainingMs = 0;
      st.running = false;
      switch (st.kind) {
        case 'SI': case 'SV': case 'SA':
          st.q = false;
          break;
        case 'SE':
          st.q = true;                     // VKE was still 1, else the SE op had aborted it
          break;
        case 'SS':
          st.q = true;
          st.latched = true;               // Q=1 latched until R T n
          break;
        default:
          break;
      }
    }
  }

  /**
   * Execute a timer-start instruction (SI/SV/SE/SS/SA T n) with the current VKE.
   * Preset ← decodeS5Time(accu1 low word) at the start edge; invalid → 'invalid-s5time'
   * (R-RUN-001) and the start is skipped. Returns null when fine.
   */
  executeStart(kind: TimerStartKind, n: number, vke: boolean, accu1: number): TimerStartError | null {
    const st = this.state(n);
    const risingEdge = vke && !st.prevStartVke;
    const fallingEdge = !vke && st.prevStartVke;
    st.prevStartVke = vke;
    let error: TimerStartError | null = null;

    const tryStart = (): boolean => {
      const word = accu1 & 0xffff;
      if (!isValidS5Time(word)) { error = 'invalid-s5time'; return false; }
      st.kind = kind;
      st.presetMs = decodeS5Time(word);
      st.remainingMs = st.presetMs;
      st.running = true;
      return true;
    };

    switch (kind) {
      case 'SI':                            // Impuls
        if (risingEdge) { if (tryStart()) st.q = true; }
        else if (!vke) { st.running = false; st.q = false; st.remainingMs = 0; }
        break;
      case 'SV':                            // verlängerter Impuls: retrigger restarts, VKE drop ignored
        if (risingEdge) { if (tryStart()) st.q = true; }
        break;
      case 'SE':                            // Einschaltverzögerung
        if (risingEdge) { if (tryStart()) st.q = false; }
        else if (!vke) { st.running = false; st.q = false; st.remainingMs = 0; }
        break;
      case 'SS':                            // speichernde Einschaltverzögerung: latch, only R clears
        if (risingEdge) tryStart();
        break;
      case 'SA':                            // Ausschaltverzögerung
        if (vke) {
          st.kind = kind;
          st.q = true;                      // Q=1 immediately, timer cleared
          st.running = false;
          st.remainingMs = 0;
        } else if (fallingEdge) {
          tryStart();                       // off-delay begins; Q stays 1 during the run
        }
        break;
    }
    return error;
  }

  /** `R T n`: if VKE=1 → timer stopped, Q=0, remaining=0, SS latch cleared. */
  resetTimer(n: number, vke: boolean): void {
    const st = this.state(n);
    if (!vke) return;
    st.running = false;
    st.q = false;
    st.remainingMs = 0;
    st.latched = false;
  }

  /** `FR T n`: on rising edge of VKE clears the timer's start-edge memory (restart
   *  without a new input edge). Rarely used; implemented minimally (§5.1.8). */
  free(n: number, vke: boolean): void {
    const st = this.state(n);
    const rising = vke && !st.prevFrVke;
    st.prevFrVke = vke;
    if (rising) st.prevStartVke = false;
  }

  /** Timer status bit (U T n and friends). */
  q(n: number): boolean {
    return this.state(n).q;
  }

  /** `L T n`: current time value in binary, in units of the preset's time base. */
  timeValue(n: number): number {
    const st = this.state(n);
    if (st.remainingMs <= 0 || st.presetMs <= 0) return 0;
    const base = [10, 100, 1000, 10000][(encodeS5Time(st.presetMs) >> 12) & 0x3]!;
    return Math.ceil(st.remainingMs / base);
  }

  view(n: number): TimerView {
    const st = this.state(n);
    const v: TimerView = {
      n,
      q: st.q,
      running: st.running,
      remainingMs: st.running ? st.remainingMs : 0,
      presetMs: st.presetMs,
    };
    if (st.kind !== undefined) v.kind = st.kind;
    return v;
  }

  /** Clear all timers incl. edge memories (Emulator.reset()). */
  resetAll(): void {
    for (let i = 0; i < this.states.length; i++) this.states[i] = freshState();
  }
}
