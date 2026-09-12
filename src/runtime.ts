import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';import { createHash } from 'node:crypto';

import { access, readFile } from 'node:fs/promises';
import type { ActionCue, Observation, RealEvent, VerifiedInternalChannelV1 } from './contracts.js';
import type { Configuration } from './services.js';
import { MinecraftBody } from './body.js';
import { Compute } from './compute.js';
import { AttentionMonitor } from './attention/monitor.js';
import type { PredictionViolationMeasurementV1 } from './attention/prediction-deviation.js';
import { actionObservationTrackedIdsV1, eventRows, cueIdentity, realEventHierarchyContinuityV1,
  validateEvent } from './events.js';
import { assert, saveJson, sha } from './util.js';
import { canonicalStreamMetrics, SEGMENTED_SNAPSHOT_FORMAT_V1,
  type CanonicalPagedNodeV1, type SegmentedCanonicalManifestV1 } from './util-stream.js';
import { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3, DISTRIBUTED_HIERARCHY_SEMANTICS_V2,
  type DistributedMemoryObservationReceiptV1 as MemoryObservationReceipt,
  type DistributedMemorySnapshotV3 as MemorySnapshot,
  type KairosV5DistributedPhysicalMemoryV4 as MemorySnapshotV4 } from './distributed-hierarchical-memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalReasoningPortV3, PhysicalPredictionBindingV1, PhysicalShortChainV1, ContinuationPredictionV2, ContinuousPatternRecallV2 } from './control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2, type PhysicalControlResultV2,
  type PhysicalControlSnapshotV2 } from './control/controller.js';
import { ControlHabitWeightsV1, type ControlHabitCheckpointV1, type TrustedRealActionOutcomeV1 } from './control/habit.js';
import { attachInteroceptionToEventV1, computeInteroceptiveChannelsV1 } from './control/interoception.js';
import type { DistributedR2AInterventionPairV2 }
  from './core/learning/distributed-r2a-physical-contracts.js';
import type { TrustedAttractorPublicObservationV1, AttractorDictionaryResolutionV1 }
  from './core/learning/attractor-public-dictionary.js';
import type { TrustedInterventionWindowV1, InterventionPairCandidateV1 }
  from './core/learning/intervention-pair-collector.js';
import type { DistributedAttractorReadoutV1 }
  from './core/physics/distributed-physical-contracts.js';
import type { PredictionViolationV1, MatchedArmResultV1, FactorialCellV1,
  ViolationLedgerRecordV1, InterventionArmRequestV1 } from './core/learning/intervention-agenda.js';
import type { DistributedNoveltyRecordV1 }
  from './core/learning/distributed-r1-contracts.js';
import type { TrustedRuntimeMeasurementContextV1 }
  from './core/physics/runtime-measured-salience-bridge-v1.js';
import { KAIROS_V5_RUNTIME_VERSION } from './core/compatibility.js';
import { assertDistributedMemorySnapshotV3, assertDistributedMemorySnapshotV4, v3SnapshotFromV4,
  DISTRIBUTED_MEMORY_V4_VERSION } from './experience-snapshot-contract.js';
import type { MediaPageRequestV1, MediaPageResultV1, SerializedSnapshotBundleV1,
  SnapshotMediaStatisticsV1 } from './compute.js';

