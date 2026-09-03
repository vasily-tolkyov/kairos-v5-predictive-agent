import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { Observation, PublicChange } from '../src/contracts.js';
import type { BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GoalEvaluationV1, GroundedGoalV1, OpaqueFactorTransitionTraceV1,
  ProjectedParentRelationApplicabilityV1 } from '../src/control/contracts.js';
import { desiredFactorProgressFractionV2, factorTransitionCandidateForControlV2,
  scoreDesiredFactorProgressV2, scoreProjectedParentRelationProgressV1,
  selectExecutablePhysicalMemberV1 } from '../src/control/controller.js';
import { ControlWorkspaceV2, effectCandidatePhysicalGroupKeyV1,
  groupEffectCandidatesForControlV1, groupFactorTransitionsForControlV2 } from '../src/control/workspace.js';
import { canonical } from '../src/util.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3 }
  from './distributed-control-fixtures.js';

const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'goal', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'result', subject: { kind: 'self' }, observable: 'yaw',
  comparator: 'equals', target: 1,
} } };
const observation: Observation = { sequence: 1, activeSeconds: .05, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, targetId: null, contextId: 'context' };
const evaluation: GoalEvaluationV1 = { goalId: goal.id, status: 'mismatch', residual: 1,
  observationSequence: 1, predicates: [] };
const cue = { kind: 'look' as const, parameters: { yawDelta: 15, pitchDelta: 0 }, targetRole: null };
const change = (after: number, observationIndex = 1): PublicChange => ({ subject: 'self', property: 'yaw',
  before: 0, after, observationIndex, meaning: 'observed-co-occurrence' });

function candidate(id: string, effect = 1, options: { basin?: string; relations?: readonly string[];
  active?: boolean; cueDelta?: number } = {}): EffectRecallCandidateV1 {
  const active = options.active ?? true;
  return { candidateId: id, goalPredicateIds: ['result'],
    actionCue: options.cueDelta === undefined ? cue : { ...cue, parameters: { yawDelta: options.cueDelta, pitchDelta: 0 } },
    observedChanges: [change(effect, Number(id.replace(/\D/g, '')) || 1)], observedBefore: {},
    evidence: { ...distributedEvidenceFixtureV3(id, { active,
      relationIds: options.relations ?? ['relation'], applicability: active ? 1 : 0 }),
      r1: { ...distributedEvidenceFixtureV3(id).r1,
        active, supportStrength: active ? 1 : 0,
        attractorId: `attractor:${effect}:${options.cueDelta ?? 15}` },
      r2: { ...distributedEvidenceFixtureV3(id).r2,
        active, supportStrength: active ? 1 : 0,
        corridorId: options.basin ?? `corridor:${effect}` },
      r2a: { ...distributedEvidenceFixtureV3(id).r2a,
        active, supportStrength: active ? 1 : 0,
        patternIds: [`pattern:${effect}`], relationIds: [...(options.relations ?? ['relation'])],
        applicability: active ? 1 : 0, productionEligible: active, predictionEligible: active } },
    unknown: [] };
}

function transition(id: string, group: number): OpaqueFactorTransitionTraceV1 {
  const base = candidate(`transition-evidence-${id}`, 1, { basin: `transition-basin-${group}` });
  return { version: 'OpaqueFactorTransitionTraceV1', transitionId: id, eventId: `event-${id}`,
    actionCue: cue, activatedFactorIds: [`factor-${group}`], deactivatedFactorIds: [],
    unchangedActiveFactorIds: ['background'], evidence: base.evidence, meaning: 'observed-factor-transition' };
}

const condition = (candidateId: string, applicability: number): NonNullable<ConditionApplicabilityV1['memberResults']>[number] => ({
  candidateId, value: { matchedFactorIds: applicability > 0 ? ['factor'] : [], contradictedFactorIds: [],
    unknownFactorIds: applicability > 0 ? [] : ['factor'], applicability, productionEligible: true },
});
const memberPrediction = (candidateId: string, progress: number, active = true):
  NonNullable<BranchPredictionV1['memberResults']>[number] => ({ candidateId, value: {
    prediction: distributedPredictionFixtureV3(null),
    currentEvidence: candidate(candidateId, 1, { basin: 'basin', active }).evidence,
    validSampleCount: active ? 24 : 0, progressSampleCount: progress > 0 ? 24 : 0,
    progressFraction: progress, nextStates: [], unknown: [],
  } });

