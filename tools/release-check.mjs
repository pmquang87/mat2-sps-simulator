/**
 * Release gate helper (ARCHITECTURE.md §9.4): run the full test suite with
 * `MAT2SPS_REQUIRE_DIST=1`, under which the solution-leak guard treats a MISSING `dist/` as a
 * failure instead of skipping the bundle scan. `npm run release-check` builds first, then
 * calls this file.
 *
 * Why a script instead of `MAT2SPS_REQUIRE_DIST=1 vitest run` in package.json: npm runs
 * scripts through cmd.exe on Windows, where the `VAR=value command` prefix is a syntax error.
 * Spawning vitest's own entry point with `process.execPath` keeps the gate identical on every
 * platform and needs no extra dependency.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const vitestBin = require.resolve('vitest/vitest.mjs');

const result = spawnSync(process.execPath, [vitestBin, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, MAT2SPS_REQUIRE_DIST: '1' },
});

if (result.error !== undefined && result.error !== null) {
  console.error(`release-check: could not start vitest — ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
