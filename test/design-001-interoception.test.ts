import test from 'node:test';
import assert from 'node:assert/strict';
import type { RealEvent } from '../src/contracts.js';
import { attachInteroceptionToEventV1, computeInteroceptiveChannelsV1 } from '../src/control/interoception.js';
import { validateEvent } from '../src/events.js';

test('L1 interoceptive channels are bounded, deterministic and pre-outcome', () => {
  const input = { control: null, actions: 2, actionBudget: 10 } as const;
  const left = computeInteroceptiveChannelsV1(input);
  const right = computeInteroceptiveChannelsV1(input);
  assert.deepEqual(left, right);
  assert.deepEqual(left.map(value => value.name), ['action-budget-remaining']);
  assert.equal(left[0]!.value, .8);
  assert.equal(left[0]!.provenance, 'verified-internal');
  assert.equal(left[0]!.availableBeforeOutcome, true);
});

test('internal channels remain outside the public Observation properties', () => {
  const frame = {
    sequence: 1, activeSeconds: 0, objects: [], targetId: null, contextId: 'c',
    self: { position: [0, 0, 0] as const, yaw: 0, pitch: 0, properties: {} },
  };
  const event = {
    version: 'RealEventV5', id: 'interoception-test', cue: { kind: 'observe', parameters: {}, targetRole: null },
    frames: [frame, { ...frame, sequence: 2, activeSeconds: 1 }], trackedIds: ['self'],
    bodyResult: null, provenance: 'observed-passive', complete: true,
  } as RealEvent;
  const enriched = attachInteroceptionToEventV1(event, computeInteroceptiveChannelsV1({
    control: null, actions: 0, actionBudget: 1 }));
  assert.deepEqual(enriched.frames[0]!.self.properties, {});
  assert.equal(enriched.version, 'RealEventV6');
  assert.equal(enriched.verifiedInternalChannels?.length, 1);
  validateEvent(enriched);
});

test('caller-supplied internal metadata cannot pass as a V5 event', () => {
  const frame = {
    sequence: 1, activeSeconds: 0, objects: [], targetId: null, contextId: 'c',
    self: { position: [0, 0, 0] as const, yaw: 0, pitch: 0, properties: {} },
  };
  const forged = {
    version: 'RealEventV5', id: 'forged-interoception', cue: { kind: 'observe', parameters: {}, targetRole: null },
    frames: [frame, { ...frame, sequence: 2, activeSeconds: 1 }], trackedIds: ['self'],
    bodyResult: null, provenance: 'observed-passive', complete: true,
    verifiedInternalChannels: [{ version: 'VerifiedInternalChannelV1', name: 'goal-residual', value: 0,
      provenance: 'verified-internal', availableBeforeOutcome: true }],
  } as unknown as RealEvent;
  assert.throws(() => validateEvent(forged), /verified-internal-channels-require-v6/);
});
