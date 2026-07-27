/**
 * Wiring (ARCHITECTURE.md §5.2): binds the symbolic world to plant ids. Built once at
 * startup from SymbolTable + trackplan, validated.
 *
 * Symbol resolution is deliberately two-stage: the exact spelling first, then a
 * case-insensitive fallback. The Variablenliste contains two upper-case-X coil symbols
 * (`XW03CR`, `XW05BH1G3R`) whose switch ids are spelled lower-case in the trackplan; the
 * fallback resolves those without weakening `SymbolTable.lookup`, which stays
 * case-SENSITIVE for student code (§5.1.2, the practicum trap).
 */
import { bitAddressEquals } from '../core';
import type {
  Address, BitAddress, BlockRef, Program, SymbolEntry, SymbolTable, WordAddress,
} from '../core';
import type { TrackplanFile } from '../plant';

export interface Wiring {
  /** reedId ("xR01A") → E-address of its input, for the 23 wired reeds. */
  reedInput: ReadonlyMap<string, BitAddress>;
  /** switchId ("xW02D") → { G: M-address, R: M-address } of its coil bits. */
  switchCoils: ReadonlyMap<string, { G: BitAddress; R: BitAddress }>;
  /** switchId → coil bits of the switches the Variablenliste commands but this board model
   *  does not have (trackplan `unplacedSwitches`, §7.1). They drive NOTHING; the coordinator
   *  watches them so a pulse produces a warning instead of a silent no-op (§5.2). */
  unplacedCoils: ReadonlyMap<string, { G: BitAddress; R: BitAddress }>;
  notausInput: BitAddress;                    // E 1.7
  fahrstromWord: WordAddress;                 // AW 6
  speedBits: { stop: BitAddress; s1iu: BitAddress; s2iu: BitAddress; s3iu: BitAddress;
               s1gu: BitAddress; s2gu: BitAddress; s3gu: BitAddress };  // M 120.x
}

/** System symbol names the wiring depends on (Variablenliste, §7.2). */
const SYM_NOTAUS = 'NotausBit';
const SYM_FAHRSTROM = 'Fahrstrom';
const SPEED_SYMBOLS = {
  stop: 'STOP',
  s1iu: 'Speed1IU',
  s2iu: 'Speed2IU',
  s3iu: 'Speed3IU',
  s1gu: 'Speed1GU',
  s2gu: 'Speed2GU',
  s3gu: 'Speed3GU',
} as const;

type SpeedKey = keyof typeof SPEED_SYMBOLS;

/** Internal helper shape: a resolved symbol entry plus its narrowed bit address. */
interface ResolvedBit {
  entry: SymbolEntry;
  address: BitAddress;
}

function isBitAddress(target: Address | BlockRef): target is BitAddress {
  return target.kind === 'bit';
}

function isWordAddress(target: Address | BlockRef): target is WordAddress {
  return target.kind === 'word';
}

