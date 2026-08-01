/**
 * PumpScene — the pump experiment's renderer, mirroring `scene/SceneManager`'s contract
 * (`constructor({canvas})`, `update(snapshot, alphaMs)`, `render()`, `resize()`,
 * `dispose()`), so the app shell can drive either experiment through the same shape.
 *
 * Two deliberate differences from the railway SceneManager:
 *
 *  - It PICKS. The pedestal is operated in 3D, so this class owns pointer listeners and a
 *    `PumpPointer`. It still never mutates the plant: a hit turns into a host callback, and
 *    the visual only follows once that host has fed the change back in through `update`.
 *  - Its camera is a self-contained damped orbit instead of `OrbitControls`, because the
 *    same pointer stream has to serve picking and camera control (see `orbit.ts`).
 *
 * Determinism is unchanged: nothing here reads a wall clock. All animation is derived from
 * `snapshot.timeMs + alphaMs`, and `RafDriver` stays the only requestAnimationFrame user.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { SceneQuality } from '../../scene';
import type { PumpSnapshot } from '../model';
import { PUMP_PALETTE } from './materials';
import { buildPumpSceneGraph, type PumpSceneGraph } from './graph';
import { PumpOrbit } from './orbit';
import { PumpPointer, type NdcPoint, type PumpPointerCallbacks } from './picking';

export interface PumpSceneConfig {
  canvas: HTMLCanvasElement;
  /** Host actions — the scene reports intent and never touches the plant itself. */
  callbacks: PumpPointerCallbacks;
  quality?: SceneQuality;          // low: no shadows, flatter glass (weak GPUs)
}

export class PumpScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly orbit: PumpOrbit;
  private readonly graph: PumpSceneGraph;
  private readonly pointer: PumpPointer;

  private dragging = false;
  private dragPointerId: number | null = null;
  private lastDrag: NdcPoint = { x: 0, y: 0 };
  private disposed = false;

  constructor(cfg: PumpSceneConfig) {
    const quality = cfg.quality ?? 'high';
    const high = quality === 'high';
    this.canvas = cfg.canvas;

    this.renderer = new WebGLRenderer({ canvas: cfg.canvas, antialias: high });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, high ? 2 : 1));
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new Scene();
    this.scene.background = new Color(PUMP_PALETTE.background);

    this.graph = buildPumpSceneGraph({ quality });
    this.scene.add(this.graph.root);
    this.addLighting(high);

    this.camera = new PerspectiveCamera(42, 1, 0.05, 40);
    this.orbit = new PumpOrbit(this.camera);
    this.orbit.settle();

    this.pointer = new PumpPointer(this.graph.root, this.camera, {
      onButton: (id, pressed) => cfg.callbacks.onButton(id, pressed),
      onToggle: (id, value) => cfg.callbacks.onToggle(id, value),
      onValve: (id, open) => cfg.callbacks.onValve(id, open),
      onCursor: (over) => {
        this.canvas.style.cursor = over ? 'pointer' : 'default';
        cfg.callbacks.onCursor?.(over);
      },
      onHighlight: (target) => {
        this.graph.setHighlight(target);
        cfg.callbacks.onHighlight?.(target);
      },
    });

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerCancel);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    const w = cfg.canvas.clientWidth || cfg.canvas.width || 1;
    const h = cfg.canvas.clientHeight || cfg.canvas.height || 1;
    this.resize(w, h);
  }

  /** Apply a plant snapshot. `alphaMs` = real ms since its sim step (scene-side smoothing
   *  only — it never feeds back into the plant). */
  update(snapshot: PumpSnapshot, alphaMs: number): void {
    if (this.disposed) return;
    this.graph.update(snapshot, alphaMs);
    this.pointer.setSnapshot(snapshot);
  }

  render(): void {
    if (this.disposed) return;
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** White symbol/address plates on the plant and the console. */
  setLabelsVisible(visible: boolean): void {
    this.graph.setLabelsVisible(visible);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.orbit.fit(this.camera.aspect, this.camera.fov);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerCancel);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.graph.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    const at = this.ndc(ev);
    if (this.pointer.down(at)) {
      // A control took the press; capture so a release outside the canvas still reaches it
      // (a momentary button that stays pressed because the pointer left is a stuck input).
      this.capture(ev);
      return;
    }
    this.dragging = true;
    this.lastDrag = at;
    this.capture(ev);
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    const at = this.ndc(ev);
    if (this.dragging) {
      this.orbit.rotate(at.x - this.lastDrag.x, at.y - this.lastDrag.y);
      this.lastDrag = at;
      return;
    }
    this.pointer.move(at);
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    this.release(ev);
    if (this.dragging) {
      this.dragging = false;
      return;
    }
    this.pointer.up(this.ndc(ev));
  };

  private readonly onPointerCancel = (ev: PointerEvent): void => {
    this.release(ev);
    this.dragging = false;
    this.pointer.leave();
  };

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.orbit.zoom(ev.deltaY);
  };

  private capture(ev: PointerEvent): void {
    this.dragPointerId = ev.pointerId;
    this.canvas.setPointerCapture?.(ev.pointerId);
  }

  private release(ev: PointerEvent): void {
    if (this.dragPointerId === null) return;
    this.canvas.releasePointerCapture?.(this.dragPointerId);
    this.dragPointerId = ev.pointerId === this.dragPointerId ? null : this.dragPointerId;
  }

  private ndc(ev: { clientX: number; clientY: number }): NdcPoint {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    return {
      x: ((ev.clientX - rect.left) / w) * 2 - 1,
      y: -(((ev.clientY - rect.top) / h) * 2 - 1),
    };
  }

  private addLighting(high: boolean): void {
    const hemi = new HemisphereLight(0xdfe9f2, 0x30363d, 1.35);
    hemi.position.set(0, 2, 0);
    this.scene.add(hemi);

    const key = new DirectionalLight(0xfff2dd, 2.4);
    key.position.set(1.6, 2.6, 2.2);
    key.target.position.set(0, 0.5, 0);
    this.scene.add(key.target);
    if (high) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const cam = key.shadow.camera;
      cam.left = -2.4;
      cam.right = 2.4;
      cam.top = 2.4;
      cam.bottom = -2.4;
      cam.near = 0.1;
      cam.far = 12;
      cam.updateProjectionMatrix();
      key.shadow.bias = -0.0008;
    }
    this.scene.add(key);

    // Fill from the back so the glass keeps an edge against the dark background.
    const fill = new DirectionalLight(0x9fc4e8, 0.9);
    fill.position.set(-2.2, 1.6, -2.4);
    this.scene.add(fill);
  }
}
