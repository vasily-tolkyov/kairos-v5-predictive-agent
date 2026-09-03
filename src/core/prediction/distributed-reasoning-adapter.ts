import type { PublicChange } from '../../contracts.js';
import type { DistributedTraceFootprintV1 } from '../physics/distributed-physical-contracts.js';
import type { DistributedPredictionCloneResultV2 } from './distributed-prediction-clone.js';
import type { DistributedEvidenceGradeV3, DistributedPhysicalEvidenceReferenceV3,
  DistributedPredictionSampleV3, DistributedPredictionV3 }
  from './distributed-reasoning-contracts.js';

/** Build native distributed evidence without manufacturing page/point fields. */
export function distributedEvidenceReferenceV1(input: {
  readonly eventId: string;
  readonly r1: DistributedTraceFootprintV1;
  readonly r1Active: boolean;
  readonly r2: DistributedTraceFootprintV1 | null;
  readonly r2Active: boolean;
  readonly relationIds: readonly string[];
  readonly applicability: number;
  readonly evidenceGrade: DistributedEvidenceGradeV3;
  readonly predictionEligible: boolean;
  readonly productionEligible: boolean;
  readonly r1AttractorId: string | null;
  readonly r1ReturnRate: number;
  readonly r1EscapeRate: number;
  readonly r1SupportStrength: number;
  readonly r2CorridorId: string | null;
  readonly r2SupportStrength: number;
  readonly patternIds: readonly string[];
  readonly r2aPhysicalTraceIds: readonly string[];
  readonly r2aSupportStrength: number;
}): DistributedPhysicalEvidenceReferenceV3 {
  return {
    version: 'DistributedPhysicalEvidenceReferenceV3', eventId: input.eventId,
    experienceTraceId: input.r1.traceId,
    r1: { active: input.r1Active, footprintTraceIds: [input.r1.traceId],
      supportStrength: input.r1SupportStrength, attractorId: input.r1AttractorId,
      returnRate: input.r1ReturnRate, escapeRate: input.r1EscapeRate },
    r2: { active: input.r2Active, footprintTraceIds: input.r2 ? [input.r2.traceId] : [],
      supportStrength: input.r2SupportStrength, corridorId: input.r2CorridorId },
    r2a: { active: input.r2aSupportStrength > 0,
      footprintTraceIds: [...input.r2aPhysicalTraceIds], supportStrength: input.r2aSupportStrength,
      patternIds: [...input.patternIds], relationIds: [...input.relationIds],
      branchSelectionStrength: input.applicability, applicability: input.applicability,
      productionEligible: input.productionEligible, predictionEligible: input.predictionEligible,
      evidenceGrade: input.evidenceGrade },
  };
}

/** Decode only assemblies physically reached by this stochastic field run. */
export function distributedPredictionSampleV1(seed: number,
  result: DistributedPredictionCloneResultV2,
  changesByAssembly: ReadonlyMap<string, readonly PublicChange[]>): DistributedPredictionSampleV3 {
  return {
    version: 'DistributedPredictionSampleV3', seed, status: result.status, reason: result.reason,
    fieldSteps: result.fieldRun.steps, acceptedSteps: result.fieldRun.acceptedSteps,
    rejectedSteps: result.fieldRun.rejectedSteps,
    leaderSiteIds: [...result.fieldRun.leaderSiteIds],
    attractorCoreSiteIds: [...result.attractorReadout.coreSiteIds],
    attractorDwellSteps: result.attractorReadout.dwellSteps,
    attractorReturnRate: result.attractorReadout.returnRate,
    attractorEscapeRate: result.attractorReadout.escapeRate,
    reaches: result.reaches.map(reach => ({ assemblyId: reach.assemblyId,
      reachedFraction: reach.reachedFraction, purity: reach.purity,
      residenceScore: reach.residenceScore, visitedSiteIds: [...reach.visitedSiteIds],
      changes: structuredClone(changesByAssembly.get(reach.assemblyId) ?? []) })),
  };
}

export function emptyDistributedPredictionV1(kind: DistributedPredictionV3['kind'], reason: string,
  evidence: DistributedPhysicalEvidenceReferenceV3 | null,
  substrateSha256: string | null): DistributedPredictionV3 {
  return { version: 'DistributedPredictionV3', kind, support: 0, calibratedProbability: false,
    samples: [], evidence, unknown: [reason], substrateSha256 };
}
