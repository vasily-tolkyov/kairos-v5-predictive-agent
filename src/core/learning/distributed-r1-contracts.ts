import type { PublicValue, RealEvent } from '../../contracts.js';
import type { DistributedTraceFootprintV1 } from '../physics/distributed-physical-contracts.js';

/**
 * Afferent identities are opaque lookup keys.  They identify an already
 * formed input binding; they never select a coordinate in the medium.
 */
export interface AfferentSignalDescriptorV1 {
  readonly source: 'cue' | 'public-state';
  readonly channel: string;
  /** Raw public property name; null for action-cue afferents. */
  readonly publicProperty: string | null;
  readonly populationBin: number | null;
  /** Canonical PublicValue text; null for continuous population bins. */
  readonly categoricalValue: string | null;
}

export interface AfferentBindingStateV1 {
  readonly signalId: string;
  readonly siteIds: readonly number[];
  readonly observationCount: number;
  /**
   * Optional for byte-compatible restoration of historical V1 states. A
   * legacy binding without a descriptor remains usable as a learned input,
   * but cannot be decoded into public state.
   */
  readonly descriptor?: AfferentSignalDescriptorV1;
}

export interface SelfOrganizingAfferentStateV1 {
  readonly version: 'SelfOrganizingAfferentStateV1';
  readonly seedHex: string;
  readonly allocationSequence: number;
  readonly bindings: readonly AfferentBindingStateV1[];
  /**
   * Event-local public channels which a prior trusted event actually changed.
   * They may close a later direct-target no-effect window with its observed
   * terminal value.  This is not a semantic outcome list and never allocates a
   * coordinate by itself.
   */
  readonly terminalOutcomeChannels?: readonly string[];
}

export interface AfferentPopulationBinReadoutV1 {
  readonly bin: number;
  readonly overlap: number;
  readonly activationMass: number;
}

export interface AfferentContinuousReadoutV1 {
  readonly resolution: number;
  readonly estimate: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  /** Complete physical population evidence used by the estimate. */
  readonly populationBins: readonly AfferentPopulationBinReadoutV1[];
}

export interface AfferentPublicChannelReadoutV1 {
  readonly channel: string;
  readonly property: string;
  readonly status: 'decoded' | 'unknown' | 'ambiguous';
  readonly encoding: 'categorical' | 'continuous' | 'unknown';
  readonly overlap: number;
  readonly competingOverlap: number;
  readonly reason:
    | 'decoded-categorical'
    | 'decoded-continuous'
    | 'insufficient-physical-overlap'
    | 'ambiguous-physical-overlap'
    | 'legacy-descriptor-unavailable';
  readonly value?: PublicValue;
  readonly continuous?: AfferentContinuousReadoutV1;
}

export interface AfferentPublicStateReadoutV1 {
  readonly version: 'AfferentPublicStateReadoutV1';
  readonly status: 'decoded' | 'partial' | 'unknown' | 'ambiguous';
  readonly channels: readonly AfferentPublicChannelReadoutV1[];
  readonly unmatchedSiteIds: readonly number[];
  readonly legacyDescriptorUnavailable: boolean;
}

export interface DistributedSiteDriveV1 {
  readonly siteId: number;
  readonly intensity: number;
}

/** One public event phase, represented by a sparse population drive. */
export interface R1SparseFieldPulseV1 {
  readonly version: 'R1SparseFieldPulseV1';
  readonly ordinal: number;
  /** Real observed dwell represented by this state run; not a change count. */
  readonly dwellSeconds: number;
  readonly drives: readonly DistributedSiteDriveV1[];
}

/**
 * One closed real event in the R1 substrate.  Pulses contain no world
 * coordinate, object instance id, expected result, or semantic coordinate.
 */
export interface R1DistributedEpisodeV1 {
  readonly version: 'R1DistributedEpisodeV1';
  readonly eventId: string;
  readonly eventSha256: string;
  readonly pulses: readonly R1SparseFieldPulseV1[];
  readonly patternSha256: string;
  readonly sourceFrameCount: number;
  readonly retainedTransitionWaveCount: number;
}

export interface DistributedEpisodeTopologyV1 {
  readonly version: 'DistributedEpisodeTopologyV1';
  readonly pulses: readonly (readonly DistributedSiteDriveV1[])[];
  readonly terminalSiteIds: readonly number[];
}

export interface DistributedEpisodeComparisonV1 {
  readonly version: 'DistributedEpisodeComparisonV1';
  readonly wholeWeightedJaccard: number;
  readonly terminalWeightedJaccard: number;
  /** Exact physically encoded body cue, after the real pre-action state. */
  readonly sharedActionCuePulse: boolean;
}

/** R1 retains the complete physical footprint; no bond/time evidence is narrowed away. */
export type R1DistributedTraceFootprintV1 = DistributedTraceFootprintV1;

