import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1,
  normalizeDistributedProbePulseV1 } from '../src/core/physics/distributed-physical-medium.js';
import { runDistributedMediumProbeBatchSyncV1 }
  from '../src/core/physics/distributed-medium-probe-parallel.js';
import type { DistributedEpisodeV1, SparseFieldDriveV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { sha } from '../src/util.js';

function fixture(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'weighted-probe' });
  const episode: DistributedEpisodeV1 = {
    version: 'DistributedEpisodeV1', traceId: 'weighted-road', provenance: 'trusted-real-event',
    pulses: [
      { version: 'SparseFieldPulseV1', offset: 0,
        drives: [0, 1].map(siteId => ({ siteId, intensity: 1 })) },
      { version: 'SparseFieldPulseV1', offset: .04,
        drives: [100, 101].map(siteId => ({ siteId, intensity: 1 })) },
    ],
  };
  medium.applyEpisode(episode);
  return medium;
}

test('weighted probe normalization preserves amplitudes and merges converging wires by max', () => {
  const weighted: readonly SparseFieldDriveV1[] = [
    { siteId: 4, intensity: .25 }, { siteId: 4, intensity: .75 },
    { siteId: 2, intensity: .5 },
  ];
  assert.deepEqual(normalizeDistributedProbePulseV1(weighted), [
    { siteId: 2, intensity: .5 }, { siteId: 4, intensity: .75 },
  ]);
  assert.deepEqual(normalizeDistributedProbePulseV1([2, 4]), [
    { siteId: 2, intensity: 1 }, { siteId: 4, intensity: 1 },
  ]);
  assert.throws(() => normalizeDistributedProbePulseV1([2, 2]), /unique site ids/);
  assert.throws(() => normalizeDistributedProbePulseV1([
    { siteId: 2, intensity: 0 },
  ]), /invalid weighted drive/);
});

test('sequential and conditioned weighted probes are read-only and deterministic', () => {
  const medium = fixture();
  const before = sha(medium.snapshot());
  const pulses = [
    [{ siteId: 0, intensity: .25 }, { siteId: 1, intensity: .75 }],
    [{ siteId: 100, intensity: .8 }, { siteId: 101, intensity: .4 }],
  ] as const;
  const sequential = medium.probeSequential(pulses, 41n, 32);
  const conditioned = medium.probeConditionedSequence(
    [{ siteId: 0, intensity: .6 }, { siteId: 1, intensity: .3 }], pulses, 41n, 32);
  assert.equal(sequential.version, 'DistributedAttractorReadoutV1');
  assert.equal(conditioned.version, 'DistributedAttractorReadoutV1');
  assert.equal(sha(medium.snapshot()), before);
  assert.deepEqual(medium.probeSequential(pulses, 41n, 32), sequential);
  assert.deepEqual(medium.probeConditionedSequence(
    [{ siteId: 0, intensity: .6 }, { siteId: 1, intensity: .3 }], pulses, 41n, 32), conditioned);
});

test('weighted seed amplitude is not flattened to legacy unit intensity', () => {
  const low = new DistributedPhysicalMedium3DV1({ name: 'weighted-amplitude-low' })
    .probeSequential([[{ siteId: 0, intensity: .25 }]], 7n, 1);
  const unit = new DistributedPhysicalMedium3DV1({ name: 'weighted-amplitude-unit' })
    .probeSequential([[{ siteId: 0, intensity: 1 }]], 7n, 1);
  const lowSite = low.run.finalActivations.find(value => value.siteId === 0)?.activation ?? 0;
  const unitSite = unit.run.finalActivations.find(value => value.siteId === 0)?.activation ?? 0;
  assert(lowSite > 0 && lowSite < unitSite);
});

test('weighted parallel probes exactly match serial probes', () => {
  const snapshot = fixture().snapshot();
  const jobs = [1n, 2n, 3n, 4n].map((seed, index) => ({ index,
    kind: 'conditioned-sequential' as const,
    conditionSiteIds: [{ siteId: 0, intensity: .6 }, { siteId: 1, intensity: .3 }],
    seedPulses: [
      [{ siteId: 0, intensity: .25 }, { siteId: 1, intensity: .75 }],
      [{ siteId: 100, intensity: .8 }, { siteId: 101, intensity: .4 }],
    ], seed, steps: 32,
  }));
  const serial = runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 1);
  const parallel = runDistributedMediumProbeBatchSyncV1(snapshot, jobs, 4);
  assert.deepEqual(parallel, serial);
});
