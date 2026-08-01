/**
 * Raycast picking for railway switches (scene editor, docs/DESIGN_SCENE_EDITOR.md §14.3).
 *
 * Every switch visual is a Group named `switch:<id>` (switchMesh.ts), and every child —
 * blades, throwbar, motor, lamp, label plate, highlight ring — hangs below it, so hit →
 * switch resolution is a parent walk for that prefix (the same split as the pump's
 * `pickTargetOf`, kept DOM-free: NDC in, id out, headless-testable with a plain Raycaster).
 *
 * Occlusion rule: hits are walked nearest-first; the first hit that belongs to a switch
 * wins, but a nearer VISIBLE non-switch surface (terrain, a building, the train) blocks the
 * pick — clicking a mountain must not select the switch buried behind it. Invisible hits
 * (e.g. another switch's hidden highlight ring, hidden tripod markers) never block.
 */
import { Raycaster, Vector2, type Camera, type Object3D } from 'three';

/** Group-name prefix of a switch visual — see switchMesh.ts `buildOne`. */
export const SWITCH_PICK_PREFIX = 'switch:';

export interface NdcPoint {
  readonly x: number;
  readonly y: number;
}

/** Nearest ancestor (or the object itself) that names a switch, else null. */
export function switchIdOfObject(object: Object3D | null): string | null {
  let node: Object3D | null = object;
  while (node !== null) {
    if (node.name.startsWith(SWITCH_PICK_PREFIX)) {
      return node.name.slice(SWITCH_PICK_PREFIX.length);
    }
    node = node.parent;
  }
  return null;
}

/** True when the object and every ancestor are visible — an invisible hit cannot occlude. */
function effectivelyVisible(object: Object3D): boolean {
  let node: Object3D | null = object;
  while (node !== null) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/** Switch id under the NDC point, or null (miss, or a visible non-switch surface in front). */
export function pickSwitchIn(root: Object3D, camera: Camera, at: NdcPoint): string | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(at.x, at.y), camera);
  for (const hit of raycaster.intersectObject(root, true)) {
    const id = switchIdOfObject(hit.object);
    if (id !== null) return id;
    if (effectivelyVisible(hit.object)) return null;
  }
  return null;
}
