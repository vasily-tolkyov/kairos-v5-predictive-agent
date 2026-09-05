import type { VerifiedInternalChannelV1 } from '../contracts.js';
import { assert, canonical, sha } from '../util.js';

/**
 * L2 meta evidence is deliberately a separate index.  It records when a
 * runtime-owned internal channel was present; it never changes world R2A
 * relations, evidence grades, or controller drives.
 */
export interface MetaInternalConditionBandV1 {
  readonly version: 'MetaInternalConditionBandV1';
  readonly channel: VerifiedInternalChannelV1['name'];
  readonly bandId: number;
  readonly value: number;
}

export interface MetaEvidenceObservationV1 {
  readonly version: 'MetaEvidenceObservationV1';
  readonly eventId: string;
  readonly depositionOrdinal: number;
  readonly externalContextIds: readonly string[];
  readonly bands: readonly MetaInternalConditionBandV1[];
}

export interface MetaEvidenceEpisodeV1 {
  readonly version: 'MetaEvidenceEpisodeV1';
  readonly episodeId: string;
  readonly conditionKey: string;
  readonly channel: VerifiedInternalChannelV1['name'];
  readonly bandId: number;
  readonly startOrdinal: number;
  readonly endOrdinal: number;
  readonly memberEventIds: readonly string[];
  readonly externalContextIds: readonly string[];
  readonly jointContextIds: readonly string[];
}

export interface MetaEvidenceQualificationV1 {
  readonly version: 'MetaEvidenceQualificationV1';
  readonly episodeCount: number;
  readonly jointContextCount: number;
  readonly grade: 'meta-repeated' | 'meta-predictive-stable' | 'insufficient';
}

export interface MetaEvidenceStateV1 {
  readonly version: 'MetaEvidenceStateV1';
  readonly observations: readonly MetaEvidenceObservationV1[];
  readonly episodes: readonly MetaEvidenceEpisodeV1[];
}

const META_CHANNELS = new Set<VerifiedInternalChannelV1['name']>([
  'branch-entropy', 'prediction-support', 'applicable-relations', 'surprise-rate',
  'goal-residual', 'action-budget-remaining',
]);

function bandFor(value: number): number {
  assert(Number.isFinite(value) && value >= 0 && value <= 1, 'meta-channel-value-out-of-range');
  return Math.min(7, Math.floor(value * 8));
}

export function quantizeMetaInternalChannelsV1(
  channels: readonly VerifiedInternalChannelV1[]): readonly MetaInternalConditionBandV1[] {
  const seen = new Set<string>();
  return channels.slice().sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .map(channel => {
      assert(channel.version === 'VerifiedInternalChannelV1'
        && META_CHANNELS.has(channel.name)
        && channel.provenance === 'verified-internal'
        && channel.availableBeforeOutcome === true,
      'invalid-meta-channel-provenance');
      assert(!seen.has(channel.name), 'duplicate-meta-channel');
      seen.add(channel.name);
      return { version: 'MetaInternalConditionBandV1', channel: channel.name,
        bandId: bandFor(channel.value), value: channel.value };
    });
}

function conditionKey(channel: VerifiedInternalChannelV1['name'], bandId: number): string {
  return `${channel}:${bandId}`;
}

function jointContextIds(externalContextIds: readonly string[], key: string): readonly string[] {
  return [...new Set(externalContextIds)].sort((left, right) => left.localeCompare(right, 'en'))
    .map(contextId => `${contextId}×${key}`);
}

