import type { DistributedPhysicalEvidenceReferenceV3, DistributedPredictionSampleV3,
  DistributedPredictionV3 } from '../src/core/prediction/distributed-reasoning-contracts.js';

export function distributedEvidenceFixtureV3(id = 'fixture', options: {
  readonly active?: boolean;
  readonly productionEligible?: boolean;
  readonly predictionEligible?: boolean;
  readonly applicability?: number;
  readonly relationIds?: readonly string[];
  readonly patternIds?: readonly string[];
} = {}): DistributedPhysicalEvidenceReferenceV3 {
  const active = options.active ?? true;
  const productionEligible = options.productionEligible ?? active;
  return { version: 'DistributedPhysicalEvidenceReferenceV3', eventId: `event:${id}`,
    experienceTraceId: `r1-trace:${id}`,
    r1: { active, footprintTraceIds: [`r1-trace:${id}`], supportStrength: active ? .9 : 0,
      attractorId: active ? `r1-attractor:${id}` : null, returnRate: active ? .9 : 0,
      escapeRate: active ? .1 : 1 },
    r2: { active, footprintTraceIds: active ? [`r2-trace:${id}`] : [],
      supportStrength: active ? .85 : 0, corridorId: active ? `r2-corridor:${id}` : null },
    r2a: { active, footprintTraceIds: active ? [`r2a-trace:${id}`] : [],
      supportStrength: active ? .8 : 0, patternIds: [...(options.patternIds ?? [`pattern:${id}`])],
      relationIds: [...(options.relationIds ?? [`relation:${id}`])],
      branchSelectionStrength: options.applicability ?? (active ? .8 : 0),
      applicability: options.applicability ?? (active ? .8 : 0), productionEligible,
      predictionEligible: options.predictionEligible ?? productionEligible,
      evidenceGrade: productionEligible ? 'intervention-supported' : 'single-observation' } };
}

export function distributedPredictionSampleFixtureV3(seed = 1,
  assemblyId = 'assembly:fixture'): DistributedPredictionSampleV3 {
  return { version: 'DistributedPredictionSampleV3', seed, status: 'reached',
    reason: 'reached-readout-assembly', fieldSteps: 180, acceptedSteps: 120, rejectedSteps: 60,
    leaderSiteIds: [7, 8], attractorCoreSiteIds: [7, 8], attractorDwellSteps: 32,
    attractorReturnRate: .9, attractorEscapeRate: .1,
    reaches: [{ assemblyId, reachedFraction: .9, purity: .9, residenceScore: .81,
      visitedSiteIds: [7, 8], changes: [] }] };
}

export function distributedPredictionFixtureV3(
  evidence: DistributedPhysicalEvidenceReferenceV3 | null,
  samples: readonly DistributedPredictionSampleV3[] = [],
): DistributedPredictionV3 {
  return { version: 'DistributedPredictionV3', kind: 'hypothetical-prediction', support: .8,
    calibratedProbability: false, samples, evidence, unknown: [], substrateSha256: 'fixture-substrate' };
}
