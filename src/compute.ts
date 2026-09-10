import { Worker } from 'node:worker_threads';
import type { KairosV5DistributedPhysicalMemoryV4 } from './distributed-hierarchical-memory.js';
import type { DistributedLayerMeasurementsV1 } from './core/physics/distributed-hierarchical-timescale-owner-v1.js';
import type { TrustedRuntimeMeasurementContextV1 } from './core/physics/runtime-measured-salience-bridge-v1.js';
import type { TrustedAttractorPublicObservationV1, AttractorDictionaryResolutionV1 }
  from './core/learning/attractor-public-dictionary.js';
import type { DistributedAttractorReadoutV1 }
  from './core/physics/distributed-physical-contracts.js';
import type { PredictionViolationV1, MatchedArmResultV1, FactorialCellV1,
  ViolationLedgerRecordV1, InterventionArmRequestV1 } from './core/learning/intervention-agenda.js';
import type { TrustedInterventionWindowV1, InterventionPairCandidateV1 }
  from './core/learning/intervention-pair-collector.js';
import type { DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } from './distributed-hierarchical-memory.js';
import type { DISTRIBUTED_MEMORY_V4_VERSION } from './experience-snapshot-contract.js';

/** Bounded per-medium statistics for the dashboard summary; computed inside the worker. */
export interface MediumStatisticsV1 {
  readonly siteCount: number; readonly activeSiteCount: number;
  readonly learnedBondCount: number; readonly localBondCount: number;
  readonly bindingCount: number; readonly footprintCount: number;
  readonly logicalTime: number; readonly allocationSequence: number; readonly metropolisSequence: number;
  readonly sha256: string;
}
export interface SnapshotMediaStatisticsV1 {
  readonly r1: MediumStatisticsV1; readonly r2: MediumStatisticsV1; readonly r2a: MediumStatisticsV1;
}
/** Where and how the worker should persist the snapshot (PLAN-005/008). */
export interface SnapshotBundleRequestV1 {
  readonly directory: string;
  readonly filename: string;
  readonly includeMediaStatistics: boolean;
  /** Single-file canonical is written at or below this size; above it the
   * segmented manifest+segments format is used instead. */
  readonly segmentThresholdBytes: number;
  /** PLAN-008b (optional, tests): per-section cap inside the segmented format;
   * oversized sections are split into element-boundary pages of at most
   * `segmentPageLimitBytes` (default: half the section cap). */
  readonly segmentLimitBytes?: number;
  readonly segmentPageLimitBytes?: number;
}
/**
 * Worker-serialized snapshot bundle: canonical bytes and their hash are
 * produced inside the compute worker and streamed straight to disk, so the
 * main thread never holds the snapshot text at all (PLAN-008).  `sha256`
 * covers the canonical text alone (no trailing newline), exactly as the
 * legacy pointer did; `canonicalBytes` is its byte length.  Segmented bundles
 * additionally carry the manifest hash and segment count.
 */
export interface SerializedSnapshotBundleV1 {
  readonly kind: 'serialized-snapshot-bundle';
  readonly memoryVersion: typeof DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 | typeof DISTRIBUTED_MEMORY_V4_VERSION;
  readonly revision: string;
  readonly filename: string;
  readonly format: 'single-file' | 'segmented';
  readonly canonicalBytes: number; readonly sha256: string;
  readonly manifestSha256?: string; readonly segmentCount?: number;
  readonly eventCount: number; readonly writes: number; readonly serializeMs: number;
  readonly mediaStatistics: SnapshotMediaStatisticsV1 | null;
  readonly timescaleLawIdentitySha256?: string;
}
/** Test-only seam: an injected retired backend reports itself explicitly. */
export interface RetiredSnapshotBundleV1 {
  readonly kind: 'retired-snapshot-bundle'; readonly snapshot: unknown;
}
export type SnapshotBundleResultV1 = SerializedSnapshotBundleV1 | RetiredSnapshotBundleV1;
export interface MediaPageRequestV1 {
  readonly medium: 'r1' | 'r2' | 'r2a'; readonly offset: number; readonly limit: number;
}
export interface MediaPageSiteV1 {
  readonly siteId: number; readonly coordinate: readonly [number, number, number];
  readonly activation: number; readonly potentialDepth: number;
}
/** A bounded, revision-labelled slice of the last saved snapshot's medium. */
export interface MediaPageResultV1 {
  readonly revision: string | null; readonly medium: 'r1' | 'r2' | 'r2a';
  readonly totalSites: number; readonly offset: number; readonly limit: number;
  readonly sites: readonly MediaPageSiteV1[];
}

