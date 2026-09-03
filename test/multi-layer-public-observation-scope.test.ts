import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { describeActionRequirement } from '../src/body.js';
import type { ActionObservationScopeV1, GroundedGoalV1 } from '../src/control/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { actionObservationTrackedIdsV1, eventRows } from '../src/events.js';

const frame = (sequence: number, buttonDistance: number, aimed: boolean, doorOpen: boolean,
  movingX = 3): Observation => ({
  sequence, activeSeconds: sequence * .05, contextId: 'multi-layer-public-scope',
  targetId: aimed ? 'block:button' : null,
  self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { heldItem: null } },
  objects: [
    { id: 'block:button', type: 'stone_button', relativePosition: [0, 0, buttonDistance],
      properties: { powered: doorOpen } },
    { id: 'block:door', type: 'iron_door', relativePosition: [1, 0, 5], properties: { open: doorOpen } },
    { id: 'entity:moving', type: 'opaque_mover', relativePosition: [movingX, 0, 1], properties: {} },
  ],
});

test('relativeDistance is a public relational observable and an event change, never an R1 world coordinate', () => {
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'near-button', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'distance',
      subject: { kind: 'public-object', id: 'block:button', expectedType: 'stone_button' },
      observable: 'relativeDistance', comparator: 'within', lower: 0, upper: 4.5 },
  } };
  const evaluator = new GroundedGoalEvaluatorV1();
  evaluator.setGoal(goal, frame(1, 5.25, false, false));
  assert.equal(evaluator.evaluate(frame(1, 5.25, false, false)).status, 'mismatch');
  assert.equal(evaluator.evaluate(frame(2, 4.25, false, false)).status, 'satisfied');

  const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  const event: RealEvent = { version: 'RealEventV5', id: 'distance-event',
    cue: { kind: 'move', parameters: action.parameters, targetRole: null },
    frames: [frame(1, 5.25, false, false), frame(2, 4.25, false, false)],
    trackedIds: ['self', 'block:button'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
  const change = eventRows(event).changes.flat().find(value => value.property === 'relativeDistance');
  assert.deepEqual(change && { before: change.before, after: change.after }, { before: 5.25, after: 4.25 });
});

test('a targeted primitive reports both exact aim and unique public interaction distance without proposing a method', () => {
  const cue = { kind: 'interact' as const, parameters: {}, targetRole: 'stone_button' };
  const far = describeActionRequirement(cue, frame(1, 5.25, false, false));
  assert.equal(far.version, 'PublicActionRequirementV2');
  assert.deepEqual(far.missing, ['public-crosshair-block', 'public-unique-target-within-interaction-distance']);
  assert.equal(far.goal?.expression.kind, 'all');
  assert.equal('suggestedAction' in far, false);

  const nearButNotAimed = describeActionRequirement(cue, frame(2, 4.25, false, false));
  assert.deepEqual(nearButNotAimed.missing, ['public-crosshair-block']);
  const ready = describeActionRequirement(cue, frame(3, 4.25, true, false));
  assert.equal(ready.satisfied, true);
  assert.deepEqual(ready.missing, []);
  assert.equal(ready.targetBinding?.objectId, 'block:button');
});

test('one action observation scope retains the direct target, referenced door, and real attended mover', () => {
  const scope: ActionObservationScopeV1 = { version: 'ActionObservationScopeV1',
    referencedPublicObjectIds: ['block:door'] };
  const frames = [frame(1, 2, true, false, 3), frame(2, 2, true, true, 2)];
  assert.deepEqual(actionObservationTrackedIdsV1('block:button', scope, ['entity:moving'], frames),
    ['self', 'block:button', 'block:door', 'entity:moving']);
  const action: Action = { kind: 'interact', parameters: {}, targetId: 'block:button' };
  const event: RealEvent = { version: 'RealEventV5', id: 'cross-object-event',
    cue: { kind: 'interact', parameters: {}, targetRole: 'stone_button' }, frames,
    trackedIds: actionObservationTrackedIdsV1(action.targetId, scope, ['entity:moving'], frames),
    provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
  const changes = eventRows(event).changes.flat();
  assert(changes.some(value => value.subject.startsWith('iron_door#')
    && value.property === 'open' && value.after === true));
  assert(changes.some(value => value.subject.startsWith('opaque_mover#')
    && value.property === 'displacement.0'));
});
