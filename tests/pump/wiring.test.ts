/**
 * Wiring: every E/A bit of the Anleitung's signal map (IV.2.5.2, Abbildung 4) is mapped
 * exactly once, on exactly the manual's address, and a drifting symbol list fails loudly.
 */
import { describe, expect, it } from 'vitest';
import { SymbolTable, formatAddress } from '../../src/core';
import type { VariablesFile } from '../../src/core';
import {
  PUMP_ACTUATOR_IDS, PUMP_BUTTON_IDS, PUMP_SENSOR_IDS, PUMP_TOGGLE_IDS, PUMP_VARIABLES,
  buildPumpSymbols, buildPumpWiring, forciblePumpProgramInputs, isForciblePumpInput,
  pumpInputAddresses, pumpOutputAddresses,
} from '../../src/pump';
import { Emulator } from '../../src/core';

/** The map as the Anleitung prints it — the reference this suite checks against. */
const ANLEITUNG_MAP = {
  'E 0.0': 'S1 start button (momentary)',
  'E 0.1': 'LLS tank A (1 = A empty)',
  'E 0.2': 'HLS tank A (1 = A full)',
  'E 0.3': 'LLS tank B (1 = B empty)',
  'E 0.4': 'HLS tank B (1 = B full)',
  'E 0.5': 'LS dry-run guard (1 = wetted)',
  'E 0.6': 'S0 stop button (momentary)',
  'A 0.1': 'pump',
} as const;

const wiring = buildPumpWiring(buildPumpSymbols());

describe('Anleitung signal map', () => {
  it('places every sensor and button on the manual\'s address', () => {
    expect(formatAddress(wiring.buttonInput.get('S1')!)).toBe('E 0.0');
    expect(formatAddress(wiring.sensorInput.get('llsA')!)).toBe('E 0.1');
    expect(formatAddress(wiring.sensorInput.get('hlsA')!)).toBe('E 0.2');
    expect(formatAddress(wiring.sensorInput.get('llsB')!)).toBe('E 0.3');
    expect(formatAddress(wiring.sensorInput.get('hlsB')!)).toBe('E 0.4');
    expect(formatAddress(wiring.sensorInput.get('ls')!)).toBe('E 0.5');
    expect(formatAddress(wiring.buttonInput.get('S0')!)).toBe('E 0.6');
    expect(formatAddress(wiring.actuatorOutput.get('pump')!)).toBe('A 0.1');
  });

  it('covers the whole printed map', () => {
    const wired = new Set([
      ...pumpInputAddresses(wiring).map(formatAddress),
      ...pumpOutputAddresses(wiring).map(formatAddress),
    ]);
    for (const address of Object.keys(ANLEITUNG_MAP)) expect(wired.has(address)).toBe(true);
  });

  it('adds the pedestal toggles on E 0.7, E 1.0 – E 1.4 and E 1.7, and the lamps on A 0.2 / A 0.3', () => {
    expect([...wiring.toggleInput.entries()].map(([id, a]) => [id, formatAddress(a)])).toEqual([
      ['E0.7', 'E 0.7'],
      ['E1.0', 'E 1.0'], ['E1.1', 'E 1.1'], ['E1.2', 'E 1.2'],
      ['E1.3', 'E 1.3'], ['E1.4', 'E 1.4'], ['E1.7', 'E 1.7'],
    ]);
    expect(formatAddress(wiring.actuatorOutput.get('A0.2')!)).toBe('A 0.2');
    expect(formatAddress(wiring.actuatorOutput.get('A0.3')!)).toBe('A 0.3');
  });
});

