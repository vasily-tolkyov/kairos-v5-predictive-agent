import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import type { Action, ActionCue, Observation, Prediction, RealEvent, VerifiedInternalChannelV1 } from './contracts.js';
import type { Configuration } from './services.js';
import { MinecraftBody } from './body.js';
import { Compute } from './compute.js';
import { AttentionMonitor } from './attention/monitor.js';
import type { PredictionViolationMeasurementV1 } from './attention/prediction-deviation.js';
import { actionObservationTrackedIdsV1, eventRows, cueIdentity, realEventHierarchyContinuityV1,
  validateEvent } from './events.js';
import { assert, saveJson, sha } from './util.js';
import { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3, DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  type DistributedMemoryObservationReceiptV1 as MemoryObservationReceipt,
  type DistributedMemorySnapshotV3 as MemorySnapshot,
  type KairosV5DistributedPhysicalMemoryV4 as MemorySnapshotV4 } from './distributed-hierarchical-memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV2, ContinuationPredictionV2, ContinuousPatternRecallV2 } from './control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2, type PhysicalControlResultV2,
  type PhysicalControlSnapshotV2 } from './control/controller.js';
import { ControlHabitWeightsV1, type ControlHabitCheckpointV1, type TrustedRealActionOutcomeV1 } from './control/habit.js';
import { attachInteroceptionToEventV1, computeInteroceptiveChannelsV1 } from './control/interoception.js';
import type { DistributedR2AInterventionPairV2 }
  from './core/learning/distributed-r2a-physical-contracts.js';
import type { DistributedNoveltyRecordV1 }
  from './core/learning/distributed-r1-contracts.js';
import type { TrustedRuntimeMeasurementContextV1 }
  from './core/physics/runtime-measured-salience-bridge-v1.js';
import { KAIROS_V5_RUNTIME_VERSION } from './core/compatibility.js';

const DISTRIBUTED_MEMORY_V4_VERSION = 'KairosV5DistributedPhysicalMemoryV4' as const;

export interface ExperiencePointer {
  /** Untrusted on-disk discriminator. Production validates the exact V2 value before use. */
  readonly runtimeVersion: string;
  readonly sourceContextVersion: typeof PUBLIC_LAYOUT_SEMANTICS;
  readonly filename: string; readonly sha256: string;
  /** Optional so every legacy V1 pointer remains a valid zero-habit checkpoint. */
  readonly habitFilename?: string; readonly habitSha256?: string;
  /**
   * Optional producer provenance.  Ordinary runtime checkpoints do not need a
   * producer declaration; G6 frozen baselines do.  Keeping this out of the
   * generic snapshot hash lets old read-only pointers remain inspectable while
   * allowing the G6 gate to reject an unbound baseline explicitly.
   */
  readonly distributedG6Provenance?: DistributedG6ExperienceProvenanceV1;
  readonly actions: number; readonly eventCount: number; readonly writes: number;
  /** Present only on the explicit versioned V4 timescale bundle. */
  readonly memoryVersion?: typeof DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 | typeof DISTRIBUTED_MEMORY_V4_VERSION;
  /** Frozen law identity carried by a V4 pointer. */
  readonly timescaleLawIdentitySha256?: string;
}

export const DISTRIBUTED_G6_PROVENANCE_VERSION_V1 =
  'DistributedG6ExperienceProvenanceV1' as const;
export type DistributedG6ExperienceProducerV1 =
  | 'trusted-r1-rebuild-v1'
  | 'continuous-capture-v1';

/** Stable identities for the two producers permitted to create a G6 baseline. */
export const DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1 = sha({
  version: 'DistributedG6R1RebuildProducerContractV1',
  output: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  semantics: DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
});
export const DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1 = sha({
  version: 'DistributedG6ContinuousCaptureProducerContractV1',
  output: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  semantics: DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
});

/** Provenance carried by a pointer, never interpreted as a physical result. */
export interface DistributedG6ExperienceProvenanceV1 {
  readonly version: typeof DISTRIBUTED_G6_PROVENANCE_VERSION_V1;
  readonly producer: DistributedG6ExperienceProducerV1;
  readonly producerIdentitySha256: string;
  readonly sourceId: string;
  readonly sourceEventsSha256: string;
  readonly commitmentSha256: string;
}

export function distributedG6ProvenanceCommitmentV1(value: Pick<
  DistributedG6ExperienceProvenanceV1,
  'version' | 'producer' | 'producerIdentitySha256' | 'sourceId' | 'sourceEventsSha256'
>): string {
  // Pick is erased at runtime; explicitly project the committed fields so an
  // attached commitment or future metadata cannot recursively alter the hash.
  return sha({ version: value.version, producer: value.producer,
    producerIdentitySha256: value.producerIdentitySha256, sourceId: value.sourceId,
    sourceEventsSha256: value.sourceEventsSha256 });
}

export function createDistributedG6ProvenanceV1(value: Omit<
  DistributedG6ExperienceProvenanceV1, 'commitmentSha256'
>): DistributedG6ExperienceProvenanceV1 {
  assert(value.version === DISTRIBUTED_G6_PROVENANCE_VERSION_V1,
    'distributed-g6-provenance-version-invalid');
  assert(/^[a-f0-9]{64}$/.test(value.producerIdentitySha256)
    && /^[a-f0-9]{64}$/.test(value.sourceEventsSha256)
    && value.sourceId.length > 0, 'distributed-g6-provenance-fields-invalid');
  const commitmentSha256 = distributedG6ProvenanceCommitmentV1(value);
  return Object.freeze({ ...value, commitmentSha256 });
}

