import { memoryTimescaleLawConfigV1, type MemoryTimescaleLawConfigV1 } from '../learning/memory-timescales.js';
import type { DistributedMediumSnapshotV1 } from './distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from './distributed-physical-medium.js';
import { DistributedMediumTimescaleStateV2 } from './distributed-medium-timescale-state-v2.js';
import { measuredStructureExistsV2, composeDistributedMediumProtocolSnapshotV2,
  restoreDistributedMediumProtocolSnapshotV2,
  type DistributedMediumProtocolSnapshotV2, type RuntimeMeasuredSalienceV2 } from './distributed-medium-timescale-protocol-v2.js';

export interface DistributedHierarchicalTimescaleSnapshotV1 {
  readonly version: 'DistributedHierarchicalTimescaleSnapshotV1';
  readonly r1: DistributedMediumProtocolSnapshotV2;
  readonly r2: DistributedMediumProtocolSnapshotV2;
  readonly r2a: DistributedMediumProtocolSnapshotV2;
}

type LayerName = 'r1' | 'r2' | 'r2a';
type LayerMeasurements = Readonly<Record<LayerName, readonly RuntimeMeasuredSalienceV2[]>>;

function emptyMeasurements(): LayerMeasurements {
  return { r1: [], r2: [], r2a: [] };
}

/**
 * Owns one V2 clock alongside each physical layer without replacing the
 * medium objects held by their learning stores.  This is a production-owner
 * seam, not a migration of the V1 hierarchy or its checkpoint format.
 */
export class DistributedHierarchicalTimescaleOwnerV1 {
  readonly #mediums: Readonly<Record<LayerName, DistributedPhysicalMedium3DV1>>;
  readonly #states: Readonly<Record<LayerName, DistributedMediumTimescaleStateV2>>;
  readonly #law: MemoryTimescaleLawConfigV1;

  constructor(r1: DistributedPhysicalMedium3DV1, r2: DistributedPhysicalMedium3DV1,
    r2a: DistributedPhysicalMedium3DV1,
    states: Partial<Record<LayerName, DistributedMediumTimescaleStateV2>> = {},
    law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()) {
    this.#law = Object.freeze({ ...law });
    this.#mediums = { r1, r2, r2a };
    this.#states = { r1: states.r1 ?? new DistributedMediumTimescaleStateV2(law),
      r2: states.r2 ?? new DistributedMediumTimescaleStateV2(law),
      r2a: states.r2a ?? new DistributedMediumTimescaleStateV2(law) };
    for (const layer of ['r1', 'r2', 'r2a'] as const) {
      if (this.#mediums[layer].snapshot().logicalTime !== this.#states[layer].logicalTime)
        throw new Error(`hierarchical timescale ${layer} logical-time mismatch`);
    }
  }

  get logicalTime(): number { return this.#states.r1.logicalTime; }

  /** Advance all layers together. Measurements are trusted runtime values. */
  advanceTo(logicalTime: number, measurements: LayerMeasurements = emptyMeasurements()): void {
    if (!Number.isFinite(logicalTime) || logicalTime < this.logicalTime)
      throw new Error('hierarchical timescale logical-time-reversed');
    for (const layer of ['r1', 'r2', 'r2a'] as const) {
      if (this.#states[layer].logicalTime !== this.logicalTime
        || this.#mediums[layer].snapshot().logicalTime !== this.logicalTime)
        throw new Error(`hierarchical timescale ${layer} clock diverged`);
    }
    const start = this.logicalTime;
    const elapsed = logicalTime - start;
    if (elapsed === 0 && Object.values(measurements).every(value => value.length === 0)) return;
    for (const layer of ['r1', 'r2', 'r2a'] as const) {
      const mediumSnapshot = this.#mediums[layer].snapshot();
      const layerMeasurements = measurements[layer] ?? [];
      const rates = new Map<string, number>();
      const seen = new Set<string>();
      for (const measurement of layerMeasurements) {
        if (measurement.observedAt < start || measurement.observedAt > logicalTime)
          throw new Error(`hierarchical ${layer} measurement outside interval`);
        if (seen.has(measurement.structureId)) throw new Error(`hierarchical ${layer} duplicate measurement`);
        if (!measuredStructureExistsV2(mediumSnapshot, measurement))
          throw new Error(`hierarchical ${layer} structure is not present: ${measurement.structureId}`);
        seen.add(measurement.structureId);
        this.#states[layer].rememberMeasuredObservation({ structureId: measurement.structureId,
          observedAt: measurement.observedAt, surpriseMagnitude: measurement.surpriseMagnitude,
          goalRelevance: measurement.goalRelevance, supportMass: measurement.supportMass });
        this.#states[layer].depositSurpriseFlux(measurement.observedAt, measurement.surpriseMagnitude);
        rates.set(measurement.structureId, this.#states[layer].effectiveRecoveryRate(measurement.structureId, {
          version: 'MeasuredSalienceV1', surpriseMagnitude: measurement.surpriseMagnitude,
          goalRelevance: measurement.goalRelevance, supportMass: measurement.supportMass }));
      }
      this.#mediums[layer].recoverWithStructureRates(elapsed, rates);
      this.#states[layer].advanceTo(logicalTime);
    }
  }

  snapshot(): DistributedHierarchicalTimescaleSnapshotV1 {
    return { version: 'DistributedHierarchicalTimescaleSnapshotV1',
      r1: composeDistributedMediumProtocolSnapshotV2(this.#mediums.r1.snapshot(), this.#states.r1.snapshot(), this.#law),
      r2: composeDistributedMediumProtocolSnapshotV2(this.#mediums.r2.snapshot(), this.#states.r2.snapshot(), this.#law),
      r2a: composeDistributedMediumProtocolSnapshotV2(this.#mediums.r2a.snapshot(), this.#states.r2a.snapshot(), this.#law) };
  }

  static restore(snapshot: DistributedHierarchicalTimescaleSnapshotV1,
    law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1()): DistributedHierarchicalTimescaleOwnerV1 {
    if (snapshot.version !== 'DistributedHierarchicalTimescaleSnapshotV1')
      throw new Error('unsupported hierarchical timescale snapshot');
    const r1 = restoreDistributedMediumProtocolSnapshotV2(snapshot.r1, law);
    const r2 = restoreDistributedMediumProtocolSnapshotV2(snapshot.r2, law);
    const r2a = restoreDistributedMediumProtocolSnapshotV2(snapshot.r2a, law);
    return new DistributedHierarchicalTimescaleOwnerV1(
      DistributedPhysicalMedium3DV1.fromSnapshot(r1.medium),
      DistributedPhysicalMedium3DV1.fromSnapshot(r2.medium),
      DistributedPhysicalMedium3DV1.fromSnapshot(r2a.medium),
      { r1: DistributedMediumTimescaleStateV2.restore(r1.timescale, law),
        r2: DistributedMediumTimescaleStateV2.restore(r2.timescale, law),
        r2a: DistributedMediumTimescaleStateV2.restore(r2a.timescale, law) }, law);
  }

  mediumSnapshot(layer: LayerName): DistributedMediumSnapshotV1 {
    return this.#mediums[layer].snapshot();
  }
}
