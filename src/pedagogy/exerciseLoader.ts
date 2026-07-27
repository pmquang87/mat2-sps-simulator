/**
 * exercises.json → validated ExerciseSpec[] (ARCHITECTURE.md §5.5, schema §7.3), plus the
 * lookup structures the exercise browser needs (§10.1).
 *
 * Hint content: `hints` may be omitted or empty in the JSON — the loader then fills the
 * network's hints from the built-in bilingual hint library (`hintLibrary.ts`), which is the
 * authoring home of the §7/§10.2 hint content inside this module. By default hints present in
 * the JSON win, so `src/data/exercises.json` can override any network; pass
 * `preferLibraryHints: true` to invert that. Either way the result is validated and can be
 * leak-scanned with `networkHintLeakViolations` (hints.ts).
 */
import { isSimEventType } from './behaviorCheck';
import { HINT_LIBRARY } from './hintLibrary';
import type {
  BehaviorCheck,
  EventPattern,
  ExerciseSpec,
  HintSpec,
  NetworkSpec,
  ScenarioAction,
} from './types';
import {
  asArray,
  asBoolean,
  asInt,
  asLocalizedText,
  asNonEmptyArray,
  asOptionalInt,
  asOptionalLocalizedText,
  asOptionalString,
  asRecord,
  asString,
  fail,
  noExtraKeys,
  oneOf,
} from './validate';

export const EXERCISES_FILE_VERSION = 1;
/** §5.5: check runs end at `runTimeoutMs`, default 120 s. */
export const DEFAULT_RUN_TIMEOUT_MS = 120_000;

export function runTimeoutMsOf(network: NetworkSpec): number {
  return network.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
}

export interface LoadExercisesOptions {
  /** Fallback hint content per network id. Defaults to the built-in library. */
  hintLibrary?: Readonly<Record<string, readonly HintSpec[]>>;
  /**
   * Default (false): hints authored in the JSON win, the library only fills gaps — the data
   * file stays authoritative. Set true to prefer the built-in library wherever it covers the
   * network, e.g. to keep one authoring voice across all networks.
   */
  preferLibraryHints?: boolean;
}

export function loadExercises(json: unknown, opts?: LoadExercisesOptions): ExerciseSpec[] {
  const library = opts?.hintLibrary ?? HINT_LIBRARY;
  const preferLibrary = opts?.preferLibraryHints ?? false;
  const root = asRecord(json, 'exercises.json');
  noExtraKeys(root, 'exercises.json', ['version', 'exercises']);
  const version = asInt(root['version'], 'exercises.json.version');
  if (version !== EXERCISES_FILE_VERSION) {
    fail(
      'exercises.json.version',
      `unsupported version ${version} (expected ${EXERCISES_FILE_VERSION})`,
    );
  }

  const rawExercises = asNonEmptyArray(root['exercises'], 'exercises.json.exercises');
  const out: ExerciseSpec[] = [];
  const seenExerciseIds = new Set<string>();
  const seenNetworkIds = new Set<string>();

  rawExercises.forEach((rawExercise, i) => {
    const path = `exercises[${i}]`;
    const rec = asRecord(rawExercise, path);
    noExtraKeys(rec, path, ['id', 'title', 'intro', 'bounceEnabled', 'networks']);
    const id = asString(rec['id'], `${path}.id`);
    if (seenExerciseIds.has(id)) fail(`${path}.id`, `duplicate exercise id "${id}"`);
    seenExerciseIds.add(id);

    const rawNetworks = asNonEmptyArray(rec['networks'], `${path}.networks`);
    const networks = rawNetworks.map((rawNetwork, j) =>
      parseNetwork(rawNetwork, `${path}.networks[${j}]`, library, preferLibrary, seenNetworkIds),
    );

    out.push({
      id,
      title: asLocalizedText(rec['title'], `${path}.title`),
      intro: asLocalizedText(rec['intro'], `${path}.intro`),
      bounceEnabled: asBoolean(rec['bounceEnabled'], `${path}.bounceEnabled`),
      networks,
    });
  });

  return out;
}

