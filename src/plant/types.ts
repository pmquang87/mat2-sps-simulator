/**
 * Trackplan schema types (ARCHITECTURE.md §5.3 + §7.1 — the TrackplanFile type lives with
 * its consumer, plant/) and shared plant types.
 */

export interface Vec2 { x: number; y: number; }

export interface TrackNodeSpec { id: string; pt: Vec2; kind: 'plain' | 'switch' | 'buffer'; }

export interface TrackEdgeSpec {
  id: string;
  from: string; to: string;          // node ids
  pts: Vec2[];                       // polyline in plan units, incl. both endpoints
  /** Orientation convention (DATA, not physics — §8): from→to is the direction the
   *  documented IU route walks pass this edge. The Train derives its per-edge travel
   *  sign from node-transition continuity, never from a global command↔geometry rule. */
  tunnel?: boolean;                  // train hidden inside tunnel edges (§5.4 scene notes)
}

export interface SwitchSpec {
  id: string;                        // base name without coil suffix, e.g. "xW02BH1G4"
  nodeId: string;
  toeEdgeId: string;                 // single edge on the facing side
  branchEdgeIds: [string, string];   // the two diverging edges; index = SwitchPosition
  /** Which coil throws to which branch index. `null` = non-commandable switch (no
   *  Variablenliste symbols — only the unlabeled "(xW)"): fixed at initialPosition
   *  ("fest liegend" per weichen_video.md), excluded from Wiring (§5.2) and from the
   *  42-switch/84-coil-bit invariants (§7.2); trailing it still follows the normal
   *  switch rules. */
  coilToBranch: { G: 0 | 1; R: 0 | 1 } | null;
  mappingSource: 'derived' | 'assumed';        // §8
  mappingEvidence?: string;          // e.g. "A-NW5: route BH2 via G3 ⇒ R = branch to G3"
  initialPosition: 0 | 1;
}

export interface ReedSpec {
  id: string;                        // "xR01A"
  edgeId: string; offsetMm: number;  // along edge from its 'from' node
  wired: boolean;                    // only 23 of 43 reed positions have an E input
  bounce?: boolean;                  // participates in debounce exercise (xR01D)
}

/** meta block of trackplan.json (§7.1). */
export interface TrackplanMeta {
  units: string;                     // "gleisplanPt" — 960×540 pt space of Gleisplan SPS.pdf
  mmPerUnit: number;
  speedsMmS: Record<'1' | '2' | '3', number>;
  trainAccelMmS2: number;
  switchActuationMs: number;
  reedWindowMm: number;
  magnetOffsetMm: number;
}

export interface TunnelSpec   { edgeIds: string[]; }
export interface LakeSpec     { center: Vec2; radiusPt: number; }
export interface BuildingSpec { kind: string; pt: Vec2; rotDeg: number; }
export interface MountainSpec { center: Vec2; radiusPt: number; heightPt: number; }

export interface LandscapeSpec {
  tunnels: TunnelSpec[];
  lake?: LakeSpec;
  buildings: BuildingSpec[];
  mountains: MountainSpec[];
}

export interface TrainStartSpec { edgeId: string; offsetMm: number; direction: 1 | -1; }

/**
 * A Variablenliste switch with a G/R coil pair but NO position on this board model
 * (trackplan.json `unplacedSwitches`, §7.1 note): the coil bits exist in the PLC, so a
 * student program can pulse them, but there is no plant switch behind them. The plant
 * ignores them entirely; the coordinator records the command so the UI can warn instead of
 * letting the pulse be a silent no-op (§5.2, §7.1).
 */
export interface UnplacedSwitchSpec { id: string; note: string; }

/** Parsed shape of src/data/trackplan.json (full schema §7.1). */
export interface TrackplanFile {
  version: number;
  meta: TrackplanMeta;
  nodes: TrackNodeSpec[];
  edges: TrackEdgeSpec[];
  switches: SwitchSpec[];
  reeds: ReedSpec[];
  start: TrainStartSpec;
  landscape: LandscapeSpec;
  /** Optional (§7.1 note): switches the Variablenliste commands but the board lacks. */
  unplacedSwitches?: UnplacedSwitchSpec[];
}
