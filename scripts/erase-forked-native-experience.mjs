import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Experimental ablation only: a copied, initialized world with no actions in
// that world. Original source artifacts are retained and never overwritten.
const [build, directory] = process.argv.slice(2);
if (!directory) throw new Error('required: BUILD_DIST COPIED_INITIAL_PREDECESSOR');
const root = resolve(directory), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reportBytes = await readFile(resolve(root, 'results.json'));
const report = JSON.parse(reportBytes), fork = JSON.parse(await readFile(resolve(root, 'fork-provenance.json')));
if (!report.stoppedAt || report.protocol.steps !== 0 || fork.source === root
  || existsSync(resolve(root, 'learning-ablation.json'))) throw new Error('requires-an-unused-fork-of-an-initialized-world');
const bytes = await readFile(resolve(root, 'session.json.gz'));
if (hash(bytes) !== fork.sessionSha256) throw new Error('copied-session-no-longer-matches-its-source');
const original = JSON.parse(gunzipSync(bytes));
if (original.tasks.length || original.recent.length || original.world.places.length || original.world.surfaces.length)
  throw new Error('the-fresh-world-already-has-local-execution-state');
const { ExperienceSession } = await import(pathToFileURL(resolve(build, 'src/experience-session.js')).href);
const { ExperienceMedium } = await import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href);
const { LearnedAffordances } = await import(pathToFileURL(resolve(build, 'src/learned-affordances.js')).href);
const changed = { ...original, medium: new ExperienceMedium(original.medium.seed).snapshot(),
  affordances: new LearnedAffordances().snapshot() };
const session = ExperienceSession.restore(changed, { sameWorld: true });
if (session.stats.writes !== 0 || session.stats.decisions !== original.steps || session.agent.choices !== original.choices)
  throw new Error('ablation-changed-nonlearning-counters');
const properties = await readFile(resolve(report.runtimeRoot, 'minecraft/server.properties'), 'utf8');
const level = properties.split(/\r?\n/).find(line => line.startsWith('level-name='))?.slice(11);
if (!level || level.includes('/') || level.includes('\\')) throw new Error('invalid-configured-world-name');
for (const [path, sha256] of Object.entries(fork.worldFiles))
  if (hash(await readFile(resolve(report.runtimeRoot, 'minecraft', level, path))) !== sha256)
    throw new Error('copied-world-changed-before-ablation');
const output = gzipSync(JSON.stringify(session.snapshot()));
const provenance = { version: 'NativeExperienceAblation1', source: fork.source,
  beforeSessionSha256: hash(bytes), afterSessionSha256: hash(output), originalReportSha256: hash(reportBytes),
  beforeWrites: original.medium.writes, afterWrites: 0, preservedChoices: original.choices,
  unchangedWorldTreeSha256: fork.worldTreeSha256, newPhysicalTrials: 0,
  scope: 'Erase learned dynamics and affordances in one copied fresh-world starting state; preserve physical counters, world and motor sampling counter.' };
await writeFile(resolve(root, 'before-ablation-session.json.gz'), bytes, { flag: 'wx' });
await writeFile(resolve(root, 'before-ablation-results.json'), reportBytes, { flag: 'wx' });
await writeFile(resolve(root, 'erased-session.pending.json.gz'), output);
await rename(resolve(root, 'erased-session.pending.json.gz'), resolve(root, 'session.json.gz'));
report.learningAblation = provenance; report.final = { compressedBytes: output.length, ...session.stats };
await writeFile(resolve(root, 'results.json'), JSON.stringify(report, null, 2));
await writeFile(resolve(root, 'learning-ablation.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
console.log(JSON.stringify(provenance));
