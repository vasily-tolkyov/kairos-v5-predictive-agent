import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, ActionCue, Observation, PublicChange } from '../src/contracts.js';
import { describeActionRequirement } from '../src/body.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1,
  ContinuationPredictionV2, ContinuousPatternRecallV2, EffectRecallCandidateV1, GroundedGoalV1, HypotheticalPublicStateV1,
  JointTransientControlFieldConfigV2, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from '../src/control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { cueFor, cueIdentity } from '../src/events.js';
import { sha } from '../src/util.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3 }
  from './distributed-control-fixtures.js';

const config: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260830, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};
const targetId = 'block:opaque-target';
const targetType = 'opaque-control';
const look: Action = { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } };
const interact: Action = { kind: 'interact', parameters: {}, targetId };
const observe: Action = { kind: 'observe', parameters: { ticks: 5 } };
const interactCue: ActionCue = { kind: 'interact', parameters: {}, targetRole: targetType };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'opaque-result', expression: {
  kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'result',
    subject: { kind: 'public-object', id: targetId, expectedType: targetType },
    observable: 'properties.result', comparator: 'equals', target: true },
} };
const physical = (id: string): PhysicalEvidenceReferenceV1 =>
  distributedEvidenceFixtureV3(id, { relationIds: [`relation:${id}`], applicability: .9 });

class RequirementEnvironment implements PhysicalControlEnvironmentV2 {
  actionCount = 0;
  readonly actionBudget = 3;
  sequence = 1;
  aimed = false;
  result = false;
  readonly timeline: string[] = [];
  readonly observationScopes: ActionObservationScopeV1[] = [];
  readonly records: Array<{ readonly kind: string; readonly value: unknown }> = [];

  frame(): Observation {
    return { sequence: this.sequence, activeSeconds: this.sequence * .05, targetId: this.aimed ? targetId : null,
      contextId: 'opaque-public-requirement', self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
      objects: [{ id: targetId, type: targetType, relativePosition: [0, 0, -2],
        properties: { result: this.result } }] };
  }
  async observe(): Promise<Observation> { return this.frame(); }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    if (this.sequence <= sequence) this.sequence = sequence + 1;
    return this.frame();
  }
  describeActionRequirement(cue: ActionCue, observation: Observation) {
    return describeActionRequirement(cue, observation);
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    const actions = [look, observe, ...(this.aimed ? [interact] : [])];
    return actions.map(action => ({ version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
      observationSequence: observation.sequence, action, cue: cueFor(action, observation) }));
  }
  async executeOffer(offer: ActionOfferV1, observationScope: ActionObservationScopeV1) {
    this.observationScopes.push(structuredClone(observationScope));
    this.actionCount++; this.sequence += offer.action.kind === 'observe' ? 5 : 2;
    if (offer.action.kind === 'look') this.aimed = true;
    if (offer.action.kind === 'interact') this.result = true;
    this.timeline.push(offer.action.kind);
    return { executed: true, observation: this.frame(), eventId: `real:${this.actionCount}` };
  }
  async status() { return { ready: true, bufferedEvents: 128, writes: 128 }; }
  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

