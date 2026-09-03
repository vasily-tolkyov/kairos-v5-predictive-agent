import type { Action, ActionCue, Observation, PublicChange, PublicValue } from '../contracts.js';
import type { DistributedPhysicalEvidenceReferenceV3, DistributedPredictionSampleV3,
  DistributedPredictionV3 } from '../core/prediction/distributed-reasoning-contracts.js';

export type GroundedSubjectV1 =
  | { readonly kind: 'self' }
  | { readonly kind: 'crosshair' }
  | { readonly kind: 'public-object'; readonly id: string; readonly expectedType: string };

export type PublicObservableV1 =
  | 'position.0' | 'position.1' | 'position.2' | 'yaw' | 'pitch' | 'type' | 'visible'
  | `relativePosition.${0 | 1 | 2}` | `properties.${string}`;
/**
 * `relativeDistance` is derived only from an already-public relativePosition.
 * It is a relational observation, never a world-coordinate/R1 conversion.
 */
export type PublicObservableV2 = PublicObservableV1 | 'relativeDistance';

interface GoalPredicateBaseV1 {
  readonly version: 'GoalPredicateV1';
  readonly id: string;
  readonly subject: GroundedSubjectV1;
  readonly observable: PublicObservableV2;
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
export type PublicActionRequirementKindV2 = PublicActionRequirementKindV1
  | 'public-unique-target-within-interaction-distance';

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

export interface PublicActionRequirementV2 {
  readonly version: 'PublicActionRequirementV2';
  readonly actionCue: ActionCue;
  readonly observationSequence: number;
  readonly satisfied: boolean;
  readonly required: readonly PublicActionRequirementKindV2[];
  readonly missing: readonly PublicActionRequirementKindV2[];
  readonly goal: GroundedGoalV1 | null;
  readonly targetBinding: {
    readonly objectId: string;
    readonly objectType: string;
    readonly publicKind: 'block' | 'entity';
    readonly observationSequence: number;
  } | null;
}

/**
 * Extra public subjects whose real changes belong to one action window.
 * `self` and the direct action target are implicit; runtime attention subjects
 * are appended only after they were actually noticed inside that window.
 */
export interface ActionObservationScopeV1 {
  readonly version: 'ActionObservationScopeV1';
  readonly referencedPublicObjectIds: readonly string[];
}

/** Production evidence is native distributed evidence only. */
export type PhysicalEvidenceReferenceV1 = DistributedPhysicalEvidenceReferenceV3;

export interface EffectRecallCandidateV1<Evidence = PhysicalEvidenceReferenceV1> {
  readonly candidateId: string;
  readonly goalPredicateIds: readonly string[];
  readonly actionCue: ActionCue;
  readonly observedChanges: readonly PublicChange[];
  readonly observedBefore: Readonly<Record<string, number>>;
  readonly evidence: Evidence;
  readonly unknown: readonly string[];
}

export interface OpaqueFactorTransitionTraceV1<Evidence = PhysicalEvidenceReferenceV1> {
  readonly version: 'OpaqueFactorTransitionTraceV1';
  readonly transitionId: string;
  readonly eventId: string;
  readonly actionCue: ActionCue;
  readonly activatedFactorIds: readonly string[];
  readonly deactivatedFactorIds: readonly string[];
  readonly unchangedActiveFactorIds: readonly string[];
  readonly evidence: Evidence;
  readonly meaning: 'observed-factor-transition';
}

export interface SingleConditionApplicabilityV1 {
  readonly matchedFactorIds: readonly string[];
  readonly contradictedFactorIds: readonly string[];
  readonly unknownFactorIds: readonly string[];
  readonly applicability: number;
  readonly productionEligible: boolean;
}

export interface ConditionApplicabilityV1 extends SingleConditionApplicabilityV1 {
  /** Lossless per-event results when one control node groups physically
   * equivalent historical events. A singleton result leaves this absent. */
  readonly memberResults?: readonly {
    readonly candidateId: string;
    readonly value: SingleConditionApplicabilityV1;
  }[];
  readonly selectedCandidateId?: string | null;
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

export interface BranchReadoutDiagnosticsV1 {
  readonly version: 'BranchReadoutDiagnosticsV1';
  readonly roleBindingStatus: 'not-required' | 'matched' | 'goal-change-not-reached'
    | 'provenance-missing' | 'target-unavailable' | 'descriptor-mismatch' | 'ambiguous';
  readonly goalRelevantReadoutCount: number;
  readonly maxVisitedOriginalKernelIndex: number | null;
  readonly goalRelevantKernelVisited: boolean;
}

export interface SingleBranchPredictionV1<Evidence = PhysicalEvidenceReferenceV1,
  PredictionValue = DistributedPredictionV3> {
  readonly prediction: PredictionValue;
  /** Optional evidence re-observed by the prediction query at its base sequence.
   * When present it is authoritative for execution hard gates; the historical
   * recall evidence remains provenance, not a claim about the current medium. */
  readonly currentEvidence?: Evidence;
  readonly validSampleCount: number;
  readonly progressSampleCount: number;
  readonly progressFraction: number;
  readonly nextStates: readonly HypotheticalPublicStateV1[];
  readonly unknown: readonly string[];
  /** Read-only physical readout diagnostics. Older non-hierarchical producers
   * may omit it; the hierarchical production path always supplies it. */
  readonly readoutDiagnostics?: BranchReadoutDiagnosticsV1;
}

export interface BranchPredictionV1<Evidence = PhysicalEvidenceReferenceV1,
  PredictionValue = DistributedPredictionV3> extends SingleBranchPredictionV1<Evidence, PredictionValue> {
  /** Every member keeps its own random physical rollout. The aggregate fields
   * are only a control summary and never replace these member results. */
  readonly memberResults?: readonly {
    readonly candidateId: string;
    readonly value: SingleBranchPredictionV1<Evidence, PredictionValue>;
  }[];
  readonly winningCandidateId?: string | null;
  /** Declares what the aggregate progress count actually measures.  A factor
   * transition may execute only when its projected state satisfies a complete
   * parent R2A relation; activating any one missing factor is not equivalent. */
  readonly progressBasis?: 'grounded-goal-residual' | 'parent-R2A-relation-complete';
}

export interface ProjectedParentRelationMemberV1 extends SingleConditionApplicabilityV1 {
  readonly relationId: string;
}

export interface ProjectedParentRelationApplicabilityV1 extends SingleConditionApplicabilityV1 {
  readonly version: 'ProjectedParentRelationApplicabilityV1';
  readonly selectedRelationId: string | null;
  readonly relationResults: readonly ProjectedParentRelationMemberV1[];
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
  /**
   * Explicit reason why this goal-linked site may suppress blind exploration.
   * Continuous field strength is deliberately absent: a weak, real query is
   * still a query, while a strong provisional trace is still not production
   * evidence.  Physical evidence is retained so the qualification remains
   * auditable and disappears when any required substrate layer is cleared.
   */
  readonly productiveGrounding?:
    | { readonly kind: 'none' }
    | { readonly kind: 'outstanding-effect-query'; readonly goalNodeId: string }
    | { readonly kind: 'physical-branch';
        readonly evidence: readonly PhysicalEvidenceReferenceV1[] };
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
    goal: GroundedGoalV1, goalDifference: GoalEvaluationV1): Promise<BranchPredictionV1> | BranchPredictionV1;
  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    Promise<readonly OpaqueFactorTransitionTraceV1[]> | readonly OpaqueFactorTransitionTraceV1[];
}

export interface ContinuousPatternRecallV2 {
  readonly patternId: string;
  readonly memberR2EventIds: readonly string[];
  readonly orderedR1AtomIds: readonly string[];
  readonly evidenceGrade: 'single-observation' | 'repeated-correlation' | 'predictive-stable'
    | 'causal-hypothesis' | 'intervention-supported';
  readonly activePhysicalTraceIds: readonly string[];
  readonly currentRelationIds?: readonly string[];
  readonly currentApplicability?: number;
  readonly currentPredictionEligible?: boolean;
  /** Exact next-action physical identities observed in this pattern. */
  readonly nextActionCueIdentities?: readonly string[];
  readonly unknown: readonly string[];
}

export interface ContinuationPredictionV2<Sample = DistributedPredictionSampleV3> {
  readonly version: 'ContinuationPredictionV2';
  readonly patternId: string;
  readonly support: number;
  readonly samples: readonly Sample[];
  readonly evidenceGrade: ContinuousPatternRecallV2['evidenceGrade'];
  readonly unknown: readonly string[];
}

/** Hierarchical read-only surface. V1 names remain compatibility aliases for
 * the joint field while it migrates; neither surface may write memory. */
export interface PhysicalReasoningPortV2 extends PhysicalReasoningPortV1 {
  recallAtomicEffect(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> | readonly EffectRecallCandidateV1[];
  recallContinuousPattern(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): Promise<readonly ContinuousPatternRecallV2[]> | readonly ContinuousPatternRecallV2[];
  compareCurrentFactors(relationId: string, observation: Observation): Promise<ConditionApplicabilityV1> | ConditionApplicabilityV1;
  compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[], source: { readonly r1Active: boolean; readonly r2Active: boolean }):
    Promise<readonly ProjectedParentRelationApplicabilityV1[]> | readonly ProjectedParentRelationApplicabilityV1[];
  predictContinuation(patternId: string, exactActionCue: ActionCue, observation: Observation):
    Promise<ContinuationPredictionV2> | ContinuationPredictionV2;
}
