/**
 * CI mass-skip guard. The public checkout (github.com/pmquang87/mat2-sps-simulator) has no
 * `reference/` folder, so the oracle and course-file suites skip BY DESIGN — which means a
 * green CI run proves nothing about coverage unless the executed-test counts are pinned.
 * This script reads the jest-shaped JSON summary that vitest writes under CI
 * (vitest.config.ts `reporters`/`outputFile`) and fails when the counts leave the expected
 * range, so a guard regression that silently skips whole suites cannot pass as green.
 *
 * Measured baselines (2026-08-01):
 *   public checkout (no reference/):  91 files, 1119 passed, 93 skipped of 1212
 *   authoring machine (reference/):   91 files, 1208 passed,  4 skipped of 1212
 * The bounds below hold for both worlds and leave headroom for organic growth; when the
 * by-design skip set changes (new reference-only suites), update them DELIBERATELY here.
 *
 * Falsifiability: tests/tools/ciSuiteGuard.test.ts runs this script against fixture
 * summaries in both directions (healthy shape passes, mass-skip / failing / missing-file
 * shapes fail), so the guard itself is under test on every gate run.
 */
import { readFileSync } from 'node:fs';

const MIN_TEST_FILES = 88;
const MIN_PASSED_TESTS = 1100;
const MAX_SKIPPED_TESTS = 110;

const path = process.argv[2] ?? 'test-results.json';

let summary;
try {
  // BOM strip: vitest itself writes plain UTF-8, but a hand-fed file from a Windows shell
  // (Set-Content in PowerShell 5.1) arrives with one and would fail here for the wrong reason.
  summary = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
} catch (error) {
  console.error(`ci-assert-suites: cannot read ${path} — ${error.message}`);
  console.error('Did the vitest run execute with CI set (vitest.config.ts writes the JSON only then)?');
  process.exit(1);
}

const files = Array.isArray(summary.testResults) ? summary.testResults.length : 0;
const passed = typeof summary.numPassedTests === 'number' ? summary.numPassedTests : 0;
const skipped = typeof summary.numPendingTests === 'number' ? summary.numPendingTests : 0;
const failed = typeof summary.numFailedTests === 'number' ? summary.numFailedTests : -1;

const problems = [];
if (failed !== 0) {
  problems.push(`numFailedTests = ${failed} (expected 0 — the suite itself must be green)`);
}
if (files < MIN_TEST_FILES) {
  problems.push(`${files} test files ran (expected >= ${MIN_TEST_FILES}) — did whole suites vanish?`);
}
if (passed < MIN_PASSED_TESTS) {
  problems.push(`${passed} tests passed (expected >= ${MIN_PASSED_TESTS}) — mass-skip or lost suites`);
}
if (skipped > MAX_SKIPPED_TESTS) {
  problems.push(
    `${skipped} tests skipped (expected <= ${MAX_SKIPPED_TESTS}) — more than the by-design ` +
      'reference/-absent skip set; a skip guard is probably misfiring',
  );
}

if (problems.length > 0) {
  console.error('ci-assert-suites: suite counts out of the expected range:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `ci-assert-suites: OK — ${files} files, ${passed} passed, ${skipped} skipped (bounds: ` +
    `files >= ${MIN_TEST_FILES}, passed >= ${MIN_PASSED_TESTS}, skipped <= ${MAX_SKIPPED_TESTS})`,
);
