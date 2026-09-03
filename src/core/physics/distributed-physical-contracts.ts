/** Opaque audit label only; it never selects a physical page or a rule. */
export type DistributedMediumNameV1 = string;

export interface DistributedMediumConfigV1 {
  readonly version: "DistributedMediumConfigV1";
  readonly name: DistributedMediumNameV1;
  readonly seedHex: string;
  readonly tileSize: 32;
  readonly maxTiles: number;
  readonly dt: 0.04;
  readonly diffusion: 0.08;
  readonly temperature: 0.18;
  readonly recoveryRate: 0.002;
  readonly localCoupling: number;
  readonly activationDissipation: number;
  readonly potentialLearningRate: number;
  readonly symmetricLearningRate: number;
  readonly directedLearningRate: number;
  readonly minimumActiveMagnitude: number;
  readonly maximumActivation: number;
  readonly maxPlasticLongRangeOut: 8;
}

export type DistributedMediumConfigInputV1 = Readonly<
  Pick<DistributedMediumConfigV1, "name"> &
  Partial<Omit<DistributedMediumConfigV1, "version" | "name">>
>;

export interface DistributedSiteStateV1 {
  readonly siteId: number;
  readonly coordinate: readonly [number, number, number];
  readonly potentialDepth: number;
  /** Finite nonnegative fast excitation; thermal dynamics may move but never create it. */
  readonly activation: number;
  readonly dissipation: number;
  readonly supportMass: number;
  readonly lastUpdatedAt: number;
}

export interface DistributedBondStateV1 {
  readonly fromSiteId: number;
  readonly toSiteId: number;
  readonly symmetricCoupling: number;
  readonly directedConductance: number;
  readonly supportMass: number;
  readonly lastUpdatedAt: number;
  readonly kind: "local" | "plastic-directed";
}

export interface SparseFieldDriveV1 {
  readonly siteId: number;
  readonly intensity: number;
}

export interface SparseFieldPulseV1 {
  readonly version: "SparseFieldPulseV1";
  readonly pulseId?: string;
  readonly offset: number;
  /** Real observed residence of this unchanged field state. */
  readonly dwellSeconds?: number;
  readonly drives: readonly SparseFieldDriveV1[];
}

/**
 * Read-only probe input accepted by the public sequence APIs.  The numeric
 * form is the original compatibility surface and means unit intensity.  The
 * weighted form carries the afferent population amplitude that was produced
 * by an inter-layer projection.
 *
 * Weighted populations may contain the same site more than once when several
 * upstream fibres converge.  The probe normalizer merges such entries with a
 * deterministic **maximum** (rather than a sum) so a duplicate wire cannot
 * manufacture extra excitation or exceed the physical 0..1 drive contract.
 */
export type DistributedProbePulseInputV1 =
  | readonly number[]
  | readonly SparseFieldDriveV1[];

export interface DistributedEpisodeV1 {
  readonly version: "DistributedEpisodeV1";
  readonly traceId: string;
  readonly provenance: "trusted-real-event";
  readonly pulses: readonly SparseFieldPulseV1[];
  /**
   * A physical eligibility trace carried across a real episode.  It permits a
   * still-eligible earlier population to form a sparse long-range fibre to a
   * later population without inventing an intermediate observation.  The
   * medium learns the specified endpoints; it never receives a result label.
   */
  readonly temporalEligibility?: readonly {
    readonly fromPulseIndex: number;
    readonly toPulseIndex: number;
    readonly strength: number;
  }[];
}

export interface DistributedBondReferenceV1 {
  readonly fromSiteId: number;
  readonly toSiteId: number;
  readonly kind: "local" | "plastic-directed";
}

export interface DistributedTraceFootprintV1 {
  readonly version: "DistributedTraceFootprintV1";
  readonly traceId: string;
  /** Compatibility alias for the R1 write port; equal to traceId. */
  readonly footprintId: string;
  readonly depositedAt: number;
  readonly siteIds: readonly number[];
  /** Ordered physical populations actually driven by the real episode.  This
   * is an audit of field participation, not a centre-line or a coordinate
   * projection.  In particular, the final population lets liveness be tested
   * without letting a still-active shared cue prefix impersonate a surviving
   * result attractor. */
  readonly pulseSiteIds?: readonly (readonly number[])[];
  readonly bondReferences: readonly DistributedBondReferenceV1[];
  /** Stable opaque ids for learned directed channels in this footprint. */
  readonly directedBondIds: readonly string[];
  readonly pulseCount: number;
  readonly supportMass: number;
}

/**
 * A physical record of a repeatedly co-active terminal population.
 *
 * This is deliberately an index over real distributed footprints, not a new
 * semantic rule or a non-local bond.  The member ids are only provenance;
 * the population itself is still read through the medium's local field.  A
 * query may use this record to disambiguate several local basins only when
 * the same terminal pulse was observed in at least two trusted episodes and
 * the member footprints are still physically active.
 */
export interface DistributedCoactivationAssemblyEvidenceV1 {
  readonly version: "DistributedCoactivationAssemblyEvidenceV1";
  /** Opaque deterministic identity of the terminal site population. */
  readonly assemblyId: string;
  /** Sites driven by one and the same terminal pulse, sorted and unique. */
  readonly terminalPulseSiteIds: readonly number[];
  /** Distinct trusted footprint/episode identities supplying this population. */
  readonly memberTraceIds: readonly string[];
  readonly independentEpisodeCount: number;
  readonly supportMass: number;
  readonly lastUpdatedAt: number;
}

