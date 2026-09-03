import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, ActionCue, Observation, PublicChange } from '../src/contracts.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1,
  ConditionApplicabilityV1, ContinuationPredictionV2, ContinuousPatternRecallV2,
  EffectRecallCandidateV1, GroundedGoalV1, HypotheticalPublicStateV1,
  JointTransientControlFieldConfigV2, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from '../src/control/contracts.js';
import { historicalTransitionPreconditionV1, PhysicalControlManagerV2,
  type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { goalPredicates } from '../src/control/goal.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';
import { distributedEvidenceFixtureV3 } from './distributed-control-fixtures.js';

const config: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260901, branchCapacity: 8,
  stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};
const targetId = 'block:anonymous-counter', targetType = 'anonymous-counter';
const interactCue: ActionCue = { kind: 'interact', parameters: {}, targetRole: targetType };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'anonymous-counter-is-two', expression: {
  kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'counter-value-is-two',
    subject: { kind: 'public-object', id: targetId, expectedType: targetType },
    observable: 'properties.value', comparator: 'equals', target: '2' },
} };

const evidence = (id: string): PhysicalEvidenceReferenceV1 =>
  distributedEvidenceFixtureV3(id, { relationIds: [`relation:${id}`], applicability: .9 });
const change = (before: string, after: string): PublicChange => ({
  subject: `${targetType}#0`, property: 'value', before, after,
  observationIndex: 1, meaning: 'observed-co-occurrence',
});
const candidate = (id: string, before: string, after: string,
  predicateId = 'counter-value-is-two'): EffectRecallCandidateV1 => ({
  candidateId: id, goalPredicateIds: [predicateId], actionCue: interactCue,
  observedChanges: [change(before, after)], observedBefore: {}, evidence: evidence(id), unknown: [],
});

function observation(value: string, sequence = 1): Observation {
  return { sequence, activeSeconds: sequence * .05, targetId,
    contextId: `anonymous-counter:${value}`, self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: targetId, type: targetType, relativePosition: [0, 0, -2], properties: { value } }] };
}

test('a unanimously observed exact-transition before-value becomes a public intermediate goal', () => {
  const derived = historicalTransitionPreconditionV1([
    candidate('one-to-two-a', '1', '2'), candidate('one-to-two-b', '1', '2'),
  ], goal, observation('0'));
  assert(derived);
  const predicate = goalPredicates(derived)[0]!;
  assert.equal(predicate.comparator, 'equals');
  assert.equal('target' in predicate ? predicate.target : null, '1');
  assert.equal(predicate.observable, 'properties.value');
  assert.equal(predicate.subject.kind, 'public-object');
});

test('historical prerequisite derivation does not guess when reality is ready or members disagree', () => {
  assert.equal(historicalTransitionPreconditionV1([candidate('one-to-two', '1', '2')],
    goal, observation('1')), null);
  assert.equal(historicalTransitionPreconditionV1([
    candidate('one-to-two', '1', '2'), candidate('other-to-two', 'other', '2'),
  ], goal, observation('0')), null);
});

class CounterEnvironment implements PhysicalControlEnvironmentV2 {
  actionCount = 0; readonly actionBudget = 4; sequence = 1; value = 0;
  readonly timeline: string[] = []; readonly records: Array<{ readonly kind: string; readonly value: unknown }> = [];
  frame(): Observation { return observation(String(this.value), this.sequence); }
  async observe(): Promise<Observation> { return this.frame(); }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    if (this.sequence <= sequence) this.sequence = sequence + 1;
    return this.frame();
  }
  listActionOffers(frame: Observation): readonly ActionOfferV1[] {
    const actions: Action[] = [{ kind: 'interact', parameters: {}, targetId },
      { kind: 'observe', parameters: { ticks: 5 } }];
    return actions.map(action => ({ version: 'ActionOfferV1', observationSequence: frame.sequence,
      offerId: sha({ action, sequence: frame.sequence }), action, cue: cueFor(action, frame) }));
  }
  describeActionRequirement() { return { satisfied: true, missing: [], goal: null }; }
  async executeOffer(offer: ActionOfferV1, _scope: ActionObservationScopeV1) {
    this.actionCount++;
    if (offer.action.kind === 'interact') { this.value++; this.sequence += 2; this.timeline.push('interact'); }
    else { this.sequence += 5; this.timeline.push('observe'); }
    return { executed: true, observation: this.frame(), eventId: `real:${this.actionCount}` };
  }
  async status() { return { ready: true, bufferedEvents: 128, writes: 128 }; }
  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

