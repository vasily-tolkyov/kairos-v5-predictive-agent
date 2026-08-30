import { FORMAL_EVALUATION, R1_CONFIG, R2_CONFIG } from "../config.js";
import type {
  ActiveR2BasinMembershipV1,
  CoactivationTrace,
  ExperienceStoreCheckpointV3,
  ObservationReceipt,
  R1RouteSignature,
  R1TraceReference,
  Vec3,
} from "../contracts.js";
import { TrustedExperience } from "../firewall.js";
import { PhysicalMedium3D } from "../physics/physical-medium.js";
import { clone3, dot3, normalize3 } from "../vector.js";
import { rawGeometryDistance } from "./path-projector.js";

interface MutableCoactivation {
  readonly coactivationId: string;
  readonly r2Coordinate: Vec3;
  readonly experienceAnchorId: string;
  readonly r1Trace: R1TraceReference;
  readonly observedAt: number;
  readonly initialStrength: number;
  currentStrength: number;
}

class CoactivationStore {
  readonly #recoveryRate: number;
  readonly #traces: MutableCoactivation[] = [];
  #sequence = 0;

  constructor(
    recoveryRate: number,
    traces: readonly CoactivationTrace[] = [],
    sequence = 0,
  ) {
    this.#recoveryRate = recoveryRate;
    this.#sequence = sequence;
    for (const trace of traces) {
      this.#traces.push({
        ...trace,
        r2Coordinate: new Float64Array(trace.r2Coordinate),
        r1Trace: { ...trace.r1Trace },
      });
    }
  }

  add(
    coactivationId: string,
    r2Coordinate: Vec3,
    experienceAnchorId: string,
    r1Trace: R1TraceReference,
    observedAt: number,
    strength: number,
  ): CoactivationTrace {
    this.#sequence += 1;
    const trace: MutableCoactivation = {
      coactivationId,
      r2Coordinate: clone3(r2Coordinate),
      experienceAnchorId,
      r1Trace: { ...r1Trace },
      observedAt,
      initialStrength: strength,
      currentStrength: strength,
    };
    this.#traces.push(trace);
    return this.#copy(trace);
  }

  recover(elapsed: number): void {
    const factor = Math.exp(-this.#recoveryRate * elapsed);
    for (const trace of this.#traces) trace.currentStrength *= factor;
  }

  snapshot(minimumStrength = 1e-10): readonly CoactivationTrace[] {
    return this.#traces
      .filter((trace) => trace.currentStrength >= minimumStrength)
      .map((trace) => this.#copy(trace));
  }

  exportAll(): readonly CoactivationTrace[] {
    return this.#traces.map((trace) => this.#copy(trace));
  }

  get sequence(): number {
    return this.#sequence;
  }

  byId(coactivationId: string): CoactivationTrace | null {
    const trace = this.#traces.find((candidate) => candidate.coactivationId === coactivationId);
    return trace === undefined ? null : this.#copy(trace);
  }

  #copy(trace: MutableCoactivation): CoactivationTrace {
    return {
      ...trace,
      r2Coordinate: clone3(trace.r2Coordinate),
      r1Trace: { ...trace.r1Trace },
    };
  }
}

export class ExperienceMediaStore {
  readonly r1: PhysicalMedium3D;
  readonly r2: PhysicalMedium3D;
  readonly r2PageId: string;
  readonly #coactivations: CoactivationStore;
  readonly #pageRoutes: Map<string, {
    geometryMean: Float64Array;
    initialTangentMean: Vec3;
    terminalTangentMean: Vec3;
    intrinsicClosureDistanceMean: number;
    selfIntersectionCountMaximum: number;
    count: number;
  }>;
  #eventSequence = 0;
  #logicalTime = 0;

  constructor(checkpoint?: ExperienceStoreCheckpointV3) {
    if (checkpoint === undefined) {
      this.r1 = new PhysicalMedium3D(R1_CONFIG);
      this.r2 = new PhysicalMedium3D(R2_CONFIG);
      this.r2PageId = this.r2.createPage();
      this.#coactivations = new CoactivationStore(FORMAL_EVALUATION.associationRecoveryRate);
      this.#pageRoutes = new Map();
      return;
    }
    this.r1 = PhysicalMedium3D.fromSnapshot(checkpoint.r1);
    this.r2 = PhysicalMedium3D.fromSnapshot(checkpoint.r2);
    this.r2PageId = checkpoint.r2PageId;
    if (!this.r2.pageIds().includes(this.r2PageId)) {
      throw new Error("checkpoint references a missing R2 page");
    }
    this.#coactivations = new CoactivationStore(
      FORMAL_EVALUATION.associationRecoveryRate,
      checkpoint.coactivations,
      checkpoint.coactivationSequence,
    );
    this.#pageRoutes = new Map(checkpoint.pageRoutes.map((route) => [route.pageId, {
      geometryMean: new Float64Array(route.geometryMean),
      initialTangentMean: new Float64Array(route.initialTangentMean),
      terminalTangentMean: new Float64Array(route.terminalTangentMean),
      intrinsicClosureDistanceMean: route.intrinsicClosureDistanceMean,
      selfIntersectionCountMaximum: route.selfIntersectionCountMaximum,
      count: route.count,
    }]));
    this.#eventSequence = checkpoint.eventSequence;
    this.#logicalTime = checkpoint.logicalTime;
  }

  get logicalTime(): number {
    return this.#logicalTime;
  }

  get eventSequence(): number {
    return this.#eventSequence;
  }

  get nextEventNumber(): number {
    return this.#eventSequence + 1;
  }

  advanceTo(observedAt: number): void {
    if (!Number.isFinite(observedAt) || observedAt < this.#logicalTime) {
      throw new RangeError("trusted events must be processed in nondecreasing real time");
    }
    const elapsed = observedAt - this.#logicalTime;
    if (elapsed > 0) {
      this.r1.recover(elapsed);
      this.r2.recover(elapsed);
      this.#coactivations.recover(elapsed);
      this.#logicalTime = observedAt;
    }
  }

  writeEvent(
    experience: TrustedExperience,
    route: R1RouteSignature,
    r2Coordinate: Vec3,
    experienceAnchorId: string,
    strength = 1,
    timePolicy: "legacy-event-time" | "current-model-time" = "legacy-event-time",
  ): ObservationReceipt {
    const state = experience.r1State();
    if (timePolicy === "current-model-time") {
      if (Math.abs(state.observedAt - this.#logicalTime) > 1e-12) {
        throw new Error("trusted-writer-time-must-equal-current-model-cognitive-time");
      }
    } else this.advanceTo(state.observedAt);
    this.#eventSequence += 1;
    const expectedAnchorId = `experience-anchor-${this.#eventSequence.toString().padStart(6, "0")}`;
    if (experienceAnchorId !== expectedAnchorId) {
      throw new RangeError("experience anchor id must match the physical event sequence");
    }
    const traceId = `r1-trace-${this.#eventSequence.toString().padStart(6, "0")}`;
    const r1PageId = this.#compatibleR1Page(route) ?? this.r1.createPage();
    this.r1.depositOrderedTrajectory(r1PageId, experience.trajectory(), strength, traceId);
    this.#updateRoute(r1PageId, route);
    const coactivationId = `coactivation-${this.#eventSequence.toString().padStart(6, "0")}`;
    this.r2.depositVisit(this.r2PageId, r2Coordinate, strength, coactivationId);
    this.#coactivations.add(
      coactivationId,
      r2Coordinate,
      experienceAnchorId,
      { pageId: r1PageId, traceId },
      state.observedAt,
      strength,
    );
    return {
      eventNumber: this.#eventSequence,
      logicalTime: this.#logicalTime,
      r1PageId,
      r1TraceId: traceId,
      r2PageId: this.r2PageId,
      coactivationId,
      experienceAnchorId,
      relationsUpdated: 0,
    };
  }

  recoverAll(elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("elapsed must be finite and nonnegative");
    this.r1.recover(elapsed);
    this.r2.recover(elapsed);
    this.#coactivations.recover(elapsed);
    this.#logicalTime += elapsed;
  }

  physicalTimesForAudit(): Readonly<{ readonly r1: number; readonly r2: number;
    readonly coactivation: number }> {
    return Object.freeze({ r1: this.r1.logicalTime, r2: this.r2.logicalTime,
      coactivation: this.#logicalTime });
  }

  coactivations(): readonly CoactivationTrace[] {
    return this.#coactivations.snapshot();
  }

  /**
   * Read the current R2 physical basin containing one real visit.  The
   * returned member list is derived from active visit kernels on every call;
   * it is not a cached result class and cannot write to either medium.
   */
  resolveActiveR2Basin(r2VisitId: string): ActiveR2BasinMembershipV1 | null {
    if (r2VisitId.length === 0) throw new RangeError("R2 visit id must be non-empty");
    const visit = this.#coactivations.byId(r2VisitId);
    if (visit === null) return null;
    const basin = this.r2.basinContainingVisit(this.r2PageId, r2VisitId);
    if (basin === null || !basin.memberVisitIds.includes(r2VisitId)) return null;
    const memberVisitIds = basin.memberVisitIds.filter((memberId) => this.#coactivations.byId(memberId) !== null);
    if (memberVisitIds.length !== basin.memberVisitIds.length) return null;
    return {
      version: "ActiveR2BasinMembershipV1",
      pageId: basin.pageId,
      coordinate: [...basin.coordinate],
      memberVisitIds: [...memberVisitIds].sort(),
    };
  }

  exportCheckpointState(): ExperienceStoreCheckpointV3 {
    return {
      version: "ExperienceStoreCheckpointV3",
      r1: this.r1.snapshot(),
      r2: this.r2.snapshot(),
      r2PageId: this.r2PageId,
      coactivations: this.#coactivations.exportAll(),
      coactivationSequence: this.#coactivations.sequence,
      pageRoutes: [...this.#pageRoutes].map(([pageId, route]) => ({
        version: "R1RoutePrototypeV2",
        pageId,
        geometryMean: [...route.geometryMean],
        initialTangentMean: [...route.initialTangentMean],
        terminalTangentMean: [...route.terminalTangentMean],
        intrinsicClosureDistanceMean: route.intrinsicClosureDistanceMean,
        selfIntersectionCountMaximum: route.selfIntersectionCountMaximum,
        count: route.count,
      })),
      eventSequence: this.#eventSequence,
      logicalTime: this.#logicalTime,
    };
  }

  #compatibleR1Page(route: R1RouteSignature): string | null {
    let bestPage: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [pageId, prototype] of this.#pageRoutes) {
      const activeTrace = this.r1.traceIds(pageId).some((traceId) => this.r1.isTraceActive(pageId, traceId));
      if (!activeTrace) continue;
      const prototypeInitial = normalize3(prototype.initialTangentMean);
      const prototypeTerminal = normalize3(prototype.terminalTangentMean);
      if (prototypeInitial === null || prototypeTerminal === null) continue;
      if (dot3(route.initialTangent, prototypeInitial) < 0.5) continue;
      if (dot3(route.terminalTangent, prototypeTerminal) < 0.5) continue;
      if (route.selfIntersectionCount !== prototype.selfIntersectionCountMaximum) continue;
      const distance = rawGeometryDistance(route.geometry, prototype.geometryMean);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = pageId;
      }
    }
    return bestDistance <= FORMAL_EVALUATION.r1PageCompatibilityDistance ? bestPage : null;
  }

  #updateRoute(pageId: string, route: R1RouteSignature): void {
    const previous = this.#pageRoutes.get(pageId);
    if (previous === undefined) {
      this.#pageRoutes.set(pageId, {
        geometryMean: new Float64Array(route.geometry),
        initialTangentMean: clone3(route.initialTangent),
        terminalTangentMean: clone3(route.terminalTangent),
        intrinsicClosureDistanceMean: route.intrinsicClosureDistance,
        selfIntersectionCountMaximum: route.selfIntersectionCount,
        count: 1,
      });
      return;
    }
    const count = previous.count + 1;
    for (let index = 0; index < route.geometry.length; index += 1) {
      previous.geometryMean[index] = previous.geometryMean[index]!
        + (route.geometry[index]! - previous.geometryMean[index]!) / count;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      previous.initialTangentMean[axis] = previous.initialTangentMean[axis]!
        + (route.initialTangent[axis]! - previous.initialTangentMean[axis]!) / count;
      previous.terminalTangentMean[axis] = previous.terminalTangentMean[axis]!
        + (route.terminalTangent[axis]! - previous.terminalTangentMean[axis]!) / count;
    }
    previous.intrinsicClosureDistanceMean += (route.intrinsicClosureDistance - previous.intrinsicClosureDistanceMean) / count;
    previous.selfIntersectionCountMaximum = Math.max(previous.selfIntersectionCountMaximum, route.selfIntersectionCount);
    previous.count = count;
  }
}
