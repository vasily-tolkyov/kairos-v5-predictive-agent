import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ExperienceSession } from '../dist/src/experience-session.js';

const [checkpoint, eventFile, output] = process.argv.slice(2);
if (!checkpoint || !eventFile || !output) throw new Error('usage: SESSION.json.gz ORIGINAL_EVENT.json.gz NEW_AUDIT.json');
const bytes = await readFile(checkpoint), state = JSON.parse(gunzipSync(bytes));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const session = ExperienceSession.restore(state, { sameWorld: true });
// Restoring knowledge must not make a previously visible object visible now.
// Preserve every other state field; clear only the documented renderer-local
// bindings pending a new real observation.
const expected = structuredClone(state);
expected.world.surfaces = expected.world.surfaces.map(surface => ({ ...surface, perceptId: '', visible: false }));
assert.deepEqual(session.snapshot(), expected);
const event = JSON.parse(gunzipSync(await readFile(eventFile)));
const learnedBefore = sha(session.agent.medium.snapshot());
session.agent.medium.predict(event.cue, event.frames[0]);
assert.equal(sha(session.agent.medium.snapshot()), learnedBefore);
assert.equal(session.agent.medium.observe(event).learned, false);
assert.equal(sha(session.agent.medium.snapshot()), learnedBefore);
const result = { version: 'NativeSmokeRestoreCheck1', status: 'passed',
  sessionSha256: createHash('sha256').update(bytes).digest('hex'), stats: session.stats,
  modelAndTaskStateUnchanged: true, transientVisibleBindingsCleared: expected.world.surfaces.length,
  predictionReadOnly: true, duplicateWindowRejected: true,
  scope: 'Offline check of an actual stopped checkpoint. No new actions or learning writes; no claim of native restart success.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
