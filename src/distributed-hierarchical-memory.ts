import type { ActionCue, DesiredChange, Observation, PublicChange, RealEvent }
  from './contracts.js';
import type { DistributedPredictionV3 }
  from './core/prediction/distributed-reasoning-contracts.js';
import type { BranchPredictionV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1, GroundedGoalV1, GoalEvaluationV1,
  HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1, ProjectedParentRelationApplicabilityV1 }
  from './control/contracts.js';
import { desiredChangesForGoal } from './control/goal.js';
import { cueIdentity, eventLocalCurrentPublicStateV1, eventLocalDecodedPublicFeaturesV1,
  eventRows, relativePublicFeatures, validateEvent,
  type EventLocalCurrentPublicValueV1, type EventLocalPublicRoleBindingV1 } from './events.js';
import { assert, canonical, sha } from './util.js';
import { DistributedR1ExperienceStoreV1 }
  from './core/learning/distributed-r1.js';
import type { AfferentPublicStateReadoutV1, DistributedR1ExperienceRecordV1, DistributedR1StateV1,
  DistributedNoveltyRecordV1, DistributedSiteDriveV1 }
  from './core/learning/distributed-r1-contracts.js';
import { DistributedR2ContinuityStoreV1, distributedPublicSignalIdsV1,
  distributedPublicSignalOccurrencesV1 }
  from './core/learning/distributed-r2.js';
import type { DistributedR2AtomV1, DistributedR2BoundaryBeforeV1,
  DistributedR2CloseReceiptV1, DistributedR2ContinuityStateV2,
  DistributedR2ContinuousEventV1, DistributedPublicSignalOccurrenceV1 }
  from './core/learning/distributed-r2-contracts.js';
import { DistributedR2APhysicalPatternLearnerV2 }
  from './core/learning/distributed-r2a.js';
import type { DistributedR2AInterventionAssessmentV2, DistributedR2AInterventionPairV2,
  DistributedR2APhysicalApplicabilityV2, DistributedR2APhysicalPatternV2,
  DistributedR2APhysicalRelationV2, DistributedR2APhysicalStateV3 }
  from './core/learning/distributed-r2a-physical-contracts.js';
import type { DistributedR2AConsolidationBatchReceiptV1,
  DistributedR2AConsolidationBatchStatusV1,
  DistributedR2AConsolidationPerformanceAuditV1 }
  from './core/learning/distributed-r2a-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from './core/physics/distributed-physical-medium.js';
import { DistributedHierarchicalTimescaleOwnerV1 }
  from './core/physics/distributed-hierarchical-timescale-owner-v1.js';
import type { DistributedHierarchicalTimescaleSnapshotV1 }
  from './core/physics/distributed-hierarchical-timescale-owner-v1.js';
import type { RuntimeMeasuredSalienceV2 }
  from './core/physics/distributed-medium-timescale-protocol-v2.js';
import type { DistributedMediumSnapshotV1, DistributedTraceFootprintV1 }
  from './core/physics/distributed-physical-contracts.js';
import { DistributedPredictionCloneV2 }
  from './core/prediction/distributed-prediction-clone.js';
import { runDistributedPredictionCloneBatchParallelV1 }
  from './core/prediction/distributed-prediction-clone-parallel.js';
import { RuntimeMeasuredSalienceBridgeV1, type TrustedRuntimeMeasurementContextV1 }
  from './core/physics/runtime-measured-salience-bridge-v1.js';
import { runDistributedMediumProbeBatchSyncV1, type DistributedMediumProbeJobV1 }
  from './core/physics/distributed-medium-probe-parallel.js';
import type { DistributedPredictionCloneRequestV2, DistributedPredictionCloneResultV2 }
  from './core/prediction/distributed-prediction-clone.js';
import { distributedEvidenceReferenceV1, distributedPredictionSampleV1,
  emptyDistributedPredictionV1 } from './core/prediction/distributed-reasoning-adapter.js';
import { KAIROS_V5_MEMORY_SEMANTICS, KAIROS_V5_MEMORY_VERSION } from './core/compatibility.js';
import { MetaEvidenceStoreV1 } from './control/meta-evidence.js';
import type { MetaEvidenceStateV1 } from './control/meta-evidence.js';

export const DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 =
  KAIROS_V5_MEMORY_VERSION;
export const DISTRIBUTED_HIERARCHY_SEMANTICS_V2 =
  KAIROS_V5_MEMORY_SEMANTICS;

type EvidenceGrade = NonNullable<PhysicalEvidenceReferenceV1['r2a']['evidenceGrade']>;

export interface DistributedR1AnnotationV1 {
  readonly version: 'DistributedR1AnnotationV1';
  readonly eventId: string;
  readonly cue: ActionCue;
  readonly completion: 'complete' | 'censored';
  readonly contextId: string;
  readonly observedBefore: Readonly<Record<string, number>>;
  readonly observedAfter: Readonly<Record<string, number>>;
  readonly beforeSignalIds: readonly string[];
  readonly afterSignalIds: readonly string[];
  readonly beforeSignalOccurrences: readonly DistributedPublicSignalOccurrenceV1[];
  readonly afterSignalOccurrences: readonly DistributedPublicSignalOccurrenceV1[];
  readonly changeWaves: readonly (readonly PublicChange[])[];
  readonly publicRoleBindings: readonly EventLocalPublicRoleBindingV1[];
  readonly r1Record: DistributedR1ExperienceRecordV1;
  readonly r2EventIds: readonly string[];
}

export interface KairosV5DistributedPhysicalMemoryV3 {
  readonly version: typeof DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3;
  readonly hierarchy: typeof DISTRIBUTED_HIERARCHY_SEMANTICS_V2;
  readonly activeSeconds: number;
  readonly r1Medium: DistributedMediumSnapshotV1;
  readonly r1: DistributedR1StateV1;
  readonly r2Medium: DistributedMediumSnapshotV1;
  readonly r2: DistributedR2ContinuityStateV2;
  readonly r2a: DistributedR2APhysicalStateV3;
  readonly annotations: readonly DistributedR1AnnotationV1[];
  readonly processedR2EventIds: readonly string[];
  readonly seenEventIds: readonly string[];
  readonly writes: number;
  /**
   * Isolated DESIGN-001 meta evidence.  This is an audit index only: it is
   * not consumed by world R2A grading or by action selection.
   */
  readonly metaEvidence?: MetaEvidenceStateV1;
}

/** Additive opt-in checkpoint carrying the aligned three-layer time owners. */
export interface KairosV5DistributedPhysicalMemoryV4
  extends Omit<KairosV5DistributedPhysicalMemoryV3, 'version'> {
  readonly version: 'KairosV5DistributedPhysicalMemoryV4';
  readonly timescales: DistributedHierarchicalTimescaleSnapshotV1;
}

export interface DistributedMemoryObservationReceiptV1 {
  readonly status: 'initialization-buffer' | 'real-event-deposited';
  readonly writes: number;
  readonly buffered: number;
  readonly mapSha256: string | null;
  readonly r1Atoms: number;
  readonly r2ContinuousEvents: number;
  readonly r2aStablePatterns: number;
  /** New afferent identities allocated by this trusted real observation. */
  readonly novelty: DistributedNoveltyRecordV1;
}

/** Explicit, read-only seed batch used by measured performance tooling. */
export interface DistributedPredictionSeedBatchRequestV1 {
  readonly medium: 'r1' | 'r2';
  readonly request: Omit<DistributedPredictionCloneRequestV2, 'seed'>;
  readonly seeds: readonly bigint[];
  readonly parallelism?: number;
}

interface StableR1PhysicalAssemblyV2 {
  readonly assemblyId: string;
  readonly coreSiteIds: readonly number[];
  readonly memberEventIds: readonly string[];
}

const GRADE_ORDER: readonly EvidenceGrade[] = ['single-observation', 'repeated-correlation',
  'predictive-stable', 'causal-hypothesis', 'intervention-supported'];
const gradeMaximum = (values: readonly EvidenceGrade[]): EvidenceGrade =>
  [...values].sort((left, right) => GRADE_ORDER.indexOf(right) - GRADE_ORDER.indexOf(left))[0]
    ?? 'single-observation';
