import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { DistributedR2APhysicalPatternLearnerV2 } from '../dist/src/core/learning/distributed-r2a-physical.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
const [checkpoint, queryFile, firstFile, secondFile, output] = process.argv.slice(2);
if (!output) throw new Error('checkpoint-query-two-candidates-new-output-required');
await mkdir(output, { recursive: false });
const { snapshot } = await loadSnapshotFromDisk(checkpoint);
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const query = JSON.parse(await readFile(queryFile, 'utf8'));
const candidates = await Promise.all([firstFile, secondFile].map(async path =>
  JSON.parse(await readFile(path, 'utf8')).candidate));
const before = canonicalStreamSha256(memory.snapshot());
const original = DistributedR2APhysicalPatternLearnerV2.prototype.readCurrentAction;
const calls = [];
DistributedR2APhysicalPatternLearnerV2.prototype.readCurrentAction = function (...args) {
  const started = performance.now(), results = original.apply(this, args);
  const audit = { signals: args[0], prefixSites: args[1].length, cue: args[2],
    seeds: args[3].map(String), durationMs: performance.now() - started,
    statuses: results.map(r => r.status) };
  calls.push(audit); console.log(JSON.stringify({ ...audit, signals: audit.signals.length }));
  return results;
};
let chain, failure = null;
const started = performance.now();
try { chain = memory.predictShortChain(candidates, query.observation, query.goal, query.evaluation); }
catch (error) { failure = { message: error.message, stack: error.stack }; }
finally { DistributedR2APhysicalPatternLearnerV2.prototype.readCurrentAction = original; }
const after = canonicalStreamSha256(memory.snapshot());
const result = { durationMs: performance.now() - started, before, after, readOnly: before === after,
  failure, progress: chain?.progressSampleCount, lanes: chain?.totalSampleCount,
  stepCounts: chain?.lanes.map(l => l.steps.length),
  stepChanges: chain?.lanes[0]?.steps.map(s => s.output.knownChanges),
  unknown: chain?.unknown, actualGameCalls: 0, actualWrites: 0 };
await saveJson(resolve(output, 'CHAIN.json'), chain ?? null);
await saveJson(resolve(output, 'PHYSICAL_CALLS.json'), calls);
await saveJson(resolve(output, 'RESULT.json'), result);
console.log(JSON.stringify(result));
if (failure || before !== after || (chain?.progressSampleCount ?? 0) < 18) process.exitCode = 1;
