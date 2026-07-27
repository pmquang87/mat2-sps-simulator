/**
 * Instruction dispatch (binding spec: ARCHITECTURE.md §5.1.8): VKE/ERAB Erstabfrage
 * status model, two 32-bit accus, per-op semantics. Dispatch is a handler table
 * `Record<Mnemonic, OpHandler>` from day one (§11 M2 extension point) — adding ops =
 * adding handlers.
 */
import type { Instruction, Mnemonic, Operand, Program } from './ast';
import type { Diagnostic } from './diagnostics';
import { makeDiagnostic } from './diagnostics';
import { encodeS5Time } from './s5time';
import { MemoryAreas } from './memory';
import { TimerBank } from './timers';
import type { TimerStartKind } from './timers';
import { CounterBank } from './counters';
import type { TraceEntry } from './emulator';

/** Runaway-loop guard: more than this many instructions in one scan → R-RUN-002. */
export const INSTRUCTION_BUDGET = 10_000;

export interface ExecState {
  vke: boolean;
  erab: boolean;    // Erstabfrage flag: true while inside a logic string
  accu1: number;    // unsigned 32-bit
  accu2: number;
}

export function createExecState(): ExecState {
  return { vke: false, erab: false, accu1: 0, accu2: 0 };
}

export interface ScanOutcome {
  diagnostics: Diagnostic[];
  trace?: TraceEntry[];
}

interface Ctx {
  st: ExecState;
  mem: MemoryAreas;
  timers: TimerBank;
  counters: CounterBank;
  labels: ReadonlyMap<string, number>;
  diagnostics: Diagnostic[];
  jumpTo: number;   // -1 = fall through
}

type OpHandler = (instr: Instruction, ctx: Ctx) => void;

function corrupt(instr: Instruction): never {
  throw new Error(`corrupt program: invalid operand for ${instr.op} at line ${instr.line}`);
}

function operandOf(instr: Instruction): Operand {
  if (!instr.operand) corrupt(instr);
  return instr.operand;
}

/** Operand state for bit tests: bit → memory, T → timer Q, Z → value ≠ 0. */
function readTest(instr: Instruction, ctx: Ctx): boolean {
  const op = operandOf(instr);
  switch (op.kind) {
    case 'bit':     return ctx.mem.getBit(op.address);
    case 'timer':   return ctx.timers.q(op.n);
    case 'counter': return ctx.counters.q(op.n);
    default:        corrupt(instr);
  }
}

function bitTest(
  instr: Instruction,
  ctx: Ctx,
  combine: (a: boolean, b: boolean) => boolean,
  negate: boolean,
): void {
  const raw = readTest(instr, ctx);
  const v = negate ? !raw : raw;
  if (!ctx.st.erab) {
    ctx.st.vke = v;              // Erstabfrage: first check loads instead of combining
    ctx.st.erab = true;
  } else {
    ctx.st.vke = combine(ctx.st.vke, v);
  }
}

function toSigned16(x: number): number {
  return ((x & 0xffff) << 16) >> 16;
}

function loadValue(instr: Instruction, ctx: Ctx): number {
  const op = operandOf(instr);
  switch (op.kind) {
    case 'int':     return op.value >>> 0;                       // sign-extended 16→32
    case 's5time':  return encodeS5Time(op.ms);
    case 'zaehler': {                                            // C# BCD
      const h = Math.floor(op.value / 100);
      const t = Math.floor((op.value % 100) / 10);
      const u = op.value % 10;
      return (h << 8) | (t << 4) | u;
    }
    case 'timer':   return ctx.timers.timeValue(op.n);
    case 'counter': return ctx.counters.value(op.n);
    case 'word':    return ctx.mem.getWord(op.address);
    default:        corrupt(instr);
  }
}

function timerStart(kind: TimerStartKind): OpHandler {
  return (instr, ctx) => {
    const op = operandOf(instr);
    if (op.kind !== 'timer') corrupt(instr);
    const err = ctx.timers.executeStart(kind, op.n, ctx.st.vke, ctx.st.accu1);
    if (err) {
      ctx.diagnostics.push(makeDiagnostic('R-RUN-001', { line: instr.line, col: instr.col }));
    }
    ctx.st.erab = false;
  };
}

function edgeEval(rising: boolean): OpHandler {
  return (instr, ctx) => {
    const op = operandOf(instr);
    if (op.kind !== 'bit') corrupt(instr);
    const stored = ctx.mem.getBit(op.address);
    const result = rising ? (!stored && ctx.st.vke) : (stored && !ctx.st.vke);
    ctx.mem.setBit(op.address, ctx.st.vke);     // operand ← VKE every evaluation
    ctx.st.vke = result;
    ctx.st.erab = true;                          // string continues after FP/FN
  };
}

function compare(cmp: (a2: number, a1: number) => boolean): OpHandler {
  return (_instr, ctx) => {
    ctx.st.vke = cmp(toSigned16(ctx.st.accu2), toSigned16(ctx.st.accu1));
    ctx.st.erab = true;                          // a following U chains with AND
  };
}

function jumpTarget(instr: Instruction, ctx: Ctx): number {
  const op = operandOf(instr);
  if (op.kind !== 'label') corrupt(instr);
  const target = ctx.labels.get(op.name);
  if (target === undefined) corrupt(instr);      // parser guarantees label existence
  return target;
}

