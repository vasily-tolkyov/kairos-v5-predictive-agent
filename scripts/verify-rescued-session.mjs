import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { ExperienceSession } from '../dist/src/experience-session.js';

const path = process.argv[2];
if (!path) throw new Error('required: RESCUED_SESSION_JSON_GZ');
const bytes = await readFile(path);
const hash = createHash('sha256').update(bytes).digest('hex');
const registry = JSON.parse(await readFile(new URL('../docs/codex-rescue/rescued-state-verification.json', import.meta.url), 'utf8'));
const expected = registry.runs.find(run => run.sessionSha256 === hash);
assert(expected, 'session-is-not-in-the-verified-rescue-registry');
const state = JSON.parse(gunzipSync(bytes));
const session = ExperienceSession.restore(state, { sameWorld: true });
const restored = session.snapshot();
assert.deepEqual(restored.medium, state.medium, 'restoring-must-not-change-learned-dynamics');
assert.deepEqual(restored.affordances, state.affordances, 'restoring-must-not-change-learned-availability');
for (const field of ['choices', 'steps', 'executed', 'passiveWindows', 'passiveWrites'])
  assert.equal(restored[field], state[field], 'restoring-must-preserve-' + field);
assert.equal(session.stats.decisions, expected.final.decisions);
assert.equal(session.stats.writes, expected.final.writes);
assert.equal(session.stats.executed, expected.final.executed);
console.log(JSON.stringify({ run: expected.run, sessionSha256: hash, stats: session.stats,
  learnedDynamicsUnchanged: true, learnedAvailabilityUnchanged: true, newPhysicalTrials: 0 }));
