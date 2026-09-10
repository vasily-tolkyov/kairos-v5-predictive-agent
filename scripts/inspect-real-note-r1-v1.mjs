/** Read-only component diagnosis over already verified real Minecraft events. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedR1ExperienceStoreV1 } from '../dist/src/core/learning/distributed-r1.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { eventRows } from '../dist/src/events.js';
import { fileSha, sha } from '../dist/src/util.js';

const input = process.argv[2], output = process.argv[3];
if (!input || !output) throw new Error('capture-and-new-report-required');
const audit = JSON.parse(await readFile(resolve(input, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(input, 'events.jsonl')))
  throw new Error('verified-real-events-required');
const events = (await readFile(resolve(input, 'events.jsonl'), 'utf8')).trim().split('\n')
  .map(line => JSON.parse(line)).filter(record => record.kind === 'real-event').map(record => record.value);
const medium = new DistributedPhysicalMedium3DV1({ name: 'R1', seedHex: '5231' });
const store = new DistributedR1ExperienceStoreV1(medium);
let activeSeconds = 0;
for (const event of events) {
  const time = event.frames.at(-1).activeSeconds;
  medium.recover(time - activeSeconds); activeSeconds = time;
  store.observe(event);
}
const noteEvents = events.filter(event => event.cue.kind === 'interact');
const event = noteEvents.find(value => eventRows(value).changes.flat()
  .some(change => change.property === 'note' && change.before === '0' && change.after === '1'));
if (!event) throw new Error('no-observed-note-transition');
const started = performance.now();
const qualifications = noteEvents.map(value => ({ eventId: value.id, changes: eventRows(value).changes.flat(),
  qualification: store.attractorQualification(value.id) }));
console.log(JSON.stringify({ stage: 'qualified', noteEvents: noteEvents.length,
  stable: qualifications.filter(value => value.qualification.status === 'stable-attractor').length,
  durationMs: performance.now() - started }));
const current = store.lookupCurrentObservation(event.frames[0], eventRows(event).roleBindings, event.cue);
const action = store.lookupActionCue(event.cue);
const assemblies = [...new Map(qualifications.filter(value => value.qualification.status === 'stable-attractor')
  .map(value => [sha(value.qualification.coreSiteIds), value.qualification])).entries()]
  .map(([assemblyId, q]) => ({ assemblyId, siteIds: q.coreSiteIds, minimumCoverage: .75, minimumPurity: .75 }));
const before = sha(medium.snapshot());
const clone = new DistributedPredictionCloneV2(medium.snapshot());
const results = clone.runMany({ currentPerceptionSeedSiteIds: current.siteIds,
  currentPerceptionSeedDrives: current.drives, currentPerceptionMode: 'sequential-prefix',
  realPrefixSeedSiteIds: [current.siteIds], ...(current.drives ? { realPrefixSeedDrives: [current.drives] } : {}),
  actionSeedSiteIds: action.siteIds, actionSeedDrives: action.drives, readoutAssemblies: assemblies,
  seeds: Array.from({ length: 24 }, (_, i) => BigInt(i + 1)), steps: 180 });
const readouts = results.map(result => {
  const core = new Set(result.attractorReadout.coreSiteIds);
  return { status: result.status, reason: result.reason,
    public: store.readPublicState(result.fieldRun.finalActivations.filter(value => core.has(value.siteId))
      .map(value => ({ siteId: value.siteId, intensity: value.activation }))), result };
});
const after = sha(medium.snapshot());
await writeFile(output, JSON.stringify({ version: 'RealMinecraftR1ComponentDiagnosisV1',
  sourceEventsSha256: audit.eventsSha256, queryFromRecordedObservation: event.id,
  notHeldoutQualification: true, simulatedWorldCalls: 0, current, action, assemblies,
  qualifications, before, after, readOnly: before === after, readouts }), { flag: 'wx' });
console.log(JSON.stringify({ readOnly: before === after, samples: results.length,
  reached: results.filter(result => result.status === 'reached').length,
  decoded: readouts.map(value => ({ status: value.status,
    channels: value.public.channels.filter(channel => channel.status === 'decoded')
      .map(channel => ({ channel: channel.channel, value: channel.value })) })) }));
