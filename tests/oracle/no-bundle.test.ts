/**
 * Solution-leak guard (ARCHITECTURE.md §9.4). Always runs — it never needs `Claude_work/`.
 *
 * It asserts three things:
 *  1. nothing under `src/` references the oracle directory;
 *  2. no COMMITTED file under `docs/` (everything git does not ignore — `solutions.md`,
 *     `weichen_video.md` and `DOMAIN_MODEL.md` are gitignored precisely because they carry
 *     solution-derived content) contains solution content;
 *  3. the built `dist/` contains neither the oracle directory name nor solution content.
 *     A missing `dist/` skips that assertion in local dev; with `MAT2SPS_REQUIRE_DIST=1`
 *     (the release/CI job, which builds first) a missing `dist/` is a FAILURE.
 *
 * Pattern design: §9.4 requires that this test's pattern list does not flag §9.4's own
 * paragraph, which quotes the marker words. Two mechanisms do that. (a) The bare oracle
 * directory name is a `src/`+`dist/` rule only, never a docs rule — the architecture and
 * requirement documents legitimately discuss the policy by name. (b) For docs, markdown
 * INLINE code spans are stripped before the word markers run, so a marker quoted as
 * `like this` is documentation, while the same words in running text or in a fenced code
 * block are a leak. Fenced blocks are deliberately NOT stripped: leaked AWL would live in one.
 *
 * The last test in this file is a self-test with synthetic solution-shaped input, so the
 * guard can never pass vacuously. Calibration against the real (gitignored) solution-derived
 * documents on the authoring machine: each of them trips at least one marker plus the AWL
 * density rule (9 … 205 plant-operand AWL lines), while the committed documents peak at 2 such
 * lines — a transcription of the lecture video in `docs/research/video_design.md`.
 *
 * Placement note: authored by the pedagogy agent (owner of the §10.2 leak rules) as
 * tests/pedagogy/solutionLeakGuard.test.ts; relocated by the integrator to the §3
 * canonical path tests/oracle/no-bundle.test.ts — ONE pattern list, no weaker duplicate.
 * The file-walking support helpers stay in tests/pedagogy/support/repoFiles.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  GITIGNORED_DOC_PATHS,
  committedTextFiles,
  envFlag,
  fileExists,
  gitCommittableFiles,
  isTextFile,
  join,
  readText,
  relativeToRepo,
  repoRoot,
  walkFiles,
} from '../pedagogy/support/repoFiles';

/** Assembled at runtime so this file is not itself a hit for a naive grep of the repo. */
const ORACLE_DIR_TOKEN = ['Claude', 'work'].join('_');

/** Committed text files under docs/ — empty in a code-only clone, which skips that check. */
const COMMITTED_DOCS = committedTextFiles('docs');

interface Marker {
  id: string;
  re: RegExp;
  why: string;
}

/**
 * Markers of solution CONTENT (as opposed to policy prose about the solutions):
 * per-student solution filenames, "model solution" wording, a verbatim-from-the-solution
 * annotation, and AWL that WRITES to a plant switch coil — a shape that only appears in
 * program code for the actual assignments.
 */