function parseNetwork(
  raw: unknown,
  path: string,
  library: Readonly<Record<string, readonly HintSpec[]>>,
  preferLibrary: boolean,
  seenNetworkIds: Set<string>,
): NetworkSpec {
  const rec = asRecord(raw, path);
  noExtraKeys(rec, path, [
    'id',
    'index',
    'points',
    'title',
    'task',
    'symbolNotes',
    'hints',
    'checks',
    'scenario',
    'runTimeoutMs',
  ]);
  const id = asString(rec['id'], `${path}.id`);
  if (seenNetworkIds.has(id)) fail(`${path}.id`, `duplicate network id "${id}"`);
  seenNetworkIds.add(id);

  const rawHints = rec['hints'];
  const jsonHints =
    rawHints === undefined
      ? []
      : asArray(rawHints, `${path}.hints`).map((h, k) => parseHint(h, `${path}.hints[${k}]`));
  const libraryHints = [...(library[id] ?? [])];
  const hints =
    preferLibrary && libraryHints.length > 0
      ? libraryHints
      : jsonHints.length > 0
        ? jsonHints
        : libraryHints;
  assertHintLevels(hints, `${path}.hints`);

  const network: NetworkSpec = {
    id,
    index: asInt(rec['index'], `${path}.index`, 1),
    points: asInt(rec['points'], `${path}.points`, 0),
    title: asLocalizedText(rec['title'], `${path}.title`),
    task: asLocalizedText(rec['task'], `${path}.task`),
    hints,
    checks: parseChecks(rec['checks'], `${path}.checks`),
  };

  const symbolNotes = asOptionalLocalizedText(rec['symbolNotes'], `${path}.symbolNotes`);
  if (symbolNotes !== undefined) network.symbolNotes = symbolNotes;

  const rawScenario = rec['scenario'];
  if (rawScenario !== undefined) {
    network.scenario = parseScenario(rawScenario, `${path}.scenario`);
  }

  const runTimeoutMs = asOptionalInt(rec['runTimeoutMs'], `${path}.runTimeoutMs`, 1);
  if (runTimeoutMs !== undefined) network.runTimeoutMs = runTimeoutMs;

  return network;
}

function parseHint(raw: unknown, path: string): HintSpec {
  const rec = asRecord(raw, path);
  noExtraKeys(rec, path, ['level', 'title', 'body', 'anleitungRef', 'exampleId']);
  const level = asInt(rec['level'], `${path}.level`, 1);
  if (level !== 1 && level !== 2 && level !== 3) fail(`${path}.level`, 'expected 1 | 2 | 3');
  const hint: HintSpec = {
    level,
    title: asLocalizedText(rec['title'], `${path}.title`),
    body: asLocalizedText(rec['body'], `${path}.body`),
  };
  const rawRef = rec['anleitungRef'];
  if (rawRef !== undefined) {
    const refPath = `${path}.anleitungRef`;
    const refRec = asRecord(rawRef, refPath);
    noExtraKeys(refRec, refPath, ['section', 'label']);
    hint.anleitungRef = {
      section: asString(refRec['section'], `${refPath}.section`),
      label: asLocalizedText(refRec['label'], `${refPath}.label`),
    };
  }
  const exampleId = asOptionalString(rec['exampleId'], `${path}.exampleId`);
  if (exampleId !== undefined) hint.exampleId = exampleId;
  return hint;
}

/** Levels must be unique and ascending — the HintPanel reveals them in order (§10.2). */
function assertHintLevels(hints: readonly HintSpec[], path: string): void {
  let previous = 0;
  hints.forEach((hint, i) => {
    if (hint.level <= previous) {
      fail(`${path}[${i}].level`, `hint levels must be unique and ascending (got ${hint.level})`);
    }
    previous = hint.level;
  });
}

function parseChecks(raw: unknown, path: string): BehaviorCheck[] {
  const arr = asArray(raw, path);
  const seen = new Set<string>();
  return arr.map((rawCheck, i) => {
    const checkPath = `${path}[${i}]`;
    const check = parseCheck(rawCheck, checkPath);
    if (seen.has(check.id)) fail(`${checkPath}.id`, `duplicate check id "${check.id}"`);
    seen.add(check.id);
    return check;
  });
}

