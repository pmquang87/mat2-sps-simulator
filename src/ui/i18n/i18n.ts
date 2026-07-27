/**
 * i18n layer (ARCHITECTURE.md §5.6): t(), lt(), setLocale/getLocale/onLocaleChange,
 * localStorage persistence under "mat2sps.locale"; default locale 'en'.
 *
 * Every user-visible string in ui/ goes through t(); exercise/hint/example content
 * carries both languages inline (LocalizedText, owned by pedagogy) and goes through lt().
 *
 * Storage and the document language attribute are accessed defensively: the module is
 * imported by node-environment tests (§9), where neither localStorage nor document exists.
 */
import type { LocalizedText } from '../../pedagogy';
import { de } from './de';
import { en } from './en';

export type Locale = 'en' | 'de';
export type MsgKey = keyof typeof en;            // en.ts is the source of truth

export const LOCALES: readonly Locale[] = ['en', 'de'];
const STORAGE_KEY = 'mat2sps.locale';
const DEFAULT_LOCALE: Locale = 'en';

const dictionaries: Record<Locale, Record<MsgKey, string>> = { en, de };
const listeners = new Set<(l: Locale) => void>();

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de';
}

/** localStorage is absent in the node test environment and may throw in private mode. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredLocale(): Locale {
  const raw = store()?.getItem(STORAGE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

let current: Locale = readStoredLocale();

/** UI string lookup for an EXPLICIT locale. Needed wherever a string must be produced in
 *  BOTH languages at once: a `Diagnostic` carries `message: { de, en }` (§5.1.5), so a
 *  UI-raised diagnostic built with `t()` alone would freeze the locale it was created in. */
export function tIn(
  locale: Locale,
  key: MsgKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[locale][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    // Plain String() on purpose: counts and line numbers must NOT get digit grouping.
    // Call sites that want locale number formatting pass formatNumber(...) themselves.
    return typeof value === 'number' ? String(value) : value;
  });
}

/** UI string lookup with {param} interpolation. de.ts is a TOTAL Record<MsgKey, string>
 *  checked by tsc — a missing key is a compile error, so there is deliberately NO
 *  runtime EN-fallback path. */
export function t(key: MsgKey, params?: Record<string, string | number>): string {
  return tIn(current, key, params);
}

/** Pick from a LocalizedText (exercise/hint content) by current locale.
 *  LocalizedText is imported from pedagogy — its single owner (§4, §5.5). */
export function lt(text: LocalizedText): string {
  return current === 'de' ? text.de : text.en;
}

export function setLocale(l: Locale): void {     // persists "mat2sps.locale"; default 'en'
  if (!isLocale(l) || l === current) return;
  current = l;
  try {
    store()?.setItem(STORAGE_KEY, l);
  } catch {
    /* storage full or blocked — the runtime locale still switches */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const cb of Array.from(listeners)) cb(l);
}

export function getLocale(): Locale {
  return current;
}

/** Returns an unsubscribe callback. Typed inline as `() => void` on purpose — the
 *  `Unsubscribe` alias stays app-internal (single owner, §5.2); no shared name. */
export function onLocaleChange(cb: (l: Locale) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Locale-aware number formatting (§5.6: `de` uses the decimal comma). */
export function formatNumber(value: number, fractionDigits?: number): string {
  const options: Intl.NumberFormatOptions = fractionDigits === undefined
    ? {}
    : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };
  return new Intl.NumberFormat(current === 'de' ? 'de-DE' : 'en-GB', options).format(value);
}

/** Test/bootstrap helper: re-read the persisted locale and notify listeners. */
export function initLocale(): Locale {
  const stored = readStoredLocale();
  current = stored;
  if (typeof document !== 'undefined') document.documentElement.lang = stored;
  return stored;
}
