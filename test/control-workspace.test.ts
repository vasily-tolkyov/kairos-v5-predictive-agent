import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, Prediction } from '../src/contracts.js';
import { ControlWorkspaceV2 } from '../src/control/workspace.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GoalEvaluationV1, GroundedGoalV1, OpaqueFactorTransitionTraceV1 } from '../src/control/contracts.js';

const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'yaw', comparator: 'equals', target: 1 } } };
const observation = (sequence: number): Observation => ({ sequence, activeSeconds: sequence / 20, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, targetId: null, contextId: 'ctx' });
const evaluation = (sequence: number): GoalEvaluationV1 => ({ goalId: 'g', status: 'mismatch', residual: 1,
  observationSequence: sequence, predicates: [{ predicateId: 'p', status: 'mismatch', residual: 1,
    actual: 0, baseline: null, reason: null }] });
const offer = (sequence: number, id = `offer-${sequence}`): ActionOfferV1 => ({ version: 'ActionOfferV1', offerId: id,
  observationSequence: sequence, action: { kind: 'look', parameters: { yawDelta: 15, pitchDelta: 0 } },
  cue: { kind: 'look', parameters: { yawDelta: 15, pitchDelta: 0 }, targetRole: null } });
const physicalEvidence = { eventId: 'event', anchorId: 'anchor', r1: { pageId: 'r1', traceId: 'trace', active: true },
  r2: { coordinate: [0, 0, 0], active: true }, r2a: { relationIds: ['rel'], applicability: .8, productionEligible: true } };
const candidate = (id: string): EffectRecallCandidateV1 => ({ candidateId: id, goalPredicateIds: ['p'],
  actionCue: offer(1).cue, observedChanges: [], observedBefore: {}, evidence: physicalEvidence, unknown: [] });
const transition = (id: string): OpaqueFactorTransitionTraceV1 => ({ version: 'OpaqueFactorTransitionTraceV1',
  transitionId: id, eventId: `event-${id}`, actionCue: offer(1).cue, activatedFactorIds: ['F'],
  deactivatedFactorIds: [], unchangedActiveFactorIds: [], evidence: physicalEvidence,
  meaning: 'observed-factor-transition' });
const condition: ConditionApplicabilityV1 = { matchedFactorIds: ['F'], contradictedFactorIds: [],
  unknownFactorIds: [], applicability: .9, productionEligible: true };
const prediction: BranchPredictionV1 = { prediction: { kind: 'hypothetical-prediction', support: .8,
  calibratedProbability: false, samples: [], evidence: null, unknown: [], mapSha256: 'map' } satisfies Prediction,
  validSampleCount: 24, progressSampleCount: 20, progressFraction: 20 / 24, nextStates: [], unknown: [] };

function initialized(): { workspace: ControlWorkspaceV2; root: string } {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal);
  assert.equal(workspace.ingest({ kind: 'observation', observation: observation(1), offers: [offer(1)],
    goalEvaluation: evaluation(1) }).accepted, true);
  return { workspace, root };
}

function recallOne(workspace: ControlWorkspaceV2, root: string, id = 'candidate'): string {
  const request = workspace.beginRequest({ requestId: `recall-${id}`, channel: 'reasoning', operation: 'recall-effect',
    nodeId: root, baseSequence: 1 });
  const result = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'recall-effect', nodeId: root, baseSequence: 1, result: [candidate(id)] });
  assert.equal(result.accepted, true); return result.registeredNodeIds[0]!;
}

test('one grounded public requirement is shared by every dependent branch', () => {
  const { workspace, root } = initialized();
  const firstParent = recallOne(workspace, root, 'first-parent');
  const secondParent = recallOne(workspace, root, 'second-parent');
  const publicGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'crosshair-type', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'target-type',
      subject: { kind: 'crosshair' }, observable: 'type', comparator: 'equals', target: 'opaque-control' },
  } };
  const first = workspace.registerPublicRequirement(firstParent, publicGoal);
  const second = workspace.registerPublicRequirement(secondParent, structuredClone(publicGoal));
  assert.equal(first, second, 'the same public fact was duplicated per dependent branch');
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.nodes.filter(node => node.node.kind === 'public-requirement').length, 1);
  assert(snapshot.dependencies.some(edge => edge.kind === 'public-action-requirement'
    && edge.dependentNodeId === firstParent && edge.requiredNodeId === first));
  assert(snapshot.dependencies.some(edge => edge.kind === 'public-action-requirement'
    && edge.dependentNodeId === secondParent && edge.requiredNodeId === first));
});

