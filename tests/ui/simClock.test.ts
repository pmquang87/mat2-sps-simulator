/**
 * SimClock + EventBus unit tests (ARCHITECTURE.md §5.2, §6.1).
 *
 * Scope note: these two are src/app units owned by the ui-app agent, so their tests live
 * next to that agent's other tests. The app-level INTEGRATION suites named in §9.3
 * (tests/app/coordinator.test.ts, tests/app/determinism.test.ts) belong to the
 * tests-integration agent and are not duplicated here.
 */
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/app/EventBus';
import { SimClock } from '../../src/app/SimClock';
import type { SimEvent } from '../../src/plant/plant';

describe('SimClock', () => {
  it('accumulates real time into whole 10 ms steps', () => {
    const clock = new SimClock();
    expect(clock.physicsStepMs).toBe(10);
    expect(clock.accumulate(4)).toBe(0);
    expect(clock.simTimeMs).toBe(0);
    expect(clock.accumulate(7)).toBe(1);          // 11 ms accumulated → one step
    expect(clock.simTimeMs).toBe(10);
    expect(clock.pendingMs).toBeCloseTo(1, 10);
  });

  it('keeps simulated time an integer multiple of the step', () => {
    const clock = new SimClock();
    let steps = 0;
    for (let i = 0; i < 20; i++) steps += clock.accumulate(16.6667);
    expect(clock.simTimeMs).toBe(steps * 10);
    expect(Number.isInteger(clock.simTimeMs)).toBe(true);
  });

  it('applies the time scale exactly once', () => {
    const clock = new SimClock();
    clock.timeScale = 4;
    expect(clock.accumulate(10)).toBe(4);         // 10 ms real × 4 = 40 ms simulated
    expect(clock.simTimeMs).toBe(40);
  });

  it('is paused at timeScale 0', () => {
    const clock = new SimClock();
    clock.timeScale = 0;
    expect(clock.accumulate(100)).toBe(0);
    expect(clock.simTimeMs).toBe(0);
  });

  it('clips absurd frame times instead of bursting', () => {
    const clock = new SimClock();
    expect(clock.accumulate(60_000)).toBe(SimClock.maxRealDtMs / 10);
  });

  it('ignores non-finite and non-positive deltas', () => {
    const clock = new SimClock();
    expect(clock.accumulate(Number.NaN)).toBe(0);
    expect(clock.accumulate(-5)).toBe(0);
    expect(clock.accumulate(0)).toBe(0);
    expect(clock.simTimeMs).toBe(0);
  });

  it('reset() clears time and the accumulator', () => {
    const clock = new SimClock();
    clock.accumulate(35);
    clock.reset();
    expect(clock.simTimeMs).toBe(0);
    expect(clock.pendingMs).toBe(0);
  });
});

describe('EventBus', () => {
  const event: SimEvent = { t: 50, type: 'trainStopped' };

  it('fans out to every listener', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on(a);
    bus.on(b);
    bus.emit(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const off = bus.on(listener);
    bus.emit(event);
    off();
    bus.emit(event);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tolerates unsubscribing from inside a handler', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const offSecond = bus.on(second);
    bus.on(() => offSecond());
    bus.emit(event);                    // the snapshot still reaches `second`
    expect(second).toHaveBeenCalledTimes(1);
    bus.emit(event);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clear() drops all listeners', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on(listener);
    bus.clear();
    bus.emit(event);
    expect(listener).not.toHaveBeenCalled();
  });
});
