/**
 * Scene dev harness (manual viewing only — `src/scene/dev/harness.html`).
 *
 * Not part of the application bundle: `index.html` never imports it, so it is dropped from
 * `dist/`. It exists so the 3D scene can be inspected and reviewed before the plant and the
 * real `trackplan.json` land: it feeds `SceneManager` a **synthetic `PlantSnapshot`** built
 * by a tiny plan-space walker, exercising exactly the read-only snapshot contract of §5.4.
 *
 * Keyboard: 1 orbit · 2 bird · 3 cab · 4 trackside · L labels · P pause · R reset ·
 * H cycle highlight · Q toggle quality.
 */
import { SceneManager } from '../SceneManager';
import type { CameraMode } from '../cameras';
import type {
  PlantSnapshot,
  ReedState,
  SwitchState,
  TrackEdgeSpec,
  TrackplanFile,
  Vec2,
} from '../../plant';
import { createDevTrackplan } from './devTrackplan';

// ───────────────────────── plan-space walker (harness-only physics) ─────────────────────────

interface WalkEdge {
  readonly id: string;
  readonly pts: readonly Vec2[];
  readonly cumMm: readonly number[];
  readonly lengthMm: number;
}

function prepare(edges: readonly TrackEdgeSpec[], mmPerUnit: number): WalkEdge[] {
  const out: WalkEdge[] = [];
  for (const e of edges) {
    const cum: number[] = [0];
    let acc = 0;
    for (let i = 1; i < e.pts.length; i += 1) {
      const a = e.pts[i - 1];
      const b = e.pts[i];
      if (!a || !b) continue;
      acc += Math.hypot(b.x - a.x, b.y - a.y) * mmPerUnit;
      cum.push(acc);
    }
    out.push({ id: e.id, pts: e.pts, cumMm: cum, lengthMm: acc });
  }
  return out;
}

