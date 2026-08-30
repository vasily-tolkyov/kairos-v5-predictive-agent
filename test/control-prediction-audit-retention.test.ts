import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, Prediction } from '../src/contracts.js';
import type { BranchPredictionV1, EffectRecallCandidateV1, GoalEvaluationV1,
  GroundedGoalV1 } from '../src/control/contracts.js';
import { compactBranchPredictionForControlAuditV2, ControlWorkspaceV2 } from '../src/control/workspace.js';

const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'yaw', comparator: 'equals', target: 1,
} } };
const observation: Observation = { sequence: 1, activeSeconds: .05, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, targetId: null, contextId: 'ctx' };
const evaluation: GoalEvaluationV1 = { goalId: 'g', status: 'mismatch', residual: 1,
  observationSequence: 1, predicates: [] };
const evidence = { eventId: 'event', anchorId: 'anchor',
  r1: { pageId: 'r1', traceId: 'trace', active: true }, r2: { coordinate: [0, 0, 0], active: true },
  r2a: { relationIds: ['rel'], applicability: 1, productionEligible: true } };
const candidate: EffectRecallCandidateV1 = { candidateId: 'candidate', goalPredicateIds: ['p'],
  actionCue: { kind: 'look', parameters: { yawDelta: 15, pitchDelta: 0 }, targetRole: null },
  observedChanges: [], observedBefore: {}, evidence, unknown: [] };

function prediction(positionCount = 181): BranchPredictionV1 {
  const positions = Array.from({ length: positionCount }, (_, index) => [index, index + 1, index + 2]);
  return { prediction: { kind: 'hypothetical-prediction', support: 1, calibratedProbability: false,
    samples: [{ seed: 1, traceId: 'trace', pageId: 'r1', positions, readout: [], reason: null }],
    evidence: {}, unknown: [], mapSha256: 'map' } satisfies Prediction,
    validSampleCount: 1, progressSampleCount: 1, progressFraction: 1, nextStates: [], unknown: [] };
}

test('control audit projection retains physical outcome but not every integration position', () => {
  const full = prediction();
  const compact = compactBranchPredictionForControlAuditV2(full);
  assert.equal(full.prediction.samples[0]!.positions.length, 181, 'live physical result was mutated');
  const sample = compact.prediction.samples[0]!;
  assert.equal(sample.positions.length, 2);
  assert.deepEqual(sample.positions[0], [0, 1, 2]);
  assert.deepEqual(sample.positions[1], [180, 181, 182]);
  assert.equal(sample.simulatedPositionCount, 181);
  assert.equal(sample.trajectoryRetention, 'endpoints-only');
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
    epoch: recall.epoch, operation: 'recall-effect', nodeId: root, baseSequence: 1, result: [candidate] });
  const nodeId = recalled.registeredNodeIds[0]!;
  const request = workspace.beginRequest({ requestId: 'r2', channel: 'reasoning', operation: 'predict-branch',
    nodeId, baseSequence: 1 });
  const full = prediction();
  workspace.ingest({ kind: 'operation-completed', requestId: request.requestId, epoch: request.epoch,
    operation: 'predict-branch', nodeId, baseSequence: 1, result: full });

  assert.equal(workspace.currentPrediction(nodeId)!.prediction.samples[0]!.positions.length, 181);
  const snap = workspace.snapshot();
  const retained = snap.nodes.find(value => value.node.nodeId === nodeId)!.prediction!.value.prediction.samples[0]!;
  assert.equal(retained.positions.length, 2);
  assert.equal(retained.simulatedPositionCount, 181);
});
