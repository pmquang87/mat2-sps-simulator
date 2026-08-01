/**
 * AWL parser (ARCHITECTURE.md §5.1.4/§5.1.5): token stream → Program, plus all static
 * checks — operand typing, symbol resolution (case-sensitive with suggestions), label
 * resolution, network markers, and the W-LOG-001 / W-TIM-001 / W-RES-001 warnings
 * (W-RES-001 whitelist exactly as revised in §5.1.5).
 */
import type { Address } from './address';
import { formatAddress, parseAddressDetailed } from './address';
import type { Instruction, Mnemonic, NetworkMarker, Operand, Program } from './ast';
import { WORD_MNEMONICS } from './ast';
import type { Diagnostic } from './diagnostics';
import { makeDiagnostic } from './diagnostics';
import { parseS5TimeLiteral } from './s5time';
import type { SymbolTable } from './symbols';
import type { Token } from './tokenizer';
import { tokenize } from './tokenizer';

export interface ParseResult {
  /** null when any error-severity diagnostic was produced (warnings alone are fine). */
  program: Program | null;
  diagnostics: Diagnostic[];
}

const MNEMONIC_WORDS = new Set<string>(WORD_MNEMONICS);

const COMPARE_MNEMONICS = new Set<string>(['==I', '<>I', '>I', '>=I', '<I', '<=I']);
const JUMP_MNEMONICS = new Set<Mnemonic>(['SPA', 'SPB', 'SPBN']);
const TIMER_START_MNEMONICS = new Set<Mnemonic>(['SI', 'SV', 'SE', 'SS', 'SA']);
const LABEL_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,3}$/;
const NETWORK_RE = /^\/\/\s*(Netzwerk|Network)\s+(\d+)/i;
const COUNTER_LIT_RE = /^C#(\d{1,3})$/i;
const INT_RE = /^-?\d+$/;

/** Allowed operand kinds per mnemonic (§5.1.8 instruction table). */
const OPERAND_KINDS: Record<Mnemonic, readonly Operand['kind'][]> = {
  U:  ['bit', 'timer', 'counter'], UN: ['bit', 'timer', 'counter'],
  O:  ['bit', 'timer', 'counter'], ON: ['bit', 'timer', 'counter'],
  X:  ['bit', 'timer', 'counter'], XN: ['bit', 'timer', 'counter'],
  '=': ['bit'],
  S:  ['bit', 'counter'],                 // S on T is invalid (§5.1.4: S/R also on T (R), Z (S/R))
  R:  ['bit', 'timer', 'counter'],
  L:  ['int', 's5time', 'zaehler', 'timer', 'counter', 'word'],
  T:  ['word'],
  SI: ['timer'], SV: ['timer'], SE: ['timer'], SS: ['timer'], SA: ['timer'],
  FR: ['timer', 'counter'],
  FP: ['bit'], FN: ['bit'],
  ZV: ['counter'], ZR: ['counter'],
  '==I': [], '<>I': [], '>I': [], '>=I': [], '<I': [], '<=I': [],
  SPA: ['label'], SPB: ['label'], SPBN: ['label'],
  NOP: ['int'],
};

interface PendingLabel { name: string; line: number; col: number; length: number; }