const HANDLERS: Record<Mnemonic, OpHandler> = {
  U:  (i, c) => bitTest(i, c, (a, b) => a && b, false),
  UN: (i, c) => bitTest(i, c, (a, b) => a && b, true),
  O:  (i, c) => bitTest(i, c, (a, b) => a || b, false),
  ON: (i, c) => bitTest(i, c, (a, b) => a || b, true),
  X:  (i, c) => bitTest(i, c, (a, b) => a !== b, false),
  XN: (i, c) => bitTest(i, c, (a, b) => a !== b, true),

  '=': (i, c) => {                               // writes VKE every cycle, incl. 0
    const op = operandOf(i);
    if (op.kind !== 'bit') corrupt(i);
    c.mem.setBit(op.address, c.st.vke);
    c.st.erab = false;
  },
  S: (i, c) => {
    const op = operandOf(i);
    if (op.kind === 'bit') {
      if (c.st.vke) c.mem.setBit(op.address, true);   // VKE=0 → no-op
    } else if (op.kind === 'counter') {
      c.counters.setPreset(op.n, c.st.vke, c.st.accu1);
    } else corrupt(i);
    c.st.erab = false;
  },
  R: (i, c) => {
    const op = operandOf(i);
    if (op.kind === 'bit') {
      if (c.st.vke) c.mem.setBit(op.address, false);  // VKE=0 → no-op
    } else if (op.kind === 'timer') {
      c.timers.resetTimer(op.n, c.st.vke);
    } else if (op.kind === 'counter') {
      c.counters.resetCounter(op.n, c.st.vke);
    } else corrupt(i);
    c.st.erab = false;
  },

  L: (i, c) => {                                 // VKE-neutral
    c.st.accu2 = c.st.accu1;
    c.st.accu1 = loadValue(i, c) >>> 0;
  },
  T: (i, c) => {                                 // VKE-neutral
    const op = operandOf(i);
    if (op.kind !== 'word') corrupt(i);
    c.mem.setWord(op.address, c.st.accu1 & 0xffff);
  },

  SI: timerStart('SI'),
  SV: timerStart('SV'),
  SE: timerStart('SE'),
  SS: timerStart('SS'),
  SA: timerStart('SA'),
  FR: (i, c) => {
    const op = operandOf(i);
    if (op.kind === 'timer') c.timers.free(op.n, c.st.vke);
    else if (op.kind === 'counter') c.counters.free(op.n, c.st.vke);
    else corrupt(i);
    c.st.erab = false;
  },

  FP: edgeEval(true),
  FN: edgeEval(false),

  ZV: (i, c) => {
    const op = operandOf(i);
    if (op.kind !== 'counter') corrupt(i);
    c.counters.countUp(op.n, c.st.vke);
    c.st.erab = false;
  },
  ZR: (i, c) => {
    const op = operandOf(i);
    if (op.kind !== 'counter') corrupt(i);
    c.counters.countDown(op.n, c.st.vke);
    c.st.erab = false;
  },

  '==I': compare((a2, a1) => a2 === a1),
  '<>I': compare((a2, a1) => a2 !== a1),
  '>I':  compare((a2, a1) => a2 > a1),
  '>=I': compare((a2, a1) => a2 >= a1),
  '<I':  compare((a2, a1) => a2 < a1),
  '<=I': compare((a2, a1) => a2 <= a1),

  SPA: (i, c) => {                               // VKE/ERAB unchanged
    c.jumpTo = jumpTarget(i, c);
  },
  SPB: (i, c) => {                               // taken if VKE=1; afterwards VKE←1, ERAB←false
    if (c.st.vke) c.jumpTo = jumpTarget(i, c);
    c.st.vke = true;
    c.st.erab = false;
  },
  SPBN: (i, c) => {                              // taken if VKE=0; afterwards VKE←1, ERAB←false
    if (!c.st.vke) c.jumpTo = jumpTarget(i, c);
    c.st.vke = true;
    c.st.erab = false;
  },

  NOP: () => { /* label anchor, no effect */ },
};

/** Execute one linear pass over the program (one scan's program phase). */
export function runScan(
  program: Program,
  state: ExecState,
  memory: MemoryAreas,
  timers: TimerBank,
  counters: CounterBank,
  withTrace = false,
): ScanOutcome {
  const diagnostics: Diagnostic[] = [];
  const trace: TraceEntry[] | undefined = withTrace ? [] : undefined;
  const ctx: Ctx = {
    st: state, mem: memory, timers, counters,
    labels: program.labels, diagnostics, jumpTo: -1,
  };

  let pc = 0;
  let executed = 0;
  const instructions = program.instructions;

  while (pc < instructions.length) {
    const instr = instructions[pc]!;
    executed += 1;
    if (executed > INSTRUCTION_BUDGET) {
      diagnostics.push(makeDiagnostic('R-RUN-002', { line: instr.line, col: instr.col }));
      break;                                     // scan aborted
    }
    ctx.jumpTo = -1;
    HANDLERS[instr.op](instr, ctx);
    if (trace) {
      trace.push({
        instrIndex: pc,
        line: instr.line,
        statusAfter: { vke: state.vke, erab: state.erab, accu1: state.accu1, accu2: state.accu2 },
      });
    }
    pc = ctx.jumpTo >= 0 ? ctx.jumpTo : pc + 1;
  }

  return trace ? { diagnostics, trace } : { diagnostics };
}
