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
    // Under CI (the public repo has no reference/, so the oracle and course-file suites
    // skip by design) every run also writes a jest-shaped JSON summary that
    // tools/ci-assert-suites.mjs checks against expected count ranges — "green because
    // half the suite silently skipped" must fail the workflow, not pass it.
    reporters: process.env.CI === undefined ? ['default'] : ['default', 'json'],
    outputFile: { json: 'test-results.json' },
  },
});
