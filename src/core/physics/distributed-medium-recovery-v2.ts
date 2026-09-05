import {
  effectiveRecoveryRateV1,
  memoryTimescaleLawConfigV1,
  type MemoryTimescaleLawConfigV1,
} from '../learning/memory-timescales.js';
import { DistributedMediumTimescaleStateV2 } from './distributed-medium-timescale-state-v2.js';
import {
  composeDistributedMediumProtocolSnapshotV2,
  measuredStructureExistsV2,
  restoreDistributedMediumProtocolSnapshotV2,
  validateTimescaleMeasurementBatchV2,
  type DistributedMediumProtocolSnapshotV2,
  type RuntimeMeasuredSalienceV2,
} from './distributed-medium-timescale-protocol-v2.js';

/**
 * Snapshot-only DESIGN-002 recovery.  The function derives one rate per
 * structure from measured components and returns a new V2 envelope.  It does
 * not mutate a live medium, change evidence labels, or accept a final rate.
 */
export function recoverDistributedMediumProtocolSnapshotV2(
  snapshot: DistributedMediumProtocolSnapshotV2,
  elapsed: number,
  measurements: readonly RuntimeMeasuredSalienceV2[] = [],
  law: MemoryTimescaleLawConfigV1 = memoryTimescaleLawConfigV1(),
): DistributedMediumProtocolSnapshotV2 {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('recovery elapsed must be finite and nonnegative');
  const restored = restoreDistributedMediumProtocolSnapshotV2(snapshot, law);
  const start = restored.medium.logicalTime;
  const end = start + elapsed;
  const batch = { version: 'TimescaleMeasurementBatchV2' as const, observations: measurements };
  validateTimescaleMeasurementBatchV2(batch);
  const measuredIds = new Set<string>();
  for (const measurement of measurements) {
    if (measurement.observedAt < start || measurement.observedAt > end)
      throw new Error('timescale measurement outside recovery interval');
    if (measuredIds.has(measurement.structureId))
      throw new Error('duplicate structure measurement in recovery interval');
    if (!measuredStructureExistsV2(restored.medium, measurement))
      throw new Error(`timescale measurement structure is not present: ${measurement.structureId}`);
    measuredIds.add(measurement.structureId);
  }
  const timescale = DistributedMediumTimescaleStateV2.restore(restored.timescale, law);
  for (const measurement of measurements) {
    timescale.rememberMeasuredObservation({ structureId: measurement.structureId,
      observedAt: measurement.observedAt, surpriseMagnitude: measurement.surpriseMagnitude,
      goalRelevance: measurement.goalRelevance, supportMass: measurement.supportMass });
    timescale.depositSurpriseFlux(measurement.observedAt, measurement.surpriseMagnitude);
  }
  timescale.advanceTo(end);
  const byStructure = new Map(measurements.map(measurement => [measurement.structureId, measurement]));
  const decay = (structureId: string, supportMass: number): number => {
    const measurement = byStructure.get(structureId) ?? (() => {
      const stored = timescale.measuredObservation(structureId);
      return stored === null ? undefined : {
        version: 'RuntimeMeasuredSalienceV2' as const,
        source: 'trusted-runtime-observation' as const,
        structureId: stored.structureId, observedAt: stored.observedAt,
        surpriseMagnitude: stored.surpriseMagnitude, goalRelevance: stored.goalRelevance,
        supportMass: stored.supportMass,
      };
    })();
    if (!measurement) return Math.exp(-law.baseRecoveryRate * elapsed);
    return Math.exp(-effectiveRecoveryRateV1({ version: 'MeasuredSalienceV1',
      surpriseMagnitude: measurement.surpriseMagnitude,
      goalRelevance: measurement.goalRelevance,
      supportMass: Math.max(supportMass, measurement.supportMass),
      rehearsalCount: timescale.rehearsalCount(structureId),
    }, law) * elapsed);
  };
  const medium = restored.medium;
  return composeDistributedMediumProtocolSnapshotV2({ ...medium, logicalTime: end,
    sites: medium.sites.map(site => ({ ...site,
      potentialDepth: site.potentialDepth * decay(`site:${site.siteId}`, site.supportMass),
      supportMass: site.supportMass * decay(`site:${site.siteId}`, site.supportMass),
      activation: site.activation * Math.exp(-site.dissipation * elapsed),
      lastUpdatedAt: end,
    })),
    learnedBonds: medium.learnedBonds.map(bond => ({ ...bond,
      symmetricCoupling: bond.symmetricCoupling * decay(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`, bond.supportMass),
      directedConductance: bond.directedConductance * decay(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`, bond.supportMass),
      supportMass: bond.supportMass * decay(`bond:${bond.fromSiteId}>${bond.toSiteId}:${bond.kind}`, bond.supportMass),
      lastUpdatedAt: end,
    })),
    footprints: medium.footprints.map(footprint => ({ ...footprint,
      supportMass: footprint.supportMass * decay(`trace:${footprint.traceId}`, footprint.supportMass),
      depositedAt: footprint.depositedAt,
    })),
    coactivationAssemblies: medium.coactivationAssemblies?.map(assembly => ({ ...assembly,
      supportMass: assembly.supportMass * decay(`assembly:${assembly.assemblyId}`, assembly.supportMass),
      lastUpdatedAt: end,
    })),
  }, timescale.snapshot(), law);
}
