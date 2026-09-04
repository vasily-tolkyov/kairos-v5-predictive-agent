import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, PublicValue, RealEvent } from '../src/contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { SelfOrganizingAfferentProjectionV1 } from '../src/core/learning/self-organizing-afferent.js';
import { DistributedPhysicalMedium3DV1, MediumCapacityExhaustedError,
  distributedMediumConfig } from '../src/core/physics/distributed-physical-medium.js';

function event(id: string, properties: Readonly<Record<string, PublicValue>>): RealEvent {
  const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
  const frame = (sequence: number, activeSeconds: number,
    values: Readonly<Record<string, PublicValue>>): Observation => ({
    sequence, activeSeconds, contextId: 'novelty-context', targetId: null,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { onGround: true } },
    objects: [{ id: 'target', type: 'opaque-target', relativePosition: [0, 0, -2],
      properties: values }],
  });
  const before = Object.fromEntries(Object.keys(properties).map(key => [key, false]));
  const after = Object.fromEntries(Object.keys(properties).map(key => [key, true]));
  const frames = [frame(1, 0, before), frame(2, .05, after)];
  return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
    trackedIds: ['self', 'target'], bodyResult: { action, executed: true, status: 'completed',
      startSequence: 1, endSequence: 2, terminationReason: 'stable' },
    provenance: 'executed-real-body', complete: true };
}

test('first-seen afferents are surfaced as novelty and reused signals are not novel', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const first = memory.observe(event('novelty-first', { active: false }));
  assert.equal(first.novelty.version, 'DistributedNoveltyRecordV1');
  assert.equal(first.novelty.source, 'trusted-real-event');
  assert.ok(first.novelty.newlyAllocatedSignalCount > 0);
  assert.equal(first.novelty.newlyAllocatedSignalIds.length,
    first.novelty.newlyAllocatedSignalCount);
  assert.equal(new Set(first.novelty.newlyAllocatedSignalIds).size,
    first.novelty.newlyAllocatedSignalCount);

  const second = memory.observe(event('novelty-reuse', { active: false }));
  assert.equal(second.novelty.newlyAllocatedSignalCount, 0);
  assert.deepEqual(second.novelty.newlyAllocatedSignalIds, []);
  assert.ok(second.novelty.reusedSignalCount > 0);
});

test('a bounded substrate fails closed instead of silently dropping capacity', () => {
  const medium = new DistributedPhysicalMedium3DV1(
    distributedMediumConfig('R1', '9911', { maxTiles: 1 }));
  const projection = new SelfOrganizingAfferentProjectionV1(0x9911n);
  const first = projection.projectEvent(event('capacity-first', { active: false }), medium);
  assert.ok(first.newlyAllocatedSignalCount > 0);
  assert.throws(() => medium.allocateSites(32 ** 3 + 1, () => .5),
    error => error instanceof MediumCapacityExhaustedError);
});