test('exact physical grouping is order-invariant, lossless, and every allowed key field prevents a merge', () => {
  const members = [candidate('b', 1, { basin: 'basin' }), candidate('a', 1, { basin: 'basin' })];
  const before = canonical(members);
  const forward = groupEffectCandidatesForControlV1('root:goal', members);
  const reverse = groupEffectCandidatesForControlV1('root:goal', [...members].reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(forward.length, 1);
  assert.deepEqual(forward[0]!.members.map(value => value.candidateId), ['a', 'b']);
  assert.equal(canonical(members), before, 'read-only grouping mutated physical evidence');

  const base = members[0]!;
  const differences = [
    effectCandidatePhysicalGroupKeyV1('root:other', base),
    effectCandidatePhysicalGroupKeyV1('root:goal', candidate('cue', 1, { basin: 'basin', cueDelta: -15 })),
    effectCandidatePhysicalGroupKeyV1('root:goal', candidate('basin', 1, { basin: 'other' })),
    effectCandidatePhysicalGroupKeyV1('root:goal', candidate('relation', 1, { basin: 'basin', relations: ['other'] })),
    effectCandidatePhysicalGroupKeyV1('root:goal', candidate('effect', 2, { basin: 'basin' })),
  ];
  assert.equal(new Set([forward[0]!.physicalGroupKey, ...differences]).size, 6);
});

test('workspace creates one canonical node and dependency edge per group while retaining every event', () => {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal);
  assert.equal(workspace.ingest({ kind: 'observation', observation, offers: [], goalEvaluation: evaluation }).accepted, true);
  const recall = workspace.beginRequest({ requestId: 'recall', channel: 'reasoning', operation: 'recall-effect',
    nodeId: root, baseSequence: 1 });
  const recalled = workspace.ingest({ kind: 'operation-completed', requestId: recall.requestId, epoch: recall.epoch,
    operation: 'recall-effect', nodeId: root, baseSequence: 1,
    result: { version: 'PhysicalRecallBundleV2',
      atomicCandidates: [candidate('b', 1, { basin: 'basin' }), candidate('a', 1, { basin: 'basin' })],
      continuousPatterns: [] } });
  assert.equal(recalled.registeredNodeIds.length, 1);
  const node = workspace.snapshot().nodes.find(value => value.node.nodeId === recalled.registeredNodeIds[0])!.node;
  assert.equal(node.kind, 'experienced');
  assert.deepEqual(node.kind === 'experienced' && node.candidateMembers?.map(value => value.candidateId), ['a', 'b']);

  const expand = workspace.beginRequest({ requestId: 'expand', channel: 'reasoning', operation: 'expand-condition',
    nodeId: node.nodeId, baseSequence: 1, factorIds: ['factor-0'] });
  const expanded = workspace.ingest({ kind: 'operation-completed', requestId: expand.requestId, epoch: expand.epoch,
    operation: 'expand-condition', nodeId: node.nodeId, baseSequence: 1,
    result: [transition('z', 0), transition('y', 0)] });
  assert.equal(expanded.registeredNodeIds.length, 1);
  const snapshot = workspace.snapshot();
  const child = snapshot.nodes.find(value => value.node.nodeId === expanded.registeredNodeIds[0])!.node;
  assert.deepEqual(child.kind === 'factor-transition' && child.transitionMembers?.map(value => value.transitionId), ['y', 'z']);
  assert.equal(snapshot.dependencies.filter(edge => edge.dependentNodeId === node.nodeId
    && edge.requiredNodeId === child.nodeId).length, 1);
});