export interface DistributedFieldRunV1 {
  readonly version: "DistributedFieldRunV1";
  /** Physical field ticks; accepted/rejected count local pair microproposals. */
  readonly steps: number;
  readonly acceptedSteps: number;
  readonly rejectedSteps: number;
  /**
   * Excitation mass that actually crossed learned directed channels during
   * this rollout.  This is a measured dynamical quantity, not a count of
   * bonds present in the snapshot; a branch reached only by local diffusion
   * has zero directed transport evidence.
   */
  readonly directedTransportMass?: number;
  readonly leaderSiteIds: readonly number[];
  readonly finalActivations: readonly {
    readonly siteId: number;
    readonly activation: number;
  }[];
}

export type DistributedEvidenceLevelV1 =
  | "none"
  | "single-observation"
  | "repeated-correlation"
  | "predictive-stable"
  | "causal-hypothesis"
  | "intervention-supported";

export interface DistributedAttractorReadoutV1 {
  readonly version: "DistributedAttractorReadoutV1";
  readonly coreSiteIds: readonly number[];
  readonly dwellSteps: number;
  readonly returnRate: number;
  readonly escapeRate: number;
  readonly evidenceLevel: DistributedEvidenceLevelV1;
  readonly ambiguous: boolean;
  /** Mean activation during the measured terminal half-window.  This is the
   * actual transient field reached by the rollout, not a historical template. */
  readonly terminalActivations?: readonly {
    readonly siteId: number;
    readonly meanActivation: number;
  }[];
  /** Present only when a repeated same-time terminal population covers the
   * selected basins.  It is an audit reference, never a semantic result id. */
  readonly coactivationAssemblyId?: string;
  /** Fraction of the queried terminal population covered by that assembly. */
  readonly coactivationCoverage?: number;
  /** Measured fraction of the terminal observation window in which all
   * queried members were simultaneously active. */
  readonly coactivationResonance?: number;
  readonly run: DistributedFieldRunV1;
}

/** Anonymous physical mask used only to measure an already-running field. */
export interface DistributedAssemblyProbeSpecV1 {
  readonly candidateSiteIds: readonly number[];
  /** Complete local physical domain against which leakage/purity is measured. */
  readonly enclosingDomainSiteIds: readonly number[];
  /** Sites deliberately removed from a qualification seed. */
  readonly omittedSiteIds?: readonly number[];
}

export interface DistributedAssemblyResidenceReadoutV1 {
  readonly version: "DistributedAssemblyResidenceReadoutV1";
  readonly candidateSiteIds: readonly number[];
  readonly enclosingDomainSiteIds: readonly number[];
  readonly actuallyReachedSiteIds: readonly number[];
  /** Mean activation measured on the candidate sites during the late
   * readout window.  This is a passive observation of the rollout; candidate
   * sites are never injected merely because they are named here. */
  readonly terminalActivations?: readonly {
    readonly siteId: number;
    readonly meanActivation: number;
  }[];
  readonly lateCoverage: number;
  readonly latePurity: number;
  readonly omittedSiteRestorationRate: number;
  readonly dwellSteps: number;
  readonly returnRate: number;
  readonly escapeRate: number;
  readonly evidenceLevel: DistributedEvidenceLevelV1;
  readonly stable: boolean;
}

export interface DistributedAssemblyCompetitionReadoutV1 {
  readonly version: "DistributedAssemblyCompetitionReadoutV1";
  readonly attractorReadout: DistributedAttractorReadoutV1;
  readonly assemblies: readonly DistributedAssemblyResidenceReadoutV1[];
}

export interface DistributedTileSnapshotV1 {
  readonly tileIndex: number;
  readonly tileCoordinate: readonly [number, number, number];
  readonly firstSiteId: number;
  readonly siteCount: number;
}

export interface DistributedBindingSnapshotV1 {
  readonly bindingId: string;
  readonly siteIds: readonly number[];
}

export interface DistributedMediumSnapshotV1 {
  readonly version: "DistributedMediumSnapshotV1";
  readonly config: DistributedMediumConfigV1;
  readonly logicalTime: number;
  readonly tiles: readonly DistributedTileSnapshotV1[];
  readonly sites: readonly DistributedSiteStateV1[];
  /** Plastic local enhancements plus plastic directed channels. */
  readonly learnedBonds: readonly DistributedBondStateV1[];
  readonly localBondCount: number;
  readonly bindings: readonly DistributedBindingSnapshotV1[];
  readonly footprints: readonly DistributedTraceFootprintV1[];
  /** Derived coactivation index.  Omitted by old snapshots and rebuilt from
   * footprints on restore; it is never required for physical replay. */
  readonly coactivationAssemblies?: readonly DistributedCoactivationAssemblyEvidenceV1[];
  readonly allocationSequence: number;
  readonly metropolisSequence: number;
}

export interface DistributedSiteSelectionStateV1 extends DistributedSiteStateV1 {
  readonly boundNeighborCount: number;
}
