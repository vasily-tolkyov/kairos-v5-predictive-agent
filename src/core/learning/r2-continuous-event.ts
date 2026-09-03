import { R2_CONFIG } from "../config.js";
import type { MediumSnapshot, Vec3 } from "../contracts.js";
import { PhysicalMedium3D } from "../physics/physical-medium.js";
import { deterministicJson, fnv1a64 } from "../serialization.js";
import { assertVec3, clone3, norm3, sub3 } from "../vector.js";

/**
 * The only coordinate contract accepted by this neutral R2 layer.  The
 * caller may derive it from the frozen public R1 event representation, but
 * it must never pass Minecraft/world coordinates through this boundary.
 */
export const R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1 =
  "FrozenPublicR1EventProjectionV1" as const;

export type PublicContinuityDependencyBasisV1 =
  | "public-state-carried-forward"
  | "successor-depends-on-prior-public-observation";

export type PublicContinuityFactCategoryV1 =
  | "public-state-persistence"
  | "public-state-transition"
  | "public-successor-precondition";

/** A replayable pointer into the raw public observations owned by one R1 atom. */
export interface PublicContinuityEvidenceReferenceV1 {
  readonly version: "PublicContinuityEvidenceReferenceV1";
  readonly sourceEventId: string;
  readonly subject: string;
  readonly property: string;
  readonly beforeObservationSequence: number;
  readonly afterObservationSequence: number;
  readonly beforeValueSha256: string;
  readonly afterValueSha256: string;
  readonly factCategory: PublicContinuityFactCategoryV1;
}

/**
 * An opaque, public-only dependency of an unfinished real process.
 *
 * A shared object identity or spatial proximity is not sufficient.  The
 * producer must be able to audit the stated process dependency from public
 * observations available before or during the two R1 atoms.  Goals and
 * desired outcomes are deliberately absent from this contract.
 */
export interface PublicContinuityDependencyV1 {
  readonly version: "PublicContinuityDependencyV1";
  readonly dependencyId: string;
  readonly basis: PublicContinuityDependencyBasisV1;
  readonly evidence: PublicContinuityEvidenceReferenceV1;
}

/** One R1 atom is one already closed real action/passive event, never a frame. */
export interface R1ClosedEventAtomV1 {
  readonly version: "R1ClosedEventAtomV2";
  readonly atomId: string;
  readonly sourceEventId: string;
  /** Exact opaque identity of this whole closed experience/action. It may
   * encode action kind, parameters, public target role, or passive category;
   * it must not encode a concrete object/event id, result value, goal answer,
   * or absolute world coordinate. */
  readonly exactExperienceIdentity: string;
  /** Opaque, public-only identity of the transition observed by this closed
   * atom.  It guards distinctions lost by the 3-D measurement projection;
   * it is not an action result label or a causal assertion. */
  readonly publicTransitionTopologyId: string;
  readonly kind: "action" | "passive";
  readonly completion: "complete";
  readonly trustedActualObservation: true;
  readonly publicOnly: true;
  readonly sessionId: string;
  readonly continuityEpochId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly startFrameSequence: number;
  readonly endFrameSequence: number;
  readonly publicContinuityDependencies: readonly PublicContinuityDependencyV1[];
  readonly coordinateSystem: typeof R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1;
  readonly r2Coordinate: Vec3;
}

export interface R1ClosedEventAtomStateV1 extends Omit<R1ClosedEventAtomV1, "r2Coordinate"> {
  readonly r2Coordinate: readonly number[];
}

export interface R2PublicDependencyLinkV1 {
  readonly version: "R2PublicDependencyLinkV1";
  readonly predecessorAtomId: string;
  readonly successorAtomId: string;
  readonly frameRelation: "shared-boundary-frame" | "adjacent-frames";
  readonly sharedDependencyIds: readonly string[];
  readonly evidencePairs: readonly {
    readonly dependencyId: string;
    readonly predecessor: PublicContinuityEvidenceReferenceV1;
    readonly successor: PublicContinuityEvidenceReferenceV1;
  }[];
}

export type R2CompleteBoundaryReasonV1 =
  | "public-process-resolved"
  | "public-dependency-ended";

export type R2CensoredBoundaryReasonV1 =
  | "observation-ended"
  | "continuity-gap"
  | "continuity-reset"
  | "session-ended";

/** No goal, plan, desired result, or learned R2A class can close an R2 event. */
export type R2EventBoundaryV1 =
  | {
      readonly version: "R2EventBoundaryV1";
      readonly completion: "complete";
      readonly reason: R2CompleteBoundaryReasonV1;
    }
  | {
      readonly version: "R2EventBoundaryV1";
      readonly completion: "censored";
      readonly reason: R2CensoredBoundaryReasonV1;
    };

