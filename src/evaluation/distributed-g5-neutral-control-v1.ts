import type { Action, ActionCue, Observation, PublicValue, RealEvent } from '../contracts.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1,
  ConditionApplicabilityV1, ContinuationPredictionV2, ContinuousPatternRecallV2,
  EffectRecallCandidateV1, GroundedGoalV1, GoalEvaluationV1,
  HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV2, ProjectedParentRelationApplicabilityV1 }
  from '../control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2,
  type PhysicalControlResultV2 } from '../control/controller.js';
import { DistributedHierarchicalPhysicalMemoryV1,
  type KairosV5DistributedPhysicalMemoryV3 } from '../distributed-hierarchical-memory.js';
import { DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5 }
  from '../core/learning/distributed-r2a-physical.js';
import { cueFor, cueIdentity, realEventHierarchyContinuityV1 } from '../events.js';
import { assert, sha } from '../util.js';

export const DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1 =
  'DistributedG5NeutralControlEvaluationV1' as const;

type NeutralDepthV1 = 2 | 3;
type TrainingArmV1 = 'q-to-p' | 'not-q-to-p' | 'p-to-f' | 'not-p-to-f'
  | 'f-to-r' | 'not-f-to-r';
type NeutralActionRoleV1 = 'gamma' | 'alpha' | 'beta' | 'delta' | 'observe';

interface NeutralStateV1 {
  readonly Q: boolean;
  readonly P: boolean;
  readonly F: boolean;
  readonly R: boolean;
  readonly D: boolean;
  readonly selectedSlot: number;
}

export interface DistributedG5NeutralVariantV1 {
  readonly variantId: string;
  readonly offerOrder: readonly NeutralActionRoleV1[];
  readonly recallPermutation: 'identity' | 'reverse' | 'rotate-one' | 'opaque-sort';
  readonly opaqueIdentitySalt: string;
}

export interface DistributedG5NeutralCasePlanV1 {
  readonly caseId: string;
  readonly depth: NeutralDepthV1;
  readonly variantIndex: number;
  readonly fieldSeed: number;
  readonly variant: DistributedG5NeutralVariantV1;
}

export interface DistributedG5NeutralMatrixPlanV1 {
  readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  readonly variants: readonly DistributedG5NeutralVariantV1[];
  readonly twoStepCases: readonly DistributedG5NeutralCasePlanV1[];
  readonly threeStepCases: readonly DistributedG5NeutralCasePlanV1[];
}

export interface DistributedG5SharedBaselineAuditV1 {
  readonly trustedRealEventCount: 128;
  readonly completeR2SequenceCount: 48;
  readonly resetSeparatedFillerCount: 32;
  readonly matchedInterventionCount: 12;
  readonly contextsPerArm: 4;
  readonly repetitionsPerArm: 8;
  readonly trainingEventIdsAreOpaque: true;
  readonly scoringLabelsEnteredPhysicalMemory: false;
  readonly resultCacheUsed: false;
  readonly ready: boolean;
  readonly writes: number;
  readonly r2PatternCount: number;
  readonly r2aRelationCount: number;
}

export interface DistributedG5SharedBaselineV1 {
  readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  /**
   * Identity of the producer contract which created the frozen physical
   * baseline.  A self-consistent snapshot hash is not sufficient here: a
   * later reader must also reject a baseline produced by an older physical
   * index algorithm.
   */
  readonly producerIdentity: typeof DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1;
  /** Physical R2A index algorithm used for the snapshot. */
  readonly r2aAlgorithmIdentity: typeof DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5;
  readonly snapshot: KairosV5DistributedPhysicalMemoryV3;
  readonly snapshotSha256: string;
  readonly nextObservationSequence: number;
  readonly activeSeconds: number;
  readonly audit: DistributedG5SharedBaselineAuditV1;
}

export interface DistributedG5MatchedInterventionPlanV1 {
  readonly baselineR2EventId: string;
  readonly interventionR2EventId: string;
}

/**
 * A content-addressable physical checkpoint taken after all 128 real events
 * and before any matched-intervention assessment.  Keeping this boundary
 * explicit prevents a late R2A qualification failure from destroying the
 * expensive real physical state needed to diagnose it.  The plan contains
 * only opaque R2 event references; no factor or expected-result label is
 * written into the memory snapshot.
 */
export interface DistributedG5PreInterventionBaselineV1 {
  readonly version: 'DistributedG5PreInterventionBaselineV1';
  readonly producerIdentity: string;
  readonly snapshot: KairosV5DistributedPhysicalMemoryV3;
  readonly snapshotSha256: string;
  readonly nextObservationSequence: number;
  readonly activeSeconds: number;
  readonly interventionPlans: readonly DistributedG5MatchedInterventionPlanV1[];
  readonly interventionPlanSha256: string;
  readonly artifactSha256: string;
  readonly audit: {
    readonly trustedRealEventCount: 128;
    readonly completeR2SequenceCount: 48;
    readonly resetSeparatedFillerCount: 32;
    readonly plannedMatchedInterventionCount: 12;
    readonly contextsPerArm: 4;
    readonly repetitionsPerArm: 8;
    readonly trainingEventIdsAreOpaque: true;
    readonly scoringLabelsEnteredPhysicalMemory: false;
    readonly ready: boolean;
    readonly writes: number;
    readonly r2PatternCount: number;
    readonly r2aRelationCount: number;
  };
}

interface PredictionInvocationAuditV1 {
  readonly invocation: number;
  readonly opaqueCandidateId: string;
  readonly observationSequence: number;
  readonly sampleCount: number;
  readonly validSampleCount: number;
  readonly progressSampleCount: number;
  readonly progressFraction: number;
  readonly delegatedToPhysicalPort: true;
}