/**
 * Narrow port over the shared distributed physical medium.  Candidate
 * competition and binding belong to the physical substrate, not this
 * projection module.
 */
export interface DistributedMediumWritePortV1 {
  allocateSites(count: number, random: () => number): readonly number[];
  allocateSitesNear(anchorSiteIds: readonly number[], count: number,
    random: () => number): readonly number[];
  competeForSites(candidateSiteIds: readonly number[], winnerCount: number,
    random: () => number): readonly number[];
  bindSites(bindingId: string, siteIds: readonly number[]): void;
  applyEpisode(episode: R1DistributedEpisodeV1, strength: number): R1DistributedTraceFootprintV1;
  isFootprintActive(footprint: R1DistributedTraceFootprintV1): boolean;
  snapshot(): unknown;
}

export interface SelfOrganizingProjectionResultV1 {
  readonly version: 'SelfOrganizingProjectionResultV1';
  readonly episode: R1DistributedEpisodeV1;
  readonly newlyAllocatedSignalCount: number;
  /** Opaque afferent identities allocated by this trusted real observation. */
  readonly newlyAllocatedSignalIds: readonly string[];
  readonly reusedSignalCount: number;
}

/**
 * First-seen input allocation is a normal learning signal, not a
 * representation rejection.  The record is deliberately limited to opaque
 * afferent identities and counts; it carries no semantic result or coordinate.
 */
export interface DistributedNoveltyRecordV1 {
  readonly version: 'DistributedNoveltyRecordV1';
  readonly source: 'trusted-real-event';
  readonly newlyAllocatedSignalCount: number;
  readonly newlyAllocatedSignalIds: readonly string[];
  readonly reusedSignalCount: number;
}

/**
 * Read-only lookup of a population which has already been learned by the
 * afferent projection.  Missing signals are reported rather than allocated:
 * prediction is not a training path.
 */
export interface ReadOnlyAfferentLookupV1 {
  readonly version: 'ReadOnlyAfferentLookupV1';
  readonly siteIds: readonly number[];
  /**
   * The physical amplitudes of the resolved population, when the lookup
   * contains a non-unit (for example overlapping continuous) sensor drive.
   * The id list remains the compatibility/audit view; callers that need to
   * seed a distributed rollout should forward this field when present rather
   * than reconstructing every population at unit intensity.
   */
  readonly drives?: readonly DistributedSiteDriveV1[];
  readonly unresolvedSignalCount: number;
  readonly unresolvedRoles: readonly string[];
}

export interface DistributedR1ExperienceRecordV1 {
  readonly version: 'DistributedR1ExperienceRecordV1';
  readonly eventId: string;
  readonly eventSha256: string;
  readonly contextId: string;
  readonly episodePatternSha256: string;
  readonly episodeTopology: DistributedEpisodeTopologyV1;
  readonly footprint: R1DistributedTraceFootprintV1;
  /** One event is evidence, never a stable physical anchor by itself. */
  readonly anchorStatus: 'weak-footprint';
}

export interface DistributedR1StateV1 {
  readonly version: 'DistributedR1StateV1';
  readonly projection: SelfOrganizingAfferentStateV1;
  readonly records: readonly DistributedR1ExperienceRecordV1[];
  readonly mediumSnapshotSha256: string;
}

export interface DistributedR1ObservationReceiptV1 {
  readonly version: 'DistributedR1ObservationReceiptV1';
  readonly status: 'deposited' | 'already-observed';
  readonly record: DistributedR1ExperienceRecordV1;
  readonly novelty: DistributedNoveltyRecordV1;
}

export interface DistributedR1EventSourceV1 {
  readonly event: RealEvent;
}

/**
 * A stable R1 anchor is a measured attractor property.  Event and context
 * counts are evidence gates; they cannot make a population stable when the
 * physical perturbation trials do not return to its basin.
 */
export interface DistributedR1AttractorQualificationV1 {
  readonly version: 'DistributedR1AttractorQualificationV1';
  readonly eventId: string;
  readonly status: 'stable-attractor' | 'weak-footprint';
  readonly supportingEventIds: readonly string[];
  readonly independentContextCount: number;
  readonly activePhysicalSupport: boolean;
  /** Stable physical basin core measured by perturbation, not an event label. */
  readonly coreSiteIds: readonly number[];
  /** Normalized weakest measured basin support for control-field coupling. */
  readonly physicalSupportStrength: number;
  readonly probeCount: number;
  readonly targetReturnCount: number;
  readonly meanDwellSteps: number;
  readonly meanReturnRate: number;
  readonly meanEscapeRate: number;
  readonly ambiguousProbeCount: number;
  readonly maximumCompetingCoreAffinity: number;
  readonly reasons: readonly string[];
}
