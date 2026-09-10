import type { ActionCue, Observation, RealEvent } from '../../contracts.js';
import type { EventLocalPublicRoleBindingV1 } from '../../events.js';
import { assert, sha } from '../../util.js';
import type { DistributedMediumSnapshotV1 } from '../physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../physics/distributed-physical-medium.js';
import type {
  DistributedR1AttractorQualificationV1,
  AfferentPublicStateReadoutV1,
  DistributedEpisodeComparisonV1,
  DistributedEpisodeTopologyV1,
  DistributedMediumWritePortV1,
  DistributedR1ExperienceRecordV1,
  DistributedR1ObservationReceiptV1,
  DistributedR1StateV1,
  DistributedNoveltyRecordV1,
  DistributedSiteDriveV1,
  R1DistributedEpisodeV1,
  ReadOnlyAfferentLookupV1,
} from './distributed-r1-contracts.js';
import { SelfOrganizingAfferentProjectionV1 } from './self-organizing-afferent.js';

const DEFAULT_AFFERENT_SEED = 0x534f415246463031n;
const ATTRACTOR_PROBE_COUNT = 16;
const ATTRACTOR_PROBE_STEPS = 180;
const MINIMUM_UNAMBIGUOUS_PROBE_COUNT = 12;

function topology(episode: R1DistributedEpisodeV1): DistributedEpisodeTopologyV1 {
  return { version: 'DistributedEpisodeTopologyV1',
    pulses: episode.pulses.map(pulse => pulse.drives.map(drive => ({ ...drive }))),
    terminalSiteIds: episode.pulses.at(-1)!.drives.map(drive => drive.siteId).sort((a, b) => a - b) };
}

function driveMap(drives: readonly DistributedSiteDriveV1[]): ReadonlyMap<number, number> {
  return new Map(drives.map(drive => [drive.siteId, drive.intensity]));
}

function noNovelty(): DistributedNoveltyRecordV1 {
  return { version: 'DistributedNoveltyRecordV1', source: 'trusted-real-event',
    newlyAllocatedSignalCount: 0, newlyAllocatedSignalIds: [], reusedSignalCount: 0 };
}

function weightedJaccard(left: ReadonlyMap<string | number, number>,
  right: ReadonlyMap<string | number, number>): number {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const a = left.get(key) ?? 0, b = right.get(key) ?? 0;
    intersection += Math.min(a, b); union += Math.max(a, b);
  }
  return union === 0 ? 1 : intersection / union;
}

function populationAffinity(coreSiteIds: readonly number[], populationSiteIds: readonly number[]): number {
  if (coreSiteIds.length === 0 || populationSiteIds.length === 0) return 0;
  const population = new Set(populationSiteIds);
  const intersection = coreSiteIds.filter(siteId => population.has(siteId)).length;
  // A subset is not the same physical population as its superset.  The two
  // directional coverages are intentionally both required so a compact core
  // cannot give every enclosing terminal population an affinity of one.
  return Math.min(intersection / coreSiteIds.length, intersection / populationSiteIds.length);
}

function restSnapshot(snapshot: DistributedMediumSnapshotV1): DistributedMediumSnapshotV1 {
  return structuredClone({ ...snapshot,
    sites: snapshot.sites.map(site => ({ ...site, activation: 0 })) }) as DistributedMediumSnapshotV1;
}

/** Compare physical population use without reducing either episode to Vec3. */
export function compareDistributedEpisodesV1(left: DistributedEpisodeTopologyV1,
  right: DistributedEpisodeTopologyV1): DistributedEpisodeComparisonV1 {
  const ordered = (value: DistributedEpisodeTopologyV1): ReadonlyMap<string, number> =>
    new Map(value.pulses.flatMap((pulse, ordinal) => pulse.map(drive =>
      [`${ordinal}/${drive.siteId}`, drive.intensity] as const)));
  const leftCue = left.pulses[1] ?? [], rightCue = right.pulses[1] ?? [];
  const leftTerminal = left.pulses.at(-1) ?? [], rightTerminal = right.pulses.at(-1) ?? [];
  return { version: 'DistributedEpisodeComparisonV1',
    wholeWeightedJaccard: weightedJaccard(ordered(left), ordered(right)),
    terminalWeightedJaccard: weightedJaccard(driveMap(leftTerminal), driveMap(rightTerminal)),
    sharedActionCuePulse: weightedJaccard(driveMap(leftCue), driveMap(rightCue)) >= 1 - 1e-12 };
}

