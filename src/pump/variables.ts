/**
 * Symbol table of the pump experiment — the counterpart of `src/data/variables.json` for
 * the railway, but TS instead of JSON: it is not course data transcribed from a document,
 * it is this simulator's naming of the Anleitung's signal map (IV.2.5.2, Abbildung 4).
 * The addresses are NOT free: they are the manual's, and `wiring.ts` verifies every one.
 *
 * Students may equally well write the absolute addresses — which is what the manual's own
 * snippets do (`U E 0.0`), so both spellings have to work.
 */
import { SymbolTable } from '../core';
import type { VariablesFile } from '../core';

/** Symbol names the wiring resolves. Changing one changes the student-visible contract. */
export const PUMP_SYMBOL_NAMES = {
  s1: 'S1',
  s0: 'S0',
  llsA: 'LLS_TankA',
  hlsA: 'HLS_TankA',
  llsB: 'LLS_TankB',
  hlsB: 'HLS_TankB',
  ls: 'LS_Pumpe',
  pump: 'Pumpe',
  lamp2: 'Meldeleuchte1',
  lamp3: 'Meldeleuchte2',
  toggle07: 'Flankenschalter',
  toggle10: 'Schalter1',
  toggle11: 'Schalter2',
  toggle12: 'Schalter3',
  toggle13: 'Schalter4',
  toggle14: 'Schalter5',
  toggle17: 'Ruecksetzen',
} as const;

/**
 * VariablesFile-shaped so it goes through the same `SymbolTable.fromVariables` validation
 * as the railway list (§7.2) — one parser, one set of failure messages.
 */
export const PUMP_VARIABLES: VariablesFile = {
  version: 1,
  generatedFrom: 'Anleitung IV.2.5.2, Abbildung 4 (reference/research/anleitung.md §5.1)',
  generatedAt: '2026-08-01',
  entries: [
    {
      symbol: PUMP_SYMBOL_NAMES.s1, address: 'E 0.0', type: 'BOOL',
      comment: 'Start-Taster S1 (Taster, nicht rastend)',
      commentEn: 'Start button S1 (momentary)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.llsA, address: 'E 0.1', type: 'BOOL',
      comment: 'Leermeldung LLS Tank A (1 = Tank A leer)',
      commentEn: 'Low-level switch tank A (1 = A empty)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.hlsA, address: 'E 0.2', type: 'BOOL',
      comment: 'Vollmeldung HLS Tank A (1 = Tank A voll)',
      commentEn: 'High-level switch tank A (1 = A full)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.llsB, address: 'E 0.3', type: 'BOOL',
      comment: 'Leermeldung LLS Tank B (1 = Tank B leer)',
      commentEn: 'Low-level switch tank B (1 = B empty)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.hlsB, address: 'E 0.4', type: 'BOOL',
      comment: 'Vollmeldung HLS Tank B (1 = Tank B voll)',
      commentEn: 'High-level switch tank B (1 = B full)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.ls, address: 'E 0.5', type: 'BOOL',
      comment: 'Trockenlaufschutz LS (1 = benetzt)',
      commentEn: 'Dry-run guard (1 = wetted)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.s0, address: 'E 0.6', type: 'BOOL',
      comment: 'Stopp-Taster S0 (Taster, nicht rastend)',
      commentEn: 'Stop button S0 (momentary)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle07, address: 'E 0.7', type: 'BOOL',
      comment: 'Schalter am Pult — Eingang der Flanken- und Sprungbeispiele (FP/FN, SPB)',
      commentEn: 'Pedestal toggle switch — input of the edge and jump examples (FP/FN, SPB)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle10, address: 'E 1.0', type: 'BOOL',
      comment: 'Schalter am Pult (frei belegbar, z. B. für SI-Beispiel)',
      commentEn: 'Pedestal toggle switch (free use, e.g. the SI example)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle11, address: 'E 1.1', type: 'BOOL',
      comment: 'Schalter am Pult (frei belegbar, z. B. für SV-Beispiel)',
      commentEn: 'Pedestal toggle switch (free use, e.g. the SV example)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle12, address: 'E 1.2', type: 'BOOL',
      comment: 'Schalter am Pult (frei belegbar, z. B. für SE-Beispiel)',
      commentEn: 'Pedestal toggle switch (free use, e.g. the SE example)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle13, address: 'E 1.3', type: 'BOOL',
      comment: 'Schalter am Pult (frei belegbar, z. B. für SS-Beispiel)',
      commentEn: 'Pedestal toggle switch (free use, e.g. the SS example)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle14, address: 'E 1.4', type: 'BOOL',
      comment: 'Schalter am Pult (frei belegbar, z. B. für SA-Beispiel)',
      commentEn: 'Pedestal toggle switch (free use, e.g. the SA example)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.toggle17, address: 'E 1.7', type: 'BOOL',
      comment: 'Schalter am Pult — Rücksetzeingang der Zeitbeispiele (R T x)',
      commentEn: 'Pedestal toggle switch — reset input of the timer examples (R T x)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.pump, address: 'A 0.1', type: 'BOOL',
      comment: 'Kreiselpumpe (Ausgang)',
      commentEn: 'Centrifugal pump (output)',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.lamp2, address: 'A 0.2', type: 'BOOL',
      comment: 'Meldeleuchte am Pult',
      commentEn: 'Indicator lamp on the pedestal',
    },
    {
      symbol: PUMP_SYMBOL_NAMES.lamp3, address: 'A 0.3', type: 'BOOL',
      comment: 'Meldeleuchte am Pult',
      commentEn: 'Indicator lamp on the pedestal',
    },
  ],
};

/** The pump experiment's SymbolTable — same construction path as the railway's. */
export function buildPumpSymbols(): SymbolTable {
  return SymbolTable.fromVariables(PUMP_VARIABLES);
}
