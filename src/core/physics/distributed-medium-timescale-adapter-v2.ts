import { assertMemoryTimescaleLawV1, memoryTimescaleLawConfigV1,
  type MemoryTimescaleLawConfigV1 } from '../learning/memory-timescales.js';
import { DistributedPhysicalMedium3DV1 } from './distributed-physical-medium.js';
import {
  composeDistributedMediumProtocolSnapshotV2,
  measuredRecoveryRateV2,
  restoreDistributedMediumProtocolSnapshotV2,
  validateTimescaleMeasurementBatchV2,
  type DistributedMediumProtocolSnapshotV2,
  type RuntimeMeasuredSalienceV2,
} from './distributed-medium-timescale-protocol-v2.js';
import { DistributedMediumTimescaleStateV2 } from './distributed-medium-timescale-state-v2.js';

/**
 * Staged DESIGN-002 clock adapter.  It keeps the V1 medium and the V2
 * medium-owned time state at one logical observation time, but deliberately
 * delegates recovery to V1 until the versioned per-structure law is approved.
 * It is not imported by the production hierarchy.
 */
export class DistributedMediumTimescaleAdapterV2 {
  readonly #medium: DistributedPhysicalMedium3DV1;
  readonly #timescale: DistributedMediumTimescaleStateV2;
  readonly #law: MemoryTimescaleLawConfigV1;

  constructor(medium: DistributedPhysicalMedium3DV1,
    timescale = new DistributedMediumTimescaleStateV2(),
    law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()) {
    assertMemoryTimescaleLawV1(law);
    if (medium.snapshot().logicalTime !== timescale.logicalTime)
      throw new Error('timescale-adapter-logical-time-mismatch');
    this.#medium = medium;
    this.#timescale = timescale;
    this.#law = Object.freeze({ ...law });
  }

  get logicalTime(): number { return this.#timescale.logicalTime; }
  get arousal(): number { return this.#timescale.arousal; }
  mediumSnapshot() { return this.#medium.snapshot(); }

  /** Advance both clocks; V1 recovery remains explicit until the protocol bump. */
  advanceTo(logicalTime: number): void {
    if (!Number.isFinite(logicalTime) || logicalTime < this.logicalTime)
      throw new Error('timescale-adapter-time-reversed');
    const elapsed = logicalTime - this.logicalTime;
    if (elapsed === 0) return;
    this.#medium.recover(elapsed);
    this.#timescale.advanceTo(logicalTime);
  }

  /** Record measured surprise without allowing a caller to set salience/arousal. */
  depositMeasuredSurprise(measurement: RuntimeMeasuredSalienceV2): void {
    validateTimescaleMeasurementBatchV2({ version: 'TimescaleMeasurementBatchV2', observations: [measurement] });
    this.advanceTo(measurement.observedAt);
    this.#timescale.depositSurpriseFlux(measurement.observedAt, measurement.surpriseMagnitude);
  }

  recoveryRate(measurement: RuntimeMeasuredSalienceV2): number {
    return measuredRecoveryRateV2(this.#timescale, measurement, this.#law);
  }

  snapshot(): DistributedMediumProtocolSnapshotV2 {
    return composeDistributedMediumProtocolSnapshotV2(this.#medium.snapshot(), this.#timescale.snapshot(), this.#law);
  }

  static restore(snapshot: DistributedMediumProtocolSnapshotV2,
    law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): DistributedMediumTimescaleAdapterV2 {
    const restored = restoreDistributedMediumProtocolSnapshotV2(snapshot, law);
    return new DistributedMediumTimescaleAdapterV2(
      DistributedPhysicalMedium3DV1.fromSnapshot(restored.medium),
      DistributedMediumTimescaleStateV2.restore(restored.timescale, law), law);
  }
}
