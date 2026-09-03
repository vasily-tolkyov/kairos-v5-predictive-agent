import type { DistributedEvidenceLevelV1, DistributedMediumSnapshotV1,
  DistributedTraceFootprintV1 } from '../physics/distributed-physical-contracts.js';

export type DistributedR2AEvidenceGradeV1 = Exclude<DistributedEvidenceLevelV1, 'none'>;

export interface DistributedR2AStablePatternV1 {
  readonly version: 'DistributedR2AStablePatternV1';
  readonly patternId: string;
  readonly actionFamilyId: string;
  readonly memberR2EventIds: readonly string[];
  readonly orderedExperienceIdentities: readonly string[];
  readonly prototypePulseSiteIds: readonly (readonly number[])[];
  readonly contextIds: readonly string[];
  /** Opaque pre-branch afferent identities for deterministic replay/continued learning. */
  readonly memberBeforeSignalIds: readonly (readonly string[])[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly orderedCorridorConsistency: number;
  readonly grade: DistributedR2AEvidenceGradeV1;
  readonly physicalTraceIds: readonly string[];
}

export interface DistributedR2AFactorRelationV1 {
  readonly version: 'DistributedR2AFactorRelationV1';
  readonly relationId: string;
  readonly patternId: string;
  readonly factorIds: readonly string[];
  readonly factorSignalIds: readonly string[];
  /** Opaque sensor-channel identities.  They distinguish an observed
   * conflicting value from a factor whose public channel is absent. */
  readonly factorChannelIds: readonly string[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly matchedInterventionCount: number;
  readonly matchedInterventionSuccessCount: number;
  readonly deletionSelectionDrop: number;
  readonly grade: DistributedR2AEvidenceGradeV1;
  readonly physicalTraceIds: readonly string[];
}

export interface DistributedR2AInterventionEvidenceV1 {
  readonly version: 'DistributedR2AInterventionEvidenceV1';
  readonly pairId: string;
  readonly relationId: string;
  readonly changedFactorId: string;
  readonly baselineR2EventId: string;
  readonly interventionR2EventId: string;
  readonly matchedPublicContext: boolean;
  readonly onlyPlannedFactorChanged: boolean;
  readonly selectedExpectedBranch: boolean;
  readonly deletionSelectionDrop: number;
}

export interface DistributedR2AFactorApplicabilityV1 {
  readonly version: 'DistributedR2AFactorApplicabilityV1';
  readonly relationId: string;
  readonly matchedFactorIds: readonly string[];
  readonly contradictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly applicability: number;
  readonly evidenceGrade: DistributedR2AEvidenceGradeV1;
  readonly predictionEligible: boolean;
  readonly highConfidenceActionEligible: boolean;
  readonly physicalSupportActive: boolean;
}

export interface DistributedR2AProjectionBindingV1 {
  readonly signalId: string;
  readonly siteIds: readonly number[];
  readonly observationCount: number;
}

export interface DistributedR2APhysicalStateV1 {
  readonly version: 'DistributedR2APhysicalStateV1';
  readonly seedHex: string;
  readonly allocationSequence: number;
  readonly bindings: readonly DistributedR2AProjectionBindingV1[];
  readonly patterns: readonly DistributedR2AStablePatternV1[];
  readonly relations: readonly DistributedR2AFactorRelationV1[];
  readonly interventions: readonly DistributedR2AInterventionEvidenceV1[];
  /** Complete trusted R2 evidence required to validate later matched interventions. */
  readonly evidenceEvents: readonly import('./distributed-r2-contracts.js').DistributedR2ContinuousEventV1[];
  readonly medium: DistributedMediumSnapshotV1;
}

export interface DistributedR2AObservationReceiptV1 {
  readonly version: 'DistributedR2AObservationReceiptV1';
  readonly pattern: DistributedR2AStablePatternV1;
  readonly relationIds: readonly string[];
  readonly depositedFootprint: DistributedTraceFootprintV1;
}
