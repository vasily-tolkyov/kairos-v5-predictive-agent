import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMeasuredSalienceBridgeV1 } from '../src/core/physics/runtime-measured-salience-bridge-v1.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';

function snapshot() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'bridge', seedHex: '2701' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'bridge-trace', offset: 0,
    drives: [{ siteId: 0, intensity: .8 }] });
  return medium.snapshot();
}

test('runtime bridge derives salience inputs from attention, goal residual and physical support', () => {
  const deviation = { version: 'PredictionViolationMeasurementV1' as const,
    source: 'attention-physical-comparison' as const, expectedChangeCount: 1,
    missingExpectedChangeCount: 1, unexpectedChangeCount: 0, magnitude: .75 };
  const result = new RuntimeMeasuredSalienceBridgeV1().capture(snapshot(), {
    structureId: 'site:0', observedAt: 3, predictionDeviation: deviation,
    goalResidualBefore: .9, goalResidualAfter: .2,
  });
  assert.deepEqual(result, { version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 3, surpriseMagnitude: .75,
    goalRelevance: .7, supportMass: snapshot().sites[0]!.supportMass });
});

test('runtime bridge rejects unknown structures and caller-provided invalid attention values', () => {
  const bridge = new RuntimeMeasuredSalienceBridgeV1();
  assert.throws(() => bridge.capture(snapshot(), { structureId: 'site:999999', observedAt: 0,
    predictionDeviation: null, goalResidualBefore: 0, goalResidualAfter: 0 }), /not present/);
  assert.throws(() => bridge.capture(snapshot(), { structureId: 'site:0', observedAt: 0,
    predictionDeviation: { version: 'PredictionViolationMeasurementV1', source: 'attention-physical-comparison',
      expectedChangeCount: 1, missingExpectedChangeCount: 0, unexpectedChangeCount: 1, magnitude: 2 },
    goalResidualBefore: 0, goalResidualAfter: 0 }), /bounded/);
});
