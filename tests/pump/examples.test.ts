/**
 * Every example in src/data/examples.json must LOAD and RUN on the pump stack without a
 * single error diagnostic. Most of them do something visible there (that is why the pump
 * carries pedestal toggles and lamps); the railway-only one does nothing at all — but
 * "nothing" is the requirement, "no error" is the assertion.
 */
import { describe, expect, it } from 'vitest';
import { buildPumpHarness, exampleRows } from './harness';

const SCANS = 20;

describe('examples.json on the pump stack', () => {
  const rows = exampleRows();

  it('has examples to run', () => {
    expect(rows.length).toBeGreaterThan(10);
  });

  for (const row of rows) {
    it(`"${row.id}" loads and runs ${SCANS} scans without an error diagnostic`, () => {
      const h = buildPumpHarness({ params: { pumpRatePctS: 4 } });
      const loaded = h.emulator.load(row.awl);
      const loadErrors = loaded.diagnostics.filter((d) => d.severity === 'error');
      expect(loadErrors.map((d) => `${d.code} @${d.line}: ${d.message.en}`)).toEqual([]);
      expect(loaded.ok).toBe(true);

      // Exercise the plant while the program runs: a button, a toggle and both valves, so
      // the snippets that read E 0.x / E 1.x see changing inputs rather than a dead image.
      h.coordinator.pressS1(true);
      h.coordinator.setToggle('E1.0', true);
      h.coordinator.setValve('outB', true);
      h.coordinator.advanceSteps(5 * 4);            // 4 scans at 50 ms
      h.coordinator.pressS1(false);
      h.coordinator.setToggle('E1.7', true);
      h.coordinator.advanceSteps(5 * (SCANS - 4));

      expect(h.emulator.cycleCount).toBe(SCANS);
      const runtimeErrors = (h.coordinator.lastScan?.diagnostics ?? [])
        .filter((d) => d.severity === 'error');
      expect(runtimeErrors.map((d) => `${d.code}: ${d.message.en}`)).toEqual([]);
    });
  }

  it('collects no runtime error over a long run of the manual\'s pump programs', () => {
    for (const id of ['pump-sr', 'pump-und', 'pump-un', 'pump-selfhold', 'pump-sa-nachlauf']) {
      const row = rows.find((e) => e.id === id);
      expect(row, `examples.json is missing "${id}"`).toBeDefined();
      const h = buildPumpHarness({ program: row!.awl });
      h.coordinator.pressS1(true);
      h.coordinator.advanceSteps(20);
      h.coordinator.pressS1(false);
      const seen: string[] = [];
      for (let i = 0; i < 600; i++) {                // 6 s of sim time
        h.coordinator.advanceSteps(1);
        for (const d of h.coordinator.lastScan?.diagnostics ?? []) {
          if (d.severity === 'error') seen.push(`${id}: ${d.code}`);
        }
      }
      expect(seen).toEqual([]);
    }
  });
});
