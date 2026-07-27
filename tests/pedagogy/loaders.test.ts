/**
 * exercises.json / examples.json loaders (ARCHITECTURE.md §5.5, schemas §7.3 / §7.4) and the
 * exercise-browser data flow of §10.1: validation, hint-library fallback, lookup structures,
 * examples grouping and the "load into editor" payload.
 *
 * The real data files are validated too when they exist (they are owned by the data agent,
 * §4) — the suite skips cleanly while they are still missing.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUN_TIMEOUT_MS,
  EXAMPLE_CATEGORIES,
  HINT_LIBRARY_NETWORK_IDS,
  buildExerciseIndex,
  exampleAsEditorSource,
  exampleAwlLines,
  exampleLineCount,
  examplesWithPlantSymbols,
  findExample,
  findNetwork,
  groupExamplesByCategory,
  hintsForNetwork,
  loadExamples,
  loadExamplesOrEmpty,
  loadExercises,
  missingExampleRefs,
  runTimeoutMsOf,
  totalPoints,
} from '../../src/pedagogy';
import { readJsonIfPresent } from './support/repoFiles';

const TEXT = { de: 'Deutsch', en: 'English' };

function exercisesFile(networkPatch: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    exercises: [
      {
        id: 'gruppeA',
        title: TEXT,
        intro: TEXT,
        bounceEnabled: true,
        networks: [
          {
            id: 'A-NW1',
            index: 1,
            points: 2,
            title: TEXT,
            task: TEXT,
            checks: [
              {
                kind: 'after',
                id: 'A-NW1-stop',
                description: TEXT,
                trigger: { type: 'notaus', active: true },
                armWhile: 'trainMoving',
                expect: { type: 'trainStopped' },
                withinMs: 4000,
              },
              {
                kind: 'invariant',
                id: 'A-NW1-halt',
                description: TEXT,
                invariant: 'notausForcesStop',
              },
            ],
            scenario: [
              { atMs: 6000, action: 'notaus', active: false },
              { atMs: 2000, action: 'notaus', active: true },
            ],
            runTimeoutMs: 30000,
            ...networkPatch,
          },
        ],
      },
    ],
  };
}

describe('loadExercises', () => {
  it('parses a §7.3-shaped file', () => {
    const exercises = loadExercises(exercisesFile());
    expect(exercises).toHaveLength(1);
    const exercise = exercises[0];
    expect(exercise?.id).toBe('gruppeA');
    expect(exercise?.bounceEnabled).toBe(true);
    const network = exercise?.networks[0];
    expect(network?.id).toBe('A-NW1');
    expect(network?.checks).toHaveLength(2);
    expect(runTimeoutMsOf(network!)).toBe(30000);
  });

  it('sorts the scenario script by time (playback order must not depend on authoring order)', () => {
    const network = loadExercises(exercisesFile())[0]?.networks[0];
    expect(network?.scenario?.map((a) => [a.atMs, a.active])).toEqual([
      [2000, true],
      [6000, false],
    ]);
  });

  it('defaults the run timeout to 120 s when the network omits it', () => {
    const file = exercisesFile({ runTimeoutMs: undefined });
    const network = loadExercises(file)[0]?.networks[0];
    expect(network?.runTimeoutMs).toBeUndefined();
    expect(runTimeoutMsOf(network!)).toBe(DEFAULT_RUN_TIMEOUT_MS);
  });

  it('fills hints from the built-in library when the JSON has none', () => {
    const network = loadExercises(exercisesFile())[0]?.networks[0];
    expect(network?.hints.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(network?.hints[0]?.title.de).toBe(hintsForNetwork('A-NW1')[0]?.title.de);
  });

  it('lets hints in the JSON win over the library', () => {
    const file = exercisesFile({
      hints: [{ level: 1, title: TEXT, body: { de: 'eigener Hinweis', en: 'custom hint' } }],
    });
    const network = loadExercises(file)[0]?.networks[0];
    expect(network?.hints).toHaveLength(1);
    expect(network?.hints[0]?.body.en).toBe('custom hint');
  });

  it('accepts a custom hint library (injection point for tests and future exercises)', () => {
    const network = loadExercises(exercisesFile(), {
      hintLibrary: {
        'A-NW1': [{ level: 2, title: TEXT, body: TEXT }],
      },
    })[0]?.networks[0];
    expect(network?.hints.map((h) => h.level)).toEqual([2]);
  });

  describe('rejects invalid data', () => {
    it('wrong version', () => {
      expect(() => loadExercises({ version: 2, exercises: [] })).toThrow(/unsupported version/);
    });

    it('missing exercises', () => {
      expect(() => loadExercises({ version: 1, exercises: [] })).toThrow(/non-empty array/);
    });

    it('unknown keys (typo protection)', () => {
      const file = exercisesFile({ hint: [] });
      expect(() => loadExercises(file)).toThrow(/unknown key/);
    });

    it('missing localized text', () => {
      const file = exercisesFile({ task: { de: 'nur Deutsch' } });
      expect(() => loadExercises(file)).toThrow(/task\.en/);
    });

    it('duplicate network ids', () => {
      const file = exercisesFile() as {
        exercises: Array<{ networks: unknown[] }>;
      };
      const first = file.exercises[0];
      first?.networks.push(structuredClone(first.networks[0]));
      expect(() => loadExercises(file)).toThrow(/duplicate network id/);
    });

    it('duplicate check ids', () => {
      const file = exercisesFile({
        checks: [
          { kind: 'never', id: 'dup', description: TEXT, event: { type: 'derail' } },
          { kind: 'never', id: 'dup', description: TEXT, event: { type: 'bufferHit' } },
        ],
      });
      expect(() => loadExercises(file)).toThrow(/duplicate check id/);
    });

    it('unknown SimEvent type in a pattern', () => {
      const file = exercisesFile({
        checks: [{ kind: 'never', id: 'x', description: TEXT, event: { type: 'trainExploded' } }],
      });
      expect(() => loadExercises(file)).toThrow(/unknown SimEvent type/);
    });

    it('unknown invariant name', () => {
      const file = exercisesFile({
        checks: [{ kind: 'invariant', id: 'x', description: TEXT, invariant: 'noDerail' }],
      });
      expect(() => loadExercises(file)).toThrow(/expected one of/);
    });

    it('minDelayMs greater than withinMs', () => {
      const file = exercisesFile({
        checks: [
          {
            kind: 'after',
            id: 'x',
            description: TEXT,
            trigger: { type: 'trainStopped' },
            expect: { type: 'trainStarted' },
            withinMs: 1000,
            minDelayMs: 5000,
          },
        ],
      });
      expect(() => loadExercises(file)).toThrow(/must be <= withinMs/);
    });

    it('duration bounds in the wrong order', () => {
      const file = exercisesFile({
        checks: [
          {
            kind: 'never',
            id: 'x',
            description: TEXT,
            event: { type: 'switchPulse', minDurationMs: 900, maxDurationMs: 300 },
          },
        ],
      });
      expect(() => loadExercises(file)).toThrow(/must be <= maxDurationMs/);
    });

    it('hint levels out of order', () => {
      const file = exercisesFile({
        hints: [
          { level: 2, title: TEXT, body: TEXT },
          { level: 2, title: TEXT, body: TEXT },
        ],
      });
      expect(() => loadExercises(file)).toThrow(/unique and ascending/);
    });

    it('an unknown scenario action', () => {
      const file = exercisesFile({ scenario: [{ atMs: 0, action: 'derail', active: true }] });
      expect(() => loadExercises(file)).toThrow(/expected one of notaus/);
    });

    it('an empty seq event list', () => {
      const file = exercisesFile({
        checks: [{ kind: 'seq', id: 'x', description: TEXT, events: [] }],
      });
      expect(() => loadExercises(file)).toThrow(/non-empty array/);
    });
  });
});

describe('exercise browser data flow', () => {
  it('indexes networks and exercises for the tree view', () => {
    const exercises = loadExercises(exercisesFile());
    const index = buildExerciseIndex(exercises);
    expect(index.networkOrder).toEqual(['A-NW1']);
    expect(index.byNetworkId.get('A-NW1')?.exercise.id).toBe('gruppeA');
    expect(index.byExerciseId.get('gruppeA')?.networks).toHaveLength(1);
    expect(index.byNetworkId.get('nope')).toBeUndefined();
  });

  it('finds a network and sums the points', () => {
    const exercises = loadExercises(exercisesFile());
    expect(findNetwork(exercises, 'A-NW1')?.network.points).toBe(2);
    expect(findNetwork(exercises, 'B-NW1')).toBeNull();
    expect(totalPoints(exercises[0]!)).toBe(2);
  });

  it('reports hint deep links that do not resolve', () => {
    const exercises = loadExercises(
      exercisesFile({
        hints: [{ level: 1, title: TEXT, body: TEXT, exampleId: 'does-not-exist' }],
      }),
    );
    expect(missingExampleRefs(exercises, ['pump-selfhold'])).toEqual(['does-not-exist']);
    expect(missingExampleRefs(exercises, ['does-not-exist'])).toEqual([]);
  });
});

// ── examples ─────────────────────────────────────────────────────────────────────────────

function examplesFile(patch: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    examples: [
      {
        id: 'sv-pulse',
        category: 'timer',
        title: TEXT,
        body: TEXT,
        awl: 'U  E 1.1\nL  S5T#4S500MS\nSV T 2\n\nU  T 2\n=  A 0.2',
        source: 'Anleitung IV.2.6.2',
        ...patch,
      },
      {
        id: 'pump-selfhold',
        category: 'memory',
        title: TEXT,
        body: TEXT,
        awl: 'U    E    0.0\nS    M    0.0',
        source: 'Anleitung IV.2.5.6',
      },
    ],
  };
}

describe('loadExamples', () => {
  it('parses a §7.4-shaped file', () => {
    const examples = loadExamples(examplesFile());
    expect(examples.map((e) => e.id)).toEqual(['sv-pulse', 'pump-selfhold']);
    expect(examples[0]?.category).toBe('timer');
  });

  it('rejects a bad version, duplicate ids and unknown categories', () => {
    expect(() => loadExamples({ version: 7, examples: [] })).toThrow(/unsupported version/);
    expect(() => loadExamples(examplesFile({ id: 'pump-selfhold' }))).toThrow(/duplicate/);
    expect(() => loadExamples(examplesFile({ category: 'wizardry' }))).toThrow(/expected one of/);
    expect(() => loadExamples(examplesFile({ awl: '' }))).toThrow(/non-empty string/);
  });

  it('tolerates an absent file via loadExamplesOrEmpty', () => {
    expect(loadExamplesOrEmpty(null)).toEqual([]);
    expect(loadExamplesOrEmpty(undefined)).toEqual([]);
    expect(loadExamplesOrEmpty(examplesFile())).toHaveLength(2);
  });

  it('groups by category in display order, dropping empty groups', () => {
    const groups = groupExamplesByCategory(loadExamples(examplesFile()));
    expect(groups.map((g) => g.category)).toEqual(['memory', 'timer']);
    expect(EXAMPLE_CATEGORIES.indexOf('memory')).toBeLessThan(EXAMPLE_CATEGORIES.indexOf('timer'));
    expect(groups[0]?.title.de).toBe('Speicherfunktionen');
  });

  it('finds examples by id', () => {
    const examples = loadExamples(examplesFile());
    expect(findExample(examples, 'sv-pulse')?.category).toBe('timer');
    expect(findExample(examples, 'nope')).toBeNull();
  });

  it('builds a runnable editor buffer with provenance', () => {
    const example = loadExamples(examplesFile())[0]!;
    const source = exampleAsEditorSource(example, 'de');
    expect(source.split('\n')[0]).toBe('// Deutsch');
    expect(source.split('\n')[1]).toBe('// Anleitung IV.2.6.2');
    expect(source).toContain('SV T 2');
    expect(source.endsWith('\n')).toBe(true);
    expect(exampleLineCount(example)).toBe(5);
    expect(exampleAwlLines(example)[0]).toBe('U  E 1.1');
  });

  it('flags examples that leak plant symbols', () => {
    expect(examplesWithPlantSymbols(loadExamples(examplesFile()))).toEqual([]);
    const leaky = loadExamples(examplesFile({ awl: 'U "xR01A"\nS "Speed2GU"' }));
    expect(examplesWithPlantSymbols(leaky).map((e) => e.id)).toEqual(['sv-pulse']);
  });
});

// ── the real data files, once the data agent has authored them ────────────────────────────

const exercisesJson = readJsonIfPresent('src/data/exercises.json');
const examplesJson = readJsonIfPresent('src/data/examples.json');

describe.skipIf(exercisesJson === null)('src/data/exercises.json', () => {
  it('validates against the §7.3 schema', () => {
    const exercises = loadExercises(exercisesJson);
    expect(exercises.length).toBeGreaterThan(0);
    for (const exercise of exercises) {
      expect(exercise.networks.length).toBeGreaterThan(0);
      for (const network of exercise.networks) {
        expect(network.hints.length, `${network.id} hints`).toBeGreaterThan(0);
        expect(runTimeoutMsOf(network)).toBeGreaterThan(0);
      }
    }
  });

  it('uses network ids the hint library covers, so no network ships without hints', () => {
    const exercises = loadExercises(exercisesJson);
    const fileIds = exercises.flatMap((exercise) => exercise.networks.map((n) => n.id));
    for (const id of fileIds) {
      expect(HINT_LIBRARY_NETWORK_IDS, `hint library coverage of ${id}`).toContain(id);
    }
  });

  it('fills library hints wherever the file has none, and can prefer the library', () => {
    const merged = loadExercises(exercisesJson);
    for (const exercise of merged) {
      for (const network of exercise.networks) {
        expect(network.hints.map((h) => h.level), network.id).toEqual([1, 2, 3]);
      }
    }
    const libraryFirst = loadExercises(exercisesJson, { preferLibraryHints: true });
    const firstNetwork = libraryFirst[0]?.networks[0];
    expect(firstNetwork?.hints[0]?.title.de).toBe(hintsForNetwork(firstNetwork?.id ?? '')[0]?.title.de);
  });
});

describe.skipIf(examplesJson === null)('src/data/examples.json', () => {
  it('validates against the §7.4 schema and stays operand-neutral', () => {
    const examples = loadExamples(examplesJson);
    expect(examples.length).toBeGreaterThan(0);
    expect(examplesWithPlantSymbols(examples).map((e) => e.id)).toEqual([]);
  });
});
