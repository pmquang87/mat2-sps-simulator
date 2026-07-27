/**
 * buildWiring tests (ARCHITECTURE.md §5.2).
 *
 * The SymbolTable is stubbed with a case-sensitive lookup plus `all()`, which is exactly the
 * contract §5.1.2 promises — so these tests pin the wiring logic (including the upper-case-X
 * coil traps and the `coilToBranch: null` skip rule) independently of core's progress.
 */
import { describe, expect, it } from 'vitest';
import { buildWiring, forcibleProgramInputs, isForcibleInput } from '../../src/app/Wiring';
import type { BitAddress, Instruction, Program, SymbolEntry, SymbolTable } from '../../src/core';
import type { SwitchSpec, TrackplanFile } from '../../src/plant/types';

function bit(area: 'E' | 'A' | 'M', byte: number, index: number): SymbolEntry['target'] {
  return { kind: 'bit', area, byte, bit: index };
}

function entry(symbol: string, target: SymbolEntry['target']): SymbolEntry {
  return { symbol, target, dataType: 'BOOL' };
}

const SYSTEM_ENTRIES: SymbolEntry[] = [
  entry('NotausBit', bit('E', 1, 7)),
  entry('NotausNF', bit('M', 121, 0)),
  { symbol: 'Fahrstrom', target: { kind: 'word', area: 'AW', byte: 6 }, dataType: 'WORD' },
  entry('STOP', bit('M', 120, 3)),
  entry('Speed3IU', bit('M', 120, 0)),
  entry('Speed2IU', bit('M', 120, 1)),
  entry('Speed1IU', bit('M', 120, 2)),
  entry('Speed1GU', bit('M', 120, 4)),
  entry('Speed2GU', bit('M', 120, 5)),
  entry('Speed3GU', bit('M', 120, 6)),
];

function fakeSymbols(entries: readonly SymbolEntry[]): SymbolTable {
  const byName = new Map(entries.map((e) => [e.symbol, e]));
  return {
    lookup: (symbol: string) => byName.get(symbol),
    suggest: () => [],
    byAddress: () => undefined,
    all: () => entries,
  } as unknown as SymbolTable;
}

function switchSpec(id: string, coilToBranch: SwitchSpec['coilToBranch']): SwitchSpec {
  return {
    id,
    nodeId: `n-${id}`,
    toeEdgeId: `e-${id}-toe`,
    branchEdgeIds: [`e-${id}-0`, `e-${id}-1`],
    coilToBranch,
    mappingSource: 'assumed',
    initialPosition: 0,
  };
}

function plan(overrides: Partial<TrackplanFile> = {}): TrackplanFile {
  return {
    version: 1,
    meta: {
      units: 'gleisplanPt',
      mmPerUnit: 3.5,
      speedsMmS: { '1': 80, '2': 160, '3': 280 },
      trainAccelMmS2: 150,
      switchActuationMs: 300,
      reedWindowMm: 20,
      magnetOffsetMm: 0,
    },
    nodes: [],
    edges: [],
    switches: [],
    reeds: [],
    start: { edgeId: 'e-1', offsetMm: 0, direction: 1 },
    landscape: { tunnels: [], buildings: [], mountains: [] },
    ...overrides,
  };
}

