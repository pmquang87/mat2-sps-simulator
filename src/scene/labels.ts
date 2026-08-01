/**
 * White label plates with black variable names (ARCHITECTURE.md §3 `scene/labels.ts`).
 *
 * On the real plant every switch and every reed contact carries a small white sticker with
 * its symbolic name (`xW02BH1G4`, `xR02BH1G1` — see `reference/research/frames/einfach_01.png`
 * and `reedkontakt_scaled.png`). `video_design.md` §4 calls them the didactic link between
 * plant and AWL program, so they are first-class scene objects here and drawn oversized
 * (`DIM.labelScale`) to stay readable.
 *
 * The text on a plate is a **plant identifier** (`xW…`/`xR…`/`BH1`/`G3`), i.e. data taken
 * verbatim from the trackplan, never UI prose — the scene therefore renders no translatable
 * string and needs no i18n key.
 *
 * `document` is only touched inside `createTexture`; without a DOM (node unit tests) the
 * factory degrades to blank plates instead of throwing.
 */
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three';
import { DIM, PALETTE, type SceneQuality } from './materials';
import { MM } from './trackMesh';

/** Separation between a station board's front and back text planes, mm (D14: no z-fight). */
export const BOARD_FACE_GAP_MM = 0.8;

export interface PlateOptions {
  /** grey plate for unwired reeds (no PLC input) */
  readonly grey?: boolean;
  /** plate length in mm before `DIM.labelScale` (default: text-dependent) */
  readonly lengthMm?: number;
  /** lean the plate up towards the viewer, radians (default 0.18) */
  readonly tiltRad?: number;
}

export interface BoardOptions {
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly postHeightMm?: number;
}

/**
 * Creates and owns every label texture/geometry in the scene and can hide them all at
 * once (`SceneManager.setLabelsVisible`).
 */
export class LabelFactory {
  private readonly quality: SceneQuality;
  private readonly textures = new Map<string, Texture | null>();
  private readonly materials = new Map<string, MeshBasicMaterial>();
  private readonly geometries: PlaneGeometry[] = [];
  private readonly roots: Object3D[] = [];
  private visible = true;

  constructor(quality: SceneQuality = 'high') {
    this.quality = quality;
  }

  /**
   * A flat white plate lying on the ballast shoulder, text running along its local +x.
   * The caller positions the plate and sets its yaw to the track tangent.
   */
  createPlate(text: string, opts: PlateOptions = {}): Mesh {
    const grey = opts.grey === true;
    const chars = Math.max(text.length, 4);
    const lengthMm = opts.lengthMm ?? Math.max(DIM.labelPlateLength, chars * 2.6);
    const w = lengthMm * DIM.labelScale * MM;
    const h = DIM.labelPlateWidth * DIM.labelScale * MM;
    const geom = new PlaneGeometry(w, h);
    this.geometries.push(geom);
    const mesh = new Mesh(geom, this.material(text, grey));
    mesh.name = `label:${text}`;
    // lie flat on the board, leaning slightly up for legibility from the orbit camera.
    // 'YXZ': yaw (track tangent) first, then the tilt around the plate's own long axis.
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2 + (opts.tiltRad ?? 0.18);
    mesh.visible = this.visible;
    this.roots.push(mesh);
    return mesh;
  }

  /**
   * An upright, double-sided station name board on two posts (text readable from both
   * sides). Returns a group whose origin sits on the ground.
   *
   * The front and back text planes are separated by `BOARD_FACE_GAP_MM` — coincident planes
   * z-fight, which showed as the BH1–BH3 boards flickering between normal and mirrored text
   * (`docs/REVIEW_SCENE.md` D14). The posts are single DoubleSide planes for the same reason.
   */
  createBoard(text: string, opts: BoardOptions = {}): Group {
    const widthMm = opts.widthMm ?? DIM.stationBoardWidth;
    const heightMm = opts.heightMm ?? DIM.stationBoardHeight;
    const postHeightMm = opts.postHeightMm ?? DIM.stationBoardPostHeight;
    const group = new Group();
    group.name = `board:${text}`;

    const geom = new PlaneGeometry(widthMm * MM, heightMm * MM);
    this.geometries.push(geom);
    const mat = this.material(text, false);
    const front = new Mesh(geom, mat);
    front.position.y = (postHeightMm + heightMm / 2) * MM;
    front.position.z = (BOARD_FACE_GAP_MM / 2) * MM;
    const back = new Mesh(geom, mat);
    back.position.copy(front.position);
    back.position.z = -(BOARD_FACE_GAP_MM / 2) * MM;
    back.rotation.y = Math.PI;
    group.add(front, back);

    const postGeom = new PlaneGeometry(2.5 * MM, postHeightMm * MM);
    this.geometries.push(postGeom);
    const postMat = this.postMaterial();
    for (const sx of [-0.32, 0.32]) {
      const post = new Mesh(postGeom, postMat);
      post.position.set(widthMm * sx * MM, (postHeightMm / 2) * MM, 0);
      group.add(post);
    }

    group.visible = this.visible;
    this.roots.push(group);
    return group;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const root of this.roots) root.visible = v;
  }

  isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    for (const t of this.textures.values()) t?.dispose();
    this.textures.clear();
    this.roots.length = 0;
  }

  private material(text: string, grey: boolean): MeshBasicMaterial {
    const key = `${grey ? 'g' : 'w'}:${text}`;
    const existing = this.materials.get(key);
    if (existing) return existing;
    const tex = this.texture(text, grey);
    const mat = new MeshBasicMaterial({
      color: grey ? PALETTE.labelPlateGrey : PALETTE.labelPlate,
      side: DoubleSide,
      toneMapped: false,
    });
    if (tex) mat.map = tex;
    this.materials.set(key, mat);
    return mat;
  }

  private postMaterial(): MeshBasicMaterial {
    const key = 'post';
    const existing = this.materials.get(key);
    if (existing) return existing;
    const mat = new MeshBasicMaterial({ color: 0x8b8b86, side: DoubleSide });
    this.materials.set(key, mat);
    return mat;
  }

  private texture(text: string, grey: boolean): Texture | null {
    const key = `${grey ? 'g' : 'w'}:${text}`;
    if (this.textures.has(key)) return this.textures.get(key) ?? null;
    const tex = createTextTexture(text, grey, this.quality);
    this.textures.set(key, tex);
    return tex;
  }
}

