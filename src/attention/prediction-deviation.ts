import type { Prediction, PublicChange } from '../contracts.js';

export interface PredictionViolationMeasurementV1 {
  readonly version: 'PredictionViolationMeasurementV1';
  readonly source: 'attention-physical-comparison';
  readonly expectedChangeCount: number;
  readonly missingExpectedChangeCount: number;
  readonly unexpectedChangeCount: number;
  /** Bounded mismatch magnitude; zero means no measured deviation. */
  readonly magnitude: number;
}

function consistentChange(expected: PublicChange, actual: PublicChange): boolean {
  if (expected.subject !== actual.subject || expected.property !== actual.property) return false;
  if (typeof expected.before === 'number' && typeof expected.after === 'number'
    && typeof actual.before === 'number' && typeof actual.after === 'number') {
    return Math.sign(expected.after - expected.before) === Math.sign(actual.after - actual.before);
  }
  return expected.after === actual.after;
}

/**
 * Derive surprise from the measured difference between a supported forecast
 * envelope and the real public changes. Unsupported forecasts intentionally
 * produce no measurement; they are unknown, not violated.
 */
export function measurePredictionDeviationV1(prediction: Prediction | null,
  actual: readonly PublicChange[]): PredictionViolationMeasurementV1 | null {
  if (!prediction || prediction.support < .5 || prediction.samples.length < 8) return null;
  const expected = prediction.samples.flatMap(sample => sample.readout.flatMap(read => read.changes));
  if (expected.length === 0) return null;
  const supportedByKey = expected.filter(change => prediction.samples
    .filter(sample => sample.readout.some(read => read.changes.some(candidate => consistentChange(change, candidate))))
    .length / prediction.samples.length >= .6);
  const supported = [...new Map(supportedByKey.map(change => [
    JSON.stringify([change.subject, change.property, change.before, change.after]), change,
  ] as const)).values()];
  if (supported.length === 0) return null;
  const missing = supported.filter(expectedChange => expectedChange.before !== expectedChange.after
    && !actual.some(change => consistentChange(expectedChange, change))).length;
  const unexpected = actual.filter(change => !supported.some(expectedChange => consistentChange(expectedChange, change))).length;
  const denominator = Math.max(1, supported.filter(change => change.before !== change.after).length + actual.length);
  return { version: 'PredictionViolationMeasurementV1', source: 'attention-physical-comparison',
    expectedChangeCount: supported.length, missingExpectedChangeCount: missing,
    unexpectedChangeCount: unexpected, magnitude: Math.min(1, (missing + unexpected) / denominator) };
}
