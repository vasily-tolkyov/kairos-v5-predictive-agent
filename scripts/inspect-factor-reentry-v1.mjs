/** Read-only inspection of previously measured trajectories; no new probes. */
import { readFile, writeFile } from 'node:fs/promises';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonical, fileSha } from '../dist/src/util.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';
const [source, diagnostic, output] = process.argv.slice(2);
if (!output) throw new Error('snapshot-diagnostic-new-output-required');
const { snapshot } = await loadSnapshotFromDisk(source), state = snapshot.r2a;
const measured = JSON.parse(await readFile(diagnostic, 'utf8'));
const relation = state.relations.find(r => r.relationId === measured.reports[0].relationId);
const channels = new Set(relation.factors.flatMap(f => f.sourceChannelIds));
const bindings = state.conditionBindings.filter(b => channels.has(distributedPublicSignalChannelIdV1(b.signalId)));
const summaries = measured.reports.map(report => {
  const late = new Map(report.readout.terminalActivations.map(p => [p.siteId, p.meanActivation]));
  const final = new Map(report.readout.run.finalActivations.map(p => [p.siteId, p.activation]));
  return { mode: report.mode, factors: bindings.map(b => ({ signalId: b.signalId,
    values: b.siteIds.map(site => ({ siteId: site,
      // Held condition basins are deliberately excluded from terminal statistics.
      // Absence from that readout is not a measurement of zero activation.
      lateMeanActivation: late.get(site) ?? null, finalActivation: final.get(site) ?? 0 })) })),
    actualReadoutCore: report.readout.coreSiteIds,
    coreSources: report.readout.coreSiteIds.map(siteId => ({ siteId,
      projectedFrom: state.projection.bindings.filter(b => b.targetSiteIds.includes(siteId)).map(b => b.sourceSiteId),
      conditionSignals: state.conditionBindings.filter(b => b.siteIds.includes(siteId)).map(b => b.signalId),
      actions: state.actionBindings.filter(b => b.siteIds.includes(siteId)).map(b => b.signalId) })),
    branchPopulations: [...new Map(state.patterns.map(p => [p.physicalBranchId, p])).values()].map(p => {
      const actual = state.eventInputs.find(i => p.memberR2EventIds.includes(i.eventId));
      return { branchId: p.physicalBranchId, assemblyId: p.attractor.coactivationAssemblyId ?? null,
        observedTerminal: actual.terminalPulseDrives,
        measuredCore: p.attractor.coreSiteIds, expectedProfile: p.attractor.terminalActivations,
        actualProfile: p.attractor.coreSiteIds.map(siteId => ({ siteId, activation: late.get(siteId) ?? 0 })) };
    }),
  };
});
const result = { sourceSha256: await fileSha(source), diagnosticSha256: await fileSha(diagnostic),
  summaries, gameCalls: 0, physicalWrites: 0, newRandomProbes: 0 };
await writeFile(output, canonical(result), { flag: 'wx' });
console.log(canonical(summaries.map(s => ({ mode: s.mode,
  factors: s.factors.map(f => ({ signalId: f.signalId,
    finalMean: f.values.reduce((a,b) => a+b.finalActivation,0)/f.values.length,
    lateMeanUnavailable: f.values.filter(v => v.lateMeanActivation === null).length })),
  branches: s.branchPopulations.map(p => ({ id:p.branchId, assembly:p.assemblyId,
    observed:p.observedTerminal.map(d=>d.siteId), core:p.measuredCore,
    actual:p.actualProfile })) }))));
