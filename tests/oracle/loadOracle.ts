/**
 * §9.4 loadOracle.ts — TEST-TIME-ONLY loader for the AWL solutions in
 * `reference/Claude_work/` (`reference/` is the one gitignored local-only folder). Files:
 * gruppeA.txt, gruppeB.txt — neutral names only. If the directory or a file is absent, the
 * oracle suites skip cleanly; nothing under src/ may reference these files.
 *
 * The local solution files are the filled-in course templates (task prose + AWL blocks
 * after each "--Bitte hier programmieren--" marker), so the loader extracts exactly the
 * program sections and rewrites the "Netzwerk n" headers into the parser's
 * `// Netzwerk n` grouping comments (§5.1.4).
 *
 * That extraction used to live HERE, in test code only — which is exactly why the product
 * could not ingest the file format the course hands out. It now lives in
 * `src/core/template.ts` and this loader delegates: verified byte-identical on both local
 * solution files before the switch, and pinned by tests/core/template.test.ts on the public
 * (unfilled) task templates, which are committed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeSource } from '../../src/core';

function oraclePath(which: 'A' | 'B'): string {
  return fileURLToPath(new URL(`../../reference/Claude_work/gruppe${which}.txt`, import.meta.url));
}

export function oracleAvailable(which: 'A' | 'B'): boolean {
  try {
    return existsSync(oraclePath(which));
  } catch {
    return false;
  }
}

/** Extract the concatenated AWL program from a filled-in course template. */
export function extractAwlFromTemplate(template: string): string {
  return normalizeSource(template).program;
}

/** fs read of reference/Claude_work/gruppe<which>.txt, extracted to plain AWL; null if absent. */
export function loadOracleSource(which: 'A' | 'B'): string | null {
  const path = oraclePath(which);
  if (!existsSync(path)) return null;
  // latin1 keeps the byte values readable; the AWL itself is pure ASCII (the German
  // umlauts only occur inside // comments, where mangling would be harmless anyway).
  const raw = readFileSync(path, 'latin1');
  return extractAwlFromTemplate(raw);
}