/** The only compute worker is a physical-model owner, never another agent. */
export class Compute {
  readonly worker = new Worker(new URL('./worker.js', import.meta.url));
  #id = 0;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #queue: Array<{ readonly id: number; readonly method: string; readonly args: unknown[];
    readonly background: boolean; readonly enqueuedAt: number }> = [];
  #inFlight: { readonly id: number; readonly startedAt: number; readonly background: boolean } | null = null;
  #drainScheduled = false;
  #enqueuedCount = 0;
  #dispatchedCount = 0;
  #completedCount = 0;
  #backgroundCompletedCount = 0;
  #foregroundWaitMs = 0;
  #backgroundWaitMs = 0;
  #foregroundExecutionMs = 0;
  #backgroundExecutionMs = 0;
  #closed = false;
  #failure: Error | null = null;
  constructor() {
    this.worker.on('message', message => {
      const pending = this.#pending.get(message.id); if (!pending) return;
      this.#pending.delete(message.id);
      const inFlight = this.#inFlight;
      if (inFlight === null || inFlight.id !== message.id)
        throw new Error('physical-worker-response-order-mismatch');
      this.#inFlight = null;
      this.#completedCount++;
      if (inFlight.background) this.#backgroundCompletedCount++;
      const executionMs = performance.now() - inFlight.startedAt;
      if (inFlight.background) this.#backgroundExecutionMs += executionMs;
      else this.#foregroundExecutionMs += executionMs;
      if (message.error) { const error = new Error(message.error.message); error.stack = message.error.stack; pending.reject(error); }
      else pending.resolve(message.value);
      this.#scheduleDrain();
    });
    this.worker.on('error', error => {
      this.#failure ??= error;
      for (const p of this.#pending.values()) p.reject(error); this.#pending.clear();
      this.#queue.length = 0; this.#inFlight = null;
    });
    this.worker.on('exit', code => {
      if (this.#closed) return;
      const error = this.#failure ?? new Error(`physical-worker-exited:${code}`);
      this.#failure = error;
      for (const p of this.#pending.values()) p.reject(error); this.#pending.clear();
      this.#queue.length = 0; this.#inFlight = null;
    });
  }
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.reject(new Error('physical-worker-closed'));
    return new Promise((resolve, reject) => { const id = ++this.#id;
      const background = method === 'predict' || method === 'predictCandidate'
        || method === 'predictShortChain'
        || method === 'predictContinuation' || method === 'probe';
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#queue.push({ id, method, args, background, enqueuedAt: performance.now() });
      this.#enqueuedCount++; this.#scheduleDrain();
    });
  }
  #scheduleDrain(): void {
    if (this.#drainScheduled || this.#closed || this.#failure) return;
    this.#drainScheduled = true;
    setImmediate(() => { this.#drainScheduled = false; this.#drain(); });
  }
  #drain(): void {
    if (this.#inFlight || this.#queue.length === 0 || this.#closed || this.#failure) return;
    // Foreground memory/status work always drains before queued read-only
    // prediction work.  FIFO is preserved inside each class; no operation is
    // allowed to overtake a prior foreground write.
    const foregroundIndex = this.#queue.findIndex(entry => !entry.background);
    const index = foregroundIndex >= 0 ? foregroundIndex : 0;
    const entry = this.#queue.splice(index, 1)[0]!;
    const waitMs = performance.now() - entry.enqueuedAt;
    if (entry.background) this.#backgroundWaitMs += waitMs;
    else this.#foregroundWaitMs += waitMs;
    this.#inFlight = { id: entry.id, startedAt: performance.now(), background: entry.background };
    this.#dispatchedCount++;
    this.worker.postMessage({ id: entry.id, method: entry.method, args: entry.args });
  }
  /** Explicit opt-in seam for the staged V4 timescale owner. */
  async enableTimescaleV2(): Promise<void> { await this.call('enableTimescaleV2'); }
  async advanceMeasured(logicalTime: number, measurements: DistributedLayerMeasurementsV1): Promise<void> {
    await this.call('advanceMeasured', logicalTime, measurements);
  }
  async snapshotV4(): Promise<KairosV5DistributedPhysicalMemoryV4> {
    return this.call<KairosV5DistributedPhysicalMemoryV4>('snapshotV4');
  }
  async restoreV4(snapshot: KairosV5DistributedPhysicalMemoryV4): Promise<void> {
    await this.call('restoreV4', snapshot);
  }
  /** Serialize and persist the current memory snapshot inside the worker
   * (PLAN-005 1.2, PLAN-008 streaming). */
  async snapshotBundle(request: SnapshotBundleRequestV1): Promise<SnapshotBundleResultV1> {
    return this.call<SnapshotBundleResultV1>('snapshotBundle', request);
  }
  /** Bounded media page from the worker-retained last saved snapshot (PLAN-005 1.1). */
  async mediaPage(request: MediaPageRequestV1): Promise<MediaPageResultV1> {
    return this.call<MediaPageResultV1>('mediaPage', request);
  }
  async recordRuntimeMeasurement(input: TrustedRuntimeMeasurementContextV1): Promise<void> {
    await this.call('recordRuntimeMeasurement', input);
  }
  async recordAttractorPublicObservation(input: TrustedAttractorPublicObservationV1): Promise<void> {
    await this.call('recordAttractorPublicObservation', input);
  }
  async resolveAttractorPublicReadout(mediumVersion: string, readout: DistributedAttractorReadoutV1): Promise<AttractorDictionaryResolutionV1> {
    return this.call('resolveAttractorPublicReadout', mediumVersion, readout);
  }
  async recordPredictionViolation(input: PredictionViolationV1): Promise<ViolationLedgerRecordV1 | null> {
    return this.call('recordPredictionViolation', input);
  }
  async recordFactorialArm(input: MatchedArmResultV1): Promise<FactorialCellV1> {
    return this.call('recordFactorialArm', input);
  }
  async pendingInterventionArmRequests(): Promise<readonly InterventionArmRequestV1[]> {
    return this.call('pendingInterventionArmRequests');
  }
  async recordInterventionWindow(input: TrustedInterventionWindowV1): Promise<readonly InterventionPairCandidateV1[]> {
    return this.call('recordInterventionWindow', input);
  }
  performanceAudit(): { readonly enqueued: number; readonly dispatched: number;
    readonly completed: number; readonly backgroundCompleted: number;
    readonly queued: number; readonly foregroundWaitMs: number; readonly backgroundWaitMs: number;
    readonly foregroundExecutionMs: number; readonly backgroundExecutionMs: number } {
    return { enqueued: this.#enqueuedCount, dispatched: this.#dispatchedCount,
      completed: this.#completedCount, backgroundCompleted: this.#backgroundCompletedCount,
      queued: this.#queue.length, foregroundWaitMs: this.#foregroundWaitMs,
      backgroundWaitMs: this.#backgroundWaitMs,
      foregroundExecutionMs: this.#foregroundExecutionMs,
      backgroundExecutionMs: this.#backgroundExecutionMs };
  }
  async close(): Promise<void> {
    this.#closed = true;
    const error = new Error('physical-worker-closed');
    for (const entry of this.#queue) this.#pending.get(entry.id)?.reject(error);
    this.#queue.length = 0;
    for (const p of this.#pending.values()) p.reject(error);
    this.#pending.clear(); this.#inFlight = null;
    await this.worker.terminate();
  }
}
