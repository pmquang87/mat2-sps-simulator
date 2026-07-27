/**
 * Public API surface of app/ (ARCHITECTURE.md §2 rule 7). app/ is the coordination layer
 * (deviation note, §2): it keeps core/ and plant/ free of DOM and wall-clock access.
 */
export * from './SimClock';
export * from './Wiring';
export * from './EventBus';
export * from './SimCoordinator';
export * from './RafDriver';

/** SimEvent union re-exported by app/ (§5.3 code comment). */
export type { SimEvent } from '../plant';