function poseAt(edge: WalkEdge, offsetMm: number): { pt: Vec2; headingRad: number } {
  const clamped = Math.min(Math.max(offsetMm, 0), edge.lengthMm);
  let seg = 0;
  for (let i = 1; i < edge.cumMm.length; i += 1) {
    const c = edge.cumMm[i];
    if (c !== undefined && c >= clamped) {
      seg = i - 1;
      break;
    }
    seg = i - 1;
  }
  const a = edge.pts[seg];
  const b = edge.pts[seg + 1] ?? a;
  const ca = edge.cumMm[seg] ?? 0;
  const cb = edge.cumMm[seg + 1] ?? ca;
  if (!a || !b) return { pt: { x: 0, y: 0 }, headingRad: 0 };
  const span = cb - ca;
  const t = span > 1e-6 ? (clamped - ca) / span : 0;
  return {
    pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    headingRad: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Feeds SceneManager synthetic snapshots: ring lap + switch cycling + reed closures. */
class FakePlant {
  private readonly tp: TrackplanFile;
  private readonly route: WalkEdge[];
  private readonly all: Map<string, WalkEdge>;
  private routeIdx = 0;
  private offsetMm = 0;
  private timeMs = 0;
  private speedMmS = 220;
  private readonly switchStates: SwitchState[];
  private readonly reedStates: ReedState[];
  private notaus = false;

  constructor(tp: TrackplanFile) {
    this.tp = tp;
    const prepared = prepare(tp.edges, tp.meta.mmPerUnit);
    this.all = new Map(prepared.map((e) => [e.id, e]));
    // lap the outer ring: its chain edges are already in walking order
    this.route = prepared.filter((e) => e.id.startsWith('e-ring-a-'));
    this.switchStates = tp.switches.map((s) => ({
      id: s.id,
      position: s.initialPosition,
      moving: false,
      coilG: false,
      coilR: false,
    }));
    this.reedStates = tp.reeds.map((r) => ({ id: r.id, closed: false, latched: false }));
  }

  step(dtMs: number): void {
    this.timeMs += dtMs;
    this.offsetMm += (this.speedMmS * dtMs) / 1000;
    let edge = this.route[this.routeIdx];
    while (edge && this.offsetMm > edge.lengthMm) {
      this.offsetMm -= edge.lengthMm;
      this.routeIdx = (this.routeIdx + 1) % Math.max(1, this.route.length);
      edge = this.route[this.routeIdx];
    }
    this.updateSwitches(dtMs);
    this.updateReeds();
    this.notaus = Math.floor(this.timeMs / 12000) % 5 === 4;
  }

  /** Cycles one switch after another so the 300 ms blade movement is visible. */
  private updateSwitches(dtMs: number): void {
    const actuation = this.tp.meta.switchActuationMs;
    const slot = Math.floor(this.timeMs / 1500);
    const active = this.switchStates.length > 0 ? slot % this.switchStates.length : 0;
    for (let i = 0; i < this.switchStates.length; i += 1) {
      const s = this.switchStates[i];
      if (!s) continue;
      if (s.moving) {
        const remaining = (s.remainingMs ?? actuation) - dtMs;
        if (remaining <= 0) {
          s.position = s.movingToward ?? s.position;
          s.moving = false;
          s.movingToward = undefined;
          s.remainingMs = undefined;
          s.coilG = false;
          s.coilR = false;
        } else {
          s.remainingMs = remaining;
        }
        continue;
      }
      if (i === active && this.timeMs % 1500 < dtMs * 1.5) {
        const target: 0 | 1 = s.position === 0 ? 1 : 0;
        s.moving = true;
        s.movingToward = target;
        s.remainingMs = actuation;
        s.coilG = target === 0;
        s.coilR = target === 1;
      }
    }
  }

  private updateReeds(): void {
    const train = this.trainPose();
    const window = this.tp.meta.reedWindowMm / 2;
    for (let i = 0; i < this.reedStates.length; i += 1) {
      const state = this.reedStates[i];
      const spec = this.tp.reeds[i];
      if (!state || !spec) continue;
      const edge = this.all.get(spec.edgeId);
      if (!edge) continue;
      const pose = poseAt(edge, spec.offsetMm);
      const dMm =
        Math.hypot(pose.pt.x - train.pt.x, pose.pt.y - train.pt.y) * this.tp.meta.mmPerUnit;
      state.closed = dMm <= window * 3; // generous window: the harness renders, it does not test
      if (state.closed) state.latched = true;
      else if (dMm > window * 12) state.latched = false;
    }
  }

  private trainPose(): { pt: Vec2; headingRad: number } {
    const edge = this.route[this.routeIdx];
    if (!edge) return { pt: { x: 0, y: 0 }, headingRad: 0 };
    return poseAt(edge, this.offsetMm);
  }

  snapshot(): PlantSnapshot {
    const edge = this.route[this.routeIdx];
    const pose = this.trainPose();
    return {
      timeMs: this.timeMs,
      train: {
        edgeId: edge?.id ?? '',
        offsetMm: this.offsetMm,
        direction: 1,
        command: 'IU',
        speedMmS: this.speedMmS,
        targetSpeedMmS: this.speedMmS,
        worldPos: pose.pt,
        headingRad: pose.headingRad,
        // the dev harness has no TrackGraph: a single sample is enough for it, and the scene
        // falls back to its own straight-tail behaviour when the path carries fewer than two
        consistPath: { startMm: 0, stepMm: 4, pts: [pose.pt] },
      },
      switches: this.switchStates,
      reeds: this.reedStates,
      fahrstrom: { word: 3, level: 3, direction: 'IU' },
      notausActive: this.notaus,
      derailed: false,
    };
  }

  reset(): void {
    this.timeMs = 0;
    this.offsetMm = 0;
    this.routeIdx = 0;
  }

  setSpeed(mmS: number): void {
    this.speedMmS = mmS;
  }
}

// ───────────────────────────────── harness bootstrap ─────────────────────────────────

const canvasEl = document.getElementById('view');
const hud = document.getElementById('hud');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('harness: #view canvas missing');
const canvas: HTMLCanvasElement = canvasEl;

const trackplan = createDevTrackplan();
let quality: 'low' | 'high' = 'high';
let scene = new SceneManager({ canvas, trackplan, quality });
const plant = new FakePlant(trackplan);

let labelsVisible = true;
let paused = false;
let last = performance.now();
let accumulator = 0;
const STEP_MS = 10;
let highlightIdx = -1;

function fit(): void {
  scene.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fit);
fit();

function setHud(): void {
  if (!hud) return;
  hud.textContent = [
    `camera: ${scene.getCameraMode()}`,
    `quality: ${quality}`,
    `meshes: ${scene.countMeshes()}`,
    `switches: ${trackplan.switches.length}`,
    `reeds: ${trackplan.reeds.length}`,
    paused ? 'PAUSED' : '',
  ]
    .filter((s) => s.length > 0)
    .join('   ·   ');
}

window.addEventListener('keydown', (ev: KeyboardEvent) => {
  const modes: Record<string, CameraMode> = {
    '1': 'orbit',
    '2': 'bird',
    '3': 'cab',
    '4': 'trackside',
  };
  const mode = modes[ev.key];
  if (mode) scene.setCameraMode(mode);
  else if (ev.key === 'l' || ev.key === 'L') labelsVisible = !labelsVisible;
  else if (ev.key === 'p' || ev.key === 'P') paused = !paused;
  else if (ev.key === 'r' || ev.key === 'R') plant.reset();
  else if (ev.key === 'h' || ev.key === 'H') cycleHighlight();
  else if (ev.key === '+') plant.setSpeed(420);
  else if (ev.key === '-') plant.setSpeed(120);
  else if (ev.key === 'q' || ev.key === 'Q') toggleQuality();
  if (mode || 'lLpPrRhHqQ'.includes(ev.key)) {
    scene.setLabelsVisible(labelsVisible);
    setHud();
  }
});

function cycleHighlight(): void {
  highlightIdx = (highlightIdx + 1) % (trackplan.switches.length + trackplan.reeds.length);
  const sw = trackplan.switches[highlightIdx];
  if (sw) {
    scene.highlight('switch', sw.id);
    scene.highlight('reed', null);
    return;
  }
  const reed = trackplan.reeds[highlightIdx - trackplan.switches.length];
  scene.highlight('switch', null);
  scene.highlight('reed', reed?.id ?? null);
}

function toggleQuality(): void {
  quality = quality === 'high' ? 'low' : 'high';
  const mode = scene.getCameraMode();
  scene.dispose();
  scene = new SceneManager({ canvas, trackplan, quality });
  scene.setCameraMode(mode);
  scene.setLabelsVisible(labelsVisible);
  fit();
}

let hudMode = '';

function frame(now: number): void {
  const realDt = Math.min(now - last, 200);
  last = now;
  if (!paused) {
    accumulator += realDt;
    while (accumulator >= STEP_MS) {
      plant.step(STEP_MS);
      accumulator -= STEP_MS;
    }
  }
  scene.update(plant.snapshot(), paused ? 0 : accumulator);
  scene.render();
  if (scene.getCameraMode() !== hudMode) {
    hudMode = scene.getCameraMode();
    setHud();
  }
  requestAnimationFrame(frame);
}

setHud();
requestAnimationFrame(frame);

/**
 * Dev hook: lets a console (or an automated smoke check) drive one deterministic
 * step/update/render without waiting for requestAnimationFrame — rAF is paused whenever the
 * tab is hidden, which would otherwise make the harness impossible to inspect headlessly.
 */
interface HarnessHook {
  step(ms: number): void;
  render(): void;
  snapshot(): PlantSnapshot;
  scene(): SceneManager;
  trackplan(): TrackplanFile;
}
(globalThis as unknown as { __sceneHarness?: HarnessHook }).__sceneHarness = {
  step: (ms: number) => plant.step(ms),
  render: () => {
    scene.update(plant.snapshot(), 0);
    scene.render();
  },
  snapshot: () => plant.snapshot(),
  scene: () => scene,
  trackplan: () => trackplan,
};
