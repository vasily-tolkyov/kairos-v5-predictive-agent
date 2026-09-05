import { sha } from '../../util.js';
import {
  assertMemoryTimescaleLawV1,
  effectiveRecoveryRateV1,
  memoryTimescaleLawConfigV1,
  type MemoryTimescaleLawConfigV1,
} from '../learning/memory-timescales.js';
import type {
  DistributedMediumSnapshotV1,
  DistributedSiteStateV1,
} from './distributed-physical-contracts.js';
import {
  DistributedMediumTimescaleStateV2,
  type DistributedMediumTimescaleSnapshotV2,
} from './distributed-medium-timescale-state-v2.js';

/**
 * DESIGN-002 protocol envelope.  The V1 physical snapshot is carried as an
 * immutable payload; the envelope is the first place where the medium-owned
 * time state and its law identity can be restored together.  It is not yet a
 * production replacement for DistributedMediumSnapshotV1.
 */
export interface DistributedMediumProtocolSnapshotV2 {
  readonly version: 'DistributedMediumProtocolSnapshotV2';
  readonly protocol: 'distributed-medium-timescales-v2';
  readonly lawIdentitySha256: string;
  readonly medium: DistributedMediumSnapshotV1;
  readonly timescale: DistributedMediumTimescaleSnapshotV2;
}

/** A measured value supplied by a trusted runtime observation path. */
export interface RuntimeMeasuredSalienceV2 {
  readonly version: 'RuntimeMeasuredSalienceV2';
  readonly source: 'trusted-runtime-observation';
  readonly structureId: string;
  readonly observedAt: number;
  readonly surpriseMagnitude: number;
  readonly goalRelevance: number;
  readonly supportMass: number;
}

export interface TimescaleMeasurementBatchV2 {
  readonly version: 'TimescaleMeasurementBatchV2';
  readonly observations: readonly RuntimeMeasuredSalienceV2[];
}

function requireFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
}

function requireStructureId(value: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new RangeError('structureId must be non-empty');
}

function validateMeasurement(value: RuntimeMeasuredSalienceV2): void {
  if (value.version !== 'RuntimeMeasuredSalienceV2'
    || value.source !== 'trusted-runtime-observation') throw new Error('invalid runtime salience measurement');
  requireStructureId(value.structureId);
  requireFiniteNonnegative(value.observedAt, 'observedAt');
  requireFiniteNonnegative(value.surpriseMagnitude, 'surpriseMagnitude');
  requireFiniteNonnegative(value.goalRelevance, 'goalRelevance');
  requireFiniteNonnegative(value.supportMass, 'supportMass');
}

/** Validate an ordered batch without deriving a caller-provided salience. */
export function validateTimescaleMeasurementBatchV2(batch: TimescaleMeasurementBatchV2): void {
  if (batch.version !== 'TimescaleMeasurementBatchV2') throw new Error('unsupported timescale measurement batch');
  let previousTime = -Infinity;
  for (const measurement of batch.observations) {
    validateMeasurement(measurement);
    if (measurement.observedAt < previousTime) throw new Error('timescale measurements are out of order');
    previousTime = measurement.observedAt;
  }
}

/** Convert only measured components into the frozen recovery law. */
export function measuredRecoveryRateV2(state: DistributedMediumTimescaleStateV2,
  measurement: RuntimeMeasuredSalienceV2, law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): number {
  validateMeasurement(measurement);
  assertMemoryTimescaleLawV1(law);
  return state.effectiveRecoveryRate(measurement.structureId, {
    version: 'MeasuredSalienceV1',
    surpriseMagnitude: measurement.surpriseMagnitude,
    goalRelevance: measurement.goalRelevance,
    supportMass: measurement.supportMass,
  });
}

/**
 * Compose a strict V2 envelope.  No physical state is mutated and the V1
 * medium snapshot is cloned so a caller cannot alter the envelope afterwards.
 */
export function composeDistributedMediumProtocolSnapshotV2(
  medium: DistributedMediumSnapshotV1,
  timescale: DistributedMediumTimescaleSnapshotV2,
  law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1(),
): DistributedMediumProtocolSnapshotV2 {
  if (medium.version !== 'DistributedMediumSnapshotV1') throw new Error('unsupported medium snapshot for timescale-v2');
  if (timescale.version !== 'DistributedMediumTimescaleSnapshotV2') throw new Error('unsupported timescale snapshot');
  assertMemoryTimescaleLawV1(law);
  const clonedMedium = structuredClone(medium);
  const clonedTimescale = structuredClone(timescale);
  const restored = DistributedMediumTimescaleStateV2.restore(clonedTimescale, law);
  if (restored.logicalTime > clonedMedium.logicalTime)
    throw new Error('timescale state cannot be ahead of medium logical time');
  return {
    version: 'DistributedMediumProtocolSnapshotV2',
    protocol: 'distributed-medium-timescales-v2',
    lawIdentitySha256: sha(law),
    medium: clonedMedium,
    timescale: clonedTimescale,
  };
}

/** Strictly restore the two independently-owned states without writing either. */
export function restoreDistributedMediumProtocolSnapshotV2(
  snapshot: DistributedMediumProtocolSnapshotV2,
  law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1(),
): { readonly medium: DistributedMediumSnapshotV1; readonly timescale: DistributedMediumTimescaleSnapshotV2 } {
  if (snapshot.version !== 'DistributedMediumProtocolSnapshotV2'
    || snapshot.protocol !== 'distributed-medium-timescales-v2') throw new Error('unsupported medium protocol snapshot');
  assertMemoryTimescaleLawV1(law);
  if (snapshot.lawIdentitySha256 !== sha(law)) throw new Error('timescale law identity mismatch');
  const medium = structuredClone(snapshot.medium);
  const timescale = structuredClone(snapshot.timescale);
  if (medium.version !== 'DistributedMediumSnapshotV1') throw new Error('embedded medium snapshot is not V1');
  const restored = DistributedMediumTimescaleStateV2.restore(timescale, law);
  if (restored.logicalTime > medium.logicalTime) throw new Error('timescale state ahead of medium snapshot');
  return { medium, timescale };
}

/** Read-only check that a measured structure is present in the captured medium. */
export function measuredStructureExistsV2(medium: DistributedMediumSnapshotV1,
  measurement: RuntimeMeasuredSalienceV2): boolean {
  validateMeasurement(measurement);
  if (measurement.structureId.startsWith('site:')) {
    const siteId = Number(measurement.structureId.slice('site:'.length));
    return Number.isSafeInteger(siteId) && medium.sites.some((site: DistributedSiteStateV1) => site.siteId === siteId);
  }
  return medium.footprints.some(footprint => `trace:${footprint.traceId}` === measurement.structureId)
    || medium.learnedBonds.some(bond => `bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}` === measurement.structureId);
}
