import { DistributedR2APhysicalPatternLearnerV2 }
  from '../dist/src/core/learning/distributed-r2a-physical.js';
import { DistributedPhysicalMedium3DV1 }
  from '../dist/src/core/physics/distributed-physical-medium.js';
import { scanAnonymousPhysicalStructureV1 }
  from '../dist/src/core/physics/distributed-physical-structure-scanner.js';
import { sha } from '../dist/src/util.js';

const DEFAULT_SEED = 0x5232415048595332n;

function event(branch, repetition) {
  const eventId = `${branch}-${repetition}`;
  const q = branch === 'target' ? 'channel-q:value-1' : 'channel-q:value-0';
  const s = `channel-s:value-${repetition % 2}`;
  const terminal = branch === 'target' ? [40, 41, 42, 43] : [60, 61, 62, 63];
  const physicalPulseSiteIds = [[10, 11, 12, 13], [20, 21, 22, 23], terminal];
  return {
    version: 'DistributedR2ContinuousEventV1', eventId,
    atomIds: [`${eventId}:prefix`, `${eventId}:action`],
    sourceEventIds: [`${eventId}:source-prefix`, `${eventId}:source-action`],
    orderedExperienceIdentities: ['anonymous-prefix', 'anonymous-action'],
    orderedEpisodePatternIds: ['anonymous-prefix-pattern', 'anonymous-action-pattern'],
    dependencyIds: ['anonymous-process'], contextIds: [`context-${repetition % 4}`],
    completion: 'complete', boundaryReason: 'public-process-resolved', learningEligible: true,
    physicalFootprint: { version: 'DistributedTraceFootprintV1', traceId: `r2-${eventId}`,
      footprintId: `r2-${eventId}`, depositedAt: repetition,
      siteIds: [...new Set(physicalPulseSiteIds.flat())], pulseSiteIds: physicalPulseSiteIds,
      bondReferences: [
        { fromSiteId: 10, toSiteId: 20, kind: 'plastic-directed' },
        { fromSiteId: 20, toSiteId: terminal[0], kind: 'plastic-directed' },
      ], directedBondIds: [`10->20`, `20->${terminal[0]}`], pulseCount: 3, supportMass: 1 },
    processChanges: [{ subject: 'anonymous-result', property: 'opaque-state', before: false,
      after: branch === 'target', observationIndex: repetition * 10 + 4,
      meaning: 'observed-co-occurrence' }],
    terminalChanges: [{ subject: 'anonymous-result', property: 'opaque-state', before: false,
      after: branch === 'target', observationIndex: repetition * 10 + 4,
      meaning: 'observed-co-occurrence' }],
    beforePublicSignals: ['channel-common:value-1', q, s],
    beforeSignalTimeline: [['channel-common:value-1'], ['channel-common:value-1', q, s]],
    physicalPulseSiteIds,
    atomPulseRanges: [
      { atomId: `${eventId}:prefix`, startPulseIndex: 0, endPulseIndexExclusive: 1 },
      { atomId: `${eventId}:action`, startPulseIndex: 1, endPulseIndexExclusive: 3 },
    ], patternSha256: sha({ version: 'anonymous-audit-only', branch }),
  };
}

