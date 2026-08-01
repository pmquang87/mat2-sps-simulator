/**
 * The control pedestal: S1/S0, the six pedestal toggle switches and the three indicator
 * lamps, on a tilted console in front of the plant.
 *
 * The console is one rotated `Group`, so every control is placed in panel-local coordinates
 * (`u` along the console, `v` towards the viewer, local +y = panel normal). That is also
 * what makes the label plates work: a plate created flat lies ON the panel once the frame's
 * tilt is applied, no per-plate trigonometry.
 *
 * The buttons are MOMENTARY and are drawn from the snapshot, never from the click: a press
 * that the coordinator has not consumed yet must not look consumed (§5.4 render-only rule).
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { LabelFactory } from '../../scene';
import {
  PUMP_ACTUATOR_IDS,
  PUMP_BUTTON_IDS,
  PUMP_TOGGLE_IDS,
  type PumpActuatorId,
  type PumpButtonId,
  type PumpToggleId,
} from '../types';
import { PUMP_DIM, panelPoint } from './dims';
import { DisposeBag, PUMP_PALETTE, type PumpSceneMaterials } from './materials';
import {
  PUMP_ACTUATOR_SYMBOL,
  PUMP_BUTTON_SYMBOL,
  PUMP_TOGGLE_SYMBOL,
  makePumpPlate,
  signalPlateText,
} from './plates';
import { pumpPickName, type PumpPickTarget } from './picking';

/** Panel-local u of each control, in the order the ids are declared. */
const BUTTON_U: Readonly<Record<PumpButtonId, number>> = { S1: -0.6, S0: -0.36 };
const LAMP_U: Readonly<Record<PumpActuatorId, number>> = { pump: 0.12, 'A0.2': 0.36, 'A0.3': 0.6 };

/**
 * Panel-local u of the n-th toggle: a centred row, one `controlSpacing` apart. Derived from
 * `PUMP_TOGGLE_IDS` rather than tabulated, so a switch added to the plant appears on the
 * console instead of silently landing at u = undefined.
 */
function toggleU(index: number, count: number): number {
  return (index - (count - 1) / 2) * PUMP_DIM.controlSpacing;
}

export interface PedestalVisual {
  readonly object: Group;
  /** Pick key (`button:S1`, `toggle:E1.0`) → hover ring. */
  readonly highlights: ReadonlyMap<string, Mesh>;
  setButton(id: PumpButtonId, pressed: boolean): void;
  setToggle(id: PumpToggleId, on: boolean): void;
  setLamp(id: PumpActuatorId, on: boolean): void;
}