/**
 * R1 accepts a complete real event, lets the afferent layer allocate physical
 * populations, and performs exactly one weak physical deposit.  It does not
 * infer a stable anchor from this receipt.
 */
export class DistributedR1ExperienceStoreV1 {
  readonly #medium: DistributedMediumWritePortV1;
  readonly #projection: SelfOrganizingAfferentProjectionV1;
  readonly #encodingGainProvider: () => number;
  readonly #records = new Map<string, DistributedR1ExperienceRecordV1>();
  #qualificationCache: ReadonlyMap<string, DistributedR1AttractorQualificationV1> | null = null;
  /**
   * A conservative candidate index for qualification.  Shared action-cue
   * pulses must have the same drive cardinality before their exact weighted
   * comparison can succeed, so this index can only remove impossible pairs;
   * the original comparison remains the final authority.
   */
  #qualificationCandidateIndex: Map<number, DistributedR1ExperienceRecordV1[]> | null = null;
  #episodeComparisonCache = new Map<string, DistributedEpisodeComparisonV1>();

  constructor(medium: DistributedMediumWritePortV1, seed: bigint = DEFAULT_AFFERENT_SEED,
    state?: DistributedR1StateV1, encodingGainProvider: () => number = () => 1) {
    this.#medium = medium;
    this.#encodingGainProvider = encodingGainProvider;
    if (state) {
      assert(state.version === 'DistributedR1StateV1', 'distributed-R1-state-version-mismatch');
      assert(state.mediumSnapshotSha256 === sha(medium.snapshot()),
        'distributed-R1-medium-snapshot-mismatch');
      this.#projection = SelfOrganizingAfferentProjectionV1.restore(state.projection);
      for (const record of state.records) {
        assert(!this.#records.has(record.eventId), 'distributed-R1-duplicate-restored-event');
        this.#records.set(record.eventId, structuredClone(record));
      }
      return;
    }
    this.#projection = new SelfOrganizingAfferentProjectionV1(seed);
  }

  static restore(medium: DistributedMediumWritePortV1, state: DistributedR1StateV1,
    encodingGainProvider: () => number = () => 1):
  DistributedR1ExperienceStoreV1 {
    return new DistributedR1ExperienceStoreV1(medium, BigInt(state.projection.seedHex), state,
      encodingGainProvider);
  }

  observe(event: RealEvent): DistributedR1ObservationReceiptV1 {
    const eventSha256 = sha(event), existing = this.#records.get(event.id);
    if (existing) {
      assert(existing.eventSha256 === eventSha256, 'distributed-R1-event-id-reused-with-different-content');
      return { version: 'DistributedR1ObservationReceiptV1', status: 'already-observed',
        record: structuredClone(existing), novelty: noNovelty() };
    }
    const projection = this.#projection.projectEvent(event, this.#medium);
    assert(projection.episode.eventSha256 === eventSha256, 'distributed-R1-projection-event-mismatch');
    const encodingGain = this.#encodingGainProvider();
    if (!Number.isFinite(encodingGain) || encodingGain < 0.75 || encodingGain > 1.5)
      throw new RangeError('distributed-R1-encoding-gain-out-of-law-bounds');
    const footprint = this.#medium.applyEpisodeWithEncodingGain === undefined
      ? this.#medium.applyEpisode(projection.episode, 1)
      : this.#medium.applyEpisodeWithEncodingGain(projection.episode, 1, encodingGain);
    const record: DistributedR1ExperienceRecordV1 = {
      version: 'DistributedR1ExperienceRecordV1', eventId: event.id, eventSha256,
      contextId: event.frames[0]!.contextId, episodePatternSha256: projection.episode.patternSha256,
      episodeTopology: topology(projection.episode), footprint: structuredClone(footprint),
      anchorStatus: 'weak-footprint',
    };
    this.#records.set(event.id, record);
    this.#qualificationCache = null;
    if (this.#qualificationCandidateIndex !== null) {
      const cuePulseLength = record.episodeTopology.pulses[1]?.length ?? 0;
      const bucket = this.#qualificationCandidateIndex.get(cuePulseLength) ?? [];
      bucket.push(record);
      this.#qualificationCandidateIndex.set(cuePulseLength, bucket);
    }
    return { version: 'DistributedR1ObservationReceiptV1', status: 'deposited',
      record: structuredClone(record), novelty: {
        version: 'DistributedNoveltyRecordV1', source: 'trusted-real-event',
        newlyAllocatedSignalCount: projection.newlyAllocatedSignalCount,
        newlyAllocatedSignalIds: [...projection.newlyAllocatedSignalIds],
        reusedSignalCount: projection.reusedSignalCount,
      } };
  }

  record(eventId: string): DistributedR1ExperienceRecordV1 | null {
    const value = this.#records.get(eventId);
    return value ? structuredClone(value) : null;
  }

  activeRecords(): readonly DistributedR1ExperienceRecordV1[] {
    return [...this.#records.values()].filter(record => this.#medium.isFootprintActive(record.footprint))
      .sort((left, right) => left.eventId.localeCompare(right.eventId, 'en'))
      .map(value => structuredClone(value));
  }

  lookupCurrentObservation(observation: Observation,
    roleBindings: readonly EventLocalPublicRoleBindingV1[], cue?: ActionCue,
    purpose: 'query-origin' | 'observed-terminal' = 'query-origin'): ReadOnlyAfferentLookupV1 {
    return this.#projection.lookupCurrentObservation(observation, roleBindings, cue, purpose);
  }

  lookupDecodedPublicState(...args: Parameters<SelfOrganizingAfferentProjectionV1['lookupDecodedPublicState']>) {
    return this.#projection.lookupDecodedPublicState(...args);
  }

  lookupActionCue(cue: ActionCue): ReadOnlyAfferentLookupV1 {
    return this.#projection.lookupActionCue(cue);
  }

  /** Physical populations deposited by the explicit command pulse, not by a result. */
  prescribedActionSiteIds(): readonly number[] {
    const passiveKind = this.#projection.snapshot().bindings.find(binding =>
      binding.descriptor?.source === 'cue' && binding.descriptor.channel === 'kind'
      && binding.descriptor.categoricalValue === '"passive"')?.siteIds ?? [];
    const records = [...this.#records.values()].filter(record => passiveKind.length === 0
      || !passiveKind.every(site => record.episodeTopology.pulses[1]?.some(d => d.siteId === site)));
    return [...new Set(records.flatMap(record =>
      record.episodeTopology.pulses[1]?.map(drive => drive.siteId) ?? []))].sort((a, b) => a - b);
  }

  publicResultChannelSiteIds(resultSiteIds: readonly number[]): readonly number[] {
    return this.#projection.publicResultChannelSiteIds(resultSiteIds);
  }

  /**
   * Read a simulated terminal population through the same learned afferents
   * that encoded real public state.  This is deliberately a projection-only
   * inverse: neither the event ledger nor a historical result is available to
   * the decoder.
   */
  readPublicState(drives: readonly DistributedSiteDriveV1[]): AfferentPublicStateReadoutV1 {
    return this.#projection.readPublicState(drives);
  }

  /** Recovery changes physical qualification without changing the event ledger. */
  invalidatePhysicalQualification(): void { this.#qualificationCache = null; }

  attractorQualification(eventId: string): DistributedR1AttractorQualificationV1 {
    if (this.#qualificationCache === null) this.#qualificationCache = this.#measureAttractors();
    const value = this.#qualificationCache.get(eventId);
    assert(value, 'distributed-R1-attractor-event-unknown');
    return structuredClone(value);
  }

  stableAttractorEventIds(): readonly string[] {
    if (this.#qualificationCache === null) this.#qualificationCache = this.#measureAttractors();
    return [...this.#qualificationCache.values()]
      .filter(value => value.status === 'stable-attractor')
      .map(value => value.eventId).sort((left, right) => left.localeCompare(right, 'en'));
  }

  #measureAttractors(): ReadonlyMap<string, DistributedR1AttractorQualificationV1> {
    const records = [...this.#records.values()];
    if (this.#qualificationCandidateIndex === null) {
      const index = new Map<number, DistributedR1ExperienceRecordV1[]>();
      for (const record of records) {
        const cuePulseLength = record.episodeTopology.pulses[1]?.length ?? 0;
        const bucket = index.get(cuePulseLength) ?? [];
        bucket.push(record); index.set(cuePulseLength, bucket);
      }
      this.#qualificationCandidateIndex = index;
    }
    const snapshot = this.#medium.snapshot() as DistributedMediumSnapshotV1;
    const probeMedium = DistributedPhysicalMedium3DV1.fromSnapshot(restSnapshot(snapshot),
      this.prescribedActionSiteIds());
    const result = new Map<string, DistributedR1AttractorQualificationV1>();
    const measuredGroups = new Map<string, Omit<DistributedR1AttractorQualificationV1,
      'eventId' | 'supportingEventIds' | 'independentContextCount'>>();

    for (const record of records) {
      const comparisonTo = (other: DistributedR1ExperienceRecordV1): DistributedEpisodeComparisonV1 => {
        const leftId = record.eventId.localeCompare(other.eventId, 'en') <= 0
          ? record.eventId : other.eventId;
        const rightId = leftId === record.eventId ? other.eventId : record.eventId;
        const key = `${leftId}\u0000${rightId}`;
        const cached = this.#episodeComparisonCache.get(key);
        if (cached !== undefined) return cached;
        const measured = compareDistributedEpisodesV1(record.episodeTopology, other.episodeTopology);
        this.#episodeComparisonCache.set(key, measured);
        return measured;
      };
      const candidates = this.#qualificationCandidateIndex.get(
        record.episodeTopology.pulses[1]?.length ?? 0) ?? [];
      const supporting = candidates.filter(other => {
        if (!this.#medium.isFootprintActive(other.footprint)) return false;
        const comparison = comparisonTo(other);
        return comparison.sharedActionCuePulse && comparison.terminalWeightedJaccard >= .8;
      });
      const independentContextCount = new Set(supporting.map(value => value.contextId)).size;
      const targetPopulation = record.episodeTopology.terminalSiteIds;
      const targetAssemblyId = snapshot.coactivationAssemblies?.find(value =>
        value.terminalPulseSiteIds.length === targetPopulation.length
        && value.terminalPulseSiteIds.every((siteId, index) => siteId === targetPopulation[index]))?.assemblyId;
      const competingPopulations = candidates.filter(other => {
        if (!this.#medium.isFootprintActive(other.footprint)) return false;
        const comparison = comparisonTo(other);
        return comparison.sharedActionCuePulse && comparison.terminalWeightedJaccard < .8;
      }).map(other => other.episodeTopology.terminalSiteIds);
      const basinPopulation = record.episodeTopology.pulses.at(-1)!.map(drive => drive.siteId);
      const activePhysicalSupport = supporting.length >= 8;
      // Basin perturbation never injects the event's initial population.
      // Key its exact measured inputs, including competitors/support, rather
      // than re-running an identical experiment for each earlier scene.
      // The substrate, seeds and probe parameters are fixed in this call.
      const groupKey = sha({ targetPopulation, targetAssemblyId, competingPopulations,
        basinPopulation, activePhysicalSupport });
      let measured = measuredGroups.get(groupKey);
      if (measured === undefined) {
        // A repeated same-time population is a physical assembly in its own
        // right.  Terminal populations can be nested when a later public
        // change adds members to an already active population (for example a
        // cue's selected-slot state followed by an additional object state).
        // In that case the smaller population is a shared physical prefix,
        // not a competing result basin.  The probe must still return the
        // exact assembly through the live medium; metadata alone is not
        // enough to waive the separation test.
        // Basin stability is tested by perturbing the candidate attractor
        // itself. Cue-to-result propagation is a separate road property and
        // cannot substitute for return to the terminal basin.
        // Stable qualification already requires eight active supporting
        // footprints.  When that necessary condition is false, running the
        // 16x180 physical probes cannot change the qualification outcome; the
        // probe is therefore an exact mathematical short-circuit, not a
        // cognitive or semantic action policy.
        let targetReturnCount = 0, ambiguousProbeCount = 0;
        let dwellTotal = 0, returnTotal = 0, escapeTotal = 0;
        let maximumCompetingCoreAffinity = 0;
        const returnedCoreCounts = new Map<number, number>();
        for (let probeIndex = 0; activePhysicalSupport
          && probeIndex < ATTRACTOR_PROBE_COUNT; probeIndex += 1) {
          const perturbed = basinPopulation.filter((_siteId, index) =>
            (index + probeIndex) % 8 !== 0);
          const seedSites = perturbed.length > 0 ? perturbed : basinPopulation;
          const readout = probeMedium.probe(seedSites,
            0x5231415454520000n + BigInt(probeIndex + 1), ATTRACTOR_PROBE_STEPS);
          ambiguousProbeCount += Number(readout.ambiguous);
          const targetAffinity = populationAffinity(readout.coreSiteIds, targetPopulation);
          const exactTargetAssembly = targetAssemblyId !== undefined
            && readout.coactivationAssemblyId === targetAssemblyId
            && (readout.coactivationCoverage ?? 0) >= .75
            && (readout.coactivationResonance ?? 0) > 0;
          // Nested populations are separated by the exact measured
          // coactivation assembly.  Only a probe that fails to return that
          // assembly is compared against other terminal populations.
          const competingAffinity = exactTargetAssembly ? 0 : Math.max(0,
            ...competingPopulations.map(population =>
              populationAffinity(readout.coreSiteIds, population)));
          if (!readout.ambiguous && readout.evidenceLevel === 'predictive-stable'
            && targetAffinity >= .5 && targetAffinity >= competingAffinity + .1) {
            targetReturnCount += 1;
            dwellTotal += readout.dwellSteps;
            returnTotal += readout.returnRate;
            escapeTotal += readout.escapeRate;
            maximumCompetingCoreAffinity = Math.max(maximumCompetingCoreAffinity, competingAffinity);
            readout.coreSiteIds.forEach(siteId => returnedCoreCounts.set(siteId,
              (returnedCoreCounts.get(siteId) ?? 0) + 1));
          }
        }
        const divisor = Math.max(1, targetReturnCount);
        const meanDwellSteps = dwellTotal / divisor;
        const meanReturnRate = returnTotal / divisor;
        const meanEscapeRate = targetReturnCount > 0 ? escapeTotal / targetReturnCount : 1;
        const physicalStable = activePhysicalSupport
          && targetReturnCount >= MINIMUM_UNAMBIGUOUS_PROBE_COUNT
          && meanDwellSteps >= 20 && meanReturnRate >= .25 && meanEscapeRate <= .75
          && ambiguousProbeCount <= ATTRACTOR_PROBE_COUNT - MINIMUM_UNAMBIGUOUS_PROBE_COUNT
          && maximumCompetingCoreAffinity <= .20;
        const reasons = [
          ...(activePhysicalSupport ? [] : ['fewer-than-eight-active-physical-footprints']),
          ...(targetReturnCount >= MINIMUM_UNAMBIGUOUS_PROBE_COUNT
            ? [] : ['insufficient-physical-perturbation-returns']),
          ...(meanDwellSteps >= 20 ? [] : ['insufficient-attractor-dwell']),
          ...(meanReturnRate >= .25 ? [] : ['insufficient-attractor-return-rate']),
          ...(meanEscapeRate <= .75 ? [] : ['excessive-attractor-escape-rate']),
          ...(ambiguousProbeCount <= ATTRACTOR_PROBE_COUNT - MINIMUM_UNAMBIGUOUS_PROBE_COUNT
            ? [] : ['excessive-ambiguous-attractor-readouts']),
          ...(maximumCompetingCoreAffinity <= .20 ? [] : ['competing-attractor-not-separated']),
        ];
        const coreSiteIds = [...returnedCoreCounts]
          .filter(([_siteId, count]) => count >= Math.max(1, Math.ceil(targetReturnCount * .5)))
          .map(([siteId]) => siteId).sort((left, right) => left - right);
        const physicalSupportStrength = physicalStable
          ? Math.max(0, Math.min(1, Math.min(targetReturnCount / ATTRACTOR_PROBE_COUNT,
            meanReturnRate, 1 - meanEscapeRate))) : 0;
        measured = { version: 'DistributedR1AttractorQualificationV1',
          status: physicalStable ? 'stable-attractor' : 'weak-footprint',
          activePhysicalSupport, coreSiteIds: coreSiteIds.length > 0 ? coreSiteIds : [...targetPopulation],
          physicalSupportStrength, probeCount: ATTRACTOR_PROBE_COUNT, targetReturnCount,
          meanDwellSteps, meanReturnRate, meanEscapeRate, ambiguousProbeCount,
          maximumCompetingCoreAffinity, reasons };
        measuredGroups.set(groupKey, measured);
      }
      const contextGate = independentContextCount >= 4;
      result.set(record.eventId, { ...measured, eventId: record.eventId,
        status: measured.status === 'stable-attractor' && contextGate
          ? 'stable-attractor' : 'weak-footprint',
        supportingEventIds: supporting.map(value => value.eventId)
          .sort((left, right) => left.localeCompare(right, 'en')),
        independentContextCount,
        reasons: contextGate ? measured.reasons
          : [...measured.reasons, 'fewer-than-four-independent-contexts'] });
    }
    return result;
  }

  projectionSha256(): string {
    return sha(this.#projection.snapshot());
  }

  snapshot(): DistributedR1StateV1 {
    return { version: 'DistributedR1StateV1', projection: this.#projection.snapshot(),
      records: [...this.#records.values()].sort((left, right) =>
        left.eventId.localeCompare(right.eventId, 'en')).map(value => structuredClone(value)),
      mediumSnapshotSha256: sha(this.#medium.snapshot()) };
  }
}
