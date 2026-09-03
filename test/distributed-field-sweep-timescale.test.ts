import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';

function populationFixture(populationSize: number): DistributedMediumSnapshotV1 {
  const medium = new DistributedPhysicalMedium3DV1({
    name: `sweep-timescale-${populationSize}`,
    seedHex: '2e93d70a40d5e7c1',
  });
  const sources = Array.from({ length: populationSize }, (_, index) => 128 + index);
  const terminals = Array.from({ length: populationSize }, (_, index) => 1024 + index);
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const episode: DistributedEpisodeV1 = {
      version: 'DistributedEpisodeV1',
      traceId: `population-transition-${repetition}`,
      provenance: 'trusted-real-event',
      pulses: [
        { version: 'SparseFieldPulseV1', pulseId: `source-${repetition}`, offset: 0,
          drives: sources.map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', pulseId: `terminal-${repetition}`, offset: .04,
          drives: terminals.map(siteId => ({ siteId, intensity: 1 })) },
      ],
    };
    medium.applyEpisode(episode);
  }
  const snapshot = medium.snapshot();
  for (const site of snapshot.sites as unknown as Array<{ siteId: number; activation: number }>) {
    site.activation = sources.includes(site.siteId) ? 1 : 0;
  }
  return snapshot;
}

test('one physical field tick gives a distributed active population a local proposal sweep', () => {
  const snapshot = populationFixture(32);
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot);
  const run = medium.settle(0x5aa5n, 1);
  assert(run.acceptedSteps + run.rejectedSteps >= 32,
    'one tick updated only one randomly selected site, so physical time slowed with population size');
});

test('population sweeps remain byte-reproducible for a fixed seed', () => {
  const snapshot = populationFixture(32);
  const left = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot);
  const right = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot);
  const leftRun = left.settle(0x9b7n, 8);
  const rightRun = right.settle(0x9b7n, 8);
  assert.deepEqual(leftRun, rightRun);
  assert.equal(sha(left.snapshot()), sha(right.snapshot()));
});
