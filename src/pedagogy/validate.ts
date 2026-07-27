/**
 * Internal schema-validation helpers for the pedagogy JSON loaders (§7.3, §7.4).
 * NOT part of the public surface — `index.ts` does not re-export this module.
 *
 * Messages are developer-facing (a data bug, not a student-facing condition), therefore
 * plain English with a JSON path prefix: `exercises[0].networks[3].hints[1].body.de: …`.
 */
import type { LocalizedText } from './types';

export function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

export function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Record<string, unknown>;
}

export function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

export function asNonEmptyArray(v: unknown, path: string): unknown[] {
  const arr = asArray(v, path);
  if (arr.length === 0) fail(path, 'expected a non-empty array');
  return arr;
}

export function asString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(path, 'expected a non-empty string');
  return v;
}

export function asOptionalString(v: unknown, path: string): string | undefined {
  return v === undefined ? undefined : asString(v, path);
}

export function asBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}

export function asNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}

export function asInt(v: unknown, path: string, min?: number): number {
  const n = asNumber(v, path);
  if (!Number.isInteger(n)) fail(path, 'expected an integer');
  if (min !== undefined && n < min) fail(path, `expected an integer >= ${min}`);
  return n;
}

export function asOptionalInt(v: unknown, path: string, min?: number): number | undefined {
  return v === undefined ? undefined : asInt(v, path, min);
}

export function asLocalizedText(v: unknown, path: string): LocalizedText {
  const rec = asRecord(v, path);
  return { de: asString(rec['de'], `${path}.de`), en: asString(rec['en'], `${path}.en`) };
}

export function asOptionalLocalizedText(v: unknown, path: string): LocalizedText | undefined {
  return v === undefined ? undefined : asLocalizedText(v, path);
}

export function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(path, `expected one of ${allowed.join(' | ')}`);
  }
  return v as T;
}

/** Reject unexpected keys — catches typos in hand-written JSON (e.g. "hint" for "hints"). */
export function noExtraKeys(
  rec: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(rec)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, `unknown key (allowed: ${allowed.join(', ')})`);
    }
  }
}
