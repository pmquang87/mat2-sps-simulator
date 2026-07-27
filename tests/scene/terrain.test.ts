/**
 * Terrain and tunnel-portal contract (`docs/REVIEW_SCENE.md` D5 and D6).
 *
 * `landscape.mountains` used to cover far more track than the trackplan declares as a tunnel,
 * so a massif built from bare cones buried open track *and* every portal inside its slope: no
 * tunnel mouth was visible (D5) and `e68` was invisible over its whole 158 pt (D6). The massif
 * is now a height field of overlapping smoothstep hills with a rock cutting carved along every
 * open corridor, and the mouths are derived from that field instead of from graph topology.
 * These tests are the regression guard:
 *
 * - no open (non-tunnel) track is ever buried — checked analytically over the full ballast
 *   width *and* by raycasting the real mesh from above, plus every reed and switch node;
 * - every bore is short (≤ 70 pt) so the train is only briefly out of sight;
 * - a portal exists at every transition of a declared tunnel edge into full rock cover, and
 *   nowhere else; each pair is lined by one swept dark bore;
 * - a portal sits *on* the rock face (cover ≈ the portal height, never below it);
 * - portal yaw follows the local track tangent;
 * - the `Aussichtsturm` stands high and level;
 * - the massif is wound outwards, so no camera can see an unlit back face.
 */
