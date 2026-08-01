/**
 * Public API surface of the pump scene (ARCHITECTURE.md §2 rule 7 — no deep imports).
 *
 * This sub-module is the only part of `pump/` that touches Three.js and the DOM; the plant
 * layer above it stays headless, which is why the renderer lives here and not in
 * `pump/index.ts`. It reads `PumpSnapshot` and calls host callbacks, and — like `scene/` —
 * never mutates the plant.
 */

// ── contract (mirrors scene/SceneManager) ──
export { PumpScene, type PumpSceneConfig } from './PumpScene';
export {
  PUMP_PICK_PREFIX,
  PumpPointer,
  pickTargetOf,
  pumpPickKey,
  pumpPickName,
  resolvePumpPick,
  type NdcPoint,
  type PumpPickTarget,
  type PumpPointerCallbacks,
} from './picking';
export {
  PUMP_ORBIT_LIMITS,
  PUMP_PLANT_RADIUS,
  PumpOrbit,
  type PumpOrbitLimits,
} from './orbit';

// ── scene-internal pieces (exported so tests and future tooling need no deep import) ──
export {
  buildPumpSceneGraph,
  type PumpSceneGraph,
  type PumpSceneGraphConfig,
} from './graph';
export {
  LIQUID_BOTTOM_Y,
  LIQUID_HEIGHT,
  LIQUID_RADIUS,
  PUMP_DIM,
  dischargeOutlet,
  drainLinePoints,
  drainOutlet,
  levelY,
  panelNormal,
  panelPoint,
  pumpLinePoints,
  refillLinePoints,
  refillOutlet,
  tankCentreX,
  valveBody,
  type PumpTankId,
} from './dims';
export {
  DisposeBag,
  PUMP_PALETTE,
  createPumpMaterials,
  disposePumpMaterials,
  type PumpSceneMaterials,
} from './materials';
export {
  PUMP_ACTUATOR_SYMBOL,
  PUMP_BUTTON_SYMBOL,
  PUMP_SENSOR_SYMBOL,
  PUMP_TOGGLE_SYMBOL,
  makePumpPlate,
  signalPlateText,
  type PlatePlacement,
} from './plates';
export {
  FlowPhase,
  MIN_STREAM_HEIGHT,
  RIPPLE_PERIOD_MS,
  RIPPLE_RINGS,
  buildFlowBeads,
  buildRipple,
  buildStream,
  buildStreamGeometry,
  pipeCurve,
  type FlowBeadsVisual,
  type RippleVisual,
  type StreamVisual,
} from './water';
export { buildTank, type ProbeVisual, type TankVisual } from './tanks';
export {
  buildPipeRun,
  buildPumpUnit,
  buildValve,
  impellerTurnsPerSecond,
  type PipeRunVisual,
  type PumpUnitVisual,
  type ValveVisual,
} from './piping';
export { buildPedestal, type PedestalVisual } from './pedestal';