export interface ExperiencePointer {
  /** Untrusted on-disk discriminator. Production validates the exact V2 value before use. */
  readonly runtimeVersion: string;
  readonly sourceContextVersion: typeof PUBLIC_LAYOUT_SEMANTICS;
  readonly filename: string; readonly sha256: string;
  /** Present when the snapshot is stored as a segmented manifest bundle (PLAN-008). */
  readonly manifestSha256?: string;
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
 * Lossless evidence reference for a queued passive event (PLAN-005 1.3).  The
 * full frames already live in frames.jsonl under the same session; this record
 * keeps every event field except the duplicated frame array and binds the
 * referenced sequence range with a hash of the complete event.
 */
export function passiveEventReferenceV1(event: RealEvent, sessionId: string) {
  assert(event.frames.length > 0, 'passive-event-without-frames');
  const first = event.frames[0]!, last = event.frames.at(-1)!;
  const { frames: _frames, ...metadata } = event;
  return { ...metadata, sessionId, frameCount: event.frames.length,
    frameSequenceStart: first.sequence, frameSequenceEnd: last.sequence,
    frameActiveSecondsStart: first.activeSeconds, frameActiveSecondsEnd: last.activeSeconds,
    eventSha256: sha(event) };
}



export function assertNewExperienceOutput(pointerPath: string | null, outputDirectory: string): void {
  if (pointerPath === null) return;
  const path = relative(dirname(pointerPath), resolve(outputDirectory));
  assert(isAbsolute(path) || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    'experience-source-directory-is-read-only');
}

/** Result of loading a snapshot bundle from disk, in either on-disk format. */
interface LoadedSnapshotBundle {
  readonly snapshot: unknown;
  readonly segmented: boolean;
  /** Hash of the manifest file's canonical text (segmented format only). */
  readonly manifestSha256: string | null;
}

/**
 * PLAN-008 1.2: load a snapshot file in either format.  A single-file
 * snapshot parses directly (old checkpoints stay read-only restorable
 * forever).  A segmented bundle parses its small manifest, then reads each
 * canonical segment, verifying the per-segment byte/hash chain before the
 * reassembled object is handed back; the caller re-verifies the full
 * canonical hash against the pointer exactly as for a single file.
 */
export async function loadSnapshotFromDisk(snapshotPath: string): Promise<LoadedSnapshotBundle> {
  const raw = await readFile(snapshotPath);
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || (parsed as { readonly format?: unknown }).format !== SEGMENTED_SNAPSHOT_FORMAT_V1)
    return { snapshot: parsed, segmented: false, manifestSha256: null };
  const manifest = parsed as SegmentedCanonicalManifestV1;
  assert(typeof manifest.snapshotVersion === 'string' && manifest.snapshotVersion.length > 0
    && Array.isArray(manifest.segments) && manifest.segments.length > 0
    && /^[a-f0-9]{64}$/.test(manifest.sha256)
    && Number.isSafeInteger(manifest.canonicalBytes) && manifest.canonicalBytes > 0
    && Number.isSafeInteger(manifest.eventCount) && manifest.eventCount >= 0
    && Number.isSafeInteger(manifest.writes) && manifest.writes >= 0,
  'invalid-snapshot-manifest');
  const stem = basename(snapshotPath).replace(/\.json$/, '');
  assert(stem !== basename(snapshotPath), 'invalid-snapshot-manifest');
  const segmentsDirectory = resolve(dirname(snapshotPath), `${stem}.segments`);
  const snapshot: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const segment of manifest.segments) {
    assert(typeof segment.name === 'string' && /^[A-Za-z0-9]+$/.test(segment.name)
      && segment.filename === `${segment.name}.json`
      && /^[a-f0-9]{64}$/.test(segment.sha256)
      && Number.isSafeInteger(segment.bytes) && segment.bytes > 1,
    'invalid-snapshot-segment-entry');
    assert(!seen.has(segment.name), 'duplicate-snapshot-segment');
    seen.add(segment.name);
    // PLAN-008b: a paged segment has no single file; reassemble its value from
    // the recursive leaf tree, then verify the section hash by streaming the
    // reassembled value (no oversized string is ever materialized).
    if (segment.paged !== undefined) {
      const readPagedNode = async (node: CanonicalPagedNodeV1, depth: number): Promise<unknown> => {
        assert(depth <= 64, 'snapshot-paged-node-too-deep');
        if (node.kind === 'leaf') {
          assert(new RegExp(`^${segment.name}\\.p-\\d{6}\\.json$`).test(node.filename)
            && /^[a-f0-9]{64}$/.test(node.sha256)
            && Number.isSafeInteger(node.bytes) && node.bytes > 1, 'invalid-snapshot-page-entry');
          const pageRaw = await readFile(resolve(segmentsDirectory, node.filename));
          assert(pageRaw.length === node.bytes && pageRaw.at(-1) === 0x0a
            && createHash('sha256').update(pageRaw.subarray(0, -1)).digest('hex') === node.sha256,
          'snapshot-page-invalid');
          return JSON.parse(pageRaw.subarray(0, -1).toString('utf8'));
        }
        if (node.kind === 'array') {
          const merged: unknown[] = [];
          assert(Array.isArray(node.children), 'invalid-snapshot-page-entry');
          for (const { count, child } of node.children) {
            assert(Number.isSafeInteger(count) && count >= 1, 'invalid-snapshot-page-entry');
            const value = await readPagedNode(child, depth + 1);
            if (child.kind === 'leaf') {
              assert(Array.isArray(value) && value.length === count, 'snapshot-page-count-mismatch');
              merged.push(...value);
            } else {
              assert(count === 1, 'snapshot-page-count-mismatch');
              merged.push(value);
            }
          }
          return merged;
        }
        assert(node.kind === 'object' && Array.isArray(node.children), 'invalid-snapshot-page-entry');
        const merged: Record<string, unknown> = {};
        for (const { keys, child } of node.children) {
          assert(Array.isArray(keys) && keys.length >= 1, 'invalid-snapshot-page-entry');
          const value = await readPagedNode(child, depth + 1);
          if (child.kind === 'leaf') {
            assert(typeof value === 'object' && value !== null && !Array.isArray(value),
              'snapshot-page-kind-mismatch');
            const leafKeys = Object.keys(value as Record<string, unknown>);
            assert(leafKeys.length === keys.length
              && leafKeys.slice().sort((left, right) => left.localeCompare(right, 'en'))
                .every((key, index) => key === keys[index]), 'snapshot-page-keys-mismatch');
            for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
              assert(!(key in merged), 'snapshot-page-duplicate-key');
              merged[key] = entryValue;
            }
          } else {
            assert(keys.length === 1, 'snapshot-page-keys-mismatch');
            assert(!(keys[0]! in merged), 'snapshot-page-duplicate-key');
            merged[keys[0]!] = value;
          }
        }
        return merged;
      };
      const value = await readPagedNode(segment.paged, 0);
      assert(canonicalStreamMetrics(value).sha256 === segment.sha256, 'snapshot-segment-invalid');
      snapshot[segment.name] = value;
      continue;
    }
    const segmentRaw = await readFile(resolve(segmentsDirectory, segment.filename));
    assert(segmentRaw.length === segment.bytes && segmentRaw.at(-1) === 0x0a
      && createHash('sha256').update(segmentRaw.subarray(0, -1)).digest('hex') === segment.sha256,
    'snapshot-segment-invalid');
    snapshot[segment.name] = JSON.parse(segmentRaw.toString('utf8'));
  }
  const manifestSha256 = raw.at(-1) === 0x0a
    ? createHash('sha256').update(raw.subarray(0, -1)).digest('hex')
    : createHash('sha256').update(raw).digest('hex');
  return { snapshot, segmented: true, manifestSha256 };
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
  const loaded = await loadSnapshotFromDisk(snapshotPath);
  const snapshot = loaded.snapshot;
  assert(loaded.segmented === (pointer.manifestSha256 !== undefined), 'experience-manifest-mismatch');
  if (loaded.segmented)
    assert(pointer.manifestSha256 === loaded.manifestSha256, 'experience-manifest-invalid');
  assertDistributedMemorySnapshotV3(snapshot);
  assert(canonicalStreamMetrics(snapshot).sha256 === pointer.sha256, 'experience-snapshot-invalid');
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
  const loaded = await loadSnapshotFromDisk(snapshotPath);
  const snapshot = loaded.snapshot;
  assert(loaded.segmented === (pointer.manifestSha256 !== undefined), 'experience-manifest-mismatch');
  if (loaded.segmented)
    assert(pointer.manifestSha256 === loaded.manifestSha256, 'experience-manifest-invalid');
  assertDistributedMemorySnapshotV4(snapshot);
  assert(canonicalStreamMetrics(snapshot).sha256 === pointer.sha256, 'experience-snapshot-invalid');
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

