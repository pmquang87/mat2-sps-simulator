/**
 * Label plates of the pump scene.
 *
 * Same didactic role as the white stickers on the model railway (`scene/labels.ts`): the
 * plate is the bridge between the thing the student sees and the operand they type. Here it
 * carries the SYMBOL and the ABSOLUTE ADDRESS — `S1 (E 0.0)` — because the Anleitung's own
 * snippets address the pump absolutely and the students are expected to recognise both
 * spellings.
 *
 * The address is never written twice: it is read out of `PUMP_VARIABLES`, the same list
 * `buildPumpWiring` verifies against the manual, so a plate cannot drift from the wiring.
 *
 * The plates are `LabelFactory` plates, i.e. sized in millimetres of a 1:120 railway; they
 * are scaled up uniformly (`PUMP_DIM.labelScale`) rather than re-dimensioned, which keeps
 * the plate aspect matched to the text texture the factory renders.
 */
import { Mesh, Vector3 } from 'three';
import { LabelFactory } from '../../scene';
import { PUMP_SYMBOL_NAMES, PUMP_VARIABLES } from '../variables';
import type {
  PumpActuatorId, PumpButtonId, PumpSensorId, PumpToggleId,
} from '../types';
import { PUMP_DIM } from './dims';

/** Plant id → symbol name, so each visual knows which plate text it carries. */
export const PUMP_SENSOR_SYMBOL: Readonly<Record<PumpSensorId, string>> = {
  llsA: PUMP_SYMBOL_NAMES.llsA,
  hlsA: PUMP_SYMBOL_NAMES.hlsA,
  llsB: PUMP_SYMBOL_NAMES.llsB,
  hlsB: PUMP_SYMBOL_NAMES.hlsB,
  ls: PUMP_SYMBOL_NAMES.ls,
};

export const PUMP_BUTTON_SYMBOL: Readonly<Record<PumpButtonId, string>> = {
  S1: PUMP_SYMBOL_NAMES.s1,
  S0: PUMP_SYMBOL_NAMES.s0,
};

export const PUMP_TOGGLE_SYMBOL: Readonly<Record<PumpToggleId, string>> = {
  'E0.7': PUMP_SYMBOL_NAMES.toggle07,
  'E1.0': PUMP_SYMBOL_NAMES.toggle10,
  'E1.1': PUMP_SYMBOL_NAMES.toggle11,
  'E1.2': PUMP_SYMBOL_NAMES.toggle12,
  'E1.3': PUMP_SYMBOL_NAMES.toggle13,
  'E1.4': PUMP_SYMBOL_NAMES.toggle14,
  'E1.7': PUMP_SYMBOL_NAMES.toggle17,
};

export const PUMP_ACTUATOR_SYMBOL: Readonly<Record<PumpActuatorId, string>> = {
  pump: PUMP_SYMBOL_NAMES.pump,
  'A0.2': PUMP_SYMBOL_NAMES.lamp2,
  'A0.3': PUMP_SYMBOL_NAMES.lamp3,
};

/** symbol → canonical address text, from the verified variables list. */
const ADDRESS_OF = new Map<string, string>(
  PUMP_VARIABLES.entries.map((e) => [e.symbol, e.address] as const),
);

/**
 * `"<symbol> (<address>)"` for a wired signal. Throws for an unknown symbol: a plate whose
 * address silently vanished would teach the wrong operand, so this fails at build time.
 */
export function signalPlateText(symbol: string): string {
  const address = ADDRESS_OF.get(symbol);
  if (address === undefined) {
    throw new Error(`signalPlateText: "${symbol}" is not in the pump variables list`);
  }
  return `${symbol} (${address})`;
}

export interface PlatePlacement {
  /** Plate centre, expressed in the frame of the parent the plate is added to (world for
   *  the tank/valve plates, panel-local for the console plates). */
  readonly at: Vector3;
  /** What the plate names, in WORLD space — `deconflictPlates` pulls a crowded plate back
   *  towards it (D17), and it compares anchors across the whole graph. */
  readonly anchor: Vector3;
  /** Rotation about world y, radians (0 = text runs along +x). */
  readonly yawRad?: number;
  /** Lean out of the horizontal plane, radians (0 = flat). Console plates use the panel tilt. */
  readonly tiltRad?: number;
}

/**
 * Creates a plate and places it. The plate keeps `LabelFactory`'s `'YXZ'` rotation order,
 * so `yawRad` is applied around world y and the tilt stays in `rotation.x`.
 */
export function makePumpPlate(
  labels: LabelFactory,
  text: string,
  place: PlatePlacement,
): Mesh {
  const plate = labels.createPlate(text, { tiltRad: place.tiltRad ?? PUMP_DIM.labelTiltRad });
  plate.scale.setScalar(PUMP_DIM.labelScale);
  plate.position.copy(place.at);
  plate.rotation.y = place.yawRad ?? 0;
  plate.userData['anchorWorld'] = place.anchor.clone();
  return plate;
}
