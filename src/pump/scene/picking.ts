/**
 * Pick targets of the pump scene: the pure mesh-name ↔ action mapping, and the raycasting
 * pointer controller built on top of it.
 *
 * The scene NEVER mutates the plant (the §5.4 render-only rule the railway scene states in
 * its header). A hit resolves to a `PumpPickTarget`, the controller calls a host callback,
 * and the visual only changes when the next snapshot comes back through `update()`. That is
 * what makes the pedestal honest: if the coordinator is paused, a button visibly does
 * nothing, exactly like a dead PLC.
 *
 * `PumpPointer` touches no DOM: it takes normalised device coordinates and a camera, so the
 * whole interaction is testable headlessly. `PumpScene` owns the listeners that produce
 * those coordinates.
 */
import { Camera, Object3D, Raycaster, Vector2 } from 'three';
import {
  PUMP_BUTTON_IDS,
  PUMP_TOGGLE_IDS,
  PUMP_VALVE_IDS,
  type PumpButtonId,
  type PumpToggleId,
  type PumpValveId,
} from '../types';
import type { PumpSnapshot } from '../model';

export type PumpPickTarget =
  | { readonly kind: 'button'; readonly id: PumpButtonId }
  | { readonly kind: 'toggle'; readonly id: PumpToggleId }
  | { readonly kind: 'valve'; readonly id: PumpValveId };

/** Every interactive mesh carries a name starting with this prefix; nothing else does. */
export const PUMP_PICK_PREFIX = 'pick:';

/** Stable key of a target, e.g. `button:S1` — used for highlight bookkeeping. */
export function pumpPickKey(target: PumpPickTarget): string {
  return `${target.kind}:${target.id}`;
}

/** Mesh name of a target, e.g. `pick:toggle:E1.0`. */
export function pumpPickName(target: PumpPickTarget): string {
  return `${PUMP_PICK_PREFIX}${pumpPickKey(target)}`;
}

const BUTTONS = new Set<string>(PUMP_BUTTON_IDS);
const TOGGLES = new Set<string>(PUMP_TOGGLE_IDS);
const VALVES = new Set<string>(PUMP_VALVE_IDS);

/**
 * Mesh name → action. Total in both directions that matter: every `pumpPickName(t)` maps
 * back to `t`, and any other string (including a `pick:` name with an id that is not in the
 * plant's id lists) maps to `null` rather than to a plausible-looking wrong action.
 */
export function resolvePumpPick(name: string): PumpPickTarget | null {
  if (!name.startsWith(PUMP_PICK_PREFIX)) return null;
  const rest = name.slice(PUMP_PICK_PREFIX.length);
  const split = rest.indexOf(':');
  if (split <= 0) return null;
  const kind = rest.slice(0, split);
  const id = rest.slice(split + 1);
  if (kind === 'button' && BUTTONS.has(id)) return { kind, id: id as PumpButtonId };
  if (kind === 'toggle' && TOGGLES.has(id)) return { kind, id: id as PumpToggleId };
  if (kind === 'valve' && VALVES.has(id)) return { kind, id: id as PumpValveId };
  return null;
}

/** Walks up from a hit object to the nearest ancestor that names a pick target. */
export function pickTargetOf(object: Object3D | null): PumpPickTarget | null {
  let node = object;
  while (node) {
    const target = resolvePumpPick(node.name);
    if (target) return target;
    node = node.parent;
  }
  return null;
}

/**
 * Host callbacks. The scene reports intent; the host drives the plant (or refuses to).
 * `value`/`open`/`pressed` is always the DESIRED NEW state, never a toggle instruction, so
 * a host that drops an event cannot get out of phase with the scene.
 */
export interface PumpPointerCallbacks {
  onButton(id: PumpButtonId, pressed: boolean): void;
  onToggle(id: PumpToggleId, value: boolean): void;
  onValve(id: PumpValveId, open: boolean): void;
  /** True while an interactive control is under the pointer (host sets the CSS cursor). */
  onCursor?(overControl: boolean): void;
  /** Hover highlight; the graph draws a ring around the named control. */
  onHighlight?(target: PumpPickTarget | null): void;
}

