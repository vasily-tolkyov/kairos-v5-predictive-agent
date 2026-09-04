import type { Observation } from '../contracts.js';
import type { AttentionNotice } from '../attention/monitor.js';
import { cueIdentity } from '../events.js';
import { assert, canonical, sha } from '../util.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1, GroundedGoalV1, GoalEvaluationV1,
  OpaqueFactorTransitionTraceV1 } from './contracts.js';

export type JointControlOperationV2 = 'recall-effect' | 'compare-condition' | 'predict-branch'
  | 'expand-condition' | 'execute' | 'observe-public' | 'finish-verified' | 'finish-unknown';
export type ControlWorkspaceNodeKindV2 = 'root' | 'public-requirement'
  | 'experienced' | 'factor-transition' | 'exploration';
export type ControlRequestChannelV2 = 'reasoning' | 'body';

interface WorkspaceNodeBaseV2 {
  readonly nodeId: string;
  readonly kind: ControlWorkspaceNodeKindV2;
  readonly createdEpoch: number;
  readonly createdObservationSequence: number | null;
}
export type ControlWorkspaceNodeV2 =
  | (WorkspaceNodeBaseV2 & { readonly kind: 'root'; readonly goal: GroundedGoalV1 })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'public-requirement'; readonly goal: GroundedGoalV1 })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'experienced'; readonly candidate: EffectRecallCandidateV1;
      /** Canonically ordered, losslessly retained physical events sharing the
       * exact control grouping identity. `candidate` is only the first audit
       * member; decisions must inspect `candidateMembers`. */
      readonly candidateMembers?: readonly EffectRecallCandidateV1[];
      readonly physicalGroupKey?: string;
      /** Goal node whose effect query produced this branch. */
      readonly objectiveNodeId: string })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'factor-transition'; readonly transition: OpaqueFactorTransitionTraceV1;
      readonly transitionMembers?: readonly OpaqueFactorTransitionTraceV1[];
      readonly physicalGroupKey?: string })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'exploration'; readonly offer: ActionOfferV1 });

export interface ControlDependencyEdgeV2 {
  readonly edgeId: string;
  /** The branch which cannot yet proceed. It remains active while requirements compete. */
  readonly dependentNodeId: string;
  /** One physical transition branch which may establish the missing opaque factor. */
  readonly requiredNodeId: string;
  readonly factorIds: readonly string[];
  readonly kind: 'opaque-factor' | 'public-action-requirement'
    | 'historical-transition-precondition' | 'public-requirement-candidate';
  readonly createdEpoch: number;
  readonly createdObservationSequence: number;
}

export interface VersionedControlEvidenceV2<T> {
  readonly requestId: string;
  readonly epoch: number;
  readonly observationSequence: number;
  readonly value: T;
  readonly invalidatedBy: 'attention' | 'action' | null;
}

export interface ControlRequestV2 {
  readonly requestId: string;
  readonly channel: ControlRequestChannelV2;
  readonly operation: JointControlOperationV2;
  readonly nodeId: string;
  readonly epoch: number;
  readonly baseSequence: number;
  readonly factorIds: readonly string[];
  readonly invalidated: boolean;
}

export interface BeginControlRequestV2 {
  readonly requestId: string;
  readonly channel: ControlRequestChannelV2;
  readonly operation: JointControlOperationV2;
  readonly nodeId: string;
  readonly baseSequence: number;
  readonly factorIds?: readonly string[];
}

export interface ControlActionCompletionV2 {
  readonly executed: boolean;
  readonly observation: Observation;
  readonly result: unknown;
}

/** One recall response keeps the atomic action-bearing evidence separate from
 * actionless continuous patterns. A pattern can only augment an experienced
 * branch after sharing an actual R2A relation with one of its atomic members. */
export interface PhysicalRecallBundleV2 {
  readonly version: 'PhysicalRecallBundleV2';
  readonly atomicCandidates: readonly EffectRecallCandidateV1[];
  readonly continuousPatterns: readonly ContinuousPatternRecallV2[];
}

export interface BoundContinuousPatternV2 {
  readonly pattern: ContinuousPatternRecallV2;
  readonly sharedRelationIds: readonly string[];
}

export interface BoundContinuationPredictionV2 {
  readonly candidateId: string;
  readonly patternId: string;
  readonly sharedRelationIds: readonly string[];
  readonly value: ContinuationPredictionV2;
}

export interface ControlBranchPredictionResultV2 {
  readonly version: 'ControlBranchPredictionResultV2';
  readonly atomic: BranchPredictionV1;
  readonly continuations: readonly BoundContinuationPredictionV2[];
}

