import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [oldBuild, newBuild, initialCheckpoint, source, output] = process.argv.slice(2);
assert(output, 'usage: OLD_DIST NEW_DIST INITIAL_SESSION_GZ STOPPED_PASSIVE_ONLY_RUN NEW_RESULT');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(source), report = JSON.parse(await readFile(resolve(root, 'results.json')));
assert(report.stoppedAt && report.final.executed === report.initialStats.executed && !report.protocol.frozen);
const initialBytes = await readFile(initialCheckpoint), original = JSON.parse(gunzipSync(initialBytes));
assert.equal(hash(initialBytes), report.checkpointInput.sha256);
const contexts = [];
for (const build of [oldBuild, newBuild]) {
  const moduleAt = name => import(pathToFileURL(resolve(build, 'src', name + '.js')).href);
  const [{ ExperienceFrameFlow }, { ExperienceWorld }, { sha }] = await Promise.all([
    moduleAt('experience-frame-flow'), moduleAt('experience-world'), moduleAt('util')]);
  const flow = new ExperienceFrameFlow(), world = ExperienceWorld.restore(original.world);
  flow.boundary(JSON.parse(await readFile(resolve(root, 'initial-observation.json'))), undefined, frame => world.observe(frame));
  contexts.push({ flow, world, sha });
}
const normalize = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'epoch' ? 'private-replay-epoch' : item));
const events = [];
for (const file of (await readdir(resolve(root, 'passive-events'))).filter(file => file.endsWith('.json.gz'))) {
  const bytes = await readFile(resolve(root, 'passive-events', file));
  events.push({ file, sha256: hash(bytes), event: JSON.parse(gunzipSync(bytes)) });
}
events.sort((a, b) => a.event.frames[0].sequence - b.event.frames[0].sequence);
let statesCompared = 0;
for (const { event } of events) {
  const traces = contexts.map(({ flow, world }) => flow.window(structuredClone(event), undefined, frame => world.observe(frame)));
  assert(traces.every(Boolean));
  assert.deepEqual(normalize(traces[1]), normalize(traces[0]), 'actual trace mismatch at ' + event.id);
  assert.deepEqual(contexts[1].world.snapshot(), contexts[0].world.snapshot(), 'world mismatch at ' + event.id);
  statesCompared += event.frames.length;
}
// The first diagnostic normalized epoch fields but left envelope SHA values
// containing that random epoch unchanged. Verify each original envelope first,
// then recompute only that owner-dependent digest under the comparison epoch.
const snapshots = contexts.map(({ flow, sha }) => {
  const snapshot = flow.snapshot();
  for (const entry of snapshot.frames) {
    const envelope = { key: entry.key, physicalClock: entry.state.physicalClock,
      motor: entry.state.motor, intervalMotor: entry.state.intervalMotor };
    assert.equal(sha(envelope), entry.envelopeSha256, 'original live envelope mismatch');
  }
  const normalized = normalize(snapshot);
  for (const entry of normalized.frames) entry.envelopeSha256 = sha({ key: entry.key,
    physicalClock: entry.state.physicalClock, motor: entry.state.motor, intervalMotor: entry.state.intervalMotor });
  return normalized;
});
assert.deepEqual(snapshots[1], snapshots[0], 'complete retained live snapshot mismatch');
const result = { version: 'NativeStateConsumptionDifferential1', status: 'passed', source: root,
  oldBuild: resolve(oldBuild), newBuild: resolve(newBuild), initialCheckpointSha256: hash(initialBytes),
  originalWindowHashes: events.map(({file, sha256}) => ({file, sha256})), originalWindows: events.length, statesCompared,
  completeWorldSnapshotsCompared: events.length, originalEnvelopesVerified: snapshots.reduce((sum, value) => sum + value.frames.length, 0),
  normalizedLiveSha256: hash(JSON.stringify(snapshots[0])), worldSha256: hash(JSON.stringify(contexts[0].world.snapshot())),
  realActions: 0, newIndependentWindows: 0, thetaWrites: 0,
  scope: 'Private exact differential. Only random owner epoch and its independently checked envelope digest are normalized; actual clocks, sensory digests, history, world memory and every trace state remain compared.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, originalWindowHashes: result.originalWindowHashes.length }));
