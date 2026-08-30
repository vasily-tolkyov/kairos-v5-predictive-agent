import type { Observation } from '../contracts.js';
import type { AttentionNotice } from '../attention/monitor.js';
import { cueIdentity } from '../events.js';
import { assert, sha } from '../util.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, OpaqueFactorTransitionTraceV1 } from './contracts.js';

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
      /** Goal node whose effect query produced this branch. */
      readonly objectiveNodeId: string })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'factor-transition'; readonly transition: OpaqueFactorTransitionTraceV1 })
  | (WorkspaceNodeBaseV2 & { readonly kind: 'exploration'; readonly offer: ActionOfferV1 });

export interface ControlDependencyEdgeV2 {
  readonly edgeId: string;
  /** The branch which cannot yet proceed. It remains active while requirements compete. */
  readonly dependentNodeId: string;
  /** One physical transition branch which may establish the missing opaque factor. */
  readonly requiredNodeId: string;
  readonly factorIds: readonly string[];
  readonly kind: 'opaque-factor' | 'public-action-requirement' | 'public-requirement-candidate';
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

type OperationCompletedBaseV2 = {
  readonly kind: 'operation-completed';
  readonly requestId: string;
  readonly epoch: number;
  readonly nodeId: string;
  readonly baseSequence: number;
};
export type ControlOperationCompletedEventV2 = OperationCompletedBaseV2 & (
  | { readonly operation: 'recall-effect'; readonly result: readonly EffectRecallCandidateV1[] }
  | { readonly operation: 'compare-condition'; readonly result: ConditionApplicabilityV1 }
  | { readonly operation: 'predict-branch'; readonly result: BranchPredictionV1 }
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
  condition: VersionedControlEvidenceV2<ConditionApplicabilityV1> | null;
  prediction: VersionedControlEvidenceV2<BranchPredictionV1> | null;
  lastActionResult: ControlActionCompletionV2 | null;
}

export interface ControlWorkspaceNodeSnapshotV2 {
  readonly node: ControlWorkspaceNodeV2;
  readonly condition: (VersionedControlEvidenceV2<ConditionApplicabilityV1> & { readonly fresh: boolean }) | null;
  readonly prediction: (VersionedControlEvidenceV2<BranchPredictionV1> & { readonly fresh: boolean }) | null;
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
const transitionNodeId = (transitionId: string): string => `factor-transition:${transitionId}`;
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

/**
 * Keep control/audit snapshots bounded without changing the live physical
 * prediction. The controller needs readouts and outcome counts; the complete
 * integration path remains available only on the immediate PhysicalMemory
 * result. Endpoints plus the original count make this projection explicit.
 */
export function compactBranchPredictionForControlAuditV2(
  value: BranchPredictionV1,
): BranchPredictionV1 {
  return {
    ...structuredClone({ ...value, prediction: undefined }),
    prediction: {
      ...structuredClone({ ...value.prediction, samples: undefined }),
      samples: value.prediction.samples.map(sample => {
        const first = sample.positions[0];
        const last = sample.positions.at(-1);
        const positions = first === undefined ? [] : last === undefined || last === first
          ? [[...first]] : [[...first], [...last]];
        return {
          ...structuredClone({ ...sample, positions: undefined }),
          positions,
          trajectoryRetention: 'endpoints-only' as const,
          simulatedPositionCount: sample.positions.length,
        };
      }),
    },
  };
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
      createdEpoch: this.#epoch, createdObservationSequence: null }, condition: null, prediction: null,
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
  registerPublicRequirement(dependentNodeId: string, goal: GroundedGoalV1): string {
    this.#requireGoal(); this.#requireNode(dependentNodeId);
    const nodeId = publicRequirementNodeId(goal);
    this.#upsertNode({ nodeId, kind: 'public-requirement', goal: structuredClone(goal),
      createdEpoch: this.#epoch, createdObservationSequence: this.#observation?.sequence ?? null });
    this.#addDependency(dependentNodeId, nodeId, [], 'public-action-requirement');
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

  hasCompleted(operation: CompletedControlOperationV2['operation'], nodeId: string,
    options: { readonly currentEpoch?: boolean; readonly currentObservation?: boolean } = {}): boolean {
    return this.#completedOperations.some(value => value.operation === operation && value.nodeId === nodeId
      && (!options.currentEpoch || value.epoch === this.#epoch)
      && (!options.currentObservation || value.baseSequence === this.#observation?.sequence));
  }

  snapshot(): ControlWorkspaceSnapshotV2 {
    const sequence = this.#observation?.sequence ?? null;
    const nodes = [...this.#nodes.values()].map(state => ({ node: structuredClone(state.node),
      condition: state.condition ? { ...structuredClone(state.condition), fresh: this.#fresh(state.condition) } : null,
      prediction: state.prediction ? {
        requestId: state.prediction.requestId,
        epoch: state.prediction.epoch,
        observationSequence: state.prediction.observationSequence,
        invalidatedBy: state.prediction.invalidatedBy,
        value: compactBranchPredictionForControlAuditV2(state.prediction.value),
        fresh: this.#fresh(state.prediction),
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
      resultCount: Array.isArray(event.result) ? event.result.length : 1 });
    if (this.#completedOperations.length > 128) this.#completedOperations.splice(0, this.#completedOperations.length - 128);
    if (event.operation === 'recall-effect') {
      const registered = event.result.map(candidate => this.#registerExperienced(event.nodeId, candidate));
      if (this.#requireNode(event.nodeId).node.kind === 'public-requirement')
        for (const nodeId of registered) this.#addDependency(event.nodeId, nodeId, [], 'public-requirement-candidate');
      return { accepted: true, reason: 'historical-effect-recall-accepted', registeredNodeIds: registered };
    }
    if (event.operation === 'expand-condition') {
      const registered: string[] = [];
      for (const transition of event.result) {
        const nodeId = this.#registerTransition(transition); registered.push(nodeId);
        this.addDependency(event.nodeId, nodeId, request.factorIds);
      }
      return { accepted: true, reason: 'factor-transition-recall-accepted', registeredNodeIds: registered };
    }
    const state = this.#requireNode(event.nodeId);
    if (event.operation === 'compare-condition') state.condition = { requestId: event.requestId, epoch: event.epoch,
      observationSequence: event.baseSequence, value: structuredClone(event.result), invalidatedBy: null };
    else state.prediction = { requestId: event.requestId, epoch: event.epoch,
      observationSequence: event.baseSequence, value: structuredClone(event.result), invalidatedBy: null };
    return { accepted: true, reason: `${event.operation}-accepted`, registeredNodeIds: [event.nodeId] };
  }

  #registerExperienced(objectiveNodeId: string, candidate: EffectRecallCandidateV1): string {
    const objective = this.#requireNode(objectiveNodeId).node;
    const nodeId = experiencedNodeId(objectiveNodeId, candidate.candidateId, objective.kind === 'root');
    this.#upsertNode({ nodeId, kind: 'experienced', candidate: structuredClone(candidate), objectiveNodeId,
      createdEpoch: this.#epoch,
      createdObservationSequence: this.#observation?.sequence ?? null });
    return nodeId;
  }

  #registerTransition(transition: OpaqueFactorTransitionTraceV1): string {
    const nodeId = transitionNodeId(transition.transitionId);
    this.#upsertNode({ nodeId, kind: 'factor-transition', transition: structuredClone(transition),
      createdEpoch: this.#epoch, createdObservationSequence: this.#observation?.sequence ?? null });
    return nodeId;
  }

  #upsertNode(node: ControlWorkspaceNodeV2): void {
    const prior = this.#nodes.get(node.nodeId);
    if (prior) { prior.node = node; return; }
    this.#nodes.set(node.nodeId, { node, condition: null, prediction: null, lastActionResult: null });
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
