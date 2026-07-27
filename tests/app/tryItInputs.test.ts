/**
 * "Try it" input forcing (ARCHITECTURE.md §10.3, §5.2) against the REAL stack and the shipped
 * data files.
 *
 * Why the force mask instead of "only non-reed bits are forcible": on this board every bit of
 * E 0 – E 2 belongs to a wired reed or to the Notaus input (variables.json), and the Anleitung
 * example snippets address exactly those bytes. A rule that refused wired reeds would leave
 * the mini-mode with nothing to toggle, so the coordinator re-asserts forced bits AFTER the
 * per-scan PAE write instead — the reed latch is still consumed, the force simply wins.
 */
import { describe, expect, it } from 'vitest';
import { forcibleProgramInputs, isForcibleInput } from '../../src/app';
import type { BitAddress } from '../../src/core';
import { DRIVE_PROGRAM, buildHarness } from './harness';

function inputBit(byte: number, bit: number): BitAddress {
  return { kind: 'bit', area: 'E', byte, bit };
}

/** Shaped like the Anleitung on-delay example: an E input, student resources only. */
const TRY_IT_PROGRAM = [
  'U  E 0.0',
  'L  S5T#3S',
  'SE T 10',
  '',
  'U  T 10',
  '=  M 10.1',
  '',
].join('\n');

const E_0_0 = inputBit(0, 0);          // wired reed input (xR02BH1G2)
const E_3_0 = inputBit(3, 0);          // no reed, no Notaus — nothing drives it
const M_10_0: BitAddress = { kind: 'bit', area: 'M', byte: 10, bit: 0 };

describe('forcible inputs (§10.3)', () => {
  it('accepts every E bit except the Notaus input, which has its own button', () => {
    const h = buildHarness();
    expect(isForcibleInput(h.wiring, E_0_0)).toBe(true);
    expect(isForcibleInput(h.wiring, E_3_0)).toBe(true);
    expect(isForcibleInput(h.wiring, h.wiring.notausInput)).toBe(false);
    expect(isForcibleInput(h.wiring, M_10_0)).toBe(false);
  });

  it('lists exactly the E bits of the loaded program, deduplicated and ordered', () => {
    const h = buildHarness();
    const load = h.emulator.load([
      'U  E 1.1',
      'U  E 0.0',
      'UN E 0.0',
      'U  "NotausBit"',      // E 1.7 — excluded, the Notaus button owns it
      'S  M 10.0',
      '',
    ].join('\n'));
    expect(load.ok).toBe(true);
    expect(load.program).toBeDefined();
    if (load.program === undefined) return;
    expect(forcibleProgramInputs(h.wiring, load.program)).toEqual([inputBit(0, 0), inputBit(1, 1)]);
  });

  it('has nothing to offer for a plant program (the toggles stay hidden)', () => {
    const h = buildHarness();
    const load = h.emulator.load(DRIVE_PROGRAM);
    expect(load.program).toBeDefined();
    if (load.program === undefined) return;
    expect(forcibleProgramInputs(h.wiring, load.program)).toEqual([]);
  });
});

describe('SimCoordinator.forceInputBit (§5.2)', () => {
  it('writes the bit at once and the program sees it on the next scan', () => {
    const h = buildHarness({ program: TRY_IT_PROGRAM });
    expect(h.coordinator.forceInputBit(E_0_0, true)).toBe(true);
    expect(h.emulator.memory.getBit(E_0_0)).toBe(true);
    expect(h.coordinator.isInputForced(E_0_0)).toBe(true);

    h.coordinator.advanceSteps(5);                     // first scan at t = 50 ms
    expect(h.emulator.getTimer(10).running).toBe(true);
    expect(h.emulator.peekBit(M_10_0)).toBe(false);    // 3 s on-delay not elapsed yet

    h.coordinator.advanceSteps(320);                   // t = 3.25 s
    expect(h.emulator.getTimer(10).q).toBe(true);
    expect(h.emulator.peekBit({ kind: 'bit', area: 'M', byte: 10, bit: 1 })).toBe(true);
  });

  it('is not overwritten by the per-scan PAE write — reed input or not', () => {
    const h = buildHarness({ program: TRY_IT_PROGRAM });
    expect(h.coordinator.forceInputBit(E_0_0, true)).toBe(true);   // a WIRED reed input
    expect(h.coordinator.forceInputBit(E_3_0, true)).toBe(true);   // driven by nothing
    h.coordinator.advanceSteps(100);                               // 20 scans
    expect(h.emulator.memory.getBit(E_0_0)).toBe(true);
    expect(h.emulator.memory.getBit(E_3_0)).toBe(true);
  });

  it('refuses the Notaus input and anything that is not an input bit', () => {
    const h = buildHarness({ program: TRY_IT_PROGRAM });
    expect(h.coordinator.forceInputBit(h.wiring.notausInput, true)).toBe(false);
    expect(h.coordinator.forceInputBit(M_10_0, true)).toBe(false);
    // nothing was written, and the fail-safe input keeps its scan-driven value
    expect(h.emulator.peekBit(M_10_0)).toBe(false);
    h.coordinator.advanceSteps(5);
    expect(h.emulator.memory.getBit(h.wiring.notausInput)).toBe(true);   // 0-active, released
  });

  it('releasing hands a reed input back to the plant', () => {
    const h = buildHarness({ program: TRY_IT_PROGRAM });
    h.coordinator.forceInputBit(E_0_0, true);
    h.coordinator.advanceSteps(5);
    expect(h.emulator.memory.getBit(E_0_0)).toBe(true);

    expect(h.coordinator.forceInputBit(E_0_0, false)).toBe(true);
    expect(h.coordinator.isInputForced(E_0_0)).toBe(false);
    h.coordinator.advanceSteps(5);                     // the reed latch (empty) wins again
    expect(h.emulator.memory.getBit(E_0_0)).toBe(false);
  });

  it('clearForcedInputs() and reset() drop the whole mask', () => {
    const h = buildHarness({ program: TRY_IT_PROGRAM });
    h.coordinator.forceInputBit(E_0_0, true);
    h.coordinator.forceInputBit(E_3_0, true);
    h.coordinator.clearForcedInputs();
    h.coordinator.advanceSteps(5);
    expect(h.emulator.memory.getBit(E_0_0)).toBe(false);
    expect(h.emulator.memory.getBit(E_3_0)).toBe(true);   // released, but never cleared

    h.coordinator.forceInputBit(E_3_0, true);
    h.coordinator.reset();                               // clears memory AND the mask
    expect(h.coordinator.isInputForced(E_3_0)).toBe(false);
    h.coordinator.advanceSteps(5);
    expect(h.emulator.memory.getBit(E_3_0)).toBe(false);
  });
});
