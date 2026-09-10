import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { sha } from '../src/util.js';

test('a retained relation absent from the current physical index returns no support without rebinding', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1(), before = sha(memory.snapshot());
  const relationId = 'retained-previous-physical-index-relation';
  const result = memory.compareCurrentFactors(relationId, { sequence: 1, activeSeconds: 0,
    contextId: 'neutral', objects: [], targetId: null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} } });
  assert.deepEqual(result, { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
    applicability: 0, productionEligible: false, unavailableRelationIds: [relationId] });
  assert.equal(sha(memory.snapshot()), before);
});
