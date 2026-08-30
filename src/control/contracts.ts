import type { Action, ActionCue, Observation, Prediction, PublicChange, PublicValue } from '../contracts.js';

export type GroundedSubjectV1 =
  | { readonly kind: 'self' }
  | { readonly kind: 'crosshair' }
  | { readonly kind: 'public-object'; readonly id: string; readonly expectedType: string };

export type PublicObservableV1 =
  | 'position.0' | 'position.1' | 'position.2' | 'yaw' | 'pitch' | 'type' | 'visible'
  | `relativePosition.${0 | 1 | 2}` | `properties.${string}`;

interface GoalPredicateBaseV1 {
  readonly version: 'GoalPredicateV1';
  readonly id: string;
  readonly subject: GroundedSubjectV1;
  readonly observable: PublicObservableV1;
}
export type GoalPredicateV1 =
  | (GoalPredicateBaseV1 & { readonly comparator: 'equals' | 'not-equals'; readonly target: PublicValue })
  | (GoalPredicateBaseV1 & { readonly comparator: 'greater-than' | 'less-than'; readonly target: number; readonly tolerance?: number })
  | (GoalPredicateBaseV1 & { readonly comparator: 'within'; readonly lower: number; readonly upper: number })
  | (GoalPredicateBaseV1 & { readonly comparator: 'increase' | 'decrease'; readonly minimumDelta: number });

export type GoalExpressionV1 =
  | { readonly kind: 'predicate'; readonly predicate: GoalPredicateV1 }
  | { readonly kind: 'all' | 'any'; readonly children: readonly GoalExpressionV1[] };

export interface GroundedGoalV1 {
  readonly version: 'GroundedGoalV1';
  readonly id: string;
  readonly expression: GoalExpressionV1;
}

export interface PredicateEvaluationV1 {
  readonly predicateId: string;
  readonly status: 'satisfied' | 'mismatch' | 'unknown';
  readonly residual: number;
  readonly actual: PublicValue | number | null;
  readonly baseline: PublicValue | number | null;
  readonly reason: string | null;
}
export interface GoalEvaluationV1 {
  readonly goalId: string;
  readonly status: 'satisfied' | 'mismatch' | 'unknown';
  readonly residual: number;
  readonly observationSequence: number;
  readonly predicates: readonly PredicateEvaluationV1[];
}

export interface ActionOfferV1 {
  readonly version: 'ActionOfferV1';
  readonly offerId: string;
  readonly observationSequence: number;
  readonly action: Action;
  readonly cue: ActionCue;
}

export type PublicActionRequirementKindV1 =
  | 'public-crosshair-block'
  | 'public-crosshair-entity'
  | 'public-held-item';

/**
 * A body's machine-verifiable public precondition for one learned cue.
 * `goal` says only which public fact is missing; it never says how to make
 * that fact true.  The latter must come back through physical recall.
 */
export interface PublicActionRequirementV1 {
  readonly version: 'PublicActionRequirementV1';
  readonly actionCue: ActionCue;
  readonly observationSequence: number;
  readonly satisfied: boolean;
  readonly required: readonly PublicActionRequirementKindV1[];
  readonly missing: readonly PublicActionRequirementKindV1[];
  readonly goal: GroundedGoalV1 | null;
  readonly targetBinding: {
    readonly objectId: string;
    readonly objectType: string;
    readonly publicKind: 'block' | 'entity';
    readonly observationSequence: number;
  } | null;
}

export interface PhysicalEvidenceReferenceV1 {
  readonly eventId: string;
  readonly anchorId: string;
  readonly r1: { readonly pageId: string; readonly traceId: string; readonly active: boolean };
  readonly r2: { readonly coordinate: readonly number[]; readonly active: boolean };
  readonly r2a: { readonly relationIds: readonly string[]; readonly applicability: number; readonly productionEligible: boolean };
}

export interface EffectRecallCandidateV1 {
  readonly candidateId: string;
  readonly goalPredicateIds: readonly string[];
  readonly actionCue: ActionCue;
  readonly observedChanges: readonly PublicChange[];
  readonly observedBefore: Readonly<Record<string, number>>;
  readonly evidence: PhysicalEvidenceReferenceV1;
  readonly unknown: readonly string[];
}

