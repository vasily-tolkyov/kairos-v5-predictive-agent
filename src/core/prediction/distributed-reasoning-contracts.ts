import type { PublicChange } from '../../contracts.js';

export type DistributedEvidenceGradeV3 = 'single-observation' | 'repeated-correlation'
  | 'predictive-stable' | 'causal-hypothesis' | 'intervention-supported';

export interface DistributedPhysicalLayerEvidenceV3 {
  readonly active: boolean;
  readonly footprintTraceIds: readonly string[];
  /** Measured normalized physical support, never a metadata count. */
  readonly supportStrength: number;
}

/**
 * Native evidence crossing the distributed reasoning boundary.  Every field
 * names an actual distributed footprint or field readout.  There is no page,
 * point coordinate, visit, kernel, or legacy trace carrier in this contract.
 */
export interface DistributedPhysicalEvidenceReferenceV3 {
  readonly version: 'DistributedPhysicalEvidenceReferenceV3';
  readonly eventId: string;
  readonly experienceTraceId: string;
  readonly r1: DistributedPhysicalLayerEvidenceV3 & {
    readonly attractorId: string | null;
    readonly returnRate: number;
    readonly escapeRate: number;
  };
  readonly r2: DistributedPhysicalLayerEvidenceV3 & {
    readonly corridorId: string | null;
  };
  readonly r2a: DistributedPhysicalLayerEvidenceV3 & {
    readonly patternIds: readonly string[];
    readonly relationIds: readonly string[];
    readonly branchSelectionStrength: number;
    readonly applicability: number;
    readonly productionEligible: boolean;
    readonly predictionEligible: boolean;
    readonly evidenceGrade: DistributedEvidenceGradeV3;
  };
}

export interface DistributedPredictionAssemblyReadoutV3 {
  readonly assemblyId: string;
  readonly reachedFraction: number;
  readonly purity: number;
  readonly residenceScore: number;
  readonly visitedSiteIds: readonly number[];
  readonly changes: readonly PublicChange[];
}

/** One stochastic field run. Site ids identify substrate state; they are not a
 * polyline and cannot be interpreted as world or legacy-medium positions. */
export interface DistributedPredictionSampleV3 {
  readonly version: 'DistributedPredictionSampleV3';
  readonly seed: number;
  readonly status: 'reached' | 'unknown' | 'ambiguous';
  readonly reason: string;
  readonly fieldSteps: number;
  readonly acceptedSteps: number;
  readonly rejectedSteps: number;
  readonly leaderSiteIds: readonly number[];
  readonly attractorCoreSiteIds: readonly number[];
  readonly attractorDwellSteps: number;
  readonly attractorReturnRate: number;
  readonly attractorEscapeRate: number;
  readonly reaches: readonly DistributedPredictionAssemblyReadoutV3[];
}

export interface DistributedPredictionV3 {
  readonly version: 'DistributedPredictionV3';
  readonly kind: 'factual-prediction' | 'hypothetical-prediction';
  readonly support: number;
  readonly calibratedProbability: false;
  readonly samples: readonly DistributedPredictionSampleV3[];
  readonly evidence: DistributedPhysicalEvidenceReferenceV3 | null;
  readonly unknown: readonly string[];
  readonly substrateSha256: string | null;
}
