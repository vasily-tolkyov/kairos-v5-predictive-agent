import type { RealEvent } from '../contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../distributed-hierarchical-memory.js';

/** A physical-readout measurement supplied by an evaluation fixture. */
export interface CapacityReadoutMeasurementV1 {
  readonly attempted: number;
  readonly reached: number;
  readonly ambiguous: number;
  readonly merged: number;
}

export interface CapacityProbeLevelV1 {
  readonly eventCount: number;
  readonly events: readonly RealEvent[];
  /** Optional measurements obtained by the fixture's read-only probe. */
  readonly readout?: CapacityReadoutMeasurementV1;
}

export interface CapacityProbePointV1 {
  readonly eventCount: number;
  readonly r1AtomCount: number;
  readonly r2RoadCount: number;
  readonly r2aPatternCount: number;
  readonly readoutErrorRate: number | null;
  readonly ambiguityRate: number | null;
  readonly basinMergeRate: number | null;
  readonly predictionReachRate: number | null;
}

export interface CapacityProbeReportV1 {
  readonly version: 'CapacityProbeReportV1';
  readonly points: readonly CapacityProbePointV1[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Run one deterministic capacity sweep through the production observe path.
 * Each level receives a fresh memory, so no level can learn from a later one.
 * The runner never invents readouts: absent a fixture-provided physical probe,
 * the four readout metrics stay null rather than becoming synthetic scores.
 */
export function runCapacityProbeV1(levels: readonly CapacityProbeLevelV1[]): CapacityProbeReportV1 {
  const points = levels.map(level => {
    if (!Number.isSafeInteger(level.eventCount) || level.eventCount < 0)
      throw new RangeError('capacity eventCount must be a non-negative integer');
    if (level.events.length !== level.eventCount)
      throw new Error('capacity level event count mismatch');
    const memory = new DistributedHierarchicalPhysicalMemoryV1();
    for (const event of level.events) memory.observe(event);
    const readout = level.readout;
    if (readout !== undefined) {
      if (![readout.attempted, readout.reached, readout.ambiguous, readout.merged]
        .every(value => Number.isSafeInteger(value) && value >= 0))
        throw new RangeError('capacity readout counts must be non-negative integers');
      if (readout.reached + readout.ambiguous > readout.attempted
        || readout.merged > readout.attempted)
        throw new Error('capacity readout counts are inconsistent');
    }
    return {
      eventCount: level.eventCount,
      r1AtomCount: memory.snapshot().r1.records.length,
      r2RoadCount: memory.snapshot().r2.events.length,
      r2aPatternCount: memory.snapshot().r2a.patterns.length,
      readoutErrorRate: readout === undefined ? null
        : ratio(readout.attempted - readout.reached - readout.ambiguous, readout.attempted),
      ambiguityRate: readout === undefined ? null : ratio(readout.ambiguous, readout.attempted),
      basinMergeRate: readout === undefined ? null : ratio(readout.merged, readout.attempted),
      predictionReachRate: readout === undefined ? null : ratio(readout.reached, readout.attempted),
    };
  });
  return { version: 'CapacityProbeReportV1', points };
}