const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
for (let repetition = 0; repetition < 8; repetition += 1) {
  learner.observe(event('target', repetition));
  learner.observe(event('contrast', repetition));
}
const state = learner.snapshot();
const restingSnapshot = structuredClone(state.medium);
restingSnapshot.sites.forEach(site => { site.activation = 0; });
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(restingSnapshot);
const scan = scanAnonymousPhysicalStructureV1(restingSnapshot);
const patterns = state.patterns.map(pattern => ({
  patternId: pattern.patternId,
  members: pattern.memberR2EventIds,
  grade: pattern.grade,
  attractor: { coreSiteIds: pattern.attractor.coreSiteIds,
    dwellSteps: pattern.attractor.dwellSteps, escapeRate: pattern.attractor.escapeRate,
    evidenceLevel: pattern.attractor.evidenceLevel, ambiguous: pattern.attractor.ambiguous },
  prefix: pattern.corridor.orderedPrefixPulseSiteIds,
  action: pattern.corridor.actionPulseSiteIds.at(-1),
  forward: pattern.corridor.forwardPropagationRate,
  reverse: pattern.corridor.reverseRejectionRate,
}));
const aggregate = [];
for (const branch of learner.physicalBranches()) {
  const rows = [];
  const terminals = branch.attractor.coreSiteIds;
  const offset = BigInt((terminals[0] ?? 0) + 1) * 0x4252414e4348n;
  for (let index = 0; index < 8; index += 1) {
    const perturbed = terminals.filter((_siteId, position) => (position + index) % 4 !== 0);
    const readout = medium.probe(perturbed.length ? perturbed : terminals,
      DEFAULT_SEED ^ offset ^ BigInt(index + 1), 180);
    rows.push({ index, coreSiteIds: readout.coreSiteIds, dwellSteps: readout.dwellSteps,
      escapeRate: readout.escapeRate, evidenceLevel: readout.evidenceLevel,
      ambiguous: readout.ambiguous });
  }
  aggregate.push({ branchId: branch.branchId, coreSiteIds: terminals, rows });
}
const formation = [];
for (const pattern of state.patterns) {
  for (const signalId of ['channel-q:value-0', 'channel-q:value-1',
    'channel-s:value-0', 'channel-s:value-1']) {
    const binding = state.conditionBindings.find(value => value.signalId === signalId);
    if (!binding) continue;
    const prefix = pattern.corridor.orderedPrefixPulseSiteIds;
    const action = pattern.corridor.actionPulseSiteIds.at(-1) ?? [];
    const offset = BigInt((binding.siteIds[0] ?? 0) + 1) ^ 0x66756c6cn;
    const run = (condition, pulses) => Array.from({ length: 8 }, (_unused, index) => {
      const readout = condition.length
        ? medium.probeConditionedSequence(condition, pulses,
          DEFAULT_SEED ^ offset ^ BigInt(index + 1), 180)
        : medium.probeSequential(pulses,
        DEFAULT_SEED ^ offset ^ BigInt(index + 1), 180);
      const target = new Set(pattern.attractor.coreSiteIds);
      const membership = readout.coreSiteIds.length === 0 ? 0
        : readout.coreSiteIds.filter(siteId => target.has(siteId)).length / readout.coreSiteIds.length;
      const pass = readout.evidenceLevel !== 'none' && !readout.ambiguous
        && readout.dwellSteps >= 45 && readout.escapeRate <= .25 && membership >= .75;
      return { index, pass, membership, coreSiteIds: readout.coreSiteIds,
        dwellSteps: readout.dwellSteps, escapeRate: readout.escapeRate,
        evidenceLevel: readout.evidenceLevel, ambiguous: readout.ambiguous };
    });
    const full = run(binding.siteIds, [...prefix, action]);
    const ablated = run([], [...prefix, action]);
    formation.push({ patternId: pattern.patternId, member: pattern.memberR2EventIds[0], signalId,
      fullRate: full.filter(value => value.pass).length / 8,
      ablatedRate: ablated.filter(value => value.pass).length / 8, full, ablated });
  }
}
const summarizeRows = rows => ({
  pass: rows.filter(value => value.pass).length,
  ambiguous: rows.filter(value => value.ambiguous).length,
  none: rows.filter(value => value.evidenceLevel === 'none').length,
  lowDwell: rows.filter(value => value.dwellSteps < 45).length,
  highEscape: rows.filter(value => value.escapeRate > .25).length,
  lowMembership: rows.filter(value => value.membership !== undefined && value.membership < .75).length,
  coreCounts: rows.map(value => value.coreSiteIds.length),
});
console.log(JSON.stringify({ patterns, relationCount: state.relations.length,
  relations: state.relations.map(value => ({ patternId: value.patternId,
    factors: value.factors.flatMap(factor => factor.sourceSignalIds),
    full: value.meanFullFactorSelectionRate,
    stateContrastLoss: value.stateContrastSelectionLoss,
    loss: value.meanFactorAblationLoss })),
  scan: { basins: scan.basins.length, terminals: scan.terminalAttractors.length,
    corridors: scan.sharedPrefixCorridors.length,
    corridorDetails: scan.sharedPrefixCorridors.map(value => ({
      corridorId: value.corridorId,
      prefixCoreSiteIds: value.prefixCoreSiteIds,
      terminalAttractorIds: value.terminalAttractorIds,
      traversedBasinIds: value.traversedBasinIds,
    })) },
  physicalInputs: state.eventInputs
    .filter(value => value.eventId === 'target-0' || value.eventId === 'contrast-0')
    .map(value => ({ eventId: value.eventId,
      conditionSiteIds: value.conditionSiteIds,
      actionPulseSiteIds: value.actionPulseSiteIds,
      projectedPulseSiteIds: value.projectedPulseSiteIds,
      episodePulseSiteIds: value.episodePulseSiteIds })),
  conditionBindings: state.conditionBindings.map(value => ({
    signalId: value.signalId, siteIds: value.siteIds })),
  aggregate: aggregate.map(value => ({ branchId: value.branchId,
    coreSiteCount: value.coreSiteIds.length,
    rows: { ambiguous: value.rows.filter(row => row.ambiguous).length,
      none: value.rows.filter(row => row.evidenceLevel === 'none').length,
      dwell: value.rows.map(row => row.dwellSteps),
      escape: value.rows.map(row => row.escapeRate),
      coreCounts: value.rows.map(row => row.coreSiteIds.length) } })),
  formation: formation.map(value => ({ patternId: value.patternId, member: value.member,
    signalId: value.signalId, fullRate: value.fullRate, ablatedRate: value.ablatedRate,
    full: summarizeRows(value.full), ablated: summarizeRows(value.ablated) })) }, null, 2));
