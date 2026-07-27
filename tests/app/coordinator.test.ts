/**
 * §9.3 coordinator.test.ts — the assembled stack (REAL Emulator + Plant + Wiring, shipped
 * data files): scan/physics interleaving, I/O ferry in the binding §5.2 order, AW 6
 * write-back, speedConflict emission, scenario playback, and the end-to-end
 * "trivial program stops a moving train" case.
 */
import { describe, expect, it } from 'vitest';
import { bitsToWord } from '../../src/plant';
import { DRIVE_PROGRAM, advanceUntil, buildHarness } from './harness';

describe('SimCoordinator with the real stack (§9.3)', () => {
  it('runs exactly one Emulator.step per 5 physics steps at scan 50 ms, first at t = 50', () => {
    const h = buildHarness({ program: DRIVE_PROGRAM });
    h.coordinator.advanceSteps(4);
    expect(h.coordinator.simTimeMs).toBe(40);
    expect(h.emulator.cycleCount).toBe(0);        // §5.2: never a scan at t = 0
    h.coordinator.advanceSteps(1);
    expect(h.coordinator.simTimeMs).toBe(50);
    expect(h.emulator.cycleCount).toBe(1);
    h.coordinator.advanceSteps(25);
    expect(h.coordinator.simTimeMs).toBe(300);
    expect(h.emulator.cycleCount).toBe(6);
  });

  it('writes AW 6 back into the process image and ferries it to the plant', () => {
    const h = buildHarness({ program: DRIVE_PROGRAM });
    h.coordinator.advanceSteps(5);                // one scan: Speed3IU gets set
    const word = h.emulator.peekWord('Fahrstrom');
    expect(word).not.toBe(0);
    const snapshot = h.coordinator.snapshot();
    expect(snapshot.fahrstrom.word).toBe(word);
    // Speed3IU is the only speed bit set — the word must be its pure encoding.
    const speed3Bit = h.symbols.lookup('Speed3IU');
    expect(speed3Bit).toBeDefined();
    if (speed3Bit !== undefined && speed3Bit.target.kind === 'bit') {
      expect(word).toBe(bitsToWord(1 << speed3Bit.target.bit));
    }
  });

  it('ferries switch coil levels to the plant and measures held coils (§5.3)', () => {
    const h = buildHarness({
      program: ['U  "NotausBit"', '=  "xW01BH1G1G"', ''].join('\n'),
    });
    h.coordinator.advanceSteps(5);                // first scan at 50 ms sets the coil
    const snapshot = h.coordinator.snapshot();
    const sw = snapshot.switches.find((s) => s.id === 'xW01BH1G1');
    expect(sw).toBeDefined();
    expect(sw?.coilG).toBe(true);
    expect(sw?.coilR).toBe(false);
    // The 300 ms actuation completes and reports the move.
    const moved = advanceUntil(h, (e) => e.type === 'switchMoved', 2_000);
    expect(moved).not.toBeNull();
    if (moved !== null && moved.type === 'switchMoved') {
      expect(moved.switchId).toBe('xW01BH1G1');
      expect(moved.t).toBeGreaterThanOrEqual(340);
      expect(moved.t).toBeLessThanOrEqual(400);
    }
    // '=' keeps the coil high forever → the plant flags it after 5 s (teaches SV pulses).
    const held = advanceUntil(h, (e) => e.type === 'coilHeld', 8_000);
    expect(held).not.toBeNull();
    if (held !== null && held.type === 'coilHeld') {
      expect(held.switchId).toBe('xW01BH1G1');
      expect(held.coil).toBe('G');
      expect(held.heldMs).toBeGreaterThanOrEqual(5_000);
    }
  });

  it('emits speedConflict (coordinator event) when more than one M120 bit is set', () => {
    const h = buildHarness({
      program: ['U  "NotausBit"', 'S  "Speed1IU"', 'U  "NotausBit"', 'S  "Speed2IU"', ''].join('\n'),
    });
    h.coordinator.advanceSteps(5);
    const conflict = h.events.find((e) => e.type === 'speedConflict');
    expect(conflict).toBeDefined();
    if (conflict !== undefined && conflict.type === 'speedConflict') {
      expect(conflict.t).toBe(50);
      // exactly two bits set
      let bits = conflict.m120;
      let count = 0;
      while (bits > 0) {
        count += bits & 1;
        bits >>= 1;
      }
      expect(count).toBe(2);
    }
  });

  it('latches a real reed crossing into the PAE at the next scan', () => {
    const h = buildHarness({ program: DRIVE_PROGRAM });
    const closed = advanceUntil(h, (e) => e.type === 'reedClosed', 120_000);
    expect(closed).not.toBeNull();
    if (closed === null || closed.type !== 'reedClosed') return;
    const address = h.wiring.reedInput.get(closed.reedId);
    expect(address).toBeDefined();
    if (address === undefined) return;
    // Advance to the next scan boundary: the consume happens there, the latch guarantees
    // the closure is seen even though it may have been shorter than one scan (§5.3/§6.2).
    const scan = h.coordinator.scanInterval;
    while (h.coordinator.simTimeMs % scan !== 0) h.coordinator.advanceSteps(1);
    expect(h.emulator.memory.getBit(address)).toBe(true);
    // After the magnet has left the window the input drops again within a few scans.
    let cleared = false;
    for (let i = 0; i < 40 && !cleared; i++) {
      h.coordinator.advanceSteps(scan / 10);
      cleared = !h.emulator.memory.getBit(address);
    }
    expect(cleared).toBe(true);
  });

  it('plays scenario actions deterministically at their atMs', () => {
    const h = buildHarness({ program: DRIVE_PROGRAM });
    h.coordinator.loadScenario([
      { atMs: 1_000, action: 'notaus', active: true },
      { atMs: 2_000, action: 'notaus', active: false },
    ]);
    h.coordinator.advanceSteps(300);              // 3 s
    const notausEvents = h.events.filter((e) => e.type === 'notaus');
    // §5.2: an action is applied immediately BEFORE the first physics step whose post-step
    // time is ≥ atMs — the plant therefore stamps it with the pre-step time (atMs - 10).
    expect(notausEvents.map((e) => `${e.t}:${e.type === 'notaus' ? String(e.active) : ''}`))
      .toEqual(['990:true', '1990:false']);
  });

  it('end-to-end: the drive program moves the train, notaus stops it', () => {
    const h = buildHarness({ program: DRIVE_PROGRAM });
    h.coordinator.loadScenario([{ atMs: 5_000, action: 'notaus', active: true }]);
    const started = advanceUntil(h, (e) => e.type === 'trainStarted', 2_000);
    expect(started).not.toBeNull();
    expect(started?.t).toBeGreaterThanOrEqual(50); // first scan is the earliest cause
    const stopped = advanceUntil(h, (e) => e.type === 'trainStopped', 15_000);
    expect(stopped).not.toBeNull();
    if (stopped !== null) {
      expect(stopped.t).toBeGreaterThan(5_000);    // only the notaus press stops it
      expect(stopped.t).toBeLessThan(10_000);      // decel lag, but well within bounds
    }
    const snapshot = h.coordinator.snapshot();
    expect(snapshot.train.speedMmS).toBe(0);
    expect(snapshot.notausActive).toBe(true);
    // The program (not the plant) enforced the stop: STOP flag must be set.
    expect(h.emulator.peekBit('STOP')).toBe(true);
  });
});
