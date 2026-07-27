/**
 * Filesystem helpers for the pedagogy tests (repo scanning for the §9.4 solution-leak guard
 * and optional loading of `src/data/*.json`). Test-time only — nothing under `src/` uses
 * these; `src/pedagogy` itself stays free of fs and DOM access (§2 rule 5).
 *
 * `@types/node` is not a dependency of this project and `tsconfig.json` (owned by the ui-app
 * agent, §4) restricts `types` to `vite/client`, so a static `import … from 'node:fs'` would
 * be a TS2307 here. The Node built-ins are therefore loaded through a dynamic import with a
 * non-literal specifier and narrowed to the small interfaces below: no ambient module
 * declarations, hence no repo-wide side effects on other agents' files.
 */
interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}

interface PathLike {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  extname(path: string): string;
}

interface ChildProcessLike {
  execFileSync(
    file: string,
    args: readonly string[],
    options: { encoding: string; cwd?: string },
  ): string;
}

interface ProcessLike {
  cwd(): string;
  env: Record<string, string | undefined>;
}

const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as unknown as FsLike;
const path = (await import(/* @vite-ignore */ ['node', 'path'].join(':'))) as unknown as PathLike;
const childProcess = (await import(
  /* @vite-ignore */ ['node', 'child_process'].join(':')
)) as unknown as ChildProcessLike;

const proc = (globalThis as unknown as { process?: ProcessLike }).process;

export function repoRoot(): string {
  return proc === undefined ? '.' : proc.cwd();
}

export function envFlag(name: string): boolean {
  const value = proc?.env[name];
  return value !== undefined && value !== '' && value !== '0';
}

export function join(...parts: string[]): string {
  return path.join(...parts);
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

/** Extensions worth scanning for text content; keeps binaries (png, pdf) out. */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.svg',
  '.map',
]);

export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Recursive walk, returning paths joined onto `dir`. */
export function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      const stats = fs.statSync(full);
      if (stats.isDirectory()) stack.push(full);
      else if (stats.isFile()) out.push(full);
    }
  }
  return out.sort();
}

export function relativeToRepo(filePath: string): string {
  return path.relative(repoRoot(), filePath).replace(/\\/g, '/');
}

/**
 * The files git considers part of the repository: tracked plus untracked-but-not-ignored —
 * i.e. exactly "everything not matched by .gitignore" (§9.4). Returns null when git is
 * unavailable so callers can fall back.
 */
export function gitCommittableFiles(dir: string): string[] | null {
  try {
    const stdout = childProcess.execFileSync(
      'git',
      ['ls-files', '-c', '-o', '--exclude-standard', dir],
      { encoding: 'utf8', cwd: repoRoot() },
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch {
    return null;
  }
}

/**
 * Fallback when git is unavailable: the doc paths `.gitignore` excludes because they carry
 * solution-derived content (ARCHITECTURE.md §9.4). `solutionLeakGuard.test.ts` asserts that
 * git really ignores these, so the list cannot drift unnoticed.
 */
export const GITIGNORED_DOC_PATHS: readonly string[] = [
  'docs/research/solutions.md',
  'docs/research/weichen_video.md',
  'docs/DOMAIN_MODEL.md',
];

/** Committed text files under `dir`, git-authoritative with a .gitignore-derived fallback. */
export function committedTextFiles(dir: string): string[] {
  const fromGit = gitCommittableFiles(dir);
  if (fromGit !== null) {
    return fromGit.filter((file) => isTextFile(file));
  }
  return walkFiles(path.join(repoRoot(), dir))
    .map((file) => relativeToRepo(file))
    .filter((file) => isTextFile(file) && !GITIGNORED_DOC_PATHS.includes(file));
}

/** Parse a JSON file if it exists, else null (data files may not be authored yet). */
export function readJsonIfPresent(relPath: string): unknown {
  const full = path.join(repoRoot(), relPath);
  if (!fs.existsSync(full)) return null;
  return JSON.parse(fs.readFileSync(full, 'utf8')) as unknown;
}
