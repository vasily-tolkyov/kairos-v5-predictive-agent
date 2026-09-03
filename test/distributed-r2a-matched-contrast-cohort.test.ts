import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedR2APhysicalPatternV2 }
  from '../src/core/learning/distributed-r2a-physical-contracts.js';
import { distributedR2AConditionDifferentialV1,
  distributedR2APhysicalMatchedContrastV1 }
  from '../src/core/learning/distributed-r2a-physical.js';

function pattern(prefix: readonly (readonly number[])[], action: readonly number[],
  terminal: readonly number[]): Pick<DistributedR2APhysicalPatternV2, 'attractor' | 'corridor'> {
  return {
    attractor: { version: 'DistributedAttractorReadoutV1', coreSiteIds: [...terminal],
      dwellSteps: 90, returnRate: 1, escapeRate: 0, evidenceLevel: 'predictive-stable',
      ambiguous: false, run: { version: 'DistributedFieldRunV1', steps: 180,
        acceptedSteps: 0, rejectedSteps: 0, leaderSiteIds: [], finalActivations: [] } },
    corridor: { orderedPrefixPulseSiteIds: prefix.map(value => [...value]),
      prefixSiteIds: [...new Set(prefix.flat())], actionPulseSiteIds: [[...action]],
      actionSiteIds: [...action], terminalCoreSiteIds: [...terminal],
      corridorCoreSiteIds: [...new Set([...prefix.flat(), ...action, ...terminal])],
      forwardPropagationRate: 1, reverseRejectionRate: 1 },
  };
}

test('three-action R2A differential forms only q from its matched physical contrast cohort', () => {
  const prefix = [[1, 2, 3, 4, 5], [11, 12, 13, 14, 15]] as const;
  const actionA = [21, 22, 23, 24] as const;
  const target = pattern(prefix, actionA, [31, 32, 33, 34]);
  const sameActionContrast = pattern(prefix, actionA, [41, 42, 43, 44]);
  const unrelatedActions = [
    pattern(prefix, [51, 52, 53, 54], [61, 62, 63, 64]),
    pattern(prefix, [71, 72, 73, 74], [81, 82, 83, 84]),
  ];

  assert.equal(distributedR2APhysicalMatchedContrastV1(target, sameActionContrast), true);
  assert(unrelatedActions.every(value =>
    !distributedR2APhysicalMatchedContrastV1(target, value)));

  const q = [201, 202, 203, 204], notQ = [211, 212, 213, 214];
  const pseudo = [221, 222, 223, 224];
  const targetMembers = Array.from({ length: 8 }, () => [...q, ...pseudo]);
  const matchedContrastMembers = Array.from({ length: 8 }, () => [...notQ, ...pseudo]);
  // q is also present in both unrelated-action branches.  The old global
  // comparison therefore diluted the true matched difference to 2/3.
  const unrelatedMembers = Array.from({ length: 16 }, () => [...q, ...pseudo]);
  const oldGlobal = distributedR2AConditionDifferentialV1(q, targetMembers,
    [...matchedContrastMembers, ...unrelatedMembers]);
  assert.equal(oldGlobal.contrastPresence, 2 / 3);
  assert.equal(oldGlobal.qualifies, false);

  const qMatched = distributedR2AConditionDifferentialV1(q, targetMembers,
    matchedContrastMembers);
  const pseudoMatched = distributedR2AConditionDifferentialV1(pseudo, targetMembers,
    matchedContrastMembers);
  assert.deepEqual(qMatched, { memberPresence: 1, contrastPresence: 0, qualifies: true });
  assert.deepEqual(pseudoMatched, { memberPresence: 1, contrastPresence: 1, qualifies: false });
});

test('same action with a non-comparable physical prefix is not a matched contrast', () => {
  const target = pattern([[1, 2, 3, 4, 5]], [21, 22, 23, 24], [31, 32, 33, 34]);
  const nonComparable = pattern([[1, 2, 40, 41, 42]], [21, 22, 23, 24], [51, 52, 53, 54]);
  assert.equal(distributedR2APhysicalMatchedContrastV1(target, nonComparable), false);
});

test('near-identical terminal populations are one noisy branch, not a matched contrast', () => {
  const prefix = [[1, 2, 3, 4, 5]] as const;
  const action = [21, 22, 23, 24] as const;
  const target = pattern(prefix, action, [31, 32, 33, 34, 35, 36, 37, 38]);
  const oneSiteDrift = pattern(prefix, action, [31, 32, 33, 34, 35, 36, 37, 39]);
  const halfDifferent = pattern(prefix, action, [31, 32, 33, 34, 41, 42, 43, 44]);
  assert.equal(distributedR2APhysicalMatchedContrastV1(target, oneSiteDrift), false);
  assert.equal(distributedR2APhysicalMatchedContrastV1(target, halfDifferent), true);
});