/**
 * Renders `text` centred on a white plate into a canvas texture. Returns `null` when no
 * DOM is available (headless tests) so callers keep working with a blank plate.
 */
export function createTextTexture(
  text: string,
  grey: boolean,
  quality: SceneQuality = 'high',
): Texture | null {
  if (typeof document === 'undefined') return null;
  const fontPx = quality === 'high' ? 96 : 56;
  const padX = fontPx * 0.35;
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) return null;
  probe.font = `700 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  const textWidth = probe.measureText(text).width;
  canvas.width = Math.max(64, Math.ceil(textWidth + padX * 2));
  canvas.height = Math.ceil(fontPx * 1.6);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = grey ? '#cac7bf' : '#f6f5f0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `700 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = grey ? '#4a4a46' : '#141414';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + fontPx * 0.04);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Longest slide `deconflictPlates` may apply to one plate, mm (keeps labels by their referent). */
export const DECONFLICT_MAX_SLIDE_MM = 60;

/**
 * Slides overlapping label plates apart along their own long axes (D15, corrected by D17).
 *
 * Plates are placed per referent (switch, reed, platform lane) without knowledge of each
 * other, and the Gleisplan packs some referents closer than two plates: `xW01BH1G1` and
 * `xW02BH1G1` face each other across the short toe edge `e22`, so their plates met in its
 * middle (325 mm² overlap — the user-visible stack of two labels). This pass runs once after
 * the static scene is composed and resolves every such pair deterministically, in name order.
 *
 * Direction (D17): a plate first RETREATS towards its own referent (`userData.anchorWorld`,
 * set at creation) along its local +x, and only flees the other plate once it stands abeam
 * its anchor. Fleeing alone swapped the e22 pair: both plates start past the middle of the
 * short edge — i.e. already on the OTHER switch's side — so "away from each other" pushed
 * each one deeper into the wrong territory, and the user read each label as naming the wrong
 * switch. Retreating keeps a label with what it names. Sliding stays bounded by
 * `DECONFLICT_MAX_SLIDE_MM`; `tests/scene/labelPlacement.test.ts` asserts the result (zero
 * overlaps board-wide, every switch plate nearest its own node) with an independent metric.
 */
