import { writeFile } from 'node:fs/promises';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { canonical } from '../dist/src/util.js';
const [source, output] = process.argv.slice(2);
if (!output) throw new Error('snapshot-and-new-output-required');
const { snapshot } = await loadSnapshotFromDisk(source);
const state = snapshot.r2a;
const medium = DistributedPhysicalMedium3DV1.fromSnapshot({ ...state.medium,
  sites: state.medium.sites.map(s => ({ ...s, activation: 0 })) });
const before = canonicalStreamSha256(medium.snapshot());
const terminals = [...new Map(state.eventInputs.map(i =>
  [canonical(i.terminalPulseDrives), i.terminalPulseDrives])).values()];
const reports = [];
for (const terminal of terminals) {
  const readout = medium.probeSequential([terminal.filter((_, i) => i % 4 !== 0)], 3n, 180);
  reports.push({ observed: terminal, readout });
  console.log(JSON.stringify({ observed: terminal.map(p => p.siteId),
    core: readout.coreSiteIds, assembly: readout.coactivationAssemblyId,
    ambiguous: readout.ambiguous, dwell: readout.dwellSteps, escape: readout.escapeRate }));
}
const after = canonicalStreamSha256(medium.snapshot());
await writeFile(output, canonical({ before, after, readOnly: before === after,
  diagnosticOnly: true, reports }), { flag: 'wx' });
if (before !== after) throw new Error('terminal-diagnostic-mutated-field');
