/**
 * tests/data/exercises.test.ts — exercises.json + examples.json schema validity and
 * cross-file consistency (ARCHITECTURE.md §7.3, §7.4, §9.3): all 2×11 networks with the
 * official German task text + EN translation, every referenced symbol/reed/switch exists,
 * documented text↔symbol mismatches are annotated via symbolNotes, hint texts obey the
 * §7.3 no-plant-operand guard, examples stay operand-neutral.
 *
 * Deliberately structural (no src/pedagogy import): the pedagogy loader is validated by
 * its own module tests; this suite must stay green independently of pedagogy's state.
 */
import { describe, expect, it } from 'vitest';
import exercisesJson from '../../src/data/exercises.json';
import examplesJson from '../../src/data/examples.json';
import trackplanJson from '../../src/data/trackplan.json';
import variablesJson from '../../src/data/variables.json';

interface Localized { de: string; en: string; }
interface Hint {
  level: number;
  title: Localized;
  body: Localized;
  anleitungRef?: { section: string; label: Localized };
  exampleId?: string;
}
interface Check {
  kind: string;
  id: string;
  description: Localized;
  events?: Array<Record<string, unknown>>;
  trigger?: Record<string, unknown>;
  expect?: Record<string, unknown>;
  event?: Record<string, unknown>;
  withinMs?: number;
  windowMs?: number;
  invariant?: string;
}
interface Network {
  id: string;
  index: number;
  points: number;
  title: Localized;
  task: Localized;
  symbolNotes?: Localized;
  hints?: Hint[];
  checks: Check[];
  scenario?: Array<{ atMs: number; action: string; active: boolean }>;
  runTimeoutMs?: number;
}
interface Exercise {
  id: string;
  title: Localized;
  intro: Localized;
  bounceEnabled: boolean;
  networks: Network[];
}

const exercises = exercisesJson.exercises as unknown as Exercise[];
const gruppeA = exercises.find((e) => e.id === 'gruppeA');
const gruppeB = exercises.find((e) => e.id === 'gruppeB');
const allNetworks = exercises.flatMap((e) => e.networks);

const symbols = new Set(variablesJson.entries.map((e) => e.symbol));
const switchIds = new Set(trackplanJson.switches.map((s) => s.id));
const wiredReeds = new Set(trackplanJson.reeds.filter((r) => r.wired).map((r) => r.id));

/** SimEvent type names (§5.3) — kept literal here so this suite has no src/ dependency. */
const SIM_EVENT_TYPES = new Set([
  'speedCommand', 'speedConflict', 'switchPulse', 'switchMoved', 'coilConflict', 'coilHeld',
  'switchTrailed', 'switchMovedUnderTrain', 'reedClosed', 'trainStopped', 'trainStarted',
  'segmentEntered', 'bufferHit', 'derail', 'notaus',
]);

/** Documented text↔symbol mismatches (solutions-independent: visible in the task txt). */
const TASK_TEXT_ALLOWLIST = new Set(['Speed2U', 'Speed1U', 'xR02BH02G3', 'xR01BH03G2', 'xW03CR']);

const nonEmpty = (t: Localized, what: string): void => {
  expect(t.de.trim(), `${what}.de`).not.toBe('');
  expect(t.en.trim(), `${what}.en`).not.toBe('');
};

describe('exercises.json structure', () => {
  it('has version 1 and the two Gruppen', () => {
    expect(exercisesJson.version).toBe(1);
    expect(exercises).toHaveLength(2);
    expect(gruppeA).toBeDefined();
    expect(gruppeB).toBeDefined();
  });

  it('Gruppe A: 11 networks, 27 points, bounce enabled (Entprellen exercise)', () => {
    expect(gruppeA!.bounceEnabled).toBe(true);
    expect(gruppeA!.networks.map((n) => n.id)).toEqual(
      Array.from({ length: 11 }, (_, i) => `A-NW${i + 1}`),
    );
    expect(gruppeA!.networks.map((n) => n.index)).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1),
    );
    expect(gruppeA!.networks.reduce((s, n) => s + n.points, 0)).toBe(27);
  });

  it('Gruppe B: 11 networks, 27 points, no bounce', () => {
    expect(gruppeB!.bounceEnabled).toBe(false);
    expect(gruppeB!.networks.map((n) => n.id)).toEqual(
      Array.from({ length: 11 }, (_, i) => `B-NW${i + 1}`),
    );
    expect(gruppeB!.networks.reduce((s, n) => s + n.points, 0)).toBe(27);
  });

  it('every network has bilingual title and task text', () => {
    for (const n of allNetworks) {
      nonEmpty(n.title, `${n.id}.title`);
      nonEmpty(n.task, `${n.id}.task`);
      expect(n.task.de.length, `${n.id} task.de should be the full official text`).toBeGreaterThan(60);
    }
  });

  it('anchor phrases of the official texts survived transcription', () => {
    const byId = new Map(allNetworks.map((n) => [n.id, n]));
    expect(byId.get('A-NW1')!.task.de).toContain('drahtbruchsicher'.slice(0, 0) + 'Drahtbruch');
    expect(byId.get('A-NW3')!.task.de).toContain('"xW01BH1G1G"');
    expect(byId.get('A-NW5')!.task.de).toContain('"xW03BH2G3G"');
    expect(byId.get('A-NW8')!.task.de).toContain('Entprellen');
    expect(byId.get('B-NW3')!.task.de).toContain('See-Kehre');
    expect(byId.get('B-NW4')!.task.de).toContain('"xW03CR"');
    expect(byId.get('B-NW5')!.task.de).toContain('Tunnels');
    expect(byId.get('B-NW7')!.task.de).toContain('"Speed1GU"');
  });
});

