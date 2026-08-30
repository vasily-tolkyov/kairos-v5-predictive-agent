import test from 'node:test';
import assert from 'node:assert/strict';
import { MinecraftBody } from '../src/body.js';
import type { Observation } from '../src/contracts.js';

const captured: Observation = {
  sequence: 41,
  activeSeconds: 2.05,
  self: { position: [0, 0, 0], yaw: 0, pitch: 0,
    properties: { onGround: true, selectedSlot: 0, heldItem: null } },
  objects: [{ id: 'block:1,0,0', type: 'opaque-block', relativePosition: [1, 0, 0], properties: {} }],
  targetId: null,
  contextId: 'captured-public-frame',
};

test('a captured observation owns an immutable offer catalogue even after the live world advances', () => {
  // listActionOffers is intentionally a pure projection of its argument. The
  // body instance is not connected and no private live state is consulted.
  const body = Object.create(MinecraftBody.prototype) as MinecraftBody;
  const offers = body.listActionOffers(captured);
  assert(offers.length > 0);
  assert(offers.every(offer => offer.observationSequence === captured.sequence));
  const requirement = body.describeActionRequirement({ kind: 'interact', parameters: {}, targetRole: 'opaque-block' }, captured);
  assert.equal(requirement.version, 'PublicActionRequirementV1');
  assert.equal(requirement.actionCue.kind, 'interact');
  assert.equal(requirement.observationSequence, captured.sequence);
  assert.equal(requirement.satisfied, false);
  assert.deepEqual(requirement.missing, ['public-crosshair-block']);
  assert(offers.every(offer => offer.offerId.length === 64));
  assert(offers.some(offer => offer.action.kind === 'look'
    && offer.action.parameters.yawDegrees === 15));
  assert(!offers.some(offer => offer.action.kind === 'interact'));
});
