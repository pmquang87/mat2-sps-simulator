/**
 * i18n contract tests (ARCHITECTURE.md §5.6).
 *
 * Runs in the node environment (vitest default, §9): the module must therefore work without
 * localStorage and without a document — that is asserted implicitly by every test here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { de } from '../../src/ui/i18n/de';
import { en } from '../../src/ui/i18n/en';
import {
  formatNumber, getLocale, lt, onLocaleChange, setLocale, t,
} from '../../src/ui/i18n/i18n';

describe('dictionaries', () => {
  it('German is total over the English key set', () => {
    const enKeys = Object.keys(en).sort();
    const deKeys = Object.keys(de).sort();
    expect(deKeys).toEqual(enKeys);
  });

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(de)) {
      expect(value.trim(), `de.${key}`).not.toBe('');
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe('');
    }
  });

  /**
   * German typography (§5.6 deliverable rule): quotes are „…“, never the ASCII pair. The four
   * `template.*` strings were the only ones that closed with a straight `"`, which showed up in
   * the messages panel and in the CM6 lint tooltip next to correctly quoted siblings.
   */
  it('uses German quotation marks in every German string', () => {
    for (const [key, value] of Object.entries(de)) {
      expect(value, `de.${key}`).not.toContain('"');
      expect((value.match(/„/g) ?? []).length, `de.${key} opening`)
        .toBe((value.match(/“/g) ?? []).length);
    }
  });

  it('uses the same placeholder set in both languages', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('t / lt / locale', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('defaults to English', () => {
    expect(getLocale()).toBe('en');
    expect(t('app.title')).toBe(en['app.title']);
  });

  it('switches to German and back', () => {
    setLocale('de');
    expect(getLocale()).toBe('de');
    expect(t('controls.notaus')).toBe('NOT-AUS');
    setLocale('en');
    expect(t('controls.notaus')).toBe('EMERGENCY STOP');
  });

  it('interpolates {params} without digit grouping on counts', () => {
    expect(t('diagnostics.at', { line: 1234, col: 7 })).toContain('1234');
    expect(t('status.cycle', { value: 12345 })).toBe('Cycle 12345');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(t('status.cycle', {})).toBe('Cycle {value}');
  });

  it('lt() picks the locale branch', () => {
    const text = { de: 'Weiche', en: 'Point' };
    expect(lt(text)).toBe('Point');
    setLocale('de');
    expect(lt(text)).toBe('Weiche');
  });

  it('notifies subscribers and honours the unsubscribe', () => {
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale('de');
    setLocale('de');            // no-op: same locale must not notify
    off();
    setLocale('en');
    expect(seen).toEqual(['de']);
  });
});

describe('formatNumber', () => {
  it('uses a decimal comma in German and a point in English', () => {
    setLocale('en');
    expect(formatNumber(39.2, 1)).toBe('39.2');
    setLocale('de');
    expect(formatNumber(39.2, 1)).toBe('39,2');
    setLocale('en');
  });
});