export function validateDistributedG6ProvenanceV1(value: unknown):
  asserts value is DistributedG6ExperienceProvenanceV1 {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value),
    'distributed-g6-provenance-invalid');
  const candidate = value as Record<string, unknown>;
  assert(candidate.version === DISTRIBUTED_G6_PROVENANCE_VERSION_V1
    && (candidate.producer === 'trusted-r1-rebuild-v1'
      || candidate.producer === 'continuous-capture-v1')
    && typeof candidate.producerIdentitySha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.producerIdentitySha256)
    && typeof candidate.sourceId === 'string' && candidate.sourceId.length > 0
    && typeof candidate.sourceEventsSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.sourceEventsSha256)
    && typeof candidate.commitmentSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.commitmentSha256),
    'distributed-g6-provenance-invalid');
  assert(distributedG6ProvenanceCommitmentV1(candidate as unknown as Pick<
    DistributedG6ExperienceProvenanceV1,
    'version' | 'producer' | 'producerIdentitySha256' | 'sourceId' | 'sourceEventsSha256'>)
    === candidate.commitmentSha256, 'distributed-g6-provenance-commitment-mismatch');
}
export interface DistributedExperiencePointerV2 extends ExperiencePointer {
  readonly runtimeVersion: typeof KAIROS_V5_RUNTIME_VERSION;
}
export interface RestoredExperience { readonly pointerPath: string; readonly snapshotPath: string;
  readonly habitPath: string | null; readonly pointer: ExperiencePointer;
  /** Untrusted until the V5Runtime constructor checks the distributed V2 contract. */
  readonly snapshot: unknown;
  readonly habit: ControlHabitWeightsV1; }
export interface RestoredDistributedExperienceV2 extends RestoredExperience {
  readonly pointer: DistributedExperiencePointerV2;
  readonly snapshot: MemorySnapshot;
}
export interface DistributedExperiencePointerV4 extends ExperiencePointer {
  readonly runtimeVersion: typeof KAIROS_V5_RUNTIME_VERSION;
  readonly memoryVersion: typeof DISTRIBUTED_MEMORY_V4_VERSION;
  readonly timescaleLawIdentitySha256: string;
}
export interface RestoredDistributedExperienceV4 extends RestoredExperience {
  readonly pointer: DistributedExperiencePointerV4;
  readonly snapshot: MemorySnapshotV4;
}

export interface ExperienceBundleMetadataV1 {
  readonly actions: number; readonly eventCount: number; readonly writes: number;
  readonly distributedG6Provenance?: DistributedG6ExperienceProvenanceV1;
}

function assertDistributedMemorySnapshotV3(value: unknown): asserts value is MemorySnapshot {
  assert(typeof value === 'object' && value !== null
    && (value as { readonly version?: unknown }).version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3
    && (value as { readonly hierarchy?: unknown }).hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  'legacy-experience-snapshot-is-audit-only');
}

function assertDistributedMemorySnapshotV4(value: unknown): asserts value is MemorySnapshotV4 {
  assert(typeof value === 'object' && value !== null
    && (value as { readonly version?: unknown }).version === DISTRIBUTED_MEMORY_V4_VERSION
    && (value as { readonly hierarchy?: unknown }).hierarchy === DISTRIBUTED_HIERARCHY_SEMANTICS_V2
    && typeof (value as { readonly timescales?: unknown }).timescales === 'object'
    && (value as { readonly timescales?: { readonly version?: unknown } }).timescales?.version
      === 'DistributedHierarchicalTimescaleSnapshotV1',
  'invalid-distributed-timescale-snapshot');
  const timescales = (value as MemorySnapshotV4).timescales;
  for (const layer of [timescales.r1, timescales.r2, timescales.r2a]) {
    assert(layer.version === 'DistributedMediumProtocolSnapshotV2'
      && layer.protocol === 'distributed-medium-timescales-v2'
      && /^[a-f0-9]{64}$/.test(layer.lawIdentitySha256),
    'invalid-distributed-timescale-layer');
  }
  assert(timescales.r1.lawIdentitySha256 === timescales.r2.lawIdentitySha256
    && timescales.r1.lawIdentitySha256 === timescales.r2a.lawIdentitySha256,
  'distributed-timescale-law-identity-diverged');
}

function v3SnapshotFromV4(value: MemorySnapshotV4): MemorySnapshot {
  const { timescales: _timescales, ...base } = value;
  return { ...base, version: DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } as MemorySnapshot;
}

/** A V4 bundle may only update a directory already owned by V4. */
async function assertCurrentBundleProtocol(directory: string, expected: 'v3' | 'v4'): Promise<void> {
  const current = resolve(directory, 'EXPERIENCE_LATEST.json');
  try { await access(current); }
  catch { return; }
  const pointer = JSON.parse(await readFile(current, 'utf8')) as ExperiencePointer;
  const actual = pointer.memoryVersion === undefined
    || pointer.memoryVersion === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 ? 'v3'
    : pointer.memoryVersion === DISTRIBUTED_MEMORY_V4_VERSION ? 'v4' : null;
  assert(actual !== null, 'experience-bundle-protocol-invalid');
  assert(actual === expected, 'experience-bundle-protocol-overwrite');
}