function parseCheck(raw: unknown, path: string): BehaviorCheck {
  const rec = asRecord(raw, path);
  const kind = oneOf(rec['kind'], `${path}.kind`, ['seq', 'after', 'never', 'invariant'] as const);
  const id = asString(rec['id'], `${path}.id`);
  const description = asLocalizedText(rec['description'], `${path}.description`);

  switch (kind) {
    case 'seq': {
      noExtraKeys(rec, path, ['kind', 'id', 'description', 'events', 'windowMs']);
      const events = asNonEmptyArray(rec['events'], `${path}.events`).map((e, i) =>
        parseEventPattern(e, `${path}.events[${i}]`),
      );
      const check: Extract<BehaviorCheck, { kind: 'seq' }> = { kind, id, description, events };
      const windowMs = asOptionalInt(rec['windowMs'], `${path}.windowMs`, 1);
      if (windowMs !== undefined) check.windowMs = windowMs;
      return check;
    }
    case 'after': {
      noExtraKeys(rec, path, [
        'kind',
        'id',
        'description',
        'trigger',
        'expect',
        'withinMs',
        'minDelayMs',
        'armWhile',
      ]);
      const check: Extract<BehaviorCheck, { kind: 'after' }> = {
        kind,
        id,
        description,
        trigger: parseEventPattern(rec['trigger'], `${path}.trigger`),
        expect: parseEventPattern(rec['expect'], `${path}.expect`),
        withinMs: asInt(rec['withinMs'], `${path}.withinMs`, 1),
      };
      const minDelayMs = asOptionalInt(rec['minDelayMs'], `${path}.minDelayMs`, 0);
      if (minDelayMs !== undefined) {
        if (minDelayMs > check.withinMs) {
          fail(`${path}.minDelayMs`, `must be <= withinMs (${check.withinMs})`);
        }
        check.minDelayMs = minDelayMs;
      }
      if (rec['armWhile'] !== undefined) {
        check.armWhile = oneOf(rec['armWhile'], `${path}.armWhile`, [
          'trainMoving',
          'trainStationary',
        ] as const);
      }
      return check;
    }
    case 'never': {
      noExtraKeys(rec, path, ['kind', 'id', 'description', 'event']);
      return {
        kind,
        id,
        description,
        event: parseEventPattern(rec['event'], `${path}.event`),
      };
    }
    case 'invariant': {
      noExtraKeys(rec, path, ['kind', 'id', 'description', 'invariant']);
      return {
        kind,
        id,
        description,
        invariant: oneOf(rec['invariant'], `${path}.invariant`, [
          'exclusiveSpeedBit',
          'noCoilHeld',
          'notausForcesStop',
        ] as const),
      };
    }
  }
}

function parseEventPattern(raw: unknown, path: string): EventPattern {
  const rec = asRecord(raw, path);
  noExtraKeys(rec, path, [
    'type',
    'switchId',
    'coil',
    'reedId',
    'nodeId',
    'edgeId',
    'active',
    'level',
    'direction',
    'minDurationMs',
    'maxDurationMs',
  ]);
  const type = rec['type'];
  if (!isSimEventType(type)) fail(`${path}.type`, 'unknown SimEvent type');
  const pattern: EventPattern = { type };

  const switchId = asOptionalString(rec['switchId'], `${path}.switchId`);
  if (switchId !== undefined) pattern.switchId = switchId;
  if (rec['coil'] !== undefined) {
    pattern.coil = oneOf(rec['coil'], `${path}.coil`, ['G', 'R'] as const);
  }
  const reedId = asOptionalString(rec['reedId'], `${path}.reedId`);
  if (reedId !== undefined) pattern.reedId = reedId;
  const nodeId = asOptionalString(rec['nodeId'], `${path}.nodeId`);
  if (nodeId !== undefined) pattern.nodeId = nodeId;
  const edgeId = asOptionalString(rec['edgeId'], `${path}.edgeId`);
  if (edgeId !== undefined) pattern.edgeId = edgeId;
  if (rec['active'] !== undefined) {
    pattern.active = asBoolean(rec['active'], `${path}.active`);
  }
  if (rec['level'] !== undefined) {
    const level = asInt(rec['level'], `${path}.level`, 0);
    if (level > 3) fail(`${path}.level`, 'expected 0 | 1 | 2 | 3');
    pattern.level = level as 0 | 1 | 2 | 3;
  }
  if (rec['direction'] !== undefined) {
    pattern.direction = oneOf(rec['direction'], `${path}.direction`, [
      'IU',
      'GU',
      'STOP',
    ] as const);
  }
  const minDurationMs = asOptionalInt(rec['minDurationMs'], `${path}.minDurationMs`, 0);
  if (minDurationMs !== undefined) pattern.minDurationMs = minDurationMs;
  const maxDurationMs = asOptionalInt(rec['maxDurationMs'], `${path}.maxDurationMs`, 0);
  if (maxDurationMs !== undefined) pattern.maxDurationMs = maxDurationMs;
  if (
    pattern.minDurationMs !== undefined &&
    pattern.maxDurationMs !== undefined &&
    pattern.minDurationMs > pattern.maxDurationMs
  ) {
    fail(`${path}.minDurationMs`, `must be <= maxDurationMs (${pattern.maxDurationMs})`);
  }
  return pattern;
}

