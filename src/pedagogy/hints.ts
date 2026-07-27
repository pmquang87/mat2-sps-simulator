/**
 * Hint unlock policy (ARCHITECTURE.md §5.5, §10.2) and the no-solution guard rules (§7.3,
 * §10.2 "Guard rails").
 *
 * Two responsibilities, both pure logic:
 *  1. `HintGate` — progressive level gating over an injected `ProgressStore`.
 *  2. the leak guard — the machine-checkable form of "hints never contain plant/system
 *     operands". `tests/pedagogy/hints.test.ts` runs it over the built-in hint library AND
 *     over `src/data/exercises.json`; ui/ may run it in dev mode to catch bad authoring.
 */
import { codeBlocks } from './content';
import type { ProgressStore } from './progress';
import type { ExerciseSpec, HintSpec, NetworkSpec } from './types';

// ─────────────────────────────────────────── gating ───────────────────────────────────────

/** The three fixed levels of §5.5 / §10.2. */
export const HINT_LEVELS: readonly [1, 2, 3] = [1, 2, 3];
export const MAX_HINT_LEVEL = 3;
/** Time-based unlock window — REAL time, not simulated time (§5.5). */
export const HINT_TIME_UNLOCK_MS = 300_000;

export class HintGate {
  private readonly networkId: string;
  private readonly progress: ProgressStore;

  /** Unlock policy: level 1 always available; level n+1 unlocks after (a) a failed check
   *  run OR (b) 5 minutes on the network OR (c) explicit "I'm stuck" click — whichever
   *  first. The 5-minute window is REAL time, measured with the injected now() (NOT sim
   *  time). Persisted per network in progress.ts. */
  constructor(networkId: string, progress: ProgressStore) {
    this.networkId = networkId;
    this.progress = progress;
  }

  /** Call when the student opens the network — starts the 5-minute clock (once). */
  visit(): void {
    this.progress.markVisited(this.networkId);
  }

  /**
   * How many levels beyond level 1 are unlocked. Every unlock trigger grants one credit:
   * each failed check run, each "I'm stuck" click, and each full 5-minute window since the
   * network was first opened ("whichever first" — the triggers are alternatives, so the
   * earliest one to occur unlocks the next level).
   */
  unlockCredits(): number {
    const p = this.progress.networkProgress(this.networkId);
    const timeCredits = Math.floor(
      this.progress.elapsedOnNetworkMs(this.networkId) / HINT_TIME_UNLOCK_MS,
    );
    return p.failedRuns + p.stuckClicks + timeCredits;
  }

  availableLevels(): number[] {
    const top = Math.min(MAX_HINT_LEVEL, 1 + this.unlockCredits());
    const out: number[] = [];
    for (let level = 1; level <= top; level += 1) out.push(level);
    return out;
  }

  isAvailable(level: number): boolean {
    return this.availableLevels().includes(level);
  }

  /** Levels the student has already opened (persisted). */
  revealedLevels(): number[] {
    return this.progress.hintState(this.networkId).revealed;
  }

  /** The lowest still-locked level, or null when everything is unlocked. */
  nextLockedLevel(): number | null {
    const available = this.availableLevels();
    for (const level of HINT_LEVELS) {
      if (!available.includes(level)) return level;
    }
    return null;
  }

  /** "I'm stuck" — unlock trigger (c) of §5.5. */
  requestUnlock(): void {
    this.progress.recordStuck(this.networkId);
  }

  /** Record that the student opened this level. Throws when the level is still locked. */
  reveal(level: number): void {
    if (!this.isAvailable(level)) {
      throw new Error(
        `HintGate.reveal: hint level ${level} of ${this.networkId} is locked ` +
          `(available: ${this.availableLevels().join(', ')})`,
      );
    }
    this.progress.revealHint(this.networkId, level);
  }
}

// ──────────────────────────────────────── leak guard ──────────────────────────────────────

/**
 * Where a pattern applies:
 *  - 'text' — anywhere in the hint (titles and prose included);
 *  - 'code' — only inside fenced code blocks (the §7.3 rule for `STOP`, which is a fine
 *    word in prose like "the standstill flag stays set" but must never appear as an operand
 *    in a hint's example code).
 */
export type HintPatternScope = 'text' | 'code';

export interface ForbiddenHintPattern {
  id: string;
  /** Case-sensitive, whole-word (§7.3). Must carry the `g` flag. */
  re: RegExp;
  scope: HintPatternScope;
  /** Developer-facing reason, shown in test failures. */
  why: string;
}

/**
 * The §7.3 pattern list, verbatim in intent:
 *   /\bM\s*1[01]\d\b/  three-digit system flag bytes M 100–M 119 — the student Merker
 *                      `M 10.x` / `M 11.x` deliberately do NOT match (no third digit);
 *   /\bM\s*12[01]\b/   the speed/standstill and Notaus flag bytes;
 *   \bxW\w+            any switch symbol;  \bxR\w+  any reed symbol;
 *   XW03CR, XW05BH1G3R the two uppercase-X entries of the Variablenliste (the lowercase
 *                      patterns above miss them — case-sensitivity trap);
 *   \bSpeed[123](IU|GU)\b    the traction-stage symbols;
 *   \bSTOP\b inside fenced code blocks.
 * Level-2 hints are REQUIRED to use neutral operands (`E 0.x`, `A 0.x`, `M 10.x`–`M 20.x`,
 * `T 1x`, `Z 1`) — those must pass, which is why the flag-byte patterns need three digits.
 */
