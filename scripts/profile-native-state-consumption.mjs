import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';

const [build, initialCheckpoint, source, output] = process.argv.slice(2);
assert(output, 'usage: BUILD_DIST INITIAL_SESSION_GZ STOPPED_PASSIVE_ONLY_RUN NEW_PREFIX');
const hash = value => createHash('sha256').update(value).digest('hex');
const root = resolve(source), report = JSON.parse(await readFile(resolve(root, 'results.json')));
assert(report.stoppedAt && report.final.executed === report.initialStats.executed && !report.protocol.frozen);
const initialBytes = await readFile(initialCheckpoint), original = JSON.parse(gunzipSync(initialBytes));
assert.equal(hash(initialBytes), report.checkpointInput.sha256);
const moduleAt = name => import(pathToFileURL(resolve(build, 'src', name + '.js')).href);
const [{ ExperienceFrameFlow }, { ExperienceWorld }, { validateEvent }, { sha }] = await Promise.all([
  moduleAt('experience-frame-flow'), moduleAt('experience-world'), moduleAt('events'), moduleAt('util')]);
const hasSealing = await access(resolve(build, 'src/experience-sealed-evidence.js')).then(() => true, error => {
  if (error.code !== 'ENOENT') throw error; return false;
});
const seal = hasSealing ? (await moduleAt('experience-sealed-evidence')).sealRealEvent : undefined;
const flow = new ExperienceFrameFlow(), world = ExperienceWorld.restore(original.world), events = [];
flow.boundary(JSON.parse(await readFile(resolve(root, 'initial-observation.json'))), undefined, frame => world.observe(frame));
for (const file of (await readdir(resolve(root, 'passive-events'))).filter(file => file.endsWith('.json.gz'))) {
  const bytes = await readFile(resolve(root, 'passive-events', file));
  events.push({ file, sha256: hash(bytes), event: JSON.parse(gunzipSync(bytes)) });
}
events.sort((a, b) => a.event.frames[0].sequence - b.event.frames[0].sequence);
const inspector = new Session(); inspector.connect(); const post = promisify(inspector.post).bind(inspector);
await post('Profiler.enable'); await post('Profiler.start');
const timings = [];
for (const { event, file, sha256 } of events) {
  const began = performance.now();
  // The original validation/digest pass and state/world consumption only.
  // This does not simulate a worker callback or issue an action or theta write.
  if (seal) seal(event); else { validateEvent(event); sha(event); }
  const validated = performance.now(); let worldMs = 0;
  const trace = flow.window(event, undefined, frame => {
    const start = performance.now(); world.observe(frame); worldMs += performance.now() - start;
  });
  assert(trace);
  timings.push({ file, sha256, frames: event.frames.length, validationMs: validated - began,
    stateAndWorldMs: performance.now() - validated, worldMs });
}
const { profile } = await post('Profiler.stop'); inspector.disconnect();
const nodes = new Map(profile.nodes.map(node => [node.id, node])), costs = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const frame = nodes.get(profile.samples[i]).callFrame;
  const name = frame.functionName + ' @ ' + frame.url + ':' + (frame.lineNumber + 1);
  costs.set(name, (costs.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const live = flow.snapshot();
for (const entry of live.frames) assert.equal(entry.envelopeSha256, sha({ key: entry.key,
  physicalClock: entry.state.physicalClock, motor: entry.state.motor, intervalMotor: entry.state.intervalMotor }));
// Check original envelopes before normalizing the private random owner and
// its derived envelope digest. Preserve all actual sensory and clock fields.
const normalized = JSON.parse(JSON.stringify(live, (key, value) => key === 'epoch' ? 'private-replay-epoch' : value));
for (const entry of normalized.frames) entry.envelopeSha256 = sha({ key: entry.key,
  physicalClock: entry.state.physicalClock, motor: entry.state.motor, intervalMotor: entry.state.intervalMotor });
const normalizedLive = JSON.stringify(normalized);
const result = { version: 'NativeStateConsumptionProfile2', source: root, build: resolve(build),
  initialCheckpointSha256: hash(initialBytes), hasSealing, realActions: 0, newIndependentWindows: 0, thetaWrites: 0,
  originalWindows: events.length, worldDigest: hash(JSON.stringify(world.snapshot())),
  liveDigestWithEpochNormalized: hash(normalizedLive), flow: flow.stats,
  totals: Object.fromEntries(['validationMs', 'stateAndWorldMs', 'worldMs'].map(key => [key,
    timings.reduce((sum, row) => sum + row[key], 0)])),
  topSelfMilliseconds: [...costs].sort((a,b) => b[1] - a[1]).slice(0, 25).map(([name, us]) => ({ name, milliseconds: us / 1000 })),
  timings, scope: 'Private state/world CPU diagnostic on an unchanged archived passive stream. No native callback, new experience, action or capability evidence.' };
await writeFile(output + '.cpuprofile', JSON.stringify(profile), { flag: 'wx' });
await writeFile(output + '.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, timings: timings.length }));