export async function saveExperienceBundleV1(directory: string,
  snapshot: unknown,
  metadata: ExperienceBundleMetadataV1, habit: ControlHabitWeightsV1): Promise<DistributedExperiencePointerV2> {
  await assertCurrentBundleProtocol(directory, 'v3');
  assertDistributedMemorySnapshotV3(snapshot);
  assert(Number.isSafeInteger(metadata.actions) && metadata.actions >= 0, 'invalid-experience-actions');
  assert(Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0
    && metadata.eventCount === snapshot.seenEventIds.length, 'experience-event-count-mismatch');
  assert(Number.isSafeInteger(metadata.writes) && metadata.writes >= 0
    && metadata.writes === snapshot.writes, 'experience-write-count-mismatch');
  if (metadata.distributedG6Provenance !== undefined)
    validateDistributedG6ProvenanceV1(metadata.distributedG6Provenance);
  const suffix = metadata.eventCount.toString().padStart(4, '0');
  const filename = `experience-${suffix}.json`, habitFilename = `control-habit-${suffix}.json`;
  const habitCheckpoint = habit.exportCheckpoint();
  await saveJson(resolve(directory, filename), snapshot);
  await saveJson(resolve(directory, habitFilename), habitCheckpoint);
  const pointer: DistributedExperiencePointerV2 = { runtimeVersion: KAIROS_V5_RUNTIME_VERSION,
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename, sha256: sha(snapshot),
    habitFilename, habitSha256: sha(habitCheckpoint), ...metadata };
  // CURRENT is committed last, so it never names only one half of a bundle.
  await saveJson(resolve(directory, 'EXPERIENCE_LATEST.json'), pointer);
  return pointer;
}

/** Persist an explicitly enabled V4 timescale owner without changing V3 serialization. */
export async function saveExperienceBundleV4(directory: string,
  snapshot: MemorySnapshotV4, metadata: ExperienceBundleMetadataV1,
  habit: ControlHabitWeightsV1): Promise<DistributedExperiencePointerV4> {
  await assertCurrentBundleProtocol(directory, 'v4');
  assertDistributedMemorySnapshotV4(snapshot);
  assert(Number.isSafeInteger(metadata.actions) && metadata.actions >= 0, 'invalid-experience-actions');
  assert(Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0
    && metadata.eventCount === snapshot.seenEventIds.length, 'experience-event-count-mismatch');
  assert(Number.isSafeInteger(metadata.writes) && metadata.writes >= 0
    && metadata.writes === snapshot.writes, 'experience-write-count-mismatch');
  if (metadata.distributedG6Provenance !== undefined)
    validateDistributedG6ProvenanceV1(metadata.distributedG6Provenance);
  const suffix = metadata.eventCount.toString().padStart(4, '0');
  const filename = `experience-${suffix}.json`, habitFilename = `control-habit-${suffix}.json`;
  const habitCheckpoint = habit.exportCheckpoint();
  await saveJson(resolve(directory, filename), snapshot);
  await saveJson(resolve(directory, habitFilename), habitCheckpoint);
  const pointer: DistributedExperiencePointerV4 = { runtimeVersion: KAIROS_V5_RUNTIME_VERSION,
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, memoryVersion: DISTRIBUTED_MEMORY_V4_VERSION,
    timescaleLawIdentitySha256: snapshot.timescales.r1.lawIdentitySha256,
    filename, sha256: sha(snapshot), habitFilename, habitSha256: sha(habitCheckpoint), ...metadata };
  await saveJson(resolve(directory, 'EXPERIENCE_LATEST.json'), pointer);
  return pointer;
}

/**
 * Keep an injected retired-memory backend auditable during shutdown without
 * weakening the production bundle contract.  The normal saver above remains
 * strict and rejects legacy snapshots; this separate artifact is deliberately
 * marked as an audit-only pointer, so restoreExperience() will refuse it before
 * touching a compute worker.  A real V5 worker never takes this branch.
 */
async function saveRetiredMemoryAuditBundleV1(directory: string, snapshot: unknown,
  metadata: ExperienceBundleMetadataV1, habit: ControlHabitWeightsV1): Promise<void> {
  assert(typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot),
    'invalid-retired-memory-audit-snapshot');
  const value = snapshot as Record<string, unknown>;
  assert(typeof value.version === 'string' && value.version.startsWith('KairosV5HierarchicalMemory'),
    'invalid-retired-memory-audit-snapshot');
  assert(Array.isArray(value.seenEventIds) && Number.isSafeInteger(value.writes),
    'invalid-retired-memory-audit-snapshot');
  assert(metadata.eventCount === value.seenEventIds.length && metadata.writes === value.writes,
    'retired-memory-audit-count-mismatch');
  const suffix = metadata.eventCount.toString().padStart(4, '0');
  const filename = `experience-${suffix}.json`, habitFilename = `control-habit-${suffix}.json`;
  const habitCheckpoint = habit.exportCheckpoint();
  await saveJson(resolve(directory, filename), snapshot);
  await saveJson(resolve(directory, habitFilename), habitCheckpoint);
  // This pointer is intentionally not a DistributedExperiencePointerV2.  It
  // exists only so shutdown observers can see the final audit artifact; the
  // production restore gate rejects the retired runtime identity.
  await saveJson(resolve(directory, 'EXPERIENCE_LATEST.json'), {
    runtimeVersion: 'KairosV5HierarchicalRuntimeV1',
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS,
    filename, sha256: sha(snapshot), habitFilename,
    habitSha256: sha(habitCheckpoint), ...metadata,
  });
}

function isRetiredMemorySnapshot(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { readonly version?: unknown }).version === 'string'
    && (value as { readonly version: string }).version.startsWith('KairosV5HierarchicalMemory');
}