export function parseProgram(
  source: string,
  symbols: SymbolTable,
  policy: ResourcePolicy = RAILWAY_RESOURCE_POLICY,
): ParseResult {
  const { tokens, diagnostics } = tokenize(source);

  // ── group by line (comments handled separately for network markers) ────────
  const networks: NetworkMarker[] = [];
  const lineMap = new Map<number, Token[]>();
  for (const tok of tokens) {
    if (tok.kind === 'comment') {
      if (tok.col === 1) {
        const m = NETWORK_RE.exec(tok.text);
        if (m) {
          const marker: NetworkMarker = { line: tok.line, index: Number(m[2]) };
          const title = tok.text.slice(m[0].length).replace(/^[\s:–—-]+/, '').trim();
          if (title.length > 0) marker.title = title;
          networks.push(marker);
        }
      }
      continue;
    }
    const bucket = lineMap.get(tok.line);
    if (bucket) bucket.push(tok);
    else lineMap.set(tok.line, [tok]);
  }

  const instructions: Instruction[] = [];
  const labels = new Map<string, number>();
  /** Operand source position per instruction (for warning positions). */
  const operandPos: ({ line: number; col: number; length: number } | null)[] = [];
  let pendingLabel: PendingLabel | null = null;

  const lineNumbers = [...lineMap.keys()].sort((a, b) => a - b);
  for (const lineNo of lineNumbers) {
    const toks = lineMap.get(lineNo)!;
    let idx = 0;

    const first = toks[0]!;
    if (first.kind === 'labelDef') {
      if (pendingLabel) {
        // previous label never got an instruction to anchor to
        diagnostics.push(makeDiagnostic('E-SYN-001',
          { line: pendingLabel.line, col: pendingLabel.col, length: pendingLabel.length },
          { text: `${pendingLabel.name}:` }));
      }
      pendingLabel = { name: first.text, line: first.line, col: first.col, length: first.length };
      idx = 1;
      if (idx >= toks.length) continue;             // label alone → anchors the next instruction
    }

    const head = toks[idx]!;
    let op: Mnemonic | null = null;
    if (head.kind === 'assign') op = '=';
    else if (head.kind === 'compare' && COMPARE_MNEMONICS.has(head.text.toUpperCase())) {
      op = head.text.toUpperCase() as Mnemonic;
    } else if (head.kind === 'word' && MNEMONIC_WORDS.has(head.text.toUpperCase())) {
      op = head.text.toUpperCase() as Mnemonic;
    }
    if (op === null) {
      diagnostics.push(makeDiagnostic('E-SYN-001',
        { line: head.line, col: head.col, length: head.length }, { text: head.text }));
      continue;
    }

    const operandToks = toks.slice(idx + 1);
    const built = buildOperand(op, head, operandToks, symbols, diagnostics);
    if (!built.ok) continue;

    const instr: Instruction = { op, line: head.line, col: head.col };
    if (built.operand) instr.operand = built.operand;
    if (pendingLabel) {
      if (labels.has(pendingLabel.name)) {
        diagnostics.push(makeDiagnostic('E-JMP-002',
          { line: pendingLabel.line, col: pendingLabel.col, length: pendingLabel.length },
          { label: pendingLabel.name }));
      } else {
        labels.set(pendingLabel.name, instructions.length);
      }
      instr.label = pendingLabel.name;
      pendingLabel = null;
    }
    instructions.push(instr);
    operandPos.push(built.pos ?? null);
  }

  if (pendingLabel) {
    diagnostics.push(makeDiagnostic('E-SYN-001',
      { line: pendingLabel.line, col: pendingLabel.col, length: pendingLabel.length },
      { text: `${pendingLabel.name}:` }));
  }

  // ── jump label resolution ──────────────────────────────────────────────────
  for (const instr of instructions) {
    if (JUMP_MNEMONICS.has(instr.op) && instr.operand?.kind === 'label') {
      if (!labels.has(instr.operand.name)) {
        diagnostics.push(makeDiagnostic('E-JMP-001',
          { line: instr.line, col: instr.col }, { label: instr.operand.name }));
      }
    }
  }

  runStaticWarnings(instructions, operandPos, diagnostics, policy);

  const hasError = diagnostics.some((d) => d.severity === 'error');
  if (hasError) return { program: null, diagnostics };

  return {
    program: { instructions, networks, labels, source },
    diagnostics,
  };
}

// ───────────────────────────── operand building ─────────────────────────────

type BuildResult =
  | { ok: true; operand?: Operand; pos?: { line: number; col: number; length: number } }
  | { ok: false };

function tokenPos(t: Token): { line: number; col: number; length: number } {
  return { line: t.line, col: t.col, length: t.length };
}