test('the same exact exploration action refreshes one branch instead of creating one branch per physics tick', () => {
  const { workspace } = initialized();
  const first = workspace.registerExploration(offer(1, 'offer-at-sequence-1'));
  assert.equal(workspace.ingest({ kind: 'observation', observation: observation(2), offers: [offer(2)],
    goalEvaluation: evaluation(2) }).accepted, true);
  const second = workspace.registerExploration(offer(2, 'offer-at-sequence-2'));
  assert.equal(second, first);
  const exploration = workspace.snapshot().nodes.filter(value => value.node.kind === 'exploration');
  assert.equal(exploration.length, 1);
  assert.equal(exploration[0]!.node.kind === 'exploration' && exploration[0]!.node.offer.observationSequence, 2);
});

test('a dependent parent remains present and active while its factor-transition child is registered', () => {
  const { workspace, root } = initialized(), parent = recallOne(workspace, root);
  const request = workspace.beginRequest({ requestId: 'expand', channel: 'reasoning', operation: 'expand-condition',
    nodeId: parent, baseSequence: 1, factorIds: ['F'] });
  const result = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'expand-condition', nodeId: parent, baseSequence: 1, result: [transition('t')] });
  assert.equal(result.accepted, true);
  const snapshot = workspace.snapshot(), child = result.registeredNodeIds[0]!;
  assert(snapshot.nodes.some(value => value.node.nodeId === parent));
  assert(snapshot.nodes.some(value => value.node.nodeId === child));
  assert(snapshot.dependencies.some(edge => edge.dependentNodeId === parent && edge.requiredNodeId === child));
  assert.equal(snapshot.nodes.some(value => 'status' in value.node && value.node.status === 'suspended'), false);
});

test('dependency cycles are rejected without deleting either branch or its existing edge', () => {
  const { workspace, root } = initialized(), parent = recallOne(workspace, root);
  const child = workspace.registerExploration(offer(1, 'child'));
  assert.equal(workspace.addDependency(parent, child, ['F']).accepted, true);
  const rejected = workspace.addDependency(child, parent, ['G']);
  assert.deepEqual(rejected, { accepted: false, reason: 'dependency-cycle-rejected', registeredNodeIds: [] });
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.nodes.length, 3);
  assert.equal(snapshot.dependencies.length, 1);
});

test('condition and prediction are fresh only for their exact epoch and observation sequence', () => {
  const { workspace, root } = initialized(), nodeId = recallOne(workspace, root);
  const conditionRequest = workspace.beginRequest({ requestId: 'condition', channel: 'reasoning',
    operation: 'compare-condition', nodeId, baseSequence: 1 });
  assert.equal(workspace.ingest({ kind: 'operation-completed', requestId: 'condition', epoch: conditionRequest.epoch,
    operation: 'compare-condition', nodeId, baseSequence: 1, result: condition }).accepted, true);
  const predictionRequest = workspace.beginRequest({ requestId: 'prediction', channel: 'reasoning',
    operation: 'predict-branch', nodeId, baseSequence: 1 });
  assert.equal(workspace.ingest({ kind: 'operation-completed', requestId: 'prediction', epoch: predictionRequest.epoch,
    operation: 'predict-branch', nodeId, baseSequence: 1, result: prediction }).accepted, true);
  assert.deepEqual(workspace.currentCondition(nodeId), condition);
  assert.deepEqual(workspace.currentPrediction(nodeId), prediction);

  workspace.ingest({ kind: 'observation', observation: observation(2), offers: [offer(2)], goalEvaluation: evaluation(2) });
  assert.equal(workspace.currentCondition(nodeId), null);
  assert.equal(workspace.currentPrediction(nodeId), null);

  const stale = workspace.beginRequest({ requestId: 'stale-condition', channel: 'reasoning',
    operation: 'compare-condition', nodeId, baseSequence: 2 });
  workspace.ingest({ kind: 'observation', observation: observation(3), offers: [offer(3)], goalEvaluation: evaluation(3) });
  assert.equal(workspace.ingest({ kind: 'operation-completed', requestId: stale.requestId, epoch: stale.epoch,
    operation: 'compare-condition', nodeId, baseSequence: 2, result: condition }).reason, 'stale-operation-observation');
  assert.equal(workspace.currentCondition(nodeId), null);
});

