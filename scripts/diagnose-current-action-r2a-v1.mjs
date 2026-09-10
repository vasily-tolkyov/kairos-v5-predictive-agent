/** Only current recorded perception plus an explicit command, no past route. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';
const [inputDirectory, outputDirectory] = process.argv.slice(2);
await mkdir(outputDirectory, { recursive: false });
const d = JSON.parse(await readFile(resolve(inputDirectory, 'pre-intervention.json'), 'utf8'));
const { snapshot: s } = await loadSnapshotFromDisk(resolve(inputDirectory, d.snapshotFile));
if (canonicalStreamSha256(s) !== d.snapshotSha256) throw new Error('source-hash-mismatch');
const events = new Map(s.r2.events.map(e => [e.eventId, e]));
const ports = [...new Set(s.r2a.eventInputs.flatMap(i => [...i.actionSiteIds,
  ...i.projectedCommandPulseIndices.flatMap(n => i.projectedPulseSiteIds[n])]))];
const physical = { ...s.r2a.medium, sites: s.r2a.medium.sites.map(site => ({ ...site, activation: 0 })) };
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(physical, ports), rows = [];
for (const pattern of s.r2a.patterns) {
  const input = s.r2a.eventInputs.find(i => pattern.memberR2EventIds.includes(i.eventId));
  const e = events.get(input.eventId), range = e.atomPulseRanges.at(-1);
  const current = input.projectedPulseDrives[range.startPulseIndex];
  const command = [...input.actionPulseDrives.at(-1), ...input.projectedPulseDrives[range.startPulseIndex + 1]];
  for (const seed of [1n, 2n]) {
    const readout = medium.probeConditionedSequence(input.conditionDrives, [current, command], seed, 180);
    const row = { patternId: pattern.patternId, seed: String(seed), target: pattern.attractor.coreSiteIds,
      actual: readout.coreSiteIds, ambiguous: readout.ambiguous, dwell: readout.dwellSteps,
      matchingCore: JSON.stringify(pattern.attractor.coreSiteIds) === JSON.stringify(readout.coreSiteIds),
      actualCurrentPrefixLength: 1, actualCommandPulseCount: 1 };
    rows.push(row); console.log(JSON.stringify(row));
    await saveJson(resolve(outputDirectory, `READOUT_${rows.length}.json`), readout);
  }
}
await saveJson(resolve(outputDirectory, 'RESULT.json'), { rows, noHistoricalResultOrRouteInjected: true,
  sourceUnchanged: d.snapshotSha256 === canonicalStreamSha256(s),
  queryUnchanged: canonicalStreamSha256(medium.snapshot()) === canonicalStreamSha256(physical) });
