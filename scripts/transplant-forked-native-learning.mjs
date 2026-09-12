import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Counterfactual retention apparatus only. Change transferable learned state
// in an unused initial-world copy; preserve its task, world and sampling state.
const [build, directory, donorDirectory] = process.argv.slice(2);
assert(build && directory && donorDirectory, 'usage: BUILD_DIST UNUSED_INITIAL_FORK STOPPED_DONOR');
const root = resolve(directory), donor = resolve(donorDirectory);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reportBytes = await readFile(resolve(root, 'results.json')), report = JSON.parse(reportBytes);
const fork = JSON.parse(await readFile(resolve(root, 'fork-provenance.json')));
assert(report.stoppedAt && report.protocol.steps === 0 && fork.source !== root);
assert(!existsSync(resolve(root, 'learning-transplant.json')) && !existsSync(resolve(root, 'learning-ablation.json')));
const bytes = await readFile(resolve(root, 'session.json.gz'));
assert.equal(hash(bytes), fork.sessionSha256, 'initial copied session was modified');
const initial = JSON.parse(gunzipSync(bytes));
assert(!initial.tasks.length && !initial.recent.length && !initial.world.places.length && !initial.world.surfaces.length,
  'only an unused initial world may receive a retention-model transplant');
const donorReportBytes = await readFile(resolve(donor, 'results.json')), donorReport = JSON.parse(donorReportBytes);
assert(donorReport.stoppedAt && donorReport.final && donorReport.status !== 'running');
const donorBytes = await readFile(resolve(donor, 'session.json.gz')), state = JSON.parse(gunzipSync(donorBytes));
assert.equal(state.version, 'ExperienceSession1');
assert.equal(state.steps, donorReport.final.decisions); assert.equal(state.executed, donorReport.final.executed);
assert.equal(state.medium.writes, donorReport.final.writes);
const { ExperienceSession } = await import(pathToFileURL(resolve(build, 'src/experience-session.js')).href);
const changed = { ...initial, medium: state.medium, affordances: state.affordances };
const session = ExperienceSession.restore(changed, { sameWorld: true }), saved = session.snapshot();
const withoutLearning = ({ medium: _medium, affordances: _affordances, ...rest }) => rest;
assert.deepEqual(withoutLearning(saved), withoutLearning(initial), 'nonlearning control state changed');
assert.deepEqual(saved.medium, state.medium); assert.deepEqual(saved.affordances, state.affordances);
const properties = await readFile(resolve(report.runtimeRoot, 'minecraft/server.properties'), 'utf8');
const level = properties.split(/\r?\n/).find(line => line.startsWith('level-name='))?.slice(11);
assert(level && !level.includes('/') && !level.includes('\\') && level !== '..');
for (const [path, expected] of Object.entries(fork.worldFiles))
  assert.equal(hash(await readFile(resolve(report.runtimeRoot, 'minecraft', level, path))), expected,
    'initial world was modified before transplant');
const output = gzipSync(JSON.stringify(saved));
const provenance = { version: 'NativeLearningRetentionTransplant1', initialSource: fork.source, donor,
  beforeSessionSha256: hash(bytes), afterSessionSha256: hash(output), donorSessionSha256: hash(donorBytes),
  donorReportSha256: hash(donorReportBytes), originalReportSha256: hash(reportBytes),
  beforeWrites: initial.medium.writes, afterWrites: saved.medium.writes, preservedChoices: initial.choices,
  preservedInitialCounters: { decisions: initial.steps, executed: initial.executed, passiveWindows: initial.passiveWindows },
  unchangedWorldTreeSha256: fork.worldTreeSha256, newPhysicalTrials: 0,
  scope: 'Only learned dynamics and affordances come from the stopped later model. All nonlearning initial controls and world bytes are unchanged. This preparation is not another learning trial.' };
await writeFile(resolve(root, 'before-transplant-session.json.gz'), bytes, { flag: 'wx' });
await writeFile(resolve(root, 'before-transplant-results.json'), reportBytes, { flag: 'wx' });
await writeFile(resolve(root, 'transplanted-session.pending.json.gz'), output, { flag: 'wx' });
await rename(resolve(root, 'transplanted-session.pending.json.gz'), resolve(root, 'session.json.gz'));
report.learningTransplant = provenance; report.final = { compressedBytes: output.length, ...session.stats };
await writeFile(resolve(root, 'results.json'), JSON.stringify(report, null, 2));
await writeFile(resolve(root, 'learning-transplant.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
console.log(JSON.stringify(provenance));