test('execution is existential over original hard gates and deterministically falls back when a winner clears', () => {
  const candidates = [candidate('a', 1, { basin: 'basin' }), candidate('b', 1, { basin: 'basin' })];
  const conditions: ConditionApplicabilityV1 = { matchedFactorIds: ['factor'], contradictedFactorIds: [],
    unknownFactorIds: [], applicability: 1, productionEligible: true,
    memberResults: [condition('a', 0), condition('b', 1)], selectedCandidateId: 'b' };
  const predictions: BranchPredictionV1 = { ...memberPrediction('b', 1).value,
    memberResults: [memberPrediction('a', 0), memberPrediction('b', 1)], winningCandidateId: 'b' };
  assert.equal(selectExecutablePhysicalMemberV1(candidates, conditions, predictions, [])?.candidate.candidateId, 'b');

  const bothValid: ConditionApplicabilityV1 = { ...conditions,
    memberResults: [condition('a', 1), condition('b', 1)] };
  const winnerCleared: BranchPredictionV1 = { ...memberPrediction('a', .75).value,
    memberResults: [memberPrediction('a', .75), memberPrediction('b', 1, false)], winningCandidateId: 'b' };
  assert.equal(selectExecutablePhysicalMemberV1(candidates, bothValid, winnerCleared, [])?.candidate.candidateId, 'a');
  const allCleared: BranchPredictionV1 = { ...winnerCleared,
    memberResults: [memberPrediction('a', 1, false), memberPrediction('b', 1, false)] };
  assert.equal(selectExecutablePhysicalMemberV1(candidates, bothValid, allCleared, []), null);
  const noProgress: BranchPredictionV1 = { ...memberPrediction('a', 0).value,
    memberResults: [memberPrediction('a', 0), memberPrediction('b', 0)], winningCandidateId: null };
  assert.equal(selectExecutablePhysicalMemberV1(candidates, bothValid, noProgress, []), null);
  assert.equal(selectExecutablePhysicalMemberV1(candidates, bothValid, noProgress, [], false)
    ?.candidate.candidateId, 'a');
});

test('factor-transition progress is scored from predicted factor state rather than an unrelated effect goal', () => {
  const source = transition('factor-source', 0);
  const physical = factorTransitionCandidateForControlV2(source, ['factor-0']);
  assert.equal(physical.candidateId, source.transitionId);
  assert.deepEqual(physical.observedChanges, []);
  const raw: BranchPredictionV1 = { ...memberPrediction('factor-source', 1).value,
    progressSampleCount: 24, progressFraction: 1,
    nextStates: [
      { version: 'HypotheticalPublicStateV1', baseObservationSequence: 1,
        knownChanges: [], knownActiveFactorIds: [], knownInactiveFactorIds: [],
        unknownFactorIds: ['factor-0'], unobserved: 'unknown' },
      { version: 'HypotheticalPublicStateV1', baseObservationSequence: 1,
        knownChanges: [], knownActiveFactorIds: ['factor-0'], knownInactiveFactorIds: [],
        unknownFactorIds: [], unobserved: 'unknown' },
    ] };
  const scored = scoreDesiredFactorProgressV2(raw, ['factor-0']);
  assert.equal(scored.progressSampleCount, 1);
  assert.equal(scored.progressFraction, .5);
  assert.equal(desiredFactorProgressFractionV2(scored, ['factor-0']), .5);
});

