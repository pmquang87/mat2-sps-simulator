/**
 * SceneManager (ARCHITECTURE.md §5.4): Three.js setup, render loop hook,
 * snapshot → scene update. scene/ reads plant state (PlantSnapshot, trackplan types) and
 * never mutates plant (§2 rule 3).
 *
 * Design rules honoured here:
 * - **No clock, no physics.** Every animated property is a pure function of the last
 *   `PlantSnapshot` plus `alphaMs` (real ms since that snapshot's sim step). The scene
 *   therefore cannot drift from the plant and never feeds anything back into it.
 * - **No plant mutation.** The snapshot is only read.
 * - **No i18n needed.** The only text in the scene is plant identifiers from the trackplan
 *   (`xW…`, `xR…`, `BH1`, `G3`) — language-neutral operand names, not UI prose.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ConsistPath, PlantSnapshot, TrackplanFile, Vec2 } from '../plant';
import {
  PALETTE,
  createMaterials,
  disposeMaterials,
  type SceneMaterials,
  type SceneQuality,
} from './materials';
import { LabelFactory } from './labels';
import {
  PlanFrame,
  buildEdgeCurves,
  buildTrackMeshes,
  disposeGeometries,
  type EdgeCurve,
} from './trackMesh';
import { buildSwitchVisuals, type SwitchVisual } from './switchMesh';
import { buildReedVisuals, type ReedVisual } from './reedMesh';
import { TrainVisual, buildTrain, type ConsistWorldPath } from './trainMesh';
import {
  TRAIN_HIDE_COVER_MM,
  buildLandscape,
  terrainCoverMm,
  tunnelEdgeIds,
  type LandscapeResult,
} from './landscape';
import { createCameraRigs, type CameraMode, type CameraRigs } from './cameras';

export interface SceneConfig {
  canvas: HTMLCanvasElement;
  trackplan: TrackplanFile;
  quality?: SceneQuality;          // low: no shadows/decor detail (weak GPUs)
}

export class SceneManager {
  private readonly cfg: SceneConfig;
  private readonly quality: SceneQuality;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly frame: PlanFrame;
  private readonly curves: ReadonlyMap<string, EdgeCurve>;
  private readonly mats: SceneMaterials;
  private readonly labels: LabelFactory;
  private readonly switches: Map<string, SwitchVisual>;
  private readonly reeds: Map<string, ReedVisual>;
  private readonly train: TrainVisual;
  private readonly landscape: LandscapeResult;
  private readonly cameras: CameraRigs;
  private readonly tunnelEdges: Set<string>;

  private highlighted: { switch: string | null; reed: string | null } = {
    switch: null,
    reed: null,
  };
  /** reused scratch for consistWorldPath — see there for why */
  private readonly consistPts: Vector3[] = [];
  private lastSnapshotMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(cfg: SceneConfig) {
    this.cfg = cfg;
    this.quality = cfg.quality ?? 'high';
    const high = this.quality === 'high';
    const tp = cfg.trackplan;

    this.renderer = new WebGLRenderer({ canvas: cfg.canvas, antialias: high });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, high ? 2 : 1));
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new Scene();
    this.scene.background = new Color(PALETTE.sky);

    this.frame = PlanFrame.fromTrackplan(tp);
    this.curves = buildEdgeCurves(tp, this.frame);
    this.mats = createMaterials(this.quality);
    this.labels = new LabelFactory(this.quality);

    this.tunnelEdges = tunnelEdgeIds(tp);

    this.addDaylight();

    this.landscape = buildLandscape({
      tp,
      curves: this.curves,
      frame: this.frame,
      mats: this.mats,
      labels: this.labels,
      quality: this.quality,
    });
    this.scene.add(this.landscape.group);

    this.scene.add(buildTrackMeshes(this.curves, this.mats, this.quality).group);

    this.switches = buildSwitchVisuals(
      tp,
      this.curves,
      this.frame,
      this.mats,
      this.labels,
      this.quality,
    );
    for (const v of this.switches.values()) this.scene.add(v.object);

    this.reeds = buildReedVisuals(tp, this.curves, this.mats, this.labels);
    for (const v of this.reeds.values()) this.scene.add(v.object);

    this.train = buildTrain(this.mats, this.quality);
    this.scene.add(this.train.object);

    this.cameras = createCameraRigs({
      domElement: cfg.canvas,
      frame: this.frame,
      trackplan: tp,
      mats: this.mats,
      quality: this.quality,
    });
    this.scene.add(this.cameras.markers);
    this.cameras.setMode('orbit');

    const w = cfg.canvas.clientWidth || cfg.canvas.width || 1;
    const h = cfg.canvas.clientHeight || cfg.canvas.height || 1;
    this.resize(w, h);
  }

  /** Apply a plant snapshot. alphaMs = real-time ms since the snapshot's sim step, used to
   *  interpolate the train pose between fixed steps (scene-side smoothing only — never
   *  feeds back into plant). */
  update(snapshot: PlantSnapshot, alphaMs: number): void {
    if (this.disposed) return;
    const alpha = Number.isFinite(alphaMs) ? Math.max(0, alphaMs) : 0;

    // a snapshot going back in time means the plant was reset → drop the consist history
    if (snapshot.timeMs < this.lastSnapshotMs) this.train.reset();
    this.lastSnapshotMs = snapshot.timeMs;

    const actuationMs = this.cfg.trackplan.meta.switchActuationMs;
    for (const state of snapshot.switches) {
      this.switches.get(state.id)?.update(state, actuationMs, alpha);
    }
    for (const state of snapshot.reeds) {
      this.reeds.get(state.id)?.update(state);
    }

    const t = snapshot.train;
    const trainPos = this.trainWorldPosition(t.worldPos);
    this.train.update({
      position: trainPos,
      headingRad: t.headingRad,
      speedMmS: t.speedMmS,
      alphaMs: alpha,
      hidden: this.insideMassif(t.edgeId, trainPos),
      derailed: snapshot.derailed,
      path: this.consistWorldPath(t.consistPath),
    });

    this.landscape.setNotaus(snapshot.notausActive);

    this.cameras.followTrain(
      this.train.getCabPosition(),
      this.train.getCabForward(),
      trainPos,
    );
  }

  render(): void {
    if (this.disposed) return;
    this.cameras.update();
    this.renderer.render(this.scene, this.cameras.active());
  }

  setCameraMode(m: CameraMode): void {
    this.cameras.setMode(m);
  }

  getCameraMode(): CameraMode {
    return this.cameras.getMode();
  }

  setLabelsVisible(v: boolean): void {                    // white xW…/xR… label sprites
    this.labels.setVisible(v);
  }

  highlight(kind: 'switch' | 'reed', id: string | null): void {   // UI hover/selection glow
    if (kind === 'switch') {
      const prev = this.highlighted.switch;
      if (prev) this.switches.get(prev)?.setHighlight(false);
      this.highlighted.switch = id;
      if (id) this.switches.get(id)?.setHighlight(true);
      return;
    }
    const prev = this.highlighted.reed;
    if (prev) this.reeds.get(prev)?.setHighlight(false);
    this.highlighted.reed = id;
    if (id) this.reeds.get(id)?.setHighlight(true);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setSize(w, h, false);
    this.cameras.resize(w, h);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of this.switches.values()) v.dispose();
    for (const v of this.reeds.values()) v.dispose();
    this.switches.clear();
    this.reeds.clear();
    this.train.dispose();
    this.cameras.dispose();
    this.labels.dispose();
    disposeGeometries(this.scene);
    disposeMaterials(this.mats);
    this.scene.clear();
    this.renderer.dispose();
  }

  /** Number of meshes in the graph — used by the dev harness as a smoke check. */
  countMeshes(): number {
    let n = 0;
    this.scene.traverse((o) => {
      if ((o as Partial<Mesh>).isMesh === true) n += 1;
    });
    return n;
  }

  /**
   * True while the consist is deep enough inside a declared tunnel that the rock would hide
   * it anyway. Position-based, not edge-based: only ~157 mm of `e68`'s 553 mm is under rock,
   * and hiding the train for the whole edge made it vanish in broad daylight (REVIEW_SCENE.md
   * D6). Shallower than `TRAIN_HIDE_COVER_MM` the massif mesh occludes the lower part of the
   * vehicle by itself, which is exactly what running into a tunnel mouth looks like.
   */
  private insideMassif(edgeId: string, at: Vector3): boolean {
    if (!this.tunnelEdges.has(edgeId)) return false;
    return terrainCoverMm(this.landscape.terrain, this.frame, at) >= TRAIN_HIDE_COVER_MM;
  }

  /**
   * `PlantSnapshot.train.worldPos` is a point in the trackplan's own coordinate space.
   * Both documented unit variants are accepted (plan units per §7.1, or millimetres) by
   * testing plan-bounds containment: the two ranges differ by the `mmPerUnit` factor, so
   * the test is unambiguous for any on-track position and stays deterministic.
   */
  /**
   * The plant's consist path mapped into world space (`docs/REVIEW_SCENE.md` D12). Points are
   * written into a reused array — this runs on every rendered frame, and allocating ~350
   * `Vector3` per frame is pure GC churn for a value the renderer consumes immediately.
   */
  private consistWorldPath(path: ConsistPath): ConsistWorldPath {
    const pts = this.consistPts;
    for (let i = pts.length; i < path.pts.length; i += 1) pts.push(new Vector3());
    for (let i = 0; i < path.pts.length; i += 1) {
      const p = path.pts[i] as Vec2;
      const v = pts[i] as Vector3;
      v.set(this.frame.x(p.x), 0, this.frame.z(p.y));
    }
    return {
      startMm: path.startMm,
      stepMm: path.stepMm,
      pts: pts.length === path.pts.length ? pts : pts.slice(0, path.pts.length),
    };
  }

  private trainWorldPosition(worldPos: Vec2): Vector3 {
    const b = this.frame.bounds;
    const slack = 60;
    const inPlanUnits =
      worldPos.x >= b.minX - slack &&
      worldPos.x <= b.maxX + slack &&
      worldPos.y >= b.minY - slack &&
      worldPos.y <= b.maxY + slack;
    if (inPlanUnits) return this.frame.v(worldPos);
    const perUnit = this.frame.mmPerUnit || 1;
    return this.frame.v({ x: worldPos.x / perUnit, y: worldPos.y / perUnit });
  }

  private addDaylight(): void {
    const hemi = new HemisphereLight(PALETTE.sky, PALETTE.boardGrassDark, 1.4);
    hemi.position.set(0, 2, 0);
    this.scene.add(hemi);

    const sun = new DirectionalLight(0xfff4e2, 2.6);
    sun.position.set(
      this.frame.widthM * 0.5,
      Math.max(1.6, this.frame.widthM),
      this.frame.depthM * 0.6,
    );
    sun.target.position.set(0, 0, 0);
    this.scene.add(sun.target);
    if (this.quality === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      // square frustum in light space: the sun shines diagonally across the plate
      const r = Math.max(this.frame.widthM, this.frame.depthM) * 0.62;
      const cam = sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 0.05;
      cam.far = Math.max(6, this.frame.widthM * 3);
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0005;
    }
    this.scene.add(sun);
  }
}