export interface R2ContinuousEventV1 {
  readonly version: "R2ContinuousEventV2";
  /** Ordered-atom fingerprint. Coordinates are excluded, so equivalent
   * measurement resampling cannot change the identity. */
  readonly eventId: string;
  readonly traceId: string | null;
  readonly pageId: string | null;
  readonly commitSequence: number;
  readonly completion: R2EventBoundaryV1["completion"];
  readonly boundaryReason: R2EventBoundaryV1["reason"];
  readonly physicalStatus: "deposited" | "audit-only-censored" | "unrepresented-zero-arc";
  /**
   * True only when this event may be offered as one item of repeated R2A
   * evidence. It never makes one R2 event a production pattern by itself.
   * Censored or physically unrepresented paths are always false.
   */
  readonly learningEligible: boolean;
  readonly sessionId: string;
  readonly continuityEpochId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly startFrameSequence: number;
  readonly endFrameSequence: number;
  readonly atomIds: readonly string[];
  readonly sourceEventIds: readonly string[];
  /** Ordered one-to-one projection of the constituent R1 identities. */
  readonly orderedExperienceIdentities: readonly string[];
  /** One-to-one ordered public transition identities for the R1 atoms. */
  readonly orderedTransitionTopologyIds: readonly string[];
  readonly publicDependencyLinks: readonly R2PublicDependencyLinkV1[];
  readonly coordinateSystem: typeof R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1;
  readonly orderedCoordinates: readonly (readonly number[])[];
}

export type R2CloseReceiptV1 =
  | {
      readonly version: "R2CloseReceiptV1";
      readonly status: "committed";
      readonly event: R2ContinuousEventV1;
    }
  | {
      readonly version: "R2CloseReceiptV1";
      readonly status: "singleton-rejected";
      readonly atomId: string;
      readonly completion: R2EventBoundaryV1["completion"];
      readonly boundaryReason: R2EventBoundaryV1["reason"];
    };

interface PendingR2ContinuousEventStateV1 {
  readonly version: "PendingR2ContinuousEventStateV2";
  readonly atoms: readonly R1ClosedEventAtomStateV1[];
  readonly publicDependencyLinks: readonly R2PublicDependencyLinkV1[];
}

export interface R2ContinuousEventStoreStateV1 {
  readonly version: "R2ContinuousEventStoreStateV3";
  readonly hierarchy: "R1-closed-event_R2-real-continuous-chain-v2";
  readonly minimumR1Atoms: 2;
  readonly coordinateSystem: typeof R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1;
  readonly medium: MediumSnapshot;
  readonly r2PageId: string | null;
  readonly events: readonly R2ContinuousEventV1[];
  readonly pending: PendingR2ContinuousEventStateV1 | null;
  readonly consumedAtomIds: readonly string[];
  readonly commitSequence: number;
}

interface PendingR2ContinuousEvent {
  readonly atoms: R1ClosedEventAtomV1[];
  readonly publicDependencyLinks: R2PublicDependencyLinkV1[];
}

const COMPLETE_REASONS = new Set<R2CompleteBoundaryReasonV1>([
  "public-process-resolved",
  "public-dependency-ended",
]);
const CENSORED_REASONS = new Set<R2CensoredBoundaryReasonV1>([
  "observation-ended",
  "continuity-gap",
  "continuity-reset",
  "session-ended",
]);
const DEPENDENCY_BASES = new Set<PublicContinuityDependencyBasisV1>([
  "public-state-carried-forward",
  "successor-depends-on-prior-public-observation",
]);
const FACT_CATEGORIES = new Set<PublicContinuityFactCategoryV1>([
  "public-state-persistence",
  "public-state-transition",
  "public-successor-precondition",
]);

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) throw new RangeError(`${field} must be non-empty`);
}

function cloneEvidence(
  value: PublicContinuityEvidenceReferenceV1,
): PublicContinuityEvidenceReferenceV1 {
  return { ...value };
}

function cloneDependency(value: PublicContinuityDependencyV1): PublicContinuityDependencyV1 {
  return {
    version: "PublicContinuityDependencyV1",
    dependencyId: value.dependencyId,
    basis: value.basis,
    evidence: cloneEvidence(value.evidence),
  };
}

function validateDependency(value: PublicContinuityDependencyV1, atom: R1ClosedEventAtomV1): void {
  if (value?.version !== "PublicContinuityDependencyV1" || !DEPENDENCY_BASES.has(value.basis)) {
    throw new Error("invalid-public-continuity-dependency");
  }
  requireNonEmpty(value.dependencyId, "public continuity dependency id");
  const evidence = value.evidence;
  if (evidence?.version !== "PublicContinuityEvidenceReferenceV1"
    || !FACT_CATEGORIES.has(evidence.factCategory)) {
    throw new Error("invalid-public-continuity-evidence-reference");
  }
  requireNonEmpty(evidence.sourceEventId, "continuity evidence source event id");
  requireNonEmpty(evidence.subject, "continuity evidence subject");
  requireNonEmpty(evidence.property, "continuity evidence property");
  if (evidence.sourceEventId !== atom.sourceEventId
    || !Number.isSafeInteger(evidence.beforeObservationSequence)
    || !Number.isSafeInteger(evidence.afterObservationSequence)
    || !/^[a-f0-9]{64}$/.test(evidence.beforeValueSha256)
    || !/^[a-f0-9]{64}$/.test(evidence.afterValueSha256)
    || evidence.beforeObservationSequence < atom.startFrameSequence
    || evidence.afterObservationSequence > atom.endFrameSequence
    || evidence.afterObservationSequence < evidence.beforeObservationSequence) {
    throw new Error("continuity-evidence-is-not-owned-by-the-R1-event-window");
  }
  if (value.basis === "successor-depends-on-prior-public-observation"
    && evidence.factCategory !== "public-successor-precondition") {
    throw new Error("successor-dependency-requires-public-precondition-evidence");
  }
  if (value.basis === "public-state-carried-forward"
    && evidence.factCategory === "public-successor-precondition") {
    throw new Error("carried-public-state-requires-state-evidence");
  }
}