describe('buildWiring', () => {
  it('maps only the wired reeds to their E inputs', () => {
    const symbols = fakeSymbols([
      ...SYSTEM_ENTRIES,
      entry('xR01A', bit('E', 1, 4)),
      entry('xR01B', bit('E', 1, 3)),
    ]);
    const wiring = buildWiring(symbols, plan({
      reeds: [
        { id: 'xR01A', edgeId: 'e-1', offsetMm: 100, wired: true },
        { id: 'xR01B', edgeId: 'e-1', offsetMm: 200, wired: false },
      ],
    }));
    expect([...wiring.reedInput.keys()]).toEqual(['xR01A']);
    expect(wiring.reedInput.get('xR01A')).toEqual({ kind: 'bit', area: 'E', byte: 1, bit: 4 });
  });

  it('resolves the upper-case-X coil symbols of the Variablenliste', () => {
    // "xW03C" carries "xW03CG" but "XW03CR" — the documented case trap (§5.1.2).
    const symbols = fakeSymbols([
      ...SYSTEM_ENTRIES,
      entry('xW03CG', bit('M', 103, 7)),
      entry('XW03CR', bit('M', 109, 7)),
    ]);
    const wiring = buildWiring(symbols, plan({
      switches: [switchSpec('xW03C', { G: 0, R: 1 })],
    }));
    expect(wiring.switchCoils.get('xW03C')).toEqual({
      G: { kind: 'bit', area: 'M', byte: 103, bit: 7 },
      R: { kind: 'bit', area: 'M', byte: 109, bit: 7 },
    });
  });

  it('skips non-commandable switches (coilToBranch: null) instead of failing', () => {
    const symbols = fakeSymbols(SYSTEM_ENTRIES);
    const wiring = buildWiring(symbols, plan({
      switches: [switchSpec('xW', null)],
    }));
    expect(wiring.switchCoils.size).toBe(0);
  });

  it('resolves the system interface (Notaus, Fahrstrom word, M 120 speed bits)', () => {
    const wiring = buildWiring(fakeSymbols(SYSTEM_ENTRIES), plan());
    expect(wiring.notausInput).toEqual({ kind: 'bit', area: 'E', byte: 1, bit: 7 });
    expect(wiring.fahrstromWord).toEqual({ kind: 'word', area: 'AW', byte: 6 });
    expect(wiring.speedBits.stop.bit).toBe(3);
    expect(wiring.speedBits.s3iu.bit).toBe(0);
    expect(wiring.speedBits.s3gu.bit).toBe(6);
    for (const address of Object.values(wiring.speedBits)) {
      expect(address.area).toBe('M');
      expect(address.byte).toBe(120);
    }
  });

  it('throws and names every unresolved symbol', () => {
    const symbols = fakeSymbols(SYSTEM_ENTRIES);
    expect(() => buildWiring(symbols, plan({
      reeds: [{ id: 'xR99Z', edgeId: 'e-1', offsetMm: 0, wired: true }],
      switches: [switchSpec('xW42X', { G: 0, R: 1 })],
    }))).toThrowError(/xR99Z[\s\S]*xW42X/);
  });

  it('rejects a reed symbol that is not an input', () => {
    const symbols = fakeSymbols([...SYSTEM_ENTRIES, entry('xR01A', bit('M', 10, 0))]);
    expect(() => buildWiring(symbols, plan({
      reeds: [{ id: 'xR01A', edgeId: 'e-1', offsetMm: 0, wired: true }],
    }))).toThrowError(/expected an E input/);
  });

  it('rejects a missing speed bit', () => {
    const symbols = fakeSymbols(SYSTEM_ENTRIES.filter((e) => e.symbol !== 'Speed2GU'));
    expect(() => buildWiring(symbols, plan())).toThrowError(/Speed2GU/);
  });

  it('maps the coil bits of unplaced switches and skips the ones without symbols (§7.1)', () => {
    const symbols = fakeSymbols([
      ...SYSTEM_ENTRIES,
      entry('xW01CG', bit('M', 102, 0)),
      entry('xW01CR', bit('M', 108, 0)),
      entry('xW09ZG', bit('M', 103, 1)),          // only G — cannot be watched as a pair
    ]);
    const wiring = buildWiring(symbols, plan({
      unplacedSwitches: [
        { id: 'xW01C', note: 'in the Variablenliste, not on the board' },
        { id: 'xW09Z', note: 'coil symbols incomplete' },
        { id: 'xW42X', note: 'no symbols at all' },
      ],
    }));
    expect([...wiring.unplacedCoils.keys()]).toEqual(['xW01C']);
    expect(wiring.unplacedCoils.get('xW01C')).toEqual({
      G: { kind: 'bit', area: 'M', byte: 102, bit: 0 },
      R: { kind: 'bit', area: 'M', byte: 108, bit: 0 },
    });
    expect(wiring.switchCoils.size).toBe(0);      // unplaced ≠ part of the switch interface
  });

  it('has an empty unplaced map when the trackplan omits the optional field', () => {
    expect(buildWiring(fakeSymbols(SYSTEM_ENTRIES), plan()).unplacedCoils.size).toBe(0);
  });
});

// ── "Try it" forcible inputs (§10.3) ────────────────────────────────────────────────────

function inputBit(byte: number, index: number): BitAddress {
  return { kind: 'bit', area: 'E', byte, bit: index };
}

function bitInstruction(address: BitAddress): Instruction {
  return { op: 'U', operand: { kind: 'bit', address }, line: 1, col: 1 };
}

function program(...addresses: BitAddress[]): Program {
  return {
    instructions: addresses.map(bitInstruction),
    networks: [],
    labels: new Map(),
    source: '',
  };
}

describe('forcible inputs (§10.3)', () => {
  const wiring = buildWiring(fakeSymbols([...SYSTEM_ENTRIES, entry('xR01A', inputBit(1, 4))]),
                             plan({ reeds: [{ id: 'xR01A', edgeId: 'e-1', offsetMm: 0, wired: true }] }));

  it('accepts wired reed inputs but never the Notaus input', () => {
    // Wired reeds are forcible on purpose: the coordinator re-asserts forced bits after the
    // per-scan PAE write, and every bit of E 0 – E 2 on the real board is a reed input.
    expect(isForcibleInput(wiring, inputBit(1, 4))).toBe(true);
    expect(isForcibleInput(wiring, inputBit(0, 0))).toBe(true);
    expect(isForcibleInput(wiring, inputBit(1, 7))).toBe(false);          // NotausBit
    expect(isForcibleInput(wiring, { kind: 'bit', area: 'M', byte: 10, bit: 0 })).toBe(false);
    expect(isForcibleInput(wiring, { kind: 'bit', area: 'A', byte: 0, bit: 1 })).toBe(false);
  });

  it('collects a program’s input bits deduplicated and in address order', () => {
    const inputs = forcibleProgramInputs(
      wiring,
      program(inputBit(1, 1), inputBit(0, 7), inputBit(1, 1), inputBit(1, 7), inputBit(0, 0)),
    );
    expect(inputs).toEqual([inputBit(0, 0), inputBit(0, 7), inputBit(1, 1)]);
  });

  it('returns nothing for a program without input operands', () => {
    expect(forcibleProgramInputs(wiring, program())).toEqual([]);
    expect(forcibleProgramInputs(wiring, program(inputBit(1, 7)))).toEqual([]);
  });
});
