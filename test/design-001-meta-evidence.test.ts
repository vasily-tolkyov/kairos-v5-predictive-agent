import test from 'node:test';
import assert from 'node:assert/strict';
import type { VerifiedInternalChannelV1 } from '../src/contracts.js';
import { MetaEvidenceStoreV1, deriveMetaEvidenceEpisodesV1,
  metaEvidenceQualificationV1, quantizeMetaInternalChannelsV1 } from '../src/control/meta-evidence.js';

function channel(value: number, name: VerifiedInternalChannelV1['name'] = 'goal-residual'):
VerifiedInternalChannelV1 {
  return { version: 'VerifiedInternalChannelV1', name, value,
    provenance: 'verified-internal', availableBeforeOutcome: true };
}

test('meta channel bands are deterministic and use eight bounded intervals', () => {
  assert.deepEqual(quantizeMetaInternalChannelsV1([channel(0), channel(1, 'branch-entropy')]), [
    { version: 'MetaInternalConditionBandV1', channel: 'branch-entropy', bandId: 7, value: 1 },
    { version: 'MetaInternalConditionBandV1', channel: 'goal-residual', bandId: 0, value: 0 },
  ]);
  assert.equal(quantizeMetaInternalChannelsV1([channel(.125)])[0]!.bandId, 1);
  assert.throws(() => quantizeMetaInternalChannelsV1([{ ...channel(.2), value: 2 }]),
    /meta-channel-value-out-of-range/);
});

test('contiguous meta presence is one episode and re-entry starts another', () => {
  const observations = [0, 1, 2, 3].map(ordinal => ({
    version: 'MetaEvidenceObservationV1' as const, eventId: `e${ordinal}`,
    depositionOrdinal: ordinal, externalContextIds: [`ctx-${ordinal}`], observedChannels: ['goal-residual'] as const, bands: [
      { version: 'MetaInternalConditionBandV1' as const, channel: 'goal-residual' as const,
        bandId: 3, value: .4 },
    ],
  }));
  const episodes = deriveMetaEvidenceEpisodesV1([...observations.slice(0, 2),
    { version: 'MetaEvidenceObservationV1', eventId: 'gap', depositionOrdinal: 2,
      externalContextIds: ['ctx-gap'], observedChannels: ['goal-residual'] as const, bands: [] },
    { ...observations[2]!, depositionOrdinal: 3 }, { ...observations[3]!, depositionOrdinal: 4 }]);
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map(episode => episode.memberEventIds), [['e0', 'e1'], ['e2', 'e3']]);
});

test('meta qualification counts joint contexts, and restore is byte-stable', () => {
  const store = new MetaEvidenceStoreV1();
  let ordinal = 0;
  for (let index = 0; index < 8; index += 1) {
    store.observe(`e${ordinal}`, ordinal++, [channel(.3)], [`ctx-${index % 4}`]);
    store.observe(`gap${ordinal}`, ordinal++, [], [`ctx-${index % 4}`], ['goal-residual']);
  }
  const state = store.snapshot();
  assert.equal(state.episodes.length, 8);
  assert.deepEqual(metaEvidenceQualificationV1(state.episodes).grade, 'meta-predictive-stable');
  assert.deepEqual(MetaEvidenceStoreV1.restore(state).snapshot(), state);
});

test('two joint contexts are not enough for the predictive-stable gate', () => {
  const store = new MetaEvidenceStoreV1();
  for (let index = 0; index < 8; index += 1) {
    store.observe(`e${index * 2}`, index * 2, [channel(.3)], [`ctx-${index % 2}`]);
    store.observe(`gap${index * 2 + 1}`, index * 2 + 1, [], [], ['goal-residual']);
  }
  assert.equal(store.qualification().grade, 'meta-repeated');
  assert.equal(store.qualification().jointContextCount, 2);
});

test('meta episodes do not count an unavailable channel as an observed absence', () => {
  const store = new MetaEvidenceStoreV1();
  store.observe('known', 0, [channel(.3)], ['ctx-a']);
  store.observe('unknown', 1, [], ['ctx-a']);
  store.observe('known-again', 2, [channel(.3)], ['ctx-b']);
  assert.equal(store.snapshot().episodes.length, 1);
  assert.deepEqual(store.snapshot().episodes[0]!.memberEventIds,
    ['known', 'known-again']);
});

test('meta snapshots are isolated and duplicate event ids are rejected', () => {
  const store = new MetaEvidenceStoreV1();
  store.observe('e0', 0, [channel(.3)], ['ctx']);
  const snapshot = store.snapshot();
  (snapshot.observations[0]!.bands as unknown as Array<{ value: number }>)[0]!.value = 0;
  assert.equal(store.snapshot().observations[0]!.bands[0]!.value, .3);
  assert.throws(() => store.observe('e0', 1, [channel(.3)], ['ctx']), /meta-duplicate-event-id/);
});
