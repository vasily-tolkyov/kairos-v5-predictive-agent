import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, PublicChange, PublicObject, RealEvent } from '../src/contracts.js';
import type { GoalExpressionV1, GroundedGoalV1, GoalPredicateV1 } from '../src/control/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { eventRows, type EventLocalPublicRoleBindingV1 } from '../src/events.js';
import { cumulativePublicChangePrefixV1, evaluatePredictionChangesAgainstGoalV1,
  isOpenCrosshairCategoryFeatureV1, predictionChangesAdvanceGoalV1 }
  from '../src/hierarchical-memory.js';

const object = (id: string, type: string, distance: number,
  properties: PublicObject['properties']): PublicObject =>
  ({ id, type, relativePosition: [0, 0, -distance], properties });

const observation = (objects: readonly PublicObject[] = [
  object('door-current', 'iron_door', 4, { open: false }),
  object('button-current', 'stone_button', 5, { powered: false, note: 0 }),
]): Observation => ({ sequence: 10, activeSeconds: 1,
  self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
  objects, targetId: null, contextId: 'public-test' });

const change = (subject: string, property: string, before: PublicChange['before'],
  after: PublicChange['after'], observationIndex = 1): PublicChange => ({ subject, property, before, after,
  observationIndex, meaning: 'observed-co-occurrence' });

type PredicateWithoutIdentity<T = GoalPredicateV1> = T extends GoalPredicateV1
  ? Omit<T, 'version' | 'id'> : never;

const predicateGoal = (id: string, predicate: PredicateWithoutIdentity): GroundedGoalV1 =>
  ({ version: 'GroundedGoalV1', id, expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: `${id}-p`, ...predicate } as GoalPredicateV1 } });

const expressionGoal = (id: string, expression: GoalExpressionV1): GroundedGoalV1 =>
  ({ version: 'GroundedGoalV1', id, expression });

const roleBinding = (role: string, type: string,
  stableProperties: PublicObject['properties'] = {}, directActionTarget = false): EventLocalPublicRoleBindingV1 =>
  ({ version: 'EventLocalPublicRoleBindingV1', role, type, directActionTarget, stableProperties });

const ordinaryRoleBindings: readonly EventLocalPublicRoleBindingV1[] = [
  roleBinding('iron_door#0', 'iron_door'), roleBinding('stone_button#0', 'stone_button'),
];

const advances = (base: Observation, goal: GroundedGoalV1, changes: readonly PublicChange[],
  bindings: readonly EventLocalPublicRoleBindingV1[] = ordinaryRoleBindings): boolean => {
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, base);
  return predictionChangesAdvanceGoalV1(base, goal, evaluator.evaluate(base), changes, bindings);
};

test('a kernel exposes the cumulative real-event prefix, not only its latest local step', () => {
  const kernels = [[], [change('self', 'displacement.1', 0, 1.024, 1)],
    [change('self', 'displacement.1', 1.024, .95, 2)]] as const;
  assert.deepEqual(cumulativePublicChangePrefixV1(kernels, 0), []);
  assert.deepEqual(cumulativePublicChangePrefixV1(kernels, 2),
    [change('self', 'displacement.1', 0, .95, 2)]);
  const goal = predicateGoal('rise', { subject: { kind: 'self' }, observable: 'position.1',
    comparator: 'greater-than', target: 64.5 });
  assert.equal(advances(observation(), goal,
    cumulativePublicChangePrefixV1(kernels, 2)), true);
});

test('an incidental untracked crosshair type stays exact in public facts but cannot expand R1 measurement', () => {
  const button = object('button-current', 'stone_button', 3, { powered: false });
  const background = object('background-current', 'quartz_block', 2, {});
  const before: Observation = { ...observation([button, background]), sequence: 1,
    targetId: button.id };
  const after: Observation = { ...observation([button, background]), sequence: 2,
    activeSeconds: 1.05, targetId: background.id };
  const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  const event: RealEvent = { version: 'RealEventV5', id: 'crosshair-background-event',
    cue: { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null },
    frames: [before, after], trackedIds: ['self', button.id],
    bodyResult: { action, executed: true, status: 'completed', terminationReason: 'stable',
      startSequence: 1, endSequence: 2 }, provenance: 'executed-real-body', complete: true };
  const rows = eventRows(event);
  assert.ok(rows.changes.flat().some(value => value.subject === 'crosshair'
    && value.property === 'type' && value.before === 'stone_button'
    && value.after === 'quartz_block'));
  assert.ok(rows.measurementChanges.flat().some(value => value.subject === 'crosshair'
    && value.property === 'type' && value.before === 'stone_button' && value.after === null));
  assert.ok(rows.rows.some(row => row['change/crosshair/type/observed'] === 1),
    'the generic physical fact that the crosshair category changed was lost');
  assert.equal(rows.roleBindings.some(value => value.type === 'quartz_block'), false);
});

