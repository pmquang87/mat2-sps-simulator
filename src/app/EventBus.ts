/**
 * Typed pub/sub for SimEvent (ARCHITECTURE.md §5.2): plant/emulator → ui/pedagogy.
 *
 * Emission order is the coordinator's responsibility (§5.2 step 3, §6.3); the bus only
 * fans out. Listeners are notified over a snapshot of the listener set, so subscribing or
 * unsubscribing from inside a handler never disturbs the current dispatch.
 */
import type { SimEvent } from '../plant';

export type Unsubscribe = () => void;

export class EventBus {
  private readonly listeners = new Set<(e: SimEvent) => void>();

  emit(e: SimEvent): void {
    if (this.listeners.size === 0) return;
    for (const cb of Array.from(this.listeners)) cb(e);
  }

  on(cb: (e: SimEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Drop every listener (UI teardown / test isolation). */
  clear(): void {
    this.listeners.clear();
  }
}
