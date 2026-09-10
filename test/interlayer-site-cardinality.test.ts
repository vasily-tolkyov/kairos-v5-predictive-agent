import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { SparseInterlayerProjectionV1 } from '../src/core/learning/sparse-interlayer-projection.js';
import { DistributedR2ContinuityStoreV1 } from '../src/core/learning/distributed-r2.js';
import { DistributedR2APhysicalPatternLearnerV2 } from '../src/core/learning/distributed-r2a-physical.js';
import { sha } from '../src/util.js';

test('production layers translate an already distributed site without another population expansion', () => {
  const r2 = new DistributedR2ContinuityStoreV1();
  const r2a = new DistributedR2APhysicalPatternLearnerV2(() => true);
  assert.equal(r2.snapshot().projection.winnerCount, 1);
  assert.equal(r2a.snapshot().projection.winnerCount, 1);
});

test('one-site fibres preserve every source value, locality hints, and exact restore without aliasing', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'R2' });
  const config = { projectionId: 'site-correspondence-test', seed: 0x123n, winnerCount: 1 };
  const projection = new SparseInterlayerProjectionV1(medium, config);
  const drives = Array.from({ length: 8 }, (_, siteId) => ({ siteId, intensity: .2 + siteId * .1 }));
  const pulse = { pulseId: 'anonymous-public-pulse', offset: 0, drives,
    sourceNeighborhoods: drives.map(({ siteId }) => ({ sourceSiteId: siteId,
      neighborSiteIds: [siteId - 1, siteId + 1].filter(id => id >= 0 && id < 8) })) };
  const result = projection.projectPulse(pulse);
  assert.equal(result.drives.length, drives.length);
  const bindings = projection.snapshot().bindings;
  assert.equal(new Set(bindings.flatMap(value => value.targetSiteIds)).size, drives.length);
  for (const binding of bindings) assert.equal(result.drives.find(value =>
    value.siteId === binding.targetSiteIds[0])?.intensity, drives[binding.sourceSiteId]!.intensity);
  const restoredMedium = DistributedPhysicalMedium3DV1.fromSnapshot(medium.snapshot());
  const restored = new SparseInterlayerProjectionV1(restoredMedium, config, projection.snapshot());
  const before = sha(restoredMedium.snapshot());
  assert.deepEqual(restored.lookupPulse(drives), result.drives);
  assert.equal(sha(restoredMedium.snapshot()), before);
});

test('two translations retain an eight-site pattern instead of turning it into 512 sites', () => {
  function translate(winnerCount: number): number[] {
    let drives = Array.from({ length: 8 }, (_, siteId) => ({ siteId, intensity: .75 }));
    const counts = [drives.length];
    for (let layer = 0; layer < 2; layer++) {
      const medium = new DistributedPhysicalMedium3DV1({ name: `anonymous-layer-${layer}` });
      const projection = new SparseInterlayerProjectionV1(medium,
        { projectionId: `layer-${layer}`, seed: BigInt(layer + 35), winnerCount });
      drives = [...projection.projectPulse({ pulseId: 'unchanged-source', offset: 0, drives }).drives];
      counts.push(drives.length);
      if (winnerCount === 1) assert(drives.every(drive => drive.intensity === .75));
    }
    return counts;
  }
  assert.deepEqual(translate(8), [8, 64, 512]); // old adapter, not extra sensed information
  assert.deepEqual(translate(1), [8, 8, 8]);
});
