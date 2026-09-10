import { parentPort } from 'node:worker_threads';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 as PhysicalMemory,
  type DistributedMemorySnapshotV3 as MemorySnapshot,
  type KairosV5DistributedPhysicalMemoryV4 as MemorySnapshotV4 } from './distributed-hierarchical-memory.js';
import type { DistributedLayerMeasurementsV1 }
  from './core/physics/distributed-hierarchical-timescale-owner-v1.js';
import type { TrustedRuntimeMeasurementContextV1 }
  from './core/physics/runtime-measured-salience-bridge-v1.js';
import type { ActionCue, DesiredChange, Observation, RealEvent } from './contracts.js';
import type { EffectRecallCandidateV1, GroundedGoalV1, GoalEvaluationV1,
  HypotheticalPublicStateV1 } from './control/contracts.js';
import { assert, sha } from './util.js';
import { canonicalStreamSha256, writeCanonicalFileSync, writeSegmentedCanonicalFileSync }
  from './util-stream.js';
import { assertDistributedMemorySnapshotV3, assertDistributedMemorySnapshotV4,
  DISTRIBUTED_MEMORY_V4_VERSION } from './experience-snapshot-contract.js';
import type { MediaPageRequestV1, MediaPageResultV1, MediumStatisticsV1,
  SerializedSnapshotBundleV1, SnapshotBundleRequestV1 } from './compute.js';
import type { DistributedMediumSnapshotV1 } from './core/physics/distributed-physical-contracts.js';
import { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } from './distributed-hierarchical-memory.js';
import type { DistributedAttractorReadoutV1 } from './core/physics/distributed-physical-contracts.js';
import type { TrustedAttractorPublicObservationV1 } from './core/learning/attractor-public-dictionary.js';
import type { PredictionViolationV1, MatchedArmResultV1 } from './core/learning/intervention-agenda.js';
import type { TrustedInterventionWindowV1 } from './core/learning/intervention-pair-collector.js';

let memory = new PhysicalMemory();
let timescaleV4Enabled = false;
/** The last snapshot the worker serialized (or restored), retained so the
 * dashboard can page bounded media slices without another full transfer. */
let lastSerializedSnapshot: { readonly revision: string;
  readonly snapshot: MemorySnapshot | MemorySnapshotV4 } | null = null;

function mediumStatisticsV1(medium: DistributedMediumSnapshotV1): MediumStatisticsV1 {
  let activeSiteCount = 0;
  for (const site of medium.sites)
    if (site.potentialDepth > 1e-7 || Math.abs(site.activation) > 1e-7) activeSiteCount++;
  return { siteCount: medium.sites.length, activeSiteCount,
    learnedBondCount: medium.learnedBonds.length, localBondCount: medium.localBondCount,
    bindingCount: medium.bindings.length, footprintCount: medium.footprints.length,
    logicalTime: medium.logicalTime, allocationSequence: medium.allocationSequence,
    metropolisSequence: medium.metropolisSequence, sha256: sha(medium) };
}

/**
 * PLAN-008: full snapshot validation + streaming canonical write + hashing,
 * entirely worker-side.  The snapshot never becomes one large string: at or
 * below the threshold it streams to a single canonical file; above it the
 * writer switches to the segmented format (manifest + one canonical file per
 * top-level key).  Only the small envelope crosses the thread boundary.
 */
