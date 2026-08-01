/**
 * Train (ARCHITECTURE.md §5.3): edge+offset+direction state, constant-acceleration lag
 * toward the commanded target speed, node transitions with continuity-derived travel
 * sign.
 *
 * Binding rules implemented here:
 * - `speedMmS` approaches `targetSpeedMmS` with constant acceleration
 *   `meta.trainAccelMmS2` — the train glides past reeds ("kein zielgenaues Bremsen").
 * - Direction change requires passing through speed 0; a command change IU↔GU while
 *   stationary flips the current travel sign (§8: commands are decoupled from geometry —
 *   the travel sign is re-derived at every node transition from geometric continuity,
 *   never from a global command↔geometry rule).
 * - Plain node → unique other edge; switch from toe → current position's branch; from
 *   branch → toe with `switchTrailed` warning on position mismatch (`derail` + stop in
 *   strict mode). Buffer node → hard stop + `bufferHit`.
 *
 * Integration is semi-implicit Euler at the fixed physics step: speed is updated first,
 * then position advances with the updated speed. Deterministic (§6.3): identical
 * operation order, no wall clock, no randomness.
 */
import type { SimEvent } from './plant';
import type { SwitchPosition } from './switches';
import type { TrackGraph } from './trackGraph';

export interface TrainState {
  edgeId: string;
  offsetMm: number;                  // 0..edge length, measured from edge.from
  /** Travel sign RELATIVE to the current edge's from→to orientation. Owned by the Train
   *  and re-derived at every node transition from geometric continuity — NOT a global
   *  IU/GU mapping (§8: commands are decoupled from geometry). */
  direction: 1 | -1;
  command: 'IU' | 'GU' | 'STOP';     // last traction command driving the motion
  speedMmS: number;                  // current magnitude ≥ 0 (first-order lag toward target)
  targetSpeedMmS: number;
}

export interface TrainStepDeps {
  positionOf: (switchId: string) => SwitchPosition;
  emit: (e: SimEvent) => void;
  nowMs: number;
}

/** Safety guard against degenerate data (edges shorter than one step's travel forever). */
const MAX_TRANSITIONS_PER_STEP = 1000;

export class Train {
  private readonly graph: TrackGraph;
  private readonly strictDerail: boolean;
  private edgeId: string;
  private offsetMm: number;
  private dirSign: 1 | -1;
  /** Which command (IU or GU) the current travel sign realizes. The trackplan's
   *  `start.direction` is defined as the IU travel sign on the start edge (edges are
   *  IU-oriented per §7.1, so real data uses direction 1). */
  private senseCommand: 'IU' | 'GU' = 'IU';
  private reqCommand: 'IU' | 'GU' | 'STOP' = 'STOP';
  private reqSpeedMmS = 0;
  private speedMmS = 0;
  private effTargetMmS = 0;
  private _derailed = false;
  /** Set after a buffer hit: blocks further motion into the buffer until reversal. */
  private bufferBlock: { edgeId: string; dir: 1 | -1 } | null = null;
  /** Arc length covered by the last `step`, mm — an observation of the motion above, never an
   *  input to it (§6.3: rendering-only data must not feed back). */
  private travelMm = 0;

  constructor(graph: TrackGraph, strictDerail: boolean) {
    this.graph = graph;
    this.strictDerail = strictDerail;
    const s = graph.start;
    this.edgeId = s.edgeId;
    this.offsetMm = s.offsetMm;
    this.dirSign = s.direction;
  }

  get derailed(): boolean {
    return this._derailed;
  }

  get currentEdgeId(): string {
    return this.edgeId;
  }

  get currentOffsetMm(): number {
    return this.offsetMm;
  }

  get speed(): number {
    return this.speedMmS;
  }

  /** The command sense (IU/GU) of the current travel sign. */
  get directionSense(): 'IU' | 'GU' {
    return this.senseCommand;
  }

  /** Arc length actually covered by the last `step`, mm — 0 when standing, and short of the
   *  commanded travel when a buffer or a strict derail cut the step off. */
  get lastStepTravelMm(): number {
    return this.travelMm;
  }

  state(): TrainState {
    return {
      edgeId: this.edgeId,
      offsetMm: this.offsetMm,
      direction: this.dirSign,
      command: this.reqCommand,
      speedMmS: this.speedMmS,
      targetSpeedMmS: this.effTargetMmS,
    };
  }

  /** New traction target from the Fahrstrom word (speed magnitude + command). */
  setTraction(speedMmS: number, command: 'IU' | 'GU' | 'STOP'): void {
    this.reqCommand = command;
    this.reqSpeedMmS = command === 'STOP' ? 0 : speedMmS;
  }