const predictiveGrade = (grade: EvidenceGrade): boolean =>
  GRADE_ORDER.indexOf(grade) >= GRADE_ORDER.indexOf('predictive-stable');
const evidenceRankForMemory = (grade: EvidenceGrade): number => GRADE_ORDER.indexOf(grade);

function publicChangeMatches(change: PublicChange, desired: DesiredChange): boolean {
  if (desired.subject && change.subject !== desired.subject
    && !change.subject.startsWith(`${desired.subject}#`)) return false;
  if (desired.property && change.property !== desired.property) return false;
  if (desired.value !== undefined && !Object.is(change.after, desired.value)) return false;
  if (desired.direction === 'increase') return typeof change.before === 'number'
    && typeof change.after === 'number' && change.after > change.before;
  if (desired.direction === 'decrease') return typeof change.before === 'number'
    && typeof change.after === 'number' && change.after < change.before;
  if (desired.direction === 'unchanged') return Object.is(change.before, change.after);
  return desired.direction !== 'change' || !Object.is(change.before, change.after);
}

function effectSignature(changes: readonly PublicChange[]): string {
  return sha(changes.map(change => ({ subject: change.subject, property: change.property,
    before: change.before, after: change.after, meaning: change.meaning }))
    .sort((left, right) => canonical(left).localeCompare(canonical(right), 'en')));
}

function goalProgress(changes: readonly PublicChange[], goal: GroundedGoalV1,
  evaluation: GoalEvaluationV1): boolean {
  return desiredChangesForGoal(goal, evaluation).some(target =>
    changes.some(change => publicChangeMatches(change, target.desired)));
}

interface PhysicalTerminalPublicReadoutV1 {
  readonly valid: boolean;
  readonly changes: readonly PublicChange[];
  readonly decodedValues: readonly EventLocalCurrentPublicValueV1[];
  readonly unknown: readonly string[];
}

/**
 * Compare a terminal afferent population with the real event-local public
 * prefix.  No event id, historical outcome, goal answer or world coordinate
 * is available on this path.  Channels not physically decoded remain unknown.
 */
function physicalTerminalChangesV1(readout: AfferentPublicStateReadoutV1,
  currentValues: ReturnType<typeof eventLocalCurrentPublicStateV1>['values']):
PhysicalTerminalPublicReadoutV1 {
  if (readout.status === 'unknown' || readout.status === 'ambiguous') return {
    valid: false, changes: [], decodedValues: [],
    unknown: [`terminal-afferent-readout-${readout.status}`],
  };
  const current = new Map<string, PublicChange['before']>(currentValues.map(value =>
    [`value/${value.subjectRole}/${value.property}`, value.value] as const));
  const changes: PublicChange[] = [];
  const decodedValues: EventLocalCurrentPublicValueV1[] = [];
  const unknown: string[] = [];
  for (const channel of readout.channels) {
    if (channel.status !== 'decoded') {
      unknown.push(`terminal-channel-${channel.status}:${channel.channel}`); continue;
    }
    const prefix = 'value/';
    if (!channel.channel.startsWith(prefix)) {
      unknown.push(`terminal-channel-not-public-state:${channel.channel}`); continue;
    }
    const suffix = `/${channel.property}`;
    if (!channel.channel.endsWith(suffix)) {
      unknown.push(`terminal-channel-property-mismatch:${channel.channel}`); continue;
    }
    const subject = channel.channel.slice(prefix.length, -suffix.length);
    const before = current.get(channel.channel);
    const after = channel.encoding === 'continuous' ? channel.continuous?.estimate : channel.value;
    if (after === undefined) {
      unknown.push(`terminal-channel-value-unavailable:${channel.channel}`); continue;
    }
    decodedValues.push({ subjectRole: subject, property: channel.property, value: after });
    if (before === undefined) {
      // A no-effect event is a real, bounded observation encoded by its own
      // public channel.  It is not a guessed state transition.
      if (subject === 'event' && channel.property === 'change-within-observed-window'
        && after === false) {
        changes.push({ subject, property: channel.property, before: false, after: false,
          observationIndex: 0, meaning: 'observed-co-occurrence' });
      } else unknown.push(`terminal-current-channel-unavailable:${channel.channel}`);
      continue;
    }
    const unchanged = channel.encoding === 'continuous' && typeof before === 'number'
      && channel.continuous !== undefined
      ? before >= channel.continuous.lowerBound && before <= channel.continuous.upperBound
      : Object.is(before, after);
    if (!unchanged) changes.push({ subject, property: channel.property, before, after,
      observationIndex: 0, meaning: 'observed-co-occurrence' });
  }
  return { valid: decodedValues.length > 0, changes, decodedValues,
    unknown: [...new Set(unknown)].sort() };
}

function physicalTerminalDrivesV1(result: ReturnType<DistributedPredictionCloneV2['run']>):
readonly DistributedSiteDriveV1[] {
  const core = new Set(result.attractorReadout.coreSiteIds);
  return result.fieldRun.finalActivations.filter(value => core.has(value.siteId)
    && value.activation > 0).map(value => ({ siteId: value.siteId, intensity: value.activation }));
}

function boundaryBefore(event: RealEvent): DistributedR2BoundaryBeforeV1 {
  return event.hierarchyContinuity?.boundaryBefore ?? 'reset';
}

/**
 * Production owner for the three independent distributed substrates. Public
 * state drives self-organising afferents; no world position is converted into
 * a substrate location and no result label selects a location.
 */
