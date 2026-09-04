import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { sha } from '../src/util.js';

test('PLAN-002 read-only batch surfaces preserve an empty snapshot', async () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const before = sha(memory.snapshot());
  const probe = memory.probePhysicalSeedsSyncV1('r1', [], 2);
  const prediction = await memory.predictPhysicalSeedsParallelV1({
    medium: 'r1',
    request: {
      currentPerceptionSeedSiteIds: [], currentPerceptionMode: 'sequential-prefix',
      realPrefixSeedSiteIds: [], actionSeedSiteIds: [], readoutAssemblies: [], steps: 1,
    },
    seeds: [], parallelism: 2,
  });
  assert.deepEqual(probe, []);
  assert.deepEqual(prediction, []);
  assert.equal(sha(memory.snapshot()), before);
});

test('PLAN-002 rejects invalid explicit parallelism instead of silently degrading', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  assert.throws(() => memory.probePhysicalSeedsSyncV1('r1', [], 0),
    /parallelism must be a positive integer/);
});

test('PLAN-002 exact probe workers preserve indexed order', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const before = sha(memory.snapshot());
  const result = memory.probePhysicalSeedsSyncV1('r1', [
    { index: 1, kind: 'probe', seedSiteIds: [0], seed: 2n, steps: 2 },
    { index: 0, kind: 'probe', seedSiteIds: [0], seed: 1n, steps: 2 },
  ], 2);
  assert.equal(result.length, 2);
  assert.equal(result[0]!.run.steps, 2);
  assert.equal(result[1]!.run.steps, 2);
  assert.equal(sha(memory.snapshot()), before);
});
