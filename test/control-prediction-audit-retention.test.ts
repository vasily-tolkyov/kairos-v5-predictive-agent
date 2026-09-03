import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation } from '../src/contracts.js';
import type { BranchPredictionV1, EffectRecallCandidateV1, GoalEvaluationV1,
  GroundedGoalV1 } from '../src/control/contracts.js';
import { compactBranchPredictionForControlAuditV2, ControlWorkspaceV2 } from '../src/control/workspace.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3,
  distributedPredictionSampleFixtureV3 } from './distributed-control-fixtures.js';

const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'yaw', comparator: 'equals', target: 1,
} } };
const observation: Observation = { sequence: 1, activeSeconds: .05, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, targetId: null, contextId: 'ctx' };
const evaluation: GoalEvaluationV1 = { goalId: 'g', status: 'mismatch', residual: 1,
  observationSequence: 1, predicates: [] };
const evidence = distributedEvidenceFixtureV3('audit-retention', { relationIds: ['rel'], applicability: 1 });
const candidate: EffectRecallCandidateV1 = { candidateId: 'candidate', goalPredicateIds: ['p'],
  actionCue: { kind: 'look', parameters: { yawDelta: 15, pitchDelta: 0 }, targetRole: null },
  observedChanges: [], observedBefore: {}, evidence, unknown: [] };

function prediction(): BranchPredictionV1 {
  return { prediction: distributedPredictionFixtureV3(evidence,
    [distributedPredictionSampleFixtureV3()]),
    validSampleCount: 1, progressSampleCount: 1, progressFraction: 1, nextStates: [], unknown: [] };
}

test('control audit projection retains native distributed field readout without inventing positions', () => {
  const full = prediction();
  const compact = compactBranchPredictionForControlAuditV2(full);
  assert.deepEqual(compact.prediction.samples, full.prediction.samples);
  assert.equal('positions' in compact.prediction.samples[0]!, false);
  assert.deepEqual(compact.prediction.samples[0]!.leaderSiteIds, [7, 8]);
  assert.equal(compact.progressFraction, full.progressFraction);
  assert.equal(compact.validSampleCount, full.validSampleCount);
});

test('workspace snapshot is bounded while live current prediction remains complete', () => {
  const workspace = new ControlWorkspaceV2();
  const root = workspace.setGoal(goal);
  assert.equal(workspace.ingest({ kind: 'observation', observation, offers: [], goalEvaluation: evaluation }).accepted, true);
  const recall = workspace.beginRequest({ requestId: 'r1', channel: 'reasoning', operation: 'recall-effect',
    nodeId: root, baseSequence: 1 });
  const recalled = workspace.ingest({ kind: 'operation-completed', requestId: recall.requestId,
    epoch: recall.epoch, operation: 'recall-effect', nodeId: root, baseSequence: 1,
    result: { version: 'PhysicalRecallBundleV2', atomicCandidates: [candidate], continuousPatterns: [] } });
  const nodeId = recalled.registeredNodeIds[0]!;
  const request = workspace.beginRequest({ requestId: 'r2', channel: 'reasoning', operation: 'predict-branch',
    nodeId, baseSequence: 1 });
  const full = prediction();
  workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'predict-branch', nodeId, baseSequence: 1,
    result: { version: 'ControlBranchPredictionResultV2', atomic: full, continuations: [] } });

  assert.deepEqual(workspace.currentPrediction(nodeId)!.prediction.samples[0]!.leaderSiteIds, [7, 8]);
  const snap = workspace.snapshot();
  const retained = snap.nodes.find(value => value.node.nodeId === nodeId)!.prediction!.value.prediction.samples[0]!;
  assert.deepEqual(retained, workspace.currentPrediction(nodeId)!.prediction.samples[0]);
  assert.equal('positions' in retained, false);
});
