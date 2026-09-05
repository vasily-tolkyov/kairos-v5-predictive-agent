import assert from 'node:assert/strict';
import test from 'node:test';
import { Compute } from '../src/compute.js';
import { DistributedHierarchicalPhysicalMemoryV1, type KairosV5DistributedPhysicalMemoryV3 }
  from '../src/distributed-hierarchical-memory.js';
import type { Observation, RealEvent } from '../src/contracts.js';

function measurementEvent(id: string): RealEvent {
  const frames: Observation[] = [0, 1].map(index => ({ sequence: index,
    activeSeconds: (index + 1) * .05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [], targetId: null, contextId: 'runtime-measurement-fixture' }));
  return { version: 'RealEventV5', id,
    cue: { kind: 'wait', parameters: { ticks: 1 }, targetRole: null }, frames,
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'wait', parameters: { ticks: 1 } }, executed: true,
      status: 'completed', startSequence: 0, endSequence: 1 } };
}

const deviation = { version: 'PredictionViolationMeasurementV1' as const,
  source: 'attention-physical-comparison' as const, expectedChangeCount: 1,
  missingExpectedChangeCount: 1, unexpectedChangeCount: 0, magnitude: .5 };

test('V4 runtime measurements resolve trusted event structures without creating evidence', async () => {
  const compute = new Compute();
  try {
    await compute.enableTimescaleV2();
    const event = measurementEvent('runtime-measurement-event-1');
    await compute.call('observe', event);
    const before = await compute.call<KairosV5DistributedPhysicalMemoryV3>('snapshot');
    await compute.recordRuntimeMeasurement({ version: 'TrustedRuntimeMeasurementContextV1',
      eventId: event.id, observedAt: .2, goalResidualBefore: 1, goalResidualAfter: .25,
      predictionDeviation: deviation });
    const after = await compute.call<KairosV5DistributedPhysicalMemoryV3>('snapshot');
    const snapshot = await compute.snapshotV4();
    assert.deepEqual(after.r1.records, before.r1.records);
    assert.deepEqual(after.annotations, before.annotations);
    assert.deepEqual(after.seenEventIds, before.seenEventIds);
    assert.equal(after.writes, before.writes);
    assert.deepEqual(after.r1Medium.footprints.map(value => value.traceId),
      before.r1Medium.footprints.map(value => value.traceId));
    assert(snapshot.timescales.r1.timescale.measuredStructures.some(value =>
      value.structureId.startsWith('trace:')));
    assert(snapshot.timescales.r1.timescale.arousal > 0);
    assert.equal(snapshot.activeSeconds, .2);
    assert.equal(snapshot.timescales.r1.timescale.logicalTime, .2);
  } finally {
    await compute.close();
  }
});

test('runtime measurements remain unavailable on the default V3 path', async () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  assert.throws(() => memory.recordRuntimeMeasurement({
    version: 'TrustedRuntimeMeasurementContextV1', eventId: 'not-observed', observedAt: 0,
    goalResidualBefore: 1, goalResidualAfter: 1, predictionDeviation: null,
  }), /runtime measurements require V4 timescale owner/);
});