function validateAtom(value: R1ClosedEventAtomV1): void {
  if (value?.version !== "R1ClosedEventAtomV2"
    || (value.kind !== "action" && value.kind !== "passive")
    || value.completion !== "complete"
    || value.trustedActualObservation !== true
    || value.publicOnly !== true) {
    throw new Error("R2-requires-one-complete-trusted-public-R1-event-atom");
  }
  requireNonEmpty(value.atomId, "R1 atom id");
  requireNonEmpty(value.sourceEventId, "source event id");
  requireNonEmpty(value.exactExperienceIdentity, "exact R1 experience identity");
  if (!/^[a-f0-9]{64}$/i.test(value.publicTransitionTopologyId)) {
    throw new Error("R1-public-transition-topology-identity-invalid");
  }
  requireNonEmpty(value.sessionId, "continuity session id");
  requireNonEmpty(value.continuityEpochId, "continuity epoch id");
  if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
    || value.startedAt < 0 || value.endedAt < value.startedAt) {
    throw new RangeError("R1 atom time bounds must be finite, nonnegative, and ordered");
  }
  if (!Number.isSafeInteger(value.startFrameSequence) || !Number.isSafeInteger(value.endFrameSequence)
    || value.startFrameSequence < 0 || value.endFrameSequence < value.startFrameSequence) {
    throw new RangeError("R1 atom frame bounds must be nonnegative ordered safe integers");
  }
  if (value.coordinateSystem !== R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1) {
    throw new Error("world-or-incompatible-coordinate-system-rejected-at-R2-boundary");
  }
  assertVec3(value.r2Coordinate);
  if (!Array.isArray(value.publicContinuityDependencies)
    || value.publicContinuityDependencies.length === 0) {
    throw new Error("R1 atom lacks auditable public continuity dependencies");
  }
  const dependencyIds = new Set<string>();
  for (const dependency of value.publicContinuityDependencies) {
    validateDependency(dependency, value);
    if (dependencyIds.has(dependency.dependencyId)) {
      throw new Error("duplicate-public-continuity-dependency-id");
    }
    dependencyIds.add(dependency.dependencyId);
  }
}

function cloneAtom(value: R1ClosedEventAtomV1): R1ClosedEventAtomV1 {
  validateAtom(value);
  return {
    ...value,
    publicContinuityDependencies: value.publicContinuityDependencies.map(cloneDependency),
    r2Coordinate: clone3(value.r2Coordinate),
  };
}

function atomState(value: R1ClosedEventAtomV1): R1ClosedEventAtomStateV1 {
  return {
    ...value,
    publicContinuityDependencies: value.publicContinuityDependencies.map(cloneDependency),
    r2Coordinate: [...value.r2Coordinate],
  };
}

function atomFromState(value: R1ClosedEventAtomStateV1): R1ClosedEventAtomV1 {
  return cloneAtom({ ...value, r2Coordinate: new Float64Array(value.r2Coordinate) });
}

function validateBoundary(boundary: R2EventBoundaryV1): void {
  if (boundary?.version !== "R2EventBoundaryV1") throw new Error("invalid-R2-event-boundary-version");
  if (boundary.completion === "complete") {
    if (!COMPLETE_REASONS.has(boundary.reason as R2CompleteBoundaryReasonV1)) {
      throw new Error("invalid-complete-R2-event-boundary");
    }
    return;
  }
  if (boundary.completion !== "censored"
    || !CENSORED_REASONS.has(boundary.reason as R2CensoredBoundaryReasonV1)) {
    throw new Error("invalid-censored-R2-event-boundary");
  }
}

function dependencyIntersection(
  predecessor: R1ClosedEventAtomV1,
  successor: R1ClosedEventAtomV1,
): readonly string[] {
  const right = new Map(successor.publicContinuityDependencies.map((value) => [value.dependencyId, value]));
  return predecessor.publicContinuityDependencies
    .map((value) => value.dependencyId)
    .filter((dependencyId) => {
      const left = predecessor.publicContinuityDependencies.find(value => value.dependencyId === dependencyId)!;
      const next = right.get(dependencyId);
      return next !== undefined && left.evidence.afterValueSha256 === next.evidence.beforeValueSha256;
    })
    .sort();
}

