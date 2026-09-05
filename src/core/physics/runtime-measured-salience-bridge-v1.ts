import type { PredictionViolationMeasurementV1 } from '../../attention/prediction-deviation.js';
import type { DistributedMediumSnapshotV1 } from './distributed-physical-contracts.js';
import type { RuntimeMeasuredSalienceV2 } from './distributed-medium-timescale-protocol-v2.js';

/** Runtime-owned inputs.  No caller supplies salience, rate or support mass. */
export interface TrustedRuntimeSalienceInputV1 {
  readonly structureId: string;
  readonly observedAt: number;
  readonly predictionDeviation: PredictionViolationMeasurementV1 | null;
  readonly goalResidualBefore: number;
  readonly goalResidualAfter: number;
}

function finiteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
}

function supportForStructure(snapshot: DistributedMediumSnapshotV1, structureId: string): number {
  if (structureId.startsWith('site:')) {
    const siteId = Number(structureId.slice('site:'.length));
    const site = snapshot.sites.find(value => value.siteId === siteId);
    if (!site) throw new Error(`trusted salience structure is not present: ${structureId}`);
    return site.supportMass;
  }
  if (structureId.startsWith('trace:')) {
    const traceId = structureId.slice('trace:'.length);
    const footprint = snapshot.footprints.find(value => value.traceId === traceId);
    if (!footprint) throw new Error(`trusted salience structure is not present: ${structureId}`);
    return footprint.supportMass;
  }
  if (structureId.startsWith('assembly:')) {
    const assemblyId = structureId.slice('assembly:'.length);
    const assembly = snapshot.coactivationAssemblies?.find(value => value.assemblyId === assemblyId);
    if (!assembly) throw new Error(`trusted salience structure is not present: ${structureId}`);
    return assembly.supportMass;
  }
  const bond = snapshot.learnedBonds.find(value =>
    `bond:${value.fromSiteId}>${value.toSiteId}:${value.kind}` === structureId);
  if (!bond) throw new Error(`trusted salience structure is not present: ${structureId}`);
  return bond.supportMass;
}

/**
 * Converts only trusted runtime measurements into the V2 protocol input.
 * The bridge derives goal relevance and support from its inputs and the
 * captured physical snapshot; it never accepts a caller-provided final rate.
 */
export class RuntimeMeasuredSalienceBridgeV1 {
  capture(snapshot: DistributedMediumSnapshotV1,
    input: TrustedRuntimeSalienceInputV1): RuntimeMeasuredSalienceV2 {
    if (snapshot.version !== 'DistributedMediumSnapshotV1') throw new Error('unsupported salience medium snapshot');
    if (typeof input.structureId !== 'string' || input.structureId.length === 0)
      throw new RangeError('trusted salience structureId must be non-empty');
    finiteNonnegative(input.observedAt, 'trusted salience observedAt');
    finiteNonnegative(input.goalResidualBefore, 'trusted salience goalResidualBefore');
    finiteNonnegative(input.goalResidualAfter, 'trusted salience goalResidualAfter');
    if (input.predictionDeviation !== null) {
      if (input.predictionDeviation.version !== 'PredictionViolationMeasurementV1'
        || input.predictionDeviation.source !== 'attention-physical-comparison')
        throw new Error('invalid attention deviation measurement');
      finiteNonnegative(input.predictionDeviation.magnitude, 'attention deviation magnitude');
      if (input.predictionDeviation.magnitude > 1) throw new RangeError('attention deviation magnitude must be bounded');
    }
    const supportMass = supportForStructure(snapshot, input.structureId);
    finiteNonnegative(supportMass, 'physical support mass');
    return {
      version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
      structureId: input.structureId, observedAt: input.observedAt,
      surpriseMagnitude: input.predictionDeviation?.magnitude ?? 0,
      goalRelevance: Math.max(0, input.goalResidualBefore - input.goalResidualAfter),
      supportMass,
    };
  }
}