  /** Immediate derail stop commanded by the Plant (switch moved under train, strict). */
  derailNow(emit: (e: SimEvent) => void, nowMs: number): void {
    if (this._derailed) return;
    const wasMoving = this.speedMmS > 0;
    this.speedMmS = 0;
    this.effTargetMmS = 0;
    this._derailed = true;
    if (wasMoving) emit({ t: nowMs, type: 'trainStopped' });
  }

  step(dtMs: number, deps: TrainStepDeps): void {
    this.travelMm = 0;
    if (this._derailed) return;
    const { positionOf, emit, nowMs } = deps;
    const dtS = dtMs / 1000;
    const prevSpeed = this.speedMmS;

    // Effective target: reversal only through speed 0 (§5.3).
    let target: number;
    if (this.reqCommand === 'STOP') {
      target = 0;
    } else if (this.reqCommand === this.senseCommand) {
      target = this.reqSpeedMmS;
    } else if (this.speedMmS === 0) {
      // Stationary + opposite command: flip the travel sign, adopt the new sense.
      this.dirSign = this.dirSign === 1 ? -1 : 1;
      this.senseCommand = this.reqCommand;
      this.bufferBlock = null;
      target = this.reqSpeedMmS;
    } else {
      target = 0; // decelerate to 0 first; the flip happens in a later step
    }
    this.effTargetMmS = target;

    // Constant-acceleration lag toward the target (clamped, so 0 is reached exactly).
    const dv = this.graph.meta.trainAccelMmS2 * dtS;
    if (this.speedMmS < target) this.speedMmS = Math.min(target, this.speedMmS + dv);
    else if (this.speedMmS > target) this.speedMmS = Math.max(target, this.speedMmS - dv);

    // Hard stop against an already-hit buffer while still pushing toward it.
    if (this.bufferBlock && this.bufferBlock.edgeId === this.edgeId && this.bufferBlock.dir === this.dirSign) {
      this.speedMmS = 0;
    }

    this.travelMm = this.speedMmS * dtS;
    if (this.speedMmS > 0) {
      this.offsetMm += this.dirSign * this.speedMmS * dtS;
      this.resolveTransitions(positionOf, emit, nowMs);
    }

    if (prevSpeed === 0 && this.speedMmS > 0) {
      emit({ t: nowMs, type: 'trainStarted', direction: this.senseCommand });
    } else if (prevSpeed > 0 && this.speedMmS === 0) {
      emit({ t: nowMs, type: 'trainStopped' });
    }
  }

  /** Walk node transitions until the offset lies inside the current edge again. */
  private resolveTransitions(
    positionOf: (switchId: string) => SwitchPosition,
    emit: (e: SimEvent) => void,
    nowMs: number,
  ): void {
    for (let guard = 0; guard < MAX_TRANSITIONS_PER_STEP; guard++) {
      const len = this.graph.edgeLengthMm(this.edgeId);
      const edge = this.graph.edge(this.edgeId);
      let exitNodeId: string;
      let overshootMm: number;
      if (this.dirSign > 0 && this.offsetMm > len) {
        exitNodeId = edge.to;
        overshootMm = this.offsetMm - len;
      } else if (this.dirSign < 0 && this.offsetMm < 0) {
        exitNodeId = edge.from;
        overshootMm = -this.offsetMm;
      } else {
        return;
      }

      const res = this.graph.nextEdge(this.edgeId, exitNodeId, positionOf);

      if (res.kind === 'buffer') {
        // Hard stop at the buffer (§5.3).
        this.travelMm -= overshootMm;
        this.offsetMm = this.dirSign > 0 ? len : 0;
        this.bufferBlock = { edgeId: this.edgeId, dir: this.dirSign };
        this.speedMmS = 0;
        emit({ t: nowMs, type: 'bufferHit', nodeId: exitNodeId });
        return;
      }

      if (res.trailedMismatch === true && res.trailedSwitchId !== undefined) {
        emit({ t: nowMs, type: 'switchTrailed', switchId: res.trailedSwitchId });
        if (this.strictDerail) {
          this.travelMm -= overshootMm;
          this.offsetMm = this.dirSign > 0 ? len : 0;
          this.speedMmS = 0;
          this.effTargetMmS = 0;
          this._derailed = true;
          emit({ t: nowMs, type: 'derail', switchId: res.trailedSwitchId });
          return;
        }
      }

      // Enter the next edge; travel sign from geometric continuity at the shared node.
      const next = this.graph.edge(res.edgeId);
      this.edgeId = res.edgeId;
      if (next.from === exitNodeId) {
        this.offsetMm = overshootMm;
        this.dirSign = 1;
      } else {
        this.offsetMm = this.graph.edgeLengthMm(res.edgeId) - overshootMm;
        this.dirSign = -1;
      }
      emit({ t: nowMs, type: 'segmentEntered', edgeId: res.edgeId });
    }
    throw new Error('Train.resolveTransitions: runaway transition loop (degenerate trackplan?)');
  }
}
