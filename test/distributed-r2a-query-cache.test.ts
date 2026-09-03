import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedR2APhysicalPatternLearnerV2,
  distributedR2APhysicalApplicabilityCacheKeyV1 } from
  '../src/core/learning/distributed-r2a-physical.js';

test('read-only physical query reuse is byte-identical and its key retains every input', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const before = learner.physicalBranches();
  const firstAudit = learner.physicalQueryCachePerformanceAuditV1();
  const after = learner.physicalBranches();
  const secondAudit = learner.physicalQueryCachePerformanceAuditV1();

  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.equal(secondAudit.restingSubstrateBuildCount,
    firstAudit.restingSubstrateBuildCount,
    'a repeated read rebuilt the resting physical substrate');

  const signals = ['signal-a', 'signal-b', 'signal-c'];
  const key = distributedR2APhysicalApplicabilityCacheKeyV1(7, 'relation-x', signals);
  const parsed = JSON.parse(key) as {
    relationId: string;
    currentSignalIds: string[];
    canonicalCurrentSignalIds: string[];
  };
  assert.equal(parsed.relationId, 'relation-x');
  assert.deepEqual(parsed.currentSignalIds, signals);
  assert.deepEqual(parsed.canonicalCurrentSignalIds,
    ['signal-a', 'signal-b', 'signal-c']);
  assert.notEqual(key,
    distributedR2APhysicalApplicabilityCacheKeyV1(7, 'relation-x', ['signal-a', 'signal-b']));
});
