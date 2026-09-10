import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { runDistributedMediumProbeBatchSyncV1, runDistributedMediumProbeSerialV1,
  type DistributedMediumProbeJobV1 }
  from '../src/core/physics/distributed-medium-probe-parallel.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';

function fixture(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'exact-parallel-probes' });
  medium.bindSites('a', [0, 1]); medium.bindSites('b', [100, 101]);
  for (let repetition = 0; repetition < 2; repetition += 1) {
    const episode: DistributedEpisodeV1 = { version: 'DistributedEpisodeV1',
      traceId: `parallel-${repetition}`, provenance: 'trusted-real-event', pulses: [
        { version: 'SparseFieldPulseV1', offset: 0,
          drives: [0, 1].map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', offset: .04,
          drives: [100, 101].map(siteId => ({ siteId, intensity: 1 })) },
      ] };
    medium.applyEpisode(episode);
  }
  return medium;
}

test('parallel probe batches reproduce the exact serial trajectories in input index order', () => {
  const snapshot = fixture().snapshot();
  const jobs = [1n, 2n, 3n, 4n].map((seed, index) => ({ index,
    kind: 'conditioned-sequential' as const, conditionSiteIds: [0, 1],
    seedPulses: [[0, 1], [100, 101]], seed, steps: 32 }));
  const serial = runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 1);
  const parallel = runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 4);
  assert.deepEqual(parallel, serial);
});

test('borrowing a prepared substrate preserves every probe field and leaves learned state unchanged', () => {
  const medium = fixture();
  medium.recover(.8);
  const snapshot = medium.snapshot();
  const common = { seed: 912n, steps: 32, seedPulses: [[0, 1], [100, 101]],
    conditionSiteIds: [0, 1], readoutSiteIds: [100, 101],
    readoutDomainSiteIds: [0, 1, 100, 101] };
  const jobs: DistributedMediumProbeJobV1[] = [
    { ...common, index: 4, kind: 'conditioned-sequential-readout' },
    { ...common, index: 0, kind: 'probe', seedSiteIds: [0, 1] },
    { ...common, index: 3, kind: 'sequential-readout' },
    { ...common, index: 2, kind: 'conditioned-sequential' },
    { ...common, index: 1, kind: 'sequential' },
  ];
  for (const options of [{}, { compactReadout: true, compactSiteIds: [100, 101] }]) {
    const copied = runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 1, options);
    const borrowed = runDistributedMediumProbeSerialV1(medium, jobs, options);
    assert.deepEqual(borrowed, copied);
    assert.deepEqual(medium.snapshot(), snapshot);
  }
});

test('joint matched-arm batches preserve independent full, changed and ablated trajectories', () => {
  const medium = fixture(), snapshot = medium.snapshot();
  const conditions = [[0, 1], [100, 101], []];
  const arms: DistributedMediumProbeJobV1[][] = conditions.map(conditionSiteIds =>
    [17n, 3n, 9n, 4n].map((seed, index) => {
      const common = { index, seedPulses: [[0, 1], [100, 101]], seed, steps: 32 };
      return conditionSiteIds.length > 0 ? { ...common, kind: 'conditioned-sequential', conditionSiteIds }
        : { ...common, kind: 'sequential' };
    }));
  // Production used a separately restored immutable snapshot for every arm;
  // compare with that exact entry point, not the pre-snapshot training object
  // (whose insertion order is not the canonical restored bond order).
  const separate = arms.flatMap(jobs => runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 1));
  const together = arms.flat().map((job, index) => ({ ...job, index }));
  assert.deepEqual(runDistributedMediumProbeBatchSyncV1(snapshot, together, 3), separate);
  assert.deepEqual(medium.snapshot(), snapshot);
});