export interface DistributedG5NeutralCaseAuditV1 {
  readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  readonly caseId: string;
  readonly depth: NeutralDepthV1;
  readonly variantId: string;
  readonly fieldSeed: number;
  readonly result: PhysicalControlResultV2 | null;
  readonly error: string | null;
  readonly durationMs: number;
  readonly actionTimeline: readonly NeutralActionRoleV1[];
  readonly stateTransitions: readonly {
    readonly role: NeutralActionRoleV1;
    readonly before: NeutralStateV1;
    readonly after: NeutralStateV1;
    readonly changed: readonly string[];
  }[];
  readonly goalVerified: boolean;
  readonly causalMilestonesSatisfied: boolean;
  readonly verificationObserveCompleted: boolean;
  readonly extraOrNoEffectExplorationCount: number;
  readonly dependencyDepth: number;
  readonly retainedDependencyCount: number;
  readonly maximumConcurrentNonZeroOperationKinds: number;
  readonly freshExecutionEvidence: boolean;
  readonly physicalPredictionInvocations: number;
  readonly physicalPredictionSamples: number;
  readonly physicalPredictionMicrosteps: number;
  readonly predictionInvocations: readonly PredictionInvocationAuditV1[];
  readonly allPhysicalPredictionCallsHave24Seeds: boolean;
  readonly allExecutedPhysicalBranchesMeetG5Gate: boolean;
  readonly predictionResultCacheUsed: false;
  readonly expectedActionOrderInjected: false;
  readonly offerOrder: readonly NeutralActionRoleV1[];
  readonly requestIdsUnique: boolean;
  readonly parentStackResumeRecordCount: number;
  readonly staleOfferRefusalCount: number;
  readonly frozenBaselineHashBefore: string;
  readonly frozenBaselineHashAfter: string;
  readonly isolatedMemoryHashBefore: string;
  readonly isolatedMemoryHashAfter: string;
  readonly physicalMemoryReadOnly: boolean;
  readonly evaluationEventsUsedAsPhysicalEvidence: 0;
  readonly passed: boolean;
}

export interface DistributedG5NeutralMatrixAuditV1 {
  readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  readonly baseline: DistributedG5SharedBaselineAuditV1;
  readonly baselineSha256: string;
  readonly baselineBuildMs: number;
  readonly caseCount: number;
  readonly twoStepPassed: number;
  readonly twoStepRequired: 32;
  readonly threeStepPassed: number;
  readonly threeStepRequired: 64;
  readonly cases: readonly DistributedG5NeutralCaseAuditV1[];
  readonly totalDurationMs: number;
  readonly fullMatrixPassed: boolean;
  readonly performanceBoundary: {
    readonly executionMode: 'sequential-isolated-cases';
    readonly baselineBuiltOnce: true;
    readonly candidatePredictionCache: 'disabled';
    readonly predictionWorkIsPhysicalInvocationsTimes24SeedsTimes180Steps: true;
  };
}

export const DISTRIBUTED_G5_NEUTRAL_AUDIT_DEFINITION_V1 = Object.freeze({
  baselineRealEvents: 128,
  completeR2Sequences: 48,
  resetSeparatedFillers: 32,
  matchedInterventions: 12,
  repetitionsPerArm: 8,
  contextsPerArm: 4,
  predictionSeedsPerCandidate: 24,
  predictionStepsPerSeed: 180,
  twoStepCaseCount: 32,
  threeStepCaseCount: 64,
  variants: 4,
  candidatePredictionCache: 'disabled',
  evaluationWritesPhysicalExperience: false,
  expectedActionOrderInjected: false,
  caseActionBudget: 5,
} as const);

export const DISTRIBUTED_G5_ACTION_BUDGET_V1 = 5 as const;

/** This commits the expensive pre-intervention artifact to the exact neutral
 * experiment design and the R2A physical-index algorithm that produced it.
 * It is an audit identity only and is never written into a physical medium. */
export const DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1 = sha({
  version: 'DistributedG5PreInterventionProducerContractV2',
  evaluationVersion: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
  auditDefinition: DISTRIBUTED_G5_NEUTRAL_AUDIT_DEFINITION_V1,
  r2aPhysicalIndexAlgorithm: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
});

/** Validate a consolidated baseline at every load boundary.  The pre-
 * intervention artifact has its own validator; this second validator closes
 * the former gap where a consolidated baseline retained only a self-reported
 * snapshot hash and could therefore outlive a changed R2A implementation. */
export function validateDistributedG5SharedBaselineV1(
  baseline: DistributedG5SharedBaselineV1): void {
  assert(baseline.version === DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
    'g5-shared-baseline-version-invalid');
  assert(baseline.producerIdentity === DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    'g5-shared-baseline-producer-identity-mismatch');
  assert(baseline.r2aAlgorithmIdentity === DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
    'g5-shared-baseline-r2a-algorithm-identity-mismatch');
  assert(sha(baseline.snapshot) === baseline.snapshotSha256,
    'g5-shared-baseline-snapshot-hash-mismatch');
  assert(baseline.snapshot.r2a.physicalIndexIdentity.algorithmIdentity
    === DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
  'g5-shared-baseline-snapshot-r2a-algorithm-identity-mismatch');
}

export function distributedG5PreInterventionArtifactSha256V1(value: Pick<
  DistributedG5PreInterventionBaselineV1,
  'version' | 'producerIdentity' | 'snapshotSha256' | 'nextObservationSequence'
  | 'activeSeconds' | 'interventionPlans' | 'interventionPlanSha256' | 'audit'>): string {
  return sha({ commitmentVersion: 'DistributedG5PreInterventionArtifactCommitmentV1',
    payload: { version: value.version, producerIdentity: value.producerIdentity,
      snapshotSha256: value.snapshotSha256,
      nextObservationSequence: value.nextObservationSequence,
      activeSeconds: value.activeSeconds, interventionPlans: value.interventionPlans,
      interventionPlanSha256: value.interventionPlanSha256, audit: value.audit } });
}

