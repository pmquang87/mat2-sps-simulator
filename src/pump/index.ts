/**
 * Public API surface of pump/ (ARCHITECTURE.md §2 rule 7: deep imports from outside are
 * forbidden — everything goes through this file).
 *
 * pump/ is the second experiment's plant layer: the teaching example of Anleitung IV.2.5.2
 * (Abbildung 4), on which the manual introduces every AWL instruction. The PLANT half is
 * pure, headless, deterministic — no DOM, no Three.js, no wall clock, no `Math.random` — and
 * imports only `core/` plus nothing else from `src/`. The railway plant (`plant/`) and this
 * one never see each other.
 *
 * `./scene` is the one part that renders, and it is re-exported here so the bootstrap needs
 * no deep import. Anything that must stay renderer-free — `ui/pumpProfile.ts`, every node
 * test of the plant — imports the sub-paths it names directly rather than this barrel, so
 * that Three.js is only pulled in by the code that draws.
 */
export * from './types';
export * from './params';
export * from './paramsStorage';
export * from './task';
export * from './model';
export * from './variables';
export * from './wiring';
export * from './coordinator';
export * from './stack';
export * from './scene';