describe('symbol references in task texts', () => {
  it('every quoted plant symbol exists in variables.json or is an annotated mismatch', () => {
    for (const n of allNetworks) {
      const tokens = [...n.task.de.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1]!);
      for (const token of tokens) {
        if (TASK_TEXT_ALLOWLIST.has(token)) {
          expect(n.symbolNotes, `${n.id}: mismatch token "${token}" needs symbolNotes`).toBeDefined();
          continue;
        }
        expect(symbols.has(token), `${n.id}: unknown symbol "${token}" in task text`).toBe(true);
      }
    }
  });

  it('the documented mismatch tokens appear exactly where expected', () => {
    const withNotes = allNetworks.filter((n) => n.symbolNotes !== undefined).map((n) => n.id);
    expect(withNotes.sort()).toEqual(['A-NW5', 'A-NW6', 'B-NW4', 'B-NW5', 'B-NW6'].sort());
    const nw4 = allNetworks.find((n) => n.id === 'B-NW4')!;
    // the case trap: task text writes xW03CR, the symbol table has XW03CR only
    expect(symbols.has('xW03CR')).toBe(false);
    expect(symbols.has('XW03CR')).toBe(true);
    expect(nw4.symbolNotes!.de).toContain('XW03CR');
  });
});

describe('checks', () => {
  it('are well-formed with globally unique ids and known event types', () => {
    const seen = new Set<string>();
    for (const n of allNetworks) {
      expect(n.checks.length, `${n.id} has at least one check`).toBeGreaterThan(0);
      for (const c of n.checks) {
        expect(['seq', 'after', 'never', 'invariant'], `${n.id}/${c.id} kind`).toContain(c.kind);
        expect(seen.has(c.id), `duplicate check id ${c.id}`).toBe(false);
        seen.add(c.id);
        nonEmpty(c.description, `${n.id}/${c.id}.description`);
        const patterns: Array<Record<string, unknown>> = [
          ...(c.events ?? []),
          ...(c.trigger ? [c.trigger] : []),
          ...(c.expect ? [c.expect] : []),
          ...(c.event ? [c.event] : []),
        ];
        if (c.kind === 'seq') expect(c.events!.length).toBeGreaterThan(0);
        if (c.kind === 'after') {
          expect(c.trigger).toBeDefined();
          expect(c.expect).toBeDefined();
          expect(c.withinMs).toBeGreaterThan(0);
        }
        if (c.kind === 'invariant') {
          expect(['exclusiveSpeedBit', 'noCoilHeld', 'notausForcesStop']).toContain(c.invariant);
        }
        for (const p of patterns) {
          expect(SIM_EVENT_TYPES.has(p['type'] as string), `${c.id}: event type ${String(p['type'])}`).toBe(true);
          if (p['switchId'] !== undefined) {
            expect(switchIds.has(p['switchId'] as string), `${c.id}: switch ${String(p['switchId'])}`).toBe(true);
          }
          if (p['reedId'] !== undefined) {
            expect(wiredReeds.has(p['reedId'] as string), `${c.id}: wired reed ${String(p['reedId'])}`).toBe(true);
          }
        }
      }
    }
  });

  it('every commanded coil of the task text has a matching switchPulse check', () => {
    for (const n of allNetworks) {
      const commanded = [...n.task.de.matchAll(/"([xX]W[A-Za-z0-9]+)([GR])"/g)]
        // skip the naming-convention example present in the intro notes of NW3
        .filter((m) => !n.task.de.includes(`Beispiel:\t"${m[1]}${m[2]}"`))
        .map((m) => ({ base: m[1]!, coil: m[2]! }));
      for (const { base, coil } of commanded) {
        // normalize the two uppercase-X trap spellings to the switch id
        const id = `x${base.slice(1)}`;
        if (!switchIds.has(id)) continue; // e.g. the example "xW02BH1G4R" in the notes
        const hasPulseCheck = n.checks.some(
          (c) => c.kind === 'seq'
            && c.events!.some((e) => e['type'] === 'switchPulse' && e['switchId'] === id && e['coil'] === coil),
        );
        expect(hasPulseCheck, `${n.id}: no switchPulse check for ${id}${coil}`).toBe(
          // xW02BH1G4R appears in A-NW3/B-NW3 only as the naming example
          n.id === 'A-NW3' && id === 'xW02BH1G4' ? false : true,
        );
      }
    }
  });

  it('scenarios are ordered and only use the notaus action', () => {
    for (const n of allNetworks) {
      for (const [i, a] of (n.scenario ?? []).entries()) {
        expect(a.action).toBe('notaus');
        expect(a.atMs).toBeGreaterThanOrEqual(0);
        if (i > 0) expect(a.atMs).toBeGreaterThanOrEqual(n.scenario![i - 1]!.atMs);
      }
    }
  });
});

