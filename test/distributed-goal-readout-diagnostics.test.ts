import test from 'node:test';
import assert from 'node:assert/strict';
import { distributedGoalReadoutDiagnosticsV1 } from '../src/distributed-hierarchical-memory.js';
import type { GroundedGoalV1 } from '../src/control/contracts.js';
import type { Observation } from '../src/contracts.js';
import type { EventLocalPublicRoleBindingV1 } from '../src/events.js';

const observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'opaque',
  targetId: 'a', self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
  objects: [{ id: 'a', type: 'opaque', relativePosition: [0, 0, -1], properties: { q: 'start' } }] };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'target',
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'p',
    subject: { kind: 'public-object', id: 'a', expectedType: 'opaque' },
    observable: 'properties.q', comparator: 'equals', target: 'final' } } };
const bindings: readonly EventLocalPublicRoleBindingV1[] = [{ version: 'EventLocalPublicRoleBindingV1',
  role: 'opaque#0', type: 'opaque', directActionTarget: true, stableProperties: {} }];
const readouts = [{ valid: true, decodedValues: [{ subjectRole: 'opaque#0', property: 'q', value: 'intermediate' }] }];

test('a physically decoded intermediate value is goal-relevant without satisfying the final goal', () => {
  const result = distributedGoalReadoutDiagnosticsV1(readouts, goal, observation, bindings);
  assert.equal(result.roleBindingStatus, 'matched');
  assert.equal(result.goalRelevantKernelVisited, true);
  assert.equal(result.goalRelevantReadoutCount, 1);
});

test('invalid or unvisited output never establishes a relevant terminal arrival', () => {
  for (const input of [[], [{ ...readouts[0]!, valid: false }],
    [{ valid: true, decodedValues: [{ ...readouts[0]!.decodedValues[0]!, property: 'unrelated' }] }]]) {
    assert.equal(distributedGoalReadoutDiagnosticsV1(input, goal, observation, bindings).goalRelevantKernelVisited, false);
  }
});

test('an arrival on another same-type current subject cannot satisfy the goal binding', () => {
  const other: Observation = { ...observation, targetId: 'b',
    objects: [...observation.objects, { ...observation.objects[0]!, id: 'b' }] };
  assert.equal(distributedGoalReadoutDiagnosticsV1(readouts, goal, other, bindings).goalRelevantReadoutCount, 0);
  assert.equal(distributedGoalReadoutDiagnosticsV1(readouts, goal, { ...observation, objects: [] }, bindings)
    .roleBindingStatus, 'target-unavailable');
});
