/**
 * Pump wiring: plant id ↔ PLC address, the pump twin of `app/Wiring.ts`.
 *
 * The address map is NOT this simulator's choice — it is the Anleitung's (IV.2.5.2,
 * Abbildung 4), and it is non-negotiable because every snippet in the manual addresses it
 * absolutely. `buildPumpWiring` therefore does not merely resolve the symbols, it VERIFIES
 * that each one still sits on the manual's address; a symbol list that drifts fails loudly
 * at startup instead of silently rewiring the teaching example.
 */
import { bitAddressEquals, formatAddress, parseAddress } from '../core';
import type { Address, BitAddress, BlockRef, Program, ResourcePolicy, SymbolTable } from '../core';
import { PUMP_ACTUATOR_IDS, PUMP_BUTTON_IDS, PUMP_SENSOR_IDS, PUMP_TOGGLE_IDS } from './types';
import type { PumpActuatorId, PumpButtonId, PumpSensorId, PumpToggleId } from './types';
import { PUMP_SYMBOL_NAMES } from './variables';

interface PumpBitSpec {
  /** Symbol name in the pump variables list. */
  symbol: string;
  /** Canonical address text, exactly as `formatAddress` renders it. */
  address: string;
}

/** Sensor inputs (Anleitung: "Leermeldungen sind 1, wenn der Tank leer ist"). */
const SENSOR_BITS: Readonly<Record<PumpSensorId, PumpBitSpec>> = {
  llsA: { symbol: PUMP_SYMBOL_NAMES.llsA, address: 'E 0.1' },
  hlsA: { symbol: PUMP_SYMBOL_NAMES.hlsA, address: 'E 0.2' },
  llsB: { symbol: PUMP_SYMBOL_NAMES.llsB, address: 'E 0.3' },
  hlsB: { symbol: PUMP_SYMBOL_NAMES.hlsB, address: 'E 0.4' },
  ls:   { symbol: PUMP_SYMBOL_NAMES.ls,   address: 'E 0.5' },
};

const BUTTON_BITS: Readonly<Record<PumpButtonId, PumpBitSpec>> = {
  S1: { symbol: PUMP_SYMBOL_NAMES.s1, address: 'E 0.0' },
  S0: { symbol: PUMP_SYMBOL_NAMES.s0, address: 'E 0.6' },
};

const TOGGLE_BITS: Readonly<Record<PumpToggleId, PumpBitSpec>> = {
  'E0.7': { symbol: PUMP_SYMBOL_NAMES.toggle07, address: 'E 0.7' },
  'E1.0': { symbol: PUMP_SYMBOL_NAMES.toggle10, address: 'E 1.0' },
  'E1.1': { symbol: PUMP_SYMBOL_NAMES.toggle11, address: 'E 1.1' },
  'E1.2': { symbol: PUMP_SYMBOL_NAMES.toggle12, address: 'E 1.2' },
  'E1.3': { symbol: PUMP_SYMBOL_NAMES.toggle13, address: 'E 1.3' },
  'E1.4': { symbol: PUMP_SYMBOL_NAMES.toggle14, address: 'E 1.4' },
  'E1.7': { symbol: PUMP_SYMBOL_NAMES.toggle17, address: 'E 1.7' },
};

const ACTUATOR_BITS: Readonly<Record<PumpActuatorId, PumpBitSpec>> = {
  pump:   { symbol: PUMP_SYMBOL_NAMES.pump,  address: 'A 0.1' },
  'A0.2': { symbol: PUMP_SYMBOL_NAMES.lamp2, address: 'A 0.2' },
  'A0.3': { symbol: PUMP_SYMBOL_NAMES.lamp3, address: 'A 0.3' },
};

export interface PumpWiring {
  /** Sensor id → E address the plant writes into the process image every scan. */
  sensorInput: ReadonlyMap<PumpSensorId, BitAddress>;
  /** Momentary button id → E address. */
  buttonInput: ReadonlyMap<PumpButtonId, BitAddress>;
  /** Pedestal toggle id → E address. */
  toggleInput: ReadonlyMap<PumpToggleId, BitAddress>;
  /** Actuator id → A address the coordinator reads out of the PAA after each scan. */
  actuatorOutput: ReadonlyMap<PumpActuatorId, BitAddress>;
}

function isBitAddress(target: Address | BlockRef): target is BitAddress {
  return target.kind === 'bit';
}

