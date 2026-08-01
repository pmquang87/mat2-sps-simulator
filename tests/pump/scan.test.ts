/**
 * End-to-end scan cycle on the pump stack, driven by the Anleitung's OWN teaching programs
 * (taken verbatim from src/data/examples.json, so this suite fails if a snippet drifts):
 *
 *   - IV.2.5.6 `pump-selfhold` — S1 latches the pump, HLS of tank B stops it again;
 *   - IV.2.6.6 `pump-sa-nachlauf` — the SA run-on time.
 *
 * These are the manual's acceptance semantics; the numbers below are MEASURED against the
 * built stack, not assumed.
 */
import { describe, expect, it } from 'vitest';
import { formatAddress } from '../../src/core';
import type { PumpEvent } from '../../src/pump';
import { advanceUntil, buildPumpHarness, exampleAwl } from './harness';

/**
 * Thresholds for the two integration runs. HLS at 80 % (instead of the default 98 %) so
 * tank B reports FULL well before tank A reports EMPTY — with equal tank sizes and one
 * transfer rate the two thresholds would otherwise be reached within half a second of each
 * other, and the test could not tell which condition stopped the pump.
 */
const RUN_PARAMS = {
  pumpRatePctS: 4,
  llsThresholdPct: 2,
  hlsThresholdPct: 80,
  initialVolAPct: 100,
  initialVolBPct: 0,
} as const;

function pumpTransitions(events: readonly PumpEvent[]): { t: number; on: boolean }[] {
  return events
    .filter((e): e is Extract<PumpEvent, { type: 'actuator' }> =>
      e.type === 'actuator' && e.id === 'pump')
    .map((e) => ({ t: e.t, on: e.on }));
}

describe('Anleitung IV.2.5.6 — self-hold (pump-selfhold)', () => {
  it('starts on S1, holds after the button is released, and stops when HLS of B fires', () => {
    const h = buildPumpHarness({ program: exampleAwl('pump-selfhold'), params: RUN_PARAMS });

    // Start conditions of the manual: A not empty, B empty, dry-run guard wetted.
    const start = h.coordinator.snapshot();
    expect(start.sensors).toEqual({
      llsA: false, hlsA: true, llsB: true, hlsB: false, ls: true,
    });   // A full (100 % ≥ HLS), B empty — the program reads E 0.3 and E 0.5

    h.coordinator.pressS1(true);
    expect(advanceUntil(h, (s) => s.actuators.pump, 1000)).toBe(50);   // first scan
    expect(h.emulator.peekBit('E 0.0')).toBe(true);                    // PAE really carried S1

    // Momentary button: the self-hold (S M 0.0) has to survive the release.
    h.coordinator.pressS1(false);
    h.coordinator.advanceSteps(500);
    expect(h.emulator.peekBit('E 0.0')).toBe(false);
    expect(h.coordinator.snapshot().actuators.pump).toBe(true);

    // Tank A drains over simulated time, tank B fills.
    const midway = h.coordinator.snapshot();
    expect(midway.volAPct).toBeCloseTo(100 - 4 * 5.0, 3);
    expect(midway.volBPct).toBeCloseTo(4 * 5.0, 3);
    expect(midway.flowPctS.pump).toBeCloseTo(4, 6);

    // 80 % of B at 4 %/s, measured from the scan that started the pump.
    const stopped = advanceUntil(h, (s) => !s.actuators.pump, 60_000);
    expect(stopped).toBe(50 + 20_000);

    const end = h.coordinator.snapshot();
    expect(end.sensors.hlsB).toBe(true);          // the condition that stopped it …
    expect(end.sensors.llsA).toBe(false);         // … and not the empty tank A
    expect(end.volBPct).toBeCloseTo(80, 3);
    expect(end.volAPct).toBeCloseTo(20, 3);
    // The step that stopped the pump still moved product: physics runs BEFORE the scan
    // phase (§5.2), so the stream dies one step later — which is what the scene draws.
    expect(end.flowPctS.pump).toBeCloseTo(4, 6);
    h.coordinator.advanceSteps(1);
    expect(h.coordinator.snapshot().flowPctS.pump).toBe(0);
    expect(pumpTransitions(h.events)).toEqual([
      { t: 50, on: true }, { t: 20_050, on: false },
    ]);
  });

  it('refuses to start while tank B is not empty (the U E 0.3 start condition)', () => {
    const h = buildPumpHarness({
      program: exampleAwl('pump-selfhold'),
      params: { ...RUN_PARAMS, initialVolBPct: 40 },
    });
    expect(h.coordinator.snapshot().sensors.llsB).toBe(false);
    h.coordinator.pressS1(true);
    h.coordinator.advanceSteps(200);
    expect(h.coordinator.snapshot().actuators.pump).toBe(false);
  });

  it('stops on the dry-run guard when tank A runs empty under it', () => {
    const h = buildPumpHarness({
      program: exampleAwl('pump-selfhold'),
      params: { ...RUN_PARAMS, initialVolAPct: 20, llsThresholdPct: 1, dryRunDelayS: 2 },
    });
    h.coordinator.pressS1(true);
    expect(advanceUntil(h, (s) => s.actuators.pump, 1000)).toBe(50);
    h.coordinator.pressS1(false);
    // A (20 %) empties after 5 s; LLS at 1 % trips one step earlier and resets M 0.0.
    const stopped = advanceUntil(h, (s) => !s.actuators.pump, 60_000);
    expect(stopped).not.toBeNull();
    expect(h.coordinator.snapshot().sensors.llsA).toBe(true);
    expect(h.coordinator.snapshot().volAPct).toBeLessThan(2);
  });
});

