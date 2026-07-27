/**
 * tools/gen-variables.ts — parse ../Variablenliste.txt (cp1252!) into src/data/variables.json
 * (ARCHITECTURE.md §3, §7.2).
 *
 * Run from the repo root with plain Node ≥ 22.18 (native type stripping):
 *
 *     node tools/gen-variables.ts
 *
 * Generator rules (§7.2, binding):
 *  - preserve exact symbol spelling — the two uppercase-X entries ("XW03CR", "XW05BH1G3R")
 *    MUST survive untouched (case-sensitivity trap of the practicum);
 *  - source lines are `"Symbol"<TAB>ADDR<TAB>TYPE<TAB>comment`;
 *  - tolerate the known source defect W10: the `"SOPhase2` line is missing its closing quote;
 *  - addresses are normalized to the canonical core/address format ("M 100.5", "AW 6", "T 1");
 *  - block refs (FB/FC/DB/OB/UDT) become `type: "BLOCK"`;
 *  - entry order preserves source order (provenance; consumers never rely on order).
 *
 * The script re-checks the documented invariants (42 switch pairs with R = G + 6 bytes, 23
 * reeds + NotausBit, MB 120 speed/STOP layout) BEFORE writing, so a corrupted source file
 * cannot silently produce a broken variables.json. tests/data/variables.test.ts re-asserts
 * the same invariants against the committed artifact.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Node process accessor without @types/node (see node-shim.d.ts for the module shims). */
const proc = (globalThis as unknown as {
  process: { argv: readonly (string | undefined)[]; exit(code?: number): never };
}).process;

// ─────────────────────────────── types (mirror core/symbols.ts §7.2) ──────────────────────

export type S7DataType = 'BOOL' | 'BYTE' | 'WORD' | 'INT' | 'TIMER' | 'COUNTER' | 'BLOCK';

export interface VariablesFileEntry {
  symbol: string;
  address: string;
  type: S7DataType;
  comment?: string;
  commentEn?: string;
  note?: string;
}

export interface VariablesFile {
  version: number;
  generatedFrom: string;
  generatedAt: string;
  entries: VariablesFileEntry[];
}

// ───────────────────────────────────── cp1252 decoding ────────────────────────────────────

/** cp1252 differs from latin1 only in 0x80–0x9F; 0 marks an unmapped code point. */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