test('factor-transition execution requires a complete projected parent R2A relation, not one changed factor', () => {
  const physical = factorTransitionCandidateForControlV2(transition('projected-source', 0), ['factor-0', 'factor-1']);
  const raw: BranchPredictionV1 = { ...memberPrediction('projected-source', 1).value,
    currentEvidence: physical.evidence,
    nextStates: [
      { version: 'HypotheticalPublicStateV1', baseObservationSequence: observation.sequence,
        knownChanges: [], knownActiveFactorIds: ['factor-0'], knownInactiveFactorIds: [],
        unknownFactorIds: ['factor-1'], unobserved: 'unknown' },
      { version: 'HypotheticalPublicStateV1', baseObservationSequence: observation.sequence,
        knownChanges: [], knownActiveFactorIds: ['factor-0', 'factor-1'], knownInactiveFactorIds: [],
        unknownFactorIds: [], unobserved: 'unknown' },
    ] };
  const projected = (complete: boolean): ProjectedParentRelationApplicabilityV1 => ({
    version: 'ProjectedParentRelationApplicabilityV1', selectedRelationId: 'parent-relation',
    matchedFactorIds: complete ? ['factor-0', 'factor-1'] : ['factor-0'],
    contradictedFactorIds: [], unknownFactorIds: complete ? [] : ['factor-1'],
    applicability: complete ? 1 : .5, productionEligible: complete,
    relationResults: [{ relationId: 'parent-relation',
      matchedFactorIds: complete ? ['factor-0', 'factor-1'] : ['factor-0'],
      contradictedFactorIds: [], unknownFactorIds: complete ? [] : ['factor-1'],
      applicability: complete ? 1 : .5, productionEligible: complete }],
  });
  const onlyPartial = scoreProjectedParentRelationProgressV1(raw, [projected(false), projected(false)]);
  assert.equal(onlyPartial.progressFraction, 0);
  assert.equal(onlyPartial.progressBasis, 'parent-R2A-relation-complete');
  assert.equal(desiredFactorProgressFractionV2(onlyPartial, ['factor-0', 'factor-1']), 0,
    'selection weakened the complete relation score back to any-factor');
  const eligibleCondition: ConditionApplicabilityV1 = { matchedFactorIds: [], contradictedFactorIds: [],
    unknownFactorIds: [], applicability: 1, productionEligible: true };
  assert.equal(selectExecutablePhysicalMemberV1([physical], eligibleCondition, onlyPartial,
    ['factor-0', 'factor-1']), null);

  const oneComplete = scoreProjectedParentRelationProgressV1(raw, [projected(false), projected(true)]);
  assert.equal(oneComplete.progressSampleCount, 1);
  assert.equal(oneComplete.progressFraction, .5);
  assert.equal(desiredFactorProgressFractionV2(oneComplete, ['factor-0', 'factor-1']), .5);
  assert.equal(selectExecutablePhysicalMemberV1([physical], eligibleCondition, oneComplete,
    ['factor-0', 'factor-1']), null, 'one complete sample out of two is below the production rollout gate');
  const thresholdRaw: BranchPredictionV1 = { ...raw,
    nextStates: Array.from({ length: 24 }, (_, index) => raw.nextStates[index < 6 ? 0 : 1]!) };
  const thresholdComplete = scoreProjectedParentRelationProgressV1(thresholdRaw,
    Array.from({ length: 24 }, (_, index) => projected(index >= 6)));
  assert.equal(thresholdComplete.progressFraction, .75);
  assert.equal(selectExecutablePhysicalMemberV1([physical], eligibleCondition, thresholdComplete,
    ['factor-0', 'factor-1'])?.candidate.candidateId, physical.candidateId);

  assert.equal(desiredFactorProgressFractionV2(raw, []), raw.progressFraction,
    'ordinary grounded-goal prediction semantics changed');
});

test('the sealed-run cardinalities are representable as exact 48-to-3 and 38-to-8 physical groups', () => {
  const effects = Array.from({ length: 48 }, (_, index) => candidate(`effect-${index.toString().padStart(2, '0')}`,
    Math.floor(index / 16), { basin: `effect-basin-${Math.floor(index / 16)}` }));
  assert.equal(groupEffectCandidatesForControlV1('root:goal', effects).length, 3);
  assert.equal(groupEffectCandidatesForControlV1('root:goal', effects).flatMap(group => group.members).length, 48);

  const transitions = Array.from({ length: 38 }, (_, index) => transition(`transition-${index.toString().padStart(2, '0')}`,
    index < 30 ? Math.floor(index / 5) : 6 + Math.floor((index - 30) / 4)));
  assert.equal(groupFactorTransitionsForControlV2(transitions).length, 8);
  assert.equal(groupFactorTransitionsForControlV2(transitions)
    .flatMap(group => group.members).length, 38);
});

