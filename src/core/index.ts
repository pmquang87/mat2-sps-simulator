/**
 * Public API surface of core/ (ARCHITECTURE.md §2 rule 7: modules export everything via
 * their index.ts; deep imports from outside are forbidden).
 *
 * core/ is pure, headless, deterministic: no DOM, no Three.js, no wall clock, no
 * Math.random, and it imports nothing from other src/ modules (§2 rule 1).
 */
export * from './address';
export * from './symbols';
export * from './s5time';
export * from './ast';
export * from './diagnostics';
export * from './memory';
export * from './tokenizer';
export * from './template';
export * from './parser';
export * from './timers';
export * from './counters';
export * from './exec';
export * from './emulator';
