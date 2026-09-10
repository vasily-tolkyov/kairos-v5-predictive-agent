/** Component diagnosis from frozen real observations. No live world or learning. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedR1ExperienceStoreV1 } from '../dist/src/core/learning/distributed-r1.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { eventRows } from '../dist/src/events.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { fileSha, sha, saveJson } from '../dist/src/util.js';

const [source, capture, output] = process.argv.slice(2);
if (!output) throw new Error('snapshot-directory-capture-directory-output-required');
await mkdir(output, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(source, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(source, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256) throw new Error('source-hash-mismatch');
const audit = JSON.parse(await readFile(resolve(capture, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(capture, 'events.jsonl')))
  throw new Error('raw-event-audit-mismatch');
const events = (await readFile(resolve(capture, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/)
  .map(JSON.parse).filter(row => row.kind === 'real-event').map(row => row.value)
  .filter(event => event.cue.kind === 'interact');
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot.r1Medium);
const store = DistributedR1ExperienceStoreV1.restore(medium, snapshot.r1);
const before = canonicalStreamSha256(medium.snapshot());
const qualifications = events.map(event => store.attractorQualification(event.id));
await saveJson(resolve(output, 'QUALIFICATIONS.json'), qualifications);
console.log(JSON.stringify({ phase: 'R1-qualified', stable: qualifications.filter(q => q.status === 'stable-attractor').length,
  total: qualifications.length }));
const assemblies = [...new Map(qualifications.filter(q => q.status === 'stable-attractor')
  .map(q => [sha(q.coreSiteIds), q.coreSiteIds])).entries()]
  .map(([assemblyId, siteIds]) => ({ assemblyId, siteIds, minimumCoverage: .75, minimumPurity: .75 }));
const clone = new DistributedPredictionCloneV2(medium.snapshot(), store.prescribedActionSiteIds());
const representatives = new Map();
for (const event of events) {
  const change = eventRows(event).changes.flat().find(value => value.property === 'note');
  if (change && !representatives.has(String(change.before))) representatives.set(String(change.before), event);
}
const rows = [];
for (const [initialState, event] of representatives) {
  const current = store.lookupCurrentObservation(event.frames[0], eventRows(event).roleBindings, event.cue);
  const action = store.lookupActionCue(event.cue);
  const results = clone.runMany({ currentPerceptionSeedSiteIds: current.siteIds,
    ...(current.drives === undefined ? {} : { currentPerceptionSeedDrives: current.drives }),
    currentPerceptionMode: 'sequential-prefix', realPrefixSeedSiteIds: [current.siteIds],
    ...(current.drives === undefined ? {} : { realPrefixSeedDrives: [current.drives] }),
    actionSeedSiteIds: action.siteIds,
    ...(action.drives === undefined ? {} : { actionSeedDrives: action.drives }), readoutAssemblies: assemblies,
    seeds: Array.from({ length: 24 }, (_, i) => BigInt(i + 1)), steps: 180 });
  const readouts = results.map(result => ({ status: result.status, reason: result.reason,
    public: store.readPublicState(result.fieldRun.finalActivations
      .filter(value => result.attractorReadout.coreSiteIds.includes(value.siteId) && value.activation > 0)
      .map(value => ({ siteId: value.siteId, intensity: value.activation }))), result }));
  await saveJson(resolve(output, `STATE_${initialState}.json`), { current, action, assemblies, readouts });
  const row = { initialState, reached: results.filter(r => r.status === 'reached').length,
    decoded: readouts.map(r => r.public.channels.filter(c => c.property === 'note')
      .map(c => ({ status: c.status, value: c.value }))) };
  rows.push(row); console.log(JSON.stringify(row));
}
const after = canonicalStreamSha256(medium.snapshot());
if (before !== after) throw new Error('R1-query-wrote-medium');
await saveJson(resolve(output, 'RESULT.json'), { rows, before, after, readOnly: true,
  gameCalls: 0, learningCalls: 0, sourceSnapshot: declaration.snapshotSha256, notHeldoutTest: true });
