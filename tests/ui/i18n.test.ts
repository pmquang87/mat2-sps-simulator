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
  LOCALES, formatNumber, getLocale, lt, onLocaleChange, setLocale, t, tIn,
} from '../../src/ui/i18n/i18n';
import type { MsgKey } from '../../src/ui/i18n/i18n';

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

  /**
   * Start-track chooser (§10.1): the panel labels two selects and one group, so all three
   * keys must exist in BOTH dictionaries and render. The retired Gruppe A/B preset buttons
   * must be gone with them — a leftover key is a string nothing can ever show.
   */
  it('carries the start-track chooser keys and no leftovers of the A/B switch', () => {
    for (const key of ['controls.startTrack', 'controls.startStation', 'controls.startLane',
                       'controls.startStationTitle', 'controls.startLaneTitle',
                       'controls.startTrackTitle', 'controls.startTrackFromExercise'] as const) {
      expect(en[key], `en.${key}`).toBeTruthy();
      expect(de[key], `de.${key}`).toBeTruthy();
      expect(de[key], `de.${key} must not be the English text`).not.toBe(en[key]);
    }
    const retired = Object.keys(en).filter((key) => key.startsWith('controls.startGruppe'));
    expect(retired).toEqual([]);
  });

  /**
   * The second experiment added a whole block of keys at once. tsc already forces `de` to
   * be total over `en`, but totality is not the same as usable: this asserts that EVERY key
   * actually renders in BOTH locales, and that no German entry is just the English string
   * left behind (the failure mode a bulk paste produces).
   */
  it('every key renders in both locales, with a distinct German text', () => {
    // Genuinely identical in both languages: loan words, unit symbols, the EN/DE labels
    // themselves, and format strings that are only placeholders and a unit. The list is
    // asserted to be exhaustive below, so it cannot quietly absorb a forgotten translation.
    const sameByDesign: readonly MsgKey[] = [
      'lang.en', 'lang.de',
      'controls.stop', 'controls.reset', 'layout.title', 'camera.orbit',
      'watch.name', 'watch.filter', 'watch.timer', 'watch.q',
      'exercise.points',
      'params.unit.pctPerS', 'params.unit.pct', 'params.unit.s',
    ];
    const allowed = new Set<string>(sameByDesign);
    const identical: string[] = [];
    for (const key of Object.keys(en) as MsgKey[]) {
      for (const locale of LOCALES) {
        const rendered = tIn(locale, key);
        expect(rendered, `${locale}.${key}`).toBeTruthy();
        expect(rendered.trim(), `${locale}.${key}`).not.toBe('');
      }
      if (de[key] === en[key]) identical.push(key);
    }
    expect(identical.filter((key) => !allowed.has(key))).toEqual([]);
    // …and no stale entries: a key that HAS been translated must leave the list.
    expect(sameByDesign.filter((key) => de[key] !== en[key])).toEqual([]);
  });

  /** The experiment switcher, the pump task text and the parameters panel all live here. */
  it('carries the experiment-switcher, task and parameter keys', () => {
    const required: MsgKey[] = [
      'app.subtitlePump',
      'experiment.label', 'experiment.railway', 'experiment.pump', 'experiment.switchTo',
      'tabs.parameters', 'task.title', 'task.note',
      'params.title', 'params.note', 'params.reset', 'params.resetTitle', 'params.range',
      'params.sliderLabel', 'params.valueLabel', 'params.applyLive', 'params.applyOnReset',
      'params.unavailable',
      'params.field.pumpRatePctS', 'params.field.refillRatePctS', 'params.field.drainRatePctS',
      'params.field.llsThresholdPct', 'params.field.hlsThresholdPct',
      'params.field.dryRunDelayS', 'params.field.initialVolAPct', 'params.field.initialVolBPct',
      'params.unit.pctPerS', 'params.unit.pct', 'params.unit.s',
      'inputs.notePump',
      'watch.section.pumpInputs', 'watch.section.pumpOutputs', 'watch.section.pumpFlags',
    ];
    for (const key of required) {
      expect(en[key], `en.${key}`).toBeTruthy();
      expect(de[key], `de.${key}`).toBeTruthy();
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