export const FORBIDDEN_HINT_PATTERNS: readonly ForbiddenHintPattern[] = [
  {
    id: 'system-flag-byte',
    re: /\bM\s*1[01]\d\b/g,
    scope: 'text',
    why: 'system flag bytes M 100–M 119 (switch coils) must not appear in hints',
  },
  {
    id: 'speed-flag-byte',
    re: /\bM\s*12[01]\b/g,
    scope: 'text',
    why: 'flag bytes M 120 / M 121 (speed, standstill, Notaus) must not appear in hints',
  },
  {
    id: 'switch-symbol',
    re: /\bxW\w*/g,
    scope: 'text',
    why: 'plant switch symbols must not appear in hints',
  },
  {
    id: 'reed-symbol',
    re: /\bxR\w*/g,
    scope: 'text',
    why: 'plant reed symbols must not appear in hints',
  },
  {
    id: 'switch-symbol-uppercase-1',
    re: /XW03CR/g,
    scope: 'text',
    why: 'uppercase-X Variablenliste entry (case trap) must not appear in hints',
  },
  {
    id: 'switch-symbol-uppercase-2',
    re: /XW05BH1G3R/g,
    scope: 'text',
    why: 'uppercase-X Variablenliste entry (case trap) must not appear in hints',
  },
  {
    id: 'speed-symbol',
    re: /\bSpeed[123](IU|GU)\b/g,
    scope: 'text',
    why: 'traction-stage symbols must not appear in hints',
  },
  {
    id: 'standstill-symbol-in-code',
    re: /\bSTOP\b/g,
    scope: 'code',
    why: 'the standstill flag symbol must not appear as an operand in hint example code',
  },
];

export type HintField = 'title.de' | 'title.en' | 'body.de' | 'body.en';

export interface HintLeakViolation {
  networkId?: string;
  level: number;
  field: HintField;
  patternId: string;
  match: string;
  why: string;
}

/** Whitespace-insensitive comparison key, so "M 120" and "M120" are the same symbol. */
function tokenKey(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * Every forbidden token that a text ALREADY prints — used to build the §7.3 exemption
 * ("minus any symbol the network's own task text already prints"). Scans the whole text
 * with every pattern regardless of scope.
 */
export function symbolsInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const pattern of FORBIDDEN_HINT_PATTERNS) {
    const re = new RegExp(pattern.re.source, 'g');
    for (const m of text.matchAll(re)) out.add(tokenKey(m[0]));
  }
  return out;
}

function scanField(
  field: HintField,
  text: string,
  level: number,
  allowed: ReadonlySet<string>,
  out: HintLeakViolation[],
  networkId?: string,
): void {
  const codeText = codeBlocks(text).join('\n');
  for (const pattern of FORBIDDEN_HINT_PATTERNS) {
    const haystack = pattern.scope === 'code' ? codeText : text;
    if (haystack === '') continue;
    const re = new RegExp(pattern.re.source, 'g');
    for (const m of haystack.matchAll(re)) {
      const match = m[0];
      if (allowed.has(tokenKey(match))) continue;
      const violation: HintLeakViolation = {
        level,
        field,
        patternId: pattern.id,
        match,
        why: pattern.why,
      };
      if (networkId !== undefined) violation.networkId = networkId;
      out.push(violation);
    }
  }
}

/**
 * Scan one hint. `allowedSymbols` are the tokens the network's own task text already
 * prints (see `networkHintLeakViolations`); omit it for the strict, context-free scan used
 * on the built-in hint library.
 */
export function hintLeakViolations(
  hint: HintSpec,
  allowedSymbols?: Iterable<string>,
  networkId?: string,
): HintLeakViolation[] {
  const allowed = new Set<string>();
  if (allowedSymbols !== undefined) {
    for (const s of allowedSymbols) allowed.add(tokenKey(s));
  }
  const out: HintLeakViolation[] = [];
  scanField('title.de', hint.title.de, hint.level, allowed, out, networkId);
  scanField('title.en', hint.title.en, hint.level, allowed, out, networkId);
  scanField('body.de', hint.body.de, hint.level, allowed, out, networkId);
  scanField('body.en', hint.body.en, hint.level, allowed, out, networkId);
  return out;
}

/**
 * Scan a network's hints with the §7.3 exemption applied: symbols the task text (and its
 * `symbolNotes` callout) already print are allowed, everything else is a leak.
 */
export function networkHintLeakViolations(network: NetworkSpec): HintLeakViolation[] {
  const printed = new Set<string>([
    ...symbolsInText(network.task.de),
    ...symbolsInText(network.task.en),
    ...(network.symbolNotes === undefined
      ? []
      : [...symbolsInText(network.symbolNotes.de), ...symbolsInText(network.symbolNotes.en)]),
  ]);
  const out: HintLeakViolation[] = [];
  for (const hint of network.hints) {
    out.push(...hintLeakViolations(hint, printed, network.id));
  }
  return out;
}

/** Scan every hint of every network of every exercise. Empty result = clean. */
export function exerciseHintLeakViolations(
  exercises: readonly ExerciseSpec[],
): HintLeakViolation[] {
  const out: HintLeakViolation[] = [];
  for (const exercise of exercises) {
    for (const network of exercise.networks) {
      out.push(...networkHintLeakViolations(network));
    }
  }
  return out;
}

/** Human-readable one-liner per violation — used in test failure messages. */
export function formatHintLeakViolation(v: HintLeakViolation): string {
  const where = v.networkId === undefined ? `level ${v.level}` : `${v.networkId} level ${v.level}`;
  return `${where} ${v.field}: "${v.match}" (${v.patternId} — ${v.why})`;
}
