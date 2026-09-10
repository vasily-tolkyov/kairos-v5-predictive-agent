import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '../src/contracts.js';
import type { BranchPredictionV1, EffectRecallCandidateV1, GroundedGoalV1,
  GoalEvaluationV1, HypotheticalPublicStateV1 } from '../src/control/contracts.js';
import { predictPhysicalShortChainV1 } from '../src/core/prediction/physical-short-chain.js';
import { evaluateGroundedReadoutV1 } from '../src/control/goal.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { eventLocalDecodedPublicFeaturesV1, decodedPublicFeaturesFromContextV1,
  publicReadoutProjectionContextV1 } from '../src/events.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3,
  distributedPredictionSampleFixtureV3 } from './distributed-control-fixtures.js';

const observation: Observation = { sequence: 10, activeSeconds: .5, contextId: 'x', targetId: 'o',
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { unread: true } },
  objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, 1], properties: { r: '0', unread: 'secret' } }] };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'r', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
  observable: 'properties.r', comparator: 'equals', target: '2' } } };
const evaluation: GoalEvaluationV1 = { goalId: 'g', observationSequence: 10, status: 'mismatch', residual: 1,
  predicates: [{ predicateId: 'r', actual: '0', baseline: '0', status: 'mismatch', residual: 1, reason: null }] };
const evidence = distributedEvidenceFixtureV3('chain', { applicability: 1 });
const candidate = (id: string): EffectRecallCandidateV1 => ({ candidateId: id, evidence,
  actionCue: { kind: 'interact', parameters: {}, targetRole: 'opaque#0' },
  observedChanges: [], observedBefore: {}, goalPredicateIds: ['r'], unknown: [] });

function run(missingFirstSeed = 0, depth = 2) {
  const calls: { state: Observation | HypotheticalPublicStateV1; seeds: readonly number[] }[] = [];
  const queryGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'r', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.r', comparator: 'equals', target: String(depth),
  } } };
  const result = predictPhysicalShortChainV1(Array.from({ length: depth }, (_, index) => candidate(String(index + 1))),
    observation, queryGoal, evaluation,
    (action, state, _goal, _evaluation, seeds): BranchPredictionV1 => {
      calls.push({ state, seeds });
      const after = action.candidateId;
      const eligibleSeeds = seeds.filter(seed => seed !== missingFirstSeed);
      const samples = eligibleSeeds.map(seed => distributedPredictionSampleFixtureV3(seed));
      return { prediction: distributedPredictionFixtureV3(evidence, samples), currentEvidence: evidence,
        binding: { mediumVersion: 'v', observationSequence: 10, observationIdentity: 'actual', actionPrefix: [] },
        validSampleCount: samples.length, progressSampleCount: 0, progressFraction: 0, unknown: [],
        nextStates: eligibleSeeds.map(seed => ({ version: 'HypotheticalPublicStateV1', baseObservationSequence: 10,
          knownChanges: [], knownActiveFactorIds: [], knownInactiveFactorIds: [], unknownFactorIds: [],
          unobserved: 'unknown', physicalReadout: { readoutId: `physical-${after}`, mediumVersion: 'v',
            sourceSeed: seed, observationSequence: 10, actionPrefix: [action.candidateId], horizonObservationSteps: Number(after) * 5 },
          goalEvaluation: evaluateGroundedReadoutV1(queryGoal, evaluation, 10, () => after) })) };
    });
  return { calls, result };
}

test('two-step rollout preserves 24 lineages and only passes actual terminal inputs to step two', () => {
  const { calls, result } = run();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.seeds, Array.from({ length: 24 }, (_, i) => i + 1));
  assert.deepEqual(calls[1]!.seeds, Array.from({ length: 24 }, (_, i) => i + 25));
  assert.equal('self' in calls[1]!.state, false, 'a future full world frame was synthesized');
  assert.equal((calls[1]!.state as HypotheticalPublicStateV1).physicalReadout?.readoutId, 'physical-1');
  assert.equal(result.progressSampleCount, 24);
  assert(result.lanes.every(lane => lane.steps[1]!.sample.seed === lane.seed + 24));
  assert.equal(result.horizonObservationSteps, 10);
});

test('three-step physical query keeps seed lineage and cannot reuse the first terminal for step three', () => {
  const { calls, result } = run(0, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2]!.seeds, Array.from({ length: 24 }, (_, index) => index + 49));
  assert.equal((calls[2]!.state as HypotheticalPublicStateV1).physicalReadout?.readoutId, 'physical-2');
  assert(result.lanes.every(lane => lane.steps.length === 3 && lane.steps[2]!.sample.seed === lane.seed + 48));
  assert.equal(result.progressSampleCount, 24);
  assert.equal(result.horizonObservationSteps, 15);
});

test('a missed first terminal cannot borrow another lane or acquire a second step', () => {
  const { calls, result } = run(7);
  assert.equal(result.progressSampleCount, 23);
  assert.equal(result.lanes[6]!.status, 'unknown');
  assert.equal(result.lanes[6]!.steps.length, 0);
  assert.equal(calls[1]!.seeds.includes(31), false);
});

test('a fabricated hypothetical result is not accepted as a physical future', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const forged: HypotheticalPublicStateV1 = { version: 'HypotheticalPublicStateV1', baseObservationSequence: 10,
    knownChanges: [], knownActiveFactorIds: ['desired'], knownInactiveFactorIds: [], unknownFactorIds: [],
    unobserved: 'unknown', physicalReadout: { readoutId: 'fabricated', mediumVersion: memory.physicalVersion(),
      sourceSeed: 1, observationSequence: 10, actionPrefix: [], horizonObservationSteps: 5 } };
  const result = memory.predictCandidate(candidate('a'), forged, goal, evaluation);
  assert.equal(result.validSampleCount, 0);
  assert.deepEqual(result.unknown, ['hypothetical-physical-readout-missing-or-stale']);
});

test('compact readout projection preserves public mapping without carrying unread properties', () => {
  const roles = [{ version: 'EventLocalPublicRoleBindingV1' as const,
    role: 'opaque#0', type: 'opaque', directActionTarget: true, stableProperties: {} }];
  const values = [{ subjectRole: 'opaque#0', property: 'r', value: '1' }];
  const context = publicReadoutProjectionContextV1(observation, roles, values);
  assert.deepEqual(decodedPublicFeaturesFromContextV1(context, values),
    eventLocalDecodedPublicFeaturesV1(observation, roles, values));
  assert.equal(JSON.stringify(context).includes('secret'), false);
  assert.equal(JSON.stringify(context).includes('position'), false);
  assert.equal(JSON.stringify(decodedPublicFeaturesFromContextV1(context, values)).includes('unread'), false);
});

test('missing terminal channels remain unknown for conjunctions, not inherited truths', () => {
  const first = goal.expression;
  const second = { kind: 'predicate' as const, predicate: { version: 'GoalPredicateV1' as const, id: 'unread',
    subject: { kind: 'self' as const }, observable: 'properties.unread' as const,
    comparator: 'equals' as const, target: true } };
  const combined: GroundedGoalV1 = { ...goal, expression: { kind: 'all', children: [first, second] } };
  const result = evaluateGroundedReadoutV1(combined, evaluation, 10, predicate => predicate.id === 'r' ? '2' : undefined);
  assert.equal(result.status, 'unknown');
});
