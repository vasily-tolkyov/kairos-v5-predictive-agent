import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation } from '../src/contracts.js';
import { eventLocalCurrentPublicStateV1, type EventLocalPublicRoleBindingV1 } from '../src/events.js';

const binding: EventLocalPublicRoleBindingV1 = { version: 'EventLocalPublicRoleBindingV1',
  role: 'object-0', type: 'anonymous', directActionTarget: false,
  stableProperties: { available: true } };
const observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'new', targetId: null,
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
  objects: [{ id: 'current', type: 'anonymous', relativePosition: [0, 0, -1],
    properties: { available: false } }] };

test('a unique public subject still exists when its remembered condition is no longer satisfied', () => {
  const result = eventLocalCurrentPublicStateV1(observation, [binding]);
  assert.deepEqual(result.unresolvedRoles, []);
  assert.equal(result.values.find(value => value.subjectRole === 'object-0'
    && value.property === 'available')?.value, false);
});

test('body-bound crosshair identity does not require remembered conditions', () => {
  const result = eventLocalCurrentPublicStateV1({ ...observation, targetId: 'current' },
    [{ ...binding, directActionTarget: true }]);
  assert.deepEqual(result.unresolvedRoles, []);
});

test('several same-type subjects remain unknown without unique public identifying evidence', () => {
  const second = { ...observation.objects[0]!, id: 'second' };
  const result = eventLocalCurrentPublicStateV1({ ...observation,
    objects: [...observation.objects, second] }, [binding]);
  assert.deepEqual(result.unresolvedRoles, ['object-0']);
  const absent = eventLocalCurrentPublicStateV1({ ...observation, objects: [] }, [binding]);
  assert.deepEqual(absent.unresolvedRoles, ['object-0']);
});