/** Derive maximal presence runs without using wall-clock or event-id order. */
export function deriveMetaEvidenceEpisodesV1(
  observations: readonly MetaEvidenceObservationV1[]): readonly MetaEvidenceEpisodeV1[] {
  const ordered = observations.slice().sort((left, right) => left.depositionOrdinal - right.depositionOrdinal);
  const seenOrdinals = new Set<number>();
  const open = new Map<string, {
    channel: VerifiedInternalChannelV1['name']; bandId: number; startOrdinal: number;
    endOrdinal: number; memberEventIds: string[]; externalContextIds: Set<string>;
  }>();
  const episodes: MetaEvidenceEpisodeV1[] = [];
  let previousOrdinal: number | null = null;
  const close = (key: string): void => {
    const current = open.get(key); if (!current) return;
    const contexts = [...current.externalContextIds].sort((left, right) => left.localeCompare(right, 'en'));
    const joint = jointContextIds(contexts, key);
    const identity = { key, startOrdinal: current.startOrdinal, endOrdinal: current.endOrdinal,
      memberEventIds: current.memberEventIds, externalContextIds: contexts };
    episodes.push({ version: 'MetaEvidenceEpisodeV1', episodeId: sha(identity), conditionKey: key,
      channel: current.channel, bandId: current.bandId, startOrdinal: current.startOrdinal,
      endOrdinal: current.endOrdinal, memberEventIds: [...current.memberEventIds],
      externalContextIds: contexts, jointContextIds: joint });
    open.delete(key);
  };
  for (const observation of ordered) {
    assert(Number.isSafeInteger(observation.depositionOrdinal) && observation.depositionOrdinal >= 0,
      'meta-invalid-deposition-ordinal');
    assert(!seenOrdinals.has(observation.depositionOrdinal), 'meta-duplicate-deposition-ordinal');
    if (previousOrdinal !== null && observation.depositionOrdinal > previousOrdinal + 1)
      for (const key of [...open.keys()]) close(key);
    previousOrdinal = observation.depositionOrdinal;
    seenOrdinals.add(observation.depositionOrdinal);
    const present = new Set(observation.bands.map(band => conditionKey(band.channel, band.bandId)));
    for (const key of [...open.keys()]) if (!present.has(key)) close(key);
    for (const band of observation.bands) {
      const key = conditionKey(band.channel, band.bandId);
      assert(META_CHANNELS.has(band.channel) && Number.isInteger(band.bandId)
        && band.bandId >= 0 && band.bandId <= 7 && Number.isFinite(band.value)
        && band.value >= 0 && band.value <= 1, 'invalid-meta-condition-band');
      const current = open.get(key);
      if (current) {
        current.endOrdinal = observation.depositionOrdinal;
        current.memberEventIds.push(observation.eventId);
        for (const contextId of observation.externalContextIds) current.externalContextIds.add(contextId);
      } else {
        open.set(key, { channel: band.channel, bandId: band.bandId,
          startOrdinal: observation.depositionOrdinal, endOrdinal: observation.depositionOrdinal,
          memberEventIds: [observation.eventId], externalContextIds: new Set(observation.externalContextIds) });
      }
    }
  }
  for (const key of [...open.keys()]) close(key);
  return episodes.sort((left, right) => left.startOrdinal - right.startOrdinal
    || left.conditionKey.localeCompare(right.conditionKey, 'en'));
}

export function metaEvidenceQualificationV1(
  episodes: readonly MetaEvidenceEpisodeV1[]): MetaEvidenceQualificationV1 {
  const joint = new Set(episodes.flatMap(episode => episode.jointContextIds));
  const episodeCount = episodes.length, jointContextCount = joint.size;
  return { version: 'MetaEvidenceQualificationV1', episodeCount, jointContextCount,
    grade: episodeCount >= 8 && jointContextCount >= 4 ? 'meta-predictive-stable'
      : episodeCount >= 2 ? 'meta-repeated' : 'insufficient' };
}

export class MetaEvidenceStoreV1 {
  readonly #observations: MetaEvidenceObservationV1[] = [];

  observe(eventId: string, depositionOrdinal: number,
    channels: readonly VerifiedInternalChannelV1[], externalContextIds: readonly string[]): void {
    assert(eventId.length > 0, 'meta-event-id-empty');
    assert(Number.isSafeInteger(depositionOrdinal) && depositionOrdinal >= 0,
      'meta-invalid-deposition-ordinal');
    assert(!this.#observations.some(value => value.depositionOrdinal === depositionOrdinal),
      'meta-duplicate-deposition-ordinal');
    this.#observations.push({ version: 'MetaEvidenceObservationV1', eventId, depositionOrdinal,
      externalContextIds: [...new Set(externalContextIds)].sort((left, right) => left.localeCompare(right, 'en')),
      bands: quantizeMetaInternalChannelsV1(channels) });
  }

  snapshot(): MetaEvidenceStateV1 {
    const observations = this.#observations.slice().sort((left, right) =>
      left.depositionOrdinal - right.depositionOrdinal);
    return { version: 'MetaEvidenceStateV1', observations,
      episodes: deriveMetaEvidenceEpisodesV1(observations) };
  }

  qualification(): MetaEvidenceQualificationV1 {
    return metaEvidenceQualificationV1(this.snapshot().episodes);
  }

  static restore(state: MetaEvidenceStateV1): MetaEvidenceStoreV1 {
    assert(state.version === 'MetaEvidenceStateV1', 'meta-state-version-mismatch');
    const store = new MetaEvidenceStoreV1();
    for (const observation of state.observations) {
      assert(observation.version === 'MetaEvidenceObservationV1', 'meta-observation-version-mismatch');
      assert(canonical(observation) === canonical({ ...observation,
        bands: quantizeMetaInternalChannelsV1(observation.bands.map(band => ({
          version: 'VerifiedInternalChannelV1', name: band.channel, value: band.value,
          provenance: 'verified-internal', availableBeforeOutcome: true as const })) ) }),
      'meta-observation-not-canonical');
      store.#observations.push(structuredClone(observation));
    }
    const derived = deriveMetaEvidenceEpisodesV1(store.#observations);
    assert(canonical(derived) === canonical(state.episodes), 'meta-episode-state-mismatch');
    return store;
  }
}