export function assertNewExperienceOutput(pointerPath: string | null, outputDirectory: string): void {
  if (pointerPath === null) return;
  const path = relative(dirname(pointerPath), resolve(outputDirectory));
  assert(isAbsolute(path) || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    'experience-source-directory-is-read-only');
}

/** Only a checkpoint written by this physical-control runtime can be resumed explicitly. */
export async function restoreExperience(compute: Compute, pointerPath: string | null):
Promise<RestoredDistributedExperienceV2 | null> {
  if (pointerPath === null) return null;
  assert(isAbsolute(pointerPath), 'experience-pointer-must-be-absolute');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.runtimeVersion === KAIROS_V5_RUNTIME_VERSION,
    'legacy-experience-pointer-is-audit-only');
  assert(pointer.sourceContextVersion === PUBLIC_LAYOUT_SEMANTICS, 'incompatible-experience-context-semantics');
  assert(typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && /^experience-\d+\.json$/.test(pointer.filename), 'invalid-experience-snapshot-filename');
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  assertDistributedMemorySnapshotV3(snapshot);
  assert(sha(snapshot) === pointer.sha256, 'experience-snapshot-invalid');
  assert(snapshot.writes === pointer.writes && snapshot.seenEventIds.length === pointer.eventCount,
    'experience-pointer-count-mismatch');
  const hasHabitFilename = Object.hasOwn(pointer, 'habitFilename');
  const hasHabitSha256 = Object.hasOwn(pointer, 'habitSha256');
  assert(hasHabitFilename === hasHabitSha256, 'experience-pointer-incomplete-habit-reference');
  if (Object.hasOwn(pointer, 'distributedG6Provenance'))
    validateDistributedG6ProvenanceV1(pointer.distributedG6Provenance);
  let habitPath: string | null = null, habit = new ControlHabitWeightsV1();
  if (hasHabitFilename) {
    assert(typeof pointer.habitFilename === 'string' && basename(pointer.habitFilename) === pointer.habitFilename
      && /^control-habit-\d+\.json$/.test(pointer.habitFilename), 'invalid-control-habit-filename');
    assert(typeof pointer.habitSha256 === 'string' && /^[a-f0-9]{64}$/.test(pointer.habitSha256),
      'invalid-control-habit-sha256');
    habitPath = resolve(dirname(pointerPath), pointer.habitFilename);
    const checkpoint = JSON.parse(await readFile(habitPath, 'utf8')) as ControlHabitCheckpointV1;
    assert(sha(checkpoint) === pointer.habitSha256, 'control-habit-checkpoint-invalid');
    habit = ControlHabitWeightsV1.restore(checkpoint);
  }
  await compute.call('restore', snapshot);
  return { pointerPath, snapshotPath, habitPath,
    pointer: pointer as DistributedExperiencePointerV2, snapshot, habit };
}

/** Restore only an explicitly versioned V4 bundle; the V3 path never accepts it. */
export async function restoreExperienceV4(compute: Compute, pointerPath: string | null):
Promise<RestoredDistributedExperienceV4 | null> {
  if (pointerPath === null) return null;
  assert(isAbsolute(pointerPath), 'experience-pointer-must-be-absolute');
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.runtimeVersion === KAIROS_V5_RUNTIME_VERSION
    && pointer.memoryVersion === DISTRIBUTED_MEMORY_V4_VERSION,
  'not-a-v4-experience-pointer');
  assert(pointer.sourceContextVersion === PUBLIC_LAYOUT_SEMANTICS, 'incompatible-experience-context-semantics');
  assert(typeof pointer.timescaleLawIdentitySha256 === 'string'
    && /^[a-f0-9]{64}$/.test(pointer.timescaleLawIdentitySha256),
  'invalid-timescale-law-identity');
  assert(typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && /^experience-\d+\.json$/.test(pointer.filename), 'invalid-experience-snapshot-filename');
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  assertDistributedMemorySnapshotV4(snapshot);
  assert(sha(snapshot) === pointer.sha256, 'experience-snapshot-invalid');
  assert(snapshot.timescales.r1.lawIdentitySha256 === pointer.timescaleLawIdentitySha256,
    'timescale-law-identity-mismatch');
  assert(snapshot.writes === pointer.writes && snapshot.seenEventIds.length === pointer.eventCount,
    'experience-pointer-count-mismatch');
  const hasHabitFilename = Object.hasOwn(pointer, 'habitFilename');
  const hasHabitSha256 = Object.hasOwn(pointer, 'habitSha256');
  assert(hasHabitFilename === hasHabitSha256, 'experience-pointer-incomplete-habit-reference');
  if (Object.hasOwn(pointer, 'distributedG6Provenance'))
    validateDistributedG6ProvenanceV1(pointer.distributedG6Provenance);
  let habitPath: string | null = null, habit = new ControlHabitWeightsV1();
  if (hasHabitFilename) {
    assert(typeof pointer.habitFilename === 'string' && basename(pointer.habitFilename) === pointer.habitFilename
      && /^control-habit-\d+\.json$/.test(pointer.habitFilename), 'invalid-control-habit-filename');
    assert(typeof pointer.habitSha256 === 'string' && /^[a-f0-9]{64}$/.test(pointer.habitSha256),
      'invalid-control-habit-sha256');
    habitPath = resolve(dirname(pointerPath), pointer.habitFilename);
    const checkpoint = JSON.parse(await readFile(habitPath, 'utf8')) as ControlHabitCheckpointV1;
    assert(sha(checkpoint) === pointer.habitSha256, 'control-habit-checkpoint-invalid');
    habit = ControlHabitWeightsV1.restore(checkpoint);
  }
  await compute.call('restoreV4', snapshot);
  return { pointerPath, snapshotPath, habitPath,
    pointer: pointer as DistributedExperiencePointerV4, snapshot, habit };
}

