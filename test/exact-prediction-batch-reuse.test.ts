import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../src/core/prediction/distributed-prediction-clone.js';
import { sha } from '../src/util.js';

test('alternating exact branch batches do not evict each other and bounded eviction only recomputes', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'alternating-batches' });
  medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId: 'e', provenance: 'trusted-real-event',
    pulses: [[0, 1], [100, 101]].map((sites, offset) => ({ version: 'SparseFieldPulseV1', offset: offset * .04,
      drives: sites.map(siteId => ({ siteId, intensity: 1 })) })) });
  const snapshot = medium.snapshot(), clone = new DistributedPredictionCloneV2(snapshot);
  const request = (seed: bigint) => ({ currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary' as const, actionSeedSiteIds: [0, 1], steps: 12,
    seeds: [seed], readoutAssemblies: [{ assemblyId: 'a', siteIds: [100, 101] }] });
  const run = clone.run.bind(clone); let actualRuns = 0;
  clone.run = value => { actualRuns++; return run(value); };
  const a = clone.runManyReadOnly(request(1n)), b = clone.runManyReadOnly(request(2n));
  assert.strictEqual(clone.runManyReadOnly(request(1n)), a);
  assert.equal(actualRuns, 2, 'A/B/A must not repeat the identical seeded physical experiment');
  clone.runManyReadOnly(request(3n)); clone.runManyReadOnly(request(4n));
  assert.strictEqual(clone.runManyReadOnly(request(1n)), a);
  clone.runManyReadOnly(request(5n)); // Four exact entries: B is now least recently used.
  assert.strictEqual(clone.runManyReadOnly(request(1n)), a);
  assert.equal(actualRuns, 5);
  const recomputed = clone.runManyReadOnly(request(2n));
  assert.equal(actualRuns, 6);
  assert.deepEqual(recomputed, b);
  assert.deepEqual(recomputed, new DistributedPredictionCloneV2(snapshot).runMany(request(2n)));
  assert.equal(sha(medium.snapshot()), sha(snapshot));
});

test('identical seeded physical batches reuse exact results without sharing mutable outputs', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'exact-batch' });
  for (let i = 0; i < 8; i++) medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId: `e${i}`,
    provenance: 'trusted-real-event', pulses: [[0, 1], [100, 101]].map((sites, offset) => ({
      version: 'SparseFieldPulseV1', offset: offset * .04,
      drives: sites.map(siteId => ({ siteId, intensity: 1 })) })) });
  const snapshot = medium.snapshot(), before = sha(snapshot), clone = new DistributedPredictionCloneV2(snapshot);
  const request = { currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary' as const, actionSeedSiteIds: [0, 1], steps: 180,
    seeds: [1n, 2n, 3n], readoutAssemblies: [{ assemblyId: 'a', siteIds: [100, 101] }] };
  const original = clone.run.bind(clone);
  let actualRuns = 0;
  clone.run = value => { actualRuns++; return original(value); };
  const first = clone.runMany(request), exact = sha(first);
  const borrowed = clone.runManyReadOnly(request);
  assert.strictEqual(clone.runManyReadOnly(request), borrowed);
  assert.equal(sha(borrowed), exact);
  assert.throws(() => (borrowed[0]!.reachedAssemblyIds as string[]).push('forbidden'), TypeError);
  assert.equal(actualRuns, 3);
  assert.equal(sha(first), sha(new DistributedPredictionCloneV2(snapshot).runMany(request)));
  // Caller-owned results and inputs are deliberately mutated to verify the
  // cache owns values, rather than mistaking object identity for immutability.
  (first[0]!.reachedAssemblyIds as string[]).push('caller-only');
  const second = clone.runMany(structuredClone(request));
  assert.equal(actualRuns, 3, 'an identical batch unnecessarily resimulated its seeds');
  assert.equal(sha(second), exact);
  request.seeds[0] = 4n;
  assert.equal(sha(clone.runMany(request)), sha(new DistributedPredictionCloneV2(snapshot).runMany(request)));
  assert.equal(actualRuns, 6, 'different random seeds reused an old trajectory');
  request.readoutAssemblies[0]!.siteIds = [300, 301];
  assert.equal(sha(clone.runMany(request)), sha(new DistributedPredictionCloneV2(snapshot).runMany(request)));
  assert.equal(actualRuns, 9, 'a changed measuring region reused an old readout');
  const other = new DistributedPredictionCloneV2({ ...snapshot, learnedBonds: [],
    sites: snapshot.sites.map(site => ({ ...site, potentialDepth: 0, supportMass: 0, activation: 0 })) });
  assert(other.runMany(request).every(result => result.status === 'unknown'));
  assert.equal(sha(medium.snapshot()), before);
});
