import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Pass the two compiled src directories. This fixed synthetic readout
// microbenchmark measures no native planner or Minecraft throughput.
const directories = process.argv.slice(2);
if (directories.length !== 2) throw new Error('usage: node compare-query-cost.mjs BASELINE_SRC CANDIDATE_SRC');
const implementations = await Promise.all(directories.map(async directory => {
  const filename = resolve(directory, 'contextual-readout.js');
  return { Model: (await import(pathToFileURL(filename))).ContextualReadout,
    sha256: createHash('sha256').update(readFileSync(filename)).digest('hex') };
}));
const cases = [
  { name: 'numeric', labels: [0, 1] },
  { name: 'categorical-separate-leaves', labels: ['A', 'B'] },
  { name: 'categorical-shared-response-leaf', labels: ['A', 'B', 'C'] },
];
const iterations = 10000, rounds = 7, results = [];
for (const fixture of cases) {
  const models = implementations.map(({ Model }) => {
    const model = new Model();
    for (let i = 0; i < 192; i++) {
      const index = i % fixture.labels.length;
      model.observe('motor', { condition: fixture.labels[index], nuisance: i % 5 },
        [['motion', 0, index ? -1 : 1]], { motion: 0 });
    }
    return model;
  });
  const digests = models.map(model => JSON.stringify(model.snapshot()));
  const measure = (model, count) => {
    const start = performance.now(); let supported = 0;
    for (let i = 0; i < count; i++) supported += Number(model.read('motor', 'motion',
      { condition: fixture.labels[i % fixture.labels.length], unrelated: 'unseen' }).supported);
    return { elapsedMs: performance.now() - start, supported };
  };
  const coldQueries = models.map(model => measure(model, fixture.labels.length));
  models.forEach(model => measure(model, 1000));
  const timings = [[], []];
  for (let round = 0; round < rounds; round++) for (const index of round % 2 ? [1, 0] : [0, 1])
    timings[index].push(measure(models[index], iterations));
  results.push({ fixture: fixture.name, coldQueries,
    implementations: timings.map((values, index) => ({ sha256: implementations[index].sha256,
      elapsedMs: values.map(value => value.elapsedMs),
      medianMs: values.map(value => value.elapsedMs).sort((a, b) => a - b)[Math.floor(rounds / 2)],
      supportedEachRound: values.map(value => value.supported),
      snapshotUnchanged: JSON.stringify(models[index].snapshot()) === digests[index] })) });
}
console.log(JSON.stringify({ kind: 'synthetic-contextual-readout-query-cost', node: process.version,
  iterations, rounds, results, nativeTrials: 0 }, null, 2));