class RequirementReasoning implements PhysicalReasoningPortV2 {
  readonly recallGoals: string[] = [];
  readonly predictionCalls: Array<{ readonly candidateId: string; readonly aimed: boolean }> = [];
  constructor(readonly environment: RequirementEnvironment, readonly acquisitionExperience = true) {}
  recallByEffect(queryGoal: GroundedGoalV1): readonly EffectRecallCandidateV1[] {
    this.recallGoals.push(queryGoal.id);
    if (queryGoal.id.startsWith('public-action-requirement:'))
      return this.acquisitionExperience ? [this.candidate('acquire', cueFor(look, this.environment.frame()), [{
        subject: 'crosshair', property: 'type', before: null, after: targetType,
        observationIndex: 1, meaning: 'observed-co-occurrence',
      }])] : [];
    return [this.candidate('effect', interactCue, [{ subject: `${targetType}#0`, property: 'result',
      before: false, after: true, observationIndex: 1, meaning: 'observed-co-occurrence' }])];
  }
  recallAtomicEffect(queryGoal: GroundedGoalV1): readonly EffectRecallCandidateV1[] {
    return this.recallByEffect(queryGoal);
  }
  recallContinuousPattern(): readonly ContinuousPatternRecallV2[] { return []; }
  compareCurrentFactors(relationId: string): ConditionApplicabilityV1 {
    return relationId.startsWith('relation:') ? this.compareConditions()
      : { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
        applicability: 0, productionEligible: false };
  }
  compareProjectedParentRelations(relationIds: readonly string[], _observation: Observation,
    states: readonly HypotheticalPublicStateV1[],
    source: { readonly r1Active: boolean; readonly r2Active: boolean }):
    readonly ProjectedParentRelationApplicabilityV1[] {
    return states.map(() => {
      const relationResults = relationIds.map(relationId => {
        const valid = relationId.startsWith('relation:') && source.r1Active && source.r2Active;
        return { relationId, matchedFactorIds: valid ? ['opaque-current-condition'] : [],
          contradictedFactorIds: [], unknownFactorIds: valid ? [] : [`unsupported-relation:${relationId}`],
          applicability: valid ? .9 : 0, productionEligible: valid };
      });
      const selected = relationResults.find(result => result.productionEligible) ?? relationResults[0] ?? null;
      return { version: 'ProjectedParentRelationApplicabilityV1',
        selectedRelationId: selected?.relationId ?? null, relationResults,
        matchedFactorIds: selected?.matchedFactorIds ?? [],
        contradictedFactorIds: selected?.contradictedFactorIds ?? [],
        unknownFactorIds: selected?.unknownFactorIds ?? [], applicability: selected?.applicability ?? 0,
        productionEligible: selected?.productionEligible ?? false };
    });
  }
  predictContinuation(patternId: string): ContinuationPredictionV2 {
    return { version: 'ContinuationPredictionV2', patternId, support: 0, samples: [],
      evidenceGrade: 'single-observation', unknown: ['test-has-no-continuous-pattern'] };
  }
  compareConditions(): ConditionApplicabilityV1 {
    return { matchedFactorIds: ['opaque-current-condition'], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: .9, productionEligible: true };
  }
  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    queryGoal: GroundedGoalV1): BranchPredictionV1 {
    this.predictionCalls.push({ candidateId: candidate.candidateId, aimed: this.environment.aimed });
    const acquisition = candidate.candidateId === 'acquire';
    const change: PublicChange = acquisition
      ? { subject: 'crosshair', property: 'type', before: null, after: targetType,
        observationIndex: 1, meaning: 'observed-co-occurrence' }
      : { subject: `${targetType}#0`, property: 'result', before: false, after: true,
        observationIndex: 1, meaning: 'observed-co-occurrence' };
    const next: HypotheticalPublicStateV1 = { version: 'HypotheticalPublicStateV1',
      baseObservationSequence: 'sequence' in state ? state.sequence : state.baseObservationSequence,
      knownChanges: [change], knownActiveFactorIds: [], knownInactiveFactorIds: [],
      unknownFactorIds: [], unobserved: 'unknown' };
    const expectedGoal = acquisition ? queryGoal.id.startsWith('public-action-requirement:')
      : queryGoal.id === goal.id;
    const progress = expectedGoal ? 24 : 0;
    return { prediction: distributedPredictionFixtureV3(candidate.evidence),
      validSampleCount: 24, progressSampleCount: progress, progressFraction: progress / 24,
      nextStates: Array.from({ length: 24 }, () => next), unknown: [] };
  }
  recallFactorTransition(): readonly OpaqueFactorTransitionTraceV1[] { return []; }
  candidate(id: string, actionCue: ActionCue, observedChanges: readonly PublicChange[]): EffectRecallCandidateV1 {
    return { candidateId: id, goalPredicateIds: [], actionCue, observedChanges,
      observedBefore: {}, evidence: physical(id), unknown: [] };
  }
}

