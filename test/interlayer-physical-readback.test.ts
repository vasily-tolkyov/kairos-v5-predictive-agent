import assert from 'node:assert/strict';
import test from 'node:test';
import { SparseInterlayerProjectionV1 } from '../src/core/learning/sparse-interlayer-projection.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';

for (const winnerCount of [1, 8]) test(`readback uses only reached fibres; width=${winnerCount}`, () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'readback' });
  const projection = new SparseInterlayerProjectionV1(medium,
    { projectionId: 'anonymous-fibres', seed: 79n, winnerCount });
  const source = [{ siteId: 17, intensity: .5 }, { siteId: 73, intensity: .75 }];
  const target = projection.projectPulse({ pulseId: 'observed', offset: 0, drives: source }).drives;
  const before = sha([medium.snapshot(), projection.snapshot()]);
  const read = projection.readSourcePulse(target);
  assert.deepEqual(read.map(d => d.siteId), [17, 73]);
  read.forEach((d, i) => assert(Math.abs(d.intensity - source[i]!.intensity) < 1e-12));
  const firstTargets = new Set(projection.snapshot().bindings[0]!.targetSiteIds);
  assert.deepEqual(projection.readSourcePulse(target.filter(d => firstTargets.has(d.siteId)))
    .map(d => d.siteId), [17]);
  assert.deepEqual(projection.readSourcePulse([]), []);
  assert.equal(sha([medium.snapshot(), projection.snapshot()]), before);
});
