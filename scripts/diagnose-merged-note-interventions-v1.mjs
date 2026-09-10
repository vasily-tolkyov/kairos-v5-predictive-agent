import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonical, saveJson } from '../dist/src/util.js';
const input = resolve(process.argv[2] ?? 'evidence/current-guided-note-foundation-replay-v3');
const output = resolve(process.argv[3] ?? 'evidence/current-guided-note-foundation-assessment-diagnostic-v1');
const declaration = JSON.parse(await readFile(resolve(input, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(input, declaration.snapshotFile));
const results = [];
for (const [index, plan] of declaration.interventionPlans.entries()) {
  const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
  try {
    const value = memory.recordDistributedMatchedInterventions([plan])[0];
    results.push({ index, plan, ok: true, grade: value.grade, relationId: value.relationId });
  } catch (error) {
    results.push({ index, plan, ok: false, message: error.message });
  }
  if ((index + 1) % 4 === 0) console.log(JSON.stringify(results.at(-1)));
}
await saveJson(output, { source: input, planCount: declaration.interventionPlans.length,
  ok: results.filter(value => value.ok).length, failed: results.filter(value => !value.ok).length, results });
console.log(canonical({ ok: results.filter(value => value.ok).length,
  failed: results.filter(value => !value.ok).length }));
