/**
 * SimCoordinator loop-order tests (ARCHITECTURE.md §5.2 — the ordering is BINDING).
 *
 * Scope note: the full app-level integration suites of §9.3 (tests/app/coordinator.test.ts,
 * tests/app/determinism.test.ts, driven by the REAL Emulator and Plant) belong to the
 * tests-integration agent. This file pins the coordinator implementation itself against
 * hand-written doubles, so the loop order is verified while core/ and plant/ are still
 * being built.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/EventBus';
import { SimCoordinator } from '../../src/app/SimCoordinator';
import type { Wiring } from '../../src/app/Wiring';
import type { BitAddress, Emulator, ScanResult, WordAddress } from '../../src/core';
import type { Plant, PlantSnapshot, SimEvent } from '../../src/plant';

const M120 = 120;

function bit(area: 'E' | 'A' | 'M', byte: number, index: number): BitAddress {
  return { kind: 'bit', area, byte, bit: index };
}

const wiring: Wiring = {
  reedInput: new Map([['r1', bit('E', 0, 0)], ['r2', bit('E', 0, 1)]]),
  switchCoils: new Map([['sw1', { G: bit('M', 100, 0), R: bit('M', 106, 0) }]]),
  // no unplaced switches in this double — the real-data case is pinned in tests/app
  unplacedCoils: new Map(),
  notausInput: bit('E', 1, 7),
  fahrstromWord: { kind: 'word', area: 'AW', byte: 6 },
  speedBits: {
    s3iu: bit('M', M120, 0),
    s2iu: bit('M', M120, 1),
    s1iu: bit('M', M120, 2),
    stop: bit('M', M120, 3),
    s1gu: bit('M', M120, 4),
    s2gu: bit('M', M120, 5),
    s3gu: bit('M', M120, 6),
  },
};

/** Minimal stand-ins for the process image and the two facades the coordinator drives. */
function makeHarness(options: { reedLatches?: Record<string, boolean> } = {}) {
  const log: string[] = [];
  const inputs = new Uint8Array(16);
  const outputs = new Uint8Array(16);
  const flags = new Uint8Array(256);
  let scanDt = 0;
  let scans = 0;
  const plantEvents: SimEvent[] = [];

  const memory = {
    inputs, outputs, flags,
    getBit: (a: BitAddress): boolean => {
      const bank = a.area === 'E' ? inputs : a.area === 'A' ? outputs : flags;
      return ((bank[a.byte] ?? 0) & (1 << a.bit)) !== 0;
    },
    setBit: (a: BitAddress, v: boolean): void => {
      const bank = a.area === 'E' ? inputs : a.area === 'A' ? outputs : flags;
      const current = bank[a.byte] ?? 0;
      bank[a.byte] = v ? current | (1 << a.bit) : current & ~(1 << a.bit);
    },
    getWord: (a: WordAddress): number => ((outputs[a.byte] ?? 0) << 8) | (outputs[a.byte + 1] ?? 0),
    setWord: (a: WordAddress, v: number): void => {
      log.push(`memory.setWord ${a.area} ${a.byte}=${v}`);
      outputs[a.byte] = (v >> 8) & 0xff;
      outputs[a.byte + 1] = v & 0xff;
    },
    reset: (): void => {
      inputs.fill(0);
      outputs.fill(0);
      flags.fill(0);
    },
  };

  const emulator = {
    memory,
    get cycleCount(): number { return scans; },
    setInputBit: (a: BitAddress, v: boolean): void => {
      log.push(`setInputBit ${a.area} ${a.byte}.${a.bit}=${v ? 1 : 0}`);
      memory.setBit(a, v);
    },
    step: (dtMs: number): ScanResult => {
      log.push(`emulator.step ${dtMs}`);
      scanDt = dtMs;
      scans++;
      return { cycle: scans, diagnostics: [] };
    },
    reset: (): void => {
      log.push('emulator.reset');
      memory.reset();
      scans = 0;
    },
  } as unknown as Emulator;

  const plant = {
    step: (dtMs: number): void => {
      log.push(`plant.step ${dtMs}`);
    },
    setSwitchCoil: (id: string, coil: 'G' | 'R', level: boolean): void => {
      log.push(`setSwitchCoil ${id} ${coil}=${level ? 1 : 0}`);
    },
    setFahrstromWord: (word: number): void => {
      log.push(`setFahrstromWord ${word}`);
    },
    setNotaus: (active: boolean): void => {
      log.push(`setNotaus ${active ? 1 : 0}`);
    },
    consumeReedLatch: (id: string): boolean => options.reedLatches?.[id] ?? false,
    get notausActive(): boolean { return false; },
    snapshot: (): PlantSnapshot => ({ timeMs: 0 } as unknown as PlantSnapshot),
    drainEvents: (): SimEvent[] => plantEvents.splice(0, plantEvents.length),
    reset: (): void => {
      log.push('plant.reset');
    },
  } as unknown as Plant;

  return {
    log, flags, outputs, plantEvents, emulator, plant,
    get scanDt(): number { return scanDt; },
    get scans(): number { return scans; },
  };
}