export interface NdcPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Raycast picking with momentary-button semantics.
 *
 * - `down` on S1/S0 presses immediately and the bit STAYS 1 until `up`/`leave` — that is
 *   what makes the manual's self-hold example (`U S1; O Pumpe; UN S0; = Pumpe`) teachable:
 *   a student who only latches on the button sees the pump stop when they let go.
 * - Toggles and hand valves flip on `up` over the same control, i.e. on a click, so a drag
 *   that started on a switch and ended elsewhere does nothing.
 * - `down` returns false when nothing interactive was hit, which is the host's signal to
 *   start an orbit drag instead.
 */
export class PumpPointer {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly root: Object3D;
  private readonly camera: Camera;
  private readonly cb: PumpPointerCallbacks;

  /** Last snapshot — the source of the CURRENT toggle/valve state a click has to invert. */
  private snapshot: PumpSnapshot | null = null;
  private pressed: PumpButtonId | null = null;
  private armed: PumpPickTarget | null = null;
  private hovered: string | null = null;

  constructor(root: Object3D, camera: Camera, cb: PumpPointerCallbacks) {
    this.root = root;
    this.camera = camera;
    this.cb = cb;
  }

  /** The scene feeds every snapshot through here so a click can compute the new value. */
  setSnapshot(snapshot: PumpSnapshot): void {
    this.snapshot = snapshot;
  }

  /** Target under the pointer, or null. */
  pick(at: NdcPoint): PumpPickTarget | null {
    this.ndc.set(at.x, at.y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      const target = pickTargetOf(hit.object);
      if (target) return target;
    }
    return null;
  }

  /** Returns true when the press was consumed by a control (host: do not orbit). */
  down(at: NdcPoint): boolean {
    const target = this.pick(at);
    if (!target) {
      this.setHover(null);
      return false;
    }
    this.setHover(target);
    if (target.kind === 'button') {
      this.pressed = target.id;
      this.armed = null;
      this.cb.onButton(target.id, true);
      return true;
    }
    this.armed = target;
    return true;
  }

  move(at: NdcPoint): void {
    // While a button is held the pointer owns it: re-picking here would drop the hover ring
    // as soon as the cursor slid a pixel off the cap.
    if (this.pressed !== null) return;
    this.setHover(this.pick(at));
  }

  /** Release. `at` decides whether an armed toggle/valve actually flips. */
  up(at?: NdcPoint): void {
    const held = this.pressed;
    this.pressed = null;
    if (held !== null) {
      this.cb.onButton(held, false);
      return;
    }
    const armed = this.armed;
    this.armed = null;
    if (!armed) return;
    if (at !== undefined) {
      const now = this.pick(at);
      if (!now || pumpPickKey(now) !== pumpPickKey(armed)) return;
    }
    this.fire(armed);
  }

  /** The pointer left the canvas (or capture was lost): release without firing. */
  leave(): void {
    const held = this.pressed;
    this.pressed = null;
    this.armed = null;
    if (held !== null) this.cb.onButton(held, false);
    this.setHover(null);
  }

  /** True while a momentary button is held. */
  isPressed(): boolean {
    return this.pressed !== null;
  }

  private fire(target: PumpPickTarget): void {
    const snapshot = this.snapshot;
    if (target.kind === 'toggle') {
      const current = snapshot?.toggles[target.id] ?? false;
      this.cb.onToggle(target.id, !current);
      return;
    }
    if (target.kind === 'valve') {
      const current = snapshot?.valves[target.id] ?? false;
      this.cb.onValve(target.id, !current);
    }
  }

  private setHover(target: PumpPickTarget | null): void {
    const key = target ? pumpPickKey(target) : null;
    if (key === this.hovered) return;
    this.hovered = key;
    this.cb.onCursor?.(target !== null);
    this.cb.onHighlight?.(target);
  }
}