export function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b >= 0x80 && b <= 0x9f) {
      const mapped = CP1252_HIGH[b - 0x80] ?? 0;
      out += String.fromCharCode(mapped === 0 ? b : mapped);
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

// ──────────────────────────────────────── parsing ─────────────────────────────────────────

const BASIC_TYPES: ReadonlySet<string> = new Set(['BOOL', 'BYTE', 'WORD', 'INT']);

/** English comments for the system symbols (curated, §7.2 example). */
const COMMENT_EN: Readonly<Record<string, string>> = {
  NotausBit: 'Emergency stop (fail-safe: 0 = active)',
  NotausNF: 'Emergency-stop edge-memory operand (system)',
  STOP: 'Train standstill',
  Fahrstrom: 'Traction current word (only analog output)',
  Schaltzeit: 'System timer of the 300 ms relay logic — not for students',
  Speed1IU: 'Station speed, clockwise',
  Speed2IU: 'Station approach speed, clockwise',
  Speed3IU: 'Full speed, clockwise',
  Speed1GU: 'Station speed, counter-clockwise',
  Speed2GU: 'Station approach speed, counter-clockwise',
  Speed3GU: 'Full speed, counter-clockwise',
  PROG_ERR: 'Programming-error OB',
};

/** Per-symbol data notes (source defects and traps, §7.2). */
const NOTES: Readonly<Record<string, string>> = {
  XW03CR: 'uppercase X exactly as in Variablenliste — case-sensitivity trap (Aufgabe B writes "xW03CR")',
  XW05BH1G3R: 'uppercase X exactly as in Variablenliste — case-sensitivity trap',
  SOPhase2: 'source defect W10: closing quote missing in Variablenliste — parsed tolerantly',
};

/**
 * "M  100.5" → "M 100.5", "E    1.4" → "E 1.4", "AW     6" → "AW 6", "FC    80" → "FC 80".
 * Matches the canonical formatAddress output of core/address.ts for E/A/M/T/Z, and the
 * §7.2 examples for block refs.
 */
export function normalizeAddress(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function mapType(rawType: string, address: string): S7DataType {
  const t = rawType.trim().toUpperCase();
  if (BASIC_TYPES.has(t)) return t as S7DataType;
  if (t === 'TIMER' || /^T \d+$/.test(address)) return 'TIMER';
  if (t === 'COUNTER' || /^Z \d+$/.test(address)) return 'COUNTER';
  // FB1 / FB2 / FB700 / FC10..FC80 / OB121 / UDT1 → block reference.
  return 'BLOCK';
}

/** Strip the surrounding quotes; tolerate the missing closing quote (W10). */
export function parseSymbolField(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"')) s = s.slice(1);
  if (s.endsWith('"')) s = s.slice(0, -1);
  return s;
}

export function parseVariablenliste(bytes: Uint8Array): VariablesFileEntry[] {
  const text = decodeCp1252(bytes);
  const entries: VariablesFileEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const fields = line.split('\t');
    if (fields.length < 3) {
      throw new Error(`Variablenliste: unparseable line (expected >= 3 tab fields): ${JSON.stringify(line)}`);
    }
    const symbol = parseSymbolField(fields[0] ?? '');
    if (symbol === '') throw new Error(`Variablenliste: empty symbol in line ${JSON.stringify(line)}`);
    const address = normalizeAddress(fields[1] ?? '');
    const type = mapType(fields[2] ?? '', address);
    const comment = (fields[3] ?? '').trim();
    const entry: VariablesFileEntry = { symbol, address, type };
    if (comment !== '') entry.comment = comment;
    const commentEn = COMMENT_EN[symbol];
    if (commentEn !== undefined) entry.commentEn = commentEn;
    const note = NOTES[symbol];
    if (note !== undefined) entry.note = note;
    entries.push(entry);
  }
  return entries;
}

// ─────────────────────────────── invariant checks (§7.2) ──────────────────────────────────

export function checkInvariants(entries: readonly VariablesFileEntry[]): string[] {
  const errors: string[] = [];
  const bySymbol = new Map<string, VariablesFileEntry>();
  for (const e of entries) {
    if (bySymbol.has(e.symbol)) errors.push(`duplicate symbol "${e.symbol}"`);
    bySymbol.set(e.symbol, e);
  }

  // 84 switch-coil bits forming 42 G/R pairs with addr(R) = addr(G) + 6 bytes, same bit.
  const coils = entries.filter((e) => /^[xX]W/.test(e.symbol));
  if (coils.length !== 84) errors.push(`expected 84 switch-coil entries, got ${coils.length}`);
  const pairs = new Map<string, { G?: VariablesFileEntry; R?: VariablesFileEntry }>();
  for (const c of coils) {
    const m = /^([xX]W\w+)([GR])$/.exec(c.symbol);
    if (!m) {
      errors.push(`switch-coil symbol "${c.symbol}" has no G/R suffix`);
      continue;
    }
    const base = (m[1] as string).toUpperCase();
    const slot = pairs.get(base) ?? {};
    slot[m[2] as 'G' | 'R'] = c;
    pairs.set(base, slot);
  }
  if (pairs.size !== 42) errors.push(`expected 42 switch pairs, got ${pairs.size}`);
  for (const [base, pair] of pairs) {
    if (!pair.G || !pair.R) {
      errors.push(`switch "${base}" is missing its ${pair.G ? 'R' : 'G'} coil`);
      continue;
    }
    const g = /^M (\d+)\.(\d)$/.exec(pair.G.address);
    const r = /^M (\d+)\.(\d)$/.exec(pair.R.address);
    if (!g || !r) {
      errors.push(`switch "${base}" coil addresses are not M bits (${pair.G.address}, ${pair.R.address})`);
      continue;
    }
    const gByte = Number(g[1]);
    if (Number(r[1]) !== gByte + 6 || r[2] !== g[2]) {
      errors.push(`switch "${base}": R must be G + 6 bytes at the same bit (G ${pair.G.address}, R ${pair.R.address})`);
    }
    if (gByte < 100 || gByte > 105) errors.push(`switch "${base}": G byte ${gByte} outside MB 100–105`);
  }

  // 23 reed inputs + NotausBit — all distinct E bits.
  const reeds = entries.filter((e) => e.symbol.startsWith('xR'));
  if (reeds.length !== 23) errors.push(`expected 23 reed entries, got ${reeds.length}`);
  const eBits = new Set<string>();
  for (const r of reeds) {
    if (!/^E \d+\.\d$/.test(r.address)) errors.push(`reed "${r.symbol}" address "${r.address}" is not an E bit`);
    eBits.add(r.address);
  }
  const notaus = bySymbol.get('NotausBit');
  if (!notaus || notaus.address !== 'E 1.7') errors.push('NotausBit must exist at E 1.7');
  if (notaus) eBits.add(notaus.address);
  if (eBits.size !== 24) errors.push(`expected 24 distinct E bits (23 reeds + NotausBit), got ${eBits.size}`);

  // MB 120 speed/STOP layout.
  const mb120: ReadonlyArray<[string, string]> = [
    ['Speed3IU', 'M 120.0'], ['Speed2IU', 'M 120.1'], ['Speed1IU', 'M 120.2'], ['STOP', 'M 120.3'],
    ['Speed1GU', 'M 120.4'], ['Speed2GU', 'M 120.5'], ['Speed3GU', 'M 120.6'],
  ];
  for (const [sym, addr] of mb120) {
    if (bySymbol.get(sym)?.address !== addr) errors.push(`${sym} must be at ${addr}`);
  }

  // Case traps survive with exact spelling, and no lowercase doubles exist.
  for (const trap of ['XW03CR', 'XW05BH1G3R']) {
    if (!bySymbol.has(trap)) errors.push(`case-trap symbol "${trap}" missing`);
    if (bySymbol.has(trap.replace(/^X/, 'x'))) errors.push(`unexpected lowercase variant of "${trap}"`);
  }

  // The W10 defect line parsed into a clean entry.
  const soPhase2 = bySymbol.get('SOPhase2');
  if (!soPhase2 || soPhase2.address !== 'MW 131' || soPhase2.type !== 'WORD') {
    errors.push('SOPhase2 (unclosed-quote line W10) must parse to MW 131 / WORD');
  }

  return errors;
}

// ─────────────────────────────────────────── main ─────────────────────────────────────────

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(here, '..', 'Variablenliste.txt');
  const outPath = join(here, '..', 'src', 'data', 'variables.json');

  const entries = parseVariablenliste(readFileSync(sourcePath));
  const errors = checkInvariants(entries);
  if (errors.length > 0) {
    console.error(`gen-variables: ${errors.length} invariant violation(s):`);
    for (const err of errors) console.error(`  - ${err}`);
    proc.exit(1);
  }

  const doc: VariablesFile = {
    version: 1,
    generatedFrom: 'Variablenliste.txt',
    generatedAt: new Date().toISOString().slice(0, 10),
    entries,
  };
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  // Assert the effect: read the artifact back and re-check it (working rule: an
  // independent read-back, not the writer's own belief).
  const readBack = JSON.parse(readFileSync(outPath, 'utf8')) as VariablesFile;
  const backErrors = checkInvariants(readBack.entries);
  if (readBack.entries.length !== entries.length || backErrors.length > 0) {
    console.error('gen-variables: read-back verification FAILED');
    proc.exit(1);
  }
  console.log(`gen-variables: wrote ${readBack.entries.length} entries to src/data/variables.json`);
}

const isMain = proc.argv[1] !== undefined
  && /gen-variables\.(ts|js|mts|mjs)$/.test(proc.argv[1].replace(/\\/g, '/'));
if (isMain) main();
