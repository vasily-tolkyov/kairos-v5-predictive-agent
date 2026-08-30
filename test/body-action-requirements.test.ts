import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActionCue, Observation, PrimitiveKind, PublicObject } from '../src/contracts.js';
import { describeActionRequirement } from '../src/body.js';

const observation = (target: PublicObject | null, heldItem: string | null = null): Observation => ({
  sequence: 41,
  activeSeconds: 2.05,
  contextId: 'public-context',
  targetId: target?.id ?? null,
  objects: target ? [target] : [],
  self: {
    position: [0, 64, 0],
    yaw: 0,
    pitch: 0,
    properties: { heldItem },
  },
});

const block: PublicObject = {
  id: 'block:1,64,2', type: 'opaque-block', relativePosition: [1, 0, 2], properties: {},
};
const entity: PublicObject = {
  id: 'entity:17', type: 'opaque-entity', relativePosition: [0, 0, 2], properties: {},
};
const cue = (kind: PrimitiveKind, targetRole: string | null = null): ActionCue =>
  ({ kind, parameters: {}, targetRole });

test('target-free primitives expose satisfied body facts without an action suggestion', () => {
  const kinds: readonly PrimitiveKind[] = [
    'observe', 'wait', 'look', 'move', 'jump', 'select-hotbar',
  ];
  for (const kind of kinds) {
    const result = describeActionRequirement(cue(kind), observation(null));
    assert.equal(result.satisfied, true);
    assert.deepEqual(result.required, []);
    assert.deepEqual(result.missing, []);
    assert.equal(result.targetBinding, null);
    assert.equal('suggestedAction' in result, false);
    assert.equal('subgoal' in result, false);
  }
});

test('target primitives report missing public crosshair facts without saying how to satisfy them', () => {
  assert.deepEqual(describeActionRequirement(cue('interact', block.type), observation(null)).missing,
    ['public-crosshair-block']);
  assert.deepEqual(describeActionRequirement(cue('break', block.type), observation(null)).missing,
    ['public-crosshair-block']);
  assert.deepEqual(describeActionRequirement(cue('attack', entity.type), observation(null)).missing,
    ['public-crosshair-entity']);
  assert.deepEqual(describeActionRequirement(cue('place', block.type), observation(null)).missing,
    ['public-crosshair-block', 'public-held-item']);
});

test('requirements bind the exact current public target and reject the wrong public kind', () => {
  const interaction = describeActionRequirement(cue('interact', block.type), observation(block));
  assert.equal(interaction.satisfied, true);
  assert.deepEqual(interaction.targetBinding, {
    objectId: block.id,
    objectType: block.type,
    publicKind: 'block',
    observationSequence: 41,
  });

  const attack = describeActionRequirement(cue('attack', entity.type), observation(entity));
  assert.equal(attack.satisfied, true);
  assert.equal(attack.targetBinding?.objectId, entity.id);
  assert.equal(attack.targetBinding?.publicKind, 'entity');

  const wrongKind = describeActionRequirement(cue('attack', entity.type), observation(block));
  assert.equal(wrongKind.satisfied, false);
  assert.deepEqual(wrongKind.missing, ['public-crosshair-entity']);
  assert.equal(wrongKind.targetBinding?.objectId, block.id);
});

test('place requires both an exact public block and a currently public held item', () => {
  const missingItem = describeActionRequirement(cue('place', block.type), observation(block));
  assert.equal(missingItem.satisfied, false);
  assert.deepEqual(missingItem.missing, ['public-held-item']);
  assert.equal(missingItem.targetBinding?.objectId, block.id);

  const ready = describeActionRequirement(cue('place', block.type), observation(block, 'opaque-item'));
  assert.equal(ready.satisfied, true);
  assert.deepEqual(ready.missing, []);
});