export function validateDistributedG5PreInterventionArtifactV1(
  pre: DistributedG5PreInterventionBaselineV1): void {
  assert(pre.version === 'DistributedG5PreInterventionBaselineV1',
    'g5-pre-intervention-version-invalid');
  assert(pre.producerIdentity === DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    'g5-pre-intervention-producer-identity-mismatch');
  assert(sha(pre.snapshot) === pre.snapshotSha256, 'g5-pre-intervention-snapshot-hash-mismatch');
  assert(sha(pre.interventionPlans) === pre.interventionPlanSha256,
    'g5-pre-intervention-plan-hash-mismatch');
  assert(distributedG5PreInterventionArtifactSha256V1(pre) === pre.artifactSha256,
    'g5-pre-intervention-artifact-commitment-mismatch');
  const pairIds = pre.interventionPlans.map(value => {
    assert(value.baselineR2EventId !== value.interventionR2EventId,
      'g5-pre-intervention-pair-reuses-one-event');
    return sha(value);
  });
  assert(new Set(pairIds).size === pairIds.length, 'g5-pre-intervention-pair-duplicate');
  assert(pre.audit.trustedRealEventCount === 128 && pre.audit.completeR2SequenceCount === 48
    && pre.audit.resetSeparatedFillerCount === 32
    && pre.audit.plannedMatchedInterventionCount === 12
    && pre.interventionPlans.length === 12,
  'g5-pre-intervention-audit-invalid');
}

const PREFIX: Action = { kind: 'select-hotbar', parameters: { slot: 8 } };
const ACTIONS: Readonly<Record<NeutralActionRoleV1, Action>> = Object.freeze({
  gamma: { kind: 'select-hotbar', parameters: { slot: 0 } },
  alpha: { kind: 'select-hotbar', parameters: { slot: 1 } },
  beta: { kind: 'select-hotbar', parameters: { slot: 2 } },
  delta: { kind: 'select-hotbar', parameters: { slot: 3 } },
  observe: { kind: 'observe', parameters: { ticks: 5 } },
});

const GOALS: Readonly<Record<NeutralDepthV1, GroundedGoalV1>> = Object.freeze({
  2: { version: 'GroundedGoalV1', id: 'opaque-terminal-F', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'opaque-F-equals-true',
      subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
      observable: 'properties.F', comparator: 'equals', target: true },
  } },
  3: { version: 'GroundedGoalV1', id: 'opaque-terminal-R', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'opaque-R-equals-true',
      subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
      observable: 'properties.R', comparator: 'equals', target: true },
  } },
});

const VARIANTS: readonly DistributedG5NeutralVariantV1[] = [
  { variantId: 'v0', offerOrder: ['gamma', 'alpha', 'beta', 'delta', 'observe'],
    recallPermutation: 'identity', opaqueIdentitySalt: 'a371' },
  { variantId: 'v1', offerOrder: ['observe', 'delta', 'beta', 'alpha', 'gamma'],
    recallPermutation: 'reverse', opaqueIdentitySalt: 'c905' },
  { variantId: 'v2', offerOrder: ['alpha', 'delta', 'gamma', 'observe', 'beta'],
    recallPermutation: 'rotate-one', opaqueIdentitySalt: '5e42' },
  { variantId: 'v3', offerOrder: ['beta', 'observe', 'gamma', 'delta', 'alpha'],
    recallPermutation: 'opaque-sort', opaqueIdentitySalt: 'f18c' },
] as const;

const configuration = (seed: number) => ({
  version: 'JointTransientControlFieldConfigV2' as const, seed,
  branchCapacity: 8 as const, stepSize: .02 as const, noiseSigma: .01 as const,
  maximumIntegrationSteps: 500 as const, winnerThreshold: .65 as const,
  winnerMargin: .10 as const, winnerPersistenceSteps: 20 as const,
  inactivePruneThreshold: .0001 as const, inactivePruneSteps: 50 as const,
  predictionSeeds: 24 as const, predictionSteps: 180 as const,
  goalVerificationTicks: 5 as const,
});

class NeutralEventClockV1 {
  sequence: number;
  seconds: number;

  constructor(sequence = 1, seconds = 0) {
    this.sequence = sequence;
    this.seconds = seconds;
  }

  frame(state: NeutralStateV1, contextId: string): Observation {
    return { sequence: this.sequence++, activeSeconds: this.seconds += .001,
      contextId, targetId: null,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0,
        properties: { selectedSlot: state.selectedSlot } },
      objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1],
        properties: { Q: state.Q, P: state.P, F: state.F, R: state.R, D: state.D } }],
    };
  }
}

const opaqueId = (domain: string, value: unknown): string => `${domain}:${sha({ domain, value })}`;

function realActionEvent(clock: NeutralEventClockV1, eventId: string, action: Action,
  beforeState: NeutralStateV1, afterState: NeutralStateV1, contextId: string,
  continuity?: { readonly sessionId: string; readonly boundary: 'reset' | 'continuous';
    readonly status: 'open' | 'publicly-resolved' }): RealEvent {
  const before = clock.frame(beforeState, contextId), after = clock.frame(afterState, contextId);
  const bare: RealEvent = { version: 'RealEventV5', id: eventId,
    cue: cueFor(action, before), frames: [before, after], trackedIds: ['self', 'o'],
    bodyResult: { action, executed: true, status: 'completed',
      startSequence: before.sequence, endSequence: after.sequence, terminationReason: 'stable' },
    provenance: 'executed-real-body', complete: true };
  if (!continuity) return bare;
  return { ...bare, hierarchyContinuity: {
    ...realEventHierarchyContinuityV1(bare, continuity.sessionId, continuity.boundary),
    processStatusAfter: continuity.status,
  } };
}

function armStates(arm: TrainingArmV1): { readonly action: Action;
  readonly before: NeutralStateV1; readonly after: NeutralStateV1 } {
  const base = { Q: false, P: false, F: false, R: false, D: false, selectedSlot: 8 };
  if (arm === 'q-to-p') return { action: ACTIONS.gamma,
    before: { ...base, Q: true }, after: { ...base, Q: true, P: true, selectedSlot: 0 } };
  if (arm === 'not-q-to-p') return { action: ACTIONS.gamma,
    before: base, after: { ...base, selectedSlot: 0 } };
  if (arm === 'p-to-f') return { action: ACTIONS.alpha,
    before: { ...base, Q: true, P: true },
    after: { ...base, Q: true, P: true, F: true, selectedSlot: 1 } };
  if (arm === 'not-p-to-f') return { action: ACTIONS.alpha,
    before: { ...base, Q: true }, after: { ...base, Q: true, selectedSlot: 1 } };
  if (arm === 'f-to-r') return { action: ACTIONS.beta,
    before: { ...base, Q: true, P: true, F: true },
    after: { ...base, Q: true, P: true, F: true, R: true, selectedSlot: 2 } };
  return { action: ACTIONS.beta,
    before: { ...base, Q: true, P: true },
    after: { ...base, Q: true, P: true, selectedSlot: 2 } };
}

