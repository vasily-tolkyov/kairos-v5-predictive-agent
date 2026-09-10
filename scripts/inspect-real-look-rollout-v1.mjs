/** Read-only diagnosis: original physical snapshot, recorded actual observations. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedPhysicalMedium3DV1 as Medium } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedR1ExperienceStoreV1 as Store } from '../dist/src/core/learning/distributed-r1.js';
import { DistributedPredictionCloneV2 as Clone } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { eventRows } from '../dist/src/events.js';
import { canonical, sha, fileSha } from '../dist/src/util.js';
const [source, capture, run, output] = process.argv.slice(2);
if (!output) throw new Error('snapshot-capture-run-new-output-required');
const { snapshot } = await loadSnapshotFromDisk(source);
const medium = Medium.fromSnapshot(snapshot.r1Medium), store = Store.restore(medium, snapshot.r1);
const rows = (await readFile(resolve(capture, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const events = rows.filter(r => r.kind === 'real-event').map(r => r.value);
const audit = JSON.parse(await readFile(resolve(capture, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(capture, 'events.jsonl')))
  throw new Error('unverified-original-experiences');
const runRows = (await readFile(resolve(run, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
const heldout = runRows.find(r => r.kind === 'final-goal-injected').value.observation;
const before = sha(medium.snapshot()), clone = new Clone(medium.snapshot()), reports = [];
for (const yaw of [-15, 15]) {
  const matching = events.filter(e => e.cue.kind === 'look' && e.cue.parameters.yawDegrees === yaw);
  const representative = matching.find(e => e.frames[0].self.properties.gameMode === 'survival');
  if (!representative) throw new Error('no-real-look-experience');
  const qualifications = matching.map(e => store.attractorQualification(e.id));
  const assemblies = [...new Map(qualifications.filter(q => q.status === 'stable-attractor')
    .map(q => [sha(q.coreSiteIds), q.coreSiteIds])).entries()]
    .map(([assemblyId, siteIds]) => ({ assemblyId, siteIds, minimumCoverage: .75, minimumPurity: .75 }));
  const record = store.record(representative.id), action = store.lookupActionCue(representative.cue);
  for (const [kind, observation] of [['recorded-before', representative.frames[0]], ['heldout-before', heldout]]) {
    const current = store.lookupCurrentObservation(observation, eventRows(representative).roleBindings, representative.cue);
    const request = { currentPerceptionSeedSiteIds: current.siteIds, currentPerceptionSeedDrives: current.drives,
      currentPerceptionMode: 'sequential-prefix', realPrefixSeedSiteIds: [current.siteIds],
      realPrefixSeedDrives: [current.drives], actionSeedSiteIds: action.siteIds, actionSeedDrives: action.drives,
      readoutAssemblies: assemblies, seeds: Array.from({ length: 24 }, (_, i) => BigInt(i + 1)), steps: 180 };
    const started = performance.now(), results = clone.runMany(request);
    const report = { yaw, kind, eventId: representative.id, durationMs: performance.now() - started,
      current, originalPulses: record.episodeTopology.pulses, action, assemblies,
      qualifications, results, reached: results.filter(r => r.status === 'reached').length,
      public: results.map(r => store.readPublicState(r.fieldRun.finalActivations
        .filter(a => r.attractorReadout.coreSiteIds.includes(a.siteId))
        .map(a => ({ siteId: a.siteId, intensity: a.activation })))) };
    reports.push(report);
    console.log(JSON.stringify({ yaw, kind, assemblies: assemblies.map(a => a.siteIds.length),
      prefix: current.siteIds.length, unresolved: current.unresolvedRoles, reached: report.reached,
      durationMs: report.durationMs, originalPrefixEqual: canonical(current.drives) === canonical(record.episodeTopology.pulses[0]),
      firstCore: results[0].attractorReadout.coreSiteIds,
      firstReason: results[0].reason }));
  }
}
await writeFile(output, canonical({ version: 'RealLookPhysicalDiagnosisV1', before, after: sha(medium.snapshot()),
  readOnly: before === sha(medium.snapshot()), notCapabilityTest: true, reports }), { flag: 'wx' });