function buildOperand(
  op: Mnemonic,
  head: Token,
  toks: Token[],
  symbols: SymbolTable,
  diagnostics: Diagnostic[],
): BuildResult {
  const allowed = OPERAND_KINDS[op];
  const fail = (): BuildResult => ({ ok: false });
  const synErr = (at: Token): BuildResult => {
    diagnostics.push(makeDiagnostic('E-SYN-002', tokenPos(at), { op }));
    return fail();
  };

  // operand-less instructions (compares)
  if (allowed.length === 0) {
    if (toks.length > 0) return synErr(toks[0]!);
    return { ok: true };
  }

  if (toks.length === 0) return synErr(head);

  // jumps: single bare word = label name
  if (JUMP_MNEMONICS.has(op)) {
    const t = toks[0]!;
    if (toks.length !== 1 || t.kind !== 'word') return synErr(t);
    if (!LABEL_NAME_RE.test(t.text)) {
      diagnostics.push(makeDiagnostic('E-JMP-001', tokenPos(t), { label: t.text }));
      return fail();
    }
    return { ok: true, operand: { kind: 'label', name: t.text }, pos: tokenPos(t) };
  }

  // NOP: "NOP 0" (or NOP 1)
  if (op === 'NOP') {
    const t = toks[0]!;
    if (toks.length !== 1 || t.kind !== 'number') return synErr(t);
    if (t.text !== '0' && t.text !== '1') {
      diagnostics.push(makeDiagnostic('E-SYN-003', tokenPos(t), { text: t.text }));
      return fail();
    }
    return { ok: true, operand: { kind: 'int', value: Number(t.text) }, pos: tokenPos(t) };
  }

  let operand: Operand | null = null;
  let pos: { line: number; col: number; length: number } | null = null;

  if (toks.length === 1) {
    const t = toks[0]!;
    pos = tokenPos(t);
    switch (t.kind) {
      case 'quoted': {
        const resolved = resolveSymbol(op, t, symbols, diagnostics);
        if (!resolved) return fail();
        operand = resolved;
        break;
      }
      case 's5time': {
        const ms = parseS5TimeLiteral(t.text);
        if (ms === null) {
          diagnostics.push(makeDiagnostic('E-SYN-003', pos, { text: t.text }));
          return fail();
        }
        operand = { kind: 's5time', ms, raw: t.text };
        break;
      }
      case 'counterLit': {
        const m = COUNTER_LIT_RE.exec(t.text);
        if (!m) {
          diagnostics.push(makeDiagnostic('E-SYN-003', pos, { text: t.text }));
          return fail();
        }
        operand = { kind: 'zaehler', value: Number(m[1]), raw: t.text };
        break;
      }
      case 'number': {
        if (!INT_RE.test(t.text)) {
          diagnostics.push(makeDiagnostic('E-SYN-003', pos, { text: t.text }));
          return fail();
        }
        const value = Number(t.text);
        if (value < -32768 || value > 32767) {
          diagnostics.push(makeDiagnostic('E-SYN-003', pos, { text: t.text }));
          return fail();
        }
        operand = { kind: 'int', value };
        break;
      }
      case 'word': {
        const addr = addressOperand(t.text, pos, diagnostics);
        if (!addr) return fail();
        operand = addr;
        break;
      }
      default:
        return synErr(t);
    }
  } else if (toks.length === 2 && toks[0]!.kind === 'word' && toks[1]!.kind === 'number') {
    // split address form: "M" "100.4" | "T" "10" | "AW" "6"
    const a = toks[0]!;
    const b = toks[1]!;
    pos = { line: a.line, col: a.col, length: b.col + b.length - a.col };
    const addr = addressOperand(`${a.text} ${b.text}`, pos, diagnostics);
    if (!addr) return fail();
    operand = addr;
  } else {
    return synErr(toks[toks.length - 1]!);
  }

  if (!allowed.includes(operand.kind)) {
    diagnostics.push(makeDiagnostic('E-TYP-001', pos, { op }));
    return fail();
  }
  return { ok: true, operand, pos };
}

function addressOperand(
  text: string,
  pos: { line: number; col: number; length: number },
  diagnostics: Diagnostic[],
): Operand | null {
  const r = parseAddressDetailed(text);
  if (!r.ok) {
    diagnostics.push(makeDiagnostic(r.reason === 'range' ? 'E-ADR-002' : 'E-ADR-001', pos, { text }));
    return null;
  }
  return addressToOperand(r.address);
}

function addressToOperand(a: Address): Operand {
  switch (a.kind) {
    case 'bit':     return { kind: 'bit', address: a };
    case 'word':    return { kind: 'word', address: a };
    case 'timer':   return { kind: 'timer', n: a.n };
    case 'counter': return { kind: 'counter', n: a.n };
  }
}

function resolveSymbol(
  op: Mnemonic,
  t: Token,
  symbols: SymbolTable,
  diagnostics: Diagnostic[],
): Operand | null {
  const pos = tokenPos(t);
  const entry = symbols.lookup(t.text);
  if (!entry) {
    const suggestions = symbols.suggest(t.text);
    if (suggestions.length > 0) {
      const best = suggestions[0]!.symbol;
      diagnostics.push(makeDiagnostic('E-SYM-002', pos, { symbol: t.text }, {
        de: `Meinten Sie "${best}"?`,
        en: `Did you mean "${best}"?`,
      }));
    } else {
      diagnostics.push(makeDiagnostic('E-SYM-001', pos, { symbol: t.text }));
    }
    return null;
  }
  if (entry.target.kind === 'block') {
    diagnostics.push(makeDiagnostic('E-TYP-001', pos, { op }));
    return null;
  }
  const operand = addressToOperand(entry.target);
  if (operand.kind === 'bit' || operand.kind === 'word') operand.symbol = t.text;
  return operand;
}

// ───────────────────────────── static warnings ──────────────────────────────

/** ERAB-false setters — end of a logic string (statically approximated). */
const STRING_END_OPS = new Set<Mnemonic>([
  '=', 'S', 'R', 'SI', 'SV', 'SE', 'SS', 'SA', 'FR', 'ZV', 'ZR', 'SPB', 'SPBN',
]);
/** Ops that establish a VKE. */
const VKE_SETTING_OPS = new Set<Mnemonic>([
  'U', 'UN', 'O', 'ON', 'X', 'XN', 'FP', 'FN',
  '==I', '<>I', '>I', '>=I', '<I', '<=I', 'SPB', 'SPBN',
]);

