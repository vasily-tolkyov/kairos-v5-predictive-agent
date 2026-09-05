import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prediction, PublicChange } from '../src/contracts.js';
import { measurePredictionDeviationV1 } from '../src/attention/prediction-deviation.js';

const expected: PublicChange = { subject: 'x', property: 'open', before: false, after: true,
  observationIndex: 1, meaning: 'observed-co-occurrence' };
function prediction(): Prediction {
  return { kind: 'factual-prediction', support: .8, calibratedProbability: false, evidence: {},
    unknown: [], mapSha256: 'test', samples: Array.from({ length: 8 }, (_, seed) => ({ seed,
      traceId: 'real', pageId: 'p', positions: [], readout: [{ sampleStep: 10, kernelIndex: 2,
        distance: .01, potential: -3, changes: [expected] }], reason: null })) };
}

test('unsupported forecasts remain unknown rather than becoming measured surprise', () => {
  assert.equal(measurePredictionDeviationV1(null, [expected]), null);
  assert.equal(measurePredictionDeviationV1({ ...prediction(), support: 0 }, [expected]), null);
});

test('measured deviation is zero inside the supported envelope and positive outside it', () => {
  const within = measurePredictionDeviationV1(prediction(), [expected]);
  const violated = measurePredictionDeviationV1(prediction(), []);
  assert(within);
  assert(violated);
  assert.equal(within.magnitude, 0);
  assert.equal(violated.missingExpectedChangeCount, 1);
  assert(violated.magnitude > 0);
});

