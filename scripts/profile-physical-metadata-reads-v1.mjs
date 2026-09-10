/** Read-only data-access measurement. No simulation, action, or writer. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { DistributedR1ExperienceStoreV1 } from '../dist/src/core/learning/distributed-r1.js';
import { DistributedR2ContinuityStoreV1 } from '../dist/src/core/learning/distributed-r2.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';

const [checkpoint, output] = process.argv.slice(2);
if (!output) throw new Error('checkpoint-and-new-output-required');
await mkdir(output, { recursive: false });
const { snapshot } = await loadSnapshotFromDisk(checkpoint);
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const readings = [];
let r1Snapshots = 0;
const oldSnapshot = DistributedR1ExperienceStoreV1.prototype.snapshot;
DistributedR1ExperienceStoreV1.prototype.snapshot = function() {
  r1Snapshots++;
  return oldSnapshot.call(this);
};
try {
  for (let ordinal = 0; ordinal < 3; ordinal++) {
    const started = performance.now(), id = memory.mapSha256;
    readings.push({ ordinal, ms: performance.now() - started, id });
  }
} finally { DistributedR1ExperienceStoreV1.prototype.snapshot = oldSnapshot; }
// The store method only reads #events; use a restored store through the
// production constructor to preserve its clone behavior and event ordering.
const medium = memory.snapshot();
const before = canonicalStreamSha256(medium);
const result = { version: 'PhysicalMetadataReadMeasurementV1', readings, r1Snapshots,
  inputAtoms: snapshot.seenEventIds.length, snapshotHash: before,
  physicalSimulationCount: 0, actualActions: 0, writes: 0,
  r2EventAccessorPresent: typeof DistributedR2ContinuityStoreV1.prototype.event === 'function' };
await saveJson(resolve(output, 'RESULT.json'), result);
console.log(JSON.stringify(result));
