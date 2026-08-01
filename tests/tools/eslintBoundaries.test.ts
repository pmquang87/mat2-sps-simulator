/**
 * The import-boundary config (.eslintrc.cjs) enforces ARCHITECTURE.md §2 — module bans
 * (rules 1/2/3/5, pump independence) and the no-deep-imports rule 7. History says why this
 * suite exists: the `!(index)` extglob form of rule 7 matched NOTHING under ESLint 8 for a
 * year while looking authoritative (recorded 2026-08-01). No silent dead rules: this suite
 * lints VIRTUAL probe files through the real ESLint engine and the real config, in both
 * directions per module — every ban must fire on a violating import, and every legitimate
 * import (module index, own-module internals) must stay clean. If a pattern goes dead or
 * overeager, a gate fails instead of a config comment lying.
 *
 * ESLint 8 ships no TypeScript types, hence the createRequire + minimal local interface.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface LintMessage {
  ruleId: string | null;
  message: string;
}
interface LintResult {
  messages: LintMessage[];
}
interface ESLintLike {
  lintText(code: string, options: { filePath: string }): Promise<LintResult[]>;
}
interface ESLintCtor {
  new (options: { cwd: string }): ESLintLike;
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

let eslint: ESLintLike;

beforeAll(async () => {
  const { ESLint } = require('eslint') as { ESLint: ESLintCtor };
  eslint = new ESLint({ cwd: repoRoot });
  // Warm-up: the FIRST lintText resolves the whole config chain, which takes seconds when
  // the full suite competes for CPU (the 5 s default timeout starves — same failure mode as
  // the consistLeadWindow ops note). Pay that cost here, under this hook's own budget.
  await eslint.lintText('', { filePath: join(repoRoot, 'src/__warmup__.ts') });
}, 60_000);

/** Rule ids that fired for `import {} from '<specifier>'` in a probe at `filePath`. */
async function lintImport(filePath: string, specifier: string): Promise<string[]> {
  const code = `import {} from '${specifier}';\n`;
  const results = await eslint.lintText(code, { filePath: join(repoRoot, filePath) });
  return (results[0]?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

interface Probe {
  /** Virtual file the import is linted as. */
  at: string;
  /** Import specifiers that MUST be flagged by no-restricted-imports. */
  flagged: string[];
  /** Import specifiers that MUST stay clean. */
  clean: string[];
}

/**
 * Both directions per module. `clean` entries are the controls that keep the bans from
 * going overeager (index imports, own-module internals); `flagged` entries are the
 * controls that keep them from going dead.
 */
const PROBES: readonly Probe[] = [
  {
    // Root scope (ui/, app/, src/main.ts): rule 7 for all seven module surfaces.
    at: 'src/__probe__.ts',
    flagged: [
      './core/emulator',
      './plant/train',
      './scene/labels',
      './ui/panels/WatchPanel',
      './app/SimCoordinator',
      './pedagogy/checks',
      './pump/model',
    ],
    clean: ['./core', './plant', './scene', './ui', './app', './pedagogy', './pump'],
  },
  {
    // ui/ files sit in root scope too — deep reach across modules must flag, intra-module
    // paths (i18n is INSIDE ui/) must not.
    at: 'src/ui/panels/__probe__.ts',
    flagged: ['../../core/exec', '../../app/EventBus'],
    clean: ['../../core', '../../app', '../i18n/i18n', '../dom'],
  },
  {
    // core/ imports nothing from other src/ modules (rule 1); own internals stay legal.
    at: 'src/core/__probe__.ts',
    flagged: ['../plant', '../plant/train', '../scene', '../ui', '../pump'],
    clean: ['./ast', './s5time'],
  },
  {
    // plant/: core index only (rule 2) — deep into core is new coverage (rule 7).
    at: 'src/plant/__probe__.ts',
    flagged: ['../core/address', '../scene', '../scene/labels', '../ui', '../pump'],
    clean: ['../core', './geometry'],
  },
  {
    // scene/: plant index only (rule 3) — deep into plant is new coverage (rule 7).
    at: 'src/scene/__probe__.ts',
    flagged: ['../plant/switches', '../core', '../core/emulator', '../ui', '../pump'],
    clean: ['../plant', './trackMesh'],
  },
  {
    // pedagogy/: core + plant indexes only (rule 5).
    at: 'src/pedagogy/__probe__.ts',
    flagged: ['../core/diagnostics', '../plant/reeds', '../scene', '../ui', '../pump'],
    clean: ['../core', '../plant', './progress'],
  },
  {
    // pump/ interior: core index only; even pump's OWN scene is index.ts's business.
    at: 'src/pump/__probe__.ts',
    flagged: ['../core/emulator', '../plant', '../scene', './scene', './scene/console'],
    clean: ['../core', './model'],
  },
  {
    // pump/index.ts: the ONE legal './scene' re-export; the railway's '../scene' and all
    // deep reaches stay banned.
    at: 'src/pump/index.ts',
    flagged: ['../scene', '../scene/labels', './scene/console', '../core/emulator', '../plant'],
    clean: ['./scene', '../core', './model'],
  },
  {
    // pump/scene/: may reach the railway scene INDEX (visual toolkit) and core's index,
    // nothing deeper, and never plant/ui/app/pedagogy/data.
    at: 'src/pump/scene/__probe__.ts',
    flagged: ['../../scene/labels', '../../core/emulator', '../../plant', '../../ui', '../../data/trackplan.json'],
    clean: ['../../scene', '../../core', './console'],
  },
];

describe('import-boundary config is alive in both directions (§2, incl. rule 7)', () => {
  for (const probe of PROBES) {
    describe(`probe at ${probe.at}`, () => {
      it('flags every banned import', { timeout: 15_000 }, async () => {
        for (const specifier of probe.flagged) {
          const rules = await lintImport(probe.at, specifier);
          expect(rules, `'${specifier}' from ${probe.at} must be flagged`).toContain(
            'no-restricted-imports',
          );
        }
      });

      it('keeps every legitimate import clean', { timeout: 15_000 }, async () => {
        for (const specifier of probe.clean) {
          const rules = await lintImport(probe.at, specifier);
          expect(rules, `'${specifier}' from ${probe.at} must lint clean`).toEqual([]);
        }
      });
    });
  }
});
