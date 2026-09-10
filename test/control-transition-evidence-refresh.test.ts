import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlWorkspaceV2 } from '../src/control/workspace.js';
import type { GroundedGoalV1, OpaqueFactorTransitionTraceV1 } from '../src/control/contracts.js';
import { distributedEvidenceFixtureV3 } from './distributed-control-fixtures.js';

const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: {
  kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' },
    observable: 'yaw', comparator: 'equals', target: 1 } } };
const original: OpaqueFactorTransitionTraceV1 = { version: 'OpaqueFactorTransitionTraceV1',
  transitionId: 'one-real-transition', eventId: 'event:one',
  actionCue: { kind: 'look', parameters: { yawDelta: 15, pitchDelta: 0 }, targetRole: null },
  activatedFactorIds: ['F'], deactivatedFactorIds: [], unchangedActiveFactorIds: [],
  evidence: distributedEvidenceFixtureV3('one'), meaning: 'observed-factor-transition' };

function setup() {
  const workspace = new ControlWorkspaceV2(), root = workspace.setGoal(goal);
  workspace.ingest({ kind: 'observation', observation: { sequence: 1, activeSeconds: 0,
    objects: [], self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    targetId: null, contextId: 'ctx' }, offers: [], goalEvaluation: { goalId: 'g', status: 'mismatch',
    residual: 1, observationSequence: 1, predicates: [] } });
  let ordinal = 0;
  const expand = (value: OpaqueFactorTransitionTraceV1) => {
    const request = workspace.beginRequest({ requestId: `e${++ordinal}`, operation: 'expand-condition',
      channel: 'reasoning', nodeId: root, baseSequence: 1, factorIds: ['F'] });
    return workspace.ingest({ kind: 'operation-completed', ...request, operation: 'expand-condition', result: [value] });
  };
  return { workspace, root, expand };
}

test('recalled real transition keeps its identity when current physical support changes', () => {
  const { workspace, root, expand } = setup();
  const nodeId = expand(original).registeredNodeIds[0]!;
  const request = workspace.beginRequest({ requestId: 'c', channel: 'reasoning',
    operation: 'compare-condition', nodeId, baseSequence: 1 });
  workspace.ingest({ kind: 'operation-completed', ...request, operation: 'compare-condition',
    result: { matchedFactorIds: ['F'], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: .8, productionEligible: true } });
  const revised = { ...original, evidence: { ...original.evidence,
    r2a: { ...original.evidence.r2a, applicability: .1, branchSelectionStrength: .1, supportStrength: .1 } } };
  assert.deepEqual(expand(revised).registeredNodeIds, [nodeId]);
  const snapshot = workspace.snapshot(), node = snapshot.nodes.find(n => n.node.nodeId === nodeId)!;
  assert.equal(node.node.kind, 'factor-transition');
  if (node.node.kind !== 'factor-transition') throw new Error('wrong-node');
  assert.deepEqual(node.node.transition.evidence, revised.evidence);
  assert.equal(workspace.currentCondition(nodeId), null, 'old group qualification survived changed evidence');
  assert.equal(snapshot.nodes.filter(n => n.node.kind === 'factor-transition').length, 1);
  assert(snapshot.dependencies.some(e => e.dependentNodeId === root && e.requiredNodeId === nodeId));
  assert.equal(original.evidence.r2a.applicability, .8, 'caller-owned history was mutated');
});

test('one transition ID cannot be reused for a different real source event', () => {
  const { expand } = setup();
  expand(original);
  assert.throws(() => expand({ ...original, eventId: 'event:unrelated' }), /identity-collision/);
});
