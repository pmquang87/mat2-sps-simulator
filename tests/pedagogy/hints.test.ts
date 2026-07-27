/**
 * Hint gating and the no-solution guard (ARCHITECTURE.md §9.3 "hints.test.ts"):
 *  - gating: level 2 locked until a failed run / 5-minute timeout / "I'm stuck" click,
 *    driven through the injected in-memory KeyValueStore and a fake NowFn (§5.5), node env;
 *  - the §7.3 forbidden-operand scan over every hint body — over the built-in hint library
 *    (strict, no exemptions) and over `src/data/exercises.json` when it exists, with the
 *    §7.3 example hints as must-PASS fixtures.
 */
import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_HINT_PATTERNS,
  HINT_LIBRARY,
  HINT_TIME_UNLOCK_MS,
  HintGate,
  MemoryKeyValueStore,
  ProgressStore,
  exerciseHintLeakViolations,
  formatHintLeakViolation,
  hintLeakViolations,
  loadExercises,
  networkHintLeakViolations,
  symbolsInText,
  type HintSpec,
  type NetworkSpec,
} from '../../src/pedagogy';
import { readJsonIfPresent } from './support/repoFiles';

// ── gating ───────────────────────────────────────────────────────────────────────────────

interface Harness {
  gate: HintGate;
  progress: ProgressStore;
  advance(ms: number): void;
}

