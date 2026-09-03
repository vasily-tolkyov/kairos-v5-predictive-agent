import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1, MediumCapacityExhaustedError,
  distributedMediumConfig } from '../src/core/physics/distributed-physical-medium.js';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1,
  SparseFieldPulseV1 } from '../src/core/physics/distributed-physical-contracts.js';
import { SplitMix64 } from '../src/core/random.js';
import { sha } from '../src/util.js';

function fresh(seed = '0011223344556677'): DistributedPhysicalMedium3DV1 {
  return new DistributedPhysicalMedium3DV1(distributedMediumConfig('test', seed));
}

function episode(traceId: string, groups: readonly (readonly number[])[]): DistributedEpisodeV1 {
  return {
    version: 'DistributedEpisodeV1',
    traceId,
    provenance: 'trusted-real-event',
    pulses: groups.map((siteIds, offset) => ({
      version: 'SparseFieldPulseV1',
      pulseId: `${traceId}:pulse:${offset}`,
      offset: offset * .04,
      drives: siteIds.map(siteId => ({ siteId, intensity: 1 })),
    })),
  };
}

function sums(snapshot: DistributedMediumSnapshotV1): {
  potential: number; activation: number; support: number; learned: number;
} {
  return {
    potential: snapshot.sites.reduce((sum, site) => sum + site.potentialDepth, 0),
    activation: snapshot.sites.reduce((sum, site) => sum + Math.abs(site.activation), 0),
    support: snapshot.sites.reduce((sum, site) => sum + site.supportMass, 0),
    learned: snapshot.learnedBonds.reduce((sum, bond) => sum + bond.symmetricCoupling
      + bond.directedConductance + bond.supportMass, 0),
  };
}

function train(repetitions: number): { medium: DistributedPhysicalMedium3DV1;
  groups: readonly (readonly number[])[] } {
  const medium = fresh();
  const ids = medium.allocateSites(16, new SplitMix64(0xabcden));
  medium.bindSites('opaque-afferent-a', ids.slice(0, 8));
  medium.bindSites('opaque-afferent-b', ids.slice(8));
  const groups = [ids.slice(0, 8), ids.slice(8)] as const;
  for (let index = 0; index < repetitions; index += 1)
    medium.applyEpisode(episode(`opaque-real-${index}`, groups));
  return { medium, groups };
}

test('G1 starts as one auditable 32^3 continuous tile with local connectivity', () => {
  const snapshot = fresh().snapshot();
  assert.equal(snapshot.tiles.length, 1);
  assert.equal(snapshot.config.tileSize, 32);
  assert.equal(snapshot.config.maxTiles, 32);
  assert.equal(snapshot.sites.length, 32 ** 3,
    'a 32^3 substrate was reduced to a sparse coordinate table');
  assert(snapshot.localBondCount > snapshot.sites.length,
    'the lattice does not expose its local physical neighbourhood');
});

test('G1 repeated real episodes monotonically deepen sites, support, and plastic channels', () => {
  const measurements = [1, 2, 4, 8].map(count => sums(train(count).medium.snapshot()));
  for (let index = 1; index < measurements.length; index += 1) {
    assert(measurements[index]!.potential > measurements[index - 1]!.potential);
    assert(measurements[index]!.support > measurements[index - 1]!.support);
    assert(measurements[index]!.learned > measurements[index - 1]!.learned);
  }
});

test('G1 identical seeds and inputs reproduce every physical site and bond byte-for-byte', () => {
  const left = train(4).medium.snapshot();
  const right = train(4).medium.snapshot();
  assert.equal(sha(left), sha(right));
  assert.deepEqual(left, right);
});

test('G1 zero-input dynamics and long recovery erase fast activation before repeated structure', () => {
  const single = train(1).medium;
  const repeated = train(8).medium;
  const pulse: SparseFieldPulseV1 = { version: 'SparseFieldPulseV1', pulseId: 'decay-probe', offset: 0,
    drives: train(1).groups[0]!.map(siteId => ({ siteId, intensity: 1 })) };
  single.applyPulse(pulse); repeated.applyPulse(pulse);
  const active = sums(single.snapshot()).activation;
  single.settle(0x100n, 2_000); repeated.settle(0x100n, 2_000);
  assert(sums(single.snapshot()).activation < active,
    'fast activation did not dissipate under zero external drive');
  single.recover(250); repeated.recover(250);
  const one = sums(single.snapshot()), eight = sums(repeated.snapshot());
  assert(eight.potential > one.potential && eight.support > one.support,
    'one-off and repeated traces have the same recovery lifetime');
});

test('G1 connection, potential, and metadata-only ablations remove distinct capabilities', () => {
  const { medium, groups } = train(8);
  const learned = medium.snapshot();
  const querySnapshot: DistributedMediumSnapshotV1 = {
    ...structuredClone(learned),
    sites: learned.sites.map(site => ({ ...site, activation: 0 })),
  };
  const baseline = DistributedPhysicalMedium3DV1.fromSnapshot(querySnapshot)
    .probe(groups[0]!, 0x55n, 500);
  assert(learned.learnedBonds.length > 0);
  assert(baseline.coreSiteIds.length > 0 && baseline.dwellSteps > 0);
  const targetActivation = (run: typeof baseline.run): number => {
    const target = new Set(groups[1]!);
    return run.finalActivations.reduce((sum, value) => target.has(value.siteId)
      ? sum + Math.max(0, value.activation) : sum, 0);
  };

  const noConnections = structuredClone(querySnapshot) as DistributedMediumSnapshotV1;
  (noConnections as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const disconnected = DistributedPhysicalMedium3DV1.fromSnapshot(noConnections)
    .probe(groups[0]!, 0x55n, 500);
  assert(targetActivation(disconnected.run) < targetActivation(baseline.run),
    'clearing learned connections did not damage physical source-to-target propagation');

  const noPotential = structuredClone(querySnapshot) as DistributedMediumSnapshotV1;
  for (const site of noPotential.sites as unknown as Array<{ potentialDepth: number }>) site.potentialDepth = 0;
  const flat = DistributedPhysicalMedium3DV1.fromSnapshot(noPotential)
    .probe(groups[0]!, 0x55n, 500);
  assert(flat.returnRate < baseline.returnRate || flat.dwellSteps < baseline.dwellSteps,
    'clearing potential did not damage anchor residence');

  const metadataOnly = structuredClone(noPotential) as DistributedMediumSnapshotV1;
  (metadataOnly as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  for (const site of metadataOnly.sites as unknown as Array<{ activation: number; supportMass: number }>) {
    site.activation = 0; site.supportMass = 0;
  }
  const empty = DistributedPhysicalMedium3DV1.fromSnapshot(metadataOnly)
    .probe(groups[0]!, 0x55n, 500);
  assert.equal(empty.coreSiteIds.length, 0,
    'binding metadata alone reconstructed a physical attractor');
});

test('G1 bounded growth fails explicitly instead of overwriting or remapping old sites', () => {
  const tiny = new DistributedPhysicalMedium3DV1({
    ...distributedMediumConfig('test', '77'), maxTiles: 1,
  });
  const firstCoordinates = [0, 31, 32 ** 3 - 1].map(id => [...tiny.site(id).coordinate]);
  assert.throws(() => tiny.allocateSites(32 ** 3 + 1, new SplitMix64(3n)), MediumCapacityExhaustedError);
  assert.deepEqual([0, 31, 32 ** 3 - 1].map(id => [...tiny.site(id).coordinate]), firstCoordinates,
    'tile expansion moved an old physical site');
});