test('only open crosshair category values can reuse a frozen R1 category slot', () => {
  assert.equal(isOpenCrosshairCategoryFeatureV1('crosshair/target-type="quartz_block"'), true);
  assert.equal(isOpenCrosshairCategoryFeatureV1('change/crosshair/type/before="iron_bars"'), true);
  assert.equal(isOpenCrosshairCategoryFeatureV1('change/crosshair/type/after="stone_bricks"'), true);
  assert.equal(isOpenCrosshairCategoryFeatureV1('change/crosshair/type/observed'), false);
  assert.equal(isOpenCrosshairCategoryFeatureV1('change/crosshair/visible/before=true'), false);
  assert.equal(isOpenCrosshairCategoryFeatureV1('change/iron_bars#0/type/before="iron_bars"'), false);
  assert.equal(isOpenCrosshairCategoryFeatureV1('self/pitch-15deg-bucket="1"'), false);
});

test('a persistent result is visible at a later reached kernel, but not before its real transition', () => {
  const goal = predicateGoal('door-open', { subject: { kind: 'public-object', id: 'door-current',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  const kernels = [[], [change('iron_door#0', 'open', false, true, 1)], []] as const;
  assert.equal(advances(observation(), goal,
    cumulativePublicChangePrefixV1(kernels, 0)), false);
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation());
  const beforeTargetKernel = evaluatePredictionChangesAgainstGoalV1(observation(), goal,
    evaluator.evaluate(observation()), cumulativePublicChangePrefixV1(kernels, 0), ordinaryRoleBindings);
  assert.equal(beforeTargetKernel.goalRelevantReadout, false);
  assert.equal(beforeTargetKernel.roleBindingStatus, 'goal-change-not-reached');
  assert.equal(advances(observation(), goal,
    cumulativePublicChangePrefixV1(kernels, 2)), true);
});

test('relative distance transports the observed delta into the current scene, never the historical absolute', () => {
  const current = observation([
    object('door-current', 'iron_door', 4, { open: false }),
    object('button-current', 'stone_button', 10, { powered: false, note: 0 }),
  ]);
  const goal = predicateGoal('distance-band', { subject: { kind: 'public-object', id: 'button-current',
    expectedType: 'stone_button' }, observable: 'relativeDistance', comparator: 'within', lower: 9.4, upper: 9.6 });
  assert.equal(advances(current, goal,
    [change('stone_button#0', 'relativeDistance', 5, 4.5)]), true);
});

test('relative-goal progress keeps the goal creation baseline instead of resetting it at prediction time', () => {
  const initial = observation([
    object('door-current', 'iron_door', 4, { open: false }),
    object('button-current', 'stone_button', 10, { powered: false }),
  ]);
  const current = observation([
    object('door-current', 'iron_door', 4, { open: false }),
    object('button-current', 'stone_button', 8, { powered: false }),
  ]);
  const goal = predicateGoal('decrease-two', { subject: { kind: 'public-object', id: 'button-current',
    expectedType: 'stone_button' }, observable: 'relativeDistance', comparator: 'decrease', minimumDelta: 2 });
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, initial);
  const alreadySatisfied = evaluator.evaluate(current);
  assert.equal(alreadySatisfied.status, 'satisfied');
  assert.equal(predictionChangesAdvanceGoalV1(current, goal, alreadySatisfied,
    [change('stone_button#0', 'relativeDistance', 5, 4.5)]), false);
});

test('a public property transition applies only at its observed starting value', () => {
  const atZero = observation(), atOne = observation([
    object('door-current', 'iron_door', 4, { open: false }),
    object('button-current', 'stone_button', 5, { powered: false, note: 1 }),
  ]);
  const goal = predicateGoal('note-two', { subject: { kind: 'public-object', id: 'button-current',
    expectedType: 'stone_button' }, observable: 'properties.note', comparator: 'equals', target: 2 });
  const historicalOneToTwo = [change('stone_button#0', 'note', 1, 2)];
  assert.equal(advances(atZero, goal, historicalOneToTwo), false);
  assert.equal(advances(atOne, goal, historicalOneToTwo), true);
  const goalOne = predicateGoal('note-one', { subject: { kind: 'public-object', id: 'button-current',
    expectedType: 'stone_button' }, observable: 'properties.note', comparator: 'equals', target: 1 });
  assert.equal(advances(atZero, goalOne, [change('stone_button#0', 'note', 0, 1)]), true);
  assert.equal(advances(atOne, goal, [change('stone_button#0', 'note', 0, 1)]), false,
    'a learned 0-to-1 transition was silently generalized into 1-to-2');
});

test('a public readout kernel index cannot be silently truncated or padded', () => {
  assert.throws(() => cumulativePublicChangePrefixV1([[]], 1),
    /public-change-prefix-kernel-out-of-range/);
});

test('object world displacement cannot establish a current relative-position goal', () => {
  const goal = predicateGoal('door-left', { subject: { kind: 'public-object', id: 'door-current',
    expectedType: 'iron_door' }, observable: 'relativePosition.2', comparator: 'less-than', target: -4.5 });
  assert.equal(advances(observation(), goal,
    [change('iron_door#0', 'displacement.2', 0, -1)]), false);
});

test('an event-local object role is unknown when the current type binding is not unique', () => {
  const current = observation([
    object('door-current', 'iron_door', 4, { open: false }),
    object('button-current', 'stone_button', 5, { powered: false }),
    object('button-other', 'stone_button', 6, { powered: false }),
  ]);
  const goal = predicateGoal('button-powered', { subject: { kind: 'public-object', id: 'button-current',
    expectedType: 'stone_button' }, observable: 'properties.powered', comparator: 'equals', target: true });
  assert.equal(advances(current, goal,
    [change('stone_button#0', 'powered', false, true)]), false);
});

test('event-local stable public provenance uniquely binds a lower door without binding its upper half', () => {
  const current = observation([
    object('door-lower', 'iron_door', 4, { open: false, half: 'lower', facing: 'east' }),
    object('door-upper', 'iron_door', 4.1, { open: false, half: 'upper', facing: 'east' }),
    object('button-current', 'stone_button', 5, { powered: false }),
  ]);
  const lowerGoal = predicateGoal('lower-open', { subject: { kind: 'public-object', id: 'door-lower',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  const upperGoal = predicateGoal('upper-open', { subject: { kind: 'public-object', id: 'door-upper',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  const bindings = [roleBinding('iron_door#0', 'iron_door', { half: 'lower', facing: 'east' })];
  const changes = [change('iron_door#0', 'open', false, true)];
  assert.equal(advances(current, lowerGoal, changes, bindings), true);
  assert.equal(advances(current, upperGoal, changes, bindings), false);
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(upperGoal, current);
  assert.equal(evaluatePredictionChangesAgainstGoalV1(current, upperGoal, evaluator.evaluate(current),
    changes, bindings).roleBindingStatus, 'descriptor-mismatch');
});

test('identical event-local descriptors remain unknown instead of choosing by type, order, or distance', () => {
  const current = observation([
    object('door-near', 'iron_door', 4, { open: false, half: 'lower' }),
    object('door-far', 'iron_door', 9, { open: false, half: 'lower' }),
  ]);
  const goal = predicateGoal('near-open', { subject: { kind: 'public-object', id: 'door-near',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, current);
  const evaluated = evaluatePredictionChangesAgainstGoalV1(current, goal, evaluator.evaluate(current),
    [change('iron_door#0', 'open', false, true)],
    [roleBinding('iron_door#0', 'iron_door', { half: 'lower' })]);
  assert.equal(evaluated.advances, false);
  assert.equal(evaluated.roleBindingStatus, 'ambiguous');
});

test('missing event-local provenance fails closed even when the role name resembles the target type', () => {
  const current = observation();
  const goal = predicateGoal('door-open-no-provenance', { subject: { kind: 'public-object', id: 'door-current',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, current);
  const evaluated = evaluatePredictionChangesAgainstGoalV1(current, goal, evaluator.evaluate(current),
    [change('iron_door#0', 'open', false, true)], []);
  assert.equal(evaluated.advances, false);
  assert.equal(evaluated.roleBindingStatus, 'provenance-missing');
});

test('event rows retain only stable public role provenance and exclude ids, positions, and changing properties', () => {
  const frames: Observation[] = [false, true].map((open, index) => ({ sequence: 20 + index,
    activeSeconds: 2 + index * .05,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [object('door-world-id', 'iron_door', 4, { open, half: 'lower', facing: 'east' }),
      object('button-world-id', 'stone_button', 3, { powered: false, face: 'wall' })],
    targetId: 'button-world-id', contextId: 'role-binding-test' }));
  const action: Action = { kind: 'interact', parameters: {}, targetId: 'button-world-id' };
  const event: RealEvent = { version: 'RealEventV5', id: 'role-binding-event',
    cue: { kind: 'interact', parameters: {}, targetRole: 'stone_button' }, frames,
    trackedIds: ['self', 'button-world-id', 'door-world-id'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 20, endSequence: 21,
      terminationReason: 'stable' } };
  const bindings = eventRows(event).roleBindings;
  assert.deepEqual(bindings.find(value => value.type === 'iron_door')?.stableProperties,
    { facing: 'east', half: 'lower' });
  assert.equal(bindings.find(value => value.type === 'stone_button')?.directActionTarget, true);
  const serialized = JSON.stringify(bindings);
  assert(!serialized.includes('door-world-id'));
  assert(!serialized.includes('button-world-id'));
  assert(!serialized.includes('relativePosition'));
  assert(!serialized.includes('"open"'));
});

test('crosshair type can be predicted without inventing a target id, while an unread distance stays unknown', () => {
  const aimed = predicateGoal('aimed', { subject: { kind: 'crosshair' }, observable: 'type',
    comparator: 'equals', target: 'stone_button' });
  assert.equal(advances(observation(), aimed,
    [change('crosshair', 'type', null, 'stone_button')]), true);
  const distance = predicateGoal('crosshair-distance', { subject: { kind: 'crosshair' },
    observable: 'relativeDistance', comparator: 'less-than', target: 4.5 });
  assert.equal(advances(observation(), distance,
    [change('crosshair', 'type', null, 'stone_button')]), false);
});

test('all-goal progress accepts an improved known branch but rejects an explicitly worsened branch', () => {
  const door: GoalPredicateV1 = { version: 'GoalPredicateV1', id: 'door',
    subject: { kind: 'public-object', id: 'door-current', expectedType: 'iron_door' },
    observable: 'properties.open', comparator: 'equals', target: true };
  const rise: GoalPredicateV1 = { version: 'GoalPredicateV1', id: 'rise', subject: { kind: 'self' },
    observable: 'position.1', comparator: 'greater-than', target: 64.5 };
  const goal = expressionGoal('both', { kind: 'all', children: [
    { kind: 'predicate', predicate: door }, { kind: 'predicate', predicate: rise },
  ] });
  assert.equal(advances(observation(), goal,
    [change('iron_door#0', 'open', false, true)]), true);
  assert.equal(advances(observation(), goal,
    [change('iron_door#0', 'open', false, true), change('self', 'displacement.1', 0, -.25)]), false);
});

test('any-goal progress accepts one improved branch even if another known branch worsens', () => {
  const goal = expressionGoal('either', { kind: 'any', children: [
    { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'door',
      subject: { kind: 'public-object', id: 'door-current', expectedType: 'iron_door' },
      observable: 'properties.open', comparator: 'equals', target: true } },
    { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'rise', subject: { kind: 'self' },
      observable: 'position.1', comparator: 'greater-than', target: 64.5 } },
  ] });
  assert.equal(advances(observation(), goal,
    [change('iron_door#0', 'open', false, true), change('self', 'displacement.1', 0, -.25)]), true);
});

test('a predicted value that leaves current goal residual unchanged is not progress', () => {
  const current = observation([
    object('door-current', 'iron_door', 4, { open: true }),
    object('button-current', 'stone_button', 5, { powered: false }),
  ]);
  const goal = predicateGoal('already-open', { subject: { kind: 'public-object', id: 'door-current',
    expectedType: 'iron_door' }, observable: 'properties.open', comparator: 'equals', target: true });
  assert.equal(advances(current, goal,
    [change('iron_door#0', 'open', false, true)]), false);
});