type OperationCompletedBaseV2 = {
  readonly kind: 'operation-completed';
  readonly requestId: string;
  readonly epoch: number;
  readonly nodeId: string;
  readonly baseSequence: number;
};
export type ControlOperationCompletedEventV2 = OperationCompletedBaseV2 & (
  | { readonly operation: 'recall-effect'; readonly result: PhysicalRecallBundleV2 }
  | { readonly operation: 'compare-condition'; readonly result: ConditionApplicabilityV1 }
  | { readonly operation: 'predict-branch'; readonly result: ControlBranchPredictionResultV2 }
  | { readonly operation: 'expand-condition'; readonly result: readonly OpaqueFactorTransitionTraceV1[] }
);

export type ControlEventV2 =
  | { readonly kind: 'observation'; readonly observation: Observation; readonly offers: readonly ActionOfferV1[];
      readonly goalEvaluation: GoalEvaluationV1 }
  | ControlOperationCompletedEventV2
  | { readonly kind: 'operation-failed'; readonly requestId: string; readonly epoch: number;
      readonly operation: JointControlOperationV2; readonly nodeId: string; readonly baseSequence: number;
      readonly error: unknown }
  | { readonly kind: 'action-completed'; readonly requestId: string; readonly nodeId: string;
      readonly result: ControlActionCompletionV2 }
  | { readonly kind: 'attention'; readonly notice: AttentionNotice };

export interface WorkspaceIngestionResultV2 {
  readonly accepted: boolean;
  readonly reason: string;
  readonly registeredNodeIds: readonly string[];
}

interface MutableNodeStateV2 {
  node: ControlWorkspaceNodeV2;
  continuousPatterns: readonly BoundContinuousPatternV2[];
  condition: VersionedControlEvidenceV2<ConditionApplicabilityV1> | null;
  prediction: VersionedControlEvidenceV2<BranchPredictionV1> | null;
  continuationPredictions: VersionedControlEvidenceV2<readonly BoundContinuationPredictionV2[]> | null;
  lastActionResult: ControlActionCompletionV2 | null;
}

export interface ControlWorkspaceNodeSnapshotV2 {
  readonly node: ControlWorkspaceNodeV2;
  readonly continuousPatterns: readonly BoundContinuousPatternV2[];
  readonly condition: (VersionedControlEvidenceV2<ConditionApplicabilityV1> & { readonly fresh: boolean }) | null;
  readonly prediction: (VersionedControlEvidenceV2<BranchPredictionV1> & { readonly fresh: boolean }) | null;
  readonly continuationPredictions: (VersionedControlEvidenceV2<readonly BoundContinuationPredictionV2[]>
    & { readonly fresh: boolean }) | null;
  readonly lastActionResult: ControlActionCompletionV2 | null;
}

export interface ControlWorkspaceSnapshotV2 {
  readonly version: 'ControlWorkspaceV2';
  readonly goalId: string | null;
  readonly rootNodeId: string | null;
  readonly epoch: number;
  readonly observationSequence: number | null;
  readonly observation: Observation | null;
  readonly offers: readonly ActionOfferV1[];
  readonly goalEvaluation: GoalEvaluationV1 | null;
  readonly nodes: readonly ControlWorkspaceNodeSnapshotV2[];
  readonly dependencies: readonly ControlDependencyEdgeV2[];
  readonly pendingRequests: readonly ControlRequestV2[];
  readonly completedOperations: readonly CompletedControlOperationV2[];
  readonly attentionNotices: readonly AttentionNotice[];
  readonly lastFailure: { readonly requestId: string; readonly error: unknown } | null;
}

export interface CompletedControlOperationV2 {
  readonly requestId: string;
  readonly operation: 'recall-effect' | 'compare-condition' | 'predict-branch' | 'expand-condition';
  readonly nodeId: string;
  readonly epoch: number;
  readonly baseSequence: number;
  readonly resultCount: number;
}

const reasoningOperations = new Set<JointControlOperationV2>(
  ['recall-effect', 'compare-condition', 'predict-branch', 'expand-condition']);
const bodyOperations = new Set<JointControlOperationV2>(['execute', 'observe-public']);
const experiencedNodeId = (objectiveNodeId: string, candidateId: string, rootObjective: boolean): string =>
  rootObjective ? `experienced:${candidateId}` : `experienced:${sha([objectiveNodeId, candidateId])}:${candidateId}`;