export class V5Runtime implements PhysicalReasoningPortV3, PhysicalControlEnvironmentV2 {
  readonly compute: Compute;
  readonly attention: AttentionMonitor;
  readonly controller: PhysicalControlManagerV2;
  readonly #habit: ControlHabitWeightsV1;
  #timescaleV4Enabled = false;
  #recent: unknown[] = [];
  #actions = 0; #events = 0; #newEvents = 0; #writes = 0; #buffered = 0; #noveltySignals = 0; #restoredActionBase = 0;
  #map: string | null = null;
  #lastSnapshot: MemorySnapshot | null = null;
  // The revision/media statistics of the last worker-serialized checkpoint, for the bounded dashboard.
  #lastSnapshotRevision: string | null = null;
  #lastMediaStatistics: SnapshotMediaStatisticsV1 | null = null;
  readonly #snapshotEveryEvents: number;
  readonly #segmentThresholdBytes: number;
  readonly #mediaStatisticsWanted: boolean;
  // Checkpoint writes are serialized so a watchdog-initiated protective
  // checkpoint can never interleave with an in-flight periodic or final one.
  #saveChain: Promise<void> = Promise.resolve();
  // Passive flush/commit/advance form one critical section: concurrent reasoning
  // calls (e.g. Promise.all'ed recalls) must never advance memory time past a
  // passive event whose commit is still in flight.  (Found by the PLAN-005 soak.)
  #physicalIngress: Promise<void> = Promise.resolve();
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
      controlOptions?: { readonly requirePredictionProgress?: boolean };
      /** Set when a dashboard will poll this run; worker then adds per-medium statistics at save time. */
      mediaStatistics?: boolean } = {}) {
    this.compute = dependencies.compute ?? new Compute(); this.#beforeObserve = dependencies.beforeObserve;
    this.#snapshotEveryEvents = config.evidence?.snapshotEveryEvents ?? 32;
    this.#segmentThresholdBytes = config.evidence?.segmentThresholdBytes ?? 256 * 1024 * 1024;
    this.#mediaStatisticsWanted = dependencies.mediaStatistics ?? true;
    assert(Number.isSafeInteger(this.#snapshotEveryEvents) && this.#snapshotEveryEvents > 0,
      'invalid-snapshot-interval');
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
      this.#actions = pointer.actions; this.#restoredActionBase = pointer.actions;
      this.#events = baseSnapshot.seenEventIds.length; this.#writes = baseSnapshot.writes;
      this.#buffered = Math.min(baseSnapshot.seenEventIds.length, 128);
      this.#map = baseSnapshot.seenEventIds.length >= 128 ? sha(baseSnapshot.r1.projection) : null;
      this.#lastSnapshot = baseSnapshot;
      this.#lastSnapshotRevision = `${baseSnapshot.seenEventIds.length}:${baseSnapshot.writes}`;
      this.#habitObservationTime = baseSnapshot.activeSeconds;
    }
    let controller: PhysicalControlManagerV2 | null = null;
    this.attention = new AttentionMonitor(this.compute, record, notice => controller?.interrupt(notice),
      event => { this.#pendingPassive.push(event);
        this.record('passive-event-queued', passiveEventReferenceV1(event, body.session.id)); }, body.session.id,
      { recordEveryWindows: config.evidence?.attentionRecordEveryWindows ?? 20,
        scoreEpsilon: config.evidence?.attentionScoreEpsilon ?? .1 });
    this.controller = controller = new PhysicalControlManagerV2(this, this, config.control, this.#habit,
      dependencies.controlOptions);
    body.on('frame', frame => { this.controller.acceptPublicFeedback(frame); this.attention.accept(frame); });
  }
  get actions(): number { return this.#actions; }
  get actionCount(): number { return this.#actions - this.#restoredActionBase; }
  get actionBudget(): number { return this.config.actionBudget; }
  get writes(): number { return this.#writes; }
  get eventCount(): number { return this.#events; }
  get newEventCount(): number { return this.#newEvents; }
  get snapshotForDisplay(): MemorySnapshot | null {
    return this.#lastSnapshot ? structuredClone(this.#lastSnapshot) : null;
  }
  /**
   * Bounded dashboard projection (PLAN-005 1.1): runtime counters and small
   * live views only.  It never clones media; unbounded snapshot-derived
   * structures are reported as entry counts.
   */
  displaySummary(): unknown {
    const attention = this.attention.controller.snapshot();
    let publicObservation: Observation | null = null;
    try { publicObservation = this.body.latest(); } catch { /* a disconnected body still serves counters */ }
    return structuredClone({ publicObservation, physicalEvents: this.#events,
      sessionPhysicalEvents: this.#newEvents,
      depositedEvents: this.#writes, initializationBuffered: this.#buffered,
      remainingActions: this.config.actionBudget - (this.#actions - this.#restoredActionBase),
      noveltySignals: this.#noveltySignals,
      physicalMap: this.#map, attention,
      computeQueue: this.compute.performanceAudit(),
      attractorDictionaryEntries: this.#lastSnapshot?.attractorDictionary?.entries.length ?? null,
      interventionAgendaViolations: this.#lastSnapshot?.interventionAgenda?.violations.length ?? null,
      interventionAgendaCells: this.#lastSnapshot?.interventionAgenda?.cells.length ?? null,
      controlHabits: this.#habit.exportCheckpoint(), recentRealEvents: this.#recent });
  }
  /** Media statistics of the last worker-serialized checkpoint (bounded; revision-labelled). */
  get mediaStatisticsForDisplay(): { readonly revision: string;
    readonly media: SnapshotMediaStatisticsV1 } | null {
    return this.#lastSnapshotRevision !== null && this.#lastMediaStatistics !== null
      ? { revision: this.#lastSnapshotRevision, media: structuredClone(this.#lastMediaStatistics) } : null;
  }
  /** Bounded media slice from the worker-retained last saved snapshot. */
  async mediaPageForDisplay(request: MediaPageRequestV1): Promise<MediaPageResultV1> {
    return this.compute.mediaPage(request);
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
      depositedEvents: this.#writes, initializationBuffered: this.#buffered, remainingActions: this.config.actionBudget - (this.#actions - this.#restoredActionBase),
      noveltySignals: this.#noveltySignals,
      physicalMap: this.#map, attention, controlField: this.controller.snapshot,
      computeQueue: this.compute.performanceAudit(),
      attractorDictionary: this.#lastSnapshot?.attractorDictionary ?? null,
      interventionAgenda: this.#lastSnapshot?.interventionAgenda ?? null,
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
  #serializePhysicalIngress<T>(section: () => Promise<T>): Promise<T> {
    const run = this.#physicalIngress.then(section);
    this.#physicalIngress = run.then(() => {}, () => {});
    return run;
  }
  async #preparePhysical(observation: Observation): Promise<void> {
    await this.#serializePhysicalIngress(async () => {
      await this.#settleThrough(observation); this.#advanceHabitTo(observation.activeSeconds);
      await this.compute.call('advance', observation.activeSeconds);
    });
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
  async predictShortChain(candidates: readonly EffectRecallCandidateV1[], observation: Observation,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1): Promise<PhysicalShortChainV1> {
    await this.#preparePhysical(observation);
    return this.compute.call('predictShortChain', candidates, observation, goal, evaluation);
  }
  async physicalVersion(): Promise<string> { return this.compute.call('physicalVersion'); }
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
  async recordAttractorPublicObservation(evidence: TrustedAttractorPublicObservationV1): Promise<void> {
    await this.compute.recordAttractorPublicObservation(evidence);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    this.record('attractor-public-dictionary-observation', { sourceEventId: evidence.sourceEventId });
  }
  async resolveAttractorPublicReadout(mediumVersion: string,
    readout: DistributedAttractorReadoutV1): Promise<AttractorDictionaryResolutionV1> {
    return this.compute.resolveAttractorPublicReadout(mediumVersion, readout);
  }
  async recordPredictionViolation(value: PredictionViolationV1): Promise<ViolationLedgerRecordV1 | null> {
    const result = await this.compute.recordPredictionViolation(value);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    return result;
  }
  async recordFactorialArm(value: MatchedArmResultV1): Promise<FactorialCellV1> {
    const result = await this.compute.recordFactorialArm(value);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    return result;
  }
  async pendingInterventionArmRequests(): Promise<readonly InterventionArmRequestV1[]> {
    return this.compute.pendingInterventionArmRequests();
  }
  async recordInterventionWindow(value: TrustedInterventionWindowV1): Promise<readonly InterventionPairCandidateV1[]> {
    const result = await this.compute.recordInterventionWindow(value);
    this.#lastSnapshot = await this.compute.call<MemorySnapshot>('snapshot');
    return result;
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
  async executeOffer(offer: ActionOfferV1, observationScope: ActionObservationScopeV1,
    predictionBinding?: PhysicalPredictionBindingV1): Promise<{ executed: boolean; observation: Observation; eventId: string | null;
    refusal?: 'action-budget-exhausted' | 'offer-stale' | 'target-unavailable' | 'prediction-stale' }> {
    if (this.#actions - this.#restoredActionBase >= this.config.actionBudget) return { executed: false, observation: this.body.latest(), eventId: null,
      refusal: 'action-budget-exhausted' };
    this.body.check(); this.attention.check();
    await this.#serializePhysicalIngress(() => this.#settleThrough(this.body.latest()));
    if (predictionBinding && predictionBinding.mediumVersion !== await this.physicalVersion())
      return { executed: false, observation: structuredClone(this.body.latest()), eventId: null, refusal: 'prediction-stale' };
    const current = this.body.latest();
    if (predictionBinding && predictionBinding.observationIdentity !== sha({ self: current.self,
      objects: current.objects, targetId: current.targetId }))
      return { executed: false, observation: structuredClone(current), eventId: null, refusal: 'prediction-stale' };
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
      const written = await this.#serializePhysicalIngress(async () => {
        await this.#flushPassive(first, true);
        return this.#commitEvent(event, frozenInternalChannels);
      });
      eventId = event.id;
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
    if (this.#timescaleV4Enabled) {
      const predictionDeviation = this.#predictionDeviationForEvent(event);
      if (event.provenance === 'executed-real-body') {
        // The controller submits the action's goal measurement after it has
        // computed the residual change. Keeping this pending avoids consuming
        // the same event twice.
        this.#eventPredictionDeviations.set(event.id, predictionDeviation);
      } else {
        // Passive windows have no body result or goal residual. Their only
        // salience input is an attention measurement from the same sealed
        // window, so consume it immediately after the event deposit.
        await this.compute.recordRuntimeMeasurement({
          version: 'TrustedRuntimeMeasurementContextV1', eventId: event.id,
          observedAt: eventTime, goalResidualBefore: 0, goalResidualAfter: 0,
          predictionDeviation,
        });
        this.record('timescale-passive-measurement', { eventId: event.id,
          observedAt: eventTime, predictionDeviationMagnitude: predictionDeviation?.magnitude ?? 0 });
      }
    }
    const novelty = written.novelty;
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
    if (this.#newEvents % this.#snapshotEveryEvents === 0) {
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
    const pending = this.#saveChain.then(() => this.#saveOnce());
    this.#saveChain = pending.catch(() => {}); // a failed save must not poison the chain for the final checkpoint
    return pending;
  }
  /**
   * PLAN-005 1.2: canonical serialization and hashing run inside the compute
   * worker; the main thread only awaits the envelope and writes its bytes.
   * The fail-closed bundle assertions (event/write counts, protocol ownership,
   * CURRENT committed last) are unchanged; they now bind the worker-serialized
   * envelope instead of a main-thread snapshot copy.  #lastSnapshot keeps its
   * established meaning: the latest full snapshot mirrored for display, still
   * refreshed at restore and at every evidence-grade control write; the
   * checkpoint path no longer pays a full cross-thread clone.
   */
  async #saveOnce(): Promise<void> {
    const suffix = this.#events.toString().padStart(4, '0');
    const filename = `experience-${suffix}.json`;
    const bundle = await this.compute.call<SerializedSnapshotBundleV1>('snapshotBundle',
      { directory: this.evidence, filename, includeMediaStatistics: this.#mediaStatisticsWanted,
        segmentThresholdBytes: this.#segmentThresholdBytes,
        ...(this.config.evidence?.segmentLimitBytes !== undefined
          ? { segmentLimitBytes: this.config.evidence.segmentLimitBytes } : {}),
        ...(this.config.evidence?.segmentPageLimitBytes !== undefined
          ? { segmentPageLimitBytes: this.config.evidence.segmentPageLimitBytes } : {}) });
    const metadata = { actions: this.#actions, eventCount: this.#events, writes: this.#writes };
    assert(bundle.kind === 'serialized-snapshot-bundle', 'invalid-experience-bundle-kind');
    assert(Number.isSafeInteger(metadata.actions) && metadata.actions >= 0, 'invalid-experience-actions');
    assert(Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0
      && metadata.eventCount === bundle.eventCount, 'experience-event-count-mismatch');
    assert(Number.isSafeInteger(metadata.writes) && metadata.writes >= 0
      && metadata.writes === bundle.writes, 'experience-write-count-mismatch');
    assert((bundle.memoryVersion === DISTRIBUTED_MEMORY_V4_VERSION) === this.#timescaleV4Enabled,
      'experience-bundle-version-mismatch');
    if (bundle.memoryVersion === DISTRIBUTED_MEMORY_V4_VERSION)
      assert(typeof bundle.timescaleLawIdentitySha256 === 'string'
        && /^[a-f0-9]{64}$/.test(bundle.timescaleLawIdentitySha256),
      'invalid-timescale-law-identity');
    await assertCurrentBundleProtocol(this.evidence, this.#timescaleV4Enabled ? 'v4' : 'v3');
    const habitFilename = `control-habit-${suffix}.json`;
    const habitCheckpoint = this.#habit.exportCheckpoint();
    await saveJson(resolve(this.evidence, habitFilename), habitCheckpoint);
    const pointer: ExperiencePointer = { runtimeVersion: KAIROS_V5_RUNTIME_VERSION,
      sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename, sha256: bundle.sha256,
      habitFilename, habitSha256: sha(habitCheckpoint), ...metadata,
      ...(bundle.manifestSha256 !== undefined ? { manifestSha256: bundle.manifestSha256 } : {}),
      ...(bundle.memoryVersion === DISTRIBUTED_MEMORY_V4_VERSION
        ? { memoryVersion: bundle.memoryVersion,
          timescaleLawIdentitySha256: bundle.timescaleLawIdentitySha256! } : {}) };
    // CURRENT is committed last, so it never names only one half of a bundle.
    await saveJson(resolve(this.evidence, 'EXPERIENCE_LATEST.json'), pointer);
    this.#lastSnapshotRevision = bundle.revision;
    this.#lastMediaStatistics = bundle.mediaStatistics;
    this.record('experience-snapshot-serialized', { eventCount: metadata.eventCount,
      writes: metadata.writes, revision: bundle.revision, sha256: bundle.sha256,
      canonicalBytes: bundle.canonicalBytes, serializeMs: bundle.serializeMs,
      format: bundle.format, ...(bundle.segmentCount !== undefined
        ? { manifestSha256: bundle.manifestSha256, segmentCount: bundle.segmentCount } : {}),
      mediaStatistics: bundle.mediaStatistics !== null });
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
      // PLAN-005 1.5: a disconnected body must not cost the run its passive
      // flush or final checkpoint.  latest() throws after a connection fault,
      // but the last received frame is still a valid seal boundary.
      let observation: Observation | null = null;
      try { observation = this.body.latest(); }
      catch (error) {
        const frames = (this.body as { readonly frames?: readonly Observation[] }).frames;
        observation = frames?.at(-1) ?? null;
        if (observation === null) throw error;
        this.record('close-uses-retained-frame', { message: (error as Error).message });
      }
      await this.#serializePhysicalIngress(async () => {
        await this.#settleThrough(observation);
        await this.compute.call('closeContinuity', { version: 'R2EventBoundaryV1',
          completion: 'censored', reason: 'session-ended' });
      });
      // The final checkpoint must include passive facts sealed at shutdown and
      // the explicit R2 session boundary while the memory worker is still live.
      await this.save();
    } finally {
      try { await this.body.close(); }
      finally { await this.compute.close(); }
    }
  }
}
