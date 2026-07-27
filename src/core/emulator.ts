/**
 * Emulator facade (ARCHITECTURE.md §5.1.7): load/step/reset/inspection, scan cycle driver.
 * Execution semantics are the binding spec in §5.1.8; scan anatomy in §6.2:
 *   1. advance running timers by dt, 2. execute the program linearly, 3. cycle counter++.
 */
import type { BitAddress, WordAddress } from './address';
import { parseAddress } from './address';
import type { Program } from './ast';
import type { Diagnostic } from './diagnostics';
import { MemoryAreas } from './memory';
import type { SymbolTable } from './symbols';
import { TimerBank } from './timers';
import { CounterBank } from './counters';
import { createExecState, runScan } from './exec';
import type { ExecState } from './exec';
import { parseProgram } from './parser';

export interface LoadResult { ok: boolean; diagnostics: Diagnostic[]; program?: Program; }

export interface StatusView { vke: boolean; erab: boolean; accu1: number; accu2: number; }

export interface TimerView {
  n: number; kind?: 'SI' | 'SV' | 'SE' | 'SS' | 'SA';
  q: boolean; running: boolean; remainingMs: number; presetMs: number;
}

export interface CounterView { n: number; value: number /* 0..999 */; q: boolean /* value ≠ 0 */; }

export interface TraceEntry { instrIndex: number; line: number; statusAfter: StatusView; }

export interface ScanResult { cycle: number; diagnostics: Diagnostic[]; trace?: TraceEntry[]; }

export class Emulator {
  private readonly symbols: SymbolTable;
  readonly memory: MemoryAreas = new MemoryAreas();
  private readonly timers = new TimerBank();
  private readonly counters = new CounterBank();
  private state: ExecState = createExecState();
  private program: Program | null = null;
  private cycles = 0;

  constructor(symbols: SymbolTable) {
    this.symbols = symbols;
  }

  /** Parse + static checks. On error keeps the previously loaded program (if any). */
  load(source: string): LoadResult {
    const res = parseProgram(source, this.symbols);
    if (res.program) {
      this.program = res.program;
      return { ok: true, diagnostics: res.diagnostics, program: res.program };
    }
    return { ok: false, diagnostics: res.diagnostics };
  }

  /** Clear memory, timers, counters, edge memories, cycle counter. Keeps program. */
  reset(): void {
    this.memory.reset();
    this.timers.resetAll();
    this.counters.resetAll();
    this.state = createExecState();
    this.cycles = 0;
  }

  /** Execute exactly ONE scan cycle. dtMs = simulated time elapsed since the previous scan;
   *  running timers advance by dtMs BEFORE the program executes. Set trace=true to record
   *  a per-instruction TraceEntry list (cycle inspector, M2). */
  step(dtMs: number, trace?: boolean): ScanResult {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new RangeError(`step(): dtMs must be a non-negative finite number, got ${dtMs}`);
    }
    this.timers.advance(dtMs);
    let diagnostics: Diagnostic[] = [];
    let traceOut: TraceEntry[] | undefined;
    if (this.program) {
      const outcome = runScan(this.program, this.state, this.memory, this.timers, this.counters, trace === true);
      diagnostics = outcome.diagnostics;
      traceOut = outcome.trace;
    } else if (trace === true) {
      traceOut = [];
    }
    this.cycles += 1;
    const result: ScanResult = { cycle: this.cycles, diagnostics };
    if (traceOut !== undefined) result.trace = traceOut;
    return result;
  }

  // ── inspection (read-only views; UI/watch table) ─────────────────────────

  get cycleCount(): number {
    return this.cycles;
  }

  getStatus(): StatusView {
    return { vke: this.state.vke, erab: this.state.erab, accu1: this.state.accu1, accu2: this.state.accu2 };
  }

  getTimer(n: number): TimerView {
    return this.timers.view(n);
  }

  getCounter(n: number): CounterView {
    return this.counters.view(n);
  }

  peekBit(ref: string | BitAddress): boolean {      // symbol name or address
    return this.memory.getBit(this.resolveBit(ref));
  }

  peekWord(ref: string | WordAddress): number {
    return this.memory.getWord(this.resolveWord(ref));
  }

  // ── peripheral side (coordinator only — not for UI) ──────────────────────

  setInputBit(a: BitAddress, v: boolean): void {    // write into PAE before step()
    if (a.area !== 'E') {
      throw new Error(`setInputBit expects an E address, got ${a.area} ${a.byte}.${a.bit}`);
    }
    this.memory.setBit(a, v);
  }

  hasProgram(): boolean {
    return this.program !== null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private resolveBit(ref: string | BitAddress): BitAddress {
    if (typeof ref !== 'string') return ref;
    const entry = this.symbols.lookup(ref);
    if (entry && entry.target.kind === 'bit') return entry.target;
    const parsed = parseAddress(ref);
    if (parsed && parsed.kind === 'bit') return parsed;
    throw new Error(`peekBit: cannot resolve "${ref}" to a bit address`);
  }

  private resolveWord(ref: string | WordAddress): WordAddress {
    if (typeof ref !== 'string') return ref;
    const entry = this.symbols.lookup(ref);
    if (entry && entry.target.kind === 'word') return entry.target;
    const parsed = parseAddress(ref);
    if (parsed && parsed.kind === 'word') return parsed;
    throw new Error(`peekWord: cannot resolve "${ref}" to a word address`);
  }
}
