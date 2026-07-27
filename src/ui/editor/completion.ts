/**
 * Autocompletion fed by the SymbolTable (ARCHITECTURE.md §3, §5.1.2).
 *
 * This deliberately mirrors the real practicum workflow (Atom + variablen.txt): the student
 * types a quote and picks the plant symbol from the Variablenliste instead of memorising
 * `M 104.6`. Symbol labels keep the EXACT spelling from the list, including the two
 * upper-case-X traps — completing from here is the reliable way to get them right.
 */
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import type { Address, BlockRef, SymbolEntry, SymbolTable } from '../../core';
import { t } from '../i18n/i18n';
import { AWL_MNEMONICS } from './awlLanguage';

/** Frequently used literals offered next to the mnemonics. */
const LITERALS: readonly string[] = ['S5T#300MS', 'S5T#1S', 'S5T#5S', 'C#010'];

interface SymbolOption {
  symbol: string;
  detail: string;
  info: string | undefined;
}

/** Display form of a symbol target. Mirrors core's canonical formatting (§5.1.1) but stays
 *  independent of it, so the symbol list is still usable while core is being built. */
function targetText(target: Address | BlockRef): string {
  switch (target.kind) {
    case 'bit':     return `${target.area} ${target.byte}.${target.bit}`;
    case 'word':    return `${target.area} ${target.byte}`;
    case 'timer':   return `T ${target.n}`;
    case 'counter': return `Z ${target.n}`;
    case 'block':   return `${target.blockType} ${target.n}`;
  }
}

/** SymbolTable.all() may be unavailable while core is still a stub — degrade, never crash. */
function readEntries(symbols: SymbolTable | null): readonly SymbolEntry[] {
  if (symbols === null) return [];
  try {
    return symbols.all();
  } catch {
    return [];
  }
}

function toSymbolOptions(symbols: SymbolTable | null): SymbolOption[] {
  return readEntries(symbols).map((entry) => ({
    symbol: entry.symbol,
    detail: targetText(entry.target),
    info: entry.commentEn ?? entry.comment,
  }));
}

function symbolCompletion(option: SymbolOption): Completion {
  const localizedInfo = option.info === undefined || option.info.trim() === ''
    ? undefined
    : option.info;
  return {
    label: `"${option.symbol}"`,
    type: 'variable',
    detail: option.detail,
    ...(localizedInfo === undefined ? {} : { info: localizedInfo }),
    apply: `"${option.symbol}"`,
  };
}

/**
 * Build the completion source. The symbol list is snapshotted once (the Variablenliste is
 * static); locale-dependent labels are rendered per request so the DE/EN toggle takes
 * effect immediately.
 */
export function awlCompletion(symbols: SymbolTable | null): CompletionSource {
  const symbolOptions = toSymbolOptions(symbols);

  return (context: CompletionContext): CompletionResult | null => {
    // Inside a quoted operand: complete plant symbols only.
    const quoted = context.matchBefore(/"[^"]*$/);
    if (quoted !== null) {
      return {
        from: quoted.from,
        options: symbolOptions.map(symbolCompletion),
        validFor: /^"[^"]*$/,
      };
    }

    const word = context.matchBefore(/[A-Za-z0-9_=<>#.]+$/);
    if (word === null && !context.explicit) return null;

    const mnemonicDetail = t('completion.mnemonic');
    const literalDetail = t('completion.literal');
    const options: Completion[] = [
      ...AWL_MNEMONICS.map((mnemonic): Completion => ({
        label: mnemonic,
        type: 'keyword',
        detail: mnemonicDetail,
      })),
      ...LITERALS.map((literal): Completion => ({
        label: literal,
        type: 'constant',
        detail: literalDetail,
      })),
      // A bare quote opens the symbol picker — the Atom+variablen.txt muscle memory.
      ...symbolOptions.map(symbolCompletion),
    ];

    return {
      from: word?.from ?? context.pos,
      options,
      validFor: /^[A-Za-z0-9_=<>#."]*$/,
    };
  };
}

/** Number of symbols available for completion (shown in the editor header). */
export function completionSymbolCount(symbols: SymbolTable | null): number {
  return readEntries(symbols).length;
}
