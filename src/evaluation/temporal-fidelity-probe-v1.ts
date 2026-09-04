import type { DistributedMediumSnapshotV1 } from '../core/physics/distributed-physical-contracts.js';
import { DistributedPredictionCloneV2, type DistributedPredictionCloneRequestV2,
  type DistributedPredictionCloneResultV2 } from '../core/prediction/distributed-prediction-clone.js';

export interface TemporalFidelityProbeCaseV1 {
  readonly caseId: string;
  readonly request: Omit<DistributedPredictionCloneRequestV2, 'seed'>;
  /** Measured dwell weights for the ordered real prefix, in arbitrary units. */
  readonly prefixDwell: readonly number[];
  /** Number of physical ticks allocated to the proportional prefix replay. */
  readonly proportionalPrefixTicks?: number;
  readonly seeds: readonly bigint[];
}

export interface TemporalFidelityReplayV1 {
  readonly prefixTicks: readonly number[];
  readonly prefixSiteIds: readonly (readonly number[])[];
  readonly results: readonly DistributedPredictionCloneResultV2[];
  readonly selectionRate: number;
}

export interface TemporalFidelityProbeCaseResultV1 {
  readonly version: 'TemporalFidelityProbeCaseResultV1';
  readonly caseId: string;
  readonly compressed: TemporalFidelityReplayV1;
  readonly proportional: TemporalFidelityReplayV1;
  readonly reachedIdentityMismatch: boolean;
  readonly readoutStatusMismatch: boolean;
  readonly selectionRateDeviation: number;
  readonly hypothesisPasses: boolean;
}

export interface TemporalFidelityProbeReportV1 {
  readonly version: 'TemporalFidelityProbeReportV1';
  readonly cases: readonly TemporalFidelityProbeCaseResultV1[];
  readonly hypothesisPasses: boolean;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
}

function proportionalTicks(weights: readonly number[], budget: number): readonly number[] {
  if (weights.length === 0) throw new RangeError('prefixDwell must be non-empty');
  requirePositiveInteger(budget, 'proportionalPrefixTicks');
  if (budget < weights.length) throw new RangeError('proportionalPrefixTicks must cover every prefix pulse');
  if (weights.some(value => !Number.isFinite(value) || value <= 0))
    throw new RangeError('prefixDwell must contain positive finite values');
  const total = weights.reduce((sum, value) => sum + value, 0);
  const raw = weights.map(value => value / total * budget);
  const ticks = raw.map(value => Math.max(1, Math.floor(value)));
  let remainder = budget - ticks.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1)
    ticks[order[index % order.length]!.index]! += 1;
  // If flooring plus the mandatory one-tick minimum overspent the budget,
  // remove ticks from the smallest fractional allocations while preserving 1.
  if (remainder < 0) {
    const removable = [...order].sort((left, right) => left.fraction - right.fraction || left.index - right.index);
    for (const item of removable) while (remainder < 0 && ticks[item.index]! > 1) {
      ticks[item.index]! -= 1; remainder += 1;
    }
  }
  if (ticks.reduce((sum, value) => sum + value, 0) !== budget)
    throw new Error('proportional prefix tick allocation failed');
  return ticks;
}

function expandedPrefix(request: Omit<DistributedPredictionCloneRequestV2, 'seed'>,
  ticks: readonly number[]): Omit<DistributedPredictionCloneRequestV2, 'seed'> {
  if (request.realPrefixSeedSiteIds.length !== ticks.length)
    throw new Error('prefixDwell must match realPrefixSeedSiteIds');
  const siteIds: number[][] = [], drives: Array<Array<{ siteId: number; intensity: number }>> = [];
  request.realPrefixSeedSiteIds.forEach((pulse, index) => {
    const repeat = ticks[index]!;
    for (let copy = 0; copy < repeat; copy += 1) {
      siteIds.push([...pulse]);
      if (request.realPrefixSeedDrives !== undefined)
        drives.push(request.realPrefixSeedDrives[index]!.map(value => ({ ...value })));
    }
  });
  return { ...request, realPrefixSeedSiteIds: siteIds,
    ...(request.realPrefixSeedDrives === undefined ? {} : { realPrefixSeedDrives: drives }) };
}

function replay(snapshot: DistributedMediumSnapshotV1,
  request: Omit<DistributedPredictionCloneRequestV2, 'seed'>,
  seeds: readonly bigint[], ticks: readonly number[]): TemporalFidelityReplayV1 {
  const clone = new DistributedPredictionCloneV2(snapshot);
  const results = seeds.map(seed => clone.run({ ...request, seed }));
  const selectionRate = results.length === 0 ? 0
    : results.filter(result => result.status === 'reached').length / results.length;
  return { prefixTicks: [...ticks], prefixSiteIds: request.realPrefixSeedSiteIds.map(value => [...value]),
    results, selectionRate };
}

export function runTemporalFidelityProbeCaseV1(snapshot: DistributedMediumSnapshotV1,
  input: TemporalFidelityProbeCaseV1): TemporalFidelityProbeCaseResultV1 {
  if (input.caseId.length === 0) throw new RangeError('caseId must be non-empty');
  if (input.seeds.length === 0) throw new RangeError('seeds must be non-empty');
  const prefixTicks = proportionalTicks(input.prefixDwell,
    input.proportionalPrefixTicks ?? input.request.realPrefixSeedSiteIds.length);
  const compressedTicks = input.request.realPrefixSeedSiteIds.map(() => 1);
  const compressed = replay(snapshot, input.request, input.seeds, compressedTicks);
  const proportionalRequest = expandedPrefix(input.request, prefixTicks);
  const proportional = replay(snapshot, proportionalRequest, input.seeds, prefixTicks);
  const reachedIdentityMismatch = compressed.results.some((result, index) => {
    const other = proportional.results[index]!;
    return result.status !== other.status
      || result.reachedAssemblyIds.join('|') !== other.reachedAssemblyIds.join('|');
  });
  const readoutStatusMismatch = compressed.results.some((result, index) =>
    result.attractorReadout.evidenceLevel !== proportional.results[index]!.attractorReadout.evidenceLevel
    || result.attractorReadout.ambiguous !== proportional.results[index]!.attractorReadout.ambiguous);
  const selectionRateDeviation = Math.abs(compressed.selectionRate - proportional.selectionRate);
  return { version: 'TemporalFidelityProbeCaseResultV1', caseId: input.caseId,
    compressed, proportional, reachedIdentityMismatch, readoutStatusMismatch,
    selectionRateDeviation, hypothesisPasses: !reachedIdentityMismatch
      && !readoutStatusMismatch && selectionRateDeviation <= .10 };
}

export function runTemporalFidelityProbeV1(snapshot: DistributedMediumSnapshotV1,
  cases: readonly TemporalFidelityProbeCaseV1[]): TemporalFidelityProbeReportV1 {
  const results = cases.map(input => runTemporalFidelityProbeCaseV1(snapshot, input));
  return { version: 'TemporalFidelityProbeReportV1', cases: results,
    hypothesisPasses: results.every(result => result.hypothesisPasses) };
}

export { proportionalTicks as allocateProportionalPrefixTicksV1 };
