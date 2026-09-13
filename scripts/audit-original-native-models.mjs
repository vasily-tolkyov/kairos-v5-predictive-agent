import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ExperienceSession } from '../dist/src/experience-session.js';

// Evaluator identities pinned by the immutable 2026-09-13 experiment registry.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: ORIGINAL_EVIDENCE_ROOT NEW_AUDIT_JSON');
const identities = [
  ['peaceful-natural-initial/session.json.gz', '8cfdd33cc6ce4467a972483c28449d79899aaee83bafd3b2ed741ba3f4a6e833', 5098],
  ['peaceful-natural-online-long/session.json.gz', '1fb7c1ca445c8fad761274f5cb75a6c2c382874c69e270f8cb2684b2084da635', 12321],
  ['peaceful-retention-after-learning-start/session.json.gz', '6e71f4f4f4059f4ca22a76b7d9b84955f3d86b6f892db99877e86999b243e574', 12321]
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const eventBytes = await readFile(resolve(source, 'peaceful-natural-retained-frozen/events/0000019.json.gz'));
assert.equal(hash(eventBytes), 'd36d9a8209dba5a680807fe4c15225622ea63e0e8cf67f41c4895dedfd9bf041');
const event = JSON.parse(gunzipSync(eventBytes)), models = [];
for (const [path, expected, writes] of identities) {
  const bytes = await readFile(resolve(source, path)); assert.equal(hash(bytes), expected);
  const saved = JSON.parse(gunzipSync(bytes)), session = ExperienceSession.restore(saved, { sameWorld: true });
  const restored = session.snapshot(); assert.equal(session.agent.medium.writes, writes);
  assert.deepEqual(restored.medium.networks, saved.medium.networks);
  assert.deepEqual(restored.medium.contexts.circuits, saved.medium.contexts.circuits);
  assert.deepEqual(restored.medium.events, saved.medium.events);
  assert.deepEqual(restored.medium.ledger, saved.medium.ledger);
  assert.equal(restored.choices, saved.choices);
  const learningHash = () => hash(JSON.stringify([session.agent.medium.snapshot(), session.agent.affordances.snapshot()]));
  const before = learningHash(), prediction = session.agent.medium.predict(event.cue, event.frames[0]);
  assert.equal(learningHash(), before);
  models.push({ path, sha256: expected, writes, choices: saved.choices,
    legacyContextVersion: saved.medium.contexts.version, restoredContextVersion: restored.medium.contexts.version,
    originalFittingRows: restored.medium.contexts.circuits.reduce((n, [, c]) => n + c.samples.length, 0),
    verifiedWindowRows: restored.medium.contexts.circuits.reduce((n, [, c]) => n + c.samples.filter(r => r.windowId !== undefined).length, 0),
    parametersAndOriginalRowsPreserved: true, queryReadOnly: true, supportedFieldsAtFrame19: prediction.supportedFields.length });
}
const world = await readFile(resolve(source, 'peaceful-natural-initial/stopped-world.tar.gz'));
assert.equal(hash(world), '9d841f5841b36b020fa62c76e9bf5e73a8525b42e458e05600f6910bdff30a22');
const result = { version: 'OriginalNativeModelMigrationAudit1', status: 'passed', models,
  originalEvent: event.id, eventSha256: hash(eventBytes), initialWorldArchiveSha256: hash(world),
  nativeLaunches: 0, learningWrites: 0,
  limitation: 'Legacy fits are retained; untraceable row-level calibration is not recertified as independent windows. This intentionally withdraws old support and does not establish task retention.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