function continuityLink(
  predecessor: R1ClosedEventAtomV1,
  successor: R1ClosedEventAtomV1,
): R2PublicDependencyLinkV1 {
  if (predecessor.sessionId !== successor.sessionId) throw new Error("R2-continuity-session-changed");
  if (predecessor.continuityEpochId !== successor.continuityEpochId) {
    throw new Error("R2-continuity-epoch-reset");
  }
  if (predecessor.coordinateSystem !== successor.coordinateSystem) {
    throw new Error("R2-coordinate-system-changed-within-event");
  }
  if (successor.startedAt < predecessor.endedAt) throw new Error("R2-real-time-order-reversed");
  const frameDifference = successor.startFrameSequence - predecessor.endFrameSequence;
  if (frameDifference < 0) throw new Error("R2-frame-order-overlapped-or-reversed");
  if (frameDifference > 1) throw new Error("R2-observation-gap-breaks-continuity");
  const sharedDependencyIds = dependencyIntersection(predecessor, successor);
  if (sharedDependencyIds.length === 0) {
    throw new Error("R2-public-process-dependency-disconnected");
  }
  return {
    version: "R2PublicDependencyLinkV1",
    predecessorAtomId: predecessor.atomId,
    successorAtomId: successor.atomId,
    frameRelation: frameDifference === 0 ? "shared-boundary-frame" : "adjacent-frames",
    sharedDependencyIds,
    evidencePairs: sharedDependencyIds.map((dependencyId) => ({
      dependencyId,
      predecessor: cloneEvidence(predecessor.publicContinuityDependencies
        .find((value) => value.dependencyId === dependencyId)!.evidence),
      successor: cloneEvidence(successor.publicContinuityDependencies
        .find((value) => value.dependencyId === dependencyId)!.evidence),
    })),
  };
}

export type R2ContinuityBreakReasonV1 = 'session-changed' | 'epoch-reset' | 'coordinate-system-changed'
  | 'time-reversed' | 'frame-overlap' | 'observation-gap' | 'public-dependency-disconnected';
export type R2ContinuityAssessmentV1 =
  | { readonly continuous: true; readonly link: R2PublicDependencyLinkV1 }
  | { readonly continuous: false; readonly reason: R2ContinuityBreakReasonV1 };

/** Read-only boundary probe used by the production assembler before mutating its pending chain. */
export function assessR2ContinuityV1(predecessor: R1ClosedEventAtomV1,
  successor: R1ClosedEventAtomV1): R2ContinuityAssessmentV1 {
  try { return { continuous: true, link: continuityLink(predecessor, successor) }; }
  catch (error) {
    const message = (error as Error).message;
    const reasons: Record<string, R2ContinuityBreakReasonV1> = {
      'R2-continuity-session-changed': 'session-changed', 'R2-continuity-epoch-reset': 'epoch-reset',
      'R2-coordinate-system-changed-within-event': 'coordinate-system-changed',
      'R2-real-time-order-reversed': 'time-reversed', 'R2-frame-order-overlapped-or-reversed': 'frame-overlap',
      'R2-observation-gap-breaks-continuity': 'observation-gap',
      'R2-public-process-dependency-disconnected': 'public-dependency-disconnected',
    };
    const reason = reasons[message]; if (!reason) throw error;
    return { continuous: false, reason };
  }
}

function orderedIdentity(
  atoms: readonly R1ClosedEventAtomV1[],
  boundary: R2EventBoundaryV1,
): string {
  return `r2-event-${fnv1a64({
    version: "R2OrderedAtomIdentityV2",
    sessionId: atoms[0]!.sessionId,
    continuityEpochId: atoms[0]!.continuityEpochId,
    atoms: atoms.map((atom) => ({ atomId: atom.atomId, sourceEventId: atom.sourceEventId,
      exactExperienceIdentity: atom.exactExperienceIdentity,
      publicTransitionTopologyId: atom.publicTransitionTopologyId })),
    completion: boundary.completion,
    boundaryReason: boundary.reason,
  })}`;
}

function coordinatePathArcLength(
  atoms: readonly R1ClosedEventAtomV1[],
  medium: PhysicalMedium3D,
): number {
  let arcLength = 0;
  const boundary = medium.config.boundary;
  for (let index = 0; index < atoms.length; index += 1) {
    const coordinate = atoms[index]!.r2Coordinate;
    assertVec3(coordinate);
    for (let axis = 0; axis < 3; axis += 1) {
      if (coordinate[axis]! < boundary.min[axis]! || coordinate[axis]! > boundary.max[axis]!) {
        throw new RangeError("R2-event-coordinate-outside-physical-boundary");
      }
    }
    if (index > 0) arcLength += norm3(sub3(coordinate, atoms[index - 1]!.r2Coordinate));
  }
  if (!Number.isFinite(arcLength)) throw new Error("invalid-R2-coordinate-path-arc-length");
  return arcLength;
}

