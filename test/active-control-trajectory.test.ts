import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveControlTrajectoryV1 } from '../src/control/active-trajectory.js';
import type { Observation } from '../src/contracts.js';
import { ControlWorkspaceV2 } from '../src/control/workspace.js';
import { physicalDependencyPathsV1 } from '../src/control/short-chain-paths.js';
import { distributedEvidenceFixtureV3 } from './distributed-control-fixtures.js';
import type { GroundedGoalV1, GoalEvaluationV1, EffectRecallCandidateV1 } from '../src/control/contracts.js';

const frame = (sequence: number, v: number): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'c', targetId: null, objects: [], self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { v } } });
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'root', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'properties.v', comparator: 'equals', target: 2 } } };
const evaluation: GoalEvaluationV1 = { goalId: 'root', observationSequence: 1, status: 'mismatch', residual: 1, predicates: [] };
const candidate = (id: string): EffectRecallCandidateV1 => ({ candidateId: id, actionCue: {
  kind: 'wait', parameters: { ticks: 5 }, targetRole: null }, evidence: distributedEvidenceFixtureV3(id),
  observedBefore: {}, observedChanges: [], goalPredicateIds: ['p'], unknown: [] });

test('unchanged physics ticks preserve a query; changed-then-restored reality invalidates it', () => {
  const activity = new ActiveControlTrajectoryV1(); activity.accept(frame(1, 0));
  const query = activity.begin('q', 'branch'); activity.accept(frame(100, 0));
  assert(activity.current(query));
  activity.accept(frame(101, 1)); activity.accept(frame(102, 0));
  assert.equal(activity.current(query), false);
  const next = activity.capture(); activity.action('real-1');
  assert.equal(activity.current(next), false);
  assert.equal(activity.snapshot().lastActionEventId, 'real-1');
});

test('dependency path nomination retains parents and cannot invent unconnected actions', () => {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal);
  workspace.ingest({ kind: 'observation', observation: frame(1, 0), offers: [], goalEvaluation: evaluation });
  const recall = (nodeId: string, id: string) => {
    const request = workspace.beginRequest({ requestId: id, nodeId, operation: 'recall-effect', channel: 'reasoning', baseSequence: 1 });
    return workspace.ingest({ kind: 'operation-completed', requestId: id, nodeId, epoch: request.epoch, baseSequence: 1,
      operation: 'recall-effect', result: { version: 'PhysicalRecallBundleV2', atomicCandidates: [candidate(id)], continuousPatterns: [] } }).registeredNodeIds[0]!;
  };
  const parent = recall(root, 'b');
  const requirement = workspace.registerPublicRequirement(parent, { ...goal, id: 'need-1' }, 'historical-transition-precondition');
  const child = recall(requirement, 'a'), unrelated = recall(root, 'other');
  assert.deepEqual(physicalDependencyPathsV1(child, workspace.snapshot()), [[child, parent]]);
  assert.deepEqual(physicalDependencyPathsV1(unrelated, workspace.snapshot()), []);
  const request = workspace.beginRequest({ requestId: 'compare', nodeId: parent,
    channel: 'reasoning', operation: 'compare-condition', baseSequence: 1 });
  workspace.invalidateFeedback();
  const result = workspace.ingest({ kind: 'operation-completed', requestId: 'compare', nodeId: parent,
    epoch: request.epoch, baseSequence: 1, operation: 'compare-condition', result: { matchedFactorIds: [],
      contradictedFactorIds: [], unknownFactorIds: [], applicability: 1, productionEligible: true } });
  assert.equal(result.accepted, false); assert.equal(result.reason, 'stale-operation-epoch');
  assert.deepEqual(physicalDependencyPathsV1(child, workspace.snapshot()), [[child, parent]]);
});
