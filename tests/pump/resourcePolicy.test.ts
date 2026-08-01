/**
 * W-RES-001 is a COURSE rule, not an emulator rule (`ResourcePolicy`, ARCHITECTURE §5.1.5):
 * the railway confines students to its student area, but the pump manual ITSELF writes
 * `A 0.1` (the pump), `M 0.0` (the latch flag) and `T 1` — user report 2026-08-01: every
 * manual example raised four spurious warnings on the pump experiment.
 *
 * Pins: every example the pump offers loads on the pump stack with ZERO W-RES-001; the
 * railway default still warns for the same operands (unchanged behaviour, and the control
 * that the check can fail); the pump policy still rejects what its plant does not have.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Emulator } from '../../src/core';
import { loadExamplesForExperiment } from '../../src/pedagogy';
import { PUMP_RESOURCE_POLICY, buildPumpSymbols, createPumpStack } from '../../src/pump';

const examplesJson: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../src/data/examples.json', import.meta.url)),
    'utf8',
  ),
);

function resWarnings(emulator: Emulator, awl: string): string[] {
  const result = emulator.load(awl);
  return result.diagnostics
    .filter((d) => d.code === 'W-RES-001')
    .map((d) => d.message.en);
}

describe('pump resource policy (W-RES-001)', () => {
  it('loads every pump-visible example without a single resource warning', () => {
    const { emulator } = createPumpStack();
    const examples = loadExamplesForExperiment(examplesJson, 'pump');
    expect(examples.length).toBeGreaterThan(10);
    for (const example of examples) {
      expect(resWarnings(emulator, example.awl), example.id).toEqual([]);
    }
  });

  it('control: the RAILWAY default still warns for the manual pump operands', () => {
    const emulator = new Emulator(buildPumpSymbols());   // default = railway policy
    const warnings = resWarnings(emulator, 'U E 0.0\nS M 0.0\nL S5T#3S\nSA T 1\nU T 1\n= A 0.1\n');
    expect(warnings.length).toBe(3);                     // M 0.0, T 1, A 0.1
  });

  it('still rejects targets the pump plant does not have', () => {
    const { emulator } = createPumpStack();
    const warnings = resWarnings(
      emulator,
      'U E 0.0\n= A 1.0\nS M 21.0\nL S5T#1S\nSI T 21\nZV Z 11\nL 5\nT AW 6\n',
    );
    expect(warnings.length).toBe(5);                     // A 1.0, M 21.0, T 21, Z 11, AW 6
  });

  it('policy boundaries, both sides', () => {
    const p = PUMP_RESOURCE_POLICY;
    expect(p.bit({ area: 'A', byte: 0, bit: 7 })).toBe(true);
    expect(p.bit({ area: 'A', byte: 1, bit: 0 })).toBe(false);
    expect(p.bit({ area: 'M', byte: 0, bit: 0 })).toBe(true);
    expect(p.bit({ area: 'M', byte: 20, bit: 0 })).toBe(true);
    expect(p.bit({ area: 'M', byte: 20, bit: 1 })).toBe(false);
    expect(p.bit({ area: 'E', byte: 0, bit: 0 })).toBe(false);
    expect(p.timer(1)).toBe(true);
    expect(p.timer(20)).toBe(true);
    expect(p.timer(21)).toBe(false);
    expect(p.counter(10)).toBe(true);
    expect(p.counter(11)).toBe(false);
    expect(p.word('MW', 18)).toBe(true);
    expect(p.word('MW', 20)).toBe(false);
    expect(p.word('AW', 6)).toBe(false);
  });
});