const transitionNodeId = (physicalGroupKey: string): string => `factor-transition:${physicalGroupKey}`;
// An offerId is bound to one raw observation sequence.  Using it as the
// transient branch identity created the same legal action again at every
// Minecraft physics tick and made a stationary scene grow without bound.
// The branch identity is the exact action cue plus its real public target;
// the stored offer is refreshed to the newest observation before execution.
const explorationNodeId = (offer: ActionOfferV1): string => `exploration:${sha({
  cue: cueIdentity(offer.cue), targetId: offer.action.targetId ?? null,
})}`;
// One grounded public fact is one transient objective even when several
// remembered branches currently depend on it.  The dependency edges preserve
// all parent links; including a parent in this identity would duplicate the
// same question and crowd the finite control field with aliases.
const publicRequirementNodeId = (goal: GroundedGoalV1): string =>
  `public-requirement:${sha(goal)}`;

const effectSignature = (changes: readonly EffectRecallCandidateV1['observedChanges'][number][]) =>
  changes.map(change => ({ subject: change.subject, property: change.property,
    before: change.before, after: change.after, meaning: change.meaning }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));

function physicalEvidenceGroupingIdentity(evidence: EffectRecallCandidateV1['evidence']) {
  return { version: 'distributed-physical-control-group-v3',
    r1AttractorId: evidence.r1.attractorId,
    r2CorridorId: evidence.r2.corridorId,
    r2aPatternIds: [...evidence.r2a.patternIds].sort(),
    r2aRelationIds: [...evidence.r2a.relationIds].sort() };
}

/** Exact, non-semantic identity allowed to reduce finite control-field load. */
export function effectCandidatePhysicalGroupKeyV1(objectiveNodeId: string,
  candidate: EffectRecallCandidateV1): string {
  return sha({ objectiveNodeId, exactCue: cueIdentity(candidate.actionCue),
    r2Basin: physicalEvidenceGroupingIdentity(candidate.evidence),
    relationIds: [...candidate.evidence.r2a.relationIds].sort(),
    effectSignature: effectSignature(candidate.observedChanges) });
}

/**
 * A parent branch says who currently needs a transition; it is not part of
 * the transition's physical identity.  Keeping the parent in this key made
 * one real R1/R2/R2A branch appear once per ancestor and recursively crowded
 * the finite control field with aliases.
 */
export function factorTransitionPhysicalGroupKeyV2(
  transition: OpaqueFactorTransitionTraceV1): string {
  return sha({ version: 'factor-transition-physical-group-v2', exactCue: cueIdentity(transition.actionCue),
    r2Basin: physicalEvidenceGroupingIdentity(transition.evidence),
    relationIds: [...transition.evidence.r2a.relationIds].sort(),
    evidenceGrade: transition.evidence.r2a.evidenceGrade ?? null,
    predictionEligible: transition.evidence.r2a.predictionEligible ?? false,
    effectSignature: { activated: [...transition.activatedFactorIds].sort(),
      deactivated: [...transition.deactivatedFactorIds].sort(),
      unchangedActive: [...transition.unchangedActiveFactorIds].sort() } });
}

export function groupEffectCandidatesForControlV1(objectiveNodeId: string,
  candidates: readonly EffectRecallCandidateV1[]): readonly {
    readonly physicalGroupKey: string; readonly members: readonly EffectRecallCandidateV1[];
  }[] {
  const grouped = new Map<string, EffectRecallCandidateV1[]>();
  for (const candidate of candidates) {
    const key = effectCandidatePhysicalGroupKeyV1(objectiveNodeId, candidate);
    const members = grouped.get(key) ?? []; members.push(structuredClone(candidate)); grouped.set(key, members);
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([physicalGroupKey, members]) => ({
    physicalGroupKey,
    members: members.sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en')),
  }));
}

export function groupFactorTransitionsForControlV2(
  transitions: readonly OpaqueFactorTransitionTraceV1[]): readonly {
    readonly physicalGroupKey: string; readonly members: readonly OpaqueFactorTransitionTraceV1[];
  }[] {
  const grouped = new Map<string, OpaqueFactorTransitionTraceV1[]>();
  for (const transition of transitions) {
    const key = factorTransitionPhysicalGroupKeyV2(transition);
    const members = grouped.get(key) ?? []; members.push(structuredClone(transition)); grouped.set(key, members);
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([physicalGroupKey, members]) => ({
    physicalGroupKey,
    members: members.sort((left, right) => left.transitionId.localeCompare(right.transitionId, 'en')),
  }));
}

/**
 * Keep control/audit snapshots bounded without changing the live physical
 * prediction. The controller needs readouts and outcome counts; the complete
 * integration path remains available only on the immediate PhysicalMemory
 * result. Endpoints plus the original count make this projection explicit.
 */