const SOLUTION_MARKERS: readonly Marker[] = [
  {
    id: 'student-solution-filename',
    re: /Gruppe_[AB]_[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*_[A-Za-zÄÖÜäöüß-]+_\d{6,}/,
    why: 'per-student solution filename (name + matriculation number)',
  },
  {
    id: 'solution-marked-filename',
    re: /Gruppe_[AB][A-Za-z0-9_]*_(LOESUNG|LOSUNG|LÖSUNG)/i,
    why: 'solution-marked task filename',
  },
  {
    id: 'loesung-marker',
    re: /\b(LOESUNG|LÖSUNG)\b/,
    why: 'all-caps solution marker',
  },
  {
    id: 'model-solution-wording',
    re: /\bMusterl(ö|oe)sung(en)?\b/i,
    why: 'reference to a model solution',
  },
  {
    id: 'verbatim-solution-annotation',
    re: /verbatim aus (der|den|beiden) L(ö|oe)sung/i,
    why: 'verbatim-from-the-solution annotation',
  },
  {
    id: 'coil-write',
    re: /^[ \t]*(=|S|R)[ \t]+"?xW\d/m,
    why: 'AWL write to a plant switch coil — solution program code',
  },
];

/** An AWL instruction line whose operand is a plant or system symbol. */
const AWL_PLANT_LINE =
  /^[ \t]*(U|UN|O|ON|X|XN|=|S|R|L|T|SV|SI|SE|SS|SA|FP|FN|ZV|ZR|SPA|SPB|SPBN)[ \t]+"?(x[WR]\d|Speed[123](IU|GU)|NotausBit|STOP\b|M[ \t]*1[01]\d\.|M[ \t]*12[01]\.)/gm;

/**
 * More than this many plant-operand AWL lines in one file is a program listing, not an
 * illustration. Calibrated with margin: the committed documents peak at 2 (a transcription
 * of the lecture video), while the solution documents score 9 … 207.
 */
const AWL_DENSITY_LIMIT = 4;

interface Finding {
  file: string;
  markerId: string;
  detail: string;
}

function stripInlineCode(text: string): string {
  return text.replace(/`[^`\n]*`/g, '``');
}

/** JSON and bundled JS carry AWL inside escaped strings — unescape before line matching. */
function unescapeStringLiterals(text: string): string {
  return text.replace(/(?:\\r)?\\n/g, '\n').replace(/\\"/g, '"');
}

function scanFile(
  file: string,
  text: string,
  opts: { flagOracleToken: boolean; stripInline: boolean },
): Finding[] {
  const findings: Finding[] = [];
  const unescaped = unescapeStringLiterals(text);
  const wordHaystack = opts.stripInline ? stripInlineCode(unescaped) : unescaped;

  if (opts.flagOracleToken && text.includes(ORACLE_DIR_TOKEN)) {
    findings.push({ file, markerId: 'oracle-directory', detail: ORACLE_DIR_TOKEN });
  }
  for (const marker of SOLUTION_MARKERS) {
    const m = new RegExp(marker.re.source, marker.re.flags.replace('g', '')).exec(wordHaystack);
    if (m !== null) {
      findings.push({ file, markerId: marker.id, detail: `${marker.why}: "${m[0]}"` });
    }
  }
  const awlLines = [...unescaped.matchAll(AWL_PLANT_LINE)];
  if (awlLines.length > AWL_DENSITY_LIMIT) {
    findings.push({
      file,
      markerId: 'awl-listing-density',
      detail: `${awlLines.length} AWL lines on plant operands (limit ${AWL_DENSITY_LIMIT})`,
    });
  }
  return findings;
}

function format(findings: readonly Finding[]): string[] {
  return findings.map((f) => `${f.file} — ${f.markerId}: ${f.detail}`);
}

function scanTree(dir: string, flagOracleToken: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const path of walkFiles(join(repoRoot(), dir))) {
    if (!isTextFile(path)) continue;
    const rel = relativeToRepo(path);
    findings.push(...scanFile(rel, readText(path), { flagOracleToken, stripInline: false }));
  }
  return findings;
}

describe('solution-leak guard (§9.4)', () => {
  it('src/ never references the oracle directory and carries no solution content', () => {
    const findings = scanTree('src', true);
    expect(format(findings)).toEqual([]);
  });

  // A code-only clone publishes no documents at all (`.gitignore`: `docs/`), so there is
  // nothing under docs/ to scan. That must SKIP visibly rather than pass with an empty file
  // list — an empty scan reporting "no leaks" is exactly the vacuous green this suite exists
  // to prevent. On the authoring machine docs/ is present and tracked, so the assertion below
  // still runs at full strength; `.gitignore` does not untrack what git already tracks.
  it.skipIf(COMMITTED_DOCS.length === 0)('committed docs/ carry no solution content', () => {
    const files = COMMITTED_DOCS;
    expect(files.length).toBeGreaterThan(0);
    const findings: Finding[] = [];
    for (const rel of files) {
      const full = join(repoRoot(), rel);
      if (!fileExists(full)) continue;
      findings.push(...scanFile(rel, readText(full), { flagOracleToken: false, stripInline: true }));
    }
    expect(format(findings)).toEqual([]);
  });

  it('keeps the solution-derived documents and the oracle directory out of the repository', () => {
    const trackedDocs = gitCommittableFiles('docs');
    if (trackedDocs === null) return;                 // git unavailable — nothing to assert
    for (const ignored of GITIGNORED_DOC_PATHS) {
      expect(trackedDocs).not.toContain(ignored);
    }
    expect(gitCommittableFiles(ORACLE_DIR_TOKEN)).toEqual([]);
  });

  it('the built dist/ is free of solution content', () => {
    const distDir = join(repoRoot(), 'dist');
    const required = envFlag('MAT2SPS_REQUIRE_DIST');
    if (!fileExists(distDir)) {
      // Release/CI builds dist/ first and sets the flag — then a missing dist/ is a failure.
      expect(required, 'dist/ is missing although MAT2SPS_REQUIRE_DIST is set').toBe(false);
      return;
    }
    const files = walkFiles(distDir).filter((path) => isTextFile(path));
    const texts = files.map((path) => ({ rel: relativeToRepo(path), text: readText(path) }));
    if (required) {
      // `files.length > 0` is not enough: `.svg` counts as text, so a dist/ holding nothing
      // but favicon.svg (or a bare index.html emitted before bundling) would satisfy the
      // release gate while the real bundle — the only place a leak could hide — went
      // unscanned. Positive control: the app imports trackplan.json, so a genuinely built
      // bundle always carries the plant identifiers. The current build inlines all JS/CSS
      // into index.html (vite-plugin-singlefile), hence the assertion is on the corpus as a
      // whole rather than on a chunk filename.
      const corpus = texts.map((f) => f.text).join('\n');
      expect(
        corpus.includes('xW01BH1G1'),
        'dist/ does not contain the bundled trackplan (no real build was scanned) — ' +
          `scanned: ${texts.map((f) => f.rel).join(', ')}`,
      ).toBe(true);
    }
    const findings: Finding[] = [];
    for (const file of texts) {
      findings.push(
        ...scanFile(file.rel, file.text, { flagOracleToken: true, stripInline: false }),
      );
    }
    expect(format(findings)).toEqual([]);
  });

  it('detects solution-shaped content (self-test — the guard must not pass vacuously)', () => {
    const oracleReference = `import { x } from '../${ORACLE_DIR_TOKEN}/gruppeA.txt';`;
    expect(
      scanFile('fake.ts', oracleReference, { flagOracleToken: true, stripInline: false }).map(
        (f) => f.markerId,
      ),
    ).toContain('oracle-directory');

    const listing = [
      '// Netzwerk 3',
      'U     "xR01BH1G1"',
      'L     S5T#300MS',
      'SV    T 10',
      'U     T 10',
      '=     "xW01BH1G1G"',
      '=     "xW02BH1G1R"',
      'U     "xR03A"',
      'S     "Speed3IU"',
      'R     "Speed2IU"',
    ].join('\n');
    const listingHits = scanFile('fake.txt', listing, {
      flagOracleToken: false,
      stripInline: false,
    }).map((f) => f.markerId);
    expect(listingHits).toContain('coil-write');
    expect(listingHits).toContain('awl-listing-density');

    // the same listing survives escaping into a JSON string / a bundle
    const bundled = `{"awl":"${listing.replace(/\n/g, '\\n').replace(/"/g, '\\"')}"}`;
    expect(
      scanFile('fake.json', bundled, { flagOracleToken: false, stripInline: false }).map(
        (f) => f.markerId,
      ),
    ).toContain('awl-listing-density');

    const filenames = [
      'Gruppe_A_Mustermann_Erika_1234567.txt',
      'Gruppe_B_Aufgabe_SS2026_LOESUNG.txt',
      'Musterlösung Gruppe A',
      'Tabelle 5 (verbatim aus der Lösung)',
    ];
    const filenameHits = filenames.flatMap((sample) =>
      scanFile('fake.md', sample, { flagOracleToken: false, stripInline: true }).map(
        (f) => f.markerId,
      ),
    );
    expect(filenameHits).toContain('student-solution-filename');
    expect(filenameHits).toContain('solution-marked-filename');
    expect(filenameHits).toContain('model-solution-wording');
    expect(filenameHits).toContain('verbatim-solution-annotation');

    // …but a doc that merely QUOTES the markers as inline code stays clean (§9.4 self-match)
    const policyProse =
      'solution markers (`LOESUNG`, `verbatim aus der Lösung`, `' + ORACLE_DIR_TOKEN + '`)';
    expect(
      scanFile('docs/ARCHITECTURE.md', policyProse, {
        flagOracleToken: false,
        stripInline: true,
      }),
    ).toEqual([]);
  });
});