describe('hints (§7.3 guard: no plant/system operands)', () => {
  // Forbidden patterns per §7.3 — system bytes M 100–119, M 120/121, plant symbols,
  // Speed bits; STOP only inside fenced awl blocks. Neutral student operands
  // (E 0.x, M 10.x–M 20.x, T 1x) must pass.
  const forbidden: ReadonlyArray<[RegExp, string]> = [
    [/\bM\s*1[01]\d\b/, 'system byte M 100–119'],
    [/\bM\s*12[01]\b/, 'M 120/M 121'],
    [/\bxW\w*/, 'switch symbol'],
    [/\bxR\w*/, 'reed symbol'],
    [/XW03CR/, 'case-trap symbol'],
    [/XW05BH1G3R/, 'case-trap symbol'],
    [/\bSpeed[123](IU|GU)\b/, 'speed symbol'],
  ];
  const awlBlocks = (text: string): string[] =>
    [...text.matchAll(/```awl([\s\S]*?)```/g)].map((m) => m[1]!);

  it('inline hints pass the forbidden-operand scan (A-NW1/B-NW1 fixtures)', () => {
    const withHints = allNetworks.filter((n) => (n.hints ?? []).length > 0);
    expect(withHints.map((n) => n.id).sort()).toEqual(['A-NW1', 'B-NW1']);
    for (const n of withHints) {
      const levels = n.hints!.map((h) => h.level);
      expect(levels).toEqual([1, 2, 3]);
      for (const h of n.hints!) {
        nonEmpty(h.title, `${n.id} hint ${h.level} title`);
        nonEmpty(h.body, `${n.id} hint ${h.level} body`);
        for (const text of [h.body.de, h.body.en]) {
          for (const [re, what] of forbidden) {
            expect(re.test(text), `${n.id} hint ${h.level}: ${what}`).toBe(false);
          }
          for (const block of awlBlocks(text)) {
            expect(/\bSTOP\b/.test(block), `${n.id} hint ${h.level}: STOP in awl block`).toBe(false);
          }
        }
      }
    }
  });
});

describe('examples.json (§7.4)', () => {
  const CATEGORIES = new Set(['binary', 'memory', 'timer', 'edge', 'counter', 'compare', 'jump', 'pattern']);
  const examples = examplesJson.examples;

  it('has version 1 and the planned breadth (>= 12 examples, unique ids)', () => {
    expect(examplesJson.version).toBe(1);
    expect(examples.length).toBeGreaterThanOrEqual(12);
    expect(new Set(examples.map((e) => e.id)).size).toBe(examples.length);
  });

  it('every example is complete and categorized', () => {
    for (const e of examples) {
      expect(CATEGORIES.has(e.category), `${e.id} category`).toBe(true);
      nonEmpty(e.title as Localized, `${e.id}.title`);
      nonEmpty(e.body as Localized, `${e.id}.body`);
      expect(e.awl.trim()).not.toBe('');
      expect(e.source.trim()).not.toBe('');
    }
  });

  it('covers the Anleitung core: pump logic, all five timers, edges, jumps, the SV route template', () => {
    const ids = new Set(examples.map((e) => e.id));
    for (const required of [
      'pump-selfhold', 'timer-si', 'sv-pulse', 'timer-se', 'timer-ss', 'timer-sa',
      'fp-pulse', 'jump-cascade', 'weichenstrasse-template', 'debounce-lockout',
    ]) {
      expect(ids.has(required), required).toBe(true);
    }
    const bySrc = examples.filter((e) => e.source.startsWith('Anleitung'));
    expect(bySrc.length).toBeGreaterThanOrEqual(8);
  });

  it('all snippets stay operand-neutral (no plant symbols, §7.4)', () => {
    const plantSymbol = /\b(xW\w*|xR\w*|Speed[123](IU|GU))\b|XW03CR|XW05BH1G3R/;
    for (const e of examples) {
      expect(plantSymbol.test(e.awl), `${e.id} awl`).toBe(false);
    }
  });
});