import { describe, expect, it } from 'vitest';
import {
  Box3,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import trackplanJson from '../../src/data/trackplan.json';
import type { TrackplanFile } from '../../src/plant';
import {
  APERTURE_H_MM,
  APERTURE_W_MM,
  BORE_ROOF_MM,
  DIM,
  LabelFactory,
  MM,
  PORTAL_COVER_MM,
  PORTAL_TOP_MM,
  PlanFrame,
  RAIL_TOP_MM,
  TRAIN_HIDE_COVER_MM,
  buildEdgeCurves,
  buildLandscape,
  buildTerrain,
  buildTrackMeshes,
  createMaterials,
  findPortalSites,
  lateralOf,
  poseAtOffsetMm,
  resolveTunnels,
  tunnelBores,
  tunnelEdgeIds,
  yawOfTangent,
  type Terrain,
} from '../../src/scene';
import { straightPlan } from './fixture';

const plan = trackplanJson as unknown as TrackplanFile;

/**
 * Longest bore the didactics tolerate (`docs/REVIEW_SCENE.md` D6): the train may only be out
 * of sight briefly. 70 pt = 245 mm ≈ 0.9…3 s at the plant's three speeds.
 */
const MAX_BURIED_PT = 70;

function ctx(tp: TrackplanFile) {
  const frame = PlanFrame.fromTrackplan(tp);
  const curves = buildEdgeCurves(tp, frame);
  const terrain = buildTerrain(tp, frame);
  return { frame, curves, terrain };
}

function coverMm(terrain: Terrain, frame: PlanFrame, at: Vector3): number {
  return terrain.heightAt(frame.planX(at.x), frame.planY(at.z)) / MM;
}

describe('terrain height field', () => {
  it('is flat off the massif and tall in its core', () => {
    const { frame, terrain } = ctx(plan);
    const b = frame.bounds;
    expect(terrain.heightPt(b.minX - 20, b.minY - 20)).toBe(0);
    const core = plan.landscape.mountains[0]!;
    expect(terrain.heightPt(core.center.x, core.center.y)).toBeGreaterThan(core.heightPt * 0.5);
    expect(terrain.extent).not.toBeNull();
  });

  it('never buries open track, over the full ballast width', () => {
    const { frame, curves, terrain } = ctx(plan);
    const tunnels = tunnelEdgeIds(plan);
    let checked = 0;
    for (const [id, curve] of curves) {
      if (tunnels.has(id)) continue;
      for (let s = 0; s <= curve.lengthMm; s += 5) {
        const pose = poseAtOffsetMm(curve, s);
        const lat = lateralOf(pose.tangent);
        // centre line and both ballast shoulders: the rails and sleepers must be in the open
        for (const off of [0, DIM.ballastHalfWidth, -DIM.ballastHalfWidth]) {
          const at = pose.position.clone().addScaledVector(lat, off * MM);
          expect(coverMm(terrain, frame, at), `${id}@${s}mm off ${off}`).toBeLessThanOrEqual(
            RAIL_TOP_MM,
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('leaves the massif mesh entirely clear of open track (bird camera sees rails)', () => {
    // the analytic field being 0 is not enough: the *mesh* interpolates between grid vertices,
    // so drop a ray straight down onto the massif over every open corridor and check nothing
    // of it stands above the rail head.
    const { frame, curves, terrain } = ctx(plan);
    void terrain;
    const result = buildLandscape({
      tp: plan,
      curves,
      frame,
      mats: createMaterials('high'),
      labels: new LabelFactory('high'),
      quality: 'high',
    });
    result.group.updateMatrixWorld(true);
    let massif: Mesh | null = null;
    result.group.traverse((o) => {
      if (o.name === 'massif') massif = o as Mesh;
    });
    expect(massif).not.toBeNull();

    const tunnels = tunnelEdgeIds(plan);
    const rc = new Raycaster();
    const down = new Vector3(0, -1, 0);
    let rays = 0;
    for (const [id, curve] of curves) {
      if (tunnels.has(id)) continue;
      for (let s = 0; s <= curve.lengthMm; s += 15) {
        const pose = poseAtOffsetMm(curve, s);
        const lat = lateralOf(pose.tangent);
        for (const off of [0, DIM.ballastHalfWidth, -DIM.ballastHalfWidth]) {
          const from = pose.position.clone().addScaledVector(lat, off * MM).setY(1);
          rc.set(from, down);
          const hit = rc.intersectObject(massif as unknown as Mesh, false)[0];
          rays += 1;
          if (!hit) continue;
          expect(hit.point.y / MM, `${id}@${s}mm off ${off}`).toBeLessThanOrEqual(RAIL_TOP_MM);
        }
      }
    }
    expect(rays).toBeGreaterThan(1000);
  });

  it('keeps every reed and switch node in daylight', () => {
    const { frame, curves, terrain } = ctx(plan);
    for (const reed of plan.reeds) {
      const curve = curves.get(reed.edgeId);
      if (!curve) continue;
      const at = poseAtOffsetMm(curve, reed.offsetMm).position;
      expect(coverMm(terrain, frame, at), reed.id).toBeLessThanOrEqual(RAIL_TOP_MM);
    }
    for (const sw of plan.switches) {
      const node = plan.nodes.find((n) => n.id === sw.nodeId);
      if (!node) continue;
      expect(terrain.heightAt(node.pt.x, node.pt.y) / MM, sw.id).toBeLessThanOrEqual(RAIL_TOP_MM);
    }
  });

  it('stands the Aussichtsturm on a summit, not on flat grass (ground only)', () => {
    const { frame, terrain } = ctx(plan);
    void frame;
    const tower = plan.landscape.buildings.find((b) => b.kind.toLowerCase().includes('turm'));
    expect(tower).toBeDefined();
    const ground = terrain.heightAt(tower!.pt.x, tower!.pt.y) / MM;
    expect(ground).toBeGreaterThanOrEqual(100);
    // level enough to stand on: the summit of a smoothstep hill is flat, so the terrain one
    // tower-base radius away may not fall away by more than 20 mm (else the shaft floats)
    const radiusPt = 15 / frame.mmPerUnit;
    for (const [dx, dy] of [
      [radiusPt, 0],
      [-radiusPt, 0],
      [0, radiusPt],
      [0, -radiusPt],
    ] as const) {
      const near = terrain.heightAt(tower!.pt.x + dx, tower!.pt.y + dy) / MM;
      expect(Math.abs(ground - near)).toBeLessThan(20);
    }
  });

  it('is a single mesh wound outwards (no visible back faces)', () => {
    const { frame, curves } = ctx(plan);
    const result = buildLandscape({
      tp: plan,
      curves,
      frame,
      mats: createMaterials('high'),
      labels: new LabelFactory('high'),
      quality: 'high',
    });
    const massifs: Mesh[] = [];
    result.group.traverse((o) => {
      if (o.name === 'massif') massifs.push(o as Mesh);
    });
    expect(massifs).toHaveLength(1);
    const normals = massifs[0]!.geometry.getAttribute('normal');
    expect(normals.count).toBeGreaterThan(500);
    for (let i = 0; i < normals.count; i += 1) {
      expect(normals.getY(i)).toBeGreaterThan(0);
    }
  });

  it('sets every gable roof face pointing away from the roof volume', () => {
    const { frame, curves } = ctx(plan);
    const result = buildLandscape({
      tp: plan,
      curves,
      frame,
      mats: createMaterials('high'),
      labels: new LabelFactory('high'),
      quality: 'high',
    });
    let roofs = 0;
    result.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !o.parent?.name.startsWith('building:')) return;
      const pos = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      if (!pos || !normal || pos.count !== 6) return; // the gable prism has 6 vertices
      roofs += 1;
      for (let i = 0; i < normal.count; i += 1) {
        // both slopes and both gables lean outwards, i.e. upwards — never down into the walls
        expect(normal.getY(i)).toBeGreaterThan(0);
      }
    });
    expect(roofs).toBeGreaterThan(0);
  });
});

describe('tunnel portals', () => {
  it('places one portal per declared-tunnel entry into the massif', () => {
    const { frame, curves, terrain } = ctx(plan);
    const sites = findPortalSites(plan, curves, frame, terrain);
    expect(sites.length).toBeGreaterThan(0);

    // an independent recount of the cover transitions along every tunnel edge
    const coverPt = PORTAL_COVER_MM / frame.mmPerUnit;
    let transitions = 0;
    for (const id of tunnelEdgeIds(plan)) {
      const curve = curves.get(id);
      if (!curve) continue;
      let prev: boolean | null = null;
      for (let s = 0; s <= curve.lengthMm; s += 1) {
        const p = poseAtOffsetMm(curve, s).position;
        const covered = terrain.heightPt(frame.planX(p.x), frame.planY(p.z)) >= coverPt;
        if (prev !== null && covered !== prev) transitions += 1;
        prev = covered;
      }
    }
    expect(sites).toHaveLength(transitions);

    // one entry and one exit: every bore is closed at both ends
    expect(sites.filter((s) => s.inward === 1)).toHaveLength(sites.length / 2);
  });

  it('puts every portal on the rock face, never buried in the slope', () => {
    const { frame, curves } = ctx(plan);
    const { terrain, sites } = resolveTunnels(plan, curves, frame);
    for (const site of sites) {
      const coverMm = site.terrainPt * frame.mmPerUnit;
      // enough rock over the aperture to read as a hillside…
      expect(coverMm).toBeGreaterThanOrEqual(PORTAL_COVER_MM - 1);
      // …but the site really is the crossing, not a point deep inside the massif
      expect(coverMm).toBeLessThan(PORTAL_COVER_MM + 12);
      // …and the mouth opens into daylight: the approach in front of it is cut open
      const outside = poseAtOffsetMm(
        curves.get(site.edgeId)!,
        site.offsetMm - site.inward * 40,
      ).position;
      const outsideMm = terrain.heightAt(frame.planX(outside.x), frame.planY(outside.z)) / MM;
      expect(outsideMm).toBeLessThanOrEqual(RAIL_TOP_MM);
    }
  });

  it('orients every portal along the local track tangent', () => {
    const { frame, curves, terrain } = ctx(plan);
    const sites = findPortalSites(plan, curves, frame, terrain);
    const result = buildLandscape({
      tp: plan,
      curves,
      frame,
      mats: createMaterials('high'),
      labels: new LabelFactory('high'),
      quality: 'high',
    });
    const portals: Vector3[] = [];
    const yaws: number[] = [];
    result.group.traverse((o) => {
      if (o.name !== 'portal') return;
      portals.push(o.position.clone());
      yaws.push(o.rotation.y);
    });
    expect(portals).toHaveLength(sites.length);

    for (const site of sites) {
      const curve = curves.get(site.edgeId)!;
      const expectedYaw = yawOfTangent(site.tangent);
      // the tangent really is the edge's own direction at that offset
      const ahead = poseAtOffsetMm(curve, Math.min(site.offsetMm + 4, curve.lengthMm)).position;
      const behind = poseAtOffsetMm(curve, Math.max(site.offsetMm - 4, 0)).position;
      const chord = ahead.clone().sub(behind).setY(0).normalize();
      expect(chord.dot(site.tangent)).toBeGreaterThan(0.99);

      // a portal group stands within half a portal depth of the site, at the tangent's yaw
      const idx = portals.findIndex((p) => p.distanceTo(site.position) < 12 * MM);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(Math.abs(wrapPi(yaws[idx]! - expectedYaw))).toBeLessThan(1e-6);
    }
  });

  it('reports no portal when nothing is covered deeply enough', () => {
    const tp = straightPlan();
    const { frame, curves, terrain } = ctx(tp);
    expect(findPortalSites(tp, curves, frame, terrain)).toHaveLength(0);
    expect(tunnelBores(tp, curves, frame, terrain)).toHaveLength(0);
  });

  it('keeps every bore short: the train is only briefly out of sight', () => {
    const { frame, curves, terrain } = ctx(plan);
    const tunnels = tunnelEdgeIds(plan);
    expect(tunnels.size).toBeGreaterThan(0);
    for (const id of tunnels) {
      const curve = curves.get(id);
      if (!curve) continue;
      let buriedMm = 0;
      let hiddenMm = 0;
      for (let s = 0; s <= curve.lengthMm; s += 1) {
        const cover = coverMm(terrain, frame, poseAtOffsetMm(curve, s).position);
        if (cover > RAIL_TOP_MM) buriedMm += 1;
        if (cover >= TRAIN_HIDE_COVER_MM) hiddenMm += 1;
      }
      expect(buriedMm / frame.mmPerUnit, `${id} buried pt`).toBeLessThanOrEqual(MAX_BURIED_PT);
      // and the stretch the SceneManager blanks the train over is shorter still
      expect(hiddenMm).toBeLessThanOrEqual(buriedMm);
    }
  });

  it('lines every bore between a paired entry and exit mouth', () => {
    const { frame, curves, terrain } = ctx(plan);
    const sites = findPortalSites(plan, curves, frame, terrain);
    const bores = tunnelBores(plan, curves, frame, terrain);
    expect(bores).toHaveLength(sites.length / 2);
    for (const bore of bores) {
      expect(bore.endMm).toBeGreaterThan(bore.startMm);
      const curve = curves.get(bore.edgeId);
      expect(curve).toBeDefined();
      // the rock over the whole lined stretch clears the bore's own roof
      const roof = BORE_ROOF_MM;
      for (let s = bore.startMm; s <= bore.endMm; s += 2) {
        const cover = coverMm(terrain, frame, poseAtOffsetMm(curve!, s).position);
        expect(cover, `${bore.edgeId}@${s}mm`).toBeGreaterThan(roof);
      }
    }
    // the swept tube really is in the scene, one per bore
    const result = buildLandscape({
      tp: plan,
      curves,
      frame,
      mats: createMaterials('high'),
      labels: new LabelFactory('high'),
      quality: 'high',
    });
    const tubes: string[] = [];
    result.group.traverse((o) => {
      if (o.name.startsWith('bore:')) tubes.push(o.name);
    });
    expect(tubes).toHaveLength(bores.length);
  });
});

function wrapPi(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

// ────────────────────────────── scenery visibility ──────────────────────────────

/**
 * Ground height is not visibility (`docs/REVIEW_SCENE.md` D7): the Aussichtsturm passed the
 * "on a summit" test at 182 mm of ground while 67 mm of its 157 mm shaft was sunk into that
 * summit, because the ground probe sampled the corners of its bounding square out in the rock
 * cutting. These tests assert that the landmark scenery actually *takes rays* from the two
 * overview cameras — the only assertion that would have caught it.
 */
function fullScene(): { scene: Scene; frame: PlanFrame } {
  const frame = PlanFrame.fromTrackplan(plan);
  const curves = buildEdgeCurves(plan, frame);
  const mats = createMaterials('high');
  const scene = new Scene();
  scene.add(
    buildLandscape({
      tp: plan,
      curves,
      frame,
      mats,
      labels: new LabelFactory('high'),
      quality: 'high',
    }).group,
  );
  scene.add(buildTrackMeshes(curves, mats, 'high').group);
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const parts: string[] = [];
    let cur: typeof o | null = o;
    while (cur) {
      if (cur.name) parts.unshift(cur.name);
      cur = cur.parent;
    }
    o.userData.path = parts.join('/');
  });
  return { scene, frame };
}

/** The app's Bird rig (cameras.ts): top-down orthographic over the whole plate. */
function birdCamera(frame: PlanFrame, aspect = 866 / 555): OrthographicCamera {
  const margin = frame.units(30);
  const halfW = frame.widthM / 2 + margin;
  const halfD = frame.depthM / 2 + margin;
  const cam = new OrthographicCamera(-halfW, halfW, halfD, -halfD, 0.01, 20);
  cam.position.set(0, 4, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  if (aspect >= halfW / halfD) {
    cam.top = halfD;
    cam.bottom = -halfD;
    cam.right = halfD * aspect;
    cam.left = -halfD * aspect;
  }
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

/** The app's default Orbit rig (cameras.ts). */
function orbitCamera(frame: PlanFrame, aspect = 866 / 555): PerspectiveCamera {
  const margin = frame.units(30);
  const fit = Math.max(frame.widthM / 2 + margin, frame.depthM / 2 + margin) * 1.55;
  const cam = new PerspectiveCamera(45, aspect, 0.01, 80);
  cam.position.set(0, fit * 0.72, fit * 0.86);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/**
 * Casts a small fan of camera rays through the pixel `target` projects to and counts how many
 * first hits belong to an object whose scene path contains `needle`. A full-frame sweep would
 * be the same measurement 10 000× more slowly.
 */
function raysOnto(scene: Scene, cam: Camera, target: Vector3, needle: string): number {
  const ndc = target.clone().project(cam);
  const rc = new Raycaster();
  let hits = 0;
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      rc.setFromCamera(new Vector2(ndc.x + i * 0.004, ndc.y + j * 0.004), cam);
      const hit = rc.intersectObject(scene, true)[0];
      if (hit && String(hit.object.userData.path).includes(needle)) hits += 1;
    }
  }
  return hits;
}

describe('scenery visibility from the overview cameras', () => {
  it('shows the Aussichtsturm standing clear of its own summit', () => {
    const { scene, frame } = fullScene();
    const terrain = buildTerrain(plan, frame);
    const tower = scene.getObjectByName('building:aussichtsturm');
    expect(tower, 'tower missing from the scene graph').toBeDefined();

    const spec = plan.landscape.buildings.find((b) => b.kind.toLowerCase().includes('turm'))!;
    // the tower is exempt from the track-clearance push: a lookout tower has no platform to
    // stand behind, so it must stay exactly on the summit the trackplan puts it on
    expect(tower!.position.x).toBeCloseTo(frame.x(spec.pt.x), 9);
    expect(tower!.position.z).toBeCloseTo(frame.z(spec.pt.y), 9);

    const box = new Box3().setFromObject(tower!);
    // highest terrain anywhere under/around the footprint, i.e. what could swallow it
    let terrainMax = terrain.heightAt(spec.pt.x, spec.pt.y);
    const probe = 22 / frame.mmPerUnit;
    for (let a = 0; a < 12; a += 1) {
      const th = (a / 12) * Math.PI * 2;
      const h = terrain.heightAt(
        spec.pt.x + Math.cos(th) * probe,
        spec.pt.y + Math.sin(th) * probe,
      );
      if (h > terrainMax) terrainMax = h;
    }
    // the roof tip must clear it by a landmark's worth of height, not by a few mm
    expect((box.max.y - terrainMax) / MM).toBeGreaterThanOrEqual(120);
    // and at most a quarter of the tower may be sunk into the ground it stands on
    expect((terrainMax - box.min.y) / MM).toBeLessThan(157 / 4);
  });

  it('takes rays from the Bird and Orbit cameras for tower, island and portals', () => {
    const { scene, frame } = fullScene();
    const bird = birdCamera(frame);
    const orbit = orbitCamera(frame);

    const tower = scene.getObjectByName('building:aussichtsturm');
    const towerTop = new Box3().setFromObject(tower!).getCenter(new Vector3());
    towerTop.y = new Box3().setFromObject(tower!).max.y - 0.01;
    expect(raysOnto(scene, bird, towerTop, 'aussichtsturm'), 'tower from Bird').toBeGreaterThan(0);
    expect(raysOnto(scene, orbit, towerTop, 'aussichtsturm'), 'tower from Orbit').toBeGreaterThan(
      0,
    );

    const island = scene.getObjectByName('lakeIsland');
    expect(island, 'lake island missing').toBeDefined();
    const islandTop = new Box3().setFromObject(island!).max.clone();
    islandTop.x = island!.position.x;
    islandTop.z = island!.position.z;
    islandTop.y -= 0.0005;
    expect(raysOnto(scene, bird, islandTop, 'lakeIsland'), 'island from Bird').toBeGreaterThan(0);

    const curves = buildEdgeCurves(plan, frame);
    const terrain = buildTerrain(plan, frame);
    const sites = findPortalSites(plan, curves, frame, terrain);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      // aim at the lintel, the part of a portal an overview camera can see
      const at = site.position.clone().setY((PORTAL_TOP_MM - 4) * MM);
      const fromBird = raysOnto(scene, bird, at, 'portal');
      const fromOrbit = raysOnto(scene, orbit, at, 'portal');
      expect(fromBird + fromOrbit, `portal ${site.edgeId}@${site.offsetMm.toFixed(0)}`).toBeGreaterThan(
        0,
      );
    }
  });
});

// ────────────────────────────── the mouth, seen from the track ──────────────────────────────

/**
 * `docs/REVIEW_SCENE.md` D8: the user saw "rail go direct into mountain without tunnel, the gate
 * is already there but no tunnel". A height field is a single-valued surface, so it closed over
 * the rails 14 mm *in front* of the frame and there was no aperture to look into at all.
 *
 * Overhead ray counts cannot see an aperture by construction, so these acceptance tests look
 * along the track from rail height, exactly the way the user does.
 */
describe('tunnel mouth at track level', () => {
  it('shows a clear majority of central rays hitting the dark bore', () => {
    const { scene, frame } = fullScene();
    const curves = buildEdgeCurves(plan, frame);
    const { sites } = resolveTunnels(plan, curves, frame);
    expect(sites.length).toBeGreaterThan(0);
    const rc = new Raycaster();

    for (const site of sites) {
      const curve = curves.get(site.edgeId)!;
      // eye on the track itself, 140 mm out on the approach, at aperture-centre height
      const eyeOff = Math.max(0, Math.min(curve.lengthMm, site.offsetMm - site.inward * 140));
      const eye = poseAtOffsetMm(curve, eyeOff).position.clone().setY((APERTURE_H_MM / 2) * MM);
      const cam = new PerspectiveCamera(30, 1.6, 0.005, 5);
      cam.position.copy(eye);
      cam.lookAt(site.position.x, (APERTURE_H_MM / 2) * MM, site.position.z);
      cam.updateMatrixWorld(true);

      let bore = 0;
      let total = 0;
      for (let i = 0; i < 7; i += 1) {
        for (let j = 0; j < 7; j += 1) {
          rc.setFromCamera(
            new Vector2(-0.12 + (0.24 * i) / 6, -0.12 + (0.24 * j) / 6),
            cam,
          );
          const hit = rc.intersectObject(scene, true)[0];
          total += 1;
          if (hit && String(hit.object.userData.path).includes('bore:')) bore += 1;
        }
      }
      // a clear majority: the rails must run into darkness, not into a hillside
      expect(bore / total, `${site.edgeId}@${site.offsetMm.toFixed(0)}mm`).toBeGreaterThan(0.6);
    }
  });

  it('opens the approach so the rock stops at the masonry face', () => {
    const frame = PlanFrame.fromTrackplan(plan);
    const curves = buildEdgeCurves(plan, frame);
    const { terrain, sites } = resolveTunnels(plan, curves, frame);
    for (const site of sites) {
      const curve = curves.get(site.edgeId)!;
      // in front of the mouth: bare board, all the way to the frame
      for (let d = 4; d <= 120; d += 4) {
        const off = site.offsetMm - site.inward * d;
        if (off < 0 || off > curve.lengthMm) break;
        const p = poseAtOffsetMm(curve, off).position;
        expect(coverMm(terrain, frame, p), `${site.edgeId} ${d}mm out`).toBeLessThanOrEqual(
          RAIL_TOP_MM,
        );
      }
      // just behind it: real rock, deeper than the aperture is tall
      const inside = poseAtOffsetMm(curve, site.offsetMm + site.inward * 20).position;
      expect(coverMm(terrain, frame, inside)).toBeGreaterThan(APERTURE_H_MM);
    }
  });

  it('keeps the loading gauge clear of terrain along every bore', () => {
    const { scene, frame } = fullScene();
    const curves = buildEdgeCurves(plan, frame);
    const { bores } = resolveTunnels(plan, curves, frame);
    let massif: Mesh | null = null;
    scene.traverse((o) => {
      if (o.name === 'massif') massif = o as Mesh;
    });
    expect(massif).not.toBeNull();
    const rc = new Raycaster();
    const down = new Vector3(0, -1, 0);
    const halfGauge = DIM.locoWidth / 2;
    let samples = 0;
    for (const bore of bores) {
      const curve = curves.get(bore.edgeId)!;
      for (let s = bore.startMm; s <= bore.endMm; s += 4) {
        const pose = poseAtOffsetMm(curve, s);
        const lat = lateralOf(pose.tangent);
        for (const off of [0, halfGauge / 2, -halfGauge / 2, halfGauge, -halfGauge]) {
          const from = pose.position.clone().addScaledVector(lat, off * MM).setY(0.5);
          rc.set(from, down);
          const hit = rc.intersectObject(massif as unknown as Mesh, false)[0];
          samples += 1;
          if (!hit) continue; // the pierced mouth window: nothing to intrude
          expect(hit.point.y / MM, `${bore.edgeId}@${s.toFixed(0)}mm off ${off}`).toBeGreaterThan(
            BORE_ROOF_MM,
          );
        }
      }
    }
    expect(samples).toBeGreaterThan(100);
  });

  it('clears the rolling stock and is symmetric about the track centre line', () => {
    const { scene, frame } = fullScene();
    const curves = buildEdgeCurves(plan, frame);
    const { sites } = resolveTunnels(plan, curves, frame);

    // aperture vs the widest and tallest vehicle, with margin
    expect(APERTURE_W_MM).toBeGreaterThan(Math.max(DIM.locoWidth, DIM.coachWidth) + 6);
    expect(APERTURE_H_MM).toBeGreaterThan(
      DIM.railTop + Math.max(DIM.locoBodyHeight + DIM.locoRoofHeight, DIM.coachBodyHeight + DIM.coachRoofHeight) + 4,
    );

    let frames = 0;
    scene.traverse((o) => {
      if (o.name !== 'portal') return;
      frames += 1;
      const left = o.children.find((c) => c.name === 'portalJamb:left');
      const right = o.children.find((c) => c.name === 'portalJamb:right');
      const lintel = o.children.find((c) => c.name === 'portalLintel');
      expect(left, 'left jamb').toBeDefined();
      expect(right, 'right jamb').toBeDefined();
      expect(lintel, 'lintel').toBeDefined();
      // local z is the lateral axis: the jambs must straddle the centre line evenly
      expect(Math.abs(left!.position.z + right!.position.z) / MM).toBeLessThan(0.01);
      expect(Math.abs(lintel!.position.z) / MM).toBeLessThan(0.01);
      // and the lintel spans above the aperture, not across it
      expect(lintel!.position.y / MM).toBeGreaterThan(APERTURE_H_MM);
    });
    expect(frames).toBe(sites.length);
  });
});
