import type { R1EventCodecBundleV2, R1EventCodecStateV1,
  R1EventMapQualificationAttestationV1 } from "./events/contracts.js";

export type Vec3 = Float64Array;

export interface BoundaryConfig {
  readonly mode: "reflect";
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MediumConfig {
  readonly name: "R1" | "R2" | "R2A" | "prediction" | "test";
  readonly recoveryRate: number;
  readonly kernelWidth: number;
  readonly visitAmplitude: number;
  readonly roadStartAmplitude: number;
  readonly roadEndAmplitude: number;
  readonly timeStep: number;
  readonly diffusion: number;
  readonly temperature: number;
  readonly basinRadiusScale: number;
  readonly minimumActiveMagnitude: number;
  readonly boundary: BoundaryConfig;
}

export interface KernelSnapshot {
  readonly center: Vec3;
  readonly coefficient: number;
  readonly originalMagnitude: number;
  readonly sigma: number;
  readonly depositedAt: number;
  readonly kind: "visit" | "road";
  readonly arcFraction: number | null;
  readonly traceId: string | null;
}

export interface PageSnapshot {
  readonly pageId: string;
  readonly createdAt: number;
  readonly kernels: readonly KernelSnapshot[];
}

export interface MediumSnapshot {
  readonly config: MediumConfig;
  readonly logicalTime: number;
  readonly boundaryHits: number;
  readonly pageSequence: number;
  readonly pages: readonly PageSnapshot[];
}

export interface BasinActivation {
  readonly pageId: string;
  readonly coordinate: Vec3;
  readonly depth: number;
  readonly support: number;
  readonly queryContribution: number;
  readonly decayFraction: number;
  readonly kernelCount: number;
  /** Opaque identities of active visit kernels in the full component. */
  readonly memberVisitIds: readonly string[];
  /**
   * Opaque visit/road trace identities whose currently active kernels form
   * this connected physical basin.  The array is a defensive snapshot; it
   * carries no semantic outcome label.
   */
  readonly memberTraceIds: readonly string[];
}

/** Current R2 membership resolved from the real active visit kernels. */
export interface ActiveR2BasinMembershipV1 {
  readonly version: "ActiveR2BasinMembershipV1";
  readonly pageId: string;
  readonly coordinate: readonly number[];
  readonly memberVisitIds: readonly string[];
}

/** Narrow read-only port consumed by R2A; it cannot deposit or recover R2. */
export interface R2BasinMembershipResolverV1 {
  resolveActiveR2Basin(r2VisitId: string): ActiveR2BasinMembershipV1 | null;
}

export interface R1TraceSnapshot {
  readonly pageId: string;
  readonly traceId: string;
  readonly capturedAt: number;
  readonly kernels: readonly KernelSnapshot[];
}

export interface R1RouteSignature {
  readonly version: "R1RouteSignatureV2";
  readonly geometry: Float64Array;
  readonly initialTangent: Vec3;
  readonly terminalTangent: Vec3;
  readonly intrinsicClosureDistance: number;
  readonly selfIntersectionCount: number;
}

export interface StepResult {
  readonly position: Vec3;
  readonly candidate: Vec3;
  readonly accepted: boolean;
  readonly acceptanceProbability: number;
  readonly currentPotential: number;
  readonly candidatePotential: number;
  readonly boundaryHits: number;
}

export interface PublicR1State {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly causalPrefix: readonly Vec3[];
  readonly observedAt: number;
  readonly numericAttributes: Float64Array;
}

/** Public, pre-outcome identity used to freeze an R2A candidate pool. */
export interface PublicEventContextV1 {
  readonly version: "PublicEventContextV1";
  readonly category: "action" | "passive";
  readonly interventionKey: string;
  readonly sceneFingerprint: string;
  readonly publicR1Signature: string;
}

/**
 * V2 separates a stable, pre-outcome causal evidence source from an exact
 * transport-frame fingerprint. Legacy sceneFingerprint values remain
 * readable for audit only and are never migrated into this identity.
 */
export interface PublicEventContextV2 {
  readonly version: "PublicEventContextV2";
  readonly category: "action" | "passive";
  readonly interventionKey: string;
  readonly causalEvidenceContextId: string;
  readonly causalEvidenceContextIdentityVersion: "CausalEvidenceContextIdV1" | "CausalEvidenceContextIdV2";
  readonly publicR1Signature: string;
}

export type PublicEventContext = PublicEventContextV1 | PublicEventContextV2;

export interface RawExperience {
  readonly trajectory: readonly Vec3[];
  readonly r1EventPathIdentity?: {
    readonly version: "R1EventPathIdentityV1";
    readonly codecConfigSha256: string;
    readonly codecParameterSha256: string;
    /** Present and mandatory for production V2 event-map observations. */
    readonly codecBundleSha256?: string;
    readonly cueSha256: string;
    readonly eventSha256: string;
  };
  readonly perception: Float64Array;
  readonly r1State: PublicR1State;
  readonly publicEventContext?: PublicEventContext;
  readonly provenance: {
    readonly actualObservation: boolean;
    readonly publicOnly: boolean;
    readonly causallyAvailable: boolean;
    readonly containsSimulatorPrivate: boolean;
    readonly containsFutureObservation: boolean;
    readonly containsSemanticRuleOrResult: boolean;
  };
}

export interface SparseFactor {
  readonly coordinate: Vec3;
  readonly intensity: number;
}

export interface R1TraceReference {
  readonly pageId: string;
  readonly traceId: string;
}

export interface CoactivationTrace {
  readonly coactivationId: string;
  readonly r2Coordinate: Vec3;
  readonly experienceAnchorId: string;
  readonly r1Trace: R1TraceReference;
  readonly observedAt: number;
  readonly initialStrength: number;
  readonly currentStrength: number;
}

export interface ObservationReceipt {
  readonly eventNumber: number;
  readonly logicalTime: number;
  readonly r1PageId: string;
  readonly r1TraceId: string;
  readonly r2PageId: string;
  readonly coactivationId: string;
  readonly experienceAnchorId: string;
  readonly relationsUpdated: number;
}

export interface TokenFieldEncoderStateV2 {
  readonly width: 256;
  readonly frozen: true;
  readonly inputMean: readonly number[];
  readonly inputDeviation: readonly number[];
}

export interface ExperienceAnchor {
  readonly anchorId: string;
  readonly eventNumber: number;
  readonly observedAt: number;
  readonly perception: Float64Array;
  readonly contextCoordinate: Vec3;
  readonly contextOrigin: Vec3;
  readonly initialTangent: Vec3;
  readonly initialSpeed: number;
  readonly r2PageId: string;
  readonly r2VisitId: string;
  readonly r2Coordinate: Vec3;
  readonly r1Trace: R1TraceReference;
  readonly publicEventContext?: PublicEventContext;
}

export interface ExperienceMapStateV2 {
  readonly sequence: number;
  readonly anchors: readonly ExperienceAnchor[];
}

export interface FieldToken {
  readonly tokenIndex: number;
  readonly coordinate: Vec3;
  readonly standardizedValue: number;
}

export interface CommonFieldToken {
  readonly tokenIndex: number;
  readonly coordinate: Vec3;
  readonly standardizedValue: number;
  readonly coverage: number;
}

export interface ResidualFieldState {
  readonly values: readonly number[];
  readonly magnitude: number;
}

export interface ResidualModeState {
  readonly modeId: string;
  readonly prototype: readonly number[];
  readonly count: number;
  readonly sourceAnchorIds: readonly string[];
  readonly positiveSourceAnchorIds: readonly string[];
  readonly negativeSourceAnchorIds: readonly string[];
}

export interface OutcomeModeState {
  readonly modeId: string;
  readonly coordinate: readonly number[];
  readonly count: number;
  readonly sourceAnchorIds: readonly string[];
}

export interface ContrastRelationState {
  readonly relationId: string;
  readonly commonInput: readonly {
    readonly tokenIndex: number;
    readonly coordinate: readonly number[];
    readonly standardizedValue: number;
    readonly coverage: number;
  }[];
  readonly commonOutcomeCoordinate: readonly number[];
  readonly inputModes: readonly ResidualModeState[];
  readonly outcomeModes: readonly OutcomeModeState[];
  readonly evidence: readonly {
    readonly inputModeId: string;
    readonly inputPole: -1 | 1;
    readonly outcomeModeId: string;
    readonly count: number;
  }[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly confidence: number;
  readonly sourceAnchorIds: readonly string[];
  readonly cohortHash: string;
}

export interface CausalContrastStateV2 {
  readonly relationSequence: number;
  readonly inputModeSequence: number;
  readonly inputPatterns: readonly ResidualModeState[];
  readonly processedCohortHashes: readonly string[];
  readonly relations: readonly ContrastRelationState[];
}

export interface SparseTokenConditionV1 {
  readonly tokenIndex: number;
  readonly standardizedValue: number;
  readonly tolerance: number;
}

export interface PhysicalBasinReferenceV1 {
  readonly pageId: string;
  readonly coordinate: readonly number[];
}

export interface ProvisionalFactorCandidateV1 {
  readonly candidateId: string;
  readonly factorId: string;
  readonly physicalBasin: PhysicalBasinReferenceV1;
  readonly sparseTokenConditions: readonly SparseTokenConditionV1[];
  readonly sourceEventIds: readonly string[];
  readonly sourceSceneFingerprints: readonly string[];
  readonly supportStrength: number;
  readonly contradictionStrength: number;
  readonly state: "provisional" | "promoted" | "recovered" | "rejected";
  readonly lastAccessTime: number;
}

export interface CausalFactorNodeV1 {
  readonly factorId: string;
  readonly physicalBasin: PhysicalBasinReferenceV1;
  readonly sparseTokenConditions: readonly SparseTokenConditionV1[];
  readonly residualPrototype: readonly number[];
  readonly commonInput: readonly CommonFieldToken[];
  readonly sourceEventIds: readonly string[];
  readonly sourceSceneFingerprints: readonly string[];
  readonly supportStrength: number;
  readonly contradictionStrength: number;
  readonly activationConsistency: number;
  readonly r2SelectionGain: number;
  readonly state: "provisional" | "stable" | "unresolved-composite" | "degraded" | "recovered";
  readonly lastAccessTime: number;
}

export interface CausalHyperedgeV1 {
  readonly hyperedgeId: string;
  readonly factorIds: readonly string[];
  readonly interventionKey: string;
  readonly targetR2Basin: PhysicalBasinReferenceV1;
  readonly supportStrength: number;
  readonly contradictionStrength: number;
  readonly controlledExperimentCoverage: number;
  readonly relationStrength: number;
  readonly sourceEventIds: readonly string[];
  readonly sourceSceneFingerprints: readonly string[];
  readonly state: "provisional" | "stable" | "minimal-under-tested-interventions" | "unresolved-composite" | "degraded" | "recovered";
}

export interface FactorMotifV1 {
  readonly motifId: string;
  readonly factorIds: readonly string[];
  readonly referencedHyperedgeIds: readonly string[];
  readonly uncompressedJsonBytes: number;
  readonly compressedJsonBytes: number;
  readonly reductionFraction: number;
}

export interface FrozenFactorCandidatePoolStateV1 {
  readonly ticketId: string;
  readonly anchorId: string;
  readonly eventNumber: number;
  readonly observedAt: number;
  readonly interventionKey: string;
  readonly sceneFingerprint: string;
  readonly publicR1Signature: string;
  readonly encodedValues: readonly number[];
  readonly commonInput: readonly CommonFieldToken[];
  readonly residualValues: readonly number[];
  readonly candidateFactorIds: readonly string[];
  readonly cohortAnchorIds: readonly string[];
}

export interface OpenFactorEventSummaryV1 {
  readonly anchorId: string;
  readonly eventNumber: number;
  readonly observedAt: number;
  readonly interventionKey: string;
  readonly sceneFingerprint: string;
  readonly publicR1Signature: string;
  readonly encodedValues: readonly number[];
  readonly assignedFactorIds: readonly string[];
  readonly targetR2Basin: PhysicalBasinReferenceV1;
  readonly r1Trace: R1TraceReference;
}

export interface ControlledExperimentPairSummaryV1 {
  readonly pairId: string;
  readonly hyperedgeId: string;
  readonly changedFactorId: string;
  readonly probeActionId: string;
  readonly sceneFingerprint: string;
  readonly selectionDrop: number;
  readonly supported: boolean;
}

export interface CausalFactorGraphStateV1 {
  readonly version: "CausalFactorGraphStateV1";
  readonly r2aMedium: MediumSnapshot;
  readonly factorNodes: readonly CausalFactorNodeV1[];
  readonly hyperedges: readonly CausalHyperedgeV1[];
  readonly motifs: readonly FactorMotifV1[];
  readonly provisionalCandidates: readonly ProvisionalFactorCandidateV1[];
  readonly pendingCandidatePools: readonly FrozenFactorCandidatePoolStateV1[];
  readonly eventSummaries: readonly OpenFactorEventSummaryV1[];
  readonly testedSubsets: readonly string[];
  readonly controlledExperimentPairs: readonly ControlledExperimentPairSummaryV1[];
  readonly factorSequence: number;
  readonly hyperedgeSequence: number;
  readonly motifSequence: number;
  readonly ticketSequence: number;
  readonly logicalTime: number;
}

export type ProvisionalFactorCandidateV2 = Omit<ProvisionalFactorCandidateV1, "sourceSceneFingerprints"> & {
  readonly sourceContextIds: readonly string[];
};
export type CausalFactorNodeV2 = Omit<CausalFactorNodeV1, "sourceSceneFingerprints"> & {
  readonly sourceContextIds: readonly string[];
};
export type CausalHyperedgeV2 = Omit<CausalHyperedgeV1, "sourceSceneFingerprints"> & {
  readonly sourceContextIds: readonly string[];
  /** Contexts observed only after the initial four-context relation existed. */
  readonly retainedValidationContextIds: readonly string[];
  readonly retainedValidationFailureCount: number;
};
export type FrozenFactorCandidatePoolStateV2 = Omit<FrozenFactorCandidatePoolStateV1, "sceneFingerprint"> & {
  readonly sourceContextId: string;
};
export type OpenFactorEventSummaryV2 = Omit<OpenFactorEventSummaryV1, "sceneFingerprint"> & {
  readonly sourceContextId: string;
};
export type ControlledExperimentPairSummaryV2 = Omit<ControlledExperimentPairSummaryV1, "sceneFingerprint"> & {
  readonly sourceContextId: string;
};

export interface CausalFactorGraphStateV2 {
  readonly version: "CausalFactorGraphStateV2";
  readonly evidenceContextIdentityVersion: "CausalEvidenceContextIdV1" | "CausalEvidenceContextIdV2";
  readonly legacySceneFingerprintsMigrated: false;
  readonly r2aMedium: MediumSnapshot;
  readonly factorNodes: readonly CausalFactorNodeV2[];
  readonly hyperedges: readonly CausalHyperedgeV2[];
  readonly motifs: readonly FactorMotifV1[];
  readonly provisionalCandidates: readonly ProvisionalFactorCandidateV2[];
  readonly pendingCandidatePools: readonly FrozenFactorCandidatePoolStateV2[];
  readonly eventSummaries: readonly OpenFactorEventSummaryV2[];
  readonly testedSubsets: readonly string[];
  readonly controlledExperimentPairs: readonly ControlledExperimentPairSummaryV2[];
  readonly factorSequence: number;
  readonly hyperedgeSequence: number;
  readonly motifSequence: number;
  readonly ticketSequence: number;
  readonly logicalTime: number;
}

/**
 * Writable graph whose outcome identity is the current real R2 basin.
 * V2 is intentionally audit-only because it used R1 page identity and a
 * fixed coordinate radius to manufacture result modes outside R2.
 */
export type OpenFactorEventSummaryV3 = Omit<OpenFactorEventSummaryV2, "r1Trace"> & {
  readonly r2VisitId: string;
};

export type CausalHyperedgeV3 = CausalHyperedgeV2 & {
  /** One real visit used to resolve the edge's current physical R2 basin. */
  readonly targetR2VisitId: string;
};

export interface CausalFactorGraphStateV3 {
  readonly version: "CausalFactorGraphStateV3";
  readonly outcomeIdentityVersion: "ActiveR2BasinMembershipV1";
  readonly evidenceContextIdentityVersion: "CausalEvidenceContextIdV1" | "CausalEvidenceContextIdV2";
  readonly legacySceneFingerprintsMigrated: false;
  readonly legacyOutcomeModesMigrated: false;
  readonly r2aMedium: MediumSnapshot;
  readonly factorNodes: readonly CausalFactorNodeV2[];
  readonly hyperedges: readonly CausalHyperedgeV3[];
  readonly motifs: readonly FactorMotifV1[];
  readonly provisionalCandidates: readonly ProvisionalFactorCandidateV2[];
  readonly pendingCandidatePools: readonly FrozenFactorCandidatePoolStateV2[];
  readonly eventSummaries: readonly OpenFactorEventSummaryV3[];
  readonly testedSubsets: readonly string[];
  readonly controlledExperimentPairs: readonly ControlledExperimentPairSummaryV2[];
  readonly factorSequence: number;
  readonly hyperedgeSequence: number;
  readonly motifSequence: number;
  readonly ticketSequence: number;
  readonly logicalTime: number;
}

export interface PathProjectorStateV1 {
  readonly landmarks: readonly (readonly number[])[];
  readonly bandwidth: number;
  readonly weights: readonly (readonly number[])[];
  readonly diagnostics: {
    readonly geometryDistanceCorrelation: number;
    readonly causalPrefixRootMeanSquaredDistance: number;
    readonly outputDimensions: 3;
    readonly landmarkCount: number;
  };
}

/**
 * Writable path representation whose otherwise arbitrary output unit is
 * calibrated once against measurement-equivalent resampling and the real R2
 * boundary.  V1 remains audit-only because it carries no such unit proof.
 */
export interface PathProjectorStateV2 {
  readonly version: "PathProjectorStateV2";
  readonly landmarks: readonly (readonly number[])[];
  readonly bandwidth: number;
  readonly weights: readonly (readonly number[])[];
  readonly resolution: {
    readonly version: "R2MeasurementResolutionCalibrationV2";
    readonly selectionRule: "min-equivalence-and-boundary-caps";
    readonly outputScale: number;
    readonly unscaledCenter: readonly number[];
    readonly equivalentVariationMaximum: number;
    readonly equivalentVariationQuantile: 1;
    readonly equivalenceLimitedScale: number | null;
    readonly boundaryLimitedScale: number | null;
    readonly boundaryLimited: boolean;
    readonly boundaryMargin: number;
    readonly physicalKernelWidth: number;
    /** Diagnostic only; it never participates in choosing outputScale. */
    readonly componentSizes: readonly number[];
  };
  readonly diagnostics: {
    readonly geometryDistanceCorrelation: number;
    readonly causalPrefixRootMeanSquaredDistance: number;
    readonly outputDimensions: 3;
    readonly landmarkCount: number;
  };
}

/**
 * Historical path representation. V2 is audit-only because its
 * measurement-equivalent calibration could remove an observed polyline
 * vertex while down-sampling and therefore silently cut a corner; V3 is also
 * audit-only because it rotated every event into a private tangent frame.
 */
export interface PathProjectorStateV3 {
  readonly version: "PathProjectorStateV3";
  readonly landmarks: readonly (readonly number[])[];
  readonly bandwidth: number;
  readonly weights: readonly (readonly number[])[];
  readonly resolution: {
    readonly version: "R2MeasurementResolutionCalibrationV3";
    readonly selectionRule: "min-equivalence-and-boundary-caps";
    readonly equivalentGeometryMethod: "vertex-preserving-polyline-densification";
    readonly boundaryGeometry: "max-centered-radius-within-inscribed-sphere";
    readonly outputScale: number;
    readonly unscaledCenter: readonly number[];
    readonly equivalentVariationMaximum: number;
    readonly equivalentVariationQuantile: 1;
    readonly equivalenceLimitedScale: number | null;
    readonly boundaryLimitedScale: number | null;
    readonly boundaryLimited: boolean;
    readonly boundaryMargin: number;
    readonly physicalKernelWidth: number;
    /** Diagnostic only; it never participates in choosing outputScale. */
    readonly componentSizes: readonly number[];
  };
  readonly diagnostics: PathProjectorStateV2["diagnostics"];
}

/**
 * Event-space projector with one frozen global coordinate frame.  V3 is
 * audit-only for V5 because independently rotating every event's initial
 * tangent can erase the identity of a public state transition.
 */
export interface PathProjectorStateV4 {
  readonly version: "PathProjectorStateV4";
  readonly measurementGeometry: "source-translated-global-event-frame-v1";
  readonly landmarks: readonly (readonly number[])[];
  readonly bandwidth: number;
  readonly weights: readonly (readonly number[])[];
  readonly resolution: {
    readonly version: "R2MeasurementResolutionCalibrationV4";
    readonly selectionRule: "min-equivalence-and-boundary-caps";
    readonly equivalentGeometryMethod: "vertex-preserving-polyline-densification";
    readonly boundaryGeometry: "max-centered-radius-within-inscribed-sphere";
    readonly outputScale: number;
    readonly unscaledCenter: readonly number[];
    readonly equivalentVariationMaximum: number;
    readonly equivalentVariationQuantile: 1;
    readonly equivalenceLimitedScale: number | null;
    readonly boundaryLimitedScale: number | null;
    readonly boundaryLimited: boolean;
    readonly boundaryMargin: number;
    readonly physicalKernelWidth: number;
    readonly componentSizes: readonly number[];
  };
  readonly diagnostics: PathProjectorStateV2["diagnostics"];
}

export interface PerceptionFilterStateV1 {
  readonly slotCount: 4;
  readonly frozen: true;
  readonly inputMean: readonly number[];
  readonly inputDeviation: readonly number[];
  readonly slots: readonly {
    readonly weights: readonly number[];
    readonly relevance: number;
    readonly mean: number;
    readonly deviation: number;
  }[];
}

export interface ExperienceStoreCheckpointV2 {
  readonly r1: MediumSnapshot;
  readonly r2: MediumSnapshot;
  readonly r2PageId: string;
  readonly coactivations: readonly CoactivationTrace[];
  readonly coactivationSequence: number;
  readonly pageRoutes: readonly {
    readonly pageId: string;
    readonly geometryMean: readonly number[];
    readonly tangentMean: readonly number[];
    readonly displacementMean: readonly number[];
    readonly count: number;
  }[];
  readonly eventSequence: number;
  readonly logicalTime: number;
}

export interface ExperienceStoreCheckpointV3 {
  readonly version: "ExperienceStoreCheckpointV3";
  readonly r1: MediumSnapshot;
  readonly r2: MediumSnapshot;
  readonly r2PageId: string;
  readonly coactivations: readonly CoactivationTrace[];
  readonly coactivationSequence: number;
  readonly pageRoutes: readonly {
    readonly version: "R1RoutePrototypeV2";
    readonly pageId: string;
    readonly geometryMean: readonly number[];
    readonly initialTangentMean: readonly number[];
    readonly terminalTangentMean: readonly number[];
    readonly intrinsicClosureDistanceMean: number;
    readonly selfIntersectionCountMaximum: number;
    readonly count: number;
  }[];
  readonly eventSequence: number;
  readonly logicalTime: number;
}

export interface MediumTimeContractV1 {
  readonly version: "MediumTimeContractV1";
  readonly unit: "seconds";
  readonly epoch: "unix";
  readonly recoveryRateUnit: "per-second";
  readonly associationRecoveryRateUnit: "per-second";
}

/** The only writable physical-time domain for the Stage 5 Minecraft model. */
export interface ExperiencedCognitiveTimeV1 {
  readonly version: "ExperiencedCognitiveTimeV1";
  readonly timeDomain: "active-cognitive-seconds";
  readonly activeSeconds: number;
  readonly currentBridgeSessionId: string | null;
  readonly lastCompleteFrameNumber: number;
  readonly lastCompleteFrameSha256: string | null;
  readonly calibrationSha256: string;
  readonly advanceSequence: number;
  readonly lastIdempotencyTokenSha256: string | null;
}

export interface CognitiveTimeAdvanceV1 {
  readonly version: "CognitiveTimeAdvanceV1";
  readonly bridgeSessionId: string;
  readonly cognitiveFrameNumber: number;
  readonly cognitiveFrameSha256: string;
  readonly rawFrameManifestSha256: string;
  readonly calibrationSha256: string;
  readonly rawTickCount: number;
  readonly elapsedSeconds: number;
  readonly continuity: "complete-contiguous";
  readonly idempotencyTokenSha256: string;
}

export interface KairosPhysicalRuntimeInvariantsV1 {
  readonly version: "KairosPhysicalRuntimeInvariantsV1";
  readonly timeDomain: "active-cognitive-seconds";
  readonly modelExperiencedSeconds: number;
  readonly r1Seconds: number;
  readonly r2Seconds: number;
  readonly coactivationSeconds: number;
  readonly r2aGraphSeconds: number;
  readonly r2aMediumSeconds: number;
  readonly synchronized: boolean;
}

export interface KairosCheckpointV2 {
  readonly version: "KairosCheckpointV2";
  readonly randomSeedHex: string;
  readonly trainingCursor: {
    readonly bootstrapExperiences: number;
    readonly continualExperiences: number;
    readonly totalExperiences: number;
  };
  readonly representation: {
    readonly projector: PathProjectorStateV1;
    readonly tokenEncoder: TokenFieldEncoderStateV2;
    readonly hash: string;
  };
  readonly store: ExperienceStoreCheckpointV2;
  readonly experienceMap: ExperienceMapStateV2;
  readonly causalContrast: CausalContrastStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/** Clean production checkpoint for the open-factor R2A. V2 is audit-only. */
export interface KairosCheckpointV3 {
  readonly version: "KairosCheckpointV3";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: KairosCheckpointV2["representation"];
  readonly store: ExperienceStoreCheckpointV2;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/** Writable checkpoint for independent R1 event space. V1-V3 remain audit-only. */
export interface KairosCheckpointV4 {
  readonly version: "KairosCheckpointV4";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: KairosCheckpointV2["representation"] & {
    readonly r1EventCodec: R1EventCodecStateV1 | null;
  };
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/**
 * Writable checkpoint for the single frozen Minecraft R1 event map.  V4 is
 * deliberately not migrated: a V5 instance must be rebuilt from the original
 * trusted public events under one qualified bundle.
 */
export interface KairosCheckpointV5 {
  readonly version: "KairosCheckpointV5";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: KairosCheckpointV2["representation"] & {
    readonly r1EventCodecBundle: R1EventCodecBundleV2;
  };
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/** Production checkpoint whose single R1 map is bound to independently replayed raw evidence. */
export interface KairosCheckpointV6 {
  readonly version: "KairosCheckpointV6";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: KairosCheckpointV2["representation"] & {
    readonly r1EventCodecBundle: R1EventCodecBundleV2;
    readonly r1EventMapQualificationAttestation: R1EventMapQualificationAttestationV1;
  };
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/**
 * Historical active-cognitive-seconds checkpoint. V7 is audit-only after the
 * physical R2 resolution and basin-membership correction because it contains
 * neither the calibrated PathProjector V2 unit nor R2 visit identities in its
 * factor graph.
 */
export interface KairosCheckpointV7 {
  readonly version: "KairosCheckpointV7";
  readonly timeDomain: "active-cognitive-seconds";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly experiencedTime: ExperiencedCognitiveTimeV1;
  readonly physicalRuntimeInvariants: KairosPhysicalRuntimeInvariantsV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: KairosCheckpointV6["representation"];
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV2;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/**
 * Historical checkpoint rebuilt under PathProjector V3. It is audit-only
 * after the global event-frame correction; no state is promoted from it.
 */
export interface KairosCheckpointV8 {
  readonly version: "KairosCheckpointV8";
  readonly timeDomain: "active-cognitive-seconds";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly experiencedTime: ExperiencedCognitiveTimeV1;
  readonly physicalRuntimeInvariants: KairosPhysicalRuntimeInvariantsV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: Omit<KairosCheckpointV6["representation"], "projector"> & {
    readonly projector: PathProjectorStateV3;
  };
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV3;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/** Writable checkpoint rebuilt from trusted raw events under the global
 * event measurement frame and current physical-basin result identity. */
export interface KairosCheckpointV9 {
  readonly version: "KairosCheckpointV9";
  readonly timeDomain: "active-cognitive-seconds";
  readonly mediumTimeContract: MediumTimeContractV1;
  readonly experiencedTime: ExperiencedCognitiveTimeV1;
  readonly physicalRuntimeInvariants: KairosPhysicalRuntimeInvariantsV1;
  readonly randomSeedHex: string;
  readonly trainingCursor: KairosCheckpointV2["trainingCursor"];
  readonly representation: Omit<KairosCheckpointV6["representation"], "projector"> & {
    readonly projector: PathProjectorStateV4;
  };
  readonly store: ExperienceStoreCheckpointV3;
  readonly experienceMap: ExperienceMapStateV2;
  readonly openCausalFactorGraph: CausalFactorGraphStateV3;
  readonly audit: LeakageAudit;
  readonly rejections: FirewallRejections;
}

/** Ordered replay proof for a clean writable build. Completed-frame entries advance
 * every physical clock; experience entries deposit at that exact current
 * cognitive time. */
export type TrustedCognitiveReplayEntryV1 = Readonly<
  | { readonly version: "TrustedCognitiveReplayEntryV1"; readonly kind: "completed-frame";
      readonly advance: CognitiveTimeAdvanceV1 }
  | { readonly version: "TrustedCognitiveReplayEntryV1"; readonly kind: "trusted-experience";
      readonly experienceIndex: number }
>;

export interface QueryContribution {
  readonly coactivationId: string;
  readonly r1Trace: R1TraceReference;
  readonly r2Activation: number;
  readonly r3CausalScore: number;
  readonly causalMultiplier: number;
  readonly matchedRelationIds: readonly string[];
  readonly coactivationStrength: number;
  readonly weight: number;
}

export interface R3FactorMatch {
  readonly matchId: string;
  readonly relationId: string;
  readonly inputModeId: string;
  readonly inputPole: -1 | 1;
  /** Reliability of the stored relation itself, before query matching. */
  readonly relationReliability: number;
  readonly contextMatch: number;
  readonly residualMatch: number;
  /** Weakest-link applicability; distinct from signed outcome evidence. */
  readonly relationApplicability: number;
  readonly confidence: number;
}

export interface QueryResult {
  readonly contributions: readonly QueryContribution[];
  readonly r2Basins: readonly BasinActivation[];
  readonly r3Matches: readonly R3FactorMatch[];
}

export interface PredictionResult {
  readonly abstained: boolean;
  readonly reason: string | null;
  readonly selectedTraceId: string | null;
  readonly selectedPageId: string | null;
  readonly positions: readonly Vec3[];
  readonly acceptedSteps: number;
  readonly boundaryHits: number;
  readonly temporaryPageCount: number;
}

export interface PredictionWithQuery {
  readonly query: QueryResult;
  readonly prediction: PredictionResult;
  readonly evidence: PredictionQueryEvidenceV1 | PredictionQueryEvidenceV2;
}

export interface PredictionQueryEvidenceV1 {
  readonly version: "PredictionQueryEvidenceV1";
  /** Descriptor mass for hypothetical queries; R2 candidate concentration for factual queries. */
  readonly candidateMass: number;
  readonly querySpecificR2aApplicability: number;
  readonly coreEvidenceSupport: number;
}

/**
 * Audit evidence for an action-conditioned query.  None of these fields is a
 * calibrated probability.  Support is the weakest necessary physical link,
 * never the action's frequency among unrelated history.
 */
export interface PredictionQueryEvidenceV2 {
  readonly version: "PredictionQueryEvidenceV2";
  readonly eligibleHistoricalCount: number;
  readonly activeR1Count: number;
  readonly activeR2Count: number;
  readonly eligibleLinkCoverage: number;
  readonly distinctR2BasinCount: number;
  readonly r2IndependentSupport: number;
  readonly r2PhysicalSupport: number;
  readonly r2aMatchedCoverage: number;
  readonly relationReliability: number;
  readonly contextMatch: number;
  readonly residualMatch: number;
  readonly querySpecificR2aApplicability: number;
  readonly conditionalWeightConcentration: number;
  readonly coreEvidenceSupport: number;
  readonly calibratedProbability: false;
}

/** Opaque references supplied by the external action ledger; no result data. */
export interface ActionConditionedTraceReference {
  readonly pageId: string;
  readonly traceId: string;
  readonly experienceAnchorId: string;
}

export interface VisualizationAssociation {
  readonly coactivationId: string;
  readonly r1Trace: R1TraceReference;
  readonly r2Coordinate: Vec3;
  readonly experienceAnchorId: string;
  readonly currentStrength: number;
  readonly r1Active: boolean;
}

export interface ContrastVisualization {
  readonly relationCount: number;
  readonly selectedRelation: ContrastRelationState | null;
  readonly r3Matches: readonly R3FactorMatch[];
  readonly contributionScores: readonly {
    readonly coactivationId: string;
    readonly r2Activation: number;
    readonly r3CausalScore: number;
    readonly causalMultiplier: number;
    readonly weight: number;
  }[];
}

export interface VisualizationFrame {
  readonly capturedAt: number;
  readonly r1: MediumSnapshot;
  readonly r2: MediumSnapshot;
  readonly r1SelectedPageId: string | null;
  readonly r1CurrentPosition: Vec3;
  readonly r2QueryPoint: Vec3 | null;
  readonly r2Basins: readonly BasinActivation[];
  readonly r2aContrast: ContrastVisualization;
  readonly r2aOpenGraph?: {
    readonly physicalMedium: MediumSnapshot;
    readonly factorNodes: readonly CausalFactorNodeV2[];
    readonly hyperedges: readonly CausalHyperedgeV2[];
    readonly motifs: readonly FactorMotifV1[];
  };
  readonly associations: readonly VisualizationAssociation[];
  readonly prediction: readonly Vec3[];
  readonly notice: "coordinates-are-independent";
}

export interface LeakageAudit {
  simulatorPrivateReads: number;
  futureObservationReads: number;
  semanticRuleOrResultReads: number;
  directTargetOutputs: number;
  predictionWriteBacks: number;
  admittedPredictionWrites: number;
  exactTrainingTrajectoryCopies: number;
}

export interface FirewallRejections {
  simulatorPrivate: number;
  futureObservation: number;
  semanticRuleOrResult: number;
  nonPublic: number;
  nonCausal: number;
  nonActual: number;
  predictionMutation: number;
}
