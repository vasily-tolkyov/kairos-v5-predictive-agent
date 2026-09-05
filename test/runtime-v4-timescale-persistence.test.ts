import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { Compute } from '../src/compute.js';
import { restoreExperience, restoreExperienceV4, saveExperienceBundleV1, saveExperienceBundleV4 } from '../src/runtime.js';

test('V4 timescale bundle persists and restores without entering the V3 path', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-runtime-v4-persistence-'));
  try {
    const memory = new DistributedHierarchicalPhysicalMemoryV1();
    memory.enableTimescaleV2();
    const snapshot = memory.snapshotV4();
    const pointer = await saveExperienceBundleV4(directory, snapshot,
      { actions: 0, eventCount: 0, writes: 0 }, new ControlHabitWeightsV1());
    assert.equal(pointer.memoryVersion, 'KairosV5DistributedPhysicalMemoryV4');
    assert.equal(pointer.timescaleLawIdentitySha256, snapshot.timescales.r1.lawIdentitySha256);
    const onDisk = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8')) as typeof pointer;
    assert.deepEqual(onDisk, pointer);
    let restored: unknown = null;
    const compute = { call: async (method: string, value: unknown) => {
      assert.equal(method, 'restoreV4'); restored = value;
    } } as unknown as Compute;
    const result = await restoreExperienceV4(compute, resolve(directory, 'EXPERIENCE_LATEST.json'));
    assert(result); assert.deepEqual(restored, snapshot);
    await assert.rejects(() => restoreExperience(compute, resolve(directory, 'EXPERIENCE_LATEST.json')),
      /legacy-experience-snapshot-is-audit-only/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('V3 and V4 bundle writers refuse cross-version overwrite', async () => {
  const v3Directory = await mkdtemp(resolve(process.cwd(), '.tmp-runtime-v4-overwrite-v3-'));
  const v4Directory = await mkdtemp(resolve(process.cwd(), '.tmp-runtime-v4-overwrite-v4-'));
  try {
    const memory = new DistributedHierarchicalPhysicalMemoryV1(), habit = new ControlHabitWeightsV1();
    const v3 = memory.snapshot(), v4Memory = new DistributedHierarchicalPhysicalMemoryV1();
    v4Memory.enableTimescaleV2(); const v4 = v4Memory.snapshotV4();
    await saveExperienceBundleV1(v3Directory, v3, { actions: 0, eventCount: 0, writes: 0 }, habit);
    await assert.rejects(() => saveExperienceBundleV4(v3Directory, v4,
      { actions: 0, eventCount: 0, writes: 0 }, habit), /experience-bundle-protocol-overwrite/);
    await saveExperienceBundleV4(v4Directory, v4, { actions: 0, eventCount: 0, writes: 0 }, habit);
    await assert.rejects(() => saveExperienceBundleV1(v4Directory, v3,
      { actions: 0, eventCount: 0, writes: 0 }, habit), /experience-bundle-protocol-overwrite/);
  } finally {
    await Promise.all([rm(v3Directory, { recursive: true, force: true }), rm(v4Directory, { recursive: true, force: true })]);
  }
});
