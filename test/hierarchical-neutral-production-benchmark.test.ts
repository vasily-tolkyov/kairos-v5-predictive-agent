import test from 'node:test';
import assert from 'node:assert/strict';
import { runHierarchicalNeutralProductionBenchmarkV1 } from
  '../src/evaluation/hierarchical-neutral-production-benchmark-v1.js';

test('production hierarchy separates ordered multi-R1 chains across 64 training and 32 heldout events for eight seeds', () => {
  const result = runHierarchicalNeutralProductionBenchmarkV1();
  assert.equal(result.seeds.length, 8);
  assert.equal(result.seeds.every(seed => seed.trainingEventCount === 64
    && seed.heldoutEventCount === 32), true);
  assert.equal(result.repeatedRunDeterministic, true);
  assert(result.minimumBoundaryF1 >= 0.95, JSON.stringify(result));
  assert(result.minimumSameChainDifferentChainAuc >= 0.90, JSON.stringify(result));
  assert(result.minimumReverseRejectionRate >= 0.90, JSON.stringify(result));
  assert(result.minimumMultiAtomEligibleRate >= 0.95, JSON.stringify(result));
  assert.equal(result.seeds.every(seed => seed.equivalentAcceptanceRate === 1
    && seed.missingStepRejectionRate === 1
    && seed.replacedStepRejectionRate === 1
    && seed.heldoutAtomIdentityOverlapCount === 0), true, JSON.stringify(result));
  assert.equal(result.seeds.every(seed => seed.stablePatternCount === 2
    && seed.predictiveStablePatternCount === 2), true, JSON.stringify(result));
  assert.equal(result.allQueriesReadOnly, true);
  assert.equal(result.learnerFacingForbiddenFieldCount, 0);
});
