import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedR1ExperienceStoreV1 } from '../src/core/learning/distributed-r1.js';
import { DistributedR2ContinuityStoreV1 } from '../src/core/learning/distributed-r2.js';
import type { DistributedR2ContinuousEventV1 } from '../src/core/learning/distributed-r2-contracts.js';
import { sha } from '../src/util.js';

test('projection identity is identical without taking an unrelated full-medium snapshot', t => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'metadata-test', seedHex: '42' });
  const r1 = new DistributedR1ExperienceStoreV1(medium);
  const expected = sha(r1.snapshot().projection);
  t.mock.method(medium, 'snapshot', () => { throw new Error('unrelated-medium-scan'); });
  assert.equal(r1.projectionSha256(), expected);
});

test('single-event/context reads equal the old full collection and cannot mutate history', t => {
  const empty = new DistributedR2ContinuityStoreV1();
  const state = empty.snapshot();
  const event: DistributedR2ContinuousEventV1 = { version: 'DistributedR2ContinuousEventV1',
    eventId: 'censored-metadata-only', atomIds: ['a', 'b'], sourceEventIds: ['x', 'y'],
    orderedExperienceIdentities: [], orderedEpisodePatternIds: [], dependencyIds: [], contextIds: ['ctx'],
    completion: 'censored', boundaryReason: 'continuity-gap', learningEligible: false,
    physicalFootprint: null, terminalChanges: [], beforePublicSignals: [], beforeSignalTimeline: [],
    beforePublicSignalOccurrences: [], beforeSignalTimelineOccurrences: [], physicalPulseSiteIds: [],
    atomPulseRanges: [], patternSha256: 'metadata-only' };
  const store = DistributedR2ContinuityStoreV1.restore(empty.medium.snapshot(), { ...state, events: [event] });
  const old = store.events()[0]!;
  t.mock.method(store, 'events', () => { throw new Error('unrelated-event-collection-copy'); });
  assert.deepEqual(store.event(event.eventId), old);
  assert.deepEqual(store.eventContextIds(event.eventId), old.contextIds);
  assert.equal(store.event('missing'), undefined);
  assert.equal(store.eventContextIds('missing'), undefined);
  const returned = store.event(event.eventId)!;
  (returned.contextIds as string[]).push('not-real');
  assert.deepEqual(store.eventContextIds(event.eventId), ['ctx']);
  const contexts = store.eventContextIds(event.eventId)!;
  (contexts as string[]).push('not-real');
  assert.deepEqual(store.event(event.eventId), old);
  assert.equal(store.isEventActive(event.eventId), false, 'metadata-only audit gained physical support');
});