describe('Anleitung IV.2.6.6 — SA run-on time (pump-sa-nachlauf)', () => {
  it('keeps the pump running exactly 3 s after the process condition ends', () => {
    const h = buildPumpHarness({ program: exampleAwl('pump-sa-nachlauf'), params: RUN_PARAMS });
    h.coordinator.pressS1(true);
    expect(advanceUntil(h, (s) => s.actuators.pump, 1000)).toBe(50);
    h.coordinator.pressS1(false);

    // The SA input (E 0.5 ∧ ¬E 0.1 ∧ ¬E 0.4 ∧ M 0.0) drops when HLS of B fires; T 1 then
    // holds its 1 for the 3 s Nachlaufzeit, and the pump follows T 1.
    const full = advanceUntil(h, (s) => s.sensors.hlsB, 60_000);
    expect(full).toBe(50 + 20_000);
    const stopped = advanceUntil(h, (s) => !s.actuators.pump, 60_000);
    expect(stopped).toBe((full as number) + 3_000);
    expect(h.emulator.getTimer(1).q).toBe(false);
  });

  it('but S0 stops it at the very next scan — the manual\'s U M 0.0 defeats the run-on', () => {
    // MEASURED, not assumed: the output network is `U M 0.0 / U T 1 / = A 0.1`, and the stop
    // button resets M 0.0 in an EARLIER network of the same scan. The Nachlaufzeit therefore
    // only shows up on the process conditions, never on the stop button. Pinning it here so
    // the trap stays visible if anyone "fixes" the snippet.
    const h = buildPumpHarness({ program: exampleAwl('pump-sa-nachlauf'), params: RUN_PARAMS });
    h.coordinator.pressS1(true);
    expect(advanceUntil(h, (s) => s.actuators.pump, 1000)).toBe(50);
    h.coordinator.pressS1(false);
    h.coordinator.advanceSteps(500);                       // 5 s of pumping

    expect(h.coordinator.simTimeMs).toBe(5_050);
    h.coordinator.pressS0(true);
    h.coordinator.advanceSteps(20);
    h.coordinator.pressS0(false);
    expect(pumpTransitions(h.events)).toEqual([
      { t: 50, on: true }, { t: 5_100, on: false },        // the first scan after the press
    ]);
  });
});

/**
 * The manual's edge snippets query `E 0.7` literally (IV.2.7), so the plant has to be able to
 * drive that address. Both halves are checked: the toggle reaches the process image, and the
 * FP result reaches the output the snippet writes.
 */
describe('Anleitung IV.2.7 — rising edge FP on E 0.7 (fp-pulse)', () => {
  it('the pedestal toggle drives the manual’s FP snippet end to end', () => {
    const h = buildPumpHarness({ program: exampleAwl('fp-pulse') });
    h.coordinator.advanceSteps(20);                     // four scans with the switch still off
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(false);

    h.coordinator.setToggle('E0.7', true);
    h.coordinator.advanceSteps(5);                      // exactly one scan at 50 ms
    expect(h.emulator.peekBit('E 0.7')).toBe(true);     // the PAE really carried the toggle
    expect(h.emulator.peekBit('M 10.0')).toBe(true);    // FP stored the VKE in its operand
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(true);
  });

  it('is a ONE-scan pulse — the same edge with `=` instead of `S` drops again', () => {
    // The shipped snippet latches with `S`, which cannot show the pulse width. This is the
    // same three instructions with an assignment, so the single-cycle result is observable.
    const h = buildPumpHarness({
      program: ['U   E 0.7', 'FP  M 10.0', '=   A 0.3', ''].join('\n'),
    });
    h.coordinator.setToggle('E0.7', true);
    h.coordinator.advanceSteps(5);
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(true);
    h.coordinator.advanceSteps(5);                      // switch still on: no second edge
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(false);
  });
});

