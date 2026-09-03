import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, PublicChange } from '../src/contracts.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1, GoalEvaluationV1, GroundedGoalV1,
  HypotheticalPublicStateV1, JointTransientControlFieldConfigV2, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from '../src/control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { ControlWorkspaceV2 } from '../src/control/workspace.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3 }
  from './distributed-control-fixtures.js';

const action: Action = { kind: 'interact', parameters: {}, targetId: 'o' };
const observe: Action = { kind: 'observe', parameters: { ticks: 5 } };
const change: PublicChange = { subject: 'opaque#0', property: 'R', before: false, after: true,
  observationIndex: 1, meaning: 'observed-co-occurrence' };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'v2-goal', expression: { kind: 'predicate',
  predicate: { version: 'GoalPredicateV1', id: 'R', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.R', comparator: 'equals', target: true } } };
const config: JointTransientControlFieldConfigV2 = { version: 'JointTransientControlFieldConfigV2', seed: 9102,
  branchCapacity: 8, stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50, predictionSeeds: 24,
  predictionSteps: 180, goalVerificationTicks: 5 };
const evidence: PhysicalEvidenceReferenceV1 = distributedEvidenceFixtureV3('atomic-event', {
  relationIds: ['relation-1'], applicability: .9,
});

const frame = (sequence: number, result = false): Observation => ({ sequence, activeSeconds: sequence * .05,
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
  objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1], properties: { R: result } }],
  targetId: 'o', contextId: 'v2-control' });
const candidate = (observation: Observation): EffectRecallCandidateV1 => ({ candidateId: 'candidate',
  goalPredicateIds: ['R'], actionCue: cueFor(action, observation), observedChanges: [change], observedBefore: {},
  evidence, unknown: [] });
const pattern: ContinuousPatternRecallV2 = { patternId: 'pattern-1', memberR2EventIds: ['r2-event'],
  orderedR1AtomIds: ['a', 'b'], evidenceGrade: 'intervention-supported',
  activePhysicalTraceIds: ['r2-trace'], currentRelationIds: ['relation-1'], currentApplicability: .9,
  currentPredictionEligible: true, unknown: [] };

class V2Reasoning implements PhysicalReasoningPortV2 {
  readonly calls: string[] = [];
  recallByEffect(): readonly EffectRecallCandidateV1[] { throw new Error('legacy-recall-called'); }
  compareConditions(): ConditionApplicabilityV1 { throw new Error('legacy-condition-called'); }
  recallAtomicEffect(_goal: GroundedGoalV1, _difference: GoalEvaluationV1, observation: Observation) {
    this.calls.push('atomic'); return [candidate(observation)];
  }
  recallContinuousPattern(): readonly ContinuousPatternRecallV2[] { this.calls.push('continuous'); return [pattern]; }
  compareCurrentFactors(relationId: string): ConditionApplicabilityV1 {
    this.calls.push(`factors:${relationId}`); return { matchedFactorIds: ['factor'], contradictedFactorIds: [],
      unknownFactorIds: [], applicability: .9, productionEligible: true };
  }
  compareProjectedParentRelations(relationIds: readonly string[], _observation: Observation,
    states: readonly HypotheticalPublicStateV1[],
    source: { readonly r1Active: boolean; readonly r2Active: boolean }):
    readonly ProjectedParentRelationApplicabilityV1[] {
    return states.map(() => {
      const relationResults = relationIds.map(relationId => ({ relationId, matchedFactorIds: ['factor'],
        contradictedFactorIds: [], unknownFactorIds: [], applicability: .9,
        productionEligible: source.r1Active && source.r2Active }));
      const selected = relationResults[0] ?? null;
      return { version: 'ProjectedParentRelationApplicabilityV1',
        selectedRelationId: selected?.relationId ?? null, relationResults,
        matchedFactorIds: selected?.matchedFactorIds ?? [], contradictedFactorIds: [], unknownFactorIds: [],
        applicability: selected?.applicability ?? 0, productionEligible: selected?.productionEligible ?? false };
    });
  }
  predictCandidate(value: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1): BranchPredictionV1 {
    this.calls.push('atomic-prediction'); const sequence = 'sequence' in state ? state.sequence : state.baseObservationSequence;
    return { prediction: distributedPredictionFixtureV3(value.evidence), currentEvidence: value.evidence,
      validSampleCount: 24, progressSampleCount: 24, progressFraction: 1,
      nextStates: [{ version: 'HypotheticalPublicStateV1', baseObservationSequence: sequence,
        knownChanges: [change], knownActiveFactorIds: [], knownInactiveFactorIds: [], unknownFactorIds: [],
        unobserved: 'unknown' }], unknown: [] };
  }
  predictContinuation(patternId: string): ContinuationPredictionV2 {
    this.calls.push(`continuation:${patternId}`); return { version: 'ContinuationPredictionV2', patternId,
      support: .8, samples: [], evidenceGrade: 'intervention-supported', unknown: [] };
  }
  recallFactorTransition(): readonly OpaqueFactorTransitionTraceV1[] { return []; }
}