export function deconflictPlates(root: Object3D, trace?: (msg: string) => void): void {
  root.updateWorldMatrix(true, true);
  const plates: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.name.startsWith('label:') && o.geometry instanceof PlaneGeometry) {
      plates.push(o);
    }
  });
  plates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // ── stage 1 (D17): misplaced plates retreat home ─────────────────────────────────────────
  // A plate standing nearer a FOREIGN referent than its own reads as labelling that referent,
  // overlap or not: the e22 toe plates were placed past the middle of their short shared edge
  // (each on the other switch's side — the "swapped labels" report), and xW01BH2G2/xW02BH2G2
  // were placed that way without ever overlapping. Retreat is bounded by geometry — a plate
  // stops abeam its anchor — so this stage cannot oscillate; running it BEFORE the flee stage
  // is what keeps the two goals from fighting (a flee step re-enables retreat along the axis,
  // and an interleaved retreat preference pulled fleeing plates straight back into overlap).
  const anchors = plates.map((p) => p.userData['anchorWorld'] as Vector3 | undefined);
  for (let iter = 0; iter < 120; iter += 1) {
    let anyMoved = false;
    for (let i = 0; i < plates.length; i += 1) {
      const own = anchors[i];
      if (own === undefined) continue;
      const a = plates[i] as Mesh;
      const centre = new Vector3().setFromMatrixPosition(a.matrixWorld);
      const misplaced = anchors.some((foreign, j) =>
        j !== i
        && foreign !== undefined
        && own.distanceTo(foreign) >= 40 * MM
        && centre.distanceTo(foreign) < centre.distanceTo(own));
      if (!misplaced) continue;
      if (retreatPlate(a, own)) anyMoved = true;
      trace?.(`retreat iter ${iter} ${a.name} moved=${String(anyMoved)}`);
    }
    if (!anyMoved) break;
  }

  // ── stage 2 (D15): whatever still overlaps flees along its own axis ──────────────────────
  const slidMm = new Map<Mesh, number>();
  for (let iter = 0; iter < 80; iter += 1) {
    let anyOverlap = false;
    for (let i = 0; i < plates.length; i += 1) {
      for (let j = i + 1; j < plates.length; j += 1) {
        const a = plates[i] as Mesh;
        const b = plates[j] as Mesh;
        if (!quadsOverlapXZ(plateQuadXZ(a), plateQuadXZ(b))) continue;
        anyOverlap = true;
        const ca = new Vector3().setFromMatrixPosition(a.matrixWorld);
        const cb = new Vector3().setFromMatrixPosition(b.matrixWorld);
        const away = ca.clone().sub(cb).setY(0);
        fleePlate(a, away, slidMm);
        fleePlate(b, away.negate(), slidMm);
        trace?.(`flee iter ${iter} ${a.name}×${b.name}`);
      }
    }
    if (!anyOverlap) return;
  }
}

const SLIDE_STEP_MM = 2;

/** One bounded step of `plate` towards its anchor along its own axis; stops abeam. */
function retreatPlate(plate: Mesh, anchor: Vector3): boolean {
  const axis = new Vector3().setFromMatrixColumn(plate.matrixWorld, 0).setY(0).normalize();
  const centre = new Vector3().setFromMatrixPosition(plate.matrixWorld);
  const towardMm = anchor.clone().sub(centre).setY(0).dot(axis) / MM;
  if (Math.abs(towardMm) <= SLIDE_STEP_MM) return false;
  translateAlong(plate, axis, Math.sign(towardMm) * SLIDE_STEP_MM);
  return true;
}

/** One budgeted step of `plate` along its own axis, signed away from the other plate. */
function fleePlate(plate: Mesh, awayWorld: Vector3, slidMm: Map<Mesh, number>): void {
  const used = slidMm.get(plate) ?? 0;
  if (used + SLIDE_STEP_MM > DECONFLICT_MAX_SLIDE_MM) return;
  const axis = new Vector3().setFromMatrixColumn(plate.matrixWorld, 0).setY(0).normalize();
  const sign = axis.dot(awayWorld) >= 0 ? 1 : -1;
  translateAlong(plate, axis, sign * SLIDE_STEP_MM);
  slidMm.set(plate, used + SLIDE_STEP_MM);
}

/** Applies a world-space slide of `mmAlong` × `axisWorld` in the plate's parent frame. */
function translateAlong(plate: Mesh, axisWorld: Vector3, mmAlong: number): void {
  const deltaWorld = axisWorld.clone().multiplyScalar(mmAlong * MM);
  const parent = plate.parent;
  if (parent) {
    const p0 = plate.getWorldPosition(new Vector3());
    const p1 = p0.clone().add(deltaWorld);
    plate.position.add(parent.worldToLocal(p1).sub(parent.worldToLocal(p0.clone())));
  } else {
    plate.position.add(deltaWorld);
  }
  plate.updateWorldMatrix(true, false);
}

/** World XZ corners of a plate (its `PlaneGeometry` footprint under its world matrix). */
function plateQuadXZ(plate: Mesh): Vector2[] {
  const { width, height } = (plate.geometry as PlaneGeometry).parameters;
  const corners = [
    new Vector3(-width / 2, -height / 2, 0),
    new Vector3(width / 2, -height / 2, 0),
    new Vector3(width / 2, height / 2, 0),
    new Vector3(-width / 2, height / 2, 0),
  ];
  return corners.map((c) => {
    const w = c.applyMatrix4(plate.matrixWorld);
    return new Vector2(w.x, w.z);
  });
}

/** Separating-axis test for two convex quads in the XZ plane. */
function quadsOverlapXZ(a: Vector2[], b: Vector2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i] as Vector2;
      const q = poly[(i + 1) % poly.length] as Vector2;
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of a) {
        const d = v.x * nx + v.y * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of b) {
        const d = v.x * nx + v.y * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Places a plate beside the track: `position` on the track, `tangent`/`lateral` in world. */
export function placePlate(
  plate: Mesh,
  position: Vector3,
  tangent: Vector3,
  lateral: Vector3,
  offsetMm: number,
  heightMm: number,
): void {
  plate.position.copy(position).addScaledVector(lateral, offsetMm * MM);
  plate.position.y = heightMm * MM;
  // rotation.order is 'YXZ' (set in createPlate): yaw here, tilt/flat stays in rotation.x
  plate.rotation.y = Math.atan2(-tangent.z, tangent.x);
}
