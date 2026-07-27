/**
 * Symbol table (ARCHITECTURE.md §5.1.2): case-SENSITIVE lookup, case-insensitive
 * suggestions ("did you mean XW03CR?").
 */
import type { Address, BlockRef } from './address';
import { formatAddress, parseAddress } from './address';

export type S7DataType = 'BOOL' | 'BYTE' | 'WORD' | 'INT' | 'TIMER' | 'COUNTER' | 'BLOCK';

const DATA_TYPES: readonly S7DataType[] = ['BOOL', 'BYTE', 'WORD', 'INT', 'TIMER', 'COUNTER', 'BLOCK'];

export interface SymbolEntry {
  symbol: string;                    // exact spelling incl. case, e.g. "XW03CR"
  target: Address | BlockRef;
  dataType: S7DataType;
  comment?: string;                  // German comment from Variablenliste
  commentEn?: string;                // English translation (optional)
}

/** Parsed shape of src/data/variables.json (schema §7.2 — the type lives with its consumer). */
export interface VariablesFileEntry {
  symbol: string;
  address: string;                   // canonical text form, e.g. "M 100.5", "AW 6", "FB 1"
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

const BLOCK_RE = /^(FB|FC|DB|OB|UDT)\s*(\d+)$/i;

/** "FB 1", "OB 121", "UDT 1" → BlockRef; null if not a block reference. */
export function parseBlockRef(text: string): BlockRef | null {
  const m = BLOCK_RE.exec(text.trim());
  if (!m) return null;
  return {
    kind: 'block',
    blockType: m[1]!.toUpperCase() as BlockRef['blockType'],
    n: Number(m[2]),
  };
}

export class SymbolTable {
  private readonly entries: SymbolEntry[] = [];
  private readonly bySymbol = new Map<string, SymbolEntry>();
  private readonly byLower = new Map<string, SymbolEntry[]>();
  private readonly byAddressKey = new Map<string, SymbolEntry>();

  private add(entry: SymbolEntry): void {
    this.entries.push(entry);
    this.bySymbol.set(entry.symbol, entry);
    const lower = entry.symbol.toLowerCase();
    const bucket = this.byLower.get(lower);
    if (bucket) bucket.push(entry);
    else this.byLower.set(lower, [entry]);
    if (entry.target.kind !== 'block') {
      const key = formatAddress(entry.target);
      if (!this.byAddressKey.has(key)) this.byAddressKey.set(key, entry);   // first wins (insertion order)
    }
  }

  /** Build from parsed variables.json content (type in §7.2). Throws with a clear message
   *  on malformed entries — startup validation per §7. */
  static fromVariables(doc: VariablesFile): SymbolTable {
    const table = new SymbolTable();
    for (const raw of doc.entries) {
      if (typeof raw.symbol !== 'string' || raw.symbol.length === 0) {
        throw new Error(`variables.json: entry with empty symbol name (address "${raw.address}")`);
      }
      if (!DATA_TYPES.includes(raw.type)) {
        throw new Error(`variables.json: symbol "${raw.symbol}" has unknown data type "${raw.type}"`);
      }
      let target: Address | BlockRef | null = parseAddress(raw.address);
      if (!target) target = parseBlockRef(raw.address);
      if (!target) {
        throw new Error(`variables.json: symbol "${raw.symbol}" has invalid address "${raw.address}"`);
      }
      const entry: SymbolEntry = { symbol: raw.symbol, target, dataType: raw.type };
      if (raw.comment !== undefined) entry.comment = raw.comment;
      if (raw.commentEn !== undefined) entry.commentEn = raw.commentEn;
      table.add(entry);
    }
    return table;
  }

  /** Case-SENSITIVE — "xW03CR" does NOT find "XW03CR". This is the practicum trap. */
  lookup(symbol: string): SymbolEntry | undefined {
    return this.bySymbol.get(symbol);
  }

  /** For diagnostics: entries whose lowercase form matches → "did you mean XW03CR?" */
  suggest(symbol: string): SymbolEntry[] {
    const bucket = this.byLower.get(symbol.toLowerCase());
    if (!bucket) return [];
    return bucket.filter((e) => e.symbol !== symbol);
  }

  byAddress(a: Address): SymbolEntry | undefined {   // reverse lookup (watch table, wiring)
    return this.byAddressKey.get(formatAddress(a));
  }

  all(): readonly SymbolEntry[] {
    return this.entries;
  }
}