export function compactBranchPredictionForControlAuditV2(
  value: BranchPredictionV1,
): BranchPredictionV1 {
  const compactSingle = (single: Omit<BranchPredictionV1, 'memberResults' | 'winningCandidateId'>) =>
    structuredClone(single);
  const { memberResults, winningCandidateId, ...single } = value;
  return { ...compactSingle(single),
    ...(memberResults ? { memberResults: memberResults.map(member => ({ candidateId: member.candidateId,
      value: compactSingle(member.value) })) } : {}),
    ...(winningCandidateId !== undefined ? { winningCandidateId } : {}) };
}

/**
 * Persistent-in-a-run dependency workspace for joint control. It stores evidence and graph
 * continuity, but never decides an operation, creates a semantic subgoal, or writes memory.
 */
export class ControlWorkspaceV2 {
  readonly #nodes = new Map<string, MutableNodeStateV2>();
  readonly #dependencies = new Map<string, ControlDependencyEdgeV2>();
  readonly #pending = new Map<string, ControlRequestV2>();
  readonly #usedRequestIds = new Set<string>();
  readonly #completedOperations: CompletedControlOperationV2[] = [];
  readonly #attentionNotices: AttentionNotice[] = [];
  #goalId: string | null = null;
  #rootNodeId: string | null = null;
  #epoch = 0;
  #observation: Observation | null = null;
  #offers: readonly ActionOfferV1[] = [];
  #goalEvaluation: GoalEvaluationV1 | null = null;
  #lastFailure: { readonly requestId: string; readonly error: unknown } | null = null;

