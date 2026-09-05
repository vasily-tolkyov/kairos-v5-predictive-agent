import { assertMemoryTimescaleLawV1, memoryTimescaleLawConfigV1,
  type MemoryTimescaleLawConfigV1 } from '../learning/memory-timescales.js';
import { DistributedPhysicalMedium3DV1 } from './distributed-physical-medium.js';
import {
  composeDistributedMediumProtocolSnapshotV2,
  restoreDistributedMediumProtocolSnapshotV2,
  measuredRecoveryRateV2,
  validateTimescaleMeasurementBatchV2,
  type DistributedMediumProtocolSnapshotV2,
  type RuntimeMeasuredSalienceV2,
} from './distributed-medium-timescale-protocol-v2.js';
import { recoverDistributedMediumProtocolSnapshotV2 } from './distributed-medium-recovery-v2.js';
import { DistributedMediumTimescaleStateV2 } from './distributed-medium-timescale-state-v2.js';

/**
 * Staged DESIGN-002 clock adapter. It keeps the V1 medium and the V2
 * medium-owned time state at one logical observation time. Measured intervals
 * use the V2 snapshot transform; unmeasured intervals retain the legacy
 * base-rate path. It is not imported by the production hierarchy.
 */
export class DistributedMediumTimescaleAdapterV2 {
  #medium: DistributedPhysicalMedium3DV1;
  #timescale: DistributedMediumTimescaleStateV2;
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

  /**
   * Advance both clocks.  When measured observations are present, the
   * snapshot-only V2 transform is applied to the live staged substrate; an
   * empty interval retains the legacy base-rate result byte-for-byte.  This
   * keeps the adapter honest about the new law without silently changing the
   * production V1 owner.
   */
  advanceTo(logicalTime: number, measurements: readonly RuntimeMeasuredSalienceV2[] = []): void {
    if (!Number.isFinite(logicalTime) || logicalTime < this.logicalTime)
      throw new Error('timescale-adapter-time-reversed');
    const elapsed = logicalTime - this.logicalTime;
    if (elapsed === 0 && measurements.length === 0) return;
    if (measurements.length === 0) {
      this.#medium.recover(elapsed);
      this.#timescale.advanceTo(logicalTime);
      return;
    }
    const next = recoverDistributedMediumProtocolSnapshotV2(this.snapshot(), elapsed, measurements, this.#law);
    this.#medium = DistributedPhysicalMedium3DV1.fromSnapshot(next.medium);
    this.#timescale = DistributedMediumTimescaleStateV2.restore(next.timescale, this.#law);
  }

  /** Record measured surprise without allowing a caller to set salience/arousal. */
  depositMeasuredSurprise(measurement: RuntimeMeasuredSalienceV2): void {
    validateTimescaleMeasurementBatchV2({ version: 'TimescaleMeasurementBatchV2', observations: [measurement] });
    this.advanceTo(measurement.observedAt, [measurement]);
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
