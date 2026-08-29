import type { Vec3 } from "../contracts.js";

declare const R1_EVENT_COORDINATE: unique symbol;

/** A coordinate produced only by a frozen R1 event codec. It is never a world coordinate. */
export type R1EventCoordinateV1 = Vec3 & { readonly [R1_EVENT_COORDINATE]: "R1EventCoordinateV1" };

export type PublicChangePropertyV1 =
  | "relative-position"
  | "relative-velocity"
  | "orientation"
  | "support"
  | "collision"
  | "health"
  | "visibility"
  | "block-state"
  | "held-slot"
  | "sound";

export interface PublicActionCueV1 {
  readonly version: "PublicActionCueV1";
  readonly actionDescriptorSha256: string;
  readonly actionEnvironment: string;
  readonly actionKind: string;
  readonly targetRole: string;
  readonly normalizedParameters: Readonly<Record<string, string | number | boolean>>;
  readonly attentionFocusRole: string;
  readonly selfState: {
    readonly velocityEgocentric: readonly [number, number, number];
    readonly onGround: boolean;
    readonly healthBand: number;
    readonly selectedHotbarSlot: number;
  };
  /** Stable, public, local-condition tokens. IDs, coordinates, clocks and outcomes are forbidden. */
  readonly publicConditionTokens: readonly string[];
  readonly provenance: {
    readonly publicOnly: true;
    readonly preActionOnly: true;
    readonly containsAbsoluteWorldPosition: false;
    readonly containsFutureObservation: false;
    readonly containsSemanticRuleOrResult: false;
  };
}

export interface PublicChangeAtomV1 {
  readonly version: "PublicChangeAtomV1";
  readonly ordinal: number;
  /** Event-local role, never a persistent object ID. */
  readonly subjectRole: string;
  readonly property: PublicChangePropertyV1;
  /** Egocentric or subject-relative public change; never an absolute world position. */
  readonly relativeDelta: readonly [number, number, number];
  readonly cumulativeDelta: readonly [number, number, number];
  readonly scalarDelta: number;
  readonly cumulativeScalar: number;
  readonly magnitude: number;
  readonly visibility: "present" | "appeared" | "disappeared";
  readonly publicStateBefore: string | number | boolean | null;
  readonly publicStateAfter: string | number | boolean | null;
  readonly source: "trusted-public-frame-difference" | "trusted-public-event";
}

export interface TrustedActionEventV2 {
  readonly version: "TrustedActionEventV2";
  readonly eventId: string;
  readonly cue: PublicActionCueV1;
  readonly changes: readonly PublicChangeAtomV1[];
  readonly trackedSubjectRoles: readonly string[];
  readonly lifecycle: {
    readonly startObservationSequence: number;
    readonly endObservationSequence: number;
    readonly stablePhysicsTicks: number;
    readonly gracePhysicsTicks: number;
    readonly endReason: "stable-with-grace" | "maximum-duration";
  };
  readonly trust: {
    readonly liveActionCommitted: true;
    readonly continuousPublicFrames: true;
    readonly knownOutcome: true;
    readonly actualObservation: true;
    readonly publicOnly: true;
    readonly containsSimulatorPrivate: false;
    readonly containsFutureObservation: false;
    readonly containsSemanticRuleOrResult: false;
  };
}

export interface R1EventTokenV1 {
  readonly version: "R1EventTokenV1";
  readonly ordinal: number;
  readonly sourceChangeOrdinal: number | null;
  readonly featureSha256: string;
  readonly coordinate: R1EventCoordinateV1;
}

export interface R1EventPathV1 {
  readonly version: "R1EventPathV1";
  readonly codecVersion: "R1EventCodecV1";
  readonly codecConfigSha256: string;
  readonly codecParameterSha256: string;
  readonly cueSha256: string;
  readonly eventSha256: string;
  readonly tokens: readonly R1EventTokenV1[];
  readonly points: readonly R1EventCoordinateV1[];
  readonly intrinsicArcLength: number;
  readonly intrinsicClosureDistance: number;
  readonly selfIntersectionCount: number;
}

export interface R1EventCodecStateV1 {
  readonly version: "R1EventCodecStateV1";
  readonly seed: string;
  readonly featureWidth: 96;
  readonly stepMinimum: number;
  readonly stepMaximum: number;
  readonly transverseScale: number;
  readonly propertyScales: Readonly<Record<PublicChangePropertyV1, number>>;
  readonly calibratedEventCount: number;
  readonly configSha256: string;
  readonly parameterSha256: string;
}

export interface R1EventCodecIdentityV1 {
  readonly version: "R1EventCodecIdentityV1";
  readonly codecVersion: "R1EventCodecV1";
  readonly configSha256: string;
  readonly parameterSha256: string;
  readonly outputDimensions: 3;
  readonly frozen: true;
}

export interface PublicChangeEnvelopeV1 {
  readonly version: "PublicChangeEnvelopeV1";
  readonly supported: boolean;
  readonly dominantProperties: readonly PublicChangePropertyV1[];
  readonly signedChange: number;
  readonly intrinsicProgress: number;
  readonly transverseChange: number;
  readonly confidence: number;
  readonly calibratedProbability: false;
}

export type PublicChangeDirectionV2 = "front" | "back" | "left" | "right" | "up" | "down" | "none";
export type PublicChangeMagnitudeBandV2 = "trace" | "small" | "medium" | "large";
export type PublicDistanceTrendV2 = "approaching" | "receding" | "unchanged" | "not-applicable";

