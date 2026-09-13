import assert from 'node:assert/strict';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [build, predecessor, source, output] = process.argv.slice(2);
if (!output) throw new Error('usage: BUILD_DIST INITIAL_SESSION_GZ STOPPED_NATIVE_RUN NEW_PREFIX');
const { ExperienceMedium } = await import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const initial = JSON.parse(gunzipSync(await readFile(predecessor))), root = resolve(source);
const final = JSON.parse(gunzipSync(await readFile(resolve(root, 'session.json.gz')))), events = [];
for (const directory of ['events', 'passive-events']) for (const file of (await readdir(resolve(root, directory))).filter(f => f.endsWith('.json.gz'))) {
  const bytes = await readFile(resolve(root, directory, file));
  events.push({ event: JSON.parse(gunzipSync(bytes)), file: directory + '/' + file,
    sha256: createHash('sha256').update(bytes).digest('hex') });
}
events.sort((a, b) => a.event.frames[0].sequence - b.event.frames[0].sequence);
const memory = ExperienceMedium.restore(initial.medium), timings = [];
const inspector = new Session(); inspector.connect(); const post = promisify(inspector.post).bind(inspector);
await post('Profiler.enable'); await post('Profiler.start');
for (const { event, file, sha256 } of events) {
  const start = performance.now(), result = memory.observe(event);
  timings.push({ file, sha256, event: event.id, milliseconds: performance.now() - start,
    frames: event.frames.length, objects: event.frames[0].objects.length, learned: result.learned });
}
const { profile } = await post('Profiler.stop'); inspector.disconnect();
const nodes = new Map(profile.nodes.map(node => [node.id, node])), time = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const node = nodes.get(profile.samples[i]), name = node.callFrame.functionName + ' @ ' + node.callFrame.url + ':' + (node.callFrame.lineNumber + 1);
  time.set(name, (time.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const actualDigest = hash(final.medium), replayDigest = hash(memory.snapshot());
const result = { version: 'NativeLearningReplayProfile1', source: root, build: resolve(build), initialCheckpoint: resolve(predecessor),
  realActions: 0, offlineReplayUpdates: timings.filter(row => row.learned).length,
  actualDigest, replayDigest, exactFinalModelMatch: actualDigest === replayDigest,
  topSelfMilliseconds: [...time].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, microseconds]) => ({ name, milliseconds: microseconds / 1000 })),
  timings, scope: 'Fresh private replay of archived real windows for CPU diagnosis; updates are not new independent evidence or actual-machine action trials.' };
await writeFile(output + '.cpuprofile', JSON.stringify(profile), { flag: 'wx' });
await writeFile(output + '.json', JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...result, timings: timings.length }));
assert(result.exactFinalModelMatch, 'offline replay differs from the stopped native model; preserve and investigate');
