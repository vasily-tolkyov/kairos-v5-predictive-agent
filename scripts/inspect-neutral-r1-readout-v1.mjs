import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { DistributedR1ExperienceStoreV1 } from '../dist/src/core/learning/distributed-r1.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { canonical, sha } from '../dist/src/util.js';

if (!process.argv[2] || !process.argv[3]) throw new Error('snapshot-and-new-report-required');
const { snapshot } = JSON.parse(gunzipSync(await readFile(process.argv[2])));
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot.r1Medium);
const store = DistributedR1ExperienceStoreV1.restore(medium, snapshot.r1);
const annotations = snapshot.annotations.filter(a => a.cue.kind === 'select-hotbar' && a.cue.parameters.slot === 0);
const annotation = annotations.find(a => a.changeWaves.flat().some(c => c.property === 'P'));
if (!annotation) throw new Error('no-learned-neutral-change');
const observation = { sequence: 10000, activeSeconds: snapshot.activeSeconds, contextId: 'diagnostic-current',
  targetId: null, self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot: 8 } },
  objects: [{ id: 'new-public-o', type: 'opaque', relativePosition: [0, 0, -1],
    properties: { Q: true, P: false, F: false, R: false, D: false } }] };
const fullCurrent = store.lookupCurrentObservation(observation, annotation.publicRoleBindings);
const scopedInput = process.argv.includes('--observed-input-scope');
// Diagnostic only: a membership mask from all previously observed pre-action
// populations for this exact cue. Values still come solely from current reality.
const inputSites = new Set(annotations.flatMap(a =>
  store.record(a.eventId).episodeTopology.pulses[0].map(drive => drive.siteId)));
const scopedChannels = snapshot.r1.projection.bindings.filter(binding =>
  binding.descriptor?.source === 'public-state'
    && binding.siteIds.some(site => inputSites.has(site)))
  .map(binding => binding.descriptor.channel);
const scopeSites = new Set(snapshot.r1.projection.bindings.filter(binding =>
  scopedChannels.includes(binding.descriptor?.channel)).flatMap(binding => binding.siteIds));
const current = scopedInput ? { ...fullCurrent,
  siteIds: fullCurrent.siteIds.filter(site => scopeSites.has(site)),
  drives: fullCurrent.drives?.filter(drive => scopeSites.has(drive.siteId)) } : fullCurrent;
const fullAction = store.lookupActionCue(annotation.cue);
const exactOnly = process.argv.includes('--exact-cue-only');
const exactBinding = snapshot.r1.projection.bindings.find(binding =>
  binding.descriptor?.source === 'cue' && binding.descriptor.channel === 'exact-cue'
    && binding.descriptor.categoricalValue === canonical(canonical(annotation.cue)));
if (exactOnly && !exactBinding) throw new Error('existing-exact-cue-binding-required');
const exactSites = new Set(exactBinding?.siteIds ?? []);
const action = exactOnly ? { ...fullAction,
  siteIds: fullAction.siteIds.filter(site => exactSites.has(site)),
  drives: fullAction.drives?.filter(drive => exactSites.has(drive.siteId)) } : fullAction;
const assemblies = [...new Map(annotations.map(a => {
  const qualification = store.attractorQualification(a.eventId);
  return [sha(qualification.coreSiteIds), qualification];
})).entries()].filter(([, q]) => q.status === 'stable-attractor').map(([id, q]) => ({
  assemblyId: id, siteIds: q.coreSiteIds, minimumCoverage: .75, minimumPurity: .75 }));
const before = sha(medium.snapshot());
const clone = new DistributedPredictionCloneV2(medium.snapshot());
const results = clone.runMany({ currentPerceptionSeedSiteIds: current.siteIds,
  currentPerceptionSeedDrives: current.drives, currentPerceptionMode: 'sequential-prefix',
  realPrefixSeedSiteIds: [current.siteIds], ...(current.drives ? { realPrefixSeedDrives: [current.drives] } : {}),
  actionSeedSiteIds: action.siteIds, actionSeedDrives: action.drives,
  readoutAssemblies: assemblies, seeds: Array.from({ length: 24 }, (_, i) => BigInt(i + 1)), steps: 180 });
const readouts = results.map(result => {
  const core = new Set(result.attractorReadout.coreSiteIds);
  return { status: result.status, reason: result.reason, core: [...core],
    public: store.readPublicState(result.fieldRun.finalActivations.filter(v => core.has(v.siteId))
      .map(v => ({ siteId: v.siteId, intensity: v.activation }))), result };
});
const after = sha(medium.snapshot());
await writeFile(process.argv[3], JSON.stringify({ diagnostic: exactOnly ? 'exact-cue-only-ablation' : 'production-cue',
  scopedInput, scopedChannels, current, action, assemblies, before, after,
  readOnly: before === after, readouts }), { flag: 'wx' });
console.log(JSON.stringify({ readOnly: before === after, count: results.length,
  reached: results.filter(r => r.status === 'reached').length,
  channels: readouts.map(r => r.public.channels.filter(c => c.status === 'decoded')
    .map(c => ({ channel: c.channel, value: c.value }))) }));