describe('SimCoordinator loop order (§5.2)', () => {
  it('runs the first scan POST-step at simTimeMs = scanIntervalMs, never at t = 0', () => {
    const h = makeHarness();
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 50 });
    coordinator.advanceSteps(4);
    expect(coordinator.simTimeMs).toBe(40);
    expect(h.scans).toBe(0);
    coordinator.advanceSteps(1);
    expect(coordinator.simTimeMs).toBe(50);
    expect(h.scans).toBe(1);
    expect(h.scanDt).toBe(50);
  });

  it('runs exactly one scan per scanInterval/10 physics steps', () => {
    const h = makeHarness();
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 20 });
    coordinator.advanceSteps(10);              // 100 ms → 5 scans
    expect(h.scans).toBe(5);
    expect(h.log.filter((entry) => entry.startsWith('plant.step')).length).toBe(10);
  });

  it('ferries I/O in the binding order: physics → PAE → scan → actuators', () => {
    const h = makeHarness({ reedLatches: { r1: true } });
    h.flags[100] = 0b1;                        // coil G of sw1 asserted by the "program"
    h.flags[M120] = 1 << 2;                    // Speed1IU
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 10 });
    coordinator.advanceSteps(1);
    expect(h.log).toEqual([
      'plant.step 10',
      'setInputBit E 0.0=1',
      'setInputBit E 0.1=0',
      'setInputBit E 1.7=1',                   // Notaus is 0-active: not pressed ⇒ 1
      'emulator.step 10',
      'setSwitchCoil sw1 G=1',
      'setSwitchCoil sw1 R=0',
      'memory.setWord AW 6=1',                 // AW 6 written back for the watch table
      'setFahrstromWord 1',
    ]);
  });

  it('emits plant events before coordinator events, sorted by time', () => {
    const h = makeHarness();
    h.flags[M120] = (1 << 2) | (1 << 4);       // Speed1IU + Speed1GU ⇒ conflict
    const bus = new EventBus();
    const seen: SimEvent[] = [];
    bus.on((e) => seen.push(e));
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, bus,
                                           { scanIntervalMs: 10 });
    h.plantEvents.push({ t: 10, type: 'trainStopped' });
    h.plantEvents.push({ t: 5, type: 'reedClosed', reedId: 'r1' });
    coordinator.advanceSteps(1);
    expect(seen.map((e) => `${e.t}:${e.type}`)).toEqual([
      '5:reedClosed',
      '10:trainStopped',
      '10:speedConflict',
    ]);
  });

  it('plays scenario actions before the step whose post-step time reaches atMs', () => {
    const h = makeHarness();
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 50 });
    coordinator.loadScenario([{ atMs: 25, action: 'notaus', active: true }]);
    coordinator.advanceSteps(2);               // post-step times 10, 20 → not yet due
    expect(h.log).not.toContain('setNotaus 1');
    coordinator.advanceSteps(1);               // post-step time 30 ≥ 25 → applied first
    expect(h.log.indexOf('setNotaus 1')).toBeLessThan(h.log.lastIndexOf('plant.step 10'));
  });

  it('reset() clears time, the scenario and the last scan result', () => {
    const h = makeHarness();
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 10 });
    coordinator.loadScenario([{ atMs: 500, action: 'notaus', active: true }]);
    coordinator.advanceSteps(1);
    expect(coordinator.lastScan).not.toBeNull();
    coordinator.reset();
    expect(coordinator.simTimeMs).toBe(0);
    expect(coordinator.lastScan).toBeNull();
    expect(h.log).toContain('emulator.reset');
    expect(h.log).toContain('plant.reset');
    coordinator.advanceSteps(60);              // scenario cleared ⇒ never fires again
    expect(h.log).not.toContain('setNotaus 1');
  });

  it('re-asserts forced inputs AFTER the PAE write, and still consumes the reed latch', () => {
    const h = makeHarness({ reedLatches: { r1: true } });
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 10 });
    expect(coordinator.forceInputBit(bit('E', 0, 1), true)).toBe(true);   // reed r2's input
    expect(coordinator.forceInputBit(bit('E', 1, 7), true)).toBe(false);  // Notaus keeps its button
    expect(coordinator.forceInputBit(bit('M', 10, 0), true)).toBe(false); // inputs only
    h.log.length = 0;                                    // drop the immediate force write
    coordinator.advanceSteps(1);
    expect(h.log).toEqual([
      'plant.step 10',
      'setInputBit E 0.0=1',
      'setInputBit E 0.1=0',      // the peripheral write still runs → the latch IS consumed
      'setInputBit E 1.7=1',
      'setInputBit E 0.1=1',      // …and the force wins, re-asserted after it
      'emulator.step 10',
      'setSwitchCoil sw1 G=0',
      'setSwitchCoil sw1 R=0',
      'memory.setWord AW 6=0',
      'setFahrstromWord 0',
    ]);
  });

  it('releasing a force, clearForcedInputs() and reset() hand the bits back', () => {
    const h = makeHarness({ reedLatches: { r1: true } });
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                           { scanIntervalMs: 10 });
    coordinator.forceInputBit(bit('E', 0, 1), true);
    coordinator.advanceSteps(1);
    expect(h.emulator.memory.getBit(bit('E', 0, 1))).toBe(true);

    coordinator.forceInputBit(bit('E', 0, 1), false);     // false = release + clear
    expect(coordinator.isInputForced(bit('E', 0, 1))).toBe(false);
    coordinator.advanceSteps(1);
    expect(h.emulator.memory.getBit(bit('E', 0, 1))).toBe(false);

    coordinator.forceInputBit(bit('E', 0, 1), true);
    coordinator.clearForcedInputs();
    coordinator.advanceSteps(1);
    expect(h.emulator.memory.getBit(bit('E', 0, 1))).toBe(false);

    coordinator.forceInputBit(bit('E', 0, 1), true);
    coordinator.reset();
    expect(coordinator.isInputForced(bit('E', 0, 1))).toBe(false);
  });

  it('rejects scan intervals outside 10…200 ms or not a multiple of 10', () => {
    const h = makeHarness();
    expect(() => new SimCoordinator(h.emulator, h.plant, wiring, new EventBus(),
                                    { scanIntervalMs: 55 })).toThrow(RangeError);
    const coordinator = new SimCoordinator(h.emulator, h.plant, wiring, new EventBus());
    expect(coordinator.scanInterval).toBe(50);
    expect(() => coordinator.setScanInterval(5)).toThrow(RangeError);
    expect(() => coordinator.setScanInterval(300)).toThrow(RangeError);
    coordinator.setScanInterval(200);
    expect(coordinator.scanInterval).toBe(200);
  });
});
