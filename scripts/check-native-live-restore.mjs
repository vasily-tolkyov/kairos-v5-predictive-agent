import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [build, directory, output] = process.argv.slice(2);
assert(build && directory && output, 'usage: PINNED_BUILD_DIST STOPPED_RUN NEW_AUDIT');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(directory), inputs = [];
const read = async name => { const bytes = await readFile(resolve(root, name));
  inputs.push({ path: name, bytes: bytes.length, sha256: hash(bytes) }); return bytes; };
const report = JSON.parse(await read('results.json'));
assert(report.stoppedAt && report.final && report.status !== 'running');
const bytes = await read('session.json.gz'), state = JSON.parse(gunzipSync(bytes));
assert(state.live, 'requires a real live checkpoint');
const { ExperienceSession } = await import(pathToFileURL(resolve(build, 'src/experience-session.js')).href);
const session = ExperienceSession.restore(state, { sameWorld: true });
const expected = structuredClone(state);
expected.world.surfaces = expected.world.surfaces.map(surface => ({ ...surface, perceptId: '', visible: false }));
expected.live = { ...expected.live, acceptedFrames: 0, gapCount: 0, unknownDurationFrames: 0, frames: [],
  current: { ...expected.live.current, origin: 'real', revision: 0, frame: null, physicalClock: null,
    elapsed: { kind: 'unknown', reason: 'restart' }, motor: { state: 'unknown', provenance: 'unknown', cue: null },
    intervalMotor: { state: 'unknown', provenance: 'unknown', cue: null }, continuity: 'unanchored',
    projection: Array(32).fill(0), h: Array(16).fill(0), channels: {},
    memories: expected.live.current.memories.map(memory => ({ ...memory, agePhysicalSeconds: null, association: 'unanchored-restart' })) } };
assert.deepEqual(session.snapshot(), expected, 'restore changed theta/tasks or forged live continuity');
const before = hash(JSON.stringify(session.snapshot()));
let duplicateCheck = null;
const ledger = new Set(state.medium.events.map(([id]) => id));
for (const kind of ['events', 'passive-events']) {
  for (const name of (await readdir(resolve(root, kind))).filter(name => name.endsWith('.json.gz')).sort()) {
    const event = JSON.parse(gunzipSync(await read(kind + '/' + name)));
    if (!ledger.has(event.id)) continue;
    assert.equal(session.agent.medium.observe(event).learned, false);
    assert.equal(hash(JSON.stringify(session.snapshot())), before);
    duplicateCheck = { id: event.id, rejectedWithoutStateChange: true }; break;
  }
  if (duplicateCheck) break;
}
const result = { version: 'NativeLiveRestoreAudit1', status: 'passed', actorDist: resolve(build), inputs,
  originalSessionSha256: hash(bytes), dynamicsAffordancesAndTaskStateUnchanged: true,
  clearedCurrentFrameAndPhysicsClock: true, clearedRecurrentActivationAndVisibleBindings: true,
  retainedOnlyUnanchoredCueMemories: expected.live.current.memories.length, duplicateCheck,
  duplicateCheckScope: duplicateCheck ? 'One archived original window already present in the retained ledger.'
    : 'Not exercised: this frozen checkpoint did not learn its new archived windows; no new learning is forced.',
  scope: 'Offline checkpoint restore only. No native restart, action, environment change or capability result.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, originalSessionSha256: result.originalSessionSha256,
  retainedOnlyUnanchoredCueMemories: result.retainedOnlyUnanchoredCueMemories, duplicateCheck, output }));