function cloneLink(value: R2PublicDependencyLinkV1): R2PublicDependencyLinkV1 {
  return {
    ...value,
    sharedDependencyIds: [...value.sharedDependencyIds],
    evidencePairs: value.evidencePairs.map((pair) => ({
      dependencyId: pair.dependencyId,
      predecessor: cloneEvidence(pair.predecessor),
      successor: cloneEvidence(pair.successor),
    })),
  };
}

function cloneEvent(value: R2ContinuousEventV1): R2ContinuousEventV1 {
  return {
    ...value,
    atomIds: [...value.atomIds],
    sourceEventIds: [...value.sourceEventIds],
    orderedExperienceIdentities: [...value.orderedExperienceIdentities],
    orderedTransitionTopologyIds: [...value.orderedTransitionTopologyIds],
    publicDependencyLinks: value.publicDependencyLinks.map(cloneLink),
    orderedCoordinates: value.orderedCoordinates.map((coordinate) => [...coordinate]),
  };
}

function eventBoundary(value: R2ContinuousEventV1): R2EventBoundaryV1 {
  return value.completion === "complete"
    ? { version: "R2EventBoundaryV1", completion: "complete",
      reason: value.boundaryReason as R2CompleteBoundaryReasonV1 }
    : { version: "R2EventBoundaryV1", completion: "censored",
      reason: value.boundaryReason as R2CensoredBoundaryReasonV1 };
}

function validateStoredEvent(value: R2ContinuousEventV1): void {
  if (value?.version !== "R2ContinuousEventV2" || value.atomIds.length < 2
    || value.atomIds.length !== value.sourceEventIds.length
    || value.atomIds.length !== value.orderedExperienceIdentities.length
    || value.atomIds.length !== value.orderedTransitionTopologyIds.length
    || value.atomIds.length !== value.orderedCoordinates.length
    || value.publicDependencyLinks.length !== value.atomIds.length - 1
    || !Number.isSafeInteger(value.commitSequence) || value.commitSequence < 1
    || value.coordinateSystem !== R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1) {
    throw new Error("invalid-stored-R2-continuous-event");
  }
  requireNonEmpty(value.eventId, "R2 event id");
  requireNonEmpty(value.sessionId, "R2 session id");
  requireNonEmpty(value.continuityEpochId, "R2 continuity epoch id");
  if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
    || value.startedAt < 0 || value.endedAt < value.startedAt
    || !Number.isSafeInteger(value.startFrameSequence)
    || !Number.isSafeInteger(value.endFrameSequence)
    || value.startFrameSequence < 0 || value.endFrameSequence < value.startFrameSequence) {
    throw new Error("stored-R2-event-time-or-frame-bounds-invalid");
  }
  const atomIds = new Set<string>();
  const sourceEventIds = new Set<string>();
  for (let index = 0; index < value.atomIds.length; index += 1) {
    const atomId = value.atomIds[index]!;
    const sourceEventId = value.sourceEventIds[index]!;
    const exactExperienceIdentity = value.orderedExperienceIdentities[index]!;
    const transitionTopologyId = value.orderedTransitionTopologyIds[index]!;
    requireNonEmpty(atomId, "stored R1 atom id");
    requireNonEmpty(sourceEventId, "stored source event id");
    requireNonEmpty(exactExperienceIdentity, "stored exact R1 experience identity");
    if (!/^[a-f0-9]{64}$/i.test(transitionTopologyId)) {
      throw new Error("stored-R1-public-transition-topology-identity-invalid");
    }
    if (atomIds.has(atomId) || sourceEventIds.has(sourceEventId)) {
      throw new Error("duplicate-R1-identity-within-R2-event");
    }
    atomIds.add(atomId);
    sourceEventIds.add(sourceEventId);
  }
  const boundary = eventBoundary(value);
  validateBoundary(boundary);
  if (value.physicalStatus === "deposited") {
    if (value.completion !== "complete" || value.learningEligible !== true
      || value.traceId === null || value.pageId === null) {
      throw new Error("deposited-R2-event-must-be-complete-and-physically-addressable");
    }
    requireNonEmpty(value.traceId, "R2 trace id");
    requireNonEmpty(value.pageId, "R2 page id");
  } else if (value.physicalStatus === "audit-only-censored") {
    if (value.completion !== "censored" || value.learningEligible !== false
      || value.traceId !== null || value.pageId !== null) {
      throw new Error("censored-R2-event-must-remain-outside-the-physical-medium");
    }
  } else if (value.physicalStatus === "unrepresented-zero-arc") {
    if (value.completion !== "complete" || value.learningEligible !== false
      || value.traceId !== null || value.pageId !== null) {
      throw new Error("zero-arc-R2-event-must-be-an-unrepresented-complete-record");
    }
  } else throw new Error("unknown-R2-physical-status");
  const expectedId = `r2-event-${fnv1a64({
    version: "R2OrderedAtomIdentityV2",
    sessionId: value.sessionId,
    continuityEpochId: value.continuityEpochId,
    atoms: value.atomIds.map((atomId, index) => ({ atomId, sourceEventId: value.sourceEventIds[index]!,
      exactExperienceIdentity: value.orderedExperienceIdentities[index]!,
      publicTransitionTopologyId: value.orderedTransitionTopologyIds[index]! })),
    completion: boundary.completion,
    boundaryReason: boundary.reason,
  })}`;
  const expectedTraceId = `r2-trace-${expectedId.slice("r2-event-".length)}`;
  if (value.eventId !== expectedId
    || (value.physicalStatus === "deposited" && value.traceId !== expectedTraceId)) {
    throw new Error("stored-R2-ordered-identity-mismatch");
  }
  let arcLength = 0;
  for (let index = 0; index < value.orderedCoordinates.length; index += 1) {
    const coordinate = value.orderedCoordinates[index]!;
    assertVec3(coordinate);
    for (let axis = 0; axis < 3; axis += 1) {
      if (coordinate[axis]! < R2_CONFIG.boundary.min[axis]!
        || coordinate[axis]! > R2_CONFIG.boundary.max[axis]!) {
        throw new Error("stored-R2-coordinate-outside-physical-boundary");
      }
    }
    if (index > 0) {
      arcLength += norm3(sub3(
        new Float64Array(coordinate),
        new Float64Array(value.orderedCoordinates[index - 1]!),
      ));
    }
  }
  if (value.physicalStatus === "unrepresented-zero-arc" && arcLength > 1e-12) {
    throw new Error("nonzero-R2-path-was-marked-unrepresented-zero-arc");
  }
  if (value.physicalStatus === "deposited" && arcLength <= 1e-12) {
    throw new Error("zero-arc-R2-path-was-marked-deposited");
  }
  for (let index = 0; index < value.publicDependencyLinks.length; index += 1) {
    const link = value.publicDependencyLinks[index]!;
    if (link.version !== "R2PublicDependencyLinkV1"
      || link.predecessorAtomId !== value.atomIds[index]
      || link.successorAtomId !== value.atomIds[index + 1]
      || link.sharedDependencyIds.length === 0
      || link.evidencePairs.length !== link.sharedDependencyIds.length
      || link.evidencePairs.some((pair, pairIndex) =>
        pair.dependencyId !== link.sharedDependencyIds[pairIndex])) {
      throw new Error("stored-R2-public-dependency-link-mismatch");
    }
    for (const pair of link.evidencePairs) {
      for (const [side, evidence, sourceEventId] of [
        ["predecessor", pair.predecessor, value.sourceEventIds[index]],
        ["successor", pair.successor, value.sourceEventIds[index + 1]],
      ] as const) {
        if (evidence.version !== "PublicContinuityEvidenceReferenceV1"
          || evidence.sourceEventId !== sourceEventId
          || !FACT_CATEGORIES.has(evidence.factCategory)
          || !Number.isSafeInteger(evidence.beforeObservationSequence)
          || !Number.isSafeInteger(evidence.afterObservationSequence)
          || !/^[a-f0-9]{64}$/.test(evidence.beforeValueSha256)
          || !/^[a-f0-9]{64}$/.test(evidence.afterValueSha256)
          || evidence.beforeObservationSequence < value.startFrameSequence
          || evidence.afterObservationSequence > value.endFrameSequence
          || evidence.afterObservationSequence < evidence.beforeObservationSequence) {
          throw new Error(`stored-R2-${side}-continuity-evidence-invalid`);
        }
        requireNonEmpty(evidence.subject, "stored continuity evidence subject");
        requireNonEmpty(evidence.property, "stored continuity evidence property");
      }
    }
  }
}