test('the same physical factor-transition groups are shared across dependent parents without losing members', () => {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal);
  assert.equal(workspace.ingest({ kind: 'observation', observation, offers: [], goalEvaluation: evaluation }).accepted, true);
  const recall = workspace.beginRequest({ requestId: 'two-parents', channel: 'reasoning', operation: 'recall-effect',
    nodeId: root, baseSequence: observation.sequence });
  const recalled = workspace.ingest({ kind: 'operation-completed', requestId: recall.requestId, epoch: recall.epoch,
    operation: 'recall-effect', nodeId: root, baseSequence: observation.sequence,
    result: { version: 'PhysicalRecallBundleV2', continuousPatterns: [], atomicCandidates: [
      candidate('parent-a', 1, { basin: 'parent-a' }),
      candidate('parent-b', 2, { basin: 'parent-b' }),
    ] } });
  assert.equal(recalled.accepted, true);
  assert.equal(recalled.registeredNodeIds.length, 2);

  const groups = [16, 20, 1, 1, 1, 1, 1];
  const physicalTransitions = groups.flatMap((size, group) => Array.from({ length: size }, (_unused, member) =>
    transition(`shared-${group}-${member}`, group)));
  const registrations: string[][] = [];
  for (const [index, parent] of recalled.registeredNodeIds.entries()) {
    const request = workspace.beginRequest({ requestId: `expand-parent-${index}`, channel: 'reasoning',
      operation: 'expand-condition', nodeId: parent, baseSequence: observation.sequence, factorIds: ['factor-0'] });
    const result = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
      operation: 'expand-condition', nodeId: parent, baseSequence: observation.sequence,
      result: index === 0 ? physicalTransitions : [...physicalTransitions].reverse() });
    assert.equal(result.accepted, true);
    registrations.push([...result.registeredNodeIds].sort());
  }

  assert.deepEqual(registrations[1], registrations[0],
    'a parent ID changed the identity of otherwise identical physical transition evidence');
  const snapshot = workspace.snapshot();
  const factorNodes = snapshot.nodes.filter(value => value.node.kind === 'factor-transition');
  assert.equal(factorNodes.length, 7, 'seven physical groups were copied once per dependent parent');
  assert.equal(factorNodes.flatMap(value => value.node.kind === 'factor-transition'
    ? value.node.transitionMembers ?? [value.node.transition] : []).length, 41,
  'sharing discarded or duplicated original transition members');
  for (const parent of recalled.registeredNodeIds) assert.equal(snapshot.dependencies.filter(edge =>
    edge.dependentNodeId === parent && registrations[0]!.includes(edge.requiredNodeId)).length, 7,
  'sharing a physical node dropped a parent-specific dependency edge');
});

test('one satisfied parent cannot globally suppress a shared transition still required by another parent', async () => {
  const edgeA = { edgeId: 'edge-a', dependentNodeId: 'parent-a', requiredNodeId: 'shared-transition',
    factorIds: ['F'], kind: 'opaque-factor' as const, createdEpoch: 1, createdObservationSequence: 1 };
  const edgeB = { ...edgeA, edgeId: 'edge-b', dependentNodeId: 'parent-b' };
  const satisfied: ConditionApplicabilityV1 = { matchedFactorIds: ['F'], contradictedFactorIds: [],
    unknownFactorIds: [], applicability: 1, productionEligible: true };
  const missing: ConditionApplicabilityV1 = { matchedFactorIds: [], contradictedFactorIds: [],
    unknownFactorIds: ['F'], applicability: 0, productionEligible: true };
  assert.equal((await import('../src/control/controller.js')).dependencyEdgeSatisfiedV2(edgeA, satisfied), true);
  assert.equal((await import('../src/control/controller.js')).dependencyEdgeSatisfiedV2(edgeB, missing), false);

  const source = await readFile('src/control/controller.ts', 'utf8');
  assert.doesNotMatch(source,
    /workspace\.dependencies\.some\(edge\s*=>\s*edge\.requiredNodeId\s*===\s*node\.node\.nodeId[\s\S]{0,500}dependencyEdgeSatisfiedV2/,
  'the controller treats satisfaction of any parent edge as global completion of the shared physical node');
});
