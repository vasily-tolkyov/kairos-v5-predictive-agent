import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [build, checkpoint, source, start, count, output] = process.argv.slice(2);
if (!output) throw new Error('usage: BUILD CHECKPOINT NATIVE_SOURCE START_WINDOW COUNT NEW_OUTPUT');
const { ExperienceMedium } = await import(resolve(build, 'src/experience-medium.js'));
const { compareExperiencePrediction } = await import(resolve(build, 'src/experience-agent.js'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const initial = await readFile(resolve(checkpoint)), state = JSON.parse(gunzipSync(initial));
const medium = ExperienceMedium.restore(state.medium ?? state), initialWrites = medium.writes;
const all = (await readdir(resolve(source, 'events'))).filter(file => file.endsWith('.json.gz')).sort();
const files = all.slice(Number(start) - 1, Number(start) - 1 + Number(count)); assert.equal(files.length, Number(count));
const rows = [];
for (const file of files) {
  const bytes = await readFile(resolve(source, 'events', file)), event = JSON.parse(gunzipSync(bytes));
  const began = performance.now(), forecast = medium.predict(event.cue, event.frames[0]), predicted = performance.now();
  const comparison = compareExperiencePrediction(forecast, event.frames.at(-1));
  const learningStart = performance.now(), learned = medium.observe(event), learnedAt = performance.now();
  assert(learned.learned, 'benchmark suffix overlaps checkpoint evidence');
  rows.push({ file, sha256: sha(bytes), eventId: event.id, predictionMs: predicted - began,
    learningMs: learnedAt - learningStart, compared: comparison.compared, matched: comparison.matched,
    health: comparison.errors.find(error => error.field === 'self/properties.health'),
    oxygen: comparison.errors.find(error => error.field === 'self/properties.oxygen'),
    accepted: forecast.accepted, reason: forecast.reason });
  if (rows.length % 16 === 0) console.log(JSON.stringify({ windows: rows.length,
    latestLearningMs: rows.at(-1).learningMs, writes: medium.writes }));
}
const summary = key => {
  const values = rows.map(row => row[key]).sort((a, b) => a - b);
  return { total: values.reduce((a, b) => a + b, 0), median: values[Math.floor(values.length / 2)],
    p95: values[Math.floor((values.length - 1) * .95)], max: values.at(-1) };
};
const result = { scope: 'Sequential replay of original native suffix. Every forecast is made before learning its outcome; no new physical actions.',
  build: resolve(build), source: resolve(source), checkpointSha256: sha(initial), initialWrites,
  finalWrites: medium.writes, windows: rows.length,
  compiledHashes: Object.fromEntries(await Promise.all(['experience-medium','contextual-readout','experience-agent'].map(async name =>
    [name, sha(await readFile(resolve(build, 'src', name + '.js')))]))),
  predictionMs: summary('predictionMs'), learningMs: summary('learningMs'),
  compared: rows.reduce((sum, row) => sum + row.compared, 0), matched: rows.reduce((sum, row) => sum + row.matched, 0), rows };
await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...result, rows: undefined }));
