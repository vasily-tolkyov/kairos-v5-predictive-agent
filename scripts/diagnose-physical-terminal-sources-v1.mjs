/** Diagnostic ablations of immutable physical inputs, not qualification. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { continuationCandidateForInputV1 } from '../dist/src/core/learning/distributed-r2a-physical.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';

const [inputDirectory, outputDirectory] = process.argv.slice(2);
if (!inputDirectory || !outputDirectory) throw new Error('source-and-new-output-required');
await mkdir(outputDirectory, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(inputDirectory, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(inputDirectory, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256) throw new Error('source-mismatch');
const resting = { ...snapshot.r2a.medium,
  sites: snapshot.r2a.medium.sites.map(site => ({ ...site, activation: 0 })) };
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(resting);
const before = canonicalStreamSha256(medium.snapshot());
const domains = snapshot.r2a.patterns.map(pattern => ({ id: pattern.patternId,
  sites: snapshot.r2a.eventInputs.find(input => pattern.memberR2EventIds.includes(input.eventId)).terminalPulseSiteIds }));
const seed = BigInt(`0x${snapshot.r2a.seedHex.replace(/^0x/, '')}`) ^ 0x696e74657276656en ^ 1n;
const rows = [];
for (const relation of snapshot.r2a.relations) {
  const pattern = snapshot.r2a.patterns.find(pattern => pattern.patternId === relation.patternId);
  const input = snapshot.r2a.eventInputs.find(input => pattern.memberR2EventIds.includes(input.eventId));
  const channels = new Set(relation.factors.flatMap(factor => factor.sourceChannelIds));
  const variableSites = new Set(snapshot.r2a.conditionBindings
    .filter(binding => channels.has(distributedPublicSignalChannelIdV1(binding.signalId)))
    .flatMap(binding => binding.siteIds));
  const conditions = input.conditionDrives;
  const factors = conditions.filter(drive => variableSites.has(drive.siteId));
  const background = conditions.filter(drive => !variableSites.has(drive.siteId));
  const prefix = continuationCandidateForInputV1(input).seedPulses
    .map(pulse => pulse.filter(drive => !variableSites.has(drive.siteId))).filter(pulse => pulse.length);
  const variants = [
    ['terminal-calibration', () => medium.probeSequential([input.terminalPulseDrives
      .filter((_drive, position) => position % 4 !== 0)], seed, 180)],
    ['full-boundary', () => medium.probeConditionedSequence(conditions, prefix, seed, 180)],
    ['ablated-boundary', () => medium.probeConditionedSequence(background, prefix, seed, 180)],
    ['factor-boundary', () => medium.probeConditionedSequence(factors, prefix, seed, 180)],
    ['one-condition-pulse', () => medium.probeSequential([conditions, ...prefix], seed, 180)],
    ['prefix-only', () => medium.probeSequential(prefix, seed, 180)],
  ];
  for (const [variant, run] of variants) {
    const started = performance.now();
    const result = run();
    const terminal = new Map(result.terminalActivations.map(value => [value.siteId, value.meanActivation]));
    const final = new Map(result.run.finalActivations.map(value => [value.siteId, value.activation]));
    const row = { index: rows.length, patternId: pattern.patternId, variant,
      seed: seed.toString(), elapsedMs: performance.now() - started,
      ambiguous: result.ambiguous, core: result.coreSiteIds,
      assemblyId: result.coactivationAssemblyId ?? null, dwell: result.dwellSteps,
      escape: result.escapeRate, directedMass: result.run.directedTransportMass,
      domains: domains.map(domain => ({ id: domain.id,
        sites: domain.sites.map(siteId => ({ siteId,
          mean: terminal.get(siteId) ?? 0, final: final.get(siteId) ?? 0 })) })) };
    rows.push(row);
    await saveJson(resolve(outputDirectory, `READOUT_${row.index}.json`), result);
    await saveJson(resolve(outputDirectory, 'PROGRESS.json'), rows);
    console.log(JSON.stringify({ ...row, domains: row.domains.map(domain => ({ id: domain.id,
      meanMass: domain.sites.reduce((sum, site) => sum + site.mean, 0),
      finalMass: domain.sites.reduce((sum, site) => sum + site.final, 0) })) }));
  }
}
const after = canonicalStreamSha256(medium.snapshot());
if (before !== after) throw new Error('diagnostic-wrote-physical-state');
await saveJson(resolve(outputDirectory, 'RESULT.json'), { sourceSha256: declaration.snapshotSha256,
  diagnosticOnly: true, before, after, rows });
