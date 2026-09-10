/** Read-only exact-seed diagnosis. No body, learning, or model calls. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedR2APhysicalPatternLearnerV2, continuationCandidateForInputV1 }
  from '../dist/src/core/learning/distributed-r2a-physical.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';
import { physicalResidenceMatchV1, physicalActivationResidenceMatchV1 }
  from '../dist/src/core/prediction/distributed-prediction-clone.js';

const [input, output, mode = 'assessed'] = process.argv.slice(2);
if (!input || !output) throw new Error('assessed-input-and-new-output-required');
if (!['assessed', 'unassessed'].includes(mode)) throw new Error('invalid-diagnostic-source-mode');
await mkdir(output, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(input,
  mode === 'assessed' ? 'EXPERIENCE_LATEST.json' : 'pre-intervention.json'), 'utf8'));
const sourceFile = mode === 'assessed' ? declaration.filename : declaration.snapshotFile;
const sourceSha256 = mode === 'assessed' ? declaration.sha256 : declaration.snapshotSha256;
const { snapshot } = await loadSnapshotFromDisk(resolve(input, sourceFile));
if (canonicalStreamSha256(snapshot) !== sourceSha256) throw new Error('snapshot-hash-mismatch');
const resting = structuredClone(snapshot.r2a.medium);
resting.sites.forEach(site => { site.activation = 0; });
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(resting);
const before = canonicalStreamSha256(medium.snapshot());
const r2 = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot.r2Medium);
const r1 = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot.r1Medium);
const eventById = new Map(snapshot.r2.events.map(event => [event.eventId, event]));
const learner = DistributedR2APhysicalPatternLearnerV2.restore(snapshot.r2a,
  id => {
    const event = eventById.get(id);
    return !!event?.physicalFootprint && r2.isFootprintActive(event.physicalFootprint.traceId)
      && (event.sourceR1Footprints ?? []).every(trace => r1.isFootprintActive(trace.traceId));
  });
const records = [];
for (const relation of snapshot.r2a.relations) {
  const pattern = snapshot.r2a.patterns.find(value => value.patternId === relation.patternId);
  const pair = mode === 'assessed'
    ? snapshot.r2a.interventions.find(value => value.relationId === relation.relationId)
    : [...declaration.interventionPlans, ...declaration.interventionPlans.map(value => ({ ...value,
      baselineR2EventId: value.interventionR2EventId, interventionR2EventId: value.baselineR2EventId }))]
      .find(value => pattern.memberR2EventIds.includes(value.interventionR2EventId));
  if (!pair) throw new Error(`diagnostic-real-pair-missing:${relation.relationId}`);
  const input = snapshot.r2a.eventInputs.find(value => value.eventId === pair.interventionR2EventId);
  const channels = new Set(relation.factors.flatMap(f => f.sourceChannelIds));
  const variableSites = new Set(snapshot.r2a.conditionBindings
    .filter(binding => channels.has(distributedPublicSignalChannelIdV1(binding.signalId)))
    .flatMap(binding => binding.siteIds));
  const pulses = continuationCandidateForInputV1(input).seedPulses
    .map(pulse => pulse.filter(drive => !variableSites.has(drive.siteId))).filter(p => p.length);
  const seed = BigInt(`0x${snapshot.r2a.seedHex.replace(/^0x/, '')}`) ^ 0x696e74657276656en ^ 1n;
  for (const ablated of [false, true]) {
    const conditions = input.conditionDrives.filter(drive => !ablated || !variableSites.has(drive.siteId));
    const start = performance.now();
    const raw = conditions.length ? medium.probeConditionedSequence(conditions, pulses, seed, 180)
      : medium.probeSequential(pulses, seed, 180);
    const index = records.length;
    await saveJson(resolve(output, `readout-${index}.json`), raw);
    records.push({ index, relationId: relation.relationId, patternId: pattern.patternId, ablated,
      seed: seed.toString(), durationMs: performance.now() - start,
      conditionSiteCount: conditions.length, pulseSizes: pulses.map(p => p.length),
      targetCore: pattern.attractor.coreSiteIds, core: raw.coreSiteIds,
      coverage: physicalResidenceMatchV1(raw.coreSiteIds, pattern.attractor.coreSiteIds),
      assemblyId: raw.coactivationAssemblyId ?? null, evidence: raw.evidenceLevel,
      dwell: raw.dwellSteps, escape: raw.escapeRate, ambiguous: raw.ambiguous,
      directedTransportMass: raw.run.directedTransportMass,
      terminalProfile: raw.terminalActivations ?? [] });
    console.log(JSON.stringify({ ...records.at(-1), terminalProfile: undefined }));
    await saveJson(resolve(output, 'PROGRESS.json'), { sourceSha256, mode, records });
  }
}
const branches = learner.physicalBranches();
const universe = [...new Set(branches.flatMap(b => b.topologicalEnvelopeSiteIds))];
for (const record of records) record.branchScores = branches.map(branch => {
  const membership = physicalResidenceMatchV1(record.core, branch.attractor.coreSiteIds);
  const profile = (branch.attractor.terminalActivations ?? [])
    .filter(value => branch.topologicalEnvelopeSiteIds.includes(value.siteId));
  const profileScore = physicalActivationResidenceMatchV1(record.terminalProfile, profile,
    branch.topologicalEnvelopeSiteIds, universe).score;
  const identityCompatible = record.assemblyId === null || record.assemblyId === branch.coactivationAssemblyId;
  return { branchId: branch.branchId, core: branch.attractor.coreSiteIds,
    assemblyId: branch.coactivationAssemblyId, membership, profileScore, identityCompatible,
    score: membership.coverage >= .75 && identityCompatible ? profileScore : 0 };
});
const after = canonicalStreamSha256(medium.snapshot());
if (before !== after) throw new Error('probe-wrote-medium');
await saveJson(resolve(output, 'RESULT.json'), { sourceSha256, mode,
  physicalReadOnly: true, restoreMode: learner.restoreIndexModeForAudit(), records, branches });
console.log(JSON.stringify({ done: true, probes: records.length, physicalReadOnly: true }));
