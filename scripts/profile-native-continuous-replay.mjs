import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Deliberately restricted to the R6 passive-only clocked stream: no fabricated
// transport/press/release ordering. Private offline replay is not experience.
const [build, initialCheckpoint, source, output] = process.argv.slice(2);
assert(output, 'usage: BUILD_DIST INITIAL_SESSION_GZ STOPPED_PASSIVE_ONLY_RUN NEW_PREFIX');
const hash = value => createHash('sha256').update(value).digest('hex');
const root = resolve(source), report = JSON.parse(await readFile(resolve(root, 'results.json')));
assert(report.stoppedAt && report.final.executed === report.initialStats.executed && !report.protocol.frozen);
const diagnostic = (await readFile(resolve(root, 'body-diagnostics.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
assert(!diagnostic.some(row => row.kind === 'body-motor-edge'), 'passive profile cannot reconstruct missing motor transport');
const initialBytes = await readFile(initialCheckpoint), original = JSON.parse(gunzipSync(initialBytes));
assert.equal(hash(initialBytes), report.checkpointInput.sha256);
const [{ ExperienceMedium }, { ExperienceFrameFlow }] = await Promise.all([
  import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href),
  import(pathToFileURL(resolve(build, 'src/experience-frame-flow.js')).href) ]);
const final = JSON.parse(gunzipSync(await readFile(resolve(root, 'session.json.gz')))), events = [];
for (const file of (await readdir(resolve(root, 'passive-events'))).filter(file => file.endsWith('.json.gz'))) {
  const bytes = await readFile(resolve(root, 'passive-events', file));
  events.push({ file, sha256: hash(bytes), event: JSON.parse(gunzipSync(bytes)) });
}
events.sort((a, b) => a.event.frames[0].sequence - b.event.frames[0].sequence);
assert(events.length === report.final.writes - report.initialStats.writes);
const medium = ExperienceMedium.restore(original.medium), flow = new ExperienceFrameFlow();
flow.boundary(JSON.parse(await readFile(resolve(root, 'initial-observation.json'))));
const inspector = new Session(); inspector.connect(); const post = promisify(inspector.post).bind(inspector);
await post('Profiler.enable'); await post('Profiler.start');
const timings = [];
for (const { event, file, sha256 } of events) {
  const begin = performance.now(), liveTrace = flow.window(event), assimilated = performance.now(); assert(liveTrace);
  const receipt = medium.observe(event, { liveTrace });
  timings.push({ file, sha256, parentWindowId: event.id, frames: event.frames.length,
    assimilationMs: assimilated - begin, learningMs: performance.now() - assimilated, learned: receipt.learned });
}
const { profile } = await post('Profiler.stop'); inspector.disconnect();
const nodes = new Map(profile.nodes.map(node => [node.id, node])), time = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const node = nodes.get(profile.samples[i]), name = node.callFrame.functionName + ' @ ' + node.callFrame.url + ':' + (node.callFrame.lineNumber + 1);
  time.set(name, (time.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const actualDigest = hash(JSON.stringify(final.medium)), replayDigest = hash(JSON.stringify(medium.snapshot()));
const result = { version: 'NativeContinuousReplayProfile1', source: root, build: resolve(build),
  initialCheckpoint: resolve(initialCheckpoint), initialCheckpointSha256: hash(initialBytes), actualDigest, replayDigest,
  exactFinalModelMatch: actualDigest === replayDigest, realActions: 0, newIndependentWindows: 0,
  offlineReplayUpdates: timings.filter(row => row.learned).length,
  totalAssimilationMs: timings.reduce((sum, row) => sum + row.assimilationMs, 0),
  totalLearningMs: timings.reduce((sum, row) => sum + row.learningMs, 0),
  topSelfMilliseconds: [...time].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, us]) => ({ name, milliseconds: us / 1000 })),
  timings, scope: 'Private offline CPU diagnostic of an archived passive-only real stream. No native actions, new training evidence or capability result. Exact final theta equality is checked, not presumed.' };
await writeFile(output + '.cpuprofile', JSON.stringify(profile), { flag: 'wx' });
await writeFile(output + '.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, timings: timings.length }));
assert(result.exactFinalModelMatch, 'offline live replay differs from the stopped native model; retain and investigate');
