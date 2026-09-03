import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { runDistributedMediumProbeBatchSyncV1 }
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
