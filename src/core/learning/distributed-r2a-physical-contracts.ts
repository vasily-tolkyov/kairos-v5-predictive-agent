import type { DistributedAttractorReadoutV1, DistributedEvidenceLevelV1,
  DistributedMediumSnapshotV1, DistributedTraceFootprintV1 }
  from '../physics/distributed-physical-contracts.js';
import type { DistributedR2ContinuousEventV1 } from './distributed-r2-contracts.js';
import type { DistributedSiteDriveV1 } from './distributed-r1-contracts.js';
import type { SparseInterlayerProjectionStateV1 } from './sparse-interlayer-projection.js';

export type DistributedR2APhysicalEvidenceGradeV2 = Exclude<DistributedEvidenceLevelV1, 'none'>;

export interface DistributedR2APhysicalCorridorV2 {
  readonly orderedPrefixPulseSiteIds: readonly (readonly number[])[];
  /** Weighted populations that generated the compact site-id view.  The
   * latter remains for legacy read-only probes; production pattern assembly
   * carries these amplitudes forward instead of reconstituting unit drives. */
  readonly orderedPrefixPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly prefixSiteIds: readonly number[];
  readonly actionPulseSiteIds: readonly (readonly number[])[];
  readonly actionPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly actionSiteIds: readonly number[];
  readonly terminalCoreSiteIds: readonly number[];
  readonly corridorCoreSiteIds: readonly number[];
  readonly forwardPropagationRate: number;
  readonly reverseRejectionRate: number;
}

