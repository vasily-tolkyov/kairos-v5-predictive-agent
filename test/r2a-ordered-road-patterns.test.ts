import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionDistributedR2AOrderedRoadsV1, distributedPhysicalBranchReadoutAssembliesV1 }
  from '../src/core/learning/distributed-r2a-physical.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';

test('the same terminal and last action do not erase different earlier actions', () => {
  const inputs = [
    { id: 'a', actionPulseSiteIds: [[1, 2], [8, 9]] },
    { id: 'b', actionPulseSiteIds: [[3, 4], [8, 9]] },
    { id: 'c', actionPulseSiteIds: [[2, 1], [9, 8]] },
    { id: 'd', actionPulseSiteIds: [[4, 3], [8, 9]] },
  ];
  const before = JSON.stringify(inputs);
  assert.deepEqual(partitionDistributedR2AOrderedRoadsV1(inputs).map(group => group.map(x => x.id)),
    [['a', 'c'], ['b', 'd']]);
  assert.equal(JSON.stringify(inputs), before);
});

test('reversal, missing steps and repetition retain distinct physical roads', () => {
  const inputs = [[[1], [2]], [[2], [1]], [[1]], [[1], [2], [2]]]
    .map(actionPulseSiteIds => ({ actionPulseSiteIds }));
  assert.equal(partitionDistributedR2AOrderedRoadsV1(inputs).length, 4);
  assert.deepEqual(partitionDistributedR2AOrderedRoadsV1(inputs),
    partitionDistributedR2AOrderedRoadsV1([...inputs].reverse()));
});

test('continuation masks retain physical basin identity and its actual local residence profile', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'mask-contract' });
  const measured = medium.probe([0], 1n, 1);
  const branches = [{ branchId: 'basin-not-a-road', topologicalEnvelopeSiteIds: [5, 6],
    attractor: { ...measured, coreSiteIds: [5], terminalActivations: [
      { siteId: 5, meanActivation: .8 }, { siteId: 6, meanActivation: .3 },
      { siteId: 9, meanActivation: .1 }] } }];
  assert.deepEqual(distributedPhysicalBranchReadoutAssembliesV1(branches), [{
    assemblyId: 'basin-not-a-road', siteIds: [5], enclosingDomainSiteIds: [5, 6],
    referenceActivations: [{ siteId: 5, meanActivation: .8 }, { siteId: 6, meanActivation: .3 }],
    minimumResidenceScore: .5, minimumCoverage: .75, minimumPurity: .75 }]);
});
