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
  },
});