function snapshotBundle(request: SnapshotBundleRequestV1): SerializedSnapshotBundleV1 {
  assert(typeof request === 'object' && request !== null
    && typeof request.directory === 'string' && request.directory.length > 0
    && /^experience-\d+\.json$/.test(request.filename)
    && Number.isSafeInteger(request.segmentThresholdBytes) && request.segmentThresholdBytes > 0
    && (request.segmentLimitBytes === undefined || Number.isSafeInteger(request.segmentLimitBytes)
      && request.segmentLimitBytes > 0)
    && (request.segmentPageLimitBytes === undefined
      || Number.isSafeInteger(request.segmentPageLimitBytes) && request.segmentPageLimitBytes > 0),
  'invalid-snapshot-bundle-request');
  const snapshot = timescaleV4Enabled ? memory.snapshotV4() : memory.snapshot();
  if (timescaleV4Enabled) assertDistributedMemorySnapshotV4(snapshot);
  else assertDistributedMemorySnapshotV3(snapshot);
  const started = performance.now();
  const mediaStatistics = request.includeMediaStatistics
    ? { r1: mediumStatisticsV1(snapshot.r1Medium), r2: mediumStatisticsV1(snapshot.r2Medium),
      r2a: mediumStatisticsV1(snapshot.r2a.medium) }
    : null;
  const single = writeCanonicalFileSync(resolve(request.directory, request.filename), snapshot,
    { limitBytes: request.segmentThresholdBytes });
  let format: 'single-file' | 'segmented', sha256: string, canonicalBytes: number,
    manifestSha256: string | undefined, segmentCount: number | undefined;
  if (single.completed && single.sha256 !== null) {
    format = 'single-file'; sha256 = single.sha256; canonicalBytes = single.bytes - 1;
  } else {
    const segmented = writeSegmentedCanonicalFileSync(request.directory, request.filename,
      snapshot as unknown as Record<string, unknown>,
      { ...(request.segmentLimitBytes !== undefined
          ? { segmentLimitBytes: request.segmentLimitBytes } : {}),
        ...(request.segmentPageLimitBytes !== undefined
          ? { pageLimitBytes: request.segmentPageLimitBytes } : {}) });
    format = 'segmented'; sha256 = segmented.manifest.sha256;
    canonicalBytes = segmented.manifest.canonicalBytes;
    manifestSha256 = segmented.manifestSha256;
    segmentCount = segmented.manifest.segments.length;
  }
  const serializeMs = performance.now() - started;
  const revision = `${snapshot.seenEventIds.length}:${snapshot.writes}`;
  lastSerializedSnapshot = { revision, snapshot };
  return { kind: 'serialized-snapshot-bundle',
    memoryVersion: timescaleV4Enabled ? DISTRIBUTED_MEMORY_V4_VERSION : DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
    revision, filename: request.filename, format, canonicalBytes, sha256,
    ...(manifestSha256 !== undefined ? { manifestSha256, segmentCount: segmentCount! } : {}),
    eventCount: snapshot.seenEventIds.length, writes: snapshot.writes, serializeMs,
    mediaStatistics,
    ...(timescaleV4Enabled
      ? { timescaleLawIdentitySha256: (snapshot as MemorySnapshotV4).timescales.r1.lawIdentitySha256 }
      : {}) };
}