export class DistributedHierarchicalPhysicalMemoryV1 {
  #r1Medium: DistributedPhysicalMedium3DV1;
  #r1: DistributedR1ExperienceStoreV1;
  #r2: DistributedR2ContinuityStoreV1;
  #r2a: DistributedR2APhysicalPatternLearnerV2;
  readonly #annotations = new Map<string, DistributedR1AnnotationV1>();
  readonly #processedR2 = new Set<string>();
  readonly #seen = new Set<string>();
  #activeSeconds = 0;
  #writes = 0;
  #metaEvidence = new MetaEvidenceStoreV1();
  #metaDepositionOrdinal = 0;
  #r1Revision = 0;
  #r2Revision = 0;
  #r1PredictionCache: { readonly snapshot: DistributedMediumSnapshotV1;
    readonly clone: DistributedPredictionCloneV2; readonly revision: number } | null = null;
  #r2PredictionCache: { readonly snapshot: DistributedMediumSnapshotV1;
    readonly clone: DistributedPredictionCloneV2; readonly revision: number } | null = null;
  #timescaleOwner: DistributedHierarchicalTimescaleOwnerV1 | null = null;
  #timescaleEnabled = false;

  constructor() {
    this.#r1Medium = new DistributedPhysicalMedium3DV1({ name: 'R1', seedHex: '5231' });
    this.#r1 = new DistributedR1ExperienceStoreV1(this.#r1Medium);
    this.#r2 = new DistributedR2ContinuityStoreV1(undefined, undefined, undefined,
      footprint => this.#r1Medium.isFootprintActive(footprint));
    this.#r2a = new DistributedR2APhysicalPatternLearnerV2(id => this.#r2.isEventActive(id));
    this.#timescaleOwner = DistributedHierarchicalTimescaleOwnerV1.fromExisting(
      this.#r1Medium, this.#r2.medium, this.#r2a.medium, 0);
  }

  get ready(): boolean { return this.#seen.size >= 128; }
  get writes(): number { return this.#writes; }
  get bufferedEvents(): number { return Math.min(this.#seen.size, 128); }
  get mapSha256(): string | null {
    return this.ready ? sha(this.#r1.snapshot().projection) : null;
  }

  advanceTo(activeSeconds: number, measurements?: Readonly<Record<'r1' | 'r2' | 'r2a', readonly RuntimeMeasuredSalienceV2[]>>): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= this.#activeSeconds,
      'active-observation-time-reversed');
    const elapsed = activeSeconds - this.#activeSeconds;
    const hasMeasurements = measurements !== undefined
      && Object.values(measurements).some(value => value.length > 0);
    if (!this.#timescaleEnabled && hasMeasurements)
      throw new Error('timescale measurements require opt-in owner');
    if (elapsed > 0 || hasMeasurements) {
      if (this.#timescaleEnabled) {
        this.#timescaleOwner!.advanceTo(activeSeconds, measurements ?? { r1: [], r2: [], r2a: [] });
      } else {
        this.#r1Medium.recover(elapsed); this.#r2.recover(elapsed); this.#r2a.recover(elapsed);
      }
      this.#r1.invalidatePhysicalQualification();
      this.#r1Revision++; this.#r2Revision++;
      this.#invalidatePredictionCaches();
      this.#activeSeconds = activeSeconds;
    }
  }

  /**
   * Ingest the runtime's measured outcome after the corresponding real event
   * has been deposited.  Structure identities are resolved from the committed
   * R1/R2/R2A records here; callers cannot choose support mass, salience or a
   * physical location.  This path exists only for the explicit V4 owner.
   */
  recordRuntimeMeasurement(input: TrustedRuntimeMeasurementContextV1): void {
    assert(this.#timescaleEnabled, 'runtime measurements require V4 timescale owner');
    assert(input.version === 'TrustedRuntimeMeasurementContextV1'
      && typeof input.eventId === 'string' && input.eventId.length > 0,
    'invalid-runtime-measurement-context');
    const annotation = this.#annotations.get(input.eventId);
    assert(annotation, 'runtime-measurement-event-not-observed');
    assert(Number.isFinite(input.observedAt) && input.observedAt >= 0,
      'invalid-runtime-measurement-time');
    const eventEnd = annotation.r1Record.footprint.depositedAt;
    assert(input.observedAt >= eventEnd, 'runtime-measurement-before-event-end');

    const bridge = new RuntimeMeasuredSalienceBridgeV1();
    const common = { observedAt: input.observedAt,
      predictionDeviation: input.predictionDeviation,
      goalResidualBefore: input.goalResidualBefore,
      goalResidualAfter: input.goalResidualAfter };
    const capture = (medium: DistributedMediumSnapshotV1,
      structureIds: readonly string[]): readonly RuntimeMeasuredSalienceV2[] => [...new Set(structureIds)]
      .map(structureId => bridge.capture(medium, { ...common, structureId }));

    const r1 = capture(this.#r1Medium.snapshot(),
      [`trace:${annotation.r1Record.footprint.traceId}`]);
    const r2Events = annotation.r2EventIds
      .flatMap(eventId => this.#r2.events().filter(value => value.eventId === eventId))
      .filter(value => value.physicalFootprint !== null && value.learningEligible);
    const r2 = capture(this.#r2.medium.snapshot(), r2Events
      .map(value => `trace:${value.physicalFootprint!.traceId}`));
    const r2aTraceIds = r2Events.flatMap(value => this.#patternsFor(value)
      .flatMap(pattern => pattern.physicalTraceIds));
    const r2a = capture(this.#r2a.medium.snapshot(), r2aTraceIds.map(value => `trace:${value}`));
    this.#timescaleOwner!.advanceTo(input.observedAt, { r1, r2, r2a });
    if (input.observedAt > this.#activeSeconds) {
      this.#activeSeconds = input.observedAt;
      this.#r1.invalidatePhysicalQualification();
      this.#r1Revision++; this.#r2Revision++; this.#invalidatePredictionCaches();
    }
  }

  #invalidatePredictionCaches(): void {
    this.#r1PredictionCache = null;
    this.#r2PredictionCache = null;
  }

  #r1PredictionSubstrate(): { readonly snapshot: DistributedMediumSnapshotV1;
    readonly clone: DistributedPredictionCloneV2 } {
    if (this.#r1PredictionCache === null) {
      const snapshot = this.#r1Medium.snapshot();
      this.#r1PredictionCache = { snapshot, clone: new DistributedPredictionCloneV2(snapshot),
        revision: this.#r1Revision };
    }
    return this.#r1PredictionCache;
  }

  #r2PredictionSubstrate(): { readonly snapshot: DistributedMediumSnapshotV1;
    readonly clone: DistributedPredictionCloneV2 } {
    if (this.#r2PredictionCache === null) {
      const snapshot = this.#r2.medium.snapshot();
      this.#r2PredictionCache = { snapshot, clone: new DistributedPredictionCloneV2(snapshot),
        revision: this.#r2Revision };
    }
    return this.#r2PredictionCache;
  }

  observe(event: RealEvent): DistributedMemoryObservationReceiptV1 {
    validateEvent(event);
    assert(!this.#seen.has(event.id), 'real-event-already-observed');
    const endedAt = event.frames.at(-1)!.activeSeconds;
    assert(endedAt >= this.#activeSeconds, 'event-arrived-after-time-was-advanced-past-it');
    this.advanceTo(endedAt);
    // The following trusted deposit changes at least R1 and may close R2/R2A.
    // Never let a pre-deposit read-only clone survive that write boundary.
    this.#invalidatePredictionCaches();
    const receipt = this.#r1.observe(event);
    this.#r1Revision++;
    // Consume one monotonic meta-observation ordinal for every trusted event.
    // Missing channels are recorded as unknown (via observedChannels), never
    // as an inferred absence; this prevents passive gaps from fabricating a
    // second meta episode.
    this.#metaEvidence.observe(event.id, this.#metaDepositionOrdinal++,
      event.verifiedInternalChannels, [event.frames[0]!.contextId],
      event.verifiedInternalChannels === undefined ? undefined
        : event.verifiedInternalChannels.map(channel => channel.name));
    const rows = eventRows(event);
    const before = relativePublicFeatures(event.frames[0]!);
    const after = relativePublicFeatures(event.frames.at(-1)!);
    const beforeSignalOccurrences = distributedPublicSignalOccurrencesV1(before);
    const afterSignalOccurrences = distributedPublicSignalOccurrencesV1(after);
    const annotation: DistributedR1AnnotationV1 = {
      version: 'DistributedR1AnnotationV1', eventId: event.id, cue: structuredClone(event.cue),
      completion: event.complete ? 'complete' : 'censored', contextId: event.frames[0]!.contextId,
      observedBefore: before, observedAfter: after,
      beforeSignalIds: beforeSignalOccurrences.map(value => value.signalId),
      afterSignalIds: afterSignalOccurrences.map(value => value.signalId),
      beforeSignalOccurrences, afterSignalOccurrences,
      changeWaves: structuredClone(rows.changes), publicRoleBindings: structuredClone(rows.roleBindings),
      r1Record: structuredClone(receipt.record), r2EventIds: [],
    };
    this.#annotations.set(event.id, annotation);
    this.#seen.add(event.id); this.#writes += Number(receipt.status === 'deposited');

    const continuity = event.hierarchyContinuity;
    if (!continuity) {
      this.#consumeR2Receipt(this.#r2.interrupt('continuity-reset'));
      return this.#receipt(receipt.novelty);
    }
    const atom: DistributedR2AtomV1 = { version: 'DistributedR2AtomV1', atomId: `r1:${event.id}`,
      sourceEventId: event.id, exactExperienceIdentity: cueIdentity(event.cue),
      episodePatternSha256: receipt.record.episodePatternSha256,
      r1Topology: structuredClone(receipt.record.episodeTopology),
      r1Footprint: structuredClone(receipt.record.footprint), cue: structuredClone(event.cue),
      contextId: event.frames[0]!.contextId,
      startedAt: event.frames[0]!.activeSeconds, endedAt,
      startFrameSequence: event.frames[0]!.sequence, endFrameSequence: event.frames.at(-1)!.sequence,
      sessionId: continuity.sessionId, continuityEpochId: continuity.continuityEpochId,
      dependencies: structuredClone(continuity.dependencies), publicChanges: rows.changes.flat(),
      beforePublicSignals: annotation.beforeSignalIds, afterPublicSignals: annotation.afterSignalIds,
      beforePublicSignalOccurrences: annotation.beforeSignalOccurrences,
      afterPublicSignalOccurrences: annotation.afterSignalOccurrences };
    const ingested = this.#r2.ingest(atom, boundaryBefore(event));
    if (ingested.closedBefore) this.#consumeR2Receipt(ingested.closedBefore);
    if (continuity.processStatusAfter === 'publicly-resolved')
      this.#consumeR2Receipt(this.#r2.close('public-process-resolved'));
    else if (continuity.processStatusAfter === 'observation-insufficient')
      this.#consumeR2Receipt(this.#r2.interrupt('observation-ended'));
    return this.#receipt(receipt.novelty);
  }

  #receipt(novelty: DistributedNoveltyRecordV1): DistributedMemoryObservationReceiptV1 {
    return { status: this.ready ? 'real-event-deposited' : 'initialization-buffer',
      writes: this.#writes, buffered: this.bufferedEvents, mapSha256: this.mapSha256,
      r1Atoms: this.#annotations.size, r2ContinuousEvents: this.#r2.committedEventCount,
      r2aStablePatterns: this.#r2a.indexedStablePatternCount(), novelty: structuredClone(novelty) };
  }

  #consumeR2Receipt(receipt: DistributedR2CloseReceiptV1): void {
    if (receipt.status !== 'committed') return;
    this.#r2Revision++;
    this.#r2PredictionCache = null;
    for (const sourceEventId of receipt.event.sourceEventIds) {
      const annotation = this.#annotations.get(sourceEventId);
      if (annotation) this.#annotations.set(sourceEventId, { ...annotation,
        r2EventIds: [...new Set([...annotation.r2EventIds, receipt.event.eventId])] });
    }
    if (!receipt.event.learningEligible || this.#processedR2.has(receipt.event.eventId)) return;
    this.#r2a.observe(receipt.event); this.#processedR2.add(receipt.event.eventId);
  }

  closeContinuity(boundary: { readonly completion?: 'complete' | 'censored'; readonly reason?: string }):
  DistributedR2CloseReceiptV1 {
    const receipt = boundary.completion === 'complete'
      ? this.#r2.close('normal-stop') : this.#r2.interrupt('session-ended');
    this.#consumeR2Receipt(receipt); return receipt;
  }

  #stableR1(annotation: DistributedR1AnnotationV1): boolean {
    // Semantic annotations decode a basin after it has qualified; they do not
    // decide whether the basin exists.  Support count, context count, dwell,
    // return, escape, ambiguity and competitor separation are all measured by
    // the R1 store against a read-only physical clone.
    return this.#r1.attractorQualification(annotation.eventId).status === 'stable-attractor';
  }

  #stableR1AssembliesForCue(cue: ActionCue): readonly StableR1PhysicalAssemblyV2[] {
    const groups = new Map<string, { coreSiteIds: readonly number[]; memberEventIds: string[] }>();
    for (const annotation of this.#annotations.values()) {
      if (cueIdentity(annotation.cue) !== cueIdentity(cue) || !this.#stableR1(annotation)) continue;
      const qualification = this.#r1.attractorQualification(annotation.eventId);
      if (!this.#r1Medium.isFootprintActive(annotation.r1Record.footprint)
        || qualification.coreSiteIds.length === 0) continue;
      const assemblyId = sha({ version: 'DistributedR1PhysicalAttractorAssemblyV2',
        coreSiteIds: qualification.coreSiteIds });
      const group = groups.get(assemblyId) ?? { coreSiteIds: [...qualification.coreSiteIds], memberEventIds: [] };
      group.memberEventIds.push(annotation.eventId); groups.set(assemblyId, group);
    }
    return [...groups].sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([assemblyId, group]) => ({ assemblyId, coreSiteIds: [...group.coreSiteIds],
        memberEventIds: [...new Set(group.memberEventIds)].sort() }));
  }

  #r2Event(annotation: DistributedR1AnnotationV1): DistributedR2ContinuousEventV1 | null {
    return annotation.r2EventIds.flatMap(id => this.#r2.events().filter(value => value.eventId === id))
      .find(value => value.learningEligible && this.#r2.isEventActive(value.eventId)) ?? null;
  }

  #patternsFor(event: DistributedR2ContinuousEventV1 | null): readonly DistributedR2APhysicalPatternV2[] {
    if (!event) return [];
    return this.#r2a.patterns().filter(value => value.memberR2EventIds.includes(event.eventId));
  }

  #relationsFor(patterns: readonly DistributedR2APhysicalPatternV2[]): readonly DistributedR2APhysicalRelationV2[] {
    const ids = new Set(patterns.map(value => value.patternId));
    return this.#r2a.relations().filter(value => ids.has(value.patternId));
  }

  #activePatternQualification(pattern: DistributedR2APhysicalPatternV2): {
    readonly grade: EvidenceGrade;
    readonly activeMemberR2EventIds: readonly string[];
    readonly activePhysicalTraceIds: readonly string[];
    readonly contextIds: readonly string[];
  } {
    const events = new Map(this.#r2.events().map(value => [value.eventId, value] as const));
    const active: { readonly event: DistributedR2ContinuousEventV1; readonly traceId: string }[] = [];
    pattern.memberR2EventIds.forEach((eventId, index) => {
      const event = events.get(eventId), traceId = pattern.physicalTraceIds[index];
      // The member event and the corresponding R2A deposition are one weakest
      // physical chain.  Missing/misaligned audit metadata fails closed.
      if (event && traceId && this.#r2.isEventActive(eventId)
        && this.#r2a.medium.isFootprintActive(traceId)) active.push({ event, traceId });
    });
    const contextIds = [...new Set(active.flatMap(value => value.event.contextIds))].sort();
    // The index is live only while the physically discovered attractor and
    // ordered propagation corridor remain measurable.  Event counts decode
    // the physical basin; they cannot manufacture its qualification.
    const physicalAttractor = pattern.attractor.coreSiteIds.length > 0
      && pattern.attractor.dwellSteps > 0 && pattern.attractor.returnRate >= 0
      && pattern.attractor.escapeRate < 1 && !pattern.attractor.ambiguous;
    const physicalCorridor = pattern.corridor.forwardPropagationRate >= .75
      && pattern.corridor.reverseRejectionRate >= .75;
    const grade: EvidenceGrade = active.length > 0 && physicalAttractor && physicalCorridor
      ? pattern.grade : 'single-observation';
    return {
      grade,
      activeMemberR2EventIds: active.map(value => value.event.eventId),
      activePhysicalTraceIds: active.map(value => value.traceId),
      contextIds,
    };
  }

  #activeRelationGrade(relation: DistributedR2APhysicalRelationV2): EvidenceGrade {
    const pattern = this.#r2a.patterns().find(value => value.patternId === relation.patternId);
    if (!pattern) return 'single-observation';
    const base = this.#activePatternQualification(pattern).grade;
    if (!relation.physicalTraceIds.some(trace => this.#r2a.medium.isFootprintActive(trace)))
      return 'single-observation';
    return evidenceRankForMemory(base) < evidenceRankForMemory('predictive-stable') ? base : relation.grade;
  }

  #currentRelationApplicability(relation: DistributedR2APhysicalRelationV2,
    observation: Observation): DistributedR2APhysicalApplicabilityV2 {
    const historical = this.#r2a.compareCurrentFactors(relation.relationId,
      distributedPublicSignalIdsV1(relativePublicFeatures(observation)));
    const pattern = this.#r2a.patterns().find(value => value.patternId === relation.patternId);
    const qualification = pattern ? this.#activePatternQualification(pattern) : null;
    const grade = this.#activeRelationGrade(relation);
    const physicalSupportActive = historical.physicalSupportActive
      && (qualification?.activeMemberR2EventIds.length ?? 0) > 0;
    const applicability = physicalSupportActive ? historical.applicability : 0;
    return { ...historical, applicability, evidenceGrade: grade, physicalSupportActive,
      predictionEligible: applicability >= .5 && predictiveGrade(grade),
      highConfidenceActionEligible: applicability >= .75 && grade === 'intervention-supported' };
  }

  #relationComparisons(relations: readonly DistributedR2APhysicalRelationV2[],
    observation: Observation): readonly DistributedR2APhysicalApplicabilityV2[] {
    return relations.map(value => this.#currentRelationApplicability(value, observation));
  }

  #evidence(annotation: DistributedR1AnnotationV1, observation: Observation): PhysicalEvidenceReferenceV1 {
    const r1Qualification = this.#r1.attractorQualification(annotation.eventId);
    const r1Active = r1Qualification.status === 'stable-attractor'
      && this.#r1Medium.isFootprintActive(annotation.r1Record.footprint);
    const r2Event = this.#r2Event(annotation), patterns = this.#patternsFor(r2Event);
    const r2Footprint = r2Event?.physicalFootprint ?? null;
    const relations = this.#relationsFor(patterns), comparisons = this.#relationComparisons(relations, observation);
    const grade = gradeMaximum([...patterns.map(value => this.#activePatternQualification(value).grade),
      ...relations.map(value => this.#activeRelationGrade(value))]);
    const applicability = Math.max(0, ...comparisons.map(value => value.applicability));
    const physicalRelation = comparisons.some(value => value.physicalSupportActive);
    const r2SupportStrength = r2Event && r2Footprint
      ? Math.min(1, r2Footprint.supportMass / Math.max(1, r2Event.atomIds.length * 2)) : 0;
    const activePatternQualifications = patterns.map(value => this.#activePatternQualification(value));
    const r2aPhysicalTraceIds = [...new Set(activePatternQualifications
      .flatMap(value => value.activePhysicalTraceIds))].sort();
    const r2aSupportStrength = physicalRelation
      ? Math.max(0, ...comparisons.map(value => value.physicalBranchSelectionRate)) : 0;
    return distributedEvidenceReferenceV1({ eventId: annotation.eventId,
      r1: annotation.r1Record.footprint, r1Active,
      r2: r2Footprint, r2Active: r2Event !== null && r2Footprint !== null,
      relationIds: relations.map(value => value.relationId).sort(), applicability,
      evidenceGrade: grade,
      predictionEligible: physicalRelation && predictiveGrade(grade),
      productionEligible: physicalRelation && grade === 'intervention-supported',
      r1AttractorId: r1Active ? sha({ version: 'DistributedR1AttractorIdentityV2',
        coreSiteIds: r1Qualification.coreSiteIds }) : null,
      r1ReturnRate: r1Qualification.meanReturnRate,
      r1EscapeRate: r1Qualification.meanEscapeRate,
      r1SupportStrength: r1Active ? r1Qualification.physicalSupportStrength : 0,
      r2CorridorId: r2Event && r2Footprint ? sha({ version: 'DistributedR2CorridorIdentityV2',
        pulseSiteIds: r2Footprint.pulseSiteIds ?? [],
        directedBondIds: r2Footprint.directedBondIds }) : null,
      r2SupportStrength,
      patternIds: patterns.map(value => value.patternId).sort(),
      r2aPhysicalTraceIds, r2aSupportStrength });
  }

  #recallCandidates(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    const desired = desiredChangesForGoal(goal, evaluation);
    const result: EffectRecallCandidateV1[] = [];
    for (const annotation of this.#annotations.values()) {
      if (annotation.completion !== 'complete' || !this.#stableR1(annotation)) continue;
      const changes = annotation.changeWaves.flat();
      const goalPredicateIds = desired.filter(item =>
        changes.some(change => publicChangeMatches(change, item.desired))).map(item => item.predicateId);
      if (goalPredicateIds.length === 0) continue;
      const evidence = this.#evidence(annotation, observation);
      result.push({ candidateId: sha({ version: 'DistributedEffectCandidateV1',
        eventId: annotation.eventId, effect: effectSignature(changes) }), goalPredicateIds,
      actionCue: structuredClone(annotation.cue), observedChanges: structuredClone(changes),
      observedBefore: structuredClone(annotation.observedBefore), evidence,
      unknown: evidence.r2a.relationIds.length === 0
        ? ['no-repeated-R2A-branch-relation']
        : evidence.r2a.applicability <= 0 ? ['current-factor-condition-not-satisfied'] : [] });
    }
    return result.sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'));
  }

  recallAtomicEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    return this.#recallCandidates(goal, evaluation, observation);
  }

  recallByEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    return this.#recallCandidates(goal, evaluation, observation);
  }

  recallContinuousPattern(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): readonly ContinuousPatternRecallV2[] {
    const desired = desiredChangesForGoal(goal, evaluation);
    return this.#r2a.patterns().flatMap(pattern => {
      const events = pattern.memberR2EventIds.flatMap(id => this.#r2.events().filter(value => value.eventId === id));
      if (!events.some(event => desired.some(item =>
        (event.processChanges ?? event.terminalChanges)
          .some(change => publicChangeMatches(change, item.desired))))) return [];
      const relations = this.#relationsFor([pattern]);
      const qualification = this.#activePatternQualification(pattern);
      const grade = gradeMaximum([qualification.grade,
        ...relations.map(value => this.#activeRelationGrade(value))]);
      const activeR2Support = qualification.activeMemberR2EventIds.length > 0;
      const activePatternTraces = qualification.activePhysicalTraceIds;
      const comparisons = activeR2Support
        ? this.#relationComparisons(relations, observation) : [];
      const currentApplicability = Math.max(0, ...comparisons.map(value => value.applicability));
      const currentPredictionEligible = activePatternTraces.length > 0
        && comparisons.some(value => value.predictionEligible);
      const observedAtomCount = this.#r2.snapshot().pending.length;
      const nextActionCueIdentities = [...new Set(events.flatMap(event => {
        const identity = event.orderedExperienceIdentities[observedAtomCount];
        return identity === undefined ? [] : [identity];
      }))].sort();
      const unknown = !activeR2Support ? ['lower-R1-or-R2-physical-support-inactive']
        : activePatternTraces.length === 0 ? ['distributed-R2A-pattern-footprint-inactive']
          : !predictiveGrade(grade) ? ['continuous-pattern-not-predictive-stable']
            : !currentPredictionEligible ? ['current-factor-condition-not-predictively-supported'] : [];
      return [{ patternId: pattern.patternId, memberR2EventIds: [...pattern.memberR2EventIds],
        orderedR1AtomIds: events[0]?.atomIds ?? [], evidenceGrade: grade,
        activePhysicalTraceIds: activePatternTraces,
        currentRelationIds: relations.map(value => value.relationId),
        currentApplicability, currentPredictionEligible, nextActionCueIdentities, unknown }];
    });
  }

  compareCurrentFactors(relationId: string, observation: Observation): ConditionApplicabilityV1 {
    const relation = this.#r2a.relations().find(value => value.relationId === relationId);
    if (!relation) throw new Error('unknown-distributed-R2A-relation');
    const value = this.#currentRelationApplicability(relation, observation);
    return { matchedFactorIds: value.matchedFactorIds,
      contradictedFactorIds: value.contradictedFactorIds, unknownFactorIds: value.unknownFactorIds,
      applicability: value.applicability, productionEligible: value.highConfidenceActionEligible };
  }

  compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): ConditionApplicabilityV1 {
    if ('version' in state) return { matchedFactorIds: state.knownActiveFactorIds,
      contradictedFactorIds: state.knownInactiveFactorIds, unknownFactorIds: state.unknownFactorIds,
      applicability: 0, productionEligible: false };
    const values = candidate.evidence.r2a.relationIds.map(id => this.compareCurrentFactors(id, state));
    return values.sort((left, right) => Number(right.productionEligible) - Number(left.productionEligible)
      || right.applicability - left.applicability)[0]
      ?? { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
        applicability: 0, productionEligible: false };
  }

  #annotationFor(candidate: EffectRecallCandidateV1): DistributedR1AnnotationV1 {
    const value = [...this.#annotations.values()].find(annotation => annotation.eventId === candidate.evidence.eventId);
    assert(value, 'unknown-distributed-effect-candidate'); return value;
  }

  #factorDelta(annotation: DistributedR1AnnotationV1): {
    readonly activated: readonly string[]; readonly deactivated: readonly string[];
    readonly unchanged: readonly string[]; readonly universe: readonly string[] } {
    const before = new Set(annotation.beforeSignalIds), after = new Set(annotation.afterSignalIds);
    const activated: string[] = [], deactivated: string[] = [], unchanged: string[] = [], universe: string[] = [];
    for (const relation of this.#r2a.relations()) for (const factor of relation.factors) {
      universe.push(factor.factorId);
      const wasActive = factor.sourceSignalIds.some(signal => before.has(signal));
      const isActive = factor.sourceSignalIds.some(signal => after.has(signal));
      if (!wasActive && isActive) activated.push(factor.factorId);
      else if (wasActive && !isActive) deactivated.push(factor.factorId);
      else if (isActive) unchanged.push(factor.factorId);
    }
    const unique = (values: string[]) => [...new Set(values)].sort();
    return { activated: unique(activated), deactivated: unique(deactivated),
      unchanged: unique(unchanged), universe: unique(universe) };
  }

  /**
   * Measured-performance escape hatch.  This is deliberately separate from
   * the synchronous reasoning API: callers provide the complete read-only
   * clone request and an explicit worker count.  The production decision path
   * remains unchanged, while benchmark/evaluation code can use the existing
   * exact seed workers without inventing a second predictor.
   */
  async predictPhysicalSeedsParallelV1(
    request: DistributedPredictionSeedBatchRequestV1,
  ): Promise<readonly DistributedPredictionCloneResultV2[]> {
    const substrate = request.medium === 'r1'
      ? this.#r1PredictionSubstrate() : this.#r2PredictionSubstrate();
    return runDistributedPredictionCloneBatchParallelV1(substrate.snapshot,
      { ...request.request, seeds: request.seeds }, request.parallelism ?? 1);
  }

  /** Exact seed-level medium probes for capacity/temporal measurements. */
  probePhysicalSeedsSyncV1(
    medium: 'r1' | 'r2', jobs: readonly DistributedMediumProbeJobV1[],
    parallelism = 1,
    options: { readonly compactReadout?: boolean; readonly compactSiteIds?: readonly number[] } = {},
  ) {
    const snapshot = medium === 'r1' ? this.#r1PredictionSubstrate().snapshot
      : this.#r2PredictionSubstrate().snapshot;
    return runDistributedMediumProbeBatchSyncV1(snapshot, jobs, parallelism, options);
  }

  /** Read-only diagnostics for PLAN-002; revisions never enter persisted state. */
  performanceCacheAuditV1(): {
    readonly r1Revision: number; readonly r2Revision: number;
    readonly r1CachedRevision: number | null; readonly r2CachedRevision: number | null;
  } {
    return { r1Revision: this.#r1Revision, r2Revision: this.#r2Revision,
      r1CachedRevision: this.#r1PredictionCache?.revision ?? null,
      r2CachedRevision: this.#r2PredictionCache?.revision ?? null };
  }

  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1): BranchPredictionV1 {
    const kind = 'hypothetical-prediction' as const;
    if ('version' in state) return this.#emptyBranch(kind, candidate.evidence,
      'hypothetical-public-prefix-has-no-real-R1-afferent-input');
    const annotation = this.#annotationFor(candidate), evidence = this.#evidence(annotation, state);
    if (!evidence.r1.active) return this.#emptyBranch(kind, evidence, 'distributed-R1-attractor-inactive');
    if (!evidence.r2.active) return this.#emptyBranch(kind, evidence, 'distributed-R2-road-inactive');
    if (!evidence.r2a.predictionEligible || evidence.r2a.applicability <= 0)
      return this.#emptyBranch(kind, evidence, 'current-distributed-R2A-pattern-unsupported');
    const physicalAssemblies = this.#stableR1AssembliesForCue(candidate.actionCue);
    const assemblies = physicalAssemblies.map(value => ({ assemblyId: value.assemblyId,
      siteIds: value.coreSiteIds, minimumCoverage: .75, minimumPurity: .75 }));
    if (assemblies.length === 0)
      return this.#emptyBranch(kind, evidence, 'candidate-has-no-stable-physical-terminal-attractor');
    const currentPerception = this.#r1.lookupCurrentObservation(state, annotation.publicRoleBindings);
    if (currentPerception.siteIds.length === 0 || currentPerception.unresolvedRoles.length > 0)
      return this.#emptyBranch(kind, evidence, 'current-real-public-perception-afferent-unavailable');
    const actionInput = this.#r1.lookupActionCue(candidate.actionCue);
    if (actionInput.siteIds.length === 0)
      return this.#emptyBranch(kind, evidence, 'candidate-action-afferent-unavailable');
    const { snapshot, clone } = this.#r1PredictionSubstrate();
    const results = Array.from({ length: 24 }, (_unused, index) => clone.run({
      currentPerceptionSeedSiteIds: currentPerception.siteIds,
      ...(currentPerception.drives === undefined ? {} : {
        currentPerceptionSeedDrives: currentPerception.drives,
      }),
      currentPerceptionMode: 'sequential-prefix',
      realPrefixSeedSiteIds: [currentPerception.siteIds],
      ...(currentPerception.drives === undefined ? {} : {
        realPrefixSeedDrives: [currentPerception.drives],
      }),
      actionSeedSiteIds: actionInput.siteIds,
      ...(actionInput.drives === undefined ? {} : {
        actionSeedDrives: actionInput.drives,
      }),
      readoutAssemblies: assemblies, seed: BigInt(index + 1), steps: 180 }));
    const currentPublic = eventLocalCurrentPublicStateV1(state, annotation.publicRoleBindings);
    let progressSampleCount = 0;
    const nextStates: HypotheticalPublicStateV1[] = [];
    const terminalReadouts = results.map(result => result.status === 'reached'
      ? physicalTerminalChangesV1(this.#r1.readPublicState(physicalTerminalDrivesV1(result)),
        currentPublic.values)
      : { valid: false, changes: [], decodedValues: [],
        unknown: [result.reason] } satisfies PhysicalTerminalPublicReadoutV1);
    const samples = results.map((value, index) => {
      const reachedAssemblyId = value.status === 'reached' ? value.reachedAssemblyIds[0] : undefined;
      const changes = terminalReadouts[index]!.valid && reachedAssemblyId
        ? new Map([[reachedAssemblyId, terminalReadouts[index]!.changes] as const])
        : new Map<string, readonly PublicChange[]>();
      return distributedPredictionSampleV1(index + 1, value, changes);
    });
    const liveRelations = this.#r2a.relations();
    const relationIds = liveRelations.map(relation => relation.relationId);
    const factorUniverse = [...new Set(liveRelations.flatMap(relation =>
      relation.factors.map(factor => factor.factorId)))].sort((left, right) => left.localeCompare(right, 'en'));
    const projectionCache = new Map<string,
      ReturnType<DistributedR2APhysicalPatternLearnerV2['projectTransientFactors']>>();
    const projectionUnknown: string[] = [];
    for (const readout of terminalReadouts) {
      if (!readout.valid) continue;
      if (goalProgress(readout.changes, goal, evaluation)) progressSampleCount++;
      const sparse = eventLocalDecodedPublicFeaturesV1(state,
        annotation.publicRoleBindings, readout.decodedValues);
      projectionUnknown.push(...sparse.unresolvedChannels.map(value => `terminal-R2A-${value}`));
      const predictedSignalIds = distributedPublicSignalIdsV1(sparse.features);
      const cacheKey = sha(predictedSignalIds);
      let factors = projectionCache.get(cacheKey);
      if (!factors) {
        factors = this.#r2a.projectTransientFactors(relationIds, predictedSignalIds, factorUniverse);
        projectionCache.set(cacheKey, factors);
      }
      nextStates.push({ version: 'HypotheticalPublicStateV1', baseObservationSequence: state.sequence,
        knownChanges: structuredClone(readout.changes),
        knownActiveFactorIds: factors.knownActiveFactorIds,
        knownInactiveFactorIds: factors.knownInactiveFactorIds,
        unknownFactorIds: [...new Set([...factors.unknownFactorIds,
          ...factorUniverse.filter(factorId => !factors!.knownActiveFactorIds.includes(factorId)
            && !factors!.knownInactiveFactorIds.includes(factorId))])].sort(),
        unobserved: 'unknown' });
    }
    const validSampleCount = terminalReadouts.filter(value => value.valid).length;
    const unknown = [...new Set([...terminalReadouts.flatMap(value => value.unknown),
      ...projectionUnknown])];
    const prediction: DistributedPredictionV3 = { version: 'DistributedPredictionV3', kind,
      support: evidence.r2a.applicability, calibratedProbability: false, samples, evidence,
      unknown, substrateSha256: this.mapSha256 };
    return { prediction, currentEvidence: evidence, validSampleCount, progressSampleCount,
      progressFraction: validSampleCount === 0 ? 0 : progressSampleCount / validSampleCount,
      nextStates, unknown,
      readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1', roleBindingStatus: 'not-required',
        goalRelevantReadoutCount: progressSampleCount, maxVisitedOriginalKernelIndex: null,
        goalRelevantKernelVisited: progressSampleCount > 0 } };
  }

  #emptyBranch(kind: DistributedPredictionV3['kind'], evidence: PhysicalEvidenceReferenceV1,
    reason: string): BranchPredictionV1 {
    return { prediction: emptyDistributedPredictionV1(kind, reason, evidence, this.mapSha256),
      currentEvidence: evidence, validSampleCount: 0, progressSampleCount: 0, progressFraction: 0,
      nextStates: [], unknown: [reason], readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1',
        roleBindingStatus: 'not-required', goalRelevantReadoutCount: 0,
        maxVisitedOriginalKernelIndex: null, goalRelevantKernelVisited: false } };
  }

  predictContinuation(patternId: string, exactActionCue: ActionCue,
    observation: Observation): ContinuationPredictionV2 {
    const pattern = this.#r2a.patterns().find(value => value.patternId === patternId);
    assert(pattern, 'unknown-distributed-continuous-pattern');
    const relations = this.#relationsFor([pattern]);
    const qualification = this.#activePatternQualification(pattern);
    const comparisons = this.#relationComparisons(relations, observation);
    const grade = gradeMaximum([qualification.grade,
      ...relations.map(value => this.#activeRelationGrade(value))]);
    const empty = (reason: string): ContinuationPredictionV2 => ({ version: 'ContinuationPredictionV2',
      patternId, support: 0, samples: [], evidenceGrade: grade, unknown: [reason] });
    const seedDrives = this.#r2.currentPrefixSeedDrives();
    if (seedDrives.length === 0) return empty('current-real-distributed-R2-prefix-unavailable');
    if (qualification.activeMemberR2EventIds.length === 0)
      return empty('lower-R1-or-R2-physical-support-inactive');
    if (qualification.activePhysicalTraceIds.length === 0)
      return empty('distributed-R2A-pattern-footprint-inactive');
    if (!predictiveGrade(grade)) return empty('distributed-continuous-pattern-not-predictive-stable');
    if (relations.length === 0) return empty('current-distributed-R3-relation-unavailable');
    if (!comparisons.some(value => value.predictionEligible))
      return empty('current-distributed-R3-relation-not-applicable');
    const currentSignals = distributedPublicSignalIdsV1(relativePublicFeatures(observation));
    const observedAtomCount = this.#r2.snapshot().pending.length;
    const physical = this.#r2a.predictPhysicalContinuation(patternId, currentSignals,
      seedDrives, observedAtomCount, cueIdentity(exactActionCue),
      Array.from({ length: 24 }, (_unused, index) => BigInt(index + 1)));
    const samples = physical.results.map((result, index) =>
      distributedPredictionSampleV1(index + 1, result, new Map()));
    const reached = samples.filter(value => value.status === 'reached'
      && value.reaches.some(reach => reach.assemblyId === patternId)).length;
    return { version: 'ContinuationPredictionV2', patternId, support: reached / 24,
      samples, evidenceGrade: grade,
      unknown: reached > 0 ? [] : ['distributed-trajectory-did-not-reach-pattern-terminal'] };
  }

  compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[], source: { readonly r1Active: boolean; readonly r2Active: boolean }):
  readonly ProjectedParentRelationApplicabilityV1[] {
    const relations = new Map(this.#r2a.relations().map(value => [value.relationId, value]));
    const current = new Map(relationIds.flatMap(id => {
      const relation = relations.get(id);
      return relation ? [[id, this.#currentRelationApplicability(relation, observation)] as const] : [];
    }));
    return states.map(state => {
      const results = relationIds.flatMap(id => {
        const relation = relations.get(id); if (!relation) return [];
        const present = current.get(id)!;
        const presentMatched = new Set(present.matchedFactorIds);
        const presentContradicted = new Set(present.contradictedFactorIds);
        const matched: string[] = [], contradicted: string[] = [], unknown: string[] = [];
        relation.factors.forEach(({ factorId }) => {
          if (state.knownActiveFactorIds.includes(factorId)) matched.push(factorId);
          else if (state.knownInactiveFactorIds.includes(factorId)) contradicted.push(factorId);
          else if (state.unknownFactorIds.includes(factorId)) unknown.push(factorId);
          else if (presentMatched.has(factorId)) matched.push(factorId);
          else if (presentContradicted.has(factorId)) contradicted.push(factorId);
          else unknown.push(factorId);
        });
        const physical = source.r1Active && source.r2Active && present.physicalSupportActive
          && relation.physicalTraceIds.some(trace => this.#r2a.medium.isFootprintActive(trace));
        const productionEligible = physical && present.evidenceGrade === 'intervention-supported'
          && contradicted.length === 0 && unknown.length === 0;
        return [{ relationId: id, matchedFactorIds: matched, contradictedFactorIds: contradicted,
          unknownFactorIds: unknown, applicability: productionEligible ? 1 : 0, productionEligible }];
      });
      const selected = [...results].sort((left, right) => Number(right.productionEligible) - Number(left.productionEligible)
        || right.applicability - left.applicability)[0] ?? null;
      return { version: 'ProjectedParentRelationApplicabilityV1',
        selectedRelationId: selected?.relationId ?? null,
        matchedFactorIds: selected?.matchedFactorIds ?? [],
        contradictedFactorIds: selected?.contradictedFactorIds ?? [],
        unknownFactorIds: selected?.unknownFactorIds ?? [], applicability: selected?.applicability ?? 0,
        productionEligible: selected?.productionEligible ?? false,
        relationResults: results };
    });
  }

  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
  readonly OpaqueFactorTransitionTraceV1[] {
    if ('version' in state || factorIds.length === 0) return [];
    const requested = new Set(factorIds), result: OpaqueFactorTransitionTraceV1[] = [];
    for (const annotation of this.#annotations.values()) {
      const delta = this.#factorDelta(annotation);
      if (![...delta.activated, ...delta.deactivated].some(id => requested.has(id))) continue;
      result.push({ version: 'OpaqueFactorTransitionTraceV1',
        transitionId: sha({ eventId: annotation.eventId, activated: delta.activated,
          deactivated: delta.deactivated }), eventId: annotation.eventId,
        actionCue: structuredClone(annotation.cue), activatedFactorIds: delta.activated,
        deactivatedFactorIds: delta.deactivated, unchangedActiveFactorIds: delta.unchanged,
        evidence: this.#evidence(annotation, state), meaning: 'observed-factor-transition' });
    }
    return result.sort((left, right) => left.transitionId.localeCompare(right.transitionId, 'en'));
  }

  recall(desired: DesiredChange, observation: Observation, offset = 0): unknown {
    const values = [...this.#annotations.values()].filter(value => value.changeWaves.flat()
      .some(change => publicChangeMatches(change, desired)));
    return { kind: 'historical-atomic-observation', total: values.length, offset,
      nextOffset: offset + 2 < values.length ? offset + 2 : null,
      candidates: values.slice(offset, offset + 2).map(value => ({ eventId: value.eventId,
        action: value.cue, actualObserved: value.changeWaves.flat().filter(change => publicChangeMatches(change, desired)),
        observedBefore: value.observedBefore, evidence: this.#evidence(value, observation),
        unknown: ['historical-observation-is-not-a-causal-claim'] })) };
  }

  predict(cue: ActionCue, observation: Observation,
    options: { readonly prefix?: RealEvent } = {}): DistributedPredictionV3 {
    const annotation = [...this.#annotations.values()].find(value => cueIdentity(value.cue) === cueIdentity(cue)
      && this.#stableR1(value));
    const kind = options.prefix ? 'factual-prediction' as const : 'hypothetical-prediction' as const;
    if (!annotation) return emptyDistributedPredictionV1(kind, 'no-stable-distributed-R1-experience', null,
      this.mapSha256);
    const evidence = this.#evidence(annotation, observation);
    if (!evidence.r2a.predictionEligible || evidence.r2a.applicability <= 0)
      return emptyDistributedPredictionV1(kind, 'no-current-predictive-distributed-pattern', evidence,
        this.mapSha256);
    return this.predictCandidate({ candidateId: annotation.eventId, goalPredicateIds: [],
      actionCue: annotation.cue, observedChanges: annotation.changeWaves.flat(),
      observedBefore: annotation.observedBefore, evidence, unknown: [] }, observation,
    { version: 'GroundedGoalV1', id: 'raw-predict', expression: { kind: 'predicate', predicate: {
      version: 'GoalPredicateV1', id: 'raw-predict', subject: { kind: 'self' }, observable: 'visible',
      comparator: 'equals', target: true } } }, { goalId: 'raw-predict', status: 'unknown', residual: 1,
      observationSequence: observation.sequence, predicates: [] }).prediction;
  }

  /** New physical intervention API; legacy protocol registration is deliberately not migrated. */
  recordDistributedMatchedIntervention(value: DistributedR2AInterventionPairV2):
  DistributedR2AInterventionAssessmentV2 {
    return this.#r2a.recordMatchedIntervention(value);
  }

  /**
   * Batch the read-only physical probes for a set of matched interventions.
   * The underlying learner still records one immutable assessment per pair;
   * this entry point only shares the exact medium snapshot and worker batch.
   */
  recordDistributedMatchedInterventions(values: readonly DistributedR2AInterventionPairV2[]):
  readonly DistributedR2AInterventionAssessmentV2[] {
    return this.#r2a.recordMatchedInterventions(values);
  }

  /**
   * Read-only substrate inspection for bounded engineering diagnostics.  This
   * deliberately bypasses R2A index discovery: asking what is physically in
   * the lattice must not launch attractor probes, consolidate a relation, or
   * write anything back to experience.
   */
  r2aRawPhysicalMediumSnapshotForAudit(): DistributedMediumSnapshotV1 {
    return this.#r2a.rawPhysicalMediumSnapshotForAudit();
  }

  /**
   * Explicit batch boundary for callers that ingest many complete R2 events.
   * R1/R2 deposits remain immediate; only the expensive R2A derived-index
   * consolidation is coalesced by the underlying learner.
   */
  beginR2AConsolidationBatchV1(): void {
    this.#r2a.beginDeferredConsolidationBatchV1();
  }

  endR2AConsolidationBatchV1(): DistributedR2AConsolidationBatchReceiptV1 {
    return this.#r2a.endDeferredConsolidationBatchV1();
  }

  r2AConsolidationBatchStatusV1(): DistributedR2AConsolidationBatchStatusV1 {
    return this.#r2a.consolidationBatchStatusV1();
  }

  r2AConsolidationPerformanceAuditV1(): DistributedR2AConsolidationPerformanceAuditV1 {
    return this.#r2a.consolidationPerformanceAuditV1();
  }

  snapshot(): KairosV5DistributedPhysicalMemoryV3 {
    const metaEvidence = this.#metaEvidence.snapshot();
    return { version: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
      hierarchy: DISTRIBUTED_HIERARCHY_SEMANTICS_V2, activeSeconds: this.#activeSeconds,
      r1Medium: this.#r1Medium.snapshot(), r1: this.#r1.snapshot(),
      r2Medium: this.#r2.medium.snapshot(), r2: this.#r2.snapshot(), r2a: this.#r2a.snapshot(),
      annotations: [...this.#annotations.values()].sort((left, right) => left.eventId.localeCompare(right.eventId, 'en'))
        .map(value => structuredClone(value)), processedR2EventIds: [...this.#processedR2].sort(),
      seenEventIds: [...this.#seen].sort(), writes: this.#writes,
      ...(metaEvidence.observations.some(value => value.bands.length > 0)
        ? { metaEvidence } : {}) };
  }

  static restore(snapshot: KairosV5DistributedPhysicalMemoryV3): DistributedHierarchicalPhysicalMemoryV1 {
    assert(snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3
      && snapshot.hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2
      && snapshot.r2a.version === 'DistributedR2APhysicalStateV3',
    'legacy-or-incompatible-distributed-checkpoint-is-audit-only');
    const memory = new DistributedHierarchicalPhysicalMemoryV1();
    memory.#r1Medium = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot.r1Medium);
    memory.#r1 = DistributedR1ExperienceStoreV1.restore(memory.#r1Medium, snapshot.r1);
    memory.#r2 = DistributedR2ContinuityStoreV1.restore(snapshot.r2Medium, snapshot.r2,
      footprint => memory.#r1Medium.isFootprintActive(footprint));
    memory.#r2a = DistributedR2APhysicalPatternLearnerV2.restore(snapshot.r2a,
      id => memory.#r2.isEventActive(id));
    for (const value of snapshot.annotations) memory.#annotations.set(value.eventId, structuredClone(value));
    snapshot.processedR2EventIds.forEach(id => memory.#processedR2.add(id));
    snapshot.seenEventIds.forEach(id => memory.#seen.add(id));
    memory.#activeSeconds = snapshot.activeSeconds; memory.#writes = snapshot.writes;
    if (snapshot.metaEvidence) {
      memory.#metaEvidence = MetaEvidenceStoreV1.restore(snapshot.metaEvidence);
      const observations = snapshot.metaEvidence.observations;
      memory.#metaDepositionOrdinal = observations.length === 0 ? 0
        : Math.max(...observations.map(value => value.depositionOrdinal)) + 1;
    }
    // Keep the fail-closed byte-identity boundary per physical layer.  A
    // combined boolean hid which independently owned substrate was rebuilt
    // differently and forced an entire hierarchy replay for every diagnosis.
    assert(sha(memory.#r1Medium.snapshot()) === sha(snapshot.r1Medium),
      'distributed-R1-checkpoint-restore-not-byte-equivalent');
    assert(sha(memory.#r2.medium.snapshot()) === sha(snapshot.r2Medium),
      'distributed-R2-checkpoint-restore-not-byte-equivalent');
    const restoredR2A = memory.#r2a.snapshot();
    assert(sha(restoredR2A.medium) === sha(snapshot.r2a.medium),
      'distributed-R2A-medium-checkpoint-restore-not-byte-equivalent');
    if (memory.#r2a.restoreIndexModeForAudit() === 'exact-cache')
      assert(sha(restoredR2A) === sha(snapshot.r2a),
        'distributed-R2A-checkpoint-restore-not-byte-equivalent');
    else assert(memory.#r2a.restoreIndexModeForAudit() === 'physical-rediscovery',
      'distributed-R2A-checkpoint-restore-mode-invalid');
    return memory;
  }

  enableTimescaleV2(): void {
    if (this.#timescaleEnabled) return;
    this.#timescaleOwner = DistributedHierarchicalTimescaleOwnerV1.fromExisting(
      this.#r1Medium, this.#r2.medium, this.#r2a.medium, this.#activeSeconds);
    this.#timescaleEnabled = true;
  }

  snapshotV4(): KairosV5DistributedPhysicalMemoryV4 {
    this.enableTimescaleV2();
    return { ...this.snapshot(), version: 'KairosV5DistributedPhysicalMemoryV4',
      timescales: this.#timescaleOwner!.snapshot() };
  }

  static restoreV4(snapshot: KairosV5DistributedPhysicalMemoryV4): DistributedHierarchicalPhysicalMemoryV1 {
    assert(snapshot.version === 'KairosV5DistributedPhysicalMemoryV4',
      'unsupported-distributed-timescale-checkpoint');
    const legacy = { ...snapshot,
      version: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } as KairosV5DistributedPhysicalMemoryV3;
    const memory = DistributedHierarchicalPhysicalMemoryV1.restore(legacy);
    memory.#timescaleOwner = DistributedHierarchicalTimescaleOwnerV1.restoreInto(
      memory.#r1Medium, memory.#r2.medium, memory.#r2a.medium, snapshot.timescales);
    memory.#timescaleEnabled = true;
    assert(memory.#timescaleOwner.logicalTime === memory.#activeSeconds,
      'distributed-timescale-checkpoint-time-mismatch');
    return memory;
  }
}

export type DistributedMemorySnapshotV3 = KairosV5DistributedPhysicalMemoryV3;
