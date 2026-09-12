import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Inspect existing observations and frozen learned state only. This diagnostic
// does not learn the replay, choose a game action, or add a physical trial.
const [build, beforePath, afterPath, run, journalNumber, output] = process.argv.slice(2);
if (!output) throw new Error('usage: BUILD_DIST BEFORE_GZ AFTER_GZ RUN JOURNAL_NUMBER NEW_JSON');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { ContextualReadout } = await import(pathToFileURL(resolve(build, 'src/contextual-readout.js')).href);
const { experienceInputs, motorIdentity } = await import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href);
const journalPath = resolve(run, 'journal/physical-actions', journalNumber.padStart(7, '0') + '.json');
const journal = JSON.parse(await readFile(journalPath, 'utf8'));
const eventBytes = await readFile(resolve(run, 'events', String(journal.eventFile).padStart(7, '0') + '.json.gz'));
const event = JSON.parse(gunzipSync(eventBytes)), input = experienceInputs(event.frames[0]);
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const extent = values => values.length ? [Math.min(...values), Math.max(...values)] : null;

function trace(snapshot, id, key) {
  const circuit = new Map(snapshot.circuits).get(id);
  let rows = circuit.samples.filter(row => Object.hasOwn(row.targets, key));
  let shape = new Map(new Map(snapshot.structures).get(id)).get(key);
  const path = [];
  while (shape) {
    if (rows.some(row => !Object.hasOwn(row.input, shape.key))) break;
    const left = value => shape.numeric ? value <= shape.threshold : Object.is(value, shape.threshold);
    const values = rows.map(row => row.input[shape.key]);
    const goLeft = left(input[shape.key]);
    const selected = rows.filter(row => left(row.input[shape.key]) === goLeft);
    path.push({ key: shape.key, value: input[shape.key], threshold: shape.threshold,
      range: shape.numeric ? extent(values) : [...new Set(values)], goLeft,
      beforeSamples: rows.length, selectedSamples: selected.length });
    // Read-only diagnostics below require a fully observed path. Do not silently
    // choose a convenient branch when the original frame lacked that channel.
    if (!Object.hasOwn(input, shape.key)) return { path, missingContext: true };
    if (!selected.length) break;
    rows = selected;
    shape = goLeft ? shape.left : shape.right;
  }
  const deltas = rows.map(row => row.targets[key][1] - row.targets[key][0]);
  const errors = rows.filter(row => Object.hasOwn(row.errors, key)).map(row => row.errors[key]).slice(-32);
  const external = rows.filter(row => row.externalErrors?.[key] !== undefined).map(row => row.externalErrors[key]).slice(-32);
  return { path, samples: rows.length, serials: rows.map(row => row.serial), deltaMean: mean(deltas),
    deltaRange: extent(deltas), deltaStandardDeviation: Math.sqrt(mean(deltas.map(value => (value - mean(deltas)) ** 2))),
    calibrationSamples: errors.length, calibrationAccuracy: mean(errors.map(value => Number(value <= 1))),
    externalSamples: external.length, externalAccuracy: mean(external.map(value => Number(value <= 1))) };
}

const models = [];
for (const path of [beforePath, afterPath]) {
  const bytes = await readFile(resolve(path)), saved = JSON.parse(gunzipSync(bytes));
  const contexts = saved.medium.contexts, model = ContextualReadout.restore(contexts);
  const originalHash = hash(JSON.stringify(model.snapshot()));
  const rows = [];
  for (const offer of journal.availableOffers.filter(offer => offer.action.kind === 'move')) {
    const id = motorIdentity(offer.cue) + '/self';
    const circuit = new Map(contexts.circuits).get(id), network = new Map(saved.medium.networks).get(id);
    if (!circuit || !network) throw new Error('missing-recorded-motor-circuit:' + id);
    for (const key of ['motion/0', 'motion/1', 'motion/2']) {
      const head = network.heads.find(head => head.key === key);
      rows.push({ action: offer.action, id, key, circuitWrites: circuit.writes,
        retainedSamples: circuit.samples.length, retainedSerials: circuit.samples.map(row => row.serial),
        conditional: model.read(id, key, input), trace: trace(contexts, id, key),
        regression: head ? { observations: head.observations, numericQuality: head.numericQuality,
          numericMeans: head.numericMeans } : null });
    }
  }
  if (hash(JSON.stringify(model.snapshot())) !== originalHash) throw new Error('diagnostic-mutated-learning');
  models.push({ source: resolve(path), sha256: hash(bytes), writes: saved.medium.writes, rows });
}
const retention = models[0].rows.filter(row => row.key === 'motion/1').map(earlier => {
  const later = models[1].rows.find(row => row.id === earlier.id && row.key === earlier.key);
  const retained = new Set(later.retainedSerials);
  return { action: earlier.action, priorRows: earlier.retainedSerials.length,
    survivingRows: earlier.retainedSerials.filter(serial => retained.has(serial)).length,
    newWrites: later.circuitWrites - earlier.circuitWrites };
});
const result = { version: 'RecordedRetentionContextDiagnostic1', physicalTrials: 0, learningWrites: 0,
  build: resolve(build), scriptSha256: hash(await readFile(new URL(import.meta.url))),
  event: event.id, eventSha256: hash(eventBytes), actualAction: journal.offer.action,
  before: event.frames[0].self, after: event.frames.at(-1).self, retention, models };
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), retention,
  selected: models.map(model => ({ source: model.source,
    rows: model.rows.filter(row => row.action.parameters.direction === 'back').map(row => ({
      key: row.key, conditional: row.conditional, trace: { ...row.trace, serials: undefined }, regression: row.regression })) })) }));