/** Assigned only after a physical attractor/corridor readout exists. */
export interface DistributedR2APhysicalPatternV2 {
  readonly version: 'DistributedR2APhysicalPatternV2';
  readonly patternId: string;
  readonly memberR2EventIds: readonly string[];
  readonly contextIds: readonly string[];
  readonly physicalTraceIds: readonly string[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly attractor: DistributedAttractorReadoutV1;
  readonly corridor: DistributedR2APhysicalCorridorV2;
  readonly grade: DistributedR2APhysicalEvidenceGradeV2;
}

/** A factor is a physically discovered condition population.  Signal ids are
 * output-decoder references only; they do not establish membership or grade. */
export interface DistributedR2APhysicalFactorV2 {
  readonly factorId: string;
  readonly sourceSignalIds: readonly string[];
  readonly sourceChannelIds: readonly string[];
  readonly afferentSiteIds: readonly number[];
  readonly coreSiteIds: readonly number[];
}

export interface DistributedR2APhysicalRelationV2 {
  readonly version: 'DistributedR2APhysicalRelationV2';
  readonly relationId: string;
  readonly patternId: string;
  readonly factors: readonly DistributedR2APhysicalFactorV2[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly matchedInterventionCount: number;
  readonly physicallyCorrectInterventionCount: number;
  readonly meanFullFactorSelectionRate: number;
  /** Branch selectivity against another actually observed state of the same
   * public factor channel.  This is distinct from making the factor unknown. */
  readonly stateContrastSelectionLoss: number;
  /** Selection loss when the entire factor channel is absent/unknown. */
  readonly meanFactorAblationLoss: number;
  readonly grade: DistributedR2APhysicalEvidenceGradeV2;
  readonly physicalTraceIds: readonly string[];
}

/** Caller supplies only two real event references.  Pair identity, the changed
 * physical factor, branch membership and ablation measurements are derived. */
export interface DistributedR2AInterventionPairV2 {
  readonly version: 'DistributedR2AInterventionPairV2';
  readonly baselineR2EventId: string;
  readonly interventionR2EventId: string;
}

export interface DistributedR2AInterventionAssessmentV2 extends DistributedR2AInterventionPairV2 {
  /** All three identities are derived after resolving the two real traces. */
  readonly pairId: string;
  readonly relationId: string;
  readonly changedFactorId: string;
  readonly otherObservedChannelsMatched: boolean;
  readonly manipulatedFactorActuallyChanged: boolean;
  readonly interventionReachedRelationBranch: boolean;
  readonly fullFactorSelectionRate: number;
  readonly factorAblationSelectionRate: number;
  readonly factorAblationLoss: number;
}

/** Pure aggregate of already revalidated physical intervention probes.  It
 * contains no event/result labels and cannot create a relation by itself. */
export interface DistributedR2AInterventionAggregateV2 {
  readonly matchedInterventionCount: number;
  readonly physicallyCorrectInterventionCount: number;
  readonly meanFullFactorSelectionRate: number;
  readonly meanFactorAblationLoss: number;
  readonly grade: DistributedR2APhysicalEvidenceGradeV2;
}

export interface DistributedR2AAnonymousPhysicalBranchV2 {
  readonly version: 'DistributedR2AAnonymousPhysicalBranchV2';
  readonly branchId: string;
  /** Dynamically measured residence core; this is the branch identity. */
  readonly attractor: DistributedAttractorReadoutV1;
  /**
   * Optional higher-order assembly provenance from the physical terminal
   * readout.  These fields are evidence about the anonymous population, not
   * semantic/result labels.  Coverage and resonance remain readout quality
   * measures; the opaque assembly id is what keeps two populations that happen
   * to settle into the same local core from being merged.
   */
  readonly coactivationAssemblyId?: string;
  readonly coactivationCoverage?: number;
  readonly coactivationResonance?: number;
  /** Larger connected substrate region, retained only for topology/leakage. */
  readonly topologicalEnvelopeSiteIds: readonly number[];
  readonly incomingConductance: number;
  readonly outgoingConductance: number;
  readonly terminalUnderCurrentChannels: boolean;
}

export interface DistributedR2APhysicalBranchProbeInputV2 {
  readonly currentConditionSiteIds: readonly number[];
  /** Optional weighted form used by new callers; omitted means unit ids. */
  readonly currentConditionDrives?: readonly DistributedSiteDriveV1[];
  readonly realPrefixPulseSiteIds: readonly (readonly number[])[];
  readonly realPrefixPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly actionSiteIds: readonly number[];
  readonly actionDrives?: readonly DistributedSiteDriveV1[];
}

export interface DistributedR2APhysicalBranchProbeResultV2 {
  readonly version: 'DistributedR2APhysicalBranchProbeResultV2';
  readonly branchId: string;
  readonly selectionRate: number;
  readonly validSampleCount: number;
  readonly ambiguous: boolean;
}

export interface DistributedR2APhysicalApplicabilityV2 {
  readonly version: 'DistributedR2APhysicalApplicabilityV2';
  readonly relationId: string;
  readonly matchedFactorIds: readonly string[];
  readonly contradictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly applicability: number;
  readonly evidenceGrade: DistributedR2APhysicalEvidenceGradeV2;
  readonly predictionEligible: boolean;
  readonly highConfidenceActionEligible: boolean;
  readonly physicalSupportActive: boolean;
  readonly physicalBranchSelectionRate: number;
}

/**
 * Read-only R3 projection of a sparse, physically decoded hypothetical
 * terminal.  A factor is known-active only when the decoded public signal
 * also drives its learned R2A branch through the real field.  Missing decoder
 * channels never inherit values from the current observation.
 */
export interface DistributedR2ATransientFactorProjectionV2 {
  readonly version: 'DistributedR2ATransientFactorProjectionV2';
  readonly relationIds: readonly string[];
  readonly knownActiveFactorIds: readonly string[];
  readonly knownInactiveFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly physicallySelectedRelationIds: readonly string[];
}

export interface DistributedR2AConditionBindingV2 {
  readonly signalId: string;
  readonly siteIds: readonly number[];
  readonly observationCount: number;
}

export interface DistributedR2AEventPhysicalInputV2 {
  readonly eventId: string;
  /** Qualification metadata captured with the deposited physical input.  The
   * anonymous terminal population is also a passive measurement mask for
   * nested high-order assemblies that pairwise site/bond topology cannot
   * reconstruct uniquely.  It never seeds prediction; deleting it may remove
   * that high-order readout index but cannot preserve capability without the
   * underlying physical field. */
  readonly contextIds: readonly string[];
  readonly conditionSignalIds: readonly string[];
  readonly conditionSiteIds: readonly number[];
  /** Weighted condition population used for this event. */
  readonly conditionDrives?: readonly DistributedSiteDriveV1[];
  readonly actionSiteIds: readonly number[];
  readonly actionPulseSiteIds: readonly (readonly number[])[];
  readonly actionPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly projectedPulseSiteIds: readonly (readonly number[])[];
  /** Exact amplitudes emitted by the R2→R2A sparse projection. */
  readonly projectedPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  /** Real R2 populations observed before the final candidate action began.
   * This is captured at deposition time from atomPulseRanges so later physical
   * rediscovery never has to mistake an incoming condition/eligibility channel
   * for the event's actual continuation prefix. */
  readonly nextActionPrefixPulseSiteIds: readonly (readonly number[])[];
  readonly nextActionPrefixPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  /**
   * Exact ordered physical route up to and including the final action.  The
   * first pulse is the held condition; unlike terminalPulse*, this sequence
   * is a reachable continuation seed and contains no post-action result.
   * It is optional for old snapshots and is reconstructed conservatively when
   * absent.
   */
  readonly reachableContinuationPulseSiteIds?: readonly (readonly number[])[];
  readonly reachableContinuationPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly episodePulseSiteIds: readonly (readonly number[])[];
  /** Full weighted R2A event pulse stream, including condition/action wires. */
  readonly episodePulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  readonly terminalPulseSiteIds: readonly number[];
  readonly terminalPulseDrives?: readonly DistributedSiteDriveV1[];
  readonly traceId: string;
}

export interface DistributedR2APhysicalIndexIdentityV1 {
  readonly version: 'DistributedR2APhysicalIndexIdentityV1';
  /** The implementation identity is part of the derivation basis.  A later
   * reader cannot silently treat a changed physical readout algorithm as the
   * same checkpoint cache. */
  readonly algorithmIdentity: string;
  /** Hash of the resting lattice, physical afferents, event populations,
   * active lower-layer support and matched intervention pair inputs. */
  readonly physicalIndexInputsSha256: string;
  /** Hash of the derived, read-only pattern/relation/intervention index. */
  readonly physicalIndexStateSha256: string;
}

export interface DistributedR2APhysicalStateV3 {
  readonly version: 'DistributedR2APhysicalStateV3';
  readonly seedHex: string;
  readonly conditionAllocationSequence: number;
  readonly projection: SparseInterlayerProjectionStateV1;
  readonly conditionBindings: readonly DistributedR2AConditionBindingV2[];
  readonly actionBindings: readonly DistributedR2AConditionBindingV2[];
  readonly patterns: readonly DistributedR2APhysicalPatternV2[];
  readonly relations: readonly DistributedR2APhysicalRelationV2[];
  readonly interventions: readonly DistributedR2AInterventionAssessmentV2[];
  readonly eventInputs: readonly DistributedR2AEventPhysicalInputV2[];
  readonly evidenceEvents: readonly DistributedR2ContinuousEventV1[];
  readonly physicalIndexIdentity: DistributedR2APhysicalIndexIdentityV1;
  readonly medium: DistributedMediumSnapshotV1;
}

/**
 * A transient status view for the explicit R2A consolidation batch boundary.
 * Consolidation is intentionally not part of the persistent physical state:
 * callers must close a batch before taking a checkpoint so a pending derived
 * index can never be mistaken for committed physical evidence.
 */
export interface DistributedR2AConsolidationBatchStatusV1 {
  readonly version: 'DistributedR2AConsolidationBatchStatusV1';
  readonly active: boolean;
  readonly pending: boolean;
  readonly deferredBoundaryCount: number;
}

/** Result returned when an explicit consolidation batch is closed. */
export interface DistributedR2AConsolidationBatchReceiptV1 {
  readonly version: 'DistributedR2AConsolidationBatchReceiptV1';
  readonly deferredBoundaryCount: number;
  readonly consolidated: boolean;
}

/** Read-only performance counter for bounded batch diagnostics. */
export interface DistributedR2AConsolidationPerformanceAuditV1 {
  readonly version: 'DistributedR2AConsolidationPerformanceAuditV1';
  readonly consolidationPassCount: number;
}

export type DistributedR2APhysicalObservationReceiptV2 = {
  readonly version: 'DistributedR2APhysicalObservationReceiptV2';
  readonly status: 'physical-pattern-observed';
  readonly pattern: DistributedR2APhysicalPatternV2;
  readonly relationIds: readonly string[];
  readonly depositedFootprint: DistributedTraceFootprintV1;
} | {
  readonly version: 'DistributedR2APhysicalObservationReceiptV2';
  readonly status: 'no-qualified-physical-attractor';
  readonly pattern: null;
  readonly relationIds: readonly [];
  readonly depositedFootprint: DistributedTraceFootprintV1;
};