describe('Scan cycle plumbing', () => {
  it('ferries toggles into the PAE and lamps out of the PAA', () => {
    const h = buildPumpHarness({
      program: ['U  E 1.0', '=  A 0.2', 'U  E 1.7', '=  A 0.3', ''].join('\n'),
    });
    h.coordinator.setToggle('E1.0', true);
    h.coordinator.advanceSteps(5);
    expect(h.coordinator.snapshot().actuators['A0.2']).toBe(true);
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(false);

    h.coordinator.setToggle('E1.0', false);
    h.coordinator.setToggle('E1.7', true);
    h.coordinator.advanceSteps(5);
    expect(h.coordinator.snapshot().actuators['A0.2']).toBe(false);
    expect(h.coordinator.snapshot().actuators['A0.3']).toBe(true);
  });

  it('runs the first scan at t = scanIntervalMs and honours a custom interval', () => {
    const h = buildPumpHarness({ program: 'NOP 0\n', scanIntervalMs: 100 });
    expect(h.coordinator.scanInterval).toBe(100);
    h.coordinator.advanceSteps(9);
    expect(h.emulator.cycleCount).toBe(0);
    h.coordinator.advanceSteps(1);
    expect(h.emulator.cycleCount).toBe(1);
    expect(() => h.coordinator.setScanInterval(35)).toThrow(/scanIntervalMs/);
  });

  it('forces an input bit for "Try it" and hands it back on release', () => {
    const h = buildPumpHarness({ program: ['U  E 0.5', '=  A 0.2', ''].join('\n') });
    const ls = h.wiring.sensorInput.get('ls')!;
    expect(formatAddress(ls)).toBe('E 0.5');

    h.coordinator.advanceSteps(5);
    expect(h.coordinator.snapshot().actuators['A0.2']).toBe(true);   // plant says wetted

    expect(h.coordinator.forceInputBit(ls, false)).toBe(true);
    expect(h.coordinator.isInputForced(ls)).toBe(false);             // a released force …
    h.coordinator.advanceSteps(5);
    expect(h.coordinator.snapshot().actuators['A0.2']).toBe(true);   // … lets the plant win

    const s1 = h.wiring.buttonInput.get('S1')!;
    expect(h.coordinator.forceInputBit(s1, true)).toBe(true);
    expect(h.coordinator.isInputForced(s1)).toBe(true);
    h.coordinator.advanceSteps(5);
    expect(h.emulator.peekBit('E 0.0')).toBe(true);                  // forced against the plant
    h.coordinator.forceInputBit(s1, false);
    h.coordinator.advanceSteps(5);
    expect(h.emulator.peekBit('E 0.0')).toBe(false);

    // Outputs are not forcible.
    expect(h.coordinator.forceInputBit(h.wiring.actuatorOutput.get('pump')!, true)).toBe(false);
  });

  it('reset() rewinds sim time, plant and emulator together', () => {
    const h = buildPumpHarness({ program: exampleAwl('pump-selfhold'), params: RUN_PARAMS });
    h.coordinator.pressS1(true);
    h.coordinator.advanceSteps(300);
    h.coordinator.pressS1(false);
    expect(h.coordinator.snapshot().volAPct).toBeLessThan(100);

    h.coordinator.reset();
    expect(h.coordinator.simTimeMs).toBe(0);
    expect(h.coordinator.lastScan).toBeNull();
    expect(h.emulator.cycleCount).toBe(0);
    const s = h.coordinator.snapshot();
    expect(s.volAPct).toBe(100);
    expect(s.volBPct).toBe(0);
    expect(s.actuators.pump).toBe(false);
  });

  it('is deterministic end to end: two identical runs emit identical event streams', () => {
    const script = (): string => {
      const h = buildPumpHarness({ program: exampleAwl('pump-selfhold'), params: RUN_PARAMS });
      h.coordinator.pressS1(true);
      h.coordinator.advanceSteps(20);
      h.coordinator.pressS1(false);
      h.coordinator.setValve('inA', true);
      h.coordinator.advanceSteps(400);
      h.coordinator.setValve('inA', false);
      h.coordinator.setParams({ pumpRatePctS: 7 });
      h.coordinator.advanceSteps(600);
      return JSON.stringify({ events: h.events, snapshot: h.coordinator.snapshot() });
    };
    expect(script()).toBe(script());
  });
});
