/** Frozen real input counterfactual. No live actions or persistent learning. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';

const [inputDirectory, outputDirectory] = process.argv.slice(2);
if (!inputDirectory || !outputDirectory) throw new Error('source-and-new-output-required');
await mkdir(outputDirectory, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(inputDirectory, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(inputDirectory, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256) throw new Error('source-mismatch');
const events = new Map(snapshot.r2.events.map(event => [event.eventId, event]));
const inputPorts = new Set(snapshot.r2a.eventInputs.flatMap(input => [
  ...input.actionSiteIds,
  ...events.get(input.eventId).atomPulseRanges.flatMap(range => input.projectedPulseSiteIds[range.startPulseIndex + 1]),
]));
const physical = snapshot.r2a.medium;
const queryState = { ...physical, sites: physical.sites.map(site => ({ ...site, activation: 0 })),
  learnedBonds: physical.learnedBonds.filter(bond => bond.kind !== 'plastic-directed'
    || !inputPorts.has(bond.toSiteId)) };
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(queryState);
const before = canonicalStreamSha256(medium.snapshot());
const rows = [];
const seed = BigInt(`0x${snapshot.r2a.seedHex.replace(/^0x/, '')}`) ^ 0x696e74657276656en ^ 1n;
for (const relation of snapshot.r2a.relations) {
  const pattern = snapshot.r2a.patterns.find(pattern => pattern.patternId === relation.patternId);
  const input = snapshot.r2a.eventInputs.find(input => pattern.memberR2EventIds.includes(input.eventId));
  const event = events.get(input.eventId);
  const prefix = [];
  event.atomPulseRanges.forEach((range, atomIndex) => {
    prefix.push(input.actionPulseDrives[atomIndex]);
    const end = atomIndex === event.atomPulseRanges.length - 1
      ? range.startPulseIndex + 2 : range.endPulseIndexExclusive;
    for (let index = range.startPulseIndex; index < end; index++) prefix.push(input.projectedPulseDrives[index]);
  });
  const channels = new Set(relation.factors.flatMap(factor => factor.sourceChannelIds));
  const variableSites = new Set(snapshot.r2a.conditionBindings
    .filter(binding => channels.has(distributedPublicSignalChannelIdV1(binding.signalId)))
    .flatMap(binding => binding.siteIds));
  for (const variant of ['terminal-calibration', 'full-boundary', 'ablated-boundary']) {
    const started = performance.now();
    const condition = input.conditionDrives.filter(drive => variant !== 'ablated-boundary'
      || !variableSites.has(drive.siteId));
    const result = variant === 'terminal-calibration'
      ? medium.probeSequential([input.terminalPulseDrives.filter((_drive, position) => position % 4 !== 0)], seed, 180)
      : medium.probeConditionedSequence(condition, prefix, seed, 180);
    const row = { patternId: pattern.patternId, variant, elapsedMs: performance.now() - started,
      prefixSizes: prefix.map(p => p.length), core: result.coreSiteIds,
      nominalTerminal: input.terminalPulseSiteIds,
      ambiguous: result.ambiguous, dwell: result.dwellSteps, escape: result.escapeRate,
      assemblyId: result.coactivationAssemblyId ?? null,
      directedTransportMass: result.run.directedTransportMass };
    await saveJson(resolve(outputDirectory, `READOUT_${rows.length}.json`), result);
    rows.push(row);
    await saveJson(resolve(outputDirectory, 'PROGRESS.json'), rows);
    console.log(JSON.stringify(row));
  }
}
if (before !== canonicalStreamSha256(medium.snapshot())) throw new Error('probe-wrote-query-state');
await saveJson(resolve(outputDirectory, 'RESULT.json'), { diagnosticOnly: true,
  sourceSha256: declaration.snapshotSha256, inputPorts: [...inputPorts],
  removedIncomingBonds: physical.learnedBonds.length - queryState.learnedBonds.length,
  sourceUnchanged: declaration.snapshotSha256 === canonicalStreamSha256(snapshot), rows });
