import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 }
  from '../src/core/prediction/distributed-prediction-clone.js';
import { sha } from '../src/util.js';

function clone(): { readonly sourceSha: string; readonly value: DistributedPredictionCloneV2 } {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'current-binding-test' });
  return { sourceSha: sha(medium.snapshot()), value: new DistributedPredictionCloneV2(medium.snapshot()) };
}

test('sequential-prefix rejects a real prefix whose first pulse is not current perception', () => {
  const { sourceSha, value } = clone();
  const result = value.run({ currentPerceptionSeedSiteIds: [1, 2],
    currentPerceptionMode: 'sequential-prefix', realPrefixSeedSiteIds: [[2, 3]],
    actionSeedSiteIds: [4], readoutAssemblies: [{ assemblyId: 'result', siteIds: [5] }],
    seed: 1n, steps: 2 });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'sequential-prefix-current-perception-mismatch');
  assert.equal(result.fieldRun.steps, 0, 'a mismatched historical prefix entered the physical rollout');
  assert.equal(sha(value.snapshot()), sourceSha, 'rejected binding check mutated the clone snapshot');
});

test('sequential-prefix accepts the same physical population independent of input ordering', () => {
  const { value } = clone();
  const result = value.run({ currentPerceptionSeedSiteIds: [2, 1],
    currentPerceptionMode: 'sequential-prefix', realPrefixSeedSiteIds: [[1, 2]],
    actionSeedSiteIds: [4], readoutAssemblies: [{ assemblyId: 'result', siteIds: [5] }],
    seed: 2n, steps: 2 });
  assert.notEqual(result.reason, 'sequential-prefix-current-perception-mismatch');
  assert.equal(result.fieldRun.steps, 2);
});

test('held-boundary keeps current perception separate from its ordered R2A continuation', () => {
  const { value } = clone();
  const result = value.run({ currentPerceptionSeedSiteIds: [1, 2],
    currentPerceptionMode: 'held-boundary', realPrefixSeedSiteIds: [[2, 3]],
    actionSeedSiteIds: [4], readoutAssemblies: [{ assemblyId: 'result', siteIds: [5] }],
    seed: 3n, steps: 2 });
  assert.notEqual(result.reason, 'sequential-prefix-current-perception-mismatch');
  assert.equal(result.fieldRun.steps, 2);
});
