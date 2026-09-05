export type MetaEvidenceGradeV1 = 'meta-repeated' | 'meta-predictive-stable'
  | 'meta-intervention-supported' | 'insufficient';

export interface MetaAuthorityDecisionV1 {
  readonly version: 'MetaAuthorityDecisionV1';
  readonly grade: MetaEvidenceGradeV1;
  readonly prospectiveValidation: boolean;
  readonly driveBias: number;
  readonly interventionEligible: boolean;
}

/** Fixed law caps; they are not caller-tunable per relation. */
export const META_PREDICTIVE_AUTHORITY_CAP_V1 = 0.10;
export const META_INTERVENTION_AUTHORITY_CAP_V1 = 0.20;

/**
 * Map an already qualified meta grade to a bounded control-field bias.  During
 * prospective validation the authority is exactly zero: a rule may be tested
 * without being allowed to alter behaviour.  This helper does not grade a
 * relation and does not touch world evidence.
 */
export function metaAuthorityDecisionV1(grade: MetaEvidenceGradeV1,
  prospectiveValidation = false): MetaAuthorityDecisionV1 {
  const driveBias = prospectiveValidation ? 0
    : grade === 'meta-intervention-supported' ? META_INTERVENTION_AUTHORITY_CAP_V1
      : grade === 'meta-predictive-stable' ? META_PREDICTIVE_AUTHORITY_CAP_V1 : 0;
  return { version: 'MetaAuthorityDecisionV1', grade, prospectiveValidation, driveBias,
    interventionEligible: !prospectiveValidation && grade === 'meta-intervention-supported' };
}
