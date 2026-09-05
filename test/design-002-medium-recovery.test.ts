import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedMediumTimescaleStateV2 } from '../src/core/physics/distributed-medium-timescale-state-v2.js';
import { composeDistributedMediumProtocolSnapshotV2 } from '../src/core/physics/distributed-medium-timescale-protocol-v2.js';
import { recoverDistributedMediumProtocolSnapshotV2 } from '../src/core/physics/distributed-medium-recovery-v2.js';

function source() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'recovery-v2', seedHex: '2204' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'trace-a', offset: 0,
    drives: [{ siteId: 0, intensity: 0.8 }] });
  const state = new DistributedMediumTimescaleStateV2();
  return composeDistributedMediumProtocolSnapshotV2(medium.snapshot(), state.snapshot());
}

test('measured salience gives a slower recovery factor without mutating the source snapshot', () => {
  const before = source();
  const neutral = recoverDistributedMediumProtocolSnapshotV2(before, 10);
  const salient = recoverDistributedMediumProtocolSnapshotV2(before, 10, [{
    version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 0, surpriseMagnitude: 4, goalRelevance: 2, supportMass: 1,
  }]);
  assert.deepEqual(before, source());
  assert.ok(salient.medium.sites[0]!.potentialDepth > neutral.medium.sites[0]!.potentialDepth);
  assert.ok(salient.medium.sites[0]!.supportMass > neutral.medium.sites[0]!.supportMass);
  assert.ok(salient.timescale.arousal > 0);
  assert.equal(salient.medium.logicalTime, 10);
});

test('recovery output is byte-stable and rejects measurements outside the interval', () => {
  const before = source();
  const measurement = { version: 'RuntimeMeasuredSalienceV2' as const,
    source: 'trusted-runtime-observation' as const, structureId: 'site:0', observedAt: 2,
    surpriseMagnitude: .2, goalRelevance: .1, supportMass: 1 };
  const left = recoverDistributedMediumProtocolSnapshotV2(before, 4, [measurement]);
  const right = recoverDistributedMediumProtocolSnapshotV2(before, 4, [measurement]);
  assert.deepEqual(left, right);
  assert.throws(() => recoverDistributedMediumProtocolSnapshotV2(before, 1, [{ ...measurement,
    observedAt: 2 }]), /outside recovery interval/);
  assert.throws(() => recoverDistributedMediumProtocolSnapshotV2(before, 4,
    [measurement, { ...measurement, observedAt: 3 }]), /duplicate structure/);
});

test('recovery rejects measurements for structures absent from the captured medium', () => {
  const before = source();
  assert.throws(() => recoverDistributedMediumProtocolSnapshotV2(before, 4, [{
    version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:999999', observedAt: 0, surpriseMagnitude: .4,
    goalRelevance: .2, supportMass: 1,
  }]), /structure is not present/);
});