/** Throws with every problem at once, like `buildWiring` (§5.2). */
export function buildPumpWiring(symbols: SymbolTable): PumpWiring {
  const problems: string[] = [];

  const resolve = (spec: PumpBitSpec, what: string, area: 'E' | 'A'): BitAddress | undefined => {
    const entry = symbols.lookup(spec.symbol);
    if (entry === undefined) {
      problems.push(`${what}: symbol "${spec.symbol}" is not in the pump variables list`);
      return undefined;
    }
    if (!isBitAddress(entry.target)) {
      problems.push(`${what}: symbol "${spec.symbol}" is not a bit address`);
      return undefined;
    }
    if (entry.target.area !== area) {
      problems.push(`${what}: "${spec.symbol}" is ${entry.target.area}, expected ${area}`);
      return undefined;
    }
    const expected = parseAddress(spec.address);
    if (expected === null || !isBitAddress(expected)) {
      problems.push(`${what}: bad expected address "${spec.address}" in the wiring table`);
      return undefined;
    }
    if (!bitAddressEquals(entry.target, expected)) {
      problems.push(
        `${what}: "${spec.symbol}" is ${formatAddress(entry.target)}, but the Anleitung `
        + `puts it on ${spec.address}`,
      );
      return undefined;
    }
    return entry.target;
  };

  const sensorInput = new Map<PumpSensorId, BitAddress>();
  for (const id of PUMP_SENSOR_IDS) {
    const found = resolve(SENSOR_BITS[id], `sensor ${id}`, 'E');
    if (found !== undefined) sensorInput.set(id, found);
  }

  const buttonInput = new Map<PumpButtonId, BitAddress>();
  for (const id of PUMP_BUTTON_IDS) {
    const found = resolve(BUTTON_BITS[id], `button ${id}`, 'E');
    if (found !== undefined) buttonInput.set(id, found);
  }

  const toggleInput = new Map<PumpToggleId, BitAddress>();
  for (const id of PUMP_TOGGLE_IDS) {
    const found = resolve(TOGGLE_BITS[id], `toggle ${id}`, 'E');
    if (found !== undefined) toggleInput.set(id, found);
  }

  const actuatorOutput = new Map<PumpActuatorId, BitAddress>();
  for (const id of PUMP_ACTUATOR_IDS) {
    const found = resolve(ACTUATOR_BITS[id], `actuator ${id}`, 'A');
    if (found !== undefined) actuatorOutput.set(id, found);
  }

  if (problems.length > 0) {
    throw new Error(`buildPumpWiring: pump variables mismatch\n - ${problems.join('\n - ')}`);
  }
  return { sensorInput, buttonInput, toggleInput, actuatorOutput };
}

/** Every wired E bit, deduplicated, in address order — used by tests and the watch table. */
export function pumpInputAddresses(wiring: PumpWiring): BitAddress[] {
  const all = [
    ...wiring.sensorInput.values(),
    ...wiring.buttonInput.values(),
    ...wiring.toggleInput.values(),
  ];
  return sortUnique(all);
}

/** Every wired A bit, in address order. */
export function pumpOutputAddresses(wiring: PumpWiring): BitAddress[] {
  return sortUnique([...wiring.actuatorOutput.values()]);
}

/**
 * May the "Try it" mini-mode (§10.3) force this bit? On the pump: every input. There is no
 * Notaus button here, so no input has a UI control that a force could make look broken.
 */
export function isForciblePumpInput(address: BitAddress): boolean {
  return address.area === 'E';
}

/**
 * The input bits a loaded program touches that "Try it" may drive — deduplicated, in
 * address order. Same contract as `forcibleProgramInputs` for the railway.
 */
export function forciblePumpProgramInputs(program: Program): BitAddress[] {
  const out: BitAddress[] = [];
  for (const instruction of program.instructions) {
    const operand = instruction.operand;
    if (operand === undefined || operand.kind !== 'bit') continue;
    if (!isForciblePumpInput(operand.address)) continue;
    out.push(operand.address);
  }
  return sortUnique(out);
}

function sortUnique(addresses: readonly BitAddress[]): BitAddress[] {
  const seen = new Map<number, BitAddress>();
  for (const address of addresses) {
    const key = address.byte * 8 + address.bit;
    if (!seen.has(key)) seen.set(key, address);
  }
  return [...seen.keys()].sort((a, b) => a - b).map((key) => seen.get(key) as BitAddress);
}

/**
 * The pump manual's own resource rules (W-RES-001 policy). Unlike the railway, the
 * Anleitung's pump snippets THEMSELVES write outside the railway student area: `= A 0.1`
 * is the pump (IV.2.5.3ff), `S M 0.0` the latch flag, `SI T 1` the first timer. What the
 * manual demonstrates cannot be warned about on the plant it was written for:
 *   A 0.x  - the output byte carrying pump + lamps (unwired bits drive nothing, no warn);
 *   M 0 - M 20 - flags, covering the manual's M 0.0 and the shared student area;
 *   T 1 - T 20, Z 1 - Z 10 - the manual's low timer/counter numbers plus the student band;
 *   MW 0 - MW 18 - word transfers inside the same flag band (IV.2.4 uses MD 5.0).
 * AW/EW writes and everything else still warn - the pump has no Fahrstrom word.
 */
export const PUMP_RESOURCE_POLICY: ResourcePolicy = {
  bit(a: { area: string; byte: number; bit: number }): boolean {
    if (a.area === 'A') return a.byte === 0;
    if (a.area !== 'M') return false;
    if (a.byte <= 19) return true;
    return a.byte === 20 && a.bit === 0;
  },
  timer(n: number): boolean { return n >= 1 && n <= 20; },
  counter(n: number): boolean { return n >= 1 && n <= 10; },
  word(area: string, byte: number): boolean {
    return area === 'MW' && byte <= 18;
  },
};