export interface OpaqueFactorTransitionTraceV1 {
  readonly version: 'OpaqueFactorTransitionTraceV1';
  readonly transitionId: string;
  readonly eventId: string;
  readonly actionCue: ActionCue;
  readonly activatedFactorIds: readonly string[];
  readonly deactivatedFactorIds: readonly string[];
  readonly unchangedActiveFactorIds: readonly string[];
  readonly evidence: PhysicalEvidenceReferenceV1;
  readonly meaning: 'observed-factor-transition';
}

export interface ConditionApplicabilityV1 {
  readonly matchedFactorIds: readonly string[];
  readonly contradictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly applicability: number;
  readonly productionEligible: boolean;
}

export interface HypotheticalPublicStateV1 {
  readonly version: 'HypotheticalPublicStateV1';
  readonly baseObservationSequence: number;
  readonly knownChanges: readonly PublicChange[];
  readonly knownActiveFactorIds: readonly string[];
  readonly knownInactiveFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly unobserved: 'unknown';
}

export interface BranchPredictionV1 {
  readonly prediction: Prediction;
  /** Optional evidence re-observed by the prediction query at its base sequence.
   * When present it is authoritative for execution hard gates; the historical
   * recall evidence remains provenance, not a claim about the current medium. */
  readonly currentEvidence?: PhysicalEvidenceReferenceV1;
  readonly validSampleCount: number;
  readonly progressSampleCount: number;
  readonly progressFraction: number;
  readonly nextStates: readonly HypotheticalPublicStateV1[];
  readonly unknown: readonly string[];
}

export type JointControlOperationV2 = 'recall-effect' | 'compare-condition' | 'predict-branch'
  | 'expand-condition' | 'execute' | 'observe-public' | 'finish-verified' | 'finish-unknown';

export interface JointControlDrivesV2 {
  readonly goal: number;
  readonly evidence: number;
  readonly condition: number;
  readonly rollout: number;
  readonly unknown: number;
  readonly attention: number;
  readonly novelty: number;
  readonly habit: number;
}

/**
 * One indivisible operation-by-node competitor. The field never chooses an operation
 * independently from its node, so a decision cannot be assembled from two winners.
 */
export interface JointControlSiteInputV2 {
  readonly siteId: string;
  readonly operation: JointControlOperationV2;
  readonly nodeId: string;
  readonly hardEligible: boolean;
  readonly drives: JointControlDrivesV2;
}

export interface JointControlSiteSnapshotV2 extends JointControlSiteInputV2 {
  readonly activation: number;
  readonly zeroEvidenceSteps: number;
  readonly effectiveDrive: number;
}

export interface JointControlDecisionV2 {
  readonly operation: JointControlOperationV2 | 'unknown';
  readonly nodeId: string | null;
  readonly siteId: string | null;
  readonly converged: boolean;
  readonly integrationSteps: number;
  readonly reason: string;
}

export interface JointTransientControlFieldSnapshotV2 {
  readonly version: 'JointTransientControlFieldSnapshotV2';
  readonly goalId: string | null;
  readonly cycle: number;
  readonly interrupted: boolean;
  readonly sites: readonly JointControlSiteSnapshotV2[];
  readonly lastDecision: JointControlDecisionV2 | null;
  readonly lastGoalEvaluation: GoalEvaluationV1 | null;
}

export interface JointTransientControlFieldConfigV2 {
  readonly version: 'JointTransientControlFieldConfigV2';
  readonly seed: number;
  readonly branchCapacity: 8;
  readonly stepSize: 0.02;
  readonly noiseSigma: 0.01;
  readonly maximumIntegrationSteps: 500;
  readonly winnerThreshold: 0.65;
  readonly winnerMargin: 0.10;
  readonly winnerPersistenceSteps: 20;
  readonly inactivePruneThreshold: 0.0001;
  readonly inactivePruneSteps: 50;
  readonly predictionSeeds: 24;
  readonly predictionSteps: 180;
  readonly goalVerificationTicks: 5;
}

export interface PhysicalReasoningPortV1 {
  recallByEffect(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> | readonly EffectRecallCandidateV1[];
  compareConditions(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1):
    Promise<ConditionApplicabilityV1> | ConditionApplicabilityV1;
  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1): Promise<BranchPredictionV1> | BranchPredictionV1;
  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    Promise<readonly OpaqueFactorTransitionTraceV1[]> | readonly OpaqueFactorTransitionTraceV1[];
}
