/**
 * AST + instruction set (ARCHITECTURE.md §5.1.4).
 */
import type { BitAddress, WordAddress } from './address';

/** Milestone-1 mnemonics — superset of everything used by the Gruppe A/B solutions. */
export type Mnemonic =
  | 'U' | 'UN' | 'O' | 'ON' | 'X' | 'XN'          // bit logic
  | '=' | 'S' | 'R'                                // assignment; S/R also on T (R), Z (S/R)
  | 'L' | 'T'                                      // load/transfer (VKE-neutral)
  | 'SI' | 'SV' | 'SE' | 'SS' | 'SA' | 'FR'        // S5 timers (FR also on Z)
  | 'FP' | 'FN'                                    // edge evaluation
  | 'ZV' | 'ZR'                                    // counters
  | '==I' | '<>I' | '>I' | '>=I' | '<I' | '<=I'    // integer compares
  | 'SPA' | 'SPB' | 'SPBN'                         // jumps
  | 'NOP';

/** Every M1 mnemonic, in instruction-table order (§5.1.8). */
export const MNEMONICS: readonly Mnemonic[] = [
  'U', 'UN', 'O', 'ON', 'X', 'XN',
  '=', 'S', 'R',
  'L', 'T',
  'SI', 'SV', 'SE', 'SS', 'SA', 'FR',
  'FP', 'FN',
  'ZV', 'ZR',
  '==I', '<>I', '>I', '>=I', '<I', '<=I',
  'SPA', 'SPB', 'SPBN',
  'NOP',
];

/** The subset spelled as a bare word — the rest are punctuation-led tokens (`=`, `==I`, …).
 *  Single source of truth for the parser's word lookup and for the template safety net. */
export const WORD_MNEMONICS: readonly Mnemonic[] =
  MNEMONICS.filter((m) => /^[A-Z]/.test(m));

export type Operand =
  | { kind: 'bit';     address: BitAddress;  symbol?: string }   // symbol = as written in source
  | { kind: 'word';    address: WordAddress; symbol?: string }
  | { kind: 'timer';   n: number }
  | { kind: 'counter'; n: number }
  | { kind: 'int';     value: number }                            // L 3   (signed 16-bit)
  | { kind: 's5time';  ms: number; raw: string }                  // L S5T#300MS
  | { kind: 'zaehler'; value: number; raw: string }               // L C#010 (BCD counter preset)
  | { kind: 'label';   name: string };                            // SPA M001

export interface Instruction {
  op: Mnemonic;
  operand?: Operand;
  label?: string;            // "M001:" prefix on this line (1–4 alphanumeric, starts with letter)
  line: number;              // 1-based source line
  col: number;
}

export interface NetworkMarker { line: number; index: number; title?: string; }

export interface Program {
  instructions: Instruction[];
  /** Informational only (cycle inspector grouping): derived from comment lines matching
   *  /^\/\/\s*(Netzwerk|Network)\s+(\d+)/i. Execution semantics ignore networks entirely —
   *  the program is one linear list, exactly like the real practicum txt upload. */
  networks: NetworkMarker[];
  labels: ReadonlyMap<string, number>;   // label name → instruction index
  source: string;
}
