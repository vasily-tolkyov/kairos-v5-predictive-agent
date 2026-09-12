import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { ExperienceMedium } from '../dist/src/experience-medium.js';
import { compareExperiencePrediction } from '../dist/src/experience-agent.js';

// Recorded physical windows are evaluation data, never invented transitions.
// This diagnostic separates changing channels from stable background channels.
const { values } = parseArgs({ options: { restore: { type: 'string' }, events: { type: 'string' },
  output: { type: 'string' }, learn: { type: 'boolean' } } });
if (!values.restore || !values.events || !values.output) throw new Error('required: --restore --events --output');
const decode = async path => {
  const data = await readFile(path); return JSON.parse((data[0] === 31 ? gunzipSync(data) : data).toString());
};
const state = await decode(values.restore), memory = ExperienceMedium.restore(state.medium ?? state);
const digest = () => createHash('sha256').update(JSON.stringify(memory.snapshot())).digest('hex');
const initialDigest = digest(), groups = {}, windows = [];
const bucket = field => field.startsWith('self/position.') ? 'position' : field.startsWith('context/') ? 'view'
  : field.startsWith('object:') ? 'object' : field.startsWith('self/properties.') ? 'body-property' : 'orientation-or-gaze';
for (const name of (await readdir(values.events)).filter(name => name.endsWith('.json.gz')).sort()) {
  const event = await decode(resolve(values.events, name)), before = event.frames[0], after = event.frames.at(-1);
  const motor = JSON.stringify({ kind: event.cue.kind, parameters: event.cue.parameters });
  const prediction = memory.predict(event.cue, before), baseline = compareExperiencePrediction(prediction, before);
  const actual = compareExperiencePrediction(prediction, after);
  const probe = memory.predict(event.cue, before, { probe: true });
  const assumed = compareExperiencePrediction(probe, after);
  for (const error of actual.errors) {
    const key = motor + '/' + bucket(error.field), stats = groups[key] ??= { motor, channel: bucket(error.field),
      predicted: 0, measured: 0, matched: 0, changing: 0, changingMatched: 0, numericAbsoluteError: 0, numericCount: 0 };
    stats.predicted++; if (!error.known) continue;
    stats.measured++; stats.matched += Number(error.matched);
    if (error.error !== null) { stats.numericAbsoluteError += error.error; stats.numericCount++; }
    const previous = baseline.errors.find(value => value.field === error.field)?.measured;
    const changed = typeof previous === 'number' && typeof error.measured === 'number'
      ? Math.abs(previous - error.measured) > .1 : !Object.is(previous, error.measured);
    if (changed) { stats.changing++; stats.changingMatched += Number(error.matched); }
  }
  const displacement = Math.hypot(...after.self.position.map((value, axis) => value - before.self.position[axis]));
  const position = actual.errors.filter(value => value.field.startsWith('self/position.'));
  const hypotheticalPosition = assumed.errors.filter(value => value.field.startsWith('self/position.'));
  windows.push({ eventId: event.id, motor, displacement,
    supportedPosition: position.length === 3, correctPosition: position.length === 3 && position.every(value => value.matched),
    hypotheticalPosition: hypotheticalPosition.length === 3,
    correctHypotheticalPosition: hypotheticalPosition.length === 3 && hypotheticalPosition.every(value => value.matched),
    supportedView: actual.errors.filter(value => value.field.startsWith('context/')).length,
    compared: actual.compared, matched: actual.matched });
  if (values.learn) memory.observe(event);
}
const finalDigest = digest();
if (!values.learn && finalDigest !== initialDigest) throw new Error('read-only-evaluation-mutated-experience');
await writeFile(values.output, JSON.stringify({ version: 'RecordedPredictionEvaluation1', restore: resolve(values.restore),
  events: resolve(values.events), onlineUpdates: !!values.learn, initialDigest, finalDigest,
  interpretation: 'Held-out recorded physical-window prediction; not a new online task trial or evidence of chosen actions.',
  total: windows.length, changingPositionWindows: windows.filter(value => value.displacement > .1).length,
  supportedPositionWindows: windows.filter(value => value.supportedPosition).length,
  correctSupportedPositionWindows: windows.filter(value => value.correctPosition).length,
  hypotheticalPositionWindows: windows.filter(value => value.hypotheticalPosition).length,
  correctHypotheticalPositionWindows: windows.filter(value => value.correctHypotheticalPosition).length,
  groups: Object.values(groups), windows }, null, 2) + '\n', { flag: 'wx' });