export function buildDistributedG5PreInterventionBaselineV1():
  DistributedG5PreInterventionBaselineV1 {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  // The training fixture deposits every R1/R2/R2A physical event immediately,
  // but coalesces the expensive derived R2A consolidation until the complete
  // 128-event calibration batch has arrived.  This is an explicit evaluation
  // boundary; it does not alter field equations, random proposals, or the
  // production default cadence used by online learning.
  memory.beginR2AConsolidationBatchV1();
  const clock = new NeutralEventClockV1();
  const arms: readonly TrainingArmV1[] = [
    'q-to-p', 'not-q-to-p', 'p-to-f', 'not-p-to-f', 'f-to-r', 'not-f-to-r',
  ];
  const actionEventIds = new Map<TrainingArmV1, string[]>(arms.map(arm => [arm, []]));

  for (let repetition = 0; repetition < 8; repetition += 1) for (const arm of arms) {
    const states = armStates(arm);
    const opaqueRun = sha({ kind: 'neutral-training-run', arm, repetition });
    const sessionId = opaqueId('s', opaqueRun);
    const contextId = opaqueId('c', { group: repetition % 4 });
    const prefixId = opaqueId('e', { opaqueRun, atom: 0 });
    const actionId = opaqueId('e', { opaqueRun, atom: 1 });
    memory.observe(realActionEvent(clock, prefixId, PREFIX, states.before, states.before, contextId,
      { sessionId, boundary: 'reset', status: 'open' }));
    memory.observe(realActionEvent(clock, actionId, states.action, states.before, states.after, contextId,
      { sessionId, boundary: 'continuous', status: 'publicly-resolved' }));
    actionEventIds.get(arm)!.push(actionId);
  }

  for (let index = 0; index < 32; index += 1) {
    const slot = 4 + index % 4;
    const before: NeutralStateV1 = { Q: index % 2 === 0, P: false, F: false, R: false,
      D: false, selectedSlot: 8 };
    const after = { ...before, selectedSlot: slot };
    memory.observe(realActionEvent(clock, opaqueId('e', { filler: index }),
      { kind: 'select-hotbar', parameters: { slot } }, before, after,
      opaqueId('c', { fillerGroup: index % 4 })));
  }

  const consolidation = memory.endR2AConsolidationBatchV1();
  assert(consolidation.consolidated && consolidation.deferredBoundaryCount === 5,
    'g5-batch-consolidation-boundary-invalid');

  assert(memory.ready && memory.writes === 128, 'g5-shared-baseline-is-not-exactly-128-events');
  const preIntervention = memory.snapshot();
  const r2For = (eventId: string): string => {
    const annotation = preIntervention.annotations.find(value => value.eventId === eventId);
    assert(annotation?.r2EventIds.length === 1, `g5-action-has-no-unique-r2-event:${eventId}`);
    return annotation.r2EventIds[0]!;
  };
  const pairs: readonly [TrainingArmV1, TrainingArmV1][] = [
    ['not-q-to-p', 'q-to-p'], ['not-p-to-f', 'p-to-f'], ['not-f-to-r', 'f-to-r'],
  ];
  const interventionPlans = pairs.flatMap(([baselineArm, interventionArm]) =>
    Array.from({ length: 4 }, (_unused, repetition): DistributedG5MatchedInterventionPlanV1 => ({
      baselineR2EventId: r2For(actionEventIds.get(baselineArm)![repetition]!),
      interventionR2EventId: r2For(actionEventIds.get(interventionArm)![repetition]!),
    })));
  assert(interventionPlans.length === 12, 'g5-pre-intervention-plan-count-invalid');
  const opaqueIds = preIntervention.seenEventIds.every(id => /^e:[0-9a-f]{64}$/.test(id));
  assert(opaqueIds, 'g5-training-event-id-leaked-fixture-label');
  const snapshotSha256 = sha(preIntervention);
  const interventionPlanSha256 = sha(interventionPlans);
  const audit: DistributedG5PreInterventionBaselineV1['audit'] = {
    trustedRealEventCount: 128, completeR2SequenceCount: 48,
    resetSeparatedFillerCount: 32, plannedMatchedInterventionCount: 12,
    contextsPerArm: 4, repetitionsPerArm: 8, trainingEventIdsAreOpaque: true,
    scoringLabelsEnteredPhysicalMemory: false,
    ready: memory.ready, writes: memory.writes,
    r2PatternCount: preIntervention.r2a.patterns.length,
    r2aRelationCount: preIntervention.r2a.relations.length };
  const base: Omit<DistributedG5PreInterventionBaselineV1, 'artifactSha256'> = {
    version: 'DistributedG5PreInterventionBaselineV1',
    producerIdentity: DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    snapshot: preIntervention, snapshotSha256,
    nextObservationSequence: clock.sequence, activeSeconds: clock.seconds,
    interventionPlans, interventionPlanSha256, audit };
  return { ...base, artifactSha256: distributedG5PreInterventionArtifactSha256V1(base) };
}