export function buildPedestal(args: {
  mats: PumpSceneMaterials;
  labels: LabelFactory;
  bag: DisposeBag;
}): PedestalVisual {
  const { mats, bag } = args;
  const root = new Group();
  root.name = 'pump:pedestal';

  const body = new Mesh(
    bag.add(new BoxGeometry(PUMP_DIM.panelWidth, PUMP_DIM.pedestalHeight, PUMP_DIM.panelDepth * 0.8)),
    mats.panel,
  );
  body.name = 'pump:pedestal:body';
  body.position.set(0, PUMP_DIM.pedestalHeight / 2, PUMP_DIM.panelZ);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  // Panel frame: local x = u, local z = v, local y = panel normal.
  const panel = new Group();
  panel.name = 'pump:pedestal:panel';
  panel.position.set(0, PUMP_DIM.panelY, PUMP_DIM.panelZ);
  panel.rotation.x = PUMP_DIM.panelTiltRad;
  root.add(panel);

  const face = new Mesh(
    bag.add(new BoxGeometry(PUMP_DIM.panelWidth, PUMP_DIM.panelThickness, PUMP_DIM.panelDepth)),
    mats.panelFace,
  );
  face.name = 'pump:pedestal:face';
  face.position.y = -PUMP_DIM.panelThickness / 2;
  face.receiveShadow = true;
  panel.add(face);

  const highlights = new Map<string, Mesh>();
  const buttons = new Map<PumpButtonId, { cap: Mesh; restY: number }>();
  const toggles = new Map<PumpToggleId, Group>();
  const lamps = new Map<PumpActuatorId, MeshStandardMaterial>();

  const addHighlight = (target: PumpPickTarget, u: number, v: number, radius: number): void => {
    const ring = new Mesh(bag.add(new TorusGeometry(radius, 0.004, 6, 26)), mats.highlight);
    ring.name = `pump:highlight:${target.kind}:${target.id}`;
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(u, 0.004, v);
    ring.visible = false;
    panel.add(ring);
    highlights.set(`${target.kind}:${target.id}`, ring);
  };

  const addPlate = (text: string, u: number, v: number): void => {
    const labelV = v + PUMP_DIM.labelRowOffset;
    panel.add(makePumpPlate(args.labels, text, {
      at: new Vector3(u, 0.003, labelV),
      anchor: panelPoint(u, v),
      tiltRad: 0,
    }));
  };

  // ── momentary buttons ────────────────────────────────────────────────────────────────
  const collarGeom = bag.add(new CylinderGeometry(
    PUMP_DIM.buttonRadius + 0.008,
    PUMP_DIM.buttonRadius + 0.012,
    0.016,
    18,
  ));
  const capGeom = bag.add(new CylinderGeometry(
    PUMP_DIM.buttonRadius,
    PUMP_DIM.buttonRadius,
    0.022,
    18,
  ));
  for (const id of PUMP_BUTTON_IDS) {
    const u = BUTTON_U[id];
    const v = PUMP_DIM.controlRowFront;
    const collar = new Mesh(collarGeom, mats.toggleBody);
    collar.position.set(u, 0.008, v);
    panel.add(collar);

    const capMat = bag.add((id === 'S1' ? mats.buttonGreen : mats.buttonRed).clone());
    const cap = new Mesh(capGeom, capMat);
    cap.name = pumpPickName({ kind: 'button', id });
    const restY = 0.026;
    cap.position.set(u, restY, v);
    cap.castShadow = true;
    panel.add(cap);
    buttons.set(id, { cap, restY });

    addHighlight({ kind: 'button', id }, u, v, PUMP_DIM.buttonRadius + 0.022);
    addPlate(signalPlateText(PUMP_BUTTON_SYMBOL[id]), u, v);
  }

  // ── toggle switches ──────────────────────────────────────────────────────────────────
  const toggleBaseGeom = bag.add(new CylinderGeometry(
    PUMP_DIM.toggleBaseRadius,
    PUMP_DIM.toggleBaseRadius + 0.004,
    0.014,
    16,
  ));
  const leverGeom = bag.add(new CylinderGeometry(0.007, 0.009, PUMP_DIM.toggleLeverLength, 10));
  const knobGeom = bag.add(new SphereGeometry(0.012, 12, 10));
  for (const [index, id] of PUMP_TOGGLE_IDS.entries()) {
    const u = toggleU(index, PUMP_TOGGLE_IDS.length);
    const v = PUMP_DIM.controlRowBack;
    const base = new Mesh(toggleBaseGeom, mats.toggleBody);
    base.position.set(u, 0.007, v);
    panel.add(base);

    // The lever pivots at the panel surface; the whole pivot group is the pick target, so
    // the thin lever does not have to be hit exactly.
    const pivot = new Group();
    pivot.name = pumpPickName({ kind: 'toggle', id });
    pivot.position.set(u, 0.012, v);
    const lever = new Mesh(leverGeom, mats.toggleLever);
    lever.position.y = PUMP_DIM.toggleLeverLength / 2;
    pivot.add(lever);
    const knob = new Mesh(knobGeom, mats.toggleLever);
    knob.position.y = PUMP_DIM.toggleLeverLength;
    pivot.add(knob);
    panel.add(pivot);
    toggles.set(id, pivot);

    addHighlight({ kind: 'toggle', id }, u, v, PUMP_DIM.toggleBaseRadius + 0.018);
    addPlate(signalPlateText(PUMP_TOGGLE_SYMBOL[id]), u, v);
  }

  // ── indicator lamps (outputs — not pickable) ─────────────────────────────────────────
  const lampBaseGeom = bag.add(new CylinderGeometry(
    PUMP_DIM.lampRadius + 0.008,
    PUMP_DIM.lampRadius + 0.01,
    0.012,
    16,
  ));
  const domeGeom = bag.add(new SphereGeometry(
    PUMP_DIM.lampRadius,
    16,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  ));
  for (const id of PUMP_ACTUATOR_IDS) {
    const u = LAMP_U[id];
    const v = PUMP_DIM.controlRowFront;
    const base = new Mesh(lampBaseGeom, mats.toggleBody);
    base.position.set(u, 0.006, v);
    panel.add(base);

    const mat = bag.add(mats.lamp.clone());
    const dome = new Mesh(domeGeom, mat);
    dome.name = `pump:lamp:${id}`;
    dome.position.set(u, 0.012, v);
    panel.add(dome);
    lamps.set(id, mat);

    addPlate(signalPlateText(PUMP_ACTUATOR_SYMBOL[id]), u, v);
  }

  return {
    object: root,
    highlights,
    setButton(id, pressed): void {
      const entry = buttons.get(id);
      if (!entry) return;
      entry.cap.position.y = pressed ? entry.restY - PUMP_DIM.buttonTravel : entry.restY;
      const mat = entry.cap.material as MeshStandardMaterial;
      mat.emissiveIntensity = pressed ? 0.9 : 0.15;
    },
    setToggle(id, on): void {
      const pivot = toggles.get(id);
      if (!pivot) return;
      // +v is towards the viewer and downhill: "on" throws the lever away from the student,
      // the same way the real pedestal switches stand up when energised.
      pivot.rotation.x = on ? -PUMP_DIM.toggleThrowRad : PUMP_DIM.toggleThrowRad;
    },
    setLamp(id, on): void {
      const mat = lamps.get(id);
      if (!mat) return;
      mat.emissiveIntensity = on ? 2.1 : 0;
      mat.color.setHex(on ? PUMP_PALETTE.lampAmber : PUMP_PALETTE.lampWhite);
    },
  };
}
