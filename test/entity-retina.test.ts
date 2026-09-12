import assert from 'node:assert/strict';
import test from 'node:test';
import { rayBoxDistance, visibleEntityColor, visibleItemColor } from '../src/adapters/minecraft/retina.js';
import { MinecraftExperienceEnvironment } from '../src/adapters/minecraft/experience.js';
import type { Action, Observation, BodyResult, RealEvent } from '../src/contracts.js';
import { MinecraftBody, describeActionRequirement } from '../src/body.js';
import { cueFor } from '../src/events.js';

test('entity silhouettes obey ray distance and occlusion; absent visual assets have no identity color', () => {
  assert.equal(rayBoxDistance([0, 1, 0], [0, 0, -1], [-.3, 0, -2.3], [.3, 2, -1.7], 8), 1.7);
  assert.equal(rayBoxDistance([0, 1, 0], [0, 0, -1], [-.3, 0, -2.3], [.3, 2, -1.7], 1), null);
  assert.equal(rayBoxDistance([2, 1, 0], [0, 0, -1], [-.3, 0, -2.3], [.3, 2, -1.7], 8), null);
  assert.equal(rayBoxDistance([0, 1, -2], [0, 0, -1], [-.3, 0, -2.3], [.3, 2, -1.7], 8), 0);
  assert(visibleEntityColor('drowned')); assert(visibleEntityColor('pig'));
  assert.notDeepEqual(visibleItemColor('apple'), visibleItemColor('cooked_beef'));
  assert.equal(visibleEntityColor('unrendered-entity'), null); assert.equal(visibleItemColor('unrendered-item'), null);
});

test('dropped objects use their measured item appearance and remain unknown before stack metadata arrives', () => {
  assert.equal(visibleEntityColor('item'), null);
  assert.deepEqual(visibleEntityColor('item', 'apple'), visibleItemColor('apple'));
  assert.deepEqual(visibleEntityColor('item', 'oak_planks'), visibleItemColor('oak_planks'));
  assert.equal(visibleEntityColor('item', 'unrendered-item'), null);
  assert.notDeepEqual(visibleEntityColor('item', 'apple'), visibleEntityColor('item', 'oak_planks'));
});

test('an entity action binds only to the actual retinal surface, without exposing engine identity', async () => {
  let observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'engine', targetId: 'entity:17',
    retinalTargetId: 'entity:17', self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'entity:17', type: 'drowned', relativePosition: [0, 0, -2], properties: { attackable: true } }],
    perception: { version: 'AttentivePerception8', attendedId: 'percept-1', gazeId: 'percept-1', receptors: 9, groups: 1,
      tracks: [{ id: 'percept-1', position: [0, 1.6, -1.7], color: [.2, .4, .3], extent: .5, sampleCount: 9,
        visible: true, confidence: 1, ambiguity: 0, age: 2, missed: 0, anchorEpoch: 0, motionEvidence: [true, true, true] }] } };
  let calls = 0;
  const body = { latest: () => observation, describeActionRequirement,
    listActionOffers: (current: Observation) => MinecraftBody.actionOffers(current),
    execute: async (action: Action) => {
      calls++; assert.equal(action.targetId, 'entity:17');
      const result: BodyResult = { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 };
      const after = { ...observation, sequence: 2, activeSeconds: .1 };
      const event: RealEvent = { version: 'RealEventV5', id: 'actual-entity-window', cue: cueFor(action, observation),
        frames: [observation, after], trackedIds: ['self', 'entity:17'], bodyResult: result,
        provenance: 'executed-real-body', complete: true };
      return { result, event };
    }, waitForObservationAfter: async () => observation };
  const environment = new MinecraftExperienceEnvironment(body), sensed = await environment.observe();
  const offer = environment.listActionOffers(sensed).find(value => value.action.kind === 'attack'); assert(offer);
  assert.equal(offer.action.targetId, 'percept-1'); assert.equal(offer.cue.targetRole, 'percept');
  const result = await environment.executeOffer(offer); assert(result.executed); assert(result.event);
  const text = JSON.stringify([sensed, offer, result.event]);
  assert(!text.includes('drowned')); assert(!text.includes('entity:17')); assert(!text.includes('retinalTargetId'));
  observation = { ...observation, retinalTargetId: 'block:0,64,-1' };
  assert(!environment.listActionOffers(await environment.observe()).some(value => value.action.kind === 'attack'));
  assert.equal((await environment.executeOffer(offer)).executed, false); assert.equal(calls, 1);
});
