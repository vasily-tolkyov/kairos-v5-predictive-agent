import test from 'node:test';
import assert from 'node:assert/strict';
import { GroundedGoalEvaluatorV1, desiredChangesForGoal } from '../src/control/goal.js';
import type { GroundedGoalV1, GoalPredicateV1 } from '../src/control/contracts.js';
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

test('translating a goal and its measured trajectory cannot change progress estimates', () => {
  const trajectories: number[][] = [];
  for (const offset of [-10000, 0, 10000]) {
    const at = (z: number): Observation => ({ ...observation(1, false, false),
      self: { ...observation(1, false, false).self, position: [0, 0, offset + z] } });
    const evaluator = new GroundedGoalEvaluatorV1();
    evaluator.setGoal({ version: 'GroundedGoalV1', id: 'translated-goal', expression: { kind: 'predicate', predicate: {
      version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' }, observable: 'position.2',
      comparator: 'less-than', target: offset - 20 } } }, at(5));
    trajectories.push([5, 0, -5, -19, -21].map(z => evaluator.evaluate(at(z)).residual));
  }
  for (const values of trajectories) values.forEach((value, i) => assert(Math.abs(value - trajectories[0]![i]!) < 1e-12));
});

test('measured approach to a distant narrow region remains visible before reaching its boundary', () => {
  const at = (z: number): Observation => ({ ...observation(1, false, false),
    self: { ...observation(1, false, false).self, position: [0, 0, z] } });
  const evaluator = new GroundedGoalEvaluatorV1();
  evaluator.setGoal({ version: 'GroundedGoalV1', id: 'narrow-region', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' }, observable: 'position.2',
    comparator: 'within', lower: -10, upper: -8 } } }, at(5));
  const residuals = [5, 0, -5, -9].map(z => evaluator.evaluate(at(z)).residual);
  assert(residuals.every((value, i) => i === 0 || value < residuals[i - 1]!));
});

test('approach after a setback remains measurable beyond the original goal baseline', () => {
  const at = (z: number): Observation => ({ ...observation(1, false, false),
    self: { ...observation(1, false, false).self, position: [0, 0, z] } });
  const base = { version: 'GoalPredicateV1' as const, id: 'destination', subject: { kind: 'self' as const }, observable: 'position.2' as const };
  const cases: { predicate: GoalPredicateV1; trajectory: number[] }[] = [
    { predicate: { ...base, comparator: 'less-than', target: -20 }, trajectory: [40, 35, 30, 0, -21] },
    { predicate: { ...base, comparator: 'greater-than', target: 20 }, trajectory: [-40, -35, -30, 0, 21] },
    { predicate: { ...base, comparator: 'within', lower: -20, upper: -18 }, trajectory: [40, 35, 30, 0, -19] },
    { predicate: { ...base, comparator: 'increase', minimumDelta: 20 }, trajectory: [-40, -35, -30, 0, 21] },
    { predicate: { ...base, comparator: 'decrease', minimumDelta: 20 }, trajectory: [40, 35, 30, 0, -21] } ];
  for (const { predicate, trajectory } of cases) {
    const evaluator = new GroundedGoalEvaluatorV1();
    evaluator.setGoal({ version: 'GroundedGoalV1', id: 'recover-after-detour', expression: { kind: 'predicate', predicate } }, at(0));
    const residuals = trajectory.map(z => evaluator.evaluate(at(z)).residual);
    assert(residuals.every((value, i) => value < 1 && (i === 0 || value < residuals[i - 1]!)), predicate.comparator);
    assert.equal(evaluator.evaluate(at(trajectory.at(-1)!)).status, 'satisfied');
    const uncertain = { ...at(trajectory[1]!), predictionSupport: ['self/position.2'],
      predictionBounds: { 'self/position.2': [Math.min(...trajectory.slice(0, 2)), Math.max(...trajectory.slice(0, 2))] as const } };
    assert.equal(evaluator.evaluate(uncertain).residual, residuals[0], 'a possible setback cannot be discarded in favor of the mean');
  }
});
