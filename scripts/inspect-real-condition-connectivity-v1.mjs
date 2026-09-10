import { readFile, writeFile } from 'node:fs/promises';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';
import { scanAnonymousPhysicalStructureV1 } from '../dist/src/core/physics/distributed-physical-structure-scanner.js';

const [inputPath, plansPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('snapshot-plans-and-new-report-required');
const { snapshot } = await loadSnapshotFromDisk(inputPath);
const state = snapshot.r2a;
const pair = JSON.parse(await readFile(plansPath, 'utf8')).interventionPlans[0];
const a = state.eventInputs.find(value => value.eventId === pair.baselineR2EventId);
const b = state.eventInputs.find(value => value.eventId === pair.interventionR2EventId);
const relation = state.relations.find(value => state.patterns.find(p => p.patternId === value.patternId)
  .memberR2EventIds.includes(b.eventId));
const factor = relation.factors[0];
const scan = scanAnonymousPhysicalStructureV1(state.medium);
const factors = state.conditionBindings.filter(value => factor.sourceChannelIds
  .includes(distributedPublicSignalChannelIdV1(value.signalId))).map(binding => {
  const terminal = new Set(state.eventInputs.filter(value =>
    binding.siteIds.every(site => value.conditionSiteIds.includes(site))).flatMap(value => value.terminalPulseSiteIds));
  const next = new Set(state.eventInputs.filter(value =>
    binding.siteIds.every(site => value.conditionSiteIds.includes(site))).flatMap(value => value.actionPulseSiteIds.flat()));
  return { binding, presentInBaseline: a.conditionSignalIds.includes(binding.signalId),
    presentInIntervention: b.conditionSignalIds.includes(binding.signalId), terminalSiteCount: terminal.size,
    overlappingBasins: scan.basins.filter(basin => basin.coreSiteIds.some(site => binding.siteIds.includes(site)))
      .map(basin => ({ ...basin, bindingCoverage: basin.coreSiteIds.filter(site => binding.siteIds.includes(site)).length
        / basin.coreSiteIds.length })),
    sites: binding.siteIds.map(siteId => {
      const outgoing = state.medium.learnedBonds.filter(bond => bond.fromSiteId === siteId && bond.directedConductance > 0);
      return { siteId, outgoingCount: outgoing.length,
        terminalEdges: outgoing.filter(bond => terminal.has(bond.toSiteId)),
        actionEdges: outgoing.filter(bond => next.has(bond.toSiteId)), outgoing };
    }),
  };
});
const report = { pair, factor, factors, config: state.medium.config,
  differentialFootprints: state.medium.footprints.filter(value => value.traceId.startsWith('r2a-differential-'))
    .map(value => ({ traceId: value.traceId,
      factorOutgoing: value.bondReferences.filter(bond => factor.afferentSiteIds.includes(bond.fromSiteId)),
      terminalEligibilityEdges: value.bondReferences.filter(bond => factor.afferentSiteIds.includes(bond.fromSiteId)
        && b.terminalPulseSiteIds.includes(bond.toSiteId)) })), currentGameCalls: 0, physicalWrites: 0 };
await writeFile(outputPath, JSON.stringify(report), { flag: 'wx' });
console.log(JSON.stringify({ factors: factors.map(value => ({ signalId: value.binding.signalId,
  intervention: value.presentInIntervention,
  outgoingCounts: value.sites.map(site => site.outgoingCount),
  terminalCounts: value.sites.map(site => site.terminalEdges.length),
  actionCounts: value.sites.map(site => site.actionEdges.length),
  basins: value.overlappingBasins.map(basin => ({ size: basin.coreSiteIds.length, coverage: basin.bindingCoverage })) })),
  eligibilityConnections: report.differentialFootprints.reduce((sum, value) => sum + value.terminalEligibilityEdges.length, 0) }));