export interface PublicChangeReadoutAtomV2 {
  readonly version: "PublicChangeReadoutAtomV2";
  /** Event-local role only. Persistent Minecraft object identities never enter R1. */
  readonly subjectRole: string;
  readonly property: PublicChangePropertyV1;
  readonly direction: PublicChangeDirectionV2;
  readonly magnitudeBand: PublicChangeMagnitudeBandV2;
  readonly distanceTrend: PublicDistanceTrendV2;
  readonly stateTransition: {
    readonly before: string | number | boolean | null;
    readonly after: string | number | boolean | null;
  } | null;
}

/** Direction-preserving public readout. It contains no world coordinate. */
export interface PublicChangeEnvelopeV2 {
  readonly version: "PublicChangeEnvelopeV2";
  readonly supported: boolean;
  readonly dominantProperties: readonly PublicChangePropertyV1[];
  readonly signedChange: number;
  readonly intrinsicProgress: number;
  readonly transverseChange: number;
  readonly changes: readonly PublicChangeReadoutAtomV2[];
  readonly confidence: number;
  readonly calibratedProbability: false;
}

export interface R1EventTokenV2 {
  readonly version: "R1EventTokenV2";
  readonly ordinal: number;
  readonly sourceChangeOrdinal: number | null;
  readonly phase: "cue" | "action-initiation" | "property" | "subject" | "direction-state" | "magnitude";
  readonly featureSha256: string;
  readonly coordinate: R1EventCoordinateV1;
}

export interface R1EventPathV2 {
  readonly version: "R1EventPathV2";
  readonly codecVersion: "R1EventCodecV2";
  readonly codecConfigSha256: string;
  readonly codecParameterSha256: string;
  readonly codecBundleSha256: string;
  readonly cueSha256: string;
  readonly eventSha256: string;
  readonly tokens: readonly R1EventTokenV2[];
  readonly points: readonly R1EventCoordinateV1[];
  readonly intrinsicArcLength: number;
  readonly intrinsicClosureDistance: number;
  readonly selfIntersectionCount: number;
}

export interface R1EventBootstrapManifestEntryV2 {
  readonly eventId: string;
  readonly eventSha256: string;
  readonly actionDescriptorSha256: string;
  readonly publicLayoutId: string;
  readonly sourceSampleNumber: number;
}

export interface R1EventBootstrapManifestV2 {
  readonly version: "R1EventBootstrapManifestV2";
  readonly source: "trusted-real-minecraft-events";
  readonly eventCount: 32;
  readonly descriptorCount: 8;
  readonly eventsPerDescriptor: 4;
  readonly entries: readonly R1EventBootstrapManifestEntryV2[];
  readonly sha256: string;
}

export interface R1EventCodecQualificationResultV2 {
  readonly version: "R1EventCodecQualificationResultV2";
  readonly heldOutEventCount: number;
  readonly translationInvariantRate: number;
  readonly directionReadoutAccuracy: number;
  readonly collisionCount: number;
  /** Independently measured; production qualification requires exactly zero. */
  readonly absoluteWorldCoordinateReadCount: number;
  readonly passed: boolean;
  readonly evidenceSha256: string;
}

export interface R1EventCodecStateV2 {
  readonly version: "R1EventCodecStateV2";
  readonly seed: string;
  readonly featureWidth: 96;
  readonly stepMinimum: number;
  readonly stepMaximum: number;
  readonly transverseScale: number;
  readonly propertyScales: Readonly<Record<PublicChangePropertyV1, number>>;
  readonly calibratedEventCount: 32;
  readonly bootstrapManifestSha256: string;
  readonly configSha256: string;
  readonly parameterSha256: string;
}

export interface R1EventCodecIdentityV2 {
  readonly version: "R1EventCodecIdentityV2";
  readonly codecVersion: "R1EventCodecV2";
  readonly configSha256: string;
  readonly parameterSha256: string;
  readonly bundleSha256: string;
  readonly outputDimensions: 3;
  readonly frozen: true;
}

export interface R1EventCodecBundleV2 {
  readonly version: "R1EventCodecBundleV2";
  readonly identity: R1EventCodecIdentityV2;
  readonly codecState: R1EventCodecStateV2;
  readonly bootstrapManifest: R1EventBootstrapManifestV2;
  readonly qualification: R1EventCodecQualificationResultV2;
}

export interface R1EventMapQualificationReplayEntryV1 {
  readonly sampleNumber: number;
  readonly eventId: string;
  readonly rawEvidenceSha256: string;
  readonly originalEventSha256: string;
  readonly translatedEventSha256: string;
  readonly originalPathSha256: string;
  readonly translatedPathSha256: string;
  readonly directionalAtomCount: number;
  readonly correctDirectionCount: number;
  readonly collisionCount: number;
  readonly translationInvariant: boolean;
}

export interface R1EventMapQualificationBootstrapEntryV1 {
  readonly sampleNumber: number;
  readonly eventId: string;
  readonly rawEvidenceSha256: string;
  readonly eventSha256: string;
}

export interface R1EventMapQualificationAttestationV1 {
  readonly version: "R1EventMapQualificationAttestationV1";
  readonly bundleSha256: string;
  readonly bundleQualificationEvidenceSha256: string;
  readonly bootstrapEventCount: 32;
  readonly heldOutEventCount: 96;
  readonly bootstrapRawEvidenceSha256s: readonly string[];
  readonly bootstrapReplayEntries: readonly R1EventMapQualificationBootstrapEntryV1[];
  readonly heldOutReplayEntries: readonly R1EventMapQualificationReplayEntryV1[];
  readonly rawEventManifestSha256: string;
  readonly directionReadoutAccuracy: number;
  readonly translationInvariantRate: number;
  readonly collisionCount: number;
  readonly absoluteWorldCoordinateReadCount: number;
  readonly staticWorldToR1ConversionCount: number;
  readonly staticR1ToWorldConversionCount: number;
  readonly qualificationAuditSourceSha256: string;
  readonly passed: boolean;
  readonly sha256: string;
}