function mediaPage(request: MediaPageRequestV1): MediaPageResultV1 {
  assert(typeof request === 'object' && request !== null
    && (request.medium === 'r1' || request.medium === 'r2' || request.medium === 'r2a')
    && Number.isSafeInteger(request.offset) && request.offset >= 0
    && Number.isSafeInteger(request.limit) && request.limit >= 1 && request.limit <= 4096,
  'invalid-media-page-request');
  const retained = lastSerializedSnapshot;
  if (retained === null)
    return { revision: null, medium: request.medium, totalSites: 0,
      offset: request.offset, limit: request.limit, sites: [] };
  const medium = request.medium === 'r1' ? retained.snapshot.r1Medium
    : request.medium === 'r2' ? retained.snapshot.r2Medium : retained.snapshot.r2a.medium;
  const sites = medium.sites.slice(request.offset, request.offset + request.limit)
    .map(site => ({ siteId: site.siteId, coordinate: site.coordinate,
      activation: site.activation, potentialDepth: site.potentialDepth }));
  return { revision: retained.revision, medium: request.medium, totalSites: medium.sites.length,
    offset: request.offset, limit: request.limit, sites };
}
parentPort!.on('message', (message: { id: number; method: string; args: unknown[] }) => {
  try {
    const args = message.args; let value: unknown;
    switch (message.method) {
      case 'observe': value = memory.observe(args[0] as RealEvent); break;
      case 'advance': memory.advanceTo(args[0] as number); value = null; break;
      case 'recall': value = memory.recall(args[0] as DesiredChange, args[1] as Observation, args[2] as number); break;
      case 'predict': value = memory.predict(args[0] as ActionCue, args[1] as Observation, args[2] as Parameters<PhysicalMemory['predict']>[2]); break;
      case 'recallByEffect': value = memory.recallByEffect(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'recallAtomicEffect': value = memory.recallAtomicEffect(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'recallContinuousPattern': value = memory.recallContinuousPattern(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'compareConditions': value = memory.compareConditions(args[0] as EffectRecallCandidateV1,
        args[1] as Observation | HypotheticalPublicStateV1); break;
      case 'predictCandidate': value = memory.predictCandidate(args[0] as EffectRecallCandidateV1,
        args[1] as Observation | HypotheticalPublicStateV1, args[2] as GroundedGoalV1,
        args[3] as GoalEvaluationV1); break;
      case 'predictShortChain': value = memory.predictShortChain(args[0] as readonly EffectRecallCandidateV1[],
        args[1] as Observation, args[2] as GroundedGoalV1, args[3] as GoalEvaluationV1); break;
      case 'physicalVersion': value = memory.physicalVersion(); break;
      case 'recallFactorTransition': value = memory.recallFactorTransition(args[0] as readonly string[],
        args[1] as Observation | HypotheticalPublicStateV1); break;
      case 'compareCurrentFactors': value = memory.compareCurrentFactors(args[0] as string,
        args[1] as Observation); break;
      case 'compareProjectedParentRelations': value = memory.compareProjectedParentRelations(
        args[0] as readonly string[], args[1] as Observation,
        args[2] as readonly HypotheticalPublicStateV1[],
        args[3] as { readonly r1Active: boolean; readonly r2Active: boolean }); break;
      case 'predictContinuation': value = memory.predictContinuation(args[0] as string,
        args[1] as ActionCue, args[2] as Observation); break;
      case 'closeContinuity': value = memory.closeContinuity(args[0] as Parameters<PhysicalMemory['closeContinuity']>[0]); break;
      case 'recordDistributedMatchedIntervention': memory.recordDistributedMatchedIntervention(
        args[0] as Parameters<PhysicalMemory['recordDistributedMatchedIntervention']>[0]); value = null; break;
      case 'recordAttractorPublicObservation': memory.recordAttractorPublicObservation(
        args[0] as TrustedAttractorPublicObservationV1); value = null; break;
      case 'resolveAttractorPublicReadout': value = memory.resolveAttractorPublicReadout(
        args[0] as string, args[1] as DistributedAttractorReadoutV1); break;
      case 'recordPredictionViolation': value = memory.recordPredictionViolation(
        args[0] as PredictionViolationV1); break;
      case 'recordFactorialArm': value = memory.recordFactorialArm(args[0] as MatchedArmResultV1); break;
      case 'pendingInterventionArmRequests': value = memory.pendingInterventionArmRequests(); break;
      case 'recordInterventionWindow': value = memory.recordInterventionWindow(
        args[0] as TrustedInterventionWindowV1); break;
      case 'snapshot': value = memory.snapshot(); break;
      case 'snapshotBundle': value = snapshotBundle(args[0] as SnapshotBundleRequestV1); break;
      case 'mediaPage': value = mediaPage(args[0] as MediaPageRequestV1); break;
      case 'enableTimescaleV2': memory.enableTimescaleV2(); timescaleV4Enabled = true; value = null; break;
      case 'advanceMeasured': memory.advanceTo(args[0] as number,
        args[1] as DistributedLayerMeasurementsV1); value = null; break;
      case 'snapshotV4': value = memory.snapshotV4(); break;
      case 'restore': memory = PhysicalMemory.restore(args[0] as MemorySnapshot); timescaleV4Enabled = false;
        lastSerializedSnapshot = { revision: `${(args[0] as MemorySnapshot).seenEventIds.length}:${memory.writes}`,
          snapshot: args[0] as MemorySnapshot };
        value = { writes: memory.writes }; break;
      case 'restoreV4': memory = PhysicalMemory.restoreV4(args[0] as MemorySnapshotV4);
        timescaleV4Enabled = true;
        lastSerializedSnapshot = { revision: `${(args[0] as MemorySnapshotV4).seenEventIds.length}:${memory.writes}`,
          snapshot: args[0] as MemorySnapshotV4 };
        value = { writes: memory.writes }; break;
      case 'recordRuntimeMeasurement': memory.recordRuntimeMeasurement(
        args[0] as TrustedRuntimeMeasurementContextV1); value = null; break;
      case 'status': value = { ready: memory.ready, writes: memory.writes, bufferedEvents: memory.bufferedEvents,
        mapSha256: memory.mapSha256 }; break;
      case 'hash': value = canonicalStreamSha256(memory.snapshot()); break;
      default: throw new Error(`unknown-worker-method:${message.method}`);
    }
    parentPort!.postMessage({ id: message.id, value });
  } catch (error) {
    const value = error as Error;
    parentPort!.postMessage({ id: message.id, error: { message: value.message, stack: value.stack } });
  }
});
