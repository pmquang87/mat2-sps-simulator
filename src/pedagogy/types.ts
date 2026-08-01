/**
 * Pedagogy contracts (ARCHITECTURE.md §5.5): ExerciseSpec, NetworkSpec, HintSpec,
 * BehaviorCheck, EventPattern, ScenarioAction — plus LocalizedText, which pedagogy OWNS
 * (single declaration in the codebase; ui/i18n imports it, §5.6).
 */
import type { SimEvent } from '../plant';

/** OWNED by pedagogy (single declaration in the codebase); ui/i18n imports it for lt()
 *  (§5.6). The §4 table's dependency cell reflects this direction: ui → pedagogy. */
export interface LocalizedText { de: string; en: string; }

export interface HintSpec {
  level: 1 | 2 | 3;
  /** 1 = concept pointer (names the concept + Anleitung/Hinweise section),
   *  2 = generic pattern with NEUTRAL operands (E 0.0, M 10.x, T 1x — never plant symbols),
   *  3 = checklist / common-pitfall list for this network type.
   *  NEVER task operands, never a complete task solution. */
  title: LocalizedText;
  body: LocalizedText;               // markdown-lite: paragraphs + fenced awl blocks
  /** Citation into the German-only Anleitung. `section` is the manual's numbering;
   *  `label` is the localized display text so default-locale (EN) users get a
   *  translated reference. */
  anleitungRef?: { section: string; label: LocalizedText };
  exampleId?: string;                // link into examples library
}

export interface EventPattern {
  type: SimEvent['type'];
  switchId?: string; coil?: 'G' | 'R';
  reedId?: string;
  nodeId?: string; edgeId?: string;                  // bufferHit / segmentEntered payloads
  /** notaus payload constraint — WITHOUT it, {type:'notaus'} matches both the press
   *  (active:true) and the release (active:false). Checks almost always want it pinned. */
  active?: boolean;
  level?: 0 | 1 | 2 | 3; direction?: 'IU' | 'GU' | 'STOP';
  minDurationMs?: number; maxDurationMs?: number;    // for switchPulse / stop durations
}
// Matching rule: every field present must strictly equal the event's payload field;
// absent fields are wildcards.

export type BehaviorCheck =
  | { kind: 'seq';       id: string; description: LocalizedText;
      /** ordered subsequence that must appear in the event stream */
      events: EventPattern[];
      /** optional: all events must occur within `ms` after the first match */
      windowMs?: number }
  | { kind: 'after';     id: string; description: LocalizedText;
      trigger: EventPattern; expect: EventPattern; withinMs: number; minDelayMs?: number;
      /** The trigger only ARMS while the derived motion state matches. BehaviorChecker
       *  derives it from trainStarted/trainStopped events (initial state: stationary). */
      armWhile?: 'trainMoving' | 'trainStationary' }
  | { kind: 'never';     id: string; description: LocalizedText; event: EventPattern }
  | { kind: 'invariant'; id: string; description: LocalizedText;
      /** exclusiveSpeedBit — no speedConflict event, ever;
       *  noCoilHeld — no coilHeld event, ever;
       *  notausForcesStop — strictly "no train movement while notaus is active" (§5.5). */
      invariant: 'exclusiveSpeedBit' | 'noCoilHeld' | 'notausForcesStop' };

/** One timed stimulus for a check run. Single-variant union — extend additively (M2). */
export type ScenarioAction =
  | { atMs: number; action: 'notaus'; active: boolean };

export interface NetworkSpec {
  id: string;                        // "A-NW1"
  index: number; points: number;
  title: LocalizedText;
  task: LocalizedText;               // the official Aufgabenstellung text (DE) + EN translation
  symbolNotes?: LocalizedText;       // e.g. "task says Speed2U — the symbol is Speed2IU"
  hints: HintSpec[];
  checks: BehaviorCheck[];
  /** Deterministic stimulus script for "Run checks" (§10.1): the SimCoordinator plays it
   *  via loadScenario (§5.2). This schema doubles as the record/replay format for "UI
   *  actions with sim-time stamps" that §6.3 presumes. Absent/empty = plain free-run. */
  scenario?: ScenarioAction[];
  /** Check run ends (and pending checks resolve, §10.1) at this simulated time.
   *  Default 120_000. */
  runTimeoutMs?: number;
}

export interface ExerciseSpec {
  id: string;                        // "gruppeA" | "gruppeB" | future custom
  title: LocalizedText; intro: LocalizedText;
  bounceEnabled: boolean;            // true for Gruppe A (xR01D debounce network)
  networks: NetworkSpec[];
}

export interface CheckResult {
  checkId: string; status: 'pass' | 'fail' | 'pending';
  detail?: LocalizedText;            // e.g. "switch pulse lasted 4820 ms — expected ≈300 ms"
}

/**
 * Which experiment an example belongs to. Declared here rather than imported from `ui/`,
 * because pedagogy/ must not depend on ui/ (§2 rule 5); the two unions are identical by
 * construction and structurally assignable, and `tests/pedagogy/loaders.test.ts` pins that.
 */
export type ExampleExperiment = 'railway' | 'pump';

export const EXAMPLE_EXPERIMENTS: readonly ExampleExperiment[] = ['railway', 'pump'];

export interface ExampleSpec {
  id: string; category: 'binary' | 'memory' | 'timer' | 'edge' | 'counter' | 'compare' | 'jump' | 'pattern';
  title: LocalizedText; body: LocalizedText;   // explanation
  awl: string;                                 // runnable snippet with NEUTRAL operands
  source: string;                              // "Anleitung IV.2.5.6" — provenance
  /** At most one example may set this (§7.4): the first-run editor buffer. It must use
   *  student-area write targets only (M 10.x – M 20.x, T 10 – T 20, Z 1), so the very first
   *  "Load into PLC" produces no W-RES-001 warning. */
  starter?: boolean;
  /** Restrict the example to ONE experiment. Absent — the normal case — means the snippet
   *  runs meaningfully on both plants, which is true for every operand-neutral example the
   *  Anleitung teaches. Only a snippet that needs plant hardware the other experiment does
   *  not have (reeds, switch coils) may be tagged. */
  experiment?: ExampleExperiment;
}
