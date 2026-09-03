/**
 * Historical point/page DTOs retained only so sealed pre-distributed audit
 * code can still be compiled and inspected. Production entry points must not
 * import this module.
 */
import type { Prediction } from '../contracts.js';
import type { EffectRecallCandidateV1, OpaqueFactorTransitionTraceV1, BranchPredictionV1,
  ContinuationPredictionV2 } from '../control/contracts.js';
import type { DistributedPhysicalEvidenceReferenceV3 }
  from '../core/prediction/distributed-reasoning-contracts.js';

export interface LegacyPhysicalEvidenceReferenceV1 {
  readonly eventId: string;
  readonly anchorId: string;
  readonly r1: { readonly pageId: string; readonly traceId: string; readonly active: boolean };
  readonly r2: { readonly coordinate: readonly number[]; readonly active: boolean;
    readonly basin?: { readonly pageId: string; readonly queriedTraceId?: string;
      readonly memberTraceIds?: readonly string[]; readonly memberVisitIds: readonly string[] } };
  readonly r2a: { readonly relationIds: readonly string[]; readonly applicability: number;
    readonly productionEligible: boolean;
    readonly evidenceGrade?: 'single-observation' | 'repeated-correlation' | 'predictive-stable'
      | 'causal-hypothesis' | 'intervention-supported';
    readonly predictionEligible?: boolean };
}
export type LegacyEffectRecallCandidateV1 = EffectRecallCandidateV1<LegacyPhysicalEvidenceReferenceV1>;
export type LegacyOpaqueFactorTransitionTraceV1 = OpaqueFactorTransitionTraceV1<LegacyPhysicalEvidenceReferenceV1>;
export type LegacyBranchPredictionV1 = BranchPredictionV1<LegacyPhysicalEvidenceReferenceV1, Prediction>;
export type LegacyContinuationPredictionV2 = ContinuationPredictionV2<Prediction['samples'][number]>;

/** Read-only identity translation for sealed audit fixtures. It deliberately
 * exposes no attractor/corridor strength that the distributed substrates did
 * not measure, so legacy evidence cannot unlock production execution. */
export function legacyEvidenceAsInactiveDistributedAuditV3(
  value: LegacyPhysicalEvidenceReferenceV1,
): DistributedPhysicalEvidenceReferenceV3 {
  return { version: 'DistributedPhysicalEvidenceReferenceV3', eventId: value.eventId,
    experienceTraceId: value.r1.traceId,
    r1: { active: false, footprintTraceIds: [value.r1.traceId], supportStrength: 0,
      attractorId: null, returnRate: 0, escapeRate: 1 },
    r2: { active: false,
      footprintTraceIds: value.r2.basin?.queriedTraceId ? [value.r2.basin.queriedTraceId] : [],
      supportStrength: 0, corridorId: null },
    r2a: { active: false, footprintTraceIds: [], supportStrength: 0,
      patternIds: [], relationIds: [...value.r2a.relationIds], branchSelectionStrength: 0,
      applicability: 0, productionEligible: false, predictionEligible: false,
      evidenceGrade: value.r2a.evidenceGrade ?? 'single-observation' } };
}

export function legacyCandidateAsInactiveDistributedAuditV3(
  value: LegacyEffectRecallCandidateV1,
): EffectRecallCandidateV1 {
  return { ...structuredClone({ ...value, evidence: undefined }),
    evidence: legacyEvidenceAsInactiveDistributedAuditV3(value.evidence) };
}

export function legacyTransitionAsInactiveDistributedAuditV3(
  value: LegacyOpaqueFactorTransitionTraceV1,
): OpaqueFactorTransitionTraceV1 {
  return { ...structuredClone({ ...value, evidence: undefined }),
    evidence: legacyEvidenceAsInactiveDistributedAuditV3(value.evidence) };
}
