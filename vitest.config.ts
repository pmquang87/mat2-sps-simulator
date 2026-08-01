import { defineConfig } from 'vitest/config';

/**
 * Test config (ARCHITECTURE.md §3): node environment for core/plant/app/pedagogy/data —
 * they are pure logic with no DOM. Individual test files that genuinely need a DOM opt in
 * with a `// @vitest-environment jsdom` pragma (none in M1).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The heaviest plant-driving tests (consist push-back, OccupiedPath lead window) run
    // thousands of physics steps and take ~1 s ALONE — under the fully parallel run on a
    // loaded machine (or a 2-core CI runner) the default 5 s budget left no headroom, and
    // whichever heavy test drew the busiest worker timed out while its assertions held.
    // 30 s is pure headroom: a green suite is exactly as fast as before, only a genuine
    // hang takes longer to be killed.
    testTimeout: 30_000,
    // Under CI (the public repo has no reference/, so the oracle and course-file suites
    // skip by design) every run also writes a jest-shaped JSON summary that
    // tools/ci-assert-suites.mjs checks against expected count ranges — "green because
    // half the suite silently skipped" must fail the workflow, not pass it.
    reporters: process.env.CI === undefined ? ['default'] : ['default', 'json'],
    outputFile: { json: 'test-results.json' },
  },
});