class CounterReasoning implements PhysicalReasoningPortV2 {
  constructor(readonly environment: CounterEnvironment, readonly goalReadoutReached = true) {}
  recallByEffect(queryGoal: GroundedGoalV1): readonly EffectRecallCandidateV1[] {
    const predicate = goalPredicates(queryGoal)[0]!;
    const target = 'target' in predicate ? predicate.target : null;
    if (target === '2') return [candidate('one-to-two', '1', '2')];
    if (target === '1') return [{ ...candidate('zero-to-one', '0', '1'),
      goalPredicateIds: [predicate.id] }];
    return [];
  }
  recallAtomicEffect(queryGoal: GroundedGoalV1): readonly EffectRecallCandidateV1[] {
    return this.recallByEffect(queryGoal);
  }
  recallContinuousPattern(): readonly ContinuousPatternRecallV2[] { return []; }
  compareConditions(): ConditionApplicabilityV1 {
    return { matchedFactorIds: ['anonymous-condition'], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: .9, productionEligible: true };
  }
  compareCurrentFactors(): ConditionApplicabilityV1 { return this.compareConditions(); }
  compareProjectedParentRelations(_relations: readonly string[], _frame: Observation,
    states: readonly HypotheticalPublicStateV1[]): readonly ProjectedParentRelationApplicabilityV1[] {
    return states.map(() => ({ version: 'ProjectedParentRelationApplicabilityV1', selectedRelationId: null,
      relationResults: [], matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: 0, productionEligible: false }));
  }
  predictCandidate(item: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    queryGoal: GroundedGoalV1): BranchPredictionV1 {
    const frame = 'sequence' in state ? state : this.environment.frame();
    const actual = String(frame.objects[0]!.properties.value);
    const transition = item.observedChanges[0]!;
    const applicable = Object.is(actual, transition.before);
    const target = goalPredicates(queryGoal)[0]!;
    const progressing = applicable && 'target' in target && Object.is(transition.after, target.target);
    const nextState: HypotheticalPublicStateV1 = { version: 'HypotheticalPublicStateV1',
      baseObservationSequence: frame.sequence, knownChanges: applicable ? [transition] : [],
      knownActiveFactorIds: [], knownInactiveFactorIds: [], unknownFactorIds: [], unobserved: 'unknown' };
    return { prediction: { version: 'DistributedPredictionV3', kind: 'hypothetical-prediction', support: .9,
      calibratedProbability: false, samples: [], evidence: item.evidence, unknown: [],
      substrateSha256: 'anonymous-map' },
      currentEvidence: item.evidence, validSampleCount: 24,
      progressSampleCount: progressing ? 24 : 0, progressFraction: progressing ? 1 : 0,
      nextStates: Array.from({ length: 24 }, () => nextState), unknown: [],
      readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1',
        roleBindingStatus: this.goalReadoutReached ? 'matched' : 'descriptor-mismatch',
        goalRelevantReadoutCount: this.goalReadoutReached ? 24 : 0,
        maxVisitedOriginalKernelIndex: this.goalReadoutReached ? 1 : null,
        goalRelevantKernelVisited: this.goalReadoutReached } };
  }
  predictContinuation(patternId: string): ContinuationPredictionV2 {
    return { version: 'ContinuationPredictionV2', patternId, support: 0, samples: [],
      evidenceGrade: 'single-observation', unknown: ['no-continuation-required'] };
  }
  recallFactorTransition(): readonly OpaqueFactorTransitionTraceV1[] { return []; }
}

test('the joint field composes two real exact transitions without a scripted action order', async () => {
  const environment = new CounterEnvironment();
  const manager = new PhysicalControlManagerV2(new CounterReasoning(environment), environment, config);
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, timeline: environment.timeline,
    snapshot: manager.snapshot }));
  assert.deepEqual(environment.timeline, ['interact', 'interact', 'observe']);
  assert(environment.records.some(record => record.kind === 'control-historical-transition-requirement'));
  const snapshot = manager.snapshot!.workspace;
  assert(snapshot.dependencies.some(edge => edge.kind === 'historical-transition-precondition'));
  assert(snapshot.nodes.some(node => node.node.kind === 'public-requirement'
    && node.node.goal.id.startsWith('historical-transition-precondition:')));
});

test('a merely valid rollout cannot manufacture a historical prerequisite without goal readout binding',
  async () => {
    const environment = new CounterEnvironment();
    const manager = new PhysicalControlManagerV2(new CounterReasoning(environment, false), environment, config);
    await manager.runGoal(goal);
    assert.equal(environment.records.some(record =>
      record.kind === 'control-historical-transition-requirement'), false);
    assert.equal(manager.snapshot!.workspace.dependencies.some(edge =>
      edge.kind === 'historical-transition-precondition'), false);
  });
