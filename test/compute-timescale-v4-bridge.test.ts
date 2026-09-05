import assert from 'node:assert/strict';
import test from 'node:test';
import { Compute } from '../src/compute.js';

test('Compute exposes explicit V4 timescale opt-in without changing legacy calls', async () => {
  const compute = new Compute();
  try {
    await compute.enableTimescaleV2();
    await compute.advanceMeasured(0, { r1: [], r2: [], r2a: [] });
    const snapshot = await compute.snapshotV4();
    assert.equal(snapshot.version, 'KairosV5DistributedPhysicalMemoryV4');
    await compute.restoreV4(snapshot);
    assert.deepEqual(await compute.snapshotV4(), snapshot);
  } finally {
    await compute.close();
  }
});
