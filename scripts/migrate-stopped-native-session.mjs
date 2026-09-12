import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { ExperienceSession } from '../dist/src/experience-session.js';

const [predecessorPath, encodingPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('usage: STOPPED_NATIVE_RUN REENCODED_SESSION_GZ NEW_MIGRATED_CHECKPOINT_GZ');
const predecessor = resolve(predecessorPath), encoding = resolve(encodingPath), output = resolve(outputPath);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(resolve(predecessor, 'session.json.gz'));
const source = JSON.parse(gunzipSync(sourceBytes)), report = JSON.parse(await readFile(resolve(predecessor, 'results.json'), 'utf8'));
const encodingBytes = await readFile(encoding), rebuilt = JSON.parse(gunzipSync(encodingBytes));
const provenanceBytes = await readFile(encoding + '.provenance.json'), provenance = JSON.parse(provenanceBytes);
assert(report.stoppedAt && report.final && report.status !== 'running', 'source-world-must-be-stopped');
assert.equal(source.version, 'ExperienceSession1'); assert.equal(rebuilt.version, 'ExperienceSession1');
assert.equal(source.steps, report.final.decisions); assert.equal(source.executed, report.final.executed);
assert.equal(source.medium.writes, report.final.writes); assert.equal(rebuilt.medium.writes, source.medium.writes);
assert.equal(provenance.newPhysicalTrials, 0); assert.equal(provenance.writes, rebuilt.medium.writes);
assert.equal(provenance.evidence.length, rebuilt.medium.writes);
const reconstructedIds = new Set(provenance.evidence.map(event => event.eventId));
assert.equal(reconstructedIds.size, provenance.evidence.length);
assert(source.medium.events.every(([id]) => reconstructedIds.has(id)), 'retained-original-events-must-be-in-the-reencoding');
const snapshot = structuredClone(source);
snapshot.medium = rebuilt.medium; snapshot.affordances = rebuilt.affordances;
snapshot.recent = []; snapshot.maintenance = null; snapshot.investigation = null; snapshot.deferred = [];
for (const task of snapshot.tasks) {
  // A relative user goal cannot acquire a fabricated historical baseline.
  if (JSON.stringify(task.goal).includes('properties.oxygen')) throw new Error('an-oxygen-user-goal-needs-a-verified-original-baseline');
  if (task.baseline?.self?.properties) delete task.baseline.self.properties.oxygen;
  task.firstSatisfied = null; task.confirmations = 0; delete task.lastConfirmedSequence;
  task.unsuccessfulProbes = 0; task.probeAfter = 0; delete task.progressMetric;
}
const restored = ExperienceSession.restore(snapshot, { sameWorld: true });
assert.equal(restored.stats.decisions, report.final.decisions); assert.equal(restored.stats.executed, report.final.executed);
assert.equal(restored.stats.writes, report.final.writes);
assert.equal(restored.stats.retainedPlaces, report.final.retainedPlaces);
const metadata = { version: 'ReencodedNativeCheckpoint1', predecessor, sourceSessionSha256: digest(sourceBytes),
  encoding, encodingSha256: digest(encodingBytes), encodingProvenanceSha256: digest(provenanceBytes),
  newPhysicalTrials: 0, preserved: ['world', 'physical counters', 'pending user goals', 'exploration choice counter'],
  invalidated: ['short-term forecast/refutation feedback', 'maintenance baseline', 'unfinished exploratory intention'],
  reason: 'Reconstructed predictive state from original measured windows after body-channel ownership repair.' };
const bytes = gzipSync(JSON.stringify({ ...metadata, session: snapshot }));
await writeFile(output, bytes, { flag: 'wx' });
await writeFile(output + '.provenance.json', JSON.stringify({ ...metadata, output, outputSha256: digest(bytes) }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, bytes: bytes.length, ...restored.stats, newPhysicalTrials: 0 }));