test('attention invalidates current transient evidence but retains root, parent, child and dependency graph', () => {
  const { workspace, root } = initialized(), parent = recallOne(workspace, root);
  const child = workspace.registerExploration(offer(1, 'child'));
  workspace.addDependency(parent, child, ['F']);
  const request = workspace.beginRequest({ requestId: 'condition', channel: 'reasoning',
    operation: 'compare-condition', nodeId: parent, baseSequence: 1 });
  workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'compare-condition', nodeId: parent, baseSequence: 1, result: condition });
  const before = workspace.snapshot();
  assert.equal(before.nodes.find(value => value.node.nodeId === parent)!.condition!.fresh, true);

  workspace.ingest({ kind: 'attention', notice: { kind: 'prediction-violation', subjectId: 'self', sequence: 2,
    forecastCompletedBeforeSequence: 1, evidence: { deviation: true } } });
  const after = workspace.snapshot();
  assert.equal(after.nodes.length, before.nodes.length);
  assert.deepEqual(after.dependencies, before.dependencies);
  assert.equal(after.nodes.find(value => value.node.nodeId === parent)!.condition!.fresh, false);
  assert.equal(after.nodes.find(value => value.node.nodeId === parent)!.condition!.invalidatedBy, 'attention');
  assert.equal(workspace.currentCondition(parent), null);
});

test('a real action result is accepted after epoch drift and invalidates old reasoning without losing the graph', () => {
  const { workspace, root } = initialized(), nodeId = recallOne(workspace, root);
  const body = workspace.beginRequest({ requestId: 'body', channel: 'body', operation: 'execute', nodeId,
    baseSequence: 1 });
  workspace.ingest({ kind: 'attention', notice: { kind: 'unknown-change', subjectId: 'external', sequence: 2,
    forecastCompletedBeforeSequence: null, evidence: [] } });
  assert.equal(workspace.snapshot().epoch > body.epoch, true);
  const result = workspace.ingest({ kind: 'action-completed', requestId: body.requestId, nodeId,
    result: { executed: true, observation: observation(4), result: { status: 'completed' } } });
  assert.equal(result.accepted, true);
  const snapshot = workspace.snapshot();
  assert.equal(snapshot.observationSequence, 4);
  assert.equal(snapshot.nodes.some(value => value.node.nodeId === root), true);
  assert.equal(snapshot.nodes.find(value => value.node.nodeId === nodeId)!.lastActionResult!.executed, true);
});

test('mismatched and out-of-order results are rejected and cannot overwrite current evidence', () => {
  const { workspace, root } = initialized(), nodeId = recallOne(workspace, root);
  const request = workspace.beginRequest({ requestId: 'condition', channel: 'reasoning',
    operation: 'compare-condition', nodeId, baseSequence: 1 });
  const mismatch = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'compare-condition', nodeId: root, baseSequence: 1, result: condition });
  assert.equal(mismatch.accepted, false);
  assert.equal(workspace.currentCondition(nodeId), null);
  const accepted = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'compare-condition', nodeId, baseSequence: 1, result: condition });
  assert.equal(accepted.accepted, true);
  const duplicate = workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'compare-condition', nodeId, baseSequence: 1, result: { ...condition, applicability: .1 } });
  assert.equal(duplicate.accepted, false);
  assert.equal(workspace.currentCondition(nodeId)!.applicability, .9);
  assert.equal(workspace.ingest({ kind: 'observation', observation: observation(1), offers: [offer(1)],
    goalEvaluation: evaluation(1) }).reason, 'stale-or-out-of-order-observation');
});
