/**
 * §9.1 scancycle.test.ts: PAE latched (input change mid-scan invisible until next scan);
 * timers advance before the program (expiry visible same scan); reset() clears memory,
 * timers, counters, edge memories, cycle count, keeps program; load() error keeps the
 * old program.
 */
import { describe, expect, it } from 'vitest';
import { bit, loadOrThrow, makeEmulator, stepN } from './fixtures';

describe('PAE latching', () => {
  it('an input written after a scan is invisible until the next scan', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);
    em.setInputBit(bit('E 0.0'), false);           // between scans — result unchanged
    expect(em.peekBit('M 10.0')).toBe(true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('two reads of the same input within one scan are consistent', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\n= M 10.0\nU E 0.0\n= M 10.1');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(em.peekBit('M 10.1'));
  });
});

describe('timer advance before program (§6.2)', () => {
  it('an expiry that lands on this scan is visible to the same scan', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL S5T#100MS\nSV T 10\nU T 10\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // scan 1: start; Q=1
    em.setInputBit(bit('E 0.0'), false);
    em.step(50);                                   // scan 2: remaining 50 ms; Q=1
    expect(em.peekBit('M 10.0')).toBe(true);
    em.step(50);                                   // scan 3: advance FIRST → expired → program sees Q=0
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.getTimer(10).running).toBe(false);
  });

  it('a large dt expires the timer in a single step', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL S5T#100MS\nSV T 10\nU T 10\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);                                   // start
    em.step(5000);                                 // way past expiry
    expect(em.peekBit('M 10.0')).toBe(false);
  });
});

describe('cycle counting and ScanResult', () => {
  it('increments per step and reports it in ScanResult', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'NOP 0');
    expect(em.cycleCount).toBe(0);
    expect(em.step(50).cycle).toBe(1);
    expect(em.step(50).cycle).toBe(2);
    expect(em.cycleCount).toBe(2);
  });

  it('trace=true records one entry per executed instruction with statusAfter', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\n= M 10.0\nL 7');
    em.setInputBit(bit('E 0.0'), true);
    const res = em.step(50, true);
    expect(res.trace).toHaveLength(3);
    expect(res.trace![0]).toMatchObject({ instrIndex: 0, line: 1, statusAfter: { vke: true, erab: true } });
    expect(res.trace![2]!.statusAfter.accu1).toBe(7);
    expect(em.step(50).trace).toBeUndefined();      // trace off by default
  });

  it('rejects negative dt', () => {
    const em = makeEmulator();
    expect(() => em.step(-1)).toThrow(RangeError);
  });
});

describe('reset()', () => {
  it('clears memory, timers, counters, edge memories and cycle count — keeps the program', () => {
    const em = makeEmulator();
    loadOrThrow(em, [
      'U E 0.0', 'FP M 11.0', '= M 10.0',
      'U E 0.0', 'ZV Z 1',
      'U E 0.0', 'L S5T#500MS', 'SS T 13',
      'L 7', 'T MW 12',
    ].join('\n'));
    em.setInputBit(bit('E 0.0'), true);
    stepN(em, 3);
    expect(em.getCounter(1).value).toBe(1);
    expect(em.getTimer(13).running).toBe(true);
    expect(em.peekWord('MW 12')).toBe(7);

    em.reset();

    expect(em.cycleCount).toBe(0);
    expect(em.peekBit('M 10.0')).toBe(false);
    expect(em.peekBit('M 11.0')).toBe(false);       // FP edge memory (a Merker bit) cleared
    expect(em.peekWord('MW 12')).toBe(0);
    expect(em.peekBit('E 0.0')).toBe(false);        // PAE cleared too
    expect(em.getTimer(13)).toMatchObject({ q: false, running: false, remainingMs: 0, presetMs: 0 });
    expect(em.getCounter(1)).toMatchObject({ value: 0, q: false });
    const st = em.getStatus();
    expect(st).toEqual({ vke: false, erab: false, accu1: 0, accu2: 0 });
    expect(em.hasProgram()).toBe(true);             // program kept

    // edge memories cleared: a held input fires FP / ZV again after reset
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // FP fires again
    expect(em.getCounter(1).value).toBe(1);         // ZV counts again
  });
});

describe('load()', () => {
  it('an erroneous load keeps the previously loaded program', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\n= M 10.0');
    const bad = em.load('FOO BAR');
    expect(bad.ok).toBe(false);
    expect(bad.program).toBeUndefined();
    expect(bad.diagnostics.map((d) => d.code)).toContain('E-SYN-001');
    expect(em.hasProgram()).toBe(true);
    em.setInputBit(bit('E 0.0'), true);
    em.step(50);
    expect(em.peekBit('M 10.0')).toBe(true);        // old program still runs
  });

  it('a successful load replaces the program and reports it', () => {
    const em = makeEmulator();
    const res = em.load('U E 0.0\n= M 10.0');
    expect(res.ok).toBe(true);
    expect(res.program?.instructions).toHaveLength(2);
    expect(em.hasProgram()).toBe(true);
  });

  it('warnings do not block loading (ok=true with W-… diagnostics)', () => {
    const em = makeEmulator();
    const res = em.load('U E 0.0\n= M 130.0');      // W-RES-001
    expect(res.ok).toBe(true);
    expect(res.diagnostics.map((d) => d.code)).toContain('W-RES-001');
  });

  it('an emulator without a program steps harmlessly', () => {
    const em = makeEmulator();
    expect(em.hasProgram()).toBe(false);
    const res = em.step(50);
    expect(res.cycle).toBe(1);
    expect(res.diagnostics).toEqual([]);
  });
});

describe('R-RUN-001 (invalid S5TIME in accu1 on timer start)', () => {
  it('fires when accu1 holds invalid BCD at the start edge and skips the start', () => {
    const em = makeEmulator();
    // L 15 → 0x000F → low nibble F is not BCD
    loadOrThrow(em, 'U E 0.0\nL 15\nSV T 10\nU T 10\n= M 10.0');
    em.setInputBit(bit('E 0.0'), true);
    const res = em.step(50);
    expect(res.diagnostics.map((d) => d.code)).toContain('R-RUN-001');
    expect(em.getTimer(10).running).toBe(false);    // start skipped
    expect(em.peekBit('M 10.0')).toBe(false);
  });

  it('does not fire while the start input stays low', () => {
    const em = makeEmulator();
    loadOrThrow(em, 'U E 0.0\nL 15\nSV T 10');
    const res = em.step(50);
    expect(res.diagnostics).toEqual([]);
  });
});