class V2Environment implements PhysicalControlEnvironmentV2 {
  actionCount = 0; readonly actionBudget = 4; sequence = 1; result = false;
  readonly records: Array<{ kind: string; value: unknown }> = [];
  observe(): Promise<Observation> { return Promise.resolve(frame(this.sequence, this.result)); }
  waitForObservationAfter(sequence: number): Promise<Observation> {
    this.sequence = Math.max(this.sequence, sequence + 1); return this.observe();
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    return [action, observe].map(value => ({ version: 'ActionOfferV1', offerId: sha([value, observation.sequence]),
      observationSequence: observation.sequence, action: value, cue: cueFor(value, observation) }));
  }
  describeActionRequirement() { return { satisfied: true, missing: [], goal: null }; }
  executeOffer(offer: ActionOfferV1) {
    this.actionCount++; this.sequence += offer.action.kind === 'observe' ? 5 : 1;
    if (offer.action.kind === 'interact') this.result = true;
    return Promise.resolve({ executed: true, observation: frame(this.sequence, this.result),
      eventId: `event-${this.actionCount}` });
  }
  status() { return Promise.resolve({ ready: true, bufferedEvents: 128, writes: 128 }); }
  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

test('joint controller consumes V2 atomic, continuous, factor and continuation evidence without legacy calls', async () => {
  const reasoning = new V2Reasoning(), environment = new V2Environment();
  const manager = new PhysicalControlManagerV2(reasoning, environment, config);
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, snapshot: manager.snapshot }));
  assert(reasoning.calls.includes('atomic'));
  assert(reasoning.calls.includes('continuous'));
  assert(reasoning.calls.includes('factors:relation-1'));
  assert(reasoning.calls.includes('atomic-prediction'));
  assert(reasoning.calls.includes('continuation:pattern-1'));
  const experienced = manager.snapshot!.workspace.nodes.find(node => node.node.kind === 'experienced')!;
  assert.deepEqual(experienced.continuousPatterns.map(item => item.pattern.patternId), ['pattern-1']);
});

test('continuous patterns only bind through shared R2A relations and their prediction expires on attention', () => {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal), observation = frame(1);
  const evaluation: GoalEvaluationV1 = { goalId: goal.id, status: 'mismatch', residual: 1,
    observationSequence: 1, predicates: [] };
  workspace.ingest({ kind: 'observation', observation, offers: [], goalEvaluation: evaluation });
  const recall = workspace.beginRequest({ requestId: 'recall', channel: 'reasoning', operation: 'recall-effect',
    nodeId: root, baseSequence: 1 });
  const unrelated = { ...pattern, patternId: 'unrelated', currentRelationIds: ['relation-2'] };
  const recalled = workspace.ingest({ kind: 'operation-completed', requestId: recall.requestId, epoch: recall.epoch,
    operation: 'recall-effect', nodeId: root, baseSequence: 1,
    result: { version: 'PhysicalRecallBundleV2', atomicCandidates: [candidate(observation)],
      continuousPatterns: [pattern, unrelated] } });
  const nodeId = recalled.registeredNodeIds[0]!;
  assert.deepEqual(workspace.snapshot().nodes.find(node => node.node.nodeId === nodeId)!.continuousPatterns
    .map(item => item.pattern.patternId), ['pattern-1']);
  const request = workspace.beginRequest({ requestId: 'prediction', channel: 'reasoning', operation: 'predict-branch',
    nodeId, baseSequence: 1 });
  const atomic = new V2Reasoning().predictCandidate(candidate(observation), observation);
  workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'predict-branch', nodeId, baseSequence: 1,
    result: { version: 'ControlBranchPredictionResultV2', atomic,
      continuations: [{ candidateId: 'candidate-1', patternId: 'pattern-1', sharedRelationIds: ['relation-1'],
        value: new V2Reasoning().predictContinuation('pattern-1') }] } });
  assert.equal(workspace.currentContinuationPredictions(nodeId)?.[0]?.value.support, .8);
  workspace.ingest({ kind: 'attention', notice: { kind: 'unknown-change', sequence: 1,
    subjectId: 'o', forecastCompletedBeforeSequence: null, evidence: null } });
  assert.equal(workspace.currentPrediction(nodeId), null);
  assert.equal(workspace.currentContinuationPredictions(nodeId), null);
});
