import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A developer-known synthetic diagnostic, never native training or task evidence.
const [baselineDist, candidateDist, output] = process.argv.slice(2);
if (!output || process.argv.length !== 5)
  throw new Error('usage: BASELINE_DIST CANDIDATE_DIST NEW_JSON');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = [];
for (const directory of [baselineDist, candidateDist]) {
  const load = name => import(pathToFileURL(resolve(directory, 'src', name + '.js')).href);
  const { ExperienceMedium } = await load('experience-medium');
  const { compareExperiencePrediction } = await load('experience-agent');
  const { cueFor } = await load('events');
  const hashes = {};
  for (const name of ['experience-medium', 'contextual-readout', 'experience-agent', 'numeric-ranges', 'events'])
    hashes[name] = hash(await readFile(resolve(directory, 'src', name + '.js')));
  modules.push({ ExperienceMedium, compareExperiencePrediction, cueFor, hashes });
}
const action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
const frame = (signal, sequence, z = 0) => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'synthetic-continuous-readout-diagnostic', self: { position: [0, 0, z], yaw: 0, pitch: 0,
    properties: { signal, nuisance: 0 } }, objects: [], targetId: null });
const rows = [];
for (const seed of [123, 456]) for (const scale of [.2, 4]) {
  const models = modules.map(module => new module.ExperienceMedium(41)); let random = seed;
  for (let i = 0; i < 320; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const signal = random / 2 ** 32, before = frame(signal, 2 * i + 1), after = frame(signal, 2 * i + 2, -1 - scale * signal);
    models.forEach((model, index) => model.observe({ version: 'RealEventV5', id: 'diagnostic:' + before.sequence,
      cue: modules[index].cueFor(action, before), frames: [before, after], trackedIds: ['self'],
      provenance: 'executed-real-body', complete: true, bodyResult: { action, executed: true, status: 'completed',
        startSequence: before.sequence, endSequence: after.sequence } }));
  }
  const digests = models.map(model => hash(JSON.stringify(model.snapshot())));
  if (digests[0] !== digests[1]) throw new Error('comparison-learned-states-differ');
  const totals = models.map(() => ({ queries: 19, supported: 0, matched: 0, directional: 0, meanWidth: 0 }));
  for (let i = 1; i < 20; i++) {
    const signal = i / 20, before = frame(signal, 1000 + i * 2), actual = frame(signal, 1001 + i * 2, -1 - scale * signal);
    models.forEach((model, index) => {
      const module = modules[index], prediction = model.predict(module.cueFor(action, before), before);
      const error = module.compareExperiencePrediction(prediction, actual).errors.find(error => error.field === 'self/position.2');
      if (!error) return;
      const total = totals[index]; total.supported++; total.matched += Number(error.matched);
      total.directional += Number(error.range[1] < 0); total.meanWidth += error.range[1] - error.range[0];
    });
  }
  totals.forEach(total => total.meanWidth /= Math.max(1, total.supported));
  if (models.some((model, index) => hash(JSON.stringify(model.snapshot())) !== digests[index]))
    throw new Error('frozen-diagnostic-mutated-model');
  rows.push({ seed, scale, identicalLearnedState: true, modelSha256: digests[0], baseline: totals[0], candidate: totals[1] });
}
const report = { version: 'SyntheticPredictionCalibrationDiagnostic1', nativeTrials: 0,
  scope: 'Smooth mechanism diagnostic, not native retention or a blind benchmark. The 19-point grid is held out; its outcomes never update either frozen model.',
  scriptSha256: hash(await readFile(new URL(import.meta.url))), builds: modules.map(module => module.hashes), rows };
await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), rows }));
