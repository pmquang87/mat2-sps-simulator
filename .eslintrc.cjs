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
                group: ['**/plant', '**/plant/**', '**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**'],
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
                group: ['**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**'],
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
                group: ['**/core', '**/core/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/pedagogy', '**/pedagogy/**', '**/data', '**/data/**'],
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
                group: ['**/scene', '**/scene/**', '**/ui', '**/ui/**', '**/app', '**/app/**', '**/data', '**/data/**'],
                message: 'pedagogy/ imports core/ + plant/ types only (ARCHITECTURE.md §2 rule 5).',
              },
            ],
          },
        ],
      },
    },
    {
      // §6.3 determinism: no wall clock, no ambient randomness in the pure modules.
      files: ['src/core/**/*.ts', 'src/plant/**/*.ts'],
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
