/**
 * Import-boundary rules from ARCHITECTURE.md §2 (data-flow rules) and §6.3 (determinism).
 *
 *   1. core/  imports nothing from other src/ modules.
 *   2. plant/ imports only core/ *types* (BitAddress for reed wiring).
 *   3. scene/ imports plant/ types only — never mutates plant.
 *   4. ui/ and app/ may import public APIs (index.ts) of everything.
 *   5. pedagogy/ imports core/ + plant/ types and the SimEvent union.
 *   7. Deep imports are forbidden — every module exposes its surface via src/<module>/index.ts.
 *
 * Determinism (§6.3): core/ and plant/ never call Date.now, performance.now, Math.random,
 * or requestAnimationFrame. The sole randomness source is plant/random.ts (seeded mulberry32).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { browser: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/', 'Claude_work/'],
  rules: {
    // §2 rule 7: no deep imports into other modules — import the module index instead.
    //
    // MEASURED CAVEAT (do not assume this block is enforcing anything): ESLint 8 matches
    // `no-restricted-imports` patterns with the `ignore` package, which does NOT understand
    // the extglob `!(index)`. A probe file importing `./pump/model` and `./scene/labels` was
    // reported clean, while a plain `../scene` in the same run was flagged — so the linter is
    // alive and the `!(index)` form specifically matches nothing. The `pump` entry was
    // removed rather than left as decoration; the rest are pre-existing and are recorded as an
    // open item in docs/HANDOFF.md. Until they are replaced, §2 rule 7 is a review rule.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/core/!(index)',
              '**/plant/!(index)',
              '**/scene/!(index)',
              '**/ui/!(index)',
              '**/app/!(index)',
              '**/pedagogy/!(index)',
            ],
            message:
              'Deep imports are forbidden (ARCHITECTURE.md §2 rule 7) — import from the module index.ts.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Coverage entry, no rule changes. ESLint 8 expands a DIRECTORY argument with the
      // `--ext` list (default: .js only) PLUS every `overrides[].files` pattern. Without this
      // entry `npx eslint src tests tools` would lint neither src/app, src/ui and src/main.ts
      // nor tools/ (and would abort on "tools" as an unmatched pattern), i.e. the directory
      // form of the gate would cover less than the `npm run lint` script, whose explicit
      // globs are the authoritative gate.
      files: ['src/**/*.ts', 'tools/**/*.ts'],
      rules: {},
    },
    {
      // §2 rule 1: core/ imports nothing from other src/ modules.
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/plant', '**/plant/**', '**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**', '**/pump', '**/pump/**'],
                message: 'core/ imports nothing from other src/ modules (ARCHITECTURE.md §2 rule 1).',
              },
            ],
          },
        ],
      },
    },
    {
      // §2 rule 2: plant/ imports only core/ types.
      files: ['src/plant/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**', '**/pump', '**/pump/**'],
                message: 'plant/ imports only core/ types (ARCHITECTURE.md §2 rule 2).',
              },
            ],
          },
        ],
      },
    },
    {
      // §2 rule 3: scene/ imports plant/ types only.
      files: ['src/scene/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/core', '**/core/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**', '**/pump', '**/pump/**'],
                message: 'scene/ imports plant/ types only (ARCHITECTURE.md §2 rule 3).',
              },
            ],
          },
        ],
      },
    },
    {
      // §2 rule 5: pedagogy/ imports core/ + plant/ types and the SimEvent union — no DOM.
      files: ['src/pedagogy/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/data', '**/data/**', '**/pump', '**/pump/**'],
                message: 'pedagogy/ imports core/ + plant/ types only (ARCHITECTURE.md §2 rule 5).',
              },
            ],
          },
        ],
      },
    },
    {
      // Second experiment: pump/ is a self-contained plant layer + its own coordinator. It
      // imports core/ (emulator, SymbolTable) and nothing else from src/ — in particular not
      // plant/, so the two experiments cannot entangle.
      files: ['src/pump/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/plant', '**/plant/**', '**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**'],
                message: 'pump/ imports core/ only — the two experiments stay independent.',
              },
            ],
          },
        ],
      },
    },
    {
      // The pump barrel re-exports its OWN renderer (`./scene`) so nothing outside pump/
      // needs a deep import (§2 rule 7). That is the single legitimate `scene` reference
      // inside pump/ — the RAILWAY's scene/ (which from here is `../scene`) stays shut, and
      // so does everything else. Must stay AFTER the src/pump/** block to win.
      files: ['src/pump/index.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/plant', '**/plant/**', '../scene', '../scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**'],
                message: 'pump/ imports core/ only — the two experiments stay independent.',
              },
            ],
          },
        ],
      },
    },
    {
      // src/pump/scene/** is the ONE part of pump/ that renders. It is allowed to reach
      // scene/'s public index — it reuses the railway's visual toolkit (LabelFactory,
      // deconflictPlates, SceneQuality) rather than forking it — and it may of course use
      // Three.js and the DOM. Everything else stays shut: it must not see plant/, ui/,
      // app/, pedagogy/ or data/, so the two experiments still cannot entangle.
      files: ['src/pump/scene/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/core/!(index)',
                  '**/scene/!(index)',
                  '**/plant',
                  '**/plant/**',
                  '**/ui',
                  '**/ui/**',
                  '**/app',
                  '**/app/**',
                  '**/pedagogy',
                  '**/pedagogy/**',
                  '**/data',
                  '**/data/**',
                ],
                message:
                  'pump/scene may import three/ and the scene index only (ARCHITECTURE.md §2 rule 7).',
              },
            ],
          },
        ],
      },
    },
    {
      // §6.3 determinism: no wall clock, no ambient randomness in the pure modules.
      files: ['src/core/**/*.ts', 'src/plant/**/*.ts', 'src/pump/**/*.ts'],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'requestAnimationFrame', message: 'No DOM/wall-clock below app/ (ARCHITECTURE.md §6.3).' },
          { name: 'performance', message: 'No wall clock in core/plant (ARCHITECTURE.md §6.3).' },
        ],
        'no-restricted-properties': [
          'error',
          { object: 'Math', property: 'random', message: 'Use the seeded PRNG in plant/random.ts (ARCHITECTURE.md §6.3).' },
          { object: 'Date', property: 'now', message: 'No wall clock in core/plant (ARCHITECTURE.md §6.3).' },
          { object: 'performance', property: 'now', message: 'No wall clock in core/plant (ARCHITECTURE.md §6.3).' },
        ],
      },
    },
    {
      // The pump scene's dev harness is the HOST of its own little app (nothing imports it,
      // it never reaches dist/), so it owns a rAF loop and a wall clock exactly like
      // app/RafDriver does for the shipped shell. Must stay AFTER the §6.3 block to win.
      files: ['src/pump/scene/dev/**/*.ts'],
      rules: {
        'no-restricted-globals': 'off',
        'no-restricted-properties': 'off',
      },
    },
    {
      // Tests are allowed to reach a single module file directly: unit tests pin the
      // behaviour of individual units (a tokenizer, a clock, one dictionary), which the
      // module index deliberately does not expose separately. The §2 rule 7 boundary is
      // about src/ → src/ coupling; tests import nothing into the shipped bundle.
      files: ['tests/**/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