describe('Coverage and uniqueness', () => {
  it('maps every id exactly once', () => {
    expect([...wiring.sensorInput.keys()]).toEqual([...PUMP_SENSOR_IDS]);
    expect([...wiring.buttonInput.keys()]).toEqual([...PUMP_BUTTON_IDS]);
    expect([...wiring.toggleInput.keys()]).toEqual([...PUMP_TOGGLE_IDS]);
    expect([...wiring.actuatorOutput.keys()]).toEqual([...PUMP_ACTUATOR_IDS]);
  });

  /** E 0.7 is the address the manual's FP/FN and jump snippets query; it must be wired to
   *  exactly one plant control, and to a toggle rather than to a sensor or a button. */
  it('wires E 0.7 exactly once, as a pedestal toggle', () => {
    const holders = [
      ...[...wiring.sensorInput.entries()].map(([id, a]) => ['sensor', id, formatAddress(a)]),
      ...[...wiring.buttonInput.entries()].map(([id, a]) => ['button', id, formatAddress(a)]),
      ...[...wiring.toggleInput.entries()].map(([id, a]) => ['toggle', id, formatAddress(a)]),
    ].filter(([, , address]) => address === 'E 0.7');
    expect(holders).toEqual([['toggle', 'E0.7', 'E 0.7']]);
  });

  it('gives every id its OWN bit — no address is used twice', () => {
    const all = [
      ...wiring.sensorInput.values(),
      ...wiring.buttonInput.values(),
      ...wiring.toggleInput.values(),
      ...wiring.actuatorOutput.values(),
    ].map(formatAddress);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(17);          // 7 process inputs + 7 toggles + 3 outputs
  });

  it('uses every symbol of the pump variables list, and no other', () => {
    const symbols = buildPumpSymbols();
    const wiredAddresses = new Set([
      ...pumpInputAddresses(wiring).map(formatAddress),
      ...pumpOutputAddresses(wiring).map(formatAddress),
    ]);
    expect(PUMP_VARIABLES.entries).toHaveLength(17);
    for (const entry of PUMP_VARIABLES.entries) {
      expect(wiredAddresses.has(entry.address)).toBe(true);
    }
    // Every symbol resolves case-sensitively, i.e. the list itself is loadable.
    for (const entry of PUMP_VARIABLES.entries) {
      expect(symbols.lookup(entry.symbol)).toBeDefined();
    }
  });

  it('keeps inputs on E and outputs on A', () => {
    for (const a of pumpInputAddresses(wiring)) expect(a.area).toBe('E');
    for (const a of pumpOutputAddresses(wiring)) expect(a.area).toBe('A');
  });
});

describe('Validation', () => {
  it('rejects a symbol list that moves a signal off the Anleitung address', () => {
    const drifted: VariablesFile = {
      ...PUMP_VARIABLES,
      entries: PUMP_VARIABLES.entries.map(
        (e) => (e.address === 'E 0.0' ? { ...e, address: 'E 0.7' } : e),
      ),
    };
    expect(() => buildPumpWiring(SymbolTable.fromVariables(drifted)))
      .toThrow(/Anleitung puts it on E 0\.0/);
  });

  it('rejects a symbol list that loses a signal', () => {
    const missing: VariablesFile = {
      ...PUMP_VARIABLES,
      entries: PUMP_VARIABLES.entries.filter((e) => e.address !== 'A 0.1'),
    };
    expect(() => buildPumpWiring(SymbolTable.fromVariables(missing)))
      .toThrow(/is not in the pump variables list/);
  });
});

describe('Try it (input forcing)', () => {
  it('allows every E bit and no A/M bit', () => {
    for (const a of pumpInputAddresses(wiring)) expect(isForciblePumpInput(a)).toBe(true);
    for (const a of pumpOutputAddresses(wiring)) expect(isForciblePumpInput(a)).toBe(false);
    expect(isForciblePumpInput({ kind: 'bit', area: 'M', byte: 0, bit: 0 })).toBe(false);
  });

  it('lists the E bits a program touches, deduplicated and in address order', () => {
    const emulator = new Emulator(buildPumpSymbols());
    const loaded = emulator.load([
      'U  E 1.2',
      'U  E 0.5',
      'UN E 1.2',
      '=  A 0.2',
      'U  M 10.0',
      '',
    ].join('\n'));
    expect(loaded.ok).toBe(true);
    expect(forciblePumpProgramInputs(loaded.program!).map(formatAddress))
      .toEqual(['E 0.5', 'E 1.2']);
  });
});
