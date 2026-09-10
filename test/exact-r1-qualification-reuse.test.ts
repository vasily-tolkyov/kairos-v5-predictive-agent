import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, RealEvent } from '../src/contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedR1ExperienceStoreV1 } from '../src/core/learning/distributed-r1.js';
import { sha } from '../src/util.js';

test('R1 basin measurements reuse identical inputs without changing per-event qualification', () => {
  // Synthetic inputs are an exact algorithm oracle, never real-world evidence.
  const medium = new DistributedPhysicalMedium3DV1({ name: 'neutral-exact-qualification' });
  const store = new DistributedR1ExperienceStoreV1(medium), ids: string[] = [];
  for (let i = 0; i < 16; i++) {
    const frame = (sequence: number, selectedSlot: number): Observation => ({ sequence,
      activeSeconds: sequence * .05, contextId: `neutral-context-${i % 8}`, targetId: null, objects: [],
      self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot, stable: true } } });
    const frames = [frame(i * 2 + 1, 2 + i % 7), frame(i * 2 + 2, i % 2)];
    const event: RealEvent = { version: 'RealEventV5', id: `neutral-${i}`,
      cue: { kind: 'select-hotbar', parameters: { slot: i % 2 }, targetRole: null },
      frames, trackedIds: ['self'], bodyResult: {
        action: { kind: 'select-hotbar', parameters: { slot: i % 2 } }, executed: true,
        status: 'completed', startSequence: frames[0]!.sequence, endSequence: frames[1]!.sequence,
        terminationReason: 'stable' }, provenance: 'executed-real-body', complete: true };
    store.observe(event); ids.push(event.id);
  }
  const before = sha(medium.snapshot()), original = DistributedPhysicalMedium3DV1.prototype.probe;
  let probes = 0;
  DistributedPhysicalMedium3DV1.prototype.probe = function (...args) {
    probes++; return original.apply(this, args);
  };
  try {
    const results = ids.map(id => store.attractorQualification(id));
    // Independently captured from the original 224-probe implementation.
    assert.equal(sha(results), '45aa1c96ffb1e958001af734ac4a38488d552186bbbe7f5272d38988d2de904f');
    assert.equal(probes, 32, 'the two exact basin experiments were unnecessarily repeated');
    assert.equal(sha(ids.map(id => store.attractorQualification(id))), sha(results));
    assert.equal(probes, 32);
    assert.equal(sha(medium.snapshot()), before);
    medium.recover(100000);
    store.invalidatePhysicalQualification();
    assert(ids.every(id => store.attractorQualification(id).status === 'weak-footprint'),
      'recovery must not reuse a once-stable measurement');
  } finally { DistributedPhysicalMedium3DV1.prototype.probe = original; }
});
