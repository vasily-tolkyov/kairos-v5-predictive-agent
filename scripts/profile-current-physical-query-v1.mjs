/** CPU sampling of one cold and one hot read-only production prediction. */
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
const [checkpoint, queryFile, priorFile, output] = process.argv.slice(2);
if (!output) throw new Error('checkpoint-query-prior-new-output-required');
await mkdir(output, { recursive: false });
const { snapshot } = await loadSnapshotFromDisk(checkpoint);
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const query = JSON.parse(await readFile(queryFile, 'utf8'));
const prior = JSON.parse(await readFile(priorFile, 'utf8'));
const session = new Session(); session.connect();
const post = promisify(session.post).bind(session);
const before = canonicalStreamSha256(memory.snapshot());
await post('Profiler.enable');
const results = [];
for (const phase of ['cold', 'hot']) {
  await post('Profiler.start');
  const started = performance.now();
  const prediction = memory.predictCandidate(prior.candidate, query.observation, query.goal, query.evaluation);
  const durationMs = performance.now() - started;
  const { profile } = await post('Profiler.stop');
  await saveJson(resolve(output, `${phase}.cpuprofile`), profile);
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const own = new Map();
  profile.samples.forEach((id, i) => own.set(id, (own.get(id) ?? 0) + profile.timeDeltas[i]));
  const top = [...own].sort((a,b) => b[1]-a[1]).slice(0, 24).map(([id, us]) => ({
    ms: us / 1000, ...nodes.get(id).callFrame }));
  results.push({ phase, durationMs, top,
    predictionHash: canonicalStreamSha256(prediction),
    samplesEqual: canonicalStreamSha256(prediction.prediction.samples) === canonicalStreamSha256(prior.prediction.prediction.samples) });
  console.log(JSON.stringify(results.at(-1)));
}
session.disconnect();
const after = canonicalStreamSha256(memory.snapshot());
await saveJson(resolve(output, 'RESULT.json'), { before, after, readOnly: before === after, results,
  actualGameCalls: 0, actualWrites: 0 });
