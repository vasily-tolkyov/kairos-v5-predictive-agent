/** Two identical production queries against a frozen recorded public frame. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { DistributedPredictionCloneV2 } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
const [checkpoint, queryFile, priorPredictionFile, output] = process.argv.slice(2);
if (!output) throw new Error('checkpoint-query-prior-output-required');
await mkdir(output, { recursive: false });
const { snapshot } = await loadSnapshotFromDisk(checkpoint);
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const query = JSON.parse(await readFile(queryFile, 'utf8'));
const prior = JSON.parse(await readFile(priorPredictionFile, 'utf8'));
const before = canonicalStreamSha256(memory.snapshot());
const originalRun = DistributedPredictionCloneV2.prototype.run;
let seedCalls = 0;
DistributedPredictionCloneV2.prototype.run = function(request) {
  seedCalls++;
  return originalRun.call(this, request);
};
const predictions = [], calls = [];
try {
  for (let i = 0; i < 2; i++) {
    const started = performance.now(), previousCalls = seedCalls;
    const prediction = memory.predictCandidate(prior.candidate, query.observation, query.goal, query.evaluation);
    predictions.push(prediction);
    calls.push({ durationMs: performance.now() - started, seedCalls: seedCalls - previousCalls,
      valid: prediction.validSampleCount, progress: prediction.progressFraction });
    console.log(JSON.stringify({ phase: 'query-completed', index: i, ...calls[i] }));
  }
} finally { DistributedPredictionCloneV2.prototype.run = originalRun; }
const after = canonicalStreamSha256(memory.snapshot());
const exactResults = canonicalStreamSha256(predictions[0]) === canonicalStreamSha256(predictions[1]);
const previousPhysicalSamplesEqual = canonicalStreamSha256(predictions[0].prediction.samples)
  === canonicalStreamSha256(prior.prediction.prediction.samples);
const result = { before, after, readOnly: before === after, calls, exactResults,
  previousPhysicalSamplesEqual, sampleCount: predictions[0].prediction.samples.length,
  actualGameCalls: 0, actualWrites: 0,
  passed: before === after && exactResults && previousPhysicalSamplesEqual
    && calls[0].seedCalls === 24 && calls[1].seedCalls === 0 };
await saveJson(resolve(output, 'RESULT.json'), result);
await saveJson(resolve(output, 'PREDICTION.json'), predictions[0]);
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
