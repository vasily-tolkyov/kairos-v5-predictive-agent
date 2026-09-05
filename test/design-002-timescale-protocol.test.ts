import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedMediumTimescaleStateV2 } from '../src/core/physics/distributed-medium-timescale-state-v2.js';
import {
  composeDistributedMediumProtocolSnapshotV2,
  measuredRecoveryRateV2,
  measuredStructureExistsV2,
  restoreDistributedMediumProtocolSnapshotV2,
  validateTimescaleMeasurementBatchV2,
  type RuntimeMeasuredSalienceV2,
} from '../src/core/physics/distributed-medium-timescale-protocol-v2.js';

function mediumSnapshot() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'timescale-v2', seedHex: '2202' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'trace-a', offset: 0,
    drives: [{ siteId: 0, intensity: 0.8 }] });
  return medium.snapshot();
}

function measurement(observedAt: number): RuntimeMeasuredSalienceV2 {
  return { version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt, surpriseMagnitude: 0.4, goalRelevance: 0.2, supportMass: 1 };
}

test('V2 protocol envelope restores byte-stable medium and time state', () => {
  const medium = mediumSnapshot();
  const state = new DistributedMediumTimescaleStateV2();
  state.advanceTo(medium.logicalTime);
  const snapshot = composeDistributedMediumProtocolSnapshotV2(medium, state.snapshot());
  const restored = restoreDistributedMediumProtocolSnapshotV2(snapshot);
  assert.deepEqual(restored.medium, medium);
  assert.deepEqual(restored.timescale, state.snapshot());
  assert.equal(measuredStructureExistsV2(medium, measurement(0)), true);
  assert.equal(measuredStructureExistsV2(medium, { ...measurement(0), structureId: 'site:999999' }), false);
});

test('ordered measured inputs derive recovery without accepting a final salience', () => {
  validateTimescaleMeasurementBatchV2({ version: 'TimescaleMeasurementBatchV2', observations: [measurement(0), measurement(1)] });
  const state = new DistributedMediumTimescaleStateV2();
  const rate = measuredRecoveryRateV2(state, measurement(1));
  assert.ok(rate > 0 && rate <= 0.002);
  assert.throws(() => validateTimescaleMeasurementBatchV2({
    version: 'TimescaleMeasurementBatchV2', observations: [measurement(2), measurement(1)],
  }), /out of order/);
  assert.throws(() => measuredRecoveryRateV2(state,
    { ...measurement(1), source: 'caller-provided' as RuntimeMeasuredSalienceV2['source'] }), /invalid runtime/);
});

test('law identity and time ordering are strict snapshot boundaries', () => {
  const medium = mediumSnapshot();
  const state = new DistributedMediumTimescaleStateV2();
  state.advanceTo(medium.logicalTime);
  const snapshot = composeDistributedMediumProtocolSnapshotV2(medium, state.snapshot());
  assert.throws(() => restoreDistributedMediumProtocolSnapshotV2({ ...snapshot, lawIdentitySha256: 'bad' }), /law identity/);
  const ahead = new DistributedMediumTimescaleStateV2();
  ahead.advanceTo(medium.logicalTime + 1);
  assert.throws(() => composeDistributedMediumProtocolSnapshotV2(medium, ahead.snapshot()), /logical time must match/);
});
