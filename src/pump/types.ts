/**
 * Ids and events of the pump experiment (Anleitung IV.2.5.2, Abbildung 4 — the teaching
 * example on which the manual introduces the whole instruction set).
 *
 * The ids are the currency between plant, coordinator, scene and UI. The E/A addresses
 * behind them are fixed by the Anleitung and live in `variables.ts` / `wiring.ts`; nothing
 * below the coordinator ever sees an address.
 */

/** Sensor bits the plant drives into the process image. */
export type PumpSensorId =
  | 'llsA'   // E 0.1 — Leermeldung Tank A  (1 = A empty)
  | 'hlsA'   // E 0.2 — Vollmeldung Tank A  (1 = A full)
  | 'llsB'   // E 0.3 — Leermeldung Tank B  (1 = B empty)
  | 'hlsB'   // E 0.4 — Vollmeldung Tank B  (1 = B full)
  | 'ls';    // E 0.5 — Trockenlaufschutz   (1 = wetted)

/** Momentary push-buttons on the pedestal. */
export type PumpButtonId = 'S1' | 'S0';        // E 0.0 start, E 0.6 stop

/**
 * Plain toggle switches on the pedestal, so the manual's timer/edge/jump snippets have real
 * operands to work with. Ids are the address spelling on purpose — the student reads
 * `U E 1.0` in the manual and looks for the switch labelled E 1.0.
 *
 * `E0.7` is not a free choice: the manual's FP/FN examples (IV.2.7) and its jump cascade
 * (IV.2.8) query `E 0.7` literally, so without this switch those snippets address an input
 * nothing on the plant can drive. The list is in ADDRESS order — that is the order the
 * pedestal lays the switches out in and the order a student scans for an address.
 */
export type PumpToggleId = 'E0.7' | 'E1.0' | 'E1.1' | 'E1.2' | 'E1.3' | 'E1.4' | 'E1.7';

export const PUMP_TOGGLE_IDS: readonly PumpToggleId[] =
  ['E0.7', 'E1.0', 'E1.1', 'E1.2', 'E1.3', 'E1.4', 'E1.7'];

/** PLC-driven outputs: the pump plus two indicator lamps. */
export type PumpActuatorId = 'pump' | 'A0.2' | 'A0.3';   // A 0.1, A 0.2, A 0.3

export const PUMP_ACTUATOR_IDS: readonly PumpActuatorId[] = ['pump', 'A0.2', 'A0.3'];

/** Hand valves — plant-side user actions, NOT PLC outputs: refill into A, drain out of B.
 *  They exist so every sensor combination of the Anleitung's map is reachable live. */
export type PumpValveId = 'inA' | 'outB';

export const PUMP_VALVE_IDS: readonly PumpValveId[] = ['inA', 'outB'];

export const PUMP_SENSOR_IDS: readonly PumpSensorId[] = ['llsA', 'hlsA', 'llsB', 'hlsB', 'ls'];

export const PUMP_BUTTON_IDS: readonly PumpButtonId[] = ['S1', 'S0'];

/**
 * Pump-side counterpart of the railway `SimEvent` union. Times are simulated ms, stamped
 * with the plant's post-step time exactly like the railway plant does (§5.2 step 3), so a
 * drained batch is chronological.
 */
export type PumpEvent =
  | { t: number; type: 'sensor';   id: PumpSensorId;   value: boolean }
  | { t: number; type: 'actuator'; id: PumpActuatorId; on: boolean }
  | { t: number; type: 'button';   id: PumpButtonId;   pressed: boolean }
  | { t: number; type: 'toggle';   id: PumpToggleId;   value: boolean }
  | { t: number; type: 'valve';    id: PumpValveId;    open: boolean }
  | { t: number; type: 'tankFull';  tank: 'A' | 'B' }   // level reached 100 % (B overflows)
  | { t: number; type: 'tankEmpty'; tank: 'A' | 'B' }   // level reached 0 %
  | { t: number; type: 'paramsChanged' };

export type Unsubscribe = () => void;

/**
 * Typed fan-out for PumpEvent — the pump twin of `app/EventBus`, which is typed to the
 * railway `SimEvent` union. Deliberate duplication: widening the railway bus would change a
 * delivered, test-pinned module for no functional gain (see the module note in index.ts).
 */
export class PumpEventBus {
  private readonly listeners = new Set<(e: PumpEvent) => void>();

  emit(e: PumpEvent): void {
    if (this.listeners.size === 0) return;
    for (const cb of Array.from(this.listeners)) cb(e);
  }

  on(cb: (e: PumpEvent) => void): Unsubscribe {
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