test('a missing public body precondition becomes a physical effect query and retains its parent branch', async () => {
  const environment = new RequirementEnvironment();
  const reasoning = new RequirementReasoning(environment);
  const manager = new PhysicalControlManagerV2(reasoning, environment, config);
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, timeline: environment.timeline,
    snapshot: manager.snapshot }));
  assert.deepEqual(environment.timeline, ['look', 'interact', 'observe']);
  assert(reasoning.recallGoals.some(id => id.startsWith('public-action-requirement:')),
    'missing public fact never reached PhysicalReasoningPort.recallByEffect');
  const snapshot = manager.snapshot!.workspace;
  const parent = snapshot.nodes.find(node => node.node.kind === 'experienced'
    && node.node.candidate.candidateId === 'effect');
  const requirement = snapshot.nodes.find(node => node.node.kind === 'public-requirement');
  const acquisition = snapshot.nodes.find(node => node.node.kind === 'experienced'
    && node.node.candidate.candidateId === 'acquire');
  assert(parent && requirement && acquisition, 'parent, transient requirement, and recalled branch must coexist');
  assert(snapshot.dependencies.some(edge => edge.kind === 'public-action-requirement'
    && edge.dependentNodeId === parent.node.nodeId && edge.requiredNodeId === requirement.node.nodeId));
  assert(snapshot.dependencies.some(edge => edge.kind === 'public-requirement-candidate'
    && edge.dependentNodeId === requirement.node.nodeId && edge.requiredNodeId === acquisition.node.nodeId));
  assert.notEqual(acquisition.node.nodeId, `experienced:acquire`,
    'a requirement-scoped candidate must not alias a root-goal branch');
  assert(environment.records.some(record => record.kind === 'control-public-requirement-goal'));
  assert.equal(reasoning.predictionCalls.some(call => call.candidateId === 'acquire' && call.aimed), false,
    'a fulfilled public-requirement branch kept consuming prediction work');
  assert(environment.observationScopes.some(scope => scope.referencedPublicObjectIds.includes(targetId)),
    'the thin controller did not retain the grounded goal object in the real action observation scope');
});

test('without recalled acquisition experience the controller does not forge an experienced method', async () => {
  const environment = new RequirementEnvironment();
  // Only public observation remains available for exploration, so the finite
  // action budget ends without manufacturing a learned acquisition branch.
  environment.listActionOffers = observation => [{ version: 'ActionOfferV1',
    offerId: sha({ observe, sequence: observation.sequence }), observationSequence: observation.sequence,
    action: observe, cue: cueFor(observe, observation) }];
  const reasoning = new RequirementReasoning(environment, false);
  const manager = new PhysicalControlManagerV2(reasoning, environment, { ...config, seed: 20260831 });
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'current-experience-and-budget-exhausted');
  assert(reasoning.recallGoals.some(id => id.startsWith('public-action-requirement:')));
  assert.equal(manager.snapshot!.workspace.nodes.some(node => node.node.kind === 'experienced'
    && node.node.candidate.candidateId === 'acquire'), false);
  assert.equal(environment.timeline.includes('interact'), false);
});

test('multiple current targets with the same physical cue are rejected as ambiguous', async () => {
  const environment = new RequirementEnvironment();
  environment.aimed = true;
  const wrongId = 'block:wrong-same-type';
  const originalFrame = environment.frame.bind(environment);
  environment.frame = () => {
    const frame = originalFrame();
    return { ...frame, targetId: wrongId, objects: [...frame.objects,
      { id: wrongId, type: targetType, relativePosition: [0, 0, -1], properties: { result: false } }] };
  };
  const currentWrongAction: Action = { kind: 'interact', parameters: {}, targetId: wrongId };
  environment.listActionOffers = observation => [currentWrongAction, interact, observe].map(action => ({
    version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
    observationSequence: observation.sequence, action, cue: cueFor(action, observation),
  }));
  assert.equal(cueIdentity(cueFor(currentWrongAction, environment.frame())), cueIdentity(interactCue));
  const manager = new PhysicalControlManagerV2(new RequirementReasoning(environment), environment,
    { ...config, seed: 20260832 });
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'current-experience-and-budget-exhausted');
  assert.equal(environment.timeline.includes('interact'), false,
    'the controller guessed one of several current targets sharing the same physical cue');
});
