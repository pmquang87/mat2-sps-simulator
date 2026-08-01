/**
 * Composition of the pump scene graph, and the one `update(snapshot, alphaMs)` that drives
 * every animated property from it.
 *
 * Renderer-free on purpose: `PumpScene` adds the WebGL renderer, the camera and the DOM
 * listeners, this file builds and animates the object graph. That split is what lets the
 * unit tests measure liquid heights, probe positions, stream geometry and label footprints
 * in the node environment, against the SAME graph the browser renders.
 *
 * Animation contract (owner requirement):
 *  - every cue is a function of the snapshot plus SIM time (`timeMs + alphaMs`);
 *  - travel phases are integrated from the sim-time delta, so a rate change accelerates a
 *    stream instead of teleporting it, and re-applying the same snapshot changes nothing;
 *  - a cue vanishes in the frame its flow reaches zero.
 */
import {
  CircleGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three';
import { LabelFactory, deconflictPlates, type SceneQuality } from '../../scene';
import {
  PUMP_ACTUATOR_IDS,
  PUMP_BUTTON_IDS,
  PUMP_TOGGLE_IDS,
  PUMP_VALVE_IDS,
} from '../types';
import type { PumpSnapshot } from '../model';
import { PUMP_PARAM_DEFAULTS } from '../params';
import {
  LIQUID_RADIUS,
  PUMP_DIM,
  dischargeOutlet,
  drainLinePoints,
  drainOutlet,
  levelY,
  pumpLinePoints,
  refillLinePoints,
  refillOutlet,
} from './dims';
import {
  DisposeBag,
  createPumpMaterials,
  disposePumpMaterials,
  type PumpSceneMaterials,
} from './materials';
import { buildPipeRun, buildPumpUnit, buildValve, impellerTurnsPerSecond } from './piping';
import { buildPedestal } from './pedestal';
import { buildTank } from './tanks';
import { PUMP_SENSOR_SYMBOL } from './plates';
import { pumpPickKey, type PumpPickTarget } from './picking';
import { FlowPhase, buildRipple, buildStream, type RippleVisual, type StreamVisual } from './water';

/** Lateral bow of a falling stream, metres — also the offset of its impact ripple. */
const STREAM_BOW_M = 0.018;

/** Laps per second of the bead train at 1 %/s of flow. */
const BEAD_LAPS_PER_PCT = 0.06;

export interface PumpSceneGraphConfig {
  readonly quality?: SceneQuality;
}

export interface PumpSceneGraph {
  readonly root: Group;
  readonly materials: PumpSceneMaterials;
  update(snapshot: PumpSnapshot, alphaMs: number): void;
  setHighlight(target: PumpPickTarget | null): void;
  setLabelsVisible(visible: boolean): void;
  dispose(): void;
}

export function buildPumpSceneGraph(cfg: PumpSceneGraphConfig = {}): PumpSceneGraph {
  const quality = cfg.quality ?? 'high';
  const mats = createPumpMaterials(quality);
  const labels = new LabelFactory(quality);
  const bag = new DisposeBag();
  const root = new Group();
  root.name = 'pump:root';

  // ── floor ────────────────────────────────────────────────────────────────────────────
  const floor = new Mesh(
    bag.add(new PlaneGeometry(PUMP_DIM.floorWidth, PUMP_DIM.floorDepth)),
    mats.floor,
  );
  floor.name = 'pump:floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const drainGrate = new Mesh(bag.add(new CircleGeometry(0.09, 20)), mats.steelDark);
  drainGrate.name = 'pump:floorDrain';
  drainGrate.rotation.x = -Math.PI / 2;
  drainGrate.position.set(PUMP_DIM.drainOutletX, PUMP_DIM.floorDrainY, PUMP_DIM.tankZ);
  root.add(drainGrate);

  // ── vessels ──────────────────────────────────────────────────────────────────────────
  const tankA = buildTank({
    id: 'A',
    lowSensor: 'llsA',
    highSensor: 'hlsA',
    lowSymbol: PUMP_SENSOR_SYMBOL.llsA,
    highSymbol: PUMP_SENSOR_SYMBOL.hlsA,
    mats,
    labels,
    bag,
  });
  const tankB = buildTank({
    id: 'B',
    lowSensor: 'llsB',
    highSensor: 'hlsB',
    lowSymbol: PUMP_SENSOR_SYMBOL.llsB,
    highSymbol: PUMP_SENSOR_SYMBOL.hlsB,
    mats,
    labels,
    bag,
  });
  root.add(tankA.object, tankB.object);

  // ── machinery ────────────────────────────────────────────────────────────────────────
  const unit = buildPumpUnit({ mats, labels, bag, lsSymbol: PUMP_SENSOR_SYMBOL.ls });
  root.add(unit.object);

  const pumpLine = buildPipeRun({ name: 'pump:line:pump', points: pumpLinePoints(), mats, bag });
  const refillLine = buildPipeRun({
    name: 'pump:line:refill', points: refillLinePoints(), mats, bag,
  });
  const drainLine = buildPipeRun({ name: 'pump:line:drain', points: drainLinePoints(), mats, bag });
  root.add(pumpLine.object, refillLine.object, drainLine.object);

  const valves = PUMP_VALVE_IDS.map((id) => buildValve({ id, mats, labels, bag }));
  for (const valve of valves) root.add(valve.object);

  // ── console ──────────────────────────────────────────────────────────────────────────
  const pedestal = buildPedestal({ mats, labels, bag });
  root.add(pedestal.object);

  // ── falling water ────────────────────────────────────────────────────────────────────
  const dischargeMouth = dischargeOutlet();
  const refillMouth = refillOutlet();
  const drainMouth = drainOutlet();

  const dischargeStream = buildStream({
    name: 'pump:stream:discharge',
    material: mats.stream,
    mouth: dischargeMouth,
    radiusTop: 0.019,
    radiusBottom: 0.012,
    bowX: STREAM_BOW_M,
    bag,
  });
  const refillStream = buildStream({
    name: 'pump:stream:refill',
    material: mats.stream,
    mouth: refillMouth,
    radiusTop: 0.019,
    radiusBottom: 0.012,
    bowX: STREAM_BOW_M,
    bag,
  });
  const drainStream = buildStream({
    name: 'pump:stream:drain',
    material: mats.stream,
    mouth: drainMouth,
    radiusTop: 0.016,
    radiusBottom: 0.011,
    bowX: STREAM_BOW_M * 0.4,
    bag,
  });
  root.add(dischargeStream.mesh, refillStream.mesh, drainStream.mesh);

  const dischargeRipple = buildRipple({
    name: 'pump:ripple:discharge',
    material: mats.ripple,
    at: new Vector3(dischargeMouth.x + STREAM_BOW_M, 0, dischargeMouth.z),
    maxRadius: LIQUID_RADIUS * 0.8,
    bag,
  });
  const refillRipple = buildRipple({
    name: 'pump:ripple:refill',
    material: mats.ripple,
    at: new Vector3(refillMouth.x + STREAM_BOW_M, 0, refillMouth.z),
    maxRadius: LIQUID_RADIUS * 0.8,
    bag,
  });
  const drainRipple = buildRipple({
    name: 'pump:ripple:drain',
    material: mats.ripple,
    at: new Vector3(drainMouth.x + STREAM_BOW_M * 0.4, 0, drainMouth.z),
    maxRadius: 0.075,
    bag,
  });
  root.add(dischargeRipple.object, refillRipple.object, drainRipple.object);

  // Every plate exists now — the same D15 pass the railway scene runs after composition.
  deconflictPlates(root);

  // ── animation state (integrated from SIM time only) ──────────────────────────────────
  const pumpPhase = new FlowPhase();
  const refillPhase = new FlowPhase();
  const drainPhase = new FlowPhase();
  let impellerRad = 0;
  let lastRenderMs: number | null = null;
  let highlighted: string | null = null;

  const highlights = new Map<string, Mesh>(pedestal.highlights);
  for (const valve of valves) {
    highlights.set(pumpPickKey({ kind: 'valve', id: valve.id }), valve.highlight);
  }

  const applyStatic = (snapshot: PumpSnapshot): void => {
    for (const id of PUMP_BUTTON_IDS) pedestal.setButton(id, snapshot.buttons[id]);
    for (const id of PUMP_TOGGLE_IDS) pedestal.setToggle(id, snapshot.toggles[id]);
    for (const id of PUMP_ACTUATOR_IDS) pedestal.setLamp(id, snapshot.actuators[id]);
    for (const valve of valves) valve.update(snapshot.valves[valve.id]);
  };

  // Neutral pose before the first snapshot: probes at the default thresholds, tanks empty.
  tankA.update({
    volPct: 0,
    lowOn: false,
    highOn: false,
    lowThresholdPct: PUMP_PARAM_DEFAULTS.llsThresholdPct,
    highThresholdPct: PUMP_PARAM_DEFAULTS.hlsThresholdPct,
    simTimeMs: 0,
  });
  tankB.update({
    volPct: 0,
    lowOn: false,
    highOn: false,
    lowThresholdPct: PUMP_PARAM_DEFAULTS.llsThresholdPct,
    highThresholdPct: PUMP_PARAM_DEFAULTS.hlsThresholdPct,
    simTimeMs: 0,
  });

  return {
    root,
    materials: mats,

    update(snapshot: PumpSnapshot, alphaMs: number): void {
      const alpha = Number.isFinite(alphaMs) ? Math.max(0, alphaMs) : 0;
      const renderMs = snapshot.timeMs + alpha;
      // A snapshot going back in time means the plant was reset: drop the travel phases so
      // a reset scene looks like a fresh one rather than mid-stroke.
      if (lastRenderMs === null || renderMs < lastRenderMs) {
        pumpPhase.reset();
        refillPhase.reset();
        drainPhase.reset();
        impellerRad = 0;
        lastRenderMs = renderMs;
      }
      const dtMs = Math.max(0, renderMs - lastRenderMs);
      lastRenderMs = renderMs;

      const params = snapshot.params;
      const flow = snapshot.flowPctS;

      tankA.update({
        volPct: snapshot.volAPct,
        lowOn: snapshot.sensors.llsA,
        highOn: snapshot.sensors.hlsA,
        lowThresholdPct: params.llsThresholdPct,
        highThresholdPct: params.hlsThresholdPct,
        simTimeMs: renderMs,
      });
      tankB.update({
        volPct: snapshot.volBPct,
        lowOn: snapshot.sensors.llsB,
        highOn: snapshot.sensors.hlsB,
        lowThresholdPct: params.llsThresholdPct,
        highThresholdPct: params.hlsThresholdPct,
        simTimeMs: renderMs,
      });

      // The impeller turns while the OUTPUT is on, at the commanded rate — a deadheaded
      // pump still spins (and moves nothing), which is what the plant models.
      if (snapshot.actuators.pump && dtMs > 0) {
        impellerRad += (dtMs / 1000) * impellerTurnsPerSecond(params.pumpRatePctS) * Math.PI * 2;
        impellerRad %= Math.PI * 2;
      }
      unit.update(impellerRad, snapshot.sensors.ls);

      pumpLine.beads.update(flow.pump > 0, pumpPhase.advance(dtMs, flow.pump, BEAD_LAPS_PER_PCT));
      refillLine.beads.update(
        flow.refill > 0,
        refillPhase.advance(dtMs, flow.refill, BEAD_LAPS_PER_PCT),
      );
      drainLine.beads.update(
        flow.drain > 0,
        drainPhase.advance(dtMs, flow.drain, BEAD_LAPS_PER_PCT),
      );

      const surfaceA = levelY(snapshot.volAPct);
      const surfaceB = levelY(snapshot.volBPct);
      dischargeStream.update(flow.pump > 0, dischargeMouth.y - surfaceB);
      refillStream.update(flow.refill > 0, refillMouth.y - surfaceA);
      drainStream.update(flow.drain > 0, drainMouth.y - PUMP_DIM.floorDrainY);

      dischargeRipple.update(flow.pump > 0, surfaceB + 0.003, renderMs);
      refillRipple.update(flow.refill > 0, surfaceA + 0.003, renderMs);
      drainRipple.update(flow.drain > 0, PUMP_DIM.floorDrainY + 0.002, renderMs);

      applyStatic(snapshot);
    },

    setHighlight(target: PumpPickTarget | null): void {
      const key = target ? pumpPickKey(target) : null;
      if (key === highlighted) return;
      if (highlighted !== null) {
        const previous = highlights.get(highlighted);
        if (previous) previous.visible = false;
      }
      highlighted = key;
      if (key !== null) {
        const next = highlights.get(key);
        if (next) next.visible = true;
      }
    },

    setLabelsVisible(visible: boolean): void {
      labels.setVisible(visible);
    },

    dispose(): void {
      bag.dispose();
      labels.dispose();
      disposePumpMaterials(mats);
      root.clear();
    },
  };
}