export class V5Runtime implements PhysicalReasoningPortV2, PhysicalControlEnvironmentV2 {
  readonly compute: Compute;
  readonly attention: AttentionMonitor;
  readonly controller: PhysicalControlManagerV2;
  readonly #habit: ControlHabitWeightsV1;
  #timescaleV4Enabled = false;
  #recent: unknown[] = [];
  #actions = 0; #events = 0; #newEvents = 0; #writes = 0; #buffered = 0; #noveltySignals = 0;
  #map: string | null = null;
  #lastSnapshot: MemorySnapshot | null = null;
  #pendingPassive: RealEvent[] = [];
  #eventPredictionDeviations = new Map<string, PredictionViolationMeasurementV1 | null>();
  #runtimeMeasuredEventIds = new Set<string>();
  #learnedChanges: { start: number; end: number }[] = [];
  #habitObservationTime = 0;
  #periodicHabitSavePending = false;
  #closePromise: Promise<void> | null = null;
  readonly #beforeObserve?: (completedEvents: number, event: RealEvent) => void;
  constructor(readonly body: MinecraftBody, readonly config: Configuration, readonly evidence: string,
    readonly record: (kind: string, value: unknown) => void, dependencies: { compute?: Compute;
      beforeObserve?: (completedEvents: number, event: RealEvent) => void; restoredExperience?: RestoredExperience | null;
      habit?: ControlHabitWeightsV1;
      controlOptions?: { readonly requirePredictionProgress?: boolean } } = {}) {
    this.compute = dependencies.compute ?? new Compute(); this.#beforeObserve = dependencies.beforeObserve;
    this.#habit = dependencies.restoredExperience?.habit ?? dependencies.habit ?? new ControlHabitWeightsV1();
    if (dependencies.restoredExperience) {
      assertNewExperienceOutput(dependencies.restoredExperience.pointerPath, evidence);
      const { snapshot, pointer } = dependencies.restoredExperience;
      assert(pointer.runtimeVersion === KAIROS_V5_RUNTIME_VERSION,
        'legacy-experience-pointer-is-audit-only');
      const isV4 = typeof snapshot === 'object' && snapshot !== null
        && (snapshot as { readonly version?: unknown }).version === DISTRIBUTED_MEMORY_V4_VERSION;
      if (isV4) {
        assertDistributedMemorySnapshotV4(snapshot);
        this.#timescaleV4Enabled = true;
      } else assertDistributedMemorySnapshotV3(snapshot);
      const baseSnapshot: MemorySnapshot = isV4 ? v3SnapshotFromV4(snapshot as MemorySnapshotV4)
        : snapshot as MemorySnapshot;
      this.#actions = pointer.actions;
      this.#events = baseSnapshot.seenEventIds.length; this.#writes = baseSnapshot.writes;
      this.#buffered = Math.min(baseSnapshot.seenEventIds.length, 128);
      this.#map = baseSnapshot.seenEventIds.length >= 128 ? sha(baseSnapshot.r1.projection) : null;
      this.#lastSnapshot = baseSnapshot;
      this.#habitObservationTime = baseSnapshot.activeSeconds;
    }
    let controller: PhysicalControlManagerV2 | null = null;
    this.attention = new AttentionMonitor(this.compute, record, notice => controller?.interrupt(notice),
      event => { this.#pendingPassive.push(event); this.record('passive-event-queued', event); }, body.session.id);
    this.controller = controller = new PhysicalControlManagerV2(this, this, config.control, this.#habit,
      dependencies.controlOptions);
    body.on('frame', frame => this.attention.accept(frame));
  }
  get actions(): number { return this.#actions; }
  get actionCount(): number { return this.#actions; }
  get actionBudget(): number { return this.config.actionBudget; }
  get writes(): number { return this.#writes; }
  get eventCount(): number { return this.#events; }
  get newEventCount(): number { return this.#newEvents; }
  get snapshotForDisplay(): MemorySnapshot | null {
    return this.#lastSnapshot ? structuredClone(this.#lastSnapshot) : null;
  }
  /** The controller and runtime share this exact instance; display uses only exportCheckpoint(). */
  get habitWeights(): ControlHabitWeightsV1 { return this.#habit; }
  get habitCheckpointForDisplay(): ControlHabitCheckpointV1 { return this.#habit.exportCheckpoint(); }
  async commitHabitOutcome(outcome: TrustedRealActionOutcomeV1): Promise<void> {
    const result = this.#habit.applyTrustedRealActionOutcome(outcome);
    this.record('control-habit-real-outcome', { outcome, result });
    if (this.#periodicHabitSavePending) { this.#periodicHabitSavePending = false; await this.save(); }
  }
  get controlFieldForDisplay(): PhysicalControlSnapshotV2 | null {
    const snapshot = this.controller.snapshot;
    return snapshot ? structuredClone(snapshot) : null;
  }
  display(): unknown {
    const attention = this.attention.controller.snapshot();
    return structuredClone({ publicObservation: this.body.latest(), physicalEvents: this.#events,
      sessionPhysicalEvents: this.#newEvents,
      depositedEvents: this.#writes, initializationBuffered: this.#buffered, remainingActions: this.config.actionBudget - this.#actions,
      noveltySignals: this.#noveltySignals,
      physicalMap: this.#map, attention, controlField: this.controller.snapshot,
      controlHabits: this.#habit.exportCheckpoint(), recentRealEvents: this.#recent });
  }
  async observe(): Promise<Observation> {
    this.body.check(); this.attention.check(); const observation = this.body.latest();
    this.#advanceHabitTo(observation.activeSeconds); return structuredClone(observation);
  }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    const observation = await this.body.waitForObservationAfter(sequence);
    this.#advanceHabitTo(observation.activeSeconds); return observation;
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] { return this.body.listActionOffers(observation); }
  describeActionRequirement(actionCue: ActionCue, observation: Observation) {
    return this.body.describeActionRequirement(actionCue, observation);
  }
  async status(): Promise<{ ready: boolean; bufferedEvents: number; writes: number }> {
    return this.compute.call('status');
  }
  async #preparePhysical(observation: Observation): Promise<void> {
    await this.#settleThrough(observation); this.#advanceHabitTo(observation.activeSeconds);
    await this.compute.call('advance', observation.activeSeconds);
  }
  async recallByEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallByEffect', goal, evaluation, observation);
  }
  async recallAtomicEffect(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly EffectRecallCandidateV1[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallAtomicEffect', goal, evaluation, observation);
  }
  async recallContinuousPattern(goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    observation: Observation): Promise<readonly ContinuousPatternRecallV2[]> {
    await this.#preparePhysical(observation);
    return this.compute.call('recallContinuousPattern', goal, evaluation, observation);
  }
  async compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<ConditionApplicabilityV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('compareConditions', candidate, state);
  }
  async compareCurrentFactors(relationId: string, observation: Observation): Promise<ConditionApplicabilityV1> {
    await this.#preparePhysical(observation);
    return this.compute.call('compareCurrentFactors', relationId, observation);
  }
  async compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[], source: { readonly r1Active: boolean; readonly r2Active: boolean }) {
    await this.#preparePhysical(observation);
    return this.compute.call<readonly import('./control/contracts.js').ProjectedParentRelationApplicabilityV1[]>(
      'compareProjectedParentRelations', relationIds, observation, states, source);
  }
  async predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1): Promise<BranchPredictionV1> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('predictCandidate', candidate, state, goal, evaluation);
  }
  async recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    Promise<readonly OpaqueFactorTransitionTraceV1[]> {
    if ('sequence' in state) await this.#preparePhysical(state);
    return this.compute.call('recallFactorTransition', factorIds, state);
  }
  async predictContinuation(patternId: string, exactActionCue: ActionCue,
    observation: Observation): Promise<ContinuationPredictionV2> {
    await this.#preparePhysical(observation);
    return this.compute.call('predictContinuation', patternId, exactActionCue, observation);
  }
  async recordDistributedMatchedIntervention(evidence: DistributedR2AInterventionPairV2): Promise<void> {
    await this.compute.call('recordDistributedMatchedIntervention', evidence);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    this.record('distributed-matched-physical-intervention-recorded', evidence);
  }
  /** Explicit opt-in to the versioned V4 timescale owner. */
  async enableTimescaleV2(): Promise<void> {
    if (this.#timescaleV4Enabled) return;
    await this.compute.enableTimescaleV2();
    this.#timescaleV4Enabled = true;
    this.record('timescale-v4-enabled', { version: DISTRIBUTED_MEMORY_V4_VERSION });
  }
  async recordTrustedRuntimeGoalMeasurement(eventId: string, observedAt: number,
    goalResidualBefore: number, goalResidualAfter: number): Promise<void> {
    if (!this.#timescaleV4Enabled) return;
    assert(!this.#runtimeMeasuredEventIds.has(eventId), 'runtime-measurement-already-recorded');
    const predictionDeviation = this.#eventPredictionDeviations.get(eventId) ?? null;
    const input: TrustedRuntimeMeasurementContextV1 = {
      version: 'TrustedRuntimeMeasurementContextV1', eventId, observedAt,
      goalResidualBefore, goalResidualAfter, predictionDeviation,
    };
    await this.compute.recordRuntimeMeasurement(input);
    this.#eventPredictionDeviations.delete(eventId);
    this.#runtimeMeasuredEventIds.add(eventId);
    this.record('timescale-runtime-measurement', { eventId, observedAt,
      predictionDeviationMagnitude: predictionDeviation?.magnitude ?? 0,
      goalResidualBefore, goalResidualAfter });
  }
  async executeOffer(offer: ActionOfferV1, observationScope: ActionObservationScopeV1): Promise<{ executed: boolean; observation: Observation; eventId: string | null;
    refusal?: 'action-budget-exhausted' | 'offer-stale' | 'target-unavailable' }> {
    if (this.#actions >= this.config.actionBudget) return { executed: false, observation: this.body.latest(), eventId: null,
      refusal: 'action-budget-exhausted' };
    this.body.check(); this.attention.check(); await this.#settleThrough(this.body.latest());
    const current = this.body.latest();
    const rebound = this.body.listActionOffers(current).find(value => cueIdentity(value.cue) === cueIdentity(offer.cue)
      && (offer.action.targetId === undefined || value.action.targetId === offer.action.targetId));
    if (!rebound) return { executed: false, observation: structuredClone(current), eventId: null,
      refusal: offer.action.targetId && !current.objects.some(value => value.id === offer.action.targetId)
        ? 'target-unavailable' : 'offer-stale' };
    this.attention.bindActionTarget(rebound.action.targetId ?? 'self');
    // Freeze internal channels before the body action can produce its outcome.
    const frozenInternalChannels = computeInteroceptiveChannelsV1({
      control: this.controller.snapshot, actions: this.#actions, actionBudget: this.config.actionBudget,
      recentAttentionNotices: this.attention.notices.slice(-16) });
    const execution = await this.body.execute(rebound.action, observationScope);
    if (execution.result.executed) this.#actions++;
    let eventId: string | null = null;
    if (execution.event) {
      this.attention.sealThrough(execution.event.frames.at(-1)!);
      const first = execution.event.frames[0]!, last = execution.event.frames.at(-1)!;
      const attended = this.attention.notices.filter(notice => notice.sequence > first.sequence
        && notice.sequence <= last.sequence).map(notice => notice.subjectId);
      const scopedEvent: RealEvent = { ...execution.event,
        trackedIds: actionObservationTrackedIdsV1(rebound.action.targetId, observationScope, attended,
          execution.event.frames) };
      const event: RealEvent = { ...scopedEvent,
        hierarchyContinuity: realEventHierarchyContinuityV1(scopedEvent, this.body.session.id) };
      await this.#flushPassive(first, true);
      const written = await this.#commitEvent(event, frozenInternalChannels); eventId = event.id;
      const changes = eventRows(event).changes.flat().map(change => ({ ...change,
        observationSequence: event.frames[change.observationIndex]!.sequence,
        activeSeconds: event.frames[change.observationIndex]!.activeSeconds }));
      this.#recent.push({ eventId, action: rebound.action, startSequence: first.sequence, endSequence: last.sequence,
        publicChanges: changes, learning: written }); this.#recent = this.#recent.slice(-8);
    }
    this.body.check(); this.attention.check();
    return { executed: execution.result.executed, observation: structuredClone(this.body.latest()), eventId,
      ...(execution.result.executed ? {} : { refusal: execution.result.status === 'no-target'
        || execution.result.status === 'out-of-reach' ? 'target-unavailable' as const : 'offer-stale' as const }) };
  }
  #passiveSlice(event: RealEvent, start: number, end: number): RealEvent {
    if (start === 0 && end === event.frames.length - 1) return event;
    const frames = event.frames.slice(start, end + 1);
    const unclassified: RealEvent = { ...event,
      id: `${event.id}:frames:${frames[0]!.sequence}-${frames.at(-1)!.sequence}`, frames,
      hierarchyContinuity: undefined };
    const segment: RealEvent = { ...unclassified,
      hierarchyContinuity: realEventHierarchyContinuityV1(unclassified, this.body.session.id) };
    this.record('passive-event-segment', { sourceEventId: event.id, sourceSha256: sha(event), segmentId: segment.id,
      retainedOriginalSequences: frames.map(frame => frame.sequence) }); return segment;
  }
  #uncoveredPassive(event: RealEvent): RealEvent[] {
    const segments: RealEvent[] = []; let start: number | null = null;
    for (let index = 1; index < event.frames.length; index++) {
      const sequence = event.frames[index]!.sequence;
      const covered = this.#learnedChanges.some(range => range.start < sequence && sequence <= range.end);
      if (!covered && start === null) start = index - 1;
      if (covered && start !== null) { segments.push(this.#passiveSlice(event, start, index - 1)); start = null; }
    }
    if (start !== null) segments.push(this.#passiveSlice(event, start, event.frames.length - 1));
    return segments;
  }
  async #settleThrough(observation: Observation): Promise<void> {
    this.attention.sealThrough(observation); await this.#flushPassive(observation, true);
  }
  async #flushPassive(observation: Observation, splitAtCutoff = false): Promise<void> {
    const pending = this.#pendingPassive; this.#pendingPassive = []; const eligible: RealEvent[] = [];
    for (const event of pending) {
      validateEvent(event);
      if (event.frames.at(-1)!.sequence <= observation.sequence && event.frames.at(-1)!.activeSeconds <= observation.activeSeconds) eligible.push(event);
      else {
        const boundary = splitAtCutoff ? event.frames.findIndex(frame => frame.sequence === observation.sequence) : -1;
        if (boundary > 0) { eligible.push(this.#passiveSlice(event, 0, boundary));
          this.#pendingPassive.push(this.#passiveSlice(event, boundary, event.frames.length - 1)); }
        else this.#pendingPassive.push(event);
      }
    }
    eligible.sort((left, right) => left.frames.at(-1)!.activeSeconds - right.frames.at(-1)!.activeSeconds);
    for (const event of eligible) for (const segment of this.#uncoveredPassive(event)) {
      const changes = eventRows(segment).changes.flat();
      if (!changes.some(change => change.before !== change.after)) continue;
      const written = await this.#commitEvent(segment);
      this.#recent.push({ eventId: segment.id, provenance: 'real-passive', changes: changes.slice(-12), learning: written });
      this.#recent = this.#recent.slice(-8);
    }
  }
  async #commitEvent(event: RealEvent,
    internalChannels: readonly VerifiedInternalChannelV1[] = []): Promise<MemoryObservationReceipt> {
    const start = event.frames[0]!.sequence, end = event.frames.at(-1)!.sequence;
    assert(!this.#learnedChanges.some(range => range.start < end && start < range.end), 'real-event-change-already-owned');
    const eventTime = event.frames.at(-1)!.activeSeconds; this.#advanceHabitTo(eventTime);
    const enrichedEvent = attachInteroceptionToEventV1(event, internalChannels);
    this.#beforeObserve?.(this.#newEvents, enrichedEvent); this.record('real-event', enrichedEvent);
    const written = await this.compute.call<MemoryObservationReceipt>('observe', enrichedEvent);
    if (this.#timescaleV4Enabled && event.provenance === 'executed-real-body')
      this.#eventPredictionDeviations.set(event.id, this.#predictionDeviationForEvent(event));
    // The shutdown test intentionally injects the retired audit-only memory
    // backend.  Its historical receipt predates novelty, so keep that test
    // double readable without restoring the retired distributed rejection
    // status to the production contract.
    const novelty: DistributedNoveltyRecordV1 = 'novelty' in written
      && written.novelty !== undefined ? written.novelty
      : { version: 'DistributedNoveltyRecordV1', source: 'trusted-real-event',
        newlyAllocatedSignalCount: 0, newlyAllocatedSignalIds: [], reusedSignalCount: 0 };
    this.#noveltySignals += novelty.newlyAllocatedSignalCount;
    if (novelty.newlyAllocatedSignalCount > 0) {
      const noveltySubject = event.bodyResult?.action.targetId
        ?? event.trackedIds.find(value => value !== 'self') ?? 'self';
      this.attention.noteNovelty([noveltySubject]);
    }
    this.#learnedChanges.push({ start, end }); this.#events++; this.#newEvents++; this.#writes = written.writes;
    this.#buffered = written.buffered; this.#map = written.mapSha256;
    this.record('real-event-committed', { eventId: enrichedEvent.id, provenance: enrichedEvent.provenance,
      observationWindow: [start, end], eventCount: this.#events, novelty, learning: written });
    if (this.#newEvents % 32 === 0) {
      // An executed action's progress signal is computed by the controller after executeOffer returns.
      // Commit CURRENT only after that real result has updated the shared habit instance.
      if (event.provenance === 'executed-real-body') this.#periodicHabitSavePending = true;
      else await this.save();
    }
    return written;
  }
  #predictionDeviationForEvent(event: RealEvent): PredictionViolationMeasurementV1 | null {
    const first = event.frames[0]!.sequence;
    const last = event.frames.at(-1)!.sequence;
    const measurements = this.attention.notices
      .filter(notice => notice.sequence > first && notice.sequence <= last)
      .map(notice => notice.predictionDeviation)
      .filter((value): value is PredictionViolationMeasurementV1 => value !== undefined);
    if (measurements.length === 0) return null;
    if (measurements.length === 1) return structuredClone(measurements[0]!);
    const expectedChangeCount = measurements.reduce((sum, value) => sum + value.expectedChangeCount, 0);
    const missingExpectedChangeCount = measurements.reduce((sum, value) => sum + value.missingExpectedChangeCount, 0);
    const unexpectedChangeCount = measurements.reduce((sum, value) => sum + value.unexpectedChangeCount, 0);
    return { version: 'PredictionViolationMeasurementV1', source: 'attention-physical-comparison',
      expectedChangeCount, missingExpectedChangeCount, unexpectedChangeCount,
      magnitude: Math.min(1, measurements.reduce((sum, value) => sum + value.magnitude, 0)) };
  }
  #advanceHabitTo(activeSeconds: number): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= 0, 'invalid-control-habit-observation-time');
    // A sealed passive window can be committed after a newer public observation. Its elapsed
    // time was already accounted for; never recover the habit twice or move its clock backward.
    if (activeSeconds <= this.#habitObservationTime) return;
    this.#habit.advanceActiveTime(activeSeconds - this.#habitObservationTime); this.#habitObservationTime = activeSeconds;
  }
  async save(): Promise<void> {
    const snapshotV4 = this.#timescaleV4Enabled ? await this.compute.snapshotV4() : null;
    const snapshot = snapshotV4 ? v3SnapshotFromV4(snapshotV4)
      : await this.compute.call<MemorySnapshot>('snapshot');
    this.#lastSnapshot = snapshot;
    const metadata = { actions: this.#actions, eventCount: this.#events, writes: this.#writes };
    if (isRetiredMemorySnapshot(snapshot)) {
      await saveRetiredMemoryAuditBundleV1(this.evidence, snapshot, metadata, this.#habit);
      return;
    }
    if (snapshotV4) await saveExperienceBundleV4(this.evidence, snapshotV4, metadata, this.#habit);
    else await saveExperienceBundleV1(this.evidence, snapshot, metadata, this.#habit);
  }
  async initializeFromRealExploration(): Promise<PhysicalControlResultV2> { return this.controller.initializeFromRealExploration(); }
  async exploreUntil(stopCondition: (observation: Observation) => boolean): Promise<PhysicalControlResultV2> {
    return this.controller.exploreUntil(stopCondition);
  }
  async runGoal(goal: GroundedGoalV1): Promise<PhysicalControlResultV2> { return this.controller.runGoal(goal); }
  async close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closePromise = this.#closeOnce();
    return this.#closePromise;
  }
  async #closeOnce(): Promise<void> {
    try {
      const observation = this.body.latest();
      await this.#settleThrough(observation);
      await this.compute.call('closeContinuity', { version: 'R2EventBoundaryV1',
        completion: 'censored', reason: 'session-ended' });
      // The final checkpoint must include passive facts sealed at shutdown and
      // the explicit R2 session boundary while the memory worker is still live.
      await this.save();
    } finally {
      try { await this.body.close(); }
      finally { await this.compute.close(); }
    }
  }
}