function harness(networkId = 'A-NW1'): Harness {
  let now = 1_700_000_000_000;
  const progress = new ProgressStore(new MemoryKeyValueStore(), () => now);
  const gate = new HintGate(networkId, progress);
  gate.visit();
  return {
    gate,
    progress,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('HintGate unlock policy', () => {
  it('offers level 1 immediately and locks 2 and 3', () => {
    const { gate } = harness();
    expect(gate.availableLevels()).toEqual([1]);
    expect(gate.isAvailable(2)).toBe(false);
    expect(gate.nextLockedLevel()).toBe(2);
  });

  it('unlocks the next level after a failed check run', () => {
    const { gate, progress } = harness();
    progress.recordFailedRun('A-NW1');
    expect(gate.availableLevels()).toEqual([1, 2]);
    progress.recordFailedRun('A-NW1');
    expect(gate.availableLevels()).toEqual([1, 2, 3]);
  });

  it('unlocks the next level after 5 minutes of real time', () => {
    const { gate, advance } = harness();
    advance(HINT_TIME_UNLOCK_MS - 1);
    expect(gate.availableLevels()).toEqual([1]);
    advance(1);
    expect(gate.availableLevels()).toEqual([1, 2]);
    advance(HINT_TIME_UNLOCK_MS);
    expect(gate.availableLevels()).toEqual([1, 2, 3]);
  });

  it('unlocks the next level on an explicit "I\'m stuck" click', () => {
    const { gate } = harness();
    gate.requestUnlock();
    expect(gate.availableLevels()).toEqual([1, 2]);
  });

  it('never goes past level 3, whatever the triggers', () => {
    const { gate, progress, advance } = harness();
    progress.recordFailedRun('A-NW1');
    gate.requestUnlock();
    advance(10 * HINT_TIME_UNLOCK_MS);
    expect(gate.availableLevels()).toEqual([1, 2, 3]);
    expect(gate.nextLockedLevel()).toBeNull();
  });

  it('records reveals and refuses locked levels', () => {
    const { gate, progress } = harness();
    gate.reveal(1);
    expect(gate.revealedLevels()).toEqual([1]);
    expect(() => gate.reveal(2)).toThrow(/locked/);
    progress.recordFailedRun('A-NW1');
    gate.reveal(2);
    expect(gate.revealedLevels()).toEqual([1, 2]);
  });

  it('persists gating state across gate instances over the same store', () => {
    const { progress } = harness('B-NW7');
    progress.recordFailedRun('B-NW7');
    const fresh = new HintGate('B-NW7', progress);
    expect(fresh.availableLevels()).toEqual([1, 2]);
    // and unlock state is per network
    expect(new HintGate('B-NW8', progress).availableLevels()).toEqual([1]);
  });

  it('does not start the 5-minute clock before the network is visited', () => {
    let now = 0;
    const progress = new ProgressStore(new MemoryKeyValueStore(), () => now);
    const gate = new HintGate('A-NW9', progress);
    now += 10 * HINT_TIME_UNLOCK_MS;
    expect(gate.availableLevels()).toEqual([1]);
  });
});

// ── the §7.3 forbidden-operand rules ─────────────────────────────────────────────────────

function hint(body: string, level: 1 | 2 | 3 = 2): HintSpec {
  return {
    level,
    title: { de: 'Titel', en: 'Title' },
    body: { de: body, en: body },
  };
}

describe('forbidden-operand patterns', () => {
  it('covers every §7.3 rule', () => {
    expect(FORBIDDEN_HINT_PATTERNS.map((p) => p.id)).toEqual([
      'system-flag-byte',
      'speed-flag-byte',
      'switch-symbol',
      'reed-symbol',
      'switch-symbol-uppercase-1',
      'switch-symbol-uppercase-2',
      'speed-symbol',
      'standstill-symbol-in-code',
    ]);
  });

  it('accepts the neutral student operands level-2 hints are required to use', () => {
    const neutral = hint(
      'Muster:\n\n```awl\nU    E    0.0\nFP   M    10.0\nS    M    11.7\nL    S5T#300MS\n' +
        'SV   T    10\nU    T    20\n=    A    0.1\nZV   Z    1\n```',
    );
    expect(hintLeakViolations(neutral)).toEqual([]);
  });

  it('rejects system flag bytes M 100–M 119 and M 120 / M 121', () => {
    expect(hintLeakViolations(hint('setze M 100.5')).map((v) => v.patternId)).toContain(
      'system-flag-byte',
    );
    expect(hintLeakViolations(hint('setze M 119.0')).map((v) => v.patternId)).toContain(
      'system-flag-byte',
    );
    expect(hintLeakViolations(hint('Merkerbyte M 120')).map((v) => v.patternId)).toContain(
      'speed-flag-byte',
    );
    expect(hintLeakViolations(hint('Flanke auf M 121.0')).map((v) => v.patternId)).toContain(
      'speed-flag-byte',
    );
  });

  it('rejects plant switch and reed symbols, including the uppercase-X traps', () => {
    const ids = (body: string): string[] => hintLeakViolations(hint(body)).map((v) => v.patternId);
    expect(ids('stelle xW02BH1G1G')).toContain('switch-symbol');
    expect(ids('nutze xR01BH1G1')).toContain('reed-symbol');
    expect(ids('Achtung XW03CR')).toContain('switch-symbol-uppercase-1');
    expect(ids('Achtung XW05BH1G3R')).toContain('switch-symbol-uppercase-2');
  });

  it('rejects traction-stage symbols', () => {
    expect(hintLeakViolations(hint('setze Speed2IU')).map((v) => v.patternId)).toContain(
      'speed-symbol',
    );
    expect(hintLeakViolations(hint('setze Speed1GU')).map((v) => v.patternId)).toContain(
      'speed-symbol',
    );
  });

  it('allows the standstill symbol in prose but not as an operand in example code', () => {
    expect(hintLeakViolations(hint('Bleibt STOP nach Signalwiederkehr gesetzt?', 3))).toEqual([]);
    const inCode = hintLeakViolations(hint('```awl\nUN   E    0.0\nS    "STOP"\n```'));
    expect(inCode.map((v) => v.patternId)).toContain('standstill-symbol-in-code');
  });

  it('scans titles as well as bodies', () => {
    const leaky: HintSpec = {
      level: 1,
      title: { de: 'Weiche xW01D stellen', en: 'Throw point xW01D' },
      body: { de: 'neutral', en: 'neutral' },
    };
    expect(hintLeakViolations(leaky).map((v) => v.field)).toEqual(['title.de', 'title.en']);
  });

  it('exempts symbols the network task text already prints (§7.3 "minus")', () => {
    const leak = hint('Der Kontakt xR01D ist gemeint.');
    expect(hintLeakViolations(leak)).not.toEqual([]);
    expect(hintLeakViolations(leak, symbolsInText('Bei Erreichen des Kontakts "xR01D" …'))).toEqual(
      [],
    );
  });

  it('formats violations for readable test output', () => {
    const violation = hintLeakViolations(hint('xW01D'), undefined, 'A-NW7')[0];
    expect(violation).toBeDefined();
    expect(formatHintLeakViolation(violation!)).toContain('A-NW7 level 2 body.de');
  });
});

// ── must-PASS fixtures: the §7.3 example hints of A-NW1 ───────────────────────────────────

/** Transcribed from ARCHITECTURE.md §7.3 — these are fixture inputs and must PASS. */
const ARCH_EXAMPLE_NETWORK: NetworkSpec = {
  id: 'A-NW1',
  index: 1,
  points: 2,
  title: { de: 'Not-Aus HALT!', en: 'Emergency stop HALT!' },
  task: {
    de:
      'Der Notausstromkreis ist drahtbruchsicher verkabelt […] Wenn E 1.7 (NotausBit) logisch 0 ' +
      'ist, soll Merker 120.3 (STOP) den Zug immer stoppen.',
    en:
      'The emergency-stop circuit is wired fail-safe […] Whenever E 1.7 (NotausBit) is logic 0, ' +
      'flag M 120.3 (STOP) must always stop the train.',
  },
  hints: [
    {
      level: 1,
      title: { de: 'Konzept: 0-aktive Signale', en: 'Concept: active-low signals' },
      body: {
        de:
          'Ein drahtbruchsicheres Signal ist im Normalzustand 1. Abfrage des Störfalls daher ' +
          'negiert. Siehe Anleitung IV.2.5.5 (UN).',
        en:
          'A fail-safe signal is 1 in normal operation, so the fault case is queried negated. ' +
          'See Anleitung IV.2.5.5 (UN).',
      },
      anleitungRef: {
        section: 'IV.2.5.5',
        label: {
          de: 'Anleitung IV.2.5.5 (UN)',
          en: 'Manual IV.2.5.5 (negated query, UN)',
        },
      },
    },
    {
      level: 2,
      title: { de: 'Muster: speicherndes Stoppen', en: 'Pattern: latched stop' },
      body: {
        de:
          'Generisches Muster mit neutralen Operanden:\n```awl\nUN E 0.0   // Störsignal 0-aktiv\n' +
          'S  M 10.0  // Zustand speichernd setzen\n```\nWarum `S` statt `=`? Überlegen Sie, was ' +
          'nach Rückkehr des Signals passieren darf.',
        en:
          'Generic pattern with neutral operands:\n```awl\nUN E 0.0   // fault signal, active-low\n' +
          'S  M 10.0  // latch the state\n```\nWhy `S` instead of `=`? Consider what may happen ' +
          'once the signal returns.',
      },
    },
    {
      level: 3,
      title: { de: 'Checkliste', en: 'Checklist' },
      body: {
        de:
          '– Wird STOP auch OHNE Flanke gesetzt, solange Notaus anliegt?\n– Bleibt STOP nach ' +
          'Signalwiederkehr gesetzt?\n– Sind alle Fahrstufen rückgesetzt?',
        en:
          '– Is STOP set continuously while the emergency stop is active (no edge needed)?\n' +
          '– Does STOP stay latched after the signal returns?\n– Are all speed levels reset?',
      },
    },
  ],
  checks: [],
};

describe('§7.3 example hints', () => {
  it('pass the guard (they are fixture inputs of this test)', () => {
    const violations = networkHintLeakViolations(ARCH_EXAMPLE_NETWORK);
    expect(violations.map(formatHintLeakViolation)).toEqual([]);
  });
});

// ── the shipped content ──────────────────────────────────────────────────────────────────

describe('built-in hint library', () => {
  it('contains no forbidden operand anywhere, even without task-text exemptions', () => {
    const violations = Object.entries(HINT_LIBRARY).flatMap(([networkId, hints]) =>
      hints.flatMap((h) => hintLeakViolations(h, undefined, networkId)),
    );
    expect(violations.map(formatHintLeakViolation)).toEqual([]);
  });
});

const exercisesJson = readJsonIfPresent('src/data/exercises.json');

describe.skipIf(exercisesJson === null)('src/data/exercises.json hints', () => {
  it('pass the §7.3 forbidden-operand scan', () => {
    const exercises = loadExercises(exercisesJson);
    const violations = exerciseHintLeakViolations(exercises);
    expect(violations.map(formatHintLeakViolation)).toEqual([]);
  });
});
