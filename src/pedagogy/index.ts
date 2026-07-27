/**
 * Public API surface of pedagogy/ (ARCHITECTURE.md §2 rule 7).
 *
 * pedagogy/ imports core/ + plant/ types and the SimEvent union — no DOM, no wall clock
 * (§2 rule 5; storage and time are injected, §5.5).
 *
 * `validate.ts` is deliberately NOT re-exported: it is an internal schema helper, not part
 * of the module contract.
 */
export * from './types';
export * from './content';
export * from './behaviorCheck';
export * from './hints';
export * from './hintLibrary';
export * from './progress';
export * from './exerciseLoader';
export * from './examplesLoader';
