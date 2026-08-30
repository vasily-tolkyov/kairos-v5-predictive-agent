import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundedGoalEvaluatorV1, desiredChangesForGoal } from '../src/control/goal.js';
import type { GroundedGoalV1 } from '../src/control/contracts.js';
import type { Observation } from '../src/contracts.js';

const observation = (sequence: number, open: boolean, include = true): Observation => ({ sequence,
  activeSeconds: sequence * .05, self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
  objects: include ? [{ id: 'object-public-1', type: 'opaque-test-object', relativePosition: [1, 0, 0], properties: { open } }] : [],
  targetId: include ? 'object-public-1' : null, contextId: 'neutral-context' });
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'p', subject: { kind: 'public-object', id: 'object-public-1', expectedType: 'opaque-test-object' },
  observable: 'properties.open', comparator: 'equals', target: true } } };

test('grounded goals freeze their baseline and missing or ambiguous public subjects remain unknown', () => {
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation(1, false));
  const mismatch = evaluator.evaluate(observation(2, false)); assert.equal(mismatch.status, 'mismatch');
  assert.deepEqual(desiredChangesForGoal(goal, mismatch), [{ predicateId: 'p',
    desired: { subject: 'opaque-test-object', property: 'open', value: true } }]);
  assert.equal(evaluator.evaluate(observation(3, true)).status, 'satisfied');
  const unknown = evaluator.evaluate(observation(4, false, false)); assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.predicates[0]!.reason, 'public-observable-unavailable');
});

test('crosshair target type is a public, verifiable body-affordance goal', () => {
  const targetGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'aim-at-type', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'aimed', subject: { kind: 'crosshair' },
      observable: 'type', comparator: 'equals', target: 'opaque-test-object' } } };
  const evaluator = new GroundedGoalEvaluatorV1();
  const without = observation(10, false, false); evaluator.setGoal(targetGoal, without);
  assert.equal(evaluator.evaluate(without).status, 'mismatch');
  assert.deepEqual(desiredChangesForGoal(targetGoal, evaluator.evaluate(without)), [{ predicateId: 'aimed',
    desired: { subject: 'crosshair', property: 'type', value: 'opaque-test-object' } }]);
  assert.equal(evaluator.evaluate(observation(11, false, true)).status, 'satisfied');
});
