/**
 * tests/data/variables.test.ts — variables.json ↔ documented invariants
 * (ARCHITECTURE.md §7.2, §9.3): 84 coil bits in 42 G/R pairs with addr(R) = addr(G) + 6
 * bytes at the same bit, 23 reeds + NotausBit, MB 120 speed/STOP layout, the case traps,
 * the tolerated `"SOPhase2` source defect — plus generator↔artifact sync.
 *
 * The pair/byte checks are implemented HERE, independently of the generator's own
 * checkInvariants(), so the committed artifact is verified by a checker that can fail.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkInvariants, parseVariablenliste } from '../../tools/gen-variables';
import variablesJson from '../../src/data/variables.json';

interface Entry {
  symbol: string;
  address: string;
  type: string;
  comment?: string;
  commentEn?: string;
  note?: string;
}

const entries = variablesJson.entries as Entry[];
const bySymbol = new Map(entries.map((e) => [e.symbol, e]));

describe('variables.json artifact', () => {
  it('has version/provenance header and 135 entries', () => {
    expect(variablesJson.version).toBe(1);
    expect(variablesJson.generatedFrom).toBe('Variablenliste.txt');
    expect(entries).toHaveLength(135);
  });

  // reference/ is the local-only course-material folder (gitignored); a public checkout
  // has no Variablenliste.txt, so the regeneration cross-check runs only where it exists.
  const variablenliste = fileURLToPath(
    new URL('../../reference/Variablenliste.txt', import.meta.url),
  );
  it.runIf(existsSync(variablenliste))(
    'is in sync with a fresh parse of Variablenliste.txt (cp1252)',
    () => {
      const raw = readFileSync(variablenliste);
      const regenerated = parseVariablenliste(raw);
      expect(entries).toEqual(regenerated);
      expect(checkInvariants(regenerated)).toEqual([]);
    },
  );

  it('has unique symbols and canonical address formats', () => {
    expect(new Set(entries.map((e) => e.symbol)).size).toBe(entries.length);
    const dataAddr = /^(E|A|M) \d+\.\d$|^(EW|AW|MW) \d+$|^T \d+$|^Z \d+$/;
    const blockAddr = /^(FB|FC|DB|OB|UDT) \d+$/;
    for (const e of entries) {
      const re = e.type === 'BLOCK' ? blockAddr : dataAddr;
      expect(e.address, `address of ${e.symbol}`).toMatch(re);
    }
  });
});

describe('switch coil invariants (42 pairs, R = G + 6 bytes)', () => {
  const coils = entries.filter((e) => /^[xX]W/.test(e.symbol));

  it('has exactly 84 BOOL coil bits', () => {
    expect(coils).toHaveLength(84);
    for (const c of coils) expect(c.type, c.symbol).toBe('BOOL');
  });

  it('forms 42 G/R pairs with addr(R) = addr(G) + 6 bytes at the same bit', () => {
    const pairs = new Map<string, { G?: Entry; R?: Entry }>();
    for (const c of coils) {
      const m = /^([xX]W\w+)([GR])$/.exec(c.symbol);
      expect(m, `coil suffix of ${c.symbol}`).not.toBeNull();
      const base = (m as RegExpExecArray)[1]!.toUpperCase();
      const coil = (m as RegExpExecArray)[2] as 'G' | 'R';
      const slot = pairs.get(base) ?? {};
      expect(slot[coil], `duplicate ${coil} coil for ${base}`).toBeUndefined();
      slot[coil] = c;
      pairs.set(base, slot);
    }
    expect(pairs.size).toBe(42);
    for (const [base, pair] of pairs) {
      expect(pair.G, `${base} G coil`).toBeDefined();
      expect(pair.R, `${base} R coil`).toBeDefined();
      const g = /^M (\d+)\.(\d)$/.exec(pair.G!.address);
      const r = /^M (\d+)\.(\d)$/.exec(pair.R!.address);
      expect(g, `${base} G address`).not.toBeNull();
      expect(r, `${base} R address`).not.toBeNull();
      const gByte = Number(g![1]);
      const rByte = Number(r![1]);
      expect(rByte, `${base}: R byte = G byte + 6`).toBe(gByte + 6);
      expect(r![2], `${base}: same bit`).toBe(g![2]);
      expect(gByte, `${base}: G in MB 100–105`).toBeGreaterThanOrEqual(100);
      expect(gByte).toBeLessThanOrEqual(105);
    }
  });

  it('keeps the two uppercase-X case traps exactly as spelled', () => {
    expect(bySymbol.get('XW03CR')?.address).toBe('M 109.7');
    expect(bySymbol.get('XW05BH1G3R')?.address).toBe('M 107.0');
    expect(bySymbol.has('xW03CR')).toBe(false);
    expect(bySymbol.has('xW05BH1G3R')).toBe(false);
    // their G partners are lowercase
    expect(bySymbol.get('xW03CG')?.address).toBe('M 103.7');
    expect(bySymbol.get('xW05BH1G3G')?.address).toBe('M 101.0');
  });
});

describe('inputs: 23 reeds + NotausBit', () => {
  const reeds = entries.filter((e) => e.symbol.startsWith('xR'));

  it('has exactly 23 reed inputs, all E bits, all distinct', () => {
    expect(reeds).toHaveLength(23);
    const addrs = new Set<string>();
    for (const r of reeds) {
      expect(r.type, r.symbol).toBe('BOOL');
      expect(r.address, r.symbol).toMatch(/^E [0-2]\.\d$/);
      addrs.add(r.address);
    }
    expect(addrs.size).toBe(23);
  });

  it('NotausBit is E 1.7 and disjoint from the reeds', () => {
    expect(bySymbol.get('NotausBit')?.address).toBe('E 1.7');
    expect(reeds.some((r) => r.address === 'E 1.7')).toBe(false);
  });
});

describe('system symbols', () => {
  it('MB 120 speed/STOP bit layout', () => {
    const layout: ReadonlyArray<[string, string]> = [
      ['Speed3IU', 'M 120.0'], ['Speed2IU', 'M 120.1'], ['Speed1IU', 'M 120.2'],
      ['STOP', 'M 120.3'], ['Speed1GU', 'M 120.4'], ['Speed2GU', 'M 120.5'], ['Speed3GU', 'M 120.6'],
    ];
    for (const [sym, addr] of layout) {
      expect(bySymbol.get(sym)?.address, sym).toBe(addr);
      expect(bySymbol.get(sym)?.type, sym).toBe('BOOL');
    }
  });

  it('tolerates the unclosed-quote defect W10 (SOPhase2)', () => {
    const e = bySymbol.get('SOPhase2');
    expect(e).toBeDefined();
    expect(e?.address).toBe('MW 131');
    expect(e?.type).toBe('WORD');
    expect(e?.note).toContain('W10');
  });

  it('block and system references', () => {
    const blocks: ReadonlyArray<[string, string]> = [
      ['FahrstromFB', 'FB 1'], ['FahrstromDB', 'DB 1'], ['Weichen', 'FB 2'], ['WeichenDB', 'DB 2'],
      ['WeichenStruct', 'UDT 1'], ['PROG_ERR', 'OB 121'], ['EvtTrigger', 'FB 700'],
      ['FCGR1', 'FC 10'], ['FCGR2', 'FC 20'], ['FCGR3', 'FC 30'], ['FCGR4', 'FC 40'],
      ['FCGR5', 'FC 50'], ['FCGR6', 'FC 60'], ['FCGR7', 'FC 70'], ['FCGR8', 'FC 80'],
    ];
    for (const [sym, addr] of blocks) {
      expect(bySymbol.get(sym)?.address, sym).toBe(addr);
      expect(bySymbol.get(sym)?.type, sym).toBe('BLOCK');
    }
    expect(bySymbol.get('Fahrstrom')?.address).toBe('AW 6');
    expect(bySymbol.get('Fahrstrom')?.type).toBe('WORD');
    expect(bySymbol.get('Schaltzeit')?.address).toBe('T 1');
    expect(bySymbol.get('Schaltzeit')?.type).toBe('TIMER');
    expect(bySymbol.get('NotausNF')?.address).toBe('M 121.0');
    expect(bySymbol.get('SOPD')?.address).toBe('M 130.0');
  });
});
