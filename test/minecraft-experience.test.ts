import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, BodyResult, Observation, RealEvent } from '../src/contracts.js';
import type { ActionObservationScopeV1 } from '../src/control/contracts.js';
import { MinecraftExperienceEnvironment } from '../src/adapters/minecraft/experience.js';
import { cueFor } from '../src/events.js';
import { MinecraftBody, describeActionRequirement } from '../src/body.js';

test('offer observations retain their actual frame while a later action starts from a different physical frame', async () => {
  let current: Observation = { sequence: 1, activeSeconds: .05, contextId: 'apparatus', targetId: 'block:0,64,-1',
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { health: 20 } },
    objects: [{ id: 'block:0,64,-1', type: 'opaque', relativePosition: [0, 0, -1], properties: {} }] };
  const body = { latest: () => current, describeActionRequirement,
    listActionOffers: (observation: Observation) => MinecraftBody.actionOffers(observation),
    execute: async (action: Action) => {
      const before = current; current = { ...current, sequence: 3, activeSeconds: .15 };
      const result: BodyResult = { action, executed: true, status: 'completed', startSequence: 2, endSequence: 3 };
      const event: RealEvent = { version: 'RealEventV5', id: 'delayed-body:event-1', cue: cueFor(action, before),
        frames: [before, current], trackedIds: ['self'], bodyResult: result, provenance: 'executed-real-body', complete: true };
      return { result, event };
    }, waitForObservationAfter: async () => current };
  const environment = new MinecraftExperienceEnvironment(body), observed = await environment.observe();
  current = { ...current, sequence: 2, activeSeconds: .1, targetId: null, objects: [] };
  const earlier = environment.listActionOffers(observed); assert(earlier.some(offer => offer.action.kind === 'interact'));
  const receipt = await environment.executeOffer(earlier.find(offer => offer.action.kind === 'look')!);
  assert(receipt.executed); assert(receipt.availableOffers?.length);
  assert(receipt.availableOffers.every(offer => offer.observationSequence === 2));
  assert(!receipt.availableOffers.some(offer => offer.action.kind === 'interact'));
});

test('experience adapter forwards real body feedback and observes remote public subjects', async () => {
  let observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'public', targetId: null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'remote', type: 'opaque', relativePosition: [0, 0, -1], properties: {} }] };
  const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
  let scope: ActionObservationScopeV1 | undefined, calls = 0;
  const body = {
    latest: () => observation,
    listActionOffers: (current: Observation) => [{ version: 'ActionOfferV1' as const,
      offerId: `offer-${current.sequence}`, observationSequence: current.sequence, action, cue: cueFor(action, current) }],
    describeActionRequirement: () => ({ satisfied: true }) as never,
    execute: async (selected: Action, selectedScope?: ActionObservationScopeV1) => {
      calls++; scope = selectedScope;
      const before = observation;
      observation = { ...observation, sequence: 2, activeSeconds: .1 };
      const result: BodyResult = { action: selected, executed: true, status: 'completed', startSequence: 1, endSequence: 2 };
      const event: RealEvent = { version: 'RealEventV5', id: 'actual-window', cue: cueFor(selected, before),
        frames: [before, observation], trackedIds: ['self', 'remote'], bodyResult: result,
        provenance: 'executed-real-body', complete: true };
      return { result, event };
    },
    waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 },
  };
  const environment = new MinecraftExperienceEnvironment(body);
  const offer = environment.listActionOffers(await environment.observe())[0]!;
  const result = await environment.executeOffer(offer);
  assert.equal(calls, 1); assert.equal(result.event?.id, 'actual-window');
  assert.equal(result.event?.frames.at(-1)?.sequence, result.observation.sequence);
  assert.deepEqual(scope?.referencedPublicObjectIds, ['remote']);
  body.describeActionRequirement = () => ({ satisfied: false }) as never;
  assert.equal((await environment.executeOffer(offer)).executed, false);
  assert.equal(calls, 1);
});
test('a block-only retina cannot bind an entity action to the surface behind it', async () => {
  const observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'engine', targetId: 'entity:17',
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'entity:17', type: 'opaque-living', relativePosition: [0, 0, -1], properties: { attackable: true } }],
    perception: { version: 'AttentivePerception8', attendedId: 'percept-1', gazeId: 'percept-1', receptors: 9, groups: 1,
      tracks: [{ id: 'percept-1', position: [0, 1, -2], color: [.5, .5, .5], extent: .5, sampleCount: 9,
        visible: true, confidence: 1, ambiguity: 0, age: 2, missed: 0, anchorEpoch: 0, motionEvidence: [true, true, true] }] } };
  const action: Action = { kind: 'attack', parameters: {}, targetId: 'entity:17' };
  const rawOffer = { version: 'ActionOfferV1' as const, offerId: 'opaque', observationSequence: 1, action,
    cue: cueFor(action, observation) };
  let calls = 0;
  const environment = new MinecraftExperienceEnvironment({ latest: () => observation, listActionOffers: () => [rawOffer],
    describeActionRequirement: () => ({ satisfied: true }) as never,
    execute: async () => { calls++; throw new Error('unperceived-entity-must-not-be-executed'); },
    waitForObservationAfter: async () => observation });
  const sensed = await environment.observe();
  assert.equal(sensed.targetId, 'percept-1'); assert.equal(sensed.objects[0]!.type, 'percept');
  assert.deepEqual(environment.listActionOffers(sensed), []);
  const forged = { ...rawOffer, action: { ...action, targetId: 'percept-1' }, cue: { ...rawOffer.cue, targetRole: 'percept' } };
  assert.equal((await environment.executeOffer(forged)).executed, false);
  assert.equal(calls, 0);
});

