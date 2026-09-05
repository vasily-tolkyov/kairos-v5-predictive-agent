import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedMediumTimescaleStateV2 } from '../src/core/physics/distributed-medium-timescale-state-v2.js';

test('V2 timescale state is independent, ordered and byte-stable on restore', () => {
  const state = new DistributedMediumTimescaleStateV2();
  state.depositSurpriseFlux(2, 0.8);
  state.recordRehearsal('site-b');
  state.recordRehearsal('site-a');
  const snapshot = state.snapshot();
  assert.equal(snapshot.version, 'DistributedMediumTimescaleSnapshotV2');
  assert.deepEqual(snapshot.rehearsalCounts.map(item => item.structureId), ['site-a', 'site-b']);
  const restored = DistributedMediumTimescaleStateV2.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.throws(() => DistributedMediumTimescaleStateV2.restore({
    ...snapshot, version: 'DistributedMediumSnapshotV1',
  } as unknown as typeof snapshot), /unsupported-timescale-v2-snapshot/);
});

test('V2 state rejects time reversal and caller-provided invalid measurements', () => {
  const state = new DistributedMediumTimescaleStateV2();
  state.advanceTo(3);
  assert.throws(() => state.advanceTo(2), /logical-time-reversed/);
  assert.throws(() => state.depositSurpriseFlux(3, -1), /surprise flux/);
  assert.throws(() => state.depositSurpriseFlux(2, 0), /observation-time-reversed/);
  assert.throws(() => state.recordRehearsal(''), /structureId/);
});

test('V2 restore rejects malformed state and non-canonical law identity', () => {
  const state = new DistributedMediumTimescaleStateV2();
  const snapshot = state.snapshot();
  assert.throws(() => DistributedMediumTimescaleStateV2.restore({
    ...snapshot, arousal: Number.NaN,
  } as unknown as typeof snapshot), /snapshot arousal/);
  assert.throws(() => DistributedMediumTimescaleStateV2.restore({
    ...snapshot, rehearsalCounts: [{ structureId: 4, count: 1 }],
  } as unknown as typeof snapshot), /structureId/);
  assert.throws(() => new DistributedMediumTimescaleStateV2({} as never), /unsupported|identity|weights/);
});
