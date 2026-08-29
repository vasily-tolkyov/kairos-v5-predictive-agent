import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePublicPrediction, AttentionMonitor } from '../src/attention/monitor.js';
import { Compute } from '../src/compute.js';
import type { Prediction, PublicChange, Observation } from '../src/contracts.js';

const change: PublicChange = { subject: 'x', property: 'open', before: false, after: true, observationIndex: 1, meaning: 'observed-co-occurrence' };
test('absence of a physically predicted change is surprise; unknown or low support never becomes a violation', () => {
  const prediction: Prediction = { kind: 'factual-prediction', support: .8, calibratedProbability: false, evidence: {}, unknown: [], mapSha256: 'test',
    samples: Array.from({ length: 8 }, (_, seed) => ({ seed, traceId: 'real', pageId: 'p', positions: [],
      readout: [{ sampleStep: 10, kernelIndex: 2, distance: .01, potential: -3, changes: [change] }], reason: null })) };
  assert.equal(comparePublicPrediction(prediction, []), 'prediction-violation');
  assert.equal(comparePublicPrediction(prediction, [change]), 'within-envelope');
  assert.equal(comparePublicPrediction({ ...prediction, support: 0 }, []), 'unknown-change');
  assert.equal(comparePublicPrediction(null, [change]), 'unknown-change');
});
test('real public changes go through the production attention controller and wake callback without a hand-authored forecast', async () => {
  const compute = new Compute(), wakes: unknown[] = [], captured: unknown[] = [];
  try {
    const monitor = new AttentionMonitor(compute, () => {}, notice => wakes.push(notice), event => captured.push(event));
    monitor.bindActionTarget('self');
    const frames: Observation[] = Array.from({ length: 21 }, (_, sequence) => ({ sequence, activeSeconds: sequence * .05,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} }, targetId: null, contextId: 'synthetic',
      objects: [{ id: 'external', type: 'opaque-object', relativePosition: [1, 0, 0], properties: { open: sequence > 10, lit: sequence > 10 } }] }));
    frames.forEach(frame => monitor.accept(frame)); monitor.check();
    assert.equal(monitor.controller.snapshot().focusTargetId, 'external'); assert(wakes.length > 0); assert.equal(captured.length, 1);
    assert.equal((wakes[0] as { kind: string }).kind, 'unknown-change');
    await compute.call('status');
    await new Promise<void>(resolve => setImmediate(resolve));
    for (let sequence = 21; sequence <= 40; sequence++) monitor.accept({ ...frames[20]!, sequence, activeSeconds: sequence * .05 });
    assert(monitor.controller.snapshot().scores.every(score => score.score.predictionDeviationKnown === false));
  } finally { await compute.close(); }
});
