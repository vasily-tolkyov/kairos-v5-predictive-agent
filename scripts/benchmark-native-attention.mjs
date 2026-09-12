import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const [build, checkpoint, source, output] = process.argv.slice(2);
if (!output) throw new Error('usage: BUILD CHECKPOINT NATIVE_SOURCE NEW_OUTPUT');
const { ExperienceMedium } = await import(resolve(build, 'src/experience-medium.js'));
const { ExperienceAgent } = await import(resolve(build, 'src/experience-agent.js'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(resolve(checkpoint)), state = JSON.parse(gunzipSync(bytes));
const medium = ExperienceMedium.restore(state.medium ?? state), agent = new ExperienceAgent(medium);
agent.restoreChoices(state.choices ?? 0);
const before = sha(JSON.stringify(medium.snapshot()));
const actions = (await readFile(resolve(source, 'physical-actions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.executed);
const sampled = actions.filter((_, i) => i % Math.max(1, Math.floor(actions.length / 16)) === 0).slice(0, 16), rows = [];
for (const action of sampled) {
  const file = `events/${String(action.eventFile).padStart(7, '0')}.json.gz`, raw = await readFile(resolve(source, file));
  const event = JSON.parse(gunzipSync(raw)), observation = event.frames[0], offers = action.availableOffers;
  assert(offers?.length && offers.every(offer => offer.observationSequence === observation.sequence));
  const began = performance.now(), drives = offers.flatMap(offer => (observation.objects.length ? observation.objects : [null])
    .map(object => ({ offerId: offer.offerId, attentionId: object?.id,
      drive: medium.explorationDrive(offer.cue, observation, object?.id) }))), ranked = performance.now();
  const choice = agent.explore(observation, offers), ended = performance.now();
  rows.push({ file, sha256: sha(raw), objects: observation.objects.length, offers: offers.length,
    driveMs: ranked - began, exploreMs: ended - ranked, drives, choice });
  console.log(JSON.stringify({ scenes: rows.length, objects: observation.objects.length, driveMs: ranked - began }));
}
assert.equal(sha(JSON.stringify(medium.snapshot())), before, 'attention queries changed learned evidence');
const timing = key => { const values = rows.map(row => row[key]).sort((a, b) => a - b); return {
  total: values.reduce((a, b) => a + b, 0), median: values[Math.floor(values.length / 2)], max: values.at(-1) }; };
const result = { scope: 'Frozen-model query benchmark on original native frames. No new physical trial or learning.',
  build: resolve(build), checkpointSha256: sha(bytes), source: resolve(source), rows,
  driveMs: timing('driveMs'), exploreMs: timing('exploreMs'), learningDigestUnchanged: true,
  decisionsSha256: sha(JSON.stringify(rows.map(row => ({ file: row.file, drives: row.drives, choice: row.choice })))) };
await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...result, rows: undefined }));