test('an exact cursor offer remains usable among identical blocks without guessing another target', async () => {
  const cursor = 'block:0,64,-1', other = 'block:1,64,-1';
  const observation: Observation = { sequence: 1, activeSeconds: .05, contextId: 'engine', targetId: cursor,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [cursor, other].map((id, i) => ({ id, type: 'opaque-material', relativePosition: [i, 0, -1], properties: {} })),
    perception: { version: 'AttentivePerception8', attendedId: 'percept-1', gazeId: 'percept-1', receptors: 9, groups: 1,
      tracks: [{ id: 'percept-1', position: [0, 1, -1], color: [.5, .5, .5], extent: .5, sampleCount: 9,
        visible: true, confidence: 1, ambiguity: 0, age: 2, missed: 0, anchorEpoch: 0, motionEvidence: [true, true, true] }] } };
  let calls = 0;
  const body = { latest: () => observation, describeActionRequirement,
    listActionOffers: (current: Observation) => MinecraftBody.actionOffers(current),
    execute: async (action: Action) => {
      calls++; assert.equal(action.targetId, cursor);
      const result: BodyResult = { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 };
      const after = { ...observation, sequence: 2, activeSeconds: .1 };
      const event: RealEvent = { version: 'RealEventV5', id: 'actual-cursor-window', cue: cueFor(action, observation),
        frames: [observation, after], trackedIds: ['self', cursor], bodyResult: result,
        provenance: 'executed-real-body', complete: true };
      return { result, event };
    }, waitForObservationAfter: async () => observation };
  const environment = new MinecraftExperienceEnvironment(body), sensed = await environment.observe();
  const offers = environment.listActionOffers(sensed);
  assert(offers.some(offer => offer.action.kind === 'interact'));
  const dig = offers.find(offer => offer.action.kind === 'break')!;
  assert.equal(dig.action.targetId, 'percept-1');
  assert.equal(dig.cue.targetRole, 'percept');
  assert.equal((await environment.executeOffer(dig)).executed, true);
  assert.equal((await environment.executeOffer({ ...dig, action: { ...dig.action, targetId: 'percept-other' } })).executed, false);
  // Even a malformed body catalogue cannot expose an off-cursor target.
  body.listActionOffers = current => MinecraftBody.actionOffers(current).map(offer => offer.action.targetId
    ? { ...offer, action: { ...offer.action, targetId: other } } : offer);
  assert(!environment.listActionOffers(sensed).some(offer => offer.action.kind === 'break'));
  assert.equal((await environment.executeOffer(dig)).executed, false);
  assert.equal(calls, 1);
});