/** Lower-cased index over all symbols, for the case-insensitive fallback. */
function caseIndex(symbols: SymbolTable): Map<string, SymbolEntry> {
  const index = new Map<string, SymbolEntry>();
  for (const entry of symbols.all()) {
    const key = entry.symbol.toLowerCase();
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/** Throws on mismatch; switches with coilToBranch: null (§5.3) are skipped, not errors. */
export function buildWiring(symbols: SymbolTable, plan: TrackplanFile): Wiring {
  const index = caseIndex(symbols);
  const problems: string[] = [];

  const resolve = (name: string): SymbolEntry | undefined =>
    symbols.lookup(name) ?? index.get(name.toLowerCase());

  const bitOf = (name: string, what: string): ResolvedBit | undefined => {
    const entry = resolve(name);
    if (entry === undefined) {
      problems.push(`${what}: symbol "${name}" is not in variables.json`);
      return undefined;
    }
    if (!isBitAddress(entry.target)) {
      problems.push(`${what}: symbol "${entry.symbol}" is not a bit address`);
      return undefined;
    }
    return { entry, address: entry.target };
  };

  // ── reeds: only the wired ones have an E input (§5.3) ──────────────────────
  const reedInput = new Map<string, BitAddress>();
  for (const reed of plan.reeds) {
    if (!reed.wired) continue;
    const found = bitOf(reed.id, `reed ${reed.id}`);
    if (found === undefined) continue;
    if (found.address.area !== 'E') {
      problems.push(`reed ${reed.id}: "${found.entry.symbol}" is ${found.address.area}, expected an E input`);
      continue;
    }
    reedInput.set(reed.id, found.address);
  }

  // ── switch coils: G/R bits in the M 100–111 area ───────────────────────────
  const switchCoils = new Map<string, { G: BitAddress; R: BitAddress }>();
  for (const sw of plan.switches) {
    if (sw.coilToBranch === null) continue;   // non-commandable "(xW)" — skipped, not an error
    const g = bitOf(`${sw.id}G`, `switch ${sw.id} coil G`);
    const r = bitOf(`${sw.id}R`, `switch ${sw.id} coil R`);
    if (g === undefined || r === undefined) continue;
    if (g.address.area !== 'M' || r.address.area !== 'M') {
      problems.push(`switch ${sw.id}: coil bits must be Merker (M), got ${g.address.area}/${r.address.area}`);
      continue;
    }
    switchCoils.set(sw.id, { G: g.address, R: r.address });
  }

  // ── unplaced switches: coil bits without a plant switch (§7.1) ─────────────
  // Tolerant on purpose: this is optional metadata for a UI warning, not part of the
  // simulated interface — a switch whose coil symbols are missing is simply not watched.
  const unplacedCoils = new Map<string, { G: BitAddress; R: BitAddress }>();
  for (const unplaced of plan.unplacedSwitches ?? []) {
    const g = resolve(`${unplaced.id}G`);
    const r = resolve(`${unplaced.id}R`);
    if (g === undefined || r === undefined) continue;
    if (!isBitAddress(g.target) || !isBitAddress(r.target)) continue;
    unplacedCoils.set(unplaced.id, { G: g.target, R: r.target });
  }

  // ── system interface ───────────────────────────────────────────────────────
  const notaus = bitOf(SYM_NOTAUS, 'Notaus input');
  if (notaus !== undefined && notaus.address.area !== 'E') {
    problems.push(`Notaus input: "${notaus.entry.symbol}" is ${notaus.address.area}, expected an E input`);
  }

  const fahrstromEntry = resolve(SYM_FAHRSTROM);
  let fahrstromWord: WordAddress | undefined;
  if (fahrstromEntry === undefined) {
    problems.push(`Fahrstrom word: symbol "${SYM_FAHRSTROM}" is not in variables.json`);
  } else if (!isWordAddress(fahrstromEntry.target)) {
    problems.push(`Fahrstrom word: symbol "${fahrstromEntry.symbol}" is not a word address`);
  } else {
    fahrstromWord = fahrstromEntry.target;
  }

  const speed: Partial<Record<SpeedKey, BitAddress>> = {};
  for (const key of Object.keys(SPEED_SYMBOLS) as SpeedKey[]) {
    const name = SPEED_SYMBOLS[key];
    const found = bitOf(name, `speed bit ${name}`);
    if (found === undefined) continue;
    if (found.address.area !== 'M') {
      problems.push(`speed bit ${name}: "${found.entry.symbol}" is ${found.address.area}, expected a Merker (M)`);
      continue;
    }
    speed[key] = found.address;
  }

  const speedBits = speed as Wiring['speedBits'];
  const missingSpeed = (Object.keys(SPEED_SYMBOLS) as SpeedKey[]).filter((k) => speed[k] === undefined);
  if (missingSpeed.length > 0) {
    problems.push(`speed bits unresolved: ${missingSpeed.map((k) => SPEED_SYMBOLS[k]).join(', ')}`);
  }

  if (problems.length > 0 || notaus === undefined || fahrstromWord === undefined) {
    throw new Error(`buildWiring: trackplan/variables mismatch\n - ${problems.join('\n - ')}`);
  }

  return {
    reedInput,
    switchCoils,
    unplacedCoils,
    notausInput: notaus.address,
    fahrstromWord,
    speedBits,
  };
}

/**
 * May the "Try it" mini-mode (§10.3) force this bit into the process image?
 *
 * Yes for every E bit except the Notaus input: that one has its own latching button in the
 * ControlPanel, and a force on it would make the button look broken. Wired reed inputs ARE
 * forcible — the coordinator re-asserts forced bits AFTER the per-scan PAE write
 * (`SimCoordinator.forceInputBit`), so a force never fights the reeds. That matters because
 * the Anleitung example snippets address E 0.x / E 1.x, and on this board every bit of
 * E 0 – E 2 is a wired reed or the Notaus input.
 */
export function isForcibleInput(wiring: Wiring, address: BitAddress): boolean {
  return address.area === 'E' && !bitAddressEquals(address, wiring.notausInput);
}

/**
 * The input bits a loaded program reads or writes that the "Try it" mini-mode may drive —
 * deduplicated, in address order. Empty for a program that only uses the plant interface,
 * which is exactly when the toggles must stay hidden (§10.3).
 */
export function forcibleProgramInputs(wiring: Wiring, program: Program): BitAddress[] {
  const seen = new Map<number, BitAddress>();
  for (const instruction of program.instructions) {
    const operand = instruction.operand;
    if (operand === undefined || operand.kind !== 'bit') continue;
    if (!isForcibleInput(wiring, operand.address)) continue;
    const key = operand.address.byte * 8 + operand.address.bit;
    if (!seen.has(key)) seen.set(key, operand.address);
  }
  return [...seen.keys()].sort((a, b) => a - b).map((key) => seen.get(key) as BitAddress);
}