export function consolidateDistributedG5InterventionsV1(
  pre: DistributedG5PreInterventionBaselineV1): DistributedG5SharedBaselineV1 {
  validateDistributedG5PreInterventionArtifactV1(pre);
  const memory = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(pre.snapshot));
  memory.recordDistributedMatchedInterventions(pre.interventionPlans.map(plan => ({
    version: 'DistributedR2AInterventionPairV2' as const,
    baselineR2EventId: plan.baselineR2EventId,
    interventionR2EventId: plan.interventionR2EventId,
  })));
  const snapshot = memory.snapshot();
  const baseline: DistributedG5SharedBaselineV1 = {
    version: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
    producerIdentity: DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    r2aAlgorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
    snapshot, snapshotSha256: sha(snapshot),
    nextObservationSequence: pre.nextObservationSequence,
    activeSeconds: pre.activeSeconds,
    audit: { trustedRealEventCount: 128, completeR2SequenceCount: 48,
      resetSeparatedFillerCount: 32, matchedInterventionCount: 12,
      contextsPerArm: 4, repetitionsPerArm: 8, trainingEventIdsAreOpaque: true,
      scoringLabelsEnteredPhysicalMemory: false, resultCacheUsed: false,
      ready: memory.ready, writes: memory.writes,
      r2PatternCount: snapshot.r2a.patterns.length,
      r2aRelationCount: snapshot.r2a.relations.length } };
  validateDistributedG5SharedBaselineV1(baseline);
  return baseline;
}

export function buildDistributedG5Shared128EventBaselineV1(): DistributedG5SharedBaselineV1 {
  return consolidateDistributedG5InterventionsV1(buildDistributedG5PreInterventionBaselineV1());
}

function permute<T>(values: readonly T[], mode: DistributedG5NeutralVariantV1['recallPermutation'],
  salt: string, identity: (value: T) => string): readonly T[] {
  const result = [...values];
  if (mode === 'reverse') return result.reverse();
  if (mode === 'rotate-one') return result.length < 2 ? result : [...result.slice(1), result[0]!];
  if (mode === 'opaque-sort') return result.sort((left, right) =>
    sha({ salt, id: identity(left) }).localeCompare(sha({ salt, id: identity(right) }), 'en'));
  return result;
}

/** Transparent permutation adapter. It never manufactures a reasoning result:
 * every prediction call is delegated synchronously to the real physical port. */
class OpaquePermutationReasoningPortV1 implements PhysicalReasoningPortV2 {
  readonly predictionInvocations: PredictionInvocationAuditV1[] = [];
  readonly exposedEvidenceEventIds = new Set<string>();
  readonly #candidateToOriginal = new Map<string, string>();
  readonly #transitionToOriginal = new Map<string, string>();

  constructor(readonly delegate: DistributedHierarchicalPhysicalMemoryV1,
    readonly variant: DistributedG5NeutralVariantV1) {}

  #candidate(value: EffectRecallCandidateV1): EffectRecallCandidateV1 {
    this.exposedEvidenceEventIds.add(value.evidence.eventId);
    const candidateId = opaqueId('candidate', { salt: this.variant.opaqueIdentitySalt,
      original: value.candidateId });
    this.#candidateToOriginal.set(candidateId, value.candidateId);
    return { ...structuredClone(value), candidateId };
  }

  #originalCandidate(value: EffectRecallCandidateV1): EffectRecallCandidateV1 {
    return { ...structuredClone(value),
      candidateId: this.#candidateToOriginal.get(value.candidateId)
        ?? this.#transitionToOriginal.get(value.candidateId) ?? value.candidateId };
  }

  #transition(value: OpaqueFactorTransitionTraceV1): OpaqueFactorTransitionTraceV1 {
    this.exposedEvidenceEventIds.add(value.evidence.eventId);
    const transitionId = opaqueId('transition', { salt: this.variant.opaqueIdentitySalt,
      original: value.transitionId });
    this.#transitionToOriginal.set(transitionId, value.transitionId);
    return { ...structuredClone(value), transitionId };
  }

  #candidates(values: readonly EffectRecallCandidateV1[]): readonly EffectRecallCandidateV1[] {
    return permute(values.map(value => this.#candidate(value)), this.variant.recallPermutation,
      this.variant.opaqueIdentitySalt, value => value.candidateId);
  }

  recallByEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.#candidates(this.delegate.recallByEffect(goal, difference, observation));
  }

  recallAtomicEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.#candidates(this.delegate.recallAtomicEffect(goal, difference, observation));
  }

  recallContinuousPattern(goal: GroundedGoalV1, difference: GoalEvaluationV1,
    observation: Observation): readonly ContinuousPatternRecallV2[] {
    const values = this.delegate.recallContinuousPattern(goal, difference, observation);
    return permute(values.map(value => structuredClone(value)), this.variant.recallPermutation,
      this.variant.opaqueIdentitySalt, value => value.patternId);
  }

  compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): ConditionApplicabilityV1 {
    return this.delegate.compareConditions(this.#originalCandidate(candidate), state);
  }

  compareCurrentFactors(relationId: string, observation: Observation): ConditionApplicabilityV1 {
    return this.delegate.compareCurrentFactors(relationId, observation);
  }

  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, difference: GoalEvaluationV1): BranchPredictionV1 {
    const result = this.delegate.predictCandidate(this.#originalCandidate(candidate), state, goal, difference);
    const observationSequence = 'version' in state ? state.baseObservationSequence : state.sequence;
    this.predictionInvocations.push({ invocation: this.predictionInvocations.length + 1,
      opaqueCandidateId: candidate.candidateId, observationSequence,
      sampleCount: result.prediction.samples.length, validSampleCount: result.validSampleCount,
      progressSampleCount: result.progressSampleCount, progressFraction: result.progressFraction,
      delegatedToPhysicalPort: true });
    return result;
  }

  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1) {
    const values = this.delegate.recallFactorTransition(factorIds, state);
    return permute(values.map(value => this.#transition(value)), this.variant.recallPermutation,
      this.variant.opaqueIdentitySalt, value => value.transitionId);
  }

  compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[], source: { readonly r1Active: boolean;
      readonly r2Active: boolean }): readonly ProjectedParentRelationApplicabilityV1[] {
    return this.delegate.compareProjectedParentRelations(relationIds, observation, states, source);
  }

  predictContinuation(patternId: string, exactActionCue: ActionCue,
    observation: Observation): ContinuationPredictionV2 {
    return this.delegate.predictContinuation(patternId, exactActionCue, observation);
  }
}

