/**
 * Unplaced-switch diagnostic (ARCHITECTURE.md §7.1, §5.2): seven Variablenliste switches have
 * a G/R coil pair but no position on this board model (trackplan `unplacedSwitches`). Pulsing
 * such a coil used to be a silent no-op; the coordinator now records the command ONCE per coil
 * per program run so the UI can warn about it (localized in ui/, §5.6).
 *
 * xW01C is one of those seven — it is commanded by neither Aufgabenstellung, so the programs
 * below are synthetic, not route code.
 */
import { describe, expect, it } from 'vitest';
import { buildHarness } from './harness';

/** 300 ms coil pulse in the taught SV shape, aimed at a switch the board does not have. */
const PULSE_UNPLACED = [
  'U  "NotausBit"',
  'L  S5T#300MS',
  'SV T 10',
  '',
  'U  T 10',
  '=  "xW01CG"',
  '',
].join('\n');

/** The same command held forever (the '=' pitfall) — still exactly one warning per run. */
const HOLD_UNPLACED = ['U  "NotausBit"', '=  "xW01CG"', ''].join('\n');

const PULSE_PLACED = [
  'U  "NotausBit"',
  'L  S5T#300MS',
  'SV T 10',
  '',
  'U  T 10',
  '=  "xW01BH1G1G"',
  '',
].join('\n');

describe('unplaced switch coils (§7.1)', () => {
  it('wires the coil bits of all seven unplaced switches without placing them', () => {
    const h = buildHarness();
    expect(h.wiring.unplacedCoils.size).toBe(7);
    expect(h.wiring.unplacedCoils.get('xW01C')).toEqual({
      G: { kind: 'bit', area: 'M', byte: 102, bit: 0 },
      R: { kind: 'bit', area: 'M', byte: 108, bit: 0 },
    });
    // …and they are NOT part of the simulated switch interface
    expect(h.wiring.switchCoils.has('xW01C')).toBe(false);
    expect(h.coordinator.snapshot().switches.some((s) => s.id === 'xW01C')).toBe(false);
  });

  it('records exactly one command per coil for a pulsed coil, not one per scan', () => {
    const h = buildHarness({ program: PULSE_UNPLACED });
    h.coordinator.advanceSteps(300);                 // 3 s — the 300 ms pulse spans ~6 scans
    expect(h.coordinator.unplacedCoilCommands).toEqual([{ switchId: 'xW01C', coil: 'G' }]);
    // the pulse produced no plant reaction whatsoever
    expect(h.events.some((e) => e.type === 'switchPulse' || e.type === 'switchMoved')).toBe(false);
  });

  it('records nothing for a switch that IS placed on the board', () => {
    const h = buildHarness({ program: PULSE_PLACED });
    h.coordinator.advanceSteps(300);
    expect(h.coordinator.unplacedCoilCommands).toEqual([]);
    // …while the placed switch really moved, so the run was not vacuous
    expect(h.events.some((e) => e.type === 'switchMoved')).toBe(true);
  });

  it('one program run, one warning: clearing re-arms the recording', () => {
    const h = buildHarness({ program: HOLD_UNPLACED });
    h.coordinator.advanceSteps(50);                  // 10 scans with the coil bit held high
    expect(h.coordinator.unplacedCoilCommands).toHaveLength(1);

    h.coordinator.clearUnplacedCoilCommands();
    expect(h.coordinator.unplacedCoilCommands).toEqual([]);
    h.coordinator.advanceSteps(5);
    expect(h.coordinator.unplacedCoilCommands).toEqual([{ switchId: 'xW01C', coil: 'G' }]);
  });

  it('reports the two coils of one switch separately', () => {
    const h = buildHarness({
      program: ['U  "NotausBit"', '=  "xW01CG"', 'U  "NotausBit"', '=  "xW01CR"', ''].join('\n'),
    });
    h.coordinator.advanceSteps(20);
    expect(h.coordinator.unplacedCoilCommands).toEqual([
      { switchId: 'xW01C', coil: 'G' },
      { switchId: 'xW01C', coil: 'R' },
    ]);
  });

  it('reset() forgets the recorded commands', () => {
    const h = buildHarness({ program: HOLD_UNPLACED });
    h.coordinator.advanceSteps(10);
    expect(h.coordinator.unplacedCoilCommands).toHaveLength(1);
    h.coordinator.reset();
    expect(h.coordinator.unplacedCoilCommands).toEqual([]);
  });
});