function parseScenario(raw: unknown, path: string): ScenarioAction[] {
  const arr = asArray(raw, path);
  const actions = arr.map((rawAction, i) => {
    const actionPath = `${path}[${i}]`;
    const rec = asRecord(rawAction, actionPath);
    noExtraKeys(rec, actionPath, ['atMs', 'action', 'active']);
    oneOf(rec['action'], `${actionPath}.action`, ['notaus'] as const);
    const action: ScenarioAction = {
      atMs: asInt(rec['atMs'], `${actionPath}.atMs`, 0),
      action: 'notaus',
      active: asBoolean(rec['active'], `${actionPath}.active`),
    };
    return action;
  });
  // The coordinator plays actions in list order (§5.2 loadScenario); sort so authoring order
  // cannot change playback. Stable sort keeps same-timestamp actions in authored order.
  return actions
    .map((action, i) => ({ action, i }))
    .sort((a, b) => a.action.atMs - b.action.atMs || a.i - b.i)
    .map((entry) => entry.action);
}

// ───────────────────────────── browser data flow (§10.1) ──────────────────────────────────

export interface NetworkLocation {
  exercise: ExerciseSpec;
  network: NetworkSpec;
}

/** Flat lookup structures for the exercise tree: exercise → networks, id → network. */
export interface ExerciseIndex {
  exercises: readonly ExerciseSpec[];
  /** Network id → its network and owning exercise. */
  byNetworkId: ReadonlyMap<string, NetworkLocation>;
  /** Exercise id → exercise. */
  byExerciseId: ReadonlyMap<string, ExerciseSpec>;
  /** Network ids in document order — the browser's navigation order. */
  networkOrder: readonly string[];
}

export function buildExerciseIndex(exercises: readonly ExerciseSpec[]): ExerciseIndex {
  const byNetworkId = new Map<string, NetworkLocation>();
  const byExerciseId = new Map<string, ExerciseSpec>();
  const networkOrder: string[] = [];
  for (const exercise of exercises) {
    byExerciseId.set(exercise.id, exercise);
    for (const network of exercise.networks) {
      byNetworkId.set(network.id, { exercise, network });
      networkOrder.push(network.id);
    }
  }
  return { exercises, byNetworkId, byExerciseId, networkOrder };
}

export function findNetwork(
  exercises: readonly ExerciseSpec[],
  networkId: string,
): NetworkLocation | null {
  for (const exercise of exercises) {
    for (const network of exercise.networks) {
      if (network.id === networkId) return { exercise, network };
    }
  }
  return null;
}

export function totalPoints(exercise: ExerciseSpec): number {
  return exercise.networks.reduce((sum, network) => sum + network.points, 0);
}

/** Ids referenced by hints that are missing from the examples library (§10.2 deep links). */
export function missingExampleRefs(
  exercises: readonly ExerciseSpec[],
  exampleIds: Iterable<string>,
): string[] {
  const known = new Set<string>(exampleIds);
  const missing = new Set<string>();
  for (const exercise of exercises) {
    for (const network of exercise.networks) {
      for (const hint of network.hints) {
        if (hint.exampleId !== undefined && !known.has(hint.exampleId)) {
          missing.add(hint.exampleId);
        }
      }
    }
  }
  return [...missing];
}
