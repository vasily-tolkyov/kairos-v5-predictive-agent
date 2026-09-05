import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedHierarchicalPhysicalMemoryV1,
  type KairosV5DistributedPhysicalMemoryV4 } from '../src/distributed-hierarchical-memory.js';

test('V4 timescale checkpoint is additive and byte-stable', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  memory.enableTimescaleV2();
  memory.advanceTo(1);
  const snapshot = memory.snapshotV4();
  assert.equal(snapshot.version, 'KairosV5DistributedPhysicalMemoryV4');
  const restored = DistributedHierarchicalPhysicalMemoryV1.restoreV4(snapshot as KairosV5DistributedPhysicalMemoryV4);
  assert.deepEqual(restored.snapshotV4(), snapshot);
});

test('legacy V3 checkpoint remains readable', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  memory.advanceTo(1);
  const snapshot = memory.snapshot();
  assert.equal(snapshot.version, 'KairosV5DistributedPhysicalMemoryV3');
  const restored = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
});

test('V4 memory forwards same-time measurements to the enabled owner', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  memory.enableTimescaleV2();
  const before = memory.snapshotV4();
  memory.advanceTo(0, { r1: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 0, surpriseMagnitude: 0.7, goalRelevance: 0.2, supportMass: 1 }], r2: [], r2a: [] });
  assert.notDeepEqual(memory.snapshotV4(), before);
});