  setGoal(goal: GroundedGoalV1): string {
    this.#nodes.clear(); this.#dependencies.clear(); this.#pending.clear(); this.#usedRequestIds.clear();
    this.#completedOperations.length = 0;
    this.#attentionNotices.length = 0; this.#observation = null; this.#offers = []; this.#goalEvaluation = null;
    this.#lastFailure = null; this.#epoch++;
    this.#goalId = goal.id; this.#rootNodeId = `root:${goal.id}`;
    this.#nodes.set(this.#rootNodeId, { node: { nodeId: this.#rootNodeId, kind: 'root', goal: structuredClone(goal),
      createdEpoch: this.#epoch, createdObservationSequence: null }, continuousPatterns: [], condition: null, prediction: null,
    continuationPredictions: null,
    lastActionResult: null });
    return this.#rootNodeId;
  }

  registerExploration(offer: ActionOfferV1): string {
    this.#requireGoal();
    const nodeId = explorationNodeId(offer);
    this.#upsertNode({ nodeId, kind: 'exploration', offer: structuredClone(offer), createdEpoch: this.#epoch,
      createdObservationSequence: offer.observationSequence });
    return nodeId;
  }

  /**
   * Preserve a body's missing public fact as a transient goal node.  The body
   * supplies no method for satisfying it; effect recall must populate any
   * candidate branches later.
   */
  registerPublicRequirement(dependentNodeId: string, goal: GroundedGoalV1,
    kind: 'public-action-requirement' | 'historical-transition-precondition' =
      'public-action-requirement'): string {
    this.#requireGoal(); this.#requireNode(dependentNodeId);
    const nodeId = publicRequirementNodeId(goal);
    this.#upsertNode({ nodeId, kind: 'public-requirement', goal: structuredClone(goal),
      createdEpoch: this.#epoch, createdObservationSequence: this.#observation?.sequence ?? null });
    this.#addDependency(dependentNodeId, nodeId, [], kind);
    return nodeId;
  }

  addDependency(dependentNodeId: string, requiredNodeId: string, factorIds: readonly string[]): WorkspaceIngestionResultV2 {
    return this.#addDependency(dependentNodeId, requiredNodeId, factorIds, 'opaque-factor');
  }

  #addDependency(dependentNodeId: string, requiredNodeId: string, factorIds: readonly string[],
    kind: ControlDependencyEdgeV2['kind']): WorkspaceIngestionResultV2 {
    this.#requireNode(dependentNodeId); this.#requireNode(requiredNodeId);
    const normalizedFactors = [...new Set(factorIds)].sort((left, right) => left.localeCompare(right, 'en'));
    if (dependentNodeId === requiredNodeId || this.#hasDependencyPath(requiredNodeId, dependentNodeId))
      return { accepted: false, reason: 'dependency-cycle-rejected', registeredNodeIds: [] };
    const edgeId = `requires:${JSON.stringify([kind, dependentNodeId, requiredNodeId, normalizedFactors])}`;
    if (!this.#dependencies.has(edgeId)) this.#dependencies.set(edgeId, { edgeId, dependentNodeId, requiredNodeId,
      factorIds: normalizedFactors, kind, createdEpoch: this.#epoch,
      createdObservationSequence: this.#observation?.sequence ?? 0 });
    return { accepted: true, reason: 'dependency-recorded', registeredNodeIds: [requiredNodeId] };
  }

  beginRequest(input: BeginControlRequestV2): ControlRequestV2 {
    this.#requireGoal(); this.#requireNode(input.nodeId);
    assert(!this.#usedRequestIds.has(input.requestId), 'control-request-id-reused');
    assert(this.#observation && input.baseSequence === this.#observation.sequence,
      'control-request-base-sequence-not-current');
    assert(input.channel === 'reasoning' ? reasoningOperations.has(input.operation) : bodyOperations.has(input.operation),
      'control-request-channel-operation-mismatch');
    assert(![...this.#pending.values()].some(request => request.channel === input.channel),
      `control-${input.channel}-request-already-in-flight`);
    const request: ControlRequestV2 = { ...structuredClone(input), epoch: this.#epoch,
      factorIds: [...new Set(input.factorIds ?? [])].sort((left, right) => left.localeCompare(right, 'en')),
      invalidated: false };
    this.#pending.set(request.requestId, request); this.#usedRequestIds.add(request.requestId);
    return structuredClone(request);
  }

  ingest(event: ControlEventV2): WorkspaceIngestionResultV2 {
    switch (event.kind) {
      case 'observation': return this.#ingestObservation(event);
      case 'attention': return this.#ingestAttention(event.notice);
      case 'action-completed': return this.#ingestAction(event);
      case 'operation-failed': return this.#ingestFailure(event);
      case 'operation-completed': return this.#ingestOperation(event);
    }
  }

  currentCondition(nodeId: string): ConditionApplicabilityV1 | null {
    const evidence = this.#requireNode(nodeId).condition;
    return this.#fresh(evidence) ? structuredClone(evidence.value) : null;
  }

  currentPrediction(nodeId: string): BranchPredictionV1 | null {
    const evidence = this.#requireNode(nodeId).prediction;
    return this.#fresh(evidence) ? structuredClone(evidence.value) : null;
  }

  currentContinuationPredictions(nodeId: string): readonly BoundContinuationPredictionV2[] | null {
    const evidence = this.#requireNode(nodeId).continuationPredictions;
    return this.#fresh(evidence) ? structuredClone(evidence.value) : null;
  }

  hasCompleted(operation: CompletedControlOperationV2['operation'], nodeId: string,
    options: { readonly currentEpoch?: boolean; readonly currentObservation?: boolean } = {}): boolean {
    return this.#completedOperations.some(value => value.operation === operation && value.nodeId === nodeId
      && (!options.currentEpoch || value.epoch === this.#epoch)
      && (!options.currentObservation || value.baseSequence === this.#observation?.sequence));
  }

  snapshot(): ControlWorkspaceSnapshotV2 {
    const sequence = this.#observation?.sequence ?? null;
    const nodes = [...this.#nodes.values()].map(state => ({ node: structuredClone(state.node),
      continuousPatterns: structuredClone(state.continuousPatterns),
      condition: state.condition ? { ...structuredClone(state.condition), fresh: this.#fresh(state.condition) } : null,
      prediction: state.prediction ? {
        requestId: state.prediction.requestId,
        epoch: state.prediction.epoch,
        observationSequence: state.prediction.observationSequence,
        invalidatedBy: state.prediction.invalidatedBy,
        value: compactBranchPredictionForControlAuditV2(state.prediction.value),
        fresh: this.#fresh(state.prediction),
      } : null,
      continuationPredictions: state.continuationPredictions ? {
        ...structuredClone(state.continuationPredictions), fresh: this.#fresh(state.continuationPredictions),
      } : null,
      lastActionResult: state.lastActionResult ? structuredClone(state.lastActionResult) : null }))
      .sort((left, right) => left.node.nodeId.localeCompare(right.node.nodeId, 'en'));
    return { version: 'ControlWorkspaceV2', goalId: this.#goalId, rootNodeId: this.#rootNodeId,
      epoch: this.#epoch, observationSequence: sequence,
      observation: this.#observation ? structuredClone(this.#observation) : null,
      offers: structuredClone(this.#offers), goalEvaluation: this.#goalEvaluation ? structuredClone(this.#goalEvaluation) : null,
      nodes, dependencies: [...this.#dependencies.values()].map(value => structuredClone(value))
        .sort((left, right) => left.edgeId.localeCompare(right.edgeId, 'en')),
      pendingRequests: [...this.#pending.values()].map(value => structuredClone(value))
        .sort((left, right) => left.requestId.localeCompare(right.requestId, 'en')),
      completedOperations: structuredClone(this.#completedOperations),
      attentionNotices: structuredClone(this.#attentionNotices),
      lastFailure: this.#lastFailure ? structuredClone(this.#lastFailure) : null };
  }

  #ingestObservation(event: Extract<ControlEventV2, { kind: 'observation' }>): WorkspaceIngestionResultV2 {
    this.#requireGoal();
    if (this.#observation && (event.observation.sequence < this.#observation.sequence
      || (event.observation.sequence === this.#observation.sequence && this.#goalEvaluation !== null)))
      return { accepted: false, reason: 'stale-or-out-of-order-observation', registeredNodeIds: [] };
    if (event.goalEvaluation.goalId !== this.#goalId
      || event.goalEvaluation.observationSequence !== event.observation.sequence)
      return { accepted: false, reason: 'observation-goal-evaluation-mismatch', registeredNodeIds: [] };
    if (event.offers.some(offer => offer.observationSequence !== event.observation.sequence))
      return { accepted: false, reason: 'observation-offer-sequence-mismatch', registeredNodeIds: [] };
    this.#observation = structuredClone(event.observation); this.#offers = structuredClone(event.offers);
    this.#goalEvaluation = structuredClone(event.goalEvaluation);
    return { accepted: true, reason: 'observation-accepted', registeredNodeIds: [] };
  }

  #ingestAttention(notice: AttentionNotice): WorkspaceIngestionResultV2 {
    this.#requireGoal(); this.#epoch++; this.#attentionNotices.push(structuredClone(notice));
    this.#invalidateTransientEvidence('attention'); this.#invalidatePending();
    return { accepted: true, reason: 'attention-retained-graph-and-invalidated-transient-evidence', registeredNodeIds: [] };
  }

  #ingestAction(event: Extract<ControlEventV2, { kind: 'action-completed' }>): WorkspaceIngestionResultV2 {
    const request = this.#pending.get(event.requestId);
    if (!request || request.channel !== 'body' || request.nodeId !== event.nodeId)
      return { accepted: false, reason: 'unknown-or-mismatched-action-request', registeredNodeIds: [] };
    this.#pending.delete(event.requestId);
    this.#requireNode(event.nodeId).lastActionResult = structuredClone(event.result);
    this.#epoch++; this.#invalidateTransientEvidence('action'); this.#invalidatePending();
    if (!this.#observation || event.result.observation.sequence > this.#observation.sequence) {
      this.#observation = structuredClone(event.result.observation); this.#offers = []; this.#goalEvaluation = null;
    }
    return { accepted: true, reason: 'real-action-result-accepted', registeredNodeIds: [] };
  }

  #ingestFailure(event: Extract<ControlEventV2, { kind: 'operation-failed' }>): WorkspaceIngestionResultV2 {
    const request = this.#pending.get(event.requestId);
    if (!request || !this.#sameRequest(request, event))
      return { accepted: false, reason: 'unknown-or-mismatched-failed-request', registeredNodeIds: [] };
    this.#pending.delete(event.requestId); this.#lastFailure = { requestId: event.requestId, error: structuredClone(event.error) };
    return { accepted: true, reason: 'operation-failure-recorded', registeredNodeIds: [] };
  }

  #ingestOperation(event: ControlOperationCompletedEventV2): WorkspaceIngestionResultV2 {
    const request = this.#pending.get(event.requestId);
    if (!request || !this.#sameRequest(request, event))
      return { accepted: false, reason: 'unknown-or-mismatched-operation-result', registeredNodeIds: [] };
    this.#pending.delete(event.requestId);
    // Historical recall is goal-bound evidence. A newer public frame or attention
    // epoch does not turn a real past event into a different event. State-bound
    // comparisons, rollouts and factor expansion remain strict.
    if (event.operation !== 'recall-effect' && (request.invalidated || event.epoch !== this.#epoch))
      return { accepted: false, reason: 'stale-operation-epoch', registeredNodeIds: [] };
    if ((event.operation === 'compare-condition' || event.operation === 'predict-branch')
      && this.#observation?.sequence !== event.baseSequence)
      return { accepted: false, reason: 'stale-operation-observation', registeredNodeIds: [] };
    this.#completedOperations.push({ requestId: event.requestId, operation: event.operation,
      nodeId: event.nodeId, epoch: event.epoch, baseSequence: event.baseSequence,
      resultCount: event.operation === 'recall-effect' ? event.result.atomicCandidates.length
        + event.result.continuousPatterns.length : event.operation === 'expand-condition' ? event.result.length : 1 });
    if (this.#completedOperations.length > 128) this.#completedOperations.splice(0, this.#completedOperations.length - 128);
    if (event.operation === 'recall-effect') {
      const objectiveState = this.#requireNode(event.nodeId);
      objectiveState.continuousPatterns = event.result.continuousPatterns.map(pattern => ({
        pattern: structuredClone(pattern), sharedRelationIds: [],
      }));
      const registered = groupEffectCandidatesForControlV1(event.nodeId, event.result.atomicCandidates)
        .map(group => this.#registerExperienced(event.nodeId, group.physicalGroupKey, group.members));
      for (const nodeId of registered) {
        const branch = this.#requireNode(nodeId);
        const relationIds = new Set((branch.node.kind === 'experienced'
          ? branch.node.candidateMembers ?? [branch.node.candidate] : [])
          .flatMap(candidate => candidate.evidence.r2a.relationIds));
        branch.continuousPatterns = event.result.continuousPatterns.flatMap(pattern => {
          const sharedRelationIds = [...new Set(pattern.currentRelationIds ?? [])]
            .filter(relationId => relationIds.has(relationId)).sort((left, right) => left.localeCompare(right, 'en'));
          return sharedRelationIds.length ? [{ pattern: structuredClone(pattern), sharedRelationIds }] : [];
        });
      }
      if (this.#requireNode(event.nodeId).node.kind === 'public-requirement')
        for (const nodeId of registered) this.#addDependency(event.nodeId, nodeId, [], 'public-requirement-candidate');
      return { accepted: true, reason: 'historical-effect-recall-accepted', registeredNodeIds: registered };
    }
    if (event.operation === 'expand-condition') {
      const registered: string[] = [];
      for (const group of groupFactorTransitionsForControlV2(event.result)) {
        const nodeId = this.#registerTransition(event.nodeId, group.physicalGroupKey, group.members); registered.push(nodeId);
        this.addDependency(event.nodeId, nodeId, request.factorIds);
      }
      return { accepted: true, reason: 'factor-transition-recall-accepted', registeredNodeIds: registered };
    }
    const state = this.#requireNode(event.nodeId);
    if (event.operation === 'compare-condition') state.condition = { requestId: event.requestId, epoch: event.epoch,
      observationSequence: event.baseSequence, value: structuredClone(event.result), invalidatedBy: null };
    else {
      state.prediction = { requestId: event.requestId, epoch: event.epoch,
        observationSequence: event.baseSequence, value: structuredClone(event.result.atomic), invalidatedBy: null };
      state.continuationPredictions = { requestId: event.requestId, epoch: event.epoch,
        observationSequence: event.baseSequence, value: structuredClone(event.result.continuations), invalidatedBy: null };
    }
    return { accepted: true, reason: `${event.operation}-accepted`, registeredNodeIds: [event.nodeId] };
  }

  #registerExperienced(objectiveNodeId: string, physicalGroupKey: string,
    candidateMembers: readonly EffectRecallCandidateV1[]): string {
    assert(candidateMembers.length > 0, 'empty-experienced-physical-group');
    const candidate = candidateMembers[0]!;
    const objective = this.#requireNode(objectiveNodeId).node;
    let nodeId = experiencedNodeId(objectiveNodeId, candidate.candidateId, objective.kind === 'root');
    const collision = this.#nodes.get(nodeId)?.node;
    if (collision?.kind === 'experienced' && collision.physicalGroupKey !== physicalGroupKey)
      nodeId = `${nodeId}:physical-group:${physicalGroupKey}`;
    this.#upsertNode({ nodeId, kind: 'experienced', candidate: structuredClone(candidate),
      candidateMembers: structuredClone(candidateMembers), physicalGroupKey, objectiveNodeId,
      createdEpoch: this.#epoch,
      createdObservationSequence: this.#observation?.sequence ?? null });
    return nodeId;
  }

  #registerTransition(objectiveNodeId: string, physicalGroupKey: string,
    transitionMembers: readonly OpaqueFactorTransitionTraceV1[]): string {
    assert(transitionMembers.length > 0, 'empty-factor-transition-physical-group');
    void objectiveNodeId;
    const nodeId = transitionNodeId(physicalGroupKey);
    const prior = this.#nodes.get(nodeId);
    assert(!prior || prior.node.kind === 'factor-transition', 'factor-transition-physical-node-kind-collision');
    if (prior?.node.kind === 'factor-transition')
      assert(prior.node.physicalGroupKey === physicalGroupKey, 'factor-transition-physical-key-collision');
    const byId = new Map<string, OpaqueFactorTransitionTraceV1>();
    const add = (member: OpaqueFactorTransitionTraceV1): void => {
      const existing = byId.get(member.transitionId);
      assert(!existing || canonical(existing) === canonical(member),
        'factor-transition-member-identity-collision');
      byId.set(member.transitionId, structuredClone(member));
    };
    if (prior?.node.kind === 'factor-transition')
      for (const member of prior.node.transitionMembers ?? [prior.node.transition]) add(member);
    for (const member of transitionMembers) add(member);
    const merged = [...byId.values()].sort((left, right) => left.transitionId.localeCompare(right.transitionId, 'en'));
    const membershipChanged = prior?.node.kind === 'factor-transition'
      && canonical((prior.node.transitionMembers ?? [prior.node.transition]).map(value => value.transitionId).sort())
        !== canonical(merged.map(value => value.transitionId));
    const node: ControlWorkspaceNodeV2 = { nodeId, kind: 'factor-transition', transition: merged[0]!,
      transitionMembers: merged, physicalGroupKey,
      createdEpoch: prior?.node.createdEpoch ?? this.#epoch,
      createdObservationSequence: prior?.node.createdObservationSequence
        ?? this.#observation?.sequence ?? null };
    if (prior) {
      prior.node = node;
      // A group prediction is lossless only for the exact member set it
      // evaluated.  Newly discovered provenance therefore invalidates the
      // aggregate readouts without touching long-term physical memory.
      if (membershipChanged) {
        prior.condition = null; prior.prediction = null; prior.continuationPredictions = null;
      }
    } else this.#upsertNode(node);
    return nodeId;
  }

  #upsertNode(node: ControlWorkspaceNodeV2): void {
    const prior = this.#nodes.get(node.nodeId);
    if (prior) { prior.node = node; return; }
    this.#nodes.set(node.nodeId, { node, continuousPatterns: [], condition: null, prediction: null,
      continuationPredictions: null, lastActionResult: null });
  }

  #hasDependencyPath(startNodeId: string, targetNodeId: string): boolean {
    const visited = new Set<string>(), pending = [startNodeId];
    while (pending.length) {
      const current = pending.pop()!;
      if (current === targetNodeId) return true;
      if (visited.has(current)) continue; visited.add(current);
      for (const edge of this.#dependencies.values()) if (edge.dependentNodeId === current)
        pending.push(edge.requiredNodeId);
    }
    return false;
  }

  #invalidateTransientEvidence(reason: 'attention' | 'action'): void {
    for (const state of this.#nodes.values()) {
      if (state.condition && !state.condition.invalidatedBy) state.condition = { ...state.condition, invalidatedBy: reason };
      if (state.prediction && !state.prediction.invalidatedBy) state.prediction = { ...state.prediction, invalidatedBy: reason };
      if (state.continuationPredictions && !state.continuationPredictions.invalidatedBy)
        state.continuationPredictions = { ...state.continuationPredictions, invalidatedBy: reason };
    }
  }

  #invalidatePending(): void {
    for (const [requestId, request] of this.#pending)
      if (request.channel === 'reasoning') this.#pending.set(requestId, { ...request, invalidated: true });
  }

  #fresh<T>(evidence: VersionedControlEvidenceV2<T> | null): evidence is VersionedControlEvidenceV2<T> {
    return !!evidence && !evidence.invalidatedBy && evidence.epoch === this.#epoch
      && evidence.observationSequence === this.#observation?.sequence;
  }

  #sameRequest(request: ControlRequestV2, event: { readonly requestId: string; readonly epoch: number;
    readonly operation: JointControlOperationV2; readonly nodeId: string; readonly baseSequence: number }): boolean {
    return request.requestId === event.requestId && request.epoch === event.epoch && request.operation === event.operation
      && request.nodeId === event.nodeId && request.baseSequence === event.baseSequence;
  }

  #requireGoal(): void { assert(this.#rootNodeId && this.#goalId, 'control-workspace-goal-not-set'); }
  #requireNode(nodeId: string): MutableNodeStateV2 {
    const node = this.#nodes.get(nodeId); assert(node, `control-workspace-node-not-found:${nodeId}`); return node;
  }
}