class NeutralControlEnvironmentV1 implements PhysicalControlEnvironmentV2 {
  readonly records: Array<{ readonly kind: string; readonly value: unknown }> = [];
  readonly timeline: NeutralActionRoleV1[] = [];
  readonly transitions: Array<{ readonly role: NeutralActionRoleV1;
    readonly before: NeutralStateV1; readonly after: NeutralStateV1;
    readonly changed: readonly string[] }> = [];
  readonly actionBudget: number;
  actionCount = 0;
  #state: NeutralStateV1 = { Q: true, P: false, F: false, R: false, D: false, selectedSlot: 8 };
  #observation: Observation;
  #waits = 0;

  constructor(readonly memory: DistributedHierarchicalPhysicalMemoryV1,
    readonly plan: DistributedG5NeutralCasePlanV1, readonly clock: NeutralEventClockV1) {
    this.actionBudget = DISTRIBUTED_G5_ACTION_BUDGET_V1;
    this.#observation = this.#nextObservation(1);
  }

  get state(): NeutralStateV1 { return structuredClone(this.#state); }

  #nextObservation(ticks: number): Observation {
    let value = this.clock.frame(this.#state, opaqueId('evaluation-context', this.plan.caseId));
    for (let index = 1; index < ticks; index += 1)
      value = this.clock.frame(this.#state, opaqueId('evaluation-context', this.plan.caseId));
    this.#observation = value;
    return value;
  }

  async observe(): Promise<Observation> { return this.#observation; }

  async waitForObservationAfter(sequence: number): Promise<Observation> {
    assert(++this.#waits <= 80, 'g5-control-field-did-not-converge-within-80-observations');
    while (this.#observation.sequence <= sequence) this.#nextObservation(1);
    return this.#observation;
  }

  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    return this.plan.variant.offerOrder.map(role => {
      const action = ACTIONS[role];
      return { version: 'ActionOfferV1', offerId: opaqueId('offer', {
        caseId: this.plan.caseId, sequence: observation.sequence, cue: cueFor(action, observation) }),
      observationSequence: observation.sequence, action, cue: cueFor(action, observation) };
    });
  }

  describeActionRequirement(): { readonly satisfied: boolean; readonly missing: readonly string[];
    readonly goal: GroundedGoalV1 | null } {
    return { satisfied: true, missing: [], goal: null };
  }

  #roleFor(cue: ActionCue): NeutralActionRoleV1 | null {
    const identity = cueIdentity(cue);
    for (const role of Object.keys(ACTIONS) as NeutralActionRoleV1[])
      if (cueIdentity(cueFor(ACTIONS[role], this.#observation)) === identity) return role;
    return null;
  }

  async executeOffer(offer: ActionOfferV1, _scope: ActionObservationScopeV1) {
    const current = this.listActionOffers(this.#observation)
      .find(value => cueIdentity(value.cue) === cueIdentity(offer.cue));
    if (!current) return { executed: false, observation: this.#observation,
      eventId: null, refusal: 'offer-stale' as const };
    const role = this.#roleFor(current.cue);
    assert(role !== null, 'g5-offer-has-no-neutral-action-role');
    const before = this.state;
    if (role === 'gamma') this.#state = { ...this.#state,
      P: this.#state.Q ? true : this.#state.P, selectedSlot: 0 };
    else if (role === 'alpha') this.#state = { ...this.#state,
      F: this.#state.P ? true : this.#state.F, selectedSlot: 1 };
    else if (role === 'beta') this.#state = { ...this.#state,
      R: this.#state.F ? true : this.#state.R, selectedSlot: 2 };
    else if (role === 'delta') this.#state = { ...this.#state, D: true, selectedSlot: 3 };
    this.#nextObservation(role === 'observe' ? 5 : 2);
    const after = this.state;
    const changed = (Object.keys(after) as (keyof NeutralStateV1)[])
      .filter(key => !Object.is(before[key], after[key])).map(String);
    this.actionCount++;
    this.timeline.push(role);
    this.transitions.push({ role, before, after, changed });
    // The evaluator deliberately does not call memory.observe. Each case is a
    // read-only use of the same frozen 128-event physical baseline.
    return { executed: true, observation: this.#observation, eventId: null };
  }

  async status() {
    return { ready: this.memory.ready, bufferedEvents: this.memory.bufferedEvents,
      writes: this.memory.writes };
  }

  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

export function createDistributedG5NeutralMatrixPlanV1(): DistributedG5NeutralMatrixPlanV1 {
  const cases = (depth: NeutralDepthV1, seedsPerVariant: number, seedBase: number) =>
    VARIANTS.flatMap((variant, variantIndex) => Array.from({ length: seedsPerVariant }, (_unused, index) => ({
      caseId: `g5-d${depth}-${variant.variantId}-s${index + 1}`,
      depth, variantIndex, fieldSeed: seedBase + variantIndex * seedsPerVariant + index,
      variant,
    } satisfies DistributedG5NeutralCasePlanV1)));
  return { version: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1, variants: VARIANTS,
    twoStepCases: cases(2, 8, 1001), threeStepCases: cases(3, 16, 3001) };
}

function maximumDependencyDepth(value: unknown): { readonly depth: number; readonly count: number } {
  const snapshot = value as { readonly workspace?: { readonly dependencies?: readonly {
    readonly dependentNodeId: string; readonly requiredNodeId: string }[] } } | null;
  const edges = snapshot?.workspace?.dependencies ?? [];
  const next = new Map<string, string[]>();
  for (const edge of edges) next.set(edge.dependentNodeId,
    [...(next.get(edge.dependentNodeId) ?? []), edge.requiredNodeId]);
  const visit = (id: string, path: ReadonlySet<string>): number => {
    if (path.has(id)) return 0;
    const nested = next.get(id) ?? [];
    return nested.length === 0 ? 1 : 1 + Math.max(...nested.map(child => visit(child, new Set([...path, id]))));
  };
  return { depth: next.size === 0 ? 0 : Math.max(...[...next.keys()].map(id => visit(id, new Set()))),
    count: edges.length };
}

function transitionMilestones(depth: NeutralDepthV1,
  transitions: readonly NeutralControlEnvironmentV1['transitions'][number][]): boolean {
  const p = transitions.findIndex(value => !value.before.P && value.after.P);
  const f = transitions.findIndex(value => !value.before.F && value.after.F);
  const r = transitions.findIndex(value => !value.before.R && value.after.R);
  return depth === 2 ? p >= 0 && f > p : p >= 0 && f > p && r > f;
}

function concurrentOperationKinds(records: readonly { readonly kind: string; readonly value: unknown }[]): number {
  let maximum = 0;
  for (const record of records.filter(value => value.kind === 'joint-control-decision')) {
    const snapshot = record.value as { readonly field?: { readonly sites?: readonly {
      readonly operation?: string; readonly hardEligible?: boolean;
      readonly drives?: Readonly<Record<string, number>> }[] } };
    const kinds = new Set((snapshot.field?.sites ?? []).filter(site => site.hardEligible
      && Object.values(site.drives ?? {}).some(value => value > 0)).map(site => site.operation));
    maximum = Math.max(maximum, kinds.size);
  }
  return maximum;
}

function executionFreshness(records: readonly { readonly kind: string; readonly value: unknown }[]): boolean {
  const executeDecisions = records.filter(value => value.kind === 'joint-control-decision').flatMap(record => {
    const snapshot = record.value as { readonly lastDecision?: { readonly operation?: string;
      readonly nodeId?: string | null }; readonly workspace?: { readonly observationSequence?: number | null;
      readonly nodes?: readonly { readonly node?: { readonly nodeId?: string; readonly kind?: string };
        readonly condition?: { readonly fresh?: boolean; readonly observationSequence?: number } | null;
        readonly prediction?: { readonly fresh?: boolean; readonly observationSequence?: number;
          readonly value?: BranchPredictionV1 } | null }[] } };
    if (snapshot.lastDecision?.operation !== 'execute' || !snapshot.lastDecision.nodeId) return [];
    const node = snapshot.workspace?.nodes?.find(item => item.node?.nodeId === snapshot.lastDecision!.nodeId);
    if (node?.node?.kind === 'exploration') return [{ fresh: false, qualified: false }];
    const sequence = snapshot.workspace?.observationSequence;
    const prediction = node?.prediction?.value;
    const qualified = Boolean(prediction && prediction.validSampleCount >= 8
      && prediction.progressFraction >= .75 && prediction.prediction.samples.length === 24);
    return [{ fresh: node?.condition?.fresh === true && node.prediction?.fresh === true
      && node.condition.observationSequence === sequence
      && node.prediction.observationSequence === sequence, qualified }];
  });
  return executeDecisions.length > 0 && executeDecisions.every(value => value.fresh && value.qualified);
}

function requestAudit(records: readonly { readonly kind: string; readonly value: unknown }[]): {
  readonly unique: boolean; readonly parentResume: number; readonly staleOffers: number } {
  const requestIds = records.filter(value => value.kind === 'control-operation-result').flatMap(record => {
    const value = record.value as { readonly event?: { readonly requestId?: string } };
    return value.event?.requestId ? [value.event.requestId] : [];
  });
  return { unique: new Set(requestIds).size === requestIds.length,
    parentResume: records.filter(value => /parent.*resume|resume.*parent/i.test(value.kind)).length,
    staleOffers: records.filter(value => value.kind === 'control-action-reality-refusal'
      && (value.value as { readonly reason?: string }).reason === 'offer-stale').length };
}

export async function runDistributedG5NeutralCaseV1(baseline: DistributedG5SharedBaselineV1,
  plan: DistributedG5NeutralCasePlanV1): Promise<DistributedG5NeutralCaseAuditV1> {
  validateDistributedG5SharedBaselineV1(baseline);
  const baselineBefore = sha(baseline.snapshot);
  assert(baselineBefore === baseline.snapshotSha256, 'g5-frozen-baseline-was-mutated-before-case');
  const memory = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(baseline.snapshot));
  const memoryBefore = sha(memory.snapshot());
  const reasoning = new OpaquePermutationReasoningPortV1(memory, plan.variant);
  const environment = new NeutralControlEnvironmentV1(memory, plan,
    new NeutralEventClockV1(baseline.nextObservationSequence, baseline.activeSeconds));
  const manager = new PhysicalControlManagerV2(reasoning, environment,
    configuration(plan.fieldSeed), undefined, { requirePredictionProgress: true });
  const started = performance.now();
  let result: PhysicalControlResultV2 | null = null, error: string | null = null;
  try { result = await manager.runGoal(GOALS[plan.depth]); }
  catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const durationMs = performance.now() - started;
  const memoryAfter = sha(memory.snapshot()), baselineAfter = sha(baseline.snapshot);
  const dependencies = maximumDependencyDepth(manager.snapshot);
  const requests = requestAudit(environment.records);
  const milestone = transitionMilestones(plan.depth, environment.transitions);
  const verification = environment.timeline.at(-1) === 'observe';
  const extra = environment.transitions.filter(value => value.role !== 'observe'
    && !value.changed.some(change => plan.depth === 2 ? ['P', 'F'].includes(change)
      : ['P', 'F', 'R'].includes(change))).length;
  const predictionSamples = reasoning.predictionInvocations
    .reduce((sum, value) => sum + value.sampleCount, 0);
  const fresh = executionFreshness(environment.records);
  const goalVerified = result?.status === 'goal-verified'
    && (plan.depth === 2 ? environment.state.F : environment.state.R);
  const noEvaluationEvidence = [...reasoning.exposedEvidenceEventIds]
    .every(id => baseline.snapshot.seenEventIds.includes(id));
  const allPredictionsHave24 = reasoning.predictionInvocations.length > 0
    && reasoning.predictionInvocations.every(value => value.sampleCount === 24);
  const passed = error === null && goalVerified && milestone && verification && extra === 0
    && dependencies.depth >= plan.depth && concurrentOperationKinds(environment.records) >= 2
    && fresh && allPredictionsHave24 && requests.unique && requests.parentResume === 0
    && requests.staleOffers === 0 && memoryBefore === memoryAfter
    && baselineBefore === baselineAfter && noEvaluationEvidence;
  return { version: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
    caseId: plan.caseId, depth: plan.depth, variantId: plan.variant.variantId,
    fieldSeed: plan.fieldSeed, result, error, durationMs,
    actionTimeline: [...environment.timeline], stateTransitions: structuredClone(environment.transitions),
    goalVerified, causalMilestonesSatisfied: milestone,
    verificationObserveCompleted: verification, extraOrNoEffectExplorationCount: extra,
    dependencyDepth: dependencies.depth, retainedDependencyCount: dependencies.count,
    maximumConcurrentNonZeroOperationKinds: concurrentOperationKinds(environment.records),
    freshExecutionEvidence: fresh,
    physicalPredictionInvocations: reasoning.predictionInvocations.length,
    physicalPredictionSamples: predictionSamples,
    physicalPredictionMicrosteps: reasoning.predictionInvocations.length * 24 * 180,
    predictionInvocations: structuredClone(reasoning.predictionInvocations),
    allPhysicalPredictionCallsHave24Seeds: allPredictionsHave24,
    allExecutedPhysicalBranchesMeetG5Gate: fresh,
    predictionResultCacheUsed: false, expectedActionOrderInjected: false,
    offerOrder: [...plan.variant.offerOrder], requestIdsUnique: requests.unique,
    parentStackResumeRecordCount: requests.parentResume, staleOfferRefusalCount: requests.staleOffers,
    frozenBaselineHashBefore: baselineBefore, frozenBaselineHashAfter: baselineAfter,
    isolatedMemoryHashBefore: memoryBefore, isolatedMemoryHashAfter: memoryAfter,
    physicalMemoryReadOnly: memoryBefore === memoryAfter,
    evaluationEventsUsedAsPhysicalEvidence: 0,
    passed };
}

export async function runDistributedG5NeutralCanaryWithBaselineV1(
  baseline: DistributedG5SharedBaselineV1, options: {
    readonly depth?: NeutralDepthV1; readonly variantIndex?: number; readonly seedIndex?: number } = {},
  baselineBuildMs = 0):
Promise<{ readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  readonly baseline: DistributedG5SharedBaselineAuditV1; readonly baselineSha256: string;
  readonly baselineBuildMs: number; readonly case: DistributedG5NeutralCaseAuditV1 }> {
  validateDistributedG5SharedBaselineV1(baseline);
  const plan = createDistributedG5NeutralMatrixPlanV1();
  const depth = options.depth ?? 2;
  const values = depth === 2 ? plan.twoStepCases : plan.threeStepCases;
  const variantIndex = options.variantIndex ?? 0, seedIndex = options.seedIndex ?? 0;
  assert(variantIndex >= 0 && variantIndex < 4, 'g5-canary-variant-index-out-of-range');
  const perVariant = depth === 2 ? 8 : 16;
  assert(seedIndex >= 0 && seedIndex < perVariant, 'g5-canary-seed-index-out-of-range');
  const selected = values[variantIndex * perVariant + seedIndex]!;
  return { version: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
    baseline: baseline.audit, baselineSha256: baseline.snapshotSha256, baselineBuildMs,
    case: await runDistributedG5NeutralCaseV1(baseline, selected) };
}

export async function runDistributedG5NeutralCanaryV1(options: {
  readonly depth?: NeutralDepthV1; readonly variantIndex?: number; readonly seedIndex?: number } = {}):
Promise<{ readonly version: typeof DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1;
  readonly baseline: DistributedG5SharedBaselineAuditV1; readonly baselineSha256: string;
  readonly baselineBuildMs: number; readonly case: DistributedG5NeutralCaseAuditV1 }> {
  const baselineStarted = performance.now();
  const baseline = buildDistributedG5Shared128EventBaselineV1();
  return runDistributedG5NeutralCanaryWithBaselineV1(baseline, options,
    performance.now() - baselineStarted);
}

export async function runDistributedG5NeutralMatrixWithBaselineV1(
  baseline: DistributedG5SharedBaselineV1, baselineBuildMs = 0):
Promise<DistributedG5NeutralMatrixAuditV1> {
  const started = performance.now();
  validateDistributedG5SharedBaselineV1(baseline);
  const plan = createDistributedG5NeutralMatrixPlanV1();
  const cases: DistributedG5NeutralCaseAuditV1[] = [];
  // Deliberately sequential: every case restores the same immutable physical
  // baseline and owns a fresh controller, field, environment and habit state.
  for (const item of [...plan.twoStepCases, ...plan.threeStepCases])
    cases.push(await runDistributedG5NeutralCaseV1(baseline, item));
  const twoStepPassed = cases.filter(value => value.depth === 2 && value.passed).length;
  const threeStepPassed = cases.filter(value => value.depth === 3 && value.passed).length;
  return { version: DISTRIBUTED_G5_NEUTRAL_CONTROL_VERSION_V1,
    baseline: baseline.audit, baselineSha256: baseline.snapshotSha256, baselineBuildMs,
    caseCount: cases.length, twoStepPassed, twoStepRequired: 32,
    threeStepPassed, threeStepRequired: 64, cases,
    totalDurationMs: performance.now() - started,
    fullMatrixPassed: twoStepPassed === 32 && threeStepPassed === 64,
    performanceBoundary: { executionMode: 'sequential-isolated-cases', baselineBuiltOnce: true,
      candidatePredictionCache: 'disabled',
      predictionWorkIsPhysicalInvocationsTimes24SeedsTimes180Steps: true } };
}

export async function runDistributedG5NeutralMatrixV1(): Promise<DistributedG5NeutralMatrixAuditV1> {
  const baselineStarted = performance.now();
  const baseline = buildDistributedG5Shared128EventBaselineV1();
  return runDistributedG5NeutralMatrixWithBaselineV1(baseline,
    performance.now() - baselineStarted);
}
