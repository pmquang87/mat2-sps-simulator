/**
 * Public API surface of plant/ (ARCHITECTURE.md §2 rule 7).
 *
 * plant/ is pure, headless, deterministic: no DOM, no wall clock; all randomness flows
 * from the seeded PRNG in plant/random.ts (§6.3). It imports only core/ types (§2 rule 2).
 */
export * from './types';
export * from './exerciseStart';
export * from './geometry';
export * from './random';
export * from './trackGraph';
export * from './occupiedPath';
export * from './train';
export * from './switches';
export * from './reeds';
export * from './fahrstrom';
export * from './plant';
