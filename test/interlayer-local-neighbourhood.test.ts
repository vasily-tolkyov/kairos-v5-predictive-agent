import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { SparseInterlayerProjectionV1 } from '../src/core/learning/sparse-interlayer-projection.js';

test('measured source neighbours compete near their bound target fibres, not away from them', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'adjacency' });
  const projection = new SparseInterlayerProjectionV1(medium,
    { projectionId: 'adjacency', seed: 52n, winnerCount: 1 });
  const source = [0, 1, 2, 3, 4, 5, 6, 7];
  projection.projectPulse({ pulseId: 'a', offset: 0,
    drives: source.map(siteId => ({ siteId, intensity: 1 })),
    sourceNeighborhoods: source.map(sourceSiteId => ({ sourceSiteId,
      neighborSiteIds: source.filter(other => Math.abs(other - sourceSiteId) === 1) })) });
  const coordinates = projection.snapshot().bindings.map(binding =>
    medium.site(binding.targetSiteIds[0]!).coordinate);
  for (let i = 1; i < coordinates.length; i++) {
    const previous = coordinates[i - 1]!, current = coordinates[i]!;
    assert.equal(current.reduce((sum, value, axis) => sum + Math.abs(value - previous[axis]!), 0), 1,
      `source edge ${i - 1}→${i} lost its local target coupling`);
  }
});
