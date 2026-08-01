/**
 * tools/ci-assert-suites.mjs is the CI mass-skip guard: on the public checkout the oracle
 * and course-file suites skip by design, so CI green is only meaningful if the executed
 * counts are pinned. A guard that cannot fail is worse than no guard — this suite runs the
 * REAL script as a subprocess against fixture summaries in both directions: the healthy
 * shape (today's measured counts) must pass, and each degraded shape must fail for its own
 * reason, one bound per control, so no single assertion can go vacuous unnoticed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../tools/ci-assert-suites.mjs', import.meta.url));

/** Jest-shaped summary as vitest's json reporter emits it (the fields the guard reads). */
function summary(overrides: {
  files?: number;
  passed?: number;
  skipped?: number;
  failed?: number;
}): string {
  const files = overrides.files ?? 91;
  return JSON.stringify({
    numPassedTests: overrides.passed ?? 1119,
    numPendingTests: overrides.skipped ?? 93,
    numFailedTests: overrides.failed ?? 0,
    testResults: Array.from({ length: files }, () => ({})),
  });
}

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mat2sps-ci-guard-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(fixtureName: string, json: string | null): { status: number | null; stderr: string; stdout: string } {
  const path = join(dir, fixtureName);
  if (json !== null) writeFileSync(path, json, 'utf8');
  const result = spawnSync(process.execPath, [SCRIPT, path], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe('CI mass-skip guard (tools/ci-assert-suites.mjs)', () => {
  it('passes the measured public-checkout shape (positive control)', () => {
    const result = run('healthy.json', summary({}));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });

  it('passes the authoring-machine shape (reference/ present: more passed, fewer skipped)', () => {
    const result = run('local.json', summary({ passed: 1208, skipped: 4 }));
    expect(result.status).toBe(0);
  });

  it('fails a mass-skip run — many skipped, few passed', () => {
    const result = run('mass-skip.json', summary({ passed: 400, skipped: 812 }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('skipped');
    expect(result.stderr).toContain('passed');
  });

  it('fails when whole suite files vanish even if the survivors pass', () => {
    const result = run('lost-files.json', summary({ files: 40 }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('test files');
  });

  it('fails when the pass count alone drops below the floor', () => {
    const result = run('low-pass.json', summary({ passed: 1099 }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('passed');
  });

  it('fails when the skip count alone exceeds the ceiling', () => {
    const result = run('high-skip.json', summary({ skipped: 111 }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('skipped');
  });

  it('fails on failing tests regardless of counts', () => {
    const result = run('failing.json', summary({ failed: 1 }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('numFailedTests');
  });

  it('fails loudly when the summary file is missing (the reporter did not run)', () => {
    const result = run('missing.json', null);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot read');
  });
});
