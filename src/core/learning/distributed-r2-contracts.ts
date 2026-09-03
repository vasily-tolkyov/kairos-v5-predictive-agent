import type { ActionCue, PublicChange, RealEventContinuityEvidenceV1 } from '../../contracts.js';
import type { DistributedTraceFootprintV1 } from '../physics/distributed-physical-contracts.js';
import type { DistributedEpisodeTopologyV1, DistributedSiteDriveV1 } from './distributed-r1-contracts.js';
import type { SparseInterlayerProjectionStateV1 } from './sparse-interlayer-projection.js';

/** A real public receptor occurrence before it is reduced to an opaque lookup
 * id.  Pulse/channel/receptor ordinals carry sensor timing and wiring order;
 * the signal hash is deliberately absent from the ordering contract. */
export interface DistributedPublicSignalOccurrenceV1 {
  readonly signalId: string;
  readonly pulseOrdinal: number;
  readonly channelOrdinal: number;
  readonly receptorOrdinal: number;
}

export interface DistributedR2AtomV1 {
  readonly version: 'DistributedR2AtomV1';
  readonly atomId: string;
  readonly sourceEventId: string;
  readonly exactExperienceIdentity: string;
  readonly episodePatternSha256: string;
  readonly r1Topology: DistributedEpisodeTopologyV1;
  readonly r1Footprint: DistributedTraceFootprintV1;
  readonly cue: ActionCue;
  readonly contextId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly startFrameSequence: number;
  readonly endFrameSequence: number;
  readonly sessionId: string;
  readonly continuityEpochId: string;
  readonly dependencies: readonly RealEventContinuityEvidenceV1[];
  readonly publicChanges: readonly PublicChange[];
  readonly beforePublicSignals: readonly string[];
  readonly afterPublicSignals: readonly string[];
  readonly beforePublicSignalOccurrences: readonly DistributedPublicSignalOccurrenceV1[];
  readonly afterPublicSignalOccurrences: readonly DistributedPublicSignalOccurrenceV1[];
}

export type DistributedR2BoundaryBeforeV1 = 'continuous' | 'reset' | 'gap' | 'external-takeover';
export type DistributedR2CompleteReasonV1 = 'public-process-resolved' | 'public-dependency-ended' | 'normal-stop';
export type DistributedR2InterruptReasonV1 = 'continuity-reset' | 'continuity-gap' | 'external-takeover'
  | 'session-ended' | 'observation-ended';

export interface DistributedR2ContinuousEventV1 {
  readonly version: 'DistributedR2ContinuousEventV1';
  readonly eventId: string;
  readonly atomIds: readonly string[];
  readonly sourceEventIds: readonly string[];
  /** Live lower-layer dependencies. Metadata alone never preserves support. */
  readonly sourceR1Footprints?: readonly DistributedTraceFootprintV1[];
  readonly orderedExperienceIdentities: readonly string[];
  readonly orderedEpisodePatternIds: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly contextIds: readonly string[];
  readonly completion: 'complete' | 'censored';
  readonly boundaryReason: DistributedR2CompleteReasonV1 | DistributedR2InterruptReasonV1;
  readonly learningEligible: boolean;
  readonly physicalFootprint: DistributedTraceFootprintV1 | null;
  /** Every public change actually observed across the complete ordered
   * process.  Verification is commonly the last R1 atom and can itself be a
   * no-change event; retaining only that atom would erase the result which the
   * verification was checking. */
  readonly processChanges?: readonly PublicChange[];
  /** Changes in the final R1 atom only, retained as an explicit boundary
   * audit rather than used as the complete process outcome. */
  readonly terminalChanges: readonly PublicChange[];
  readonly beforePublicSignals: readonly string[];
  readonly beforeSignalTimeline: readonly (readonly string[])[];
  readonly beforePublicSignalOccurrences: readonly DistributedPublicSignalOccurrenceV1[];
  readonly beforeSignalTimelineOccurrences: readonly (readonly DistributedPublicSignalOccurrenceV1[])[];
  /** Ordered R2 population assemblies; unlike a footprint union this retains order. */
  readonly physicalPulseSiteIds: readonly (readonly number[])[];
  /**
   * The weighted R2 populations that produced the ordered assemblies above.
   * `physicalPulseSiteIds` remains as a compact readout/compatibility view,
   * but it is derived from these drives for newly written events.  Keeping
   * both views makes old audit records readable without silently turning a
   * projected population into unit excitation during R2A reconstruction.
   */
  readonly physicalPulseDrives?: readonly (readonly DistributedSiteDriveV1[])[];
  /** Exact boundaries of each constituent R1 atom in the expanded R2 pulse
   * stream.  Downstream efference input is attached at these real atom
   * boundaries, never broadcast over the complete event. */
  readonly atomPulseRanges: readonly {
    readonly atomId: string;
    readonly startPulseIndex: number;
    readonly endPulseIndexExclusive: number;
  }[];
  readonly patternSha256: string;
}

export interface DistributedR2ContinuityStateV2 {
  readonly version: 'DistributedR2ContinuityStateV2';
  /** Whole-assembly V1 bindings are deliberately not migratable.  Each
   * source R1 site now owns one fixed sparse fibre into the independent R2
   * lattice. */
  readonly projection: SparseInterlayerProjectionStateV1;
  readonly pending: readonly DistributedR2AtomV1[];
  readonly events: readonly DistributedR2ContinuousEventV1[];
  readonly mediumSnapshotSha256: string;
}

export type DistributedR2CloseReceiptV1 =
  | { readonly version: 'DistributedR2CloseReceiptV1'; readonly status: 'none' }
  | { readonly version: 'DistributedR2CloseReceiptV1'; readonly status: 'singleton-rejected';
    readonly atomId: string; readonly completion: 'complete' | 'censored';
    readonly boundaryReason: DistributedR2ContinuousEventV1['boundaryReason'] }
  | { readonly version: 'DistributedR2CloseReceiptV1'; readonly status: 'committed';
    readonly event: DistributedR2ContinuousEventV1 };

export interface DistributedR2IngestReceiptV1 {
  readonly version: 'DistributedR2IngestReceiptV1';
  readonly pendingAtomCount: number;
  readonly closedBefore: DistributedR2CloseReceiptV1 | null;
}