/**
 * Transactional, neutral R2 layer. It stages R1 atoms without touching the
 * physical medium, then commits exactly one ordered physical trace when a
 * real boundary closes a chain of at least two atoms.
 */
export class R2ContinuousEventStore {
  #medium: PhysicalMedium3D;
  #r2PageId: string | null = null;
  readonly #events: R2ContinuousEventV1[] = [];
  readonly #consumedAtomIds = new Set<string>();
  #pending: PendingR2ContinuousEvent | null = null;
  #commitSequence = 0;

  constructor(state?: R2ContinuousEventStoreStateV1) {
    if (state === undefined) {
      this.#medium = new PhysicalMedium3D(R2_CONFIG);
      return;
    }
    if (state.version !== "R2ContinuousEventStoreStateV3"
      || state.hierarchy !== "R1-closed-event_R2-real-continuous-chain-v2"
      || state.minimumR1Atoms !== 2
      || state.coordinateSystem !== R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1
      || state.medium.config.name !== "R2"
      || deterministicJson(state.medium.config) !== deterministicJson(R2_CONFIG)) {
      throw new Error("incompatible-R2-continuous-event-checkpoint");
    }
    this.#medium = PhysicalMedium3D.fromSnapshot(state.medium);
    if (state.r2PageId === null) {
      if (this.#medium.pageCount !== 0) throw new Error("R2-checkpoint-null-page-must-have-no-physical-pages");
    } else if (this.#medium.pageCount !== 1 || !this.#medium.pageIds().includes(state.r2PageId)) {
      throw new Error("R2-checkpoint-page-mismatch");
    }
    this.#r2PageId = state.r2PageId;
    if (!Number.isSafeInteger(state.commitSequence) || state.commitSequence < 0) {
      throw new Error("invalid-R2-commit-sequence");
    }
    this.#commitSequence = state.commitSequence;
    const eventIds = new Set<string>();
    const traceIds = new Set<string>();
    const commitSequences = new Set<number>();
    const eventAtomIds = new Set<string>();
    for (const stored of state.events) {
      validateStoredEvent(stored);
      if (eventIds.has(stored.eventId)
        || (stored.traceId !== null && traceIds.has(stored.traceId))
        || commitSequences.has(stored.commitSequence)) {
        throw new Error("duplicate-R2-event-or-trace-identity");
      }
      if ((stored.physicalStatus === "deposited" && stored.pageId !== state.r2PageId)
        || stored.commitSequence > state.commitSequence) {
        throw new Error("R2-event-checkpoint-sequence-or-page-mismatch");
      }
      if (stored.physicalStatus === "deposited"
        && !this.#medium.traceIds(stored.pageId!).includes(stored.traceId!)) {
        throw new Error("R2-event-missing-physical-trace");
      }
      eventIds.add(stored.eventId);
      if (stored.traceId !== null) traceIds.add(stored.traceId);
      commitSequences.add(stored.commitSequence);
      for (const atomId of stored.atomIds) {
        if (eventAtomIds.has(atomId)) throw new Error("R1-atom-reused-across-R2-events");
        eventAtomIds.add(atomId);
      }
      this.#events.push(cloneEvent(stored));
    }
    for (const atomId of state.consumedAtomIds) {
      requireNonEmpty(atomId, "consumed R1 atom id");
      if (this.#consumedAtomIds.has(atomId)) throw new Error("duplicate-consumed-R1-atom-id");
      this.#consumedAtomIds.add(atomId);
    }
    if ([...eventAtomIds].some((atomId) => !this.#consumedAtomIds.has(atomId))) {
      throw new Error("committed-R2-event-atom-not-marked-consumed");
    }
    if (state.pending !== null) {
      if (state.pending.version !== "PendingR2ContinuousEventStateV2"
        || state.pending.atoms.length < 1
        || state.pending.publicDependencyLinks.length !== state.pending.atoms.length - 1) {
        throw new Error("invalid-pending-R2-continuous-event");
      }
      const atoms = state.pending.atoms.map(atomFromState);
      if (atoms.some((atom) => this.#consumedAtomIds.has(atom.atomId))) {
        throw new Error("pending-R1-atom-was-already-consumed");
      }
      const links: R2PublicDependencyLinkV1[] = [];
      for (let index = 1; index < atoms.length; index += 1) {
        const expected = continuityLink(atoms[index - 1]!, atoms[index]!);
        const stored = state.pending.publicDependencyLinks[index - 1]!;
        if (JSON.stringify(expected) !== JSON.stringify(stored)) {
          throw new Error("pending-R2-continuity-link-mismatch");
        }
        links.push(expected);
      }
      this.#pending = { atoms, publicDependencyLinks: links };
    }
  }

  static restore(state: R2ContinuousEventStoreStateV1): R2ContinuousEventStore {
    return new R2ContinuousEventStore(state);
  }

  get pendingAtomCount(): number {
    return this.#pending?.atoms.length ?? 0;
  }

  get committedEventCount(): number {
    return this.#events.length;
  }

  begin(atom: R1ClosedEventAtomV1): void {
    if (this.#pending !== null) throw new Error("R2-continuous-event-already-open");
    const owned = cloneAtom(atom);
    if (this.#consumedAtomIds.has(owned.atomId)) throw new Error("R1-atom-already-consumed-by-R2");
    this.#pending = { atoms: [owned], publicDependencyLinks: [] };
  }

  append(atom: R1ClosedEventAtomV1): void {
    if (this.#pending === null) throw new Error("R2-continuous-event-is-not-open");
    const owned = cloneAtom(atom);
    if (this.#consumedAtomIds.has(owned.atomId)
      || this.#pending.atoms.some((candidate) => candidate.atomId === owned.atomId)) {
      throw new Error("R1-atom-already-consumed-by-R2");
    }
    const link = continuityLink(this.#pending.atoms.at(-1)!, owned);
    this.#pending.atoms.push(owned);
    this.#pending.publicDependencyLinks.push(link);
  }

  close(boundary: R2EventBoundaryV1): R2CloseReceiptV1 {
    validateBoundary(boundary);
    if (this.#pending === null) throw new Error("R2-continuous-event-is-not-open");
    const pending = this.#pending;
    if (pending.atoms.length < 2) {
      const atomId = pending.atoms[0]!.atomId;
      this.#consumedAtomIds.add(atomId);
      this.#pending = null;
      return {
        version: "R2CloseReceiptV1",
        status: "singleton-rejected",
        atomId,
        completion: boundary.completion,
        boundaryReason: boundary.reason,
      };
    }

    const arcLength = coordinatePathArcLength(pending.atoms, this.#medium);
    const eventId = orderedIdentity(pending.atoms, boundary);
    if (this.#events.some((event) => event.eventId === eventId)) {
      throw new Error("duplicate-R2-continuous-event-identity");
    }
    const physicalStatus: R2ContinuousEventV1["physicalStatus"] =
      boundary.completion === "censored"
        ? "audit-only-censored"
        : arcLength <= 1e-12 ? "unrepresented-zero-arc" : "deposited";
    let traceId: string | null = null;
    let eventPageId: string | null = null;
    let nextMedium = this.#medium;
    let nextPageId = this.#r2PageId;

    if (physicalStatus === "deposited") {
      traceId = `r2-trace-${eventId.slice("r2-event-".length)}`;
      // Deposit against a complete clone first. Any unexpected
      // physical-medium rejection leaves both the live medium and pending
      // chain untouched. Censored and zero-arc records never enter this path.
      nextMedium = PhysicalMedium3D.fromSnapshot(this.#medium.snapshot());
      nextPageId = this.#r2PageId ?? nextMedium.createPage();
      if (nextMedium.traceIds(nextPageId).includes(traceId)) {
        throw new Error("duplicate-R2-physical-trace-identity");
      }
      nextMedium.depositOrderedTrajectory(
        nextPageId,
        pending.atoms.map((atom) => atom.r2Coordinate),
        1,
        traceId,
      );
      eventPageId = nextPageId;
    }

    const first = pending.atoms[0]!;
    const last = pending.atoms.at(-1)!;
    const event: R2ContinuousEventV1 = {
      version: "R2ContinuousEventV2",
      eventId,
      traceId,
      pageId: eventPageId,
      commitSequence: this.#commitSequence + 1,
      completion: boundary.completion,
      boundaryReason: boundary.reason,
      physicalStatus,
      learningEligible: physicalStatus === "deposited",
      sessionId: first.sessionId,
      continuityEpochId: first.continuityEpochId,
      startedAt: first.startedAt,
      endedAt: last.endedAt,
      startFrameSequence: first.startFrameSequence,
      endFrameSequence: last.endFrameSequence,
      atomIds: pending.atoms.map((atom) => atom.atomId),
      sourceEventIds: pending.atoms.map((atom) => atom.sourceEventId),
      orderedExperienceIdentities: pending.atoms.map((atom) => atom.exactExperienceIdentity),
      orderedTransitionTopologyIds: pending.atoms.map((atom) => atom.publicTransitionTopologyId),
      publicDependencyLinks: pending.publicDependencyLinks.map(cloneLink),
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      orderedCoordinates: pending.atoms.map((atom) => [...atom.r2Coordinate]),
    };
    validateStoredEvent(event);

    this.#medium = nextMedium;
    this.#r2PageId = nextPageId;
    this.#commitSequence = event.commitSequence;
    this.#events.push(event);
    for (const atom of pending.atoms) this.#consumedAtomIds.add(atom.atomId);
    this.#pending = null;
    return { version: "R2CloseReceiptV1", status: "committed", event: cloneEvent(event) };
  }

  interrupt(reason: R2CensoredBoundaryReasonV1): R2CloseReceiptV1 {
    return this.close({ version: "R2EventBoundaryV1", completion: "censored", reason });
  }

  /** Recovery stays governed by the unchanged PhysicalMedium3D implementation. */
  recover(elapsed: number): void {
    this.#medium.recover(elapsed);
  }

  events(options: { readonly learningEligibleOnly?: boolean } = {}): readonly R2ContinuousEventV1[] {
    return this.#events
      .filter((event) => !options.learningEligibleOnly || event.learningEligible)
      .map(cloneEvent);
  }

  mediumSnapshot(): MediumSnapshot {
    return this.#medium.snapshot();
  }

  isTraceActive(pageId: string, traceId: string): boolean {
    return this.#medium.isTraceActive(pageId, traceId);
  }

  basinContainingTrace(pageId: string, traceId: string) {
    return this.#medium.basinContainingTrace(pageId, traceId);
  }

  traceSnapshot(pageId: string, traceId: string) {
    return this.#medium.traceSnapshot(pageId, traceId);
  }

  snapshot(): R2ContinuousEventStoreStateV1 {
    return {
      version: "R2ContinuousEventStoreStateV3",
      hierarchy: "R1-closed-event_R2-real-continuous-chain-v2",
      minimumR1Atoms: 2,
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
      medium: this.#medium.snapshot(),
      r2PageId: this.#r2PageId,
      events: this.#events.map(cloneEvent),
      pending: this.#pending === null ? null : {
        version: "PendingR2ContinuousEventStateV2",
        atoms: this.#pending.atoms.map(atomState),
        publicDependencyLinks: this.#pending.publicDependencyLinks.map(cloneLink),
      },
      consumedAtomIds: [...this.#consumedAtomIds].sort(),
      commitSequence: this.#commitSequence,
    };
  }
}
