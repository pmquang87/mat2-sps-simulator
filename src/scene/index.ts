/**
 * Public API surface of scene/ (ARCHITECTURE.md §2 rule 7). scene/ imports plant/ types
 * (PlantSnapshot, trackplan types) and never mutates plant (§2 rule 3).
 *
 * The contract §5.4 fixes is `SceneManager`, `SceneConfig` and `CameraMode`; everything in
 * the second block is scene-internal (geometry/derivation helpers, materials, dimensions).
 * They are exported because rule 7 forbids deep imports — `tests/scene/**` and any future
 * scene tooling must reach them through this index.
 */

// ── §5.4 contract ──
export { SceneManager, type SceneConfig } from './SceneManager';
export {
  CAMERA_MODES,
  TRIPOD_CLEARANCE_MM,
  TRIPOD_HEIGHT_MM,
  createCameraRigs,
  footprintClearance,
  tracksideTripodPositions,
  type CameraMode,
  type CameraRigs,
} from './cameras';

// ── scene-internal helpers (stable enough to test against) ──
export {
  MM,
  MeshAccum,
  PlanFrame,
  buildEdgeCurves,
  buildTrackMeshes,
  directionAtNode,
  disposeGeometries,
  lateralOf,
  meshYawFromPlanHeading,
  planBounds,
  planHeadingToWorld,
  platformProfile,
  poseAtOffsetMm,
  yawOfTangent,
  type EdgeCurve,
  type PlanBounds,
  type ProfilePoint,
  type TrackMeshes,
  type TrackPose,
} from './trackMesh';
export {
  DIM,
  PALETTE,
  RAIL_TOP_MM,
  createMaterials,
  disposeMaterials,
  type SceneMaterials,
  type SceneQuality,
} from './materials';
export {
  LabelFactory,
  createTextTexture,
  placePlate,
  type BoardOptions,
  type PlateOptions,
} from './labels';
export {
  buildSwitchVisuals,
  coilColourOfBranch,
  switchBlend,
  type SwitchVisual,
} from './switchMesh';
export { buildReedVisuals, type ReedVisual } from './reedMesh';
export { TrainVisual, buildTrain, type TrainUpdate } from './trainMesh';
export {
  BOARD_MARGIN_PT,
  APERTURE_H_MM,
  APERTURE_W_MM,
  BORE_ROOF_MM,
  BUILDING_CLEARANCE_MM,
  PORTAL_COVER_MM,
  PORTAL_TOP_MM,
  TRAIN_HIDE_COVER_MM,
  buildLandscape,
  buildTerrain,
  buildingPlacements,
  deriveStations,
  findPortalSites,
  notausBeaconPosition,
  resolveTunnels,
  sceneryFootprints,
  terrainCoverMm,
  tunnelBores,
  tunnelEdgeIds,
  type BoreSpan,
  type BuildingPlacement,
  type DerivedLane,
  type DerivedStation,
  type LandscapeArgs,
  type LandscapeResult,
  type PortalSite,
  type SceneryFootprint,
  type Terrain,
  type TunnelResolution,
} from './landscape';