function runStaticWarnings(
  instructions: Instruction[],
  operandPos: ({ line: number; col: number; length: number } | null)[],
  diagnostics: Diagnostic[],
  policy: ResourcePolicy,
): void {
  let vkeEverSet = false;
  let s5LoadedInString = false;

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i]!;
    const pos = operandPos[i] ?? { line: instr.line, col: instr.col };

    if (instr.op === 'L') {
      s5LoadedInString = instr.operand?.kind === 's5time';
    }

    if (instr.op === '=' && !vkeEverSet) {
      diagnostics.push(makeDiagnostic('W-LOG-001', { line: instr.line, col: instr.col }));
    }

    if (TIMER_START_MNEMONICS.has(instr.op) && !s5LoadedInString) {
      diagnostics.push(makeDiagnostic('W-TIM-001', { line: instr.line, col: instr.col }));
    }

    checkResourceWhitelist(instr, pos, diagnostics, policy);

    if (VKE_SETTING_OPS.has(instr.op)) vkeEverSet = true;
    if (STRING_END_OPS.has(instr.op)) s5LoadedInString = false;
  }
}

/**
 * W-RES-001 whitelist over write targets (§5.1.5, revised): `=`/`S`/`R` on bits, FP/FN
 * edge operands, timer starts and `R T`, `ZV`/`ZR`/`S Z`/`R Z`, `T` transfers. Allowed:
 *   M 10.0–M 20.0 (student Merker), M 100.0–M 111.7 (switch coils),
 *   M 120.0–M 120.6 (speed + STOP), M 121.0 (NotausNF edge bit), T 10–T 20, Z 1.
 * Reads never warn.
 */
function checkResourceWhitelist(
  instr: Instruction,
  pos: { line: number; col: number; length?: number },
  diagnostics: Diagnostic[],
  policy: ResourcePolicy,
): void {
  const operand = instr.operand;
  if (!operand) return;

  const warn = (target: string): void => {
    diagnostics.push(makeDiagnostic('W-RES-001', pos, { target }));
  };

  switch (instr.op) {
    case '=': case 'S': case 'R': case 'FP': case 'FN':
      if (operand.kind === 'bit' && !policy.bit(operand.address)) {
        warn(formatAddress(operand.address));
      }
      if (operand.kind === 'timer' && !policy.timer(operand.n)) warn(`T ${operand.n}`);
      if (operand.kind === 'counter' && !policy.counter(operand.n)) warn(`Z ${operand.n}`);
      return;
    case 'SI': case 'SV': case 'SE': case 'SS': case 'SA':
      if (operand.kind === 'timer' && !policy.timer(operand.n)) warn(`T ${operand.n}`);
      return;
    case 'ZV': case 'ZR':
      if (operand.kind === 'counter' && !policy.counter(operand.n)) warn(`Z ${operand.n}`);
      return;
    case 'T':
      if (operand.kind === 'word' && !policy.word(operand.address.area, operand.address.byte)) {
        warn(formatAddress(operand.address));
      }
      return;
    default:
      return;                                       // reads / FR / jumps: no write check
  }
}

/**
 * Which write targets a plant's course rules allow (W-RES-001 is a warning against THIS).
 * The rules are course content, not emulator semantics: the railway practicum confines
 * students to its student area, while the pump manual itself writes `A 0.1` and `M 0.0` —
 * so each experiment hands its policy to the `Emulator`; the railway one is the default.
 */
export interface ResourcePolicy {
  bit(a: { area: string; byte: number; bit: number }): boolean;
  timer(n: number): boolean;
  counter(n: number): boolean;
  word(area: string, byte: number): boolean;
}

/** The railway practicum's rules (Hinweise V.3 + the plant symbols of §7.2). */
export const RAILWAY_RESOURCE_POLICY: ResourcePolicy = {
  bit(a: { area: string; byte: number; bit: number }): boolean {
    if (a.area !== 'M') return false;
    if (a.byte >= 10 && a.byte <= 19) return true;        // M 10.0 – M 19.7
    if (a.byte === 20 && a.bit === 0) return true;        // … up to M 20.0
    if (a.byte >= 100 && a.byte <= 111) return true;      // switch coils
    if (a.byte === 120 && a.bit <= 6) return true;        // speeds + STOP
    if (a.byte === 121 && a.bit === 0) return true;       // NotausNF edge operand
    return false;
  },
  timer(n: number): boolean { return n >= 10 && n <= 20; },
  counter(n: number): boolean { return n === 1; },
  /** Word writes: both bytes must stay inside the student Merker area (M 10 … M 19). */
  word(area: string, byte: number): boolean {
    return area === 'MW' && byte >= 10 && byte <= 18;
  },
};
