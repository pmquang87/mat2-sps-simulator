/**
 * White label plates with black variable names (ARCHITECTURE.md §3 `scene/labels.ts`).
 *
 * On the real plant every switch and every reed contact carries a small white sticker with
 * its symbolic name (`xW02BH1G4`, `xR02BH1G1` — see `docs/research/frames/einfach_01.png`
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
  Vector3,
} from 'three';
import { DIM, PALETTE, type SceneQuality } from './materials';
import { MM } from './trackMesh';

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
    const back = new Mesh(geom, mat);
    back.position.copy(front.position);
    back.rotation.y = Math.PI;
    group.add(front, back);

    const postGeom = new PlaneGeometry(2.5 * MM, postHeightMm * MM);
    this.geometries.push(postGeom);
    const postMat = this.postMaterial();
    for (const sx of [-0.32, 0.32]) {
      const post = new Mesh(postGeom, postMat);
      post.position.set(widthMm * sx * MM, (postHeightMm / 2) * MM, 0);
      group.add(post);
      const postBack = new Mesh(postGeom, postMat);
      postBack.position.copy(post.position);
      postBack.rotation.y = Math.PI;
      group.add(postBack);
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
