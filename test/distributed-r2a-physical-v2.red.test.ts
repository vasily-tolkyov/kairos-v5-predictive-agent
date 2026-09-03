import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PublicChange } from '../src/contracts.js';
import * as r2aModule from '../src/core/learning/distributed-r2a.js';
import type { DistributedR2ContinuousEventV1 }
  from '../src/core/learning/distributed-r2-contracts.js';
import type { DistributedR2AInterventionAssessmentV2,
  DistributedR2APhysicalApplicabilityV2, DistributedR2APhysicalPatternV2,
  DistributedR2APhysicalRelationV2, DistributedR2APhysicalStateV3,
  DistributedR2ATransientFactorProjectionV2 }
  from '../src/core/learning/distributed-r2a-physical-contracts.js';
import { sha } from '../src/util.js';

const SRC = resolve('src');

async function source(relative: string): Promise<string> {
  return readFile(resolve(SRC, relative), 'utf8');
}

async function r2aProductionSource(): Promise<string> {
  const [surface, implementation] = await Promise.all([
    source('core/learning/distributed-r2a.ts'),
    source('core/learning/distributed-r2a-physical.ts'),
  ]);
  return `${surface}\n${implementation}`;
}

interface PhysicalLearnerV2 {
  observe(event: DistributedR2ContinuousEventV1): unknown;
  patterns(): readonly DistributedR2APhysicalPatternV2[];
  relations(): readonly DistributedR2APhysicalRelationV2[];
  recordMatchedIntervention(pair: unknown): DistributedR2AInterventionAssessmentV2;
  compareCurrentFactors(relationId: string,
    currentSignalIds: readonly string[]): DistributedR2APhysicalApplicabilityV2;
  projectTransientFactors(relationIds: readonly string[], currentSignalIds: readonly string[],
    expectedFactorIds?: readonly string[]): DistributedR2ATransientFactorProjectionV2;
  physicalBranches(): readonly AnonymousPhysicalBranchV2[];
  probePhysicalBranches(input: PhysicalBranchProbeInputV2): readonly PhysicalBranchProbeResultV2[];
  snapshot(): DistributedR2APhysicalStateV3;
}

interface AnonymousPhysicalBranchV2 {
  readonly branchId: string;
  readonly attractor: { readonly coreSiteIds: readonly number[] };
}

interface PhysicalBranchProbeInputV2 {
  readonly currentConditionSiteIds: readonly number[];
  readonly realPrefixPulseSiteIds: readonly (readonly number[])[];
  readonly actionSiteIds: readonly number[];
}

interface PhysicalBranchProbeResultV2 {
  readonly branchId: string;
  readonly selectionRate: number;
  readonly ambiguous: boolean;
}

interface PhysicalLearnerCtorV2 {
  new(r2Active: (eventId: string) => boolean): PhysicalLearnerV2;
  restore(state: DistributedR2APhysicalStateV3,
    r2Active: (eventId: string) => boolean): PhysicalLearnerV2;
}

function learnerConstructor(): PhysicalLearnerCtorV2 {
  const candidate = (r2aModule as Record<string, unknown>).DistributedR2APhysicalPatternLearnerV2;
  assert.equal(typeof candidate, 'function',
    'production has no DistributedR2APhysicalPatternLearnerV2 implementation');
  return candidate as unknown as PhysicalLearnerCtorV2;
}

test('a co-active distributed population cannot dilute a fully active local assembly', () => {
  const coverage = (r2aModule as Record<string, unknown>)
    .distributedObservedPopulationCoversLocalAssemblyV1;
  assert.equal(typeof coverage, 'function');
  const measure = coverage as (local: readonly number[], observed: readonly number[]) => number;
  const local = [1, 2, 3, 4];
  assert.equal(measure(local, [1, 2, 3, 4]), 1);
  assert.equal(measure(local, [1, 2, 3, 4, ...Array.from({ length: 60 }, (_, index) => index + 100)]), 1,
    'unrelated simultaneous assemblies diluted an intact local physical component');
  assert.equal(measure(local, [1, 2, 100, 101]), .5);
  assert.equal(measure(local, [100, 101, 102, 103]), 0);
});

function publicResultChange(branch: 'target' | 'contrast', sequence: number): PublicChange {
  return { subject: 'anonymous-result', property: 'opaque-state', before: false,
    after: branch === 'target', observationIndex: sequence, meaning: 'observed-co-occurrence' };
}

/**
 * A deliberately anonymous 2x2 design. q selects the physical terminal branch;
 * s is balanced within both q arms.  No semantic result label is needed to
 * distinguish the branches: their R2 populations and directed corridors differ.
 */
function event(branch: 'target' | 'contrast', repetition: number): DistributedR2ContinuousEventV1 {
  const eventId = `${branch}-${repetition}`;
  const q = branch === 'target' ? 'channel-q:value-1' : 'channel-q:value-0';
  const s = `channel-s:value-${repetition % 2}`;
  const terminal = branch === 'target' ? [40, 41, 42, 43] : [60, 61, 62, 63];
  const pulseSiteIds = [[10, 11, 12, 13], [20, 21, 22, 23], terminal];
  const footprintSiteIds = [...new Set(pulseSiteIds.flat())];
  return {
    version: 'DistributedR2ContinuousEventV1', eventId,
    atomIds: [`${eventId}:prefix`, `${eventId}:action`],
    sourceEventIds: [`${eventId}:source-prefix`, `${eventId}:source-action`],
    orderedExperienceIdentities: ['anonymous-prefix', 'anonymous-action'],
    orderedEpisodePatternIds: ['anonymous-prefix-pattern', 'anonymous-action-pattern'],
    dependencyIds: ['anonymous-process'], contextIds: [`context-${repetition % 4}`],
    completion: 'complete', boundaryReason: 'public-process-resolved', learningEligible: true,
    physicalFootprint: {
      version: 'DistributedTraceFootprintV1', traceId: `r2-${eventId}`,
      footprintId: `r2-${eventId}`, depositedAt: repetition,
      siteIds: footprintSiteIds, pulseSiteIds, bondReferences: [
        { fromSiteId: 10, toSiteId: 20, kind: 'plastic-directed' },
        { fromSiteId: 20, toSiteId: terminal[0]!, kind: 'plastic-directed' },
      ], directedBondIds: [`10->20`, `20->${terminal[0]}`], pulseCount: pulseSiteIds.length,
      supportMass: 1,
    },
    processChanges: [publicResultChange(branch, repetition * 10 + 4)],
    terminalChanges: [publicResultChange(branch, repetition * 10 + 4)],
    beforePublicSignals: ['channel-common:value-1', q, s],
    beforePublicSignalOccurrences: [
      { signalId: 'channel-common:value-1', pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 },
      { signalId: q, pulseOrdinal: 1, channelOrdinal: 1, receptorOrdinal: 0 },
      { signalId: s, pulseOrdinal: 1, channelOrdinal: 2, receptorOrdinal: 0 },
    ],
    beforeSignalTimeline: [
      ['channel-common:value-1'],
      ['channel-common:value-1', q, s],
    ],
    beforeSignalTimelineOccurrences: [
      [{ signalId: 'channel-common:value-1', pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 }],
      [
        { signalId: 'channel-common:value-1', pulseOrdinal: 1, channelOrdinal: 0, receptorOrdinal: 0 },
        { signalId: q, pulseOrdinal: 1, channelOrdinal: 1, receptorOrdinal: 0 },
        { signalId: s, pulseOrdinal: 1, channelOrdinal: 2, receptorOrdinal: 0 },
      ],
    ],
    physicalPulseSiteIds: pulseSiteIds,
    atomPulseRanges: [
      { atomId: `${eventId}:prefix`, startPulseIndex: 0, endPulseIndexExclusive: 1 },
      { atomId: `${eventId}:action`, startPulseIndex: 1, endPulseIndexExclusive: 3 },
    ],
    patternSha256: sha({ version: 'anonymous-audit-only', branch }),
  };
}

let predictiveState: DistributedR2APhysicalStateV3 | undefined;

function trainedPredictiveState(): DistributedR2APhysicalStateV3 {
  if (predictiveState) return structuredClone(predictiveState);
  const Ctor = learnerConstructor();
  const learner = new Ctor(() => true);
  for (let repetition = 0; repetition < 8; repetition++) {
    learner.observe(event('target', repetition));
    learner.observe(event('contrast', repetition));
  }
  predictiveState = learner.snapshot();
  return structuredClone(predictiveState);
}

function targetRelation(learner: PhysicalLearnerV2): DistributedR2APhysicalRelationV2 {
  const pattern = learner.patterns().find(value => value.memberR2EventIds.includes('target-0'));
  assert(pattern, 'physical target pattern was not discovered');
  const relation = learner.relations().find(value => value.patternId === pattern.patternId);
  assert(relation, 'physical target pattern has no condition relation');
  return relation;
}

function overlapFraction(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const target = new Set(right);
  return [...new Set(left)].filter(value => target.has(value)).length
    / Math.max(new Set(left).size, target.size);
}

function targetPhysicalQuery(state: DistributedR2APhysicalStateV3): {
  readonly expectedCoreSiteIds: readonly number[];
  readonly input: PhysicalBranchProbeInputV2;
} {
  const pattern = state.patterns.find(value => value.memberR2EventIds.includes('target-0'));
  const eventInput = state.eventInputs.find(value => value.eventId === 'target-0');
  assert(pattern && eventInput, 'trained physical fixture lacks target branch material');
  return { expectedCoreSiteIds: pattern.attractor.coreSiteIds,
    input: { currentConditionSiteIds: eventInput.conditionSiteIds,
      // The first atom is the actually observed prefix.  The remaining R2
      // pulses belong to the candidate action's not-yet-observed continuation.
      realPrefixPulseSiteIds: eventInput.projectedPulseSiteIds.slice(0, 1),
      actionSiteIds: eventInput.actionPulseSiteIds.at(-1) ?? eventInput.actionSiteIds } };
}

function matchingBranch(branches: readonly AnonymousPhysicalBranchV2[],
  expectedCoreSiteIds: readonly number[]): AnonymousPhysicalBranchV2 {
  const branch = [...branches].sort((left, right) =>
    overlapFraction(right.attractor.coreSiteIds, expectedCoreSiteIds)
    - overlapFraction(left.attractor.coreSiteIds, expectedCoreSiteIds))[0];
  assert(branch && overlapFraction(branch.attractor.coreSiteIds, expectedCoreSiteIds) >= .5,
    'no anonymous field branch matches the learned target attractor');
  return branch;
}

test('R2A V2 source projects every R2 site through P2A and never hashes a whole pulse', async () => {
  const text = await r2aProductionSource();
  assert.doesNotMatch(text,
    /R2(?:Population|Pulse)AssemblyInR2A|sha\s*\(\s*\{[^}]*physicalPulseSiteIds/,
    'a whole R2 population is still collapsed to an opaque identity before R2A');
  assert.match(text, /SparseInterlayerProjectionV1/,
    'R2A has no persistent sparse R2-site to R2A-site projection P2A');
  assert.match(text, /physicalPulseSiteIds[\s\S]{0,1000}(?:projectEpisode|projectPulse)/,
    'R2A does not project the real ordered R2 pulse stream site by site');
  assert.match(text, /bondReferences|sourceNeighborhoods/,
    'R2 physical neighbourhood evidence is not preserved at the projection boundary');
});

test('R2A V2 pattern discovery is physical, not action-family/Jaccard/set classification', async () => {
  const text = await r2aProductionSource();
  assert.doesNotMatch(text, /distributedOrderedCorridorSimilarityV1|\bjaccard\(|minimumSeparatingFactorSignalsV1|actionFamilyId/,
    'metadata similarity or a set classifier can still create/select production patterns');
  assert.match(text, /probeSequential|probe\(/,
    'pattern qualification never probes the learned physical field');
  assert.match(text, /dwellSteps[\s\S]{0,500}returnRate[\s\S]{0,500}escapeRate/,
    'attractor dwell, perturbation return, and escape do not jointly gate a pattern');
  assert.match(text, /forwardPropagationRate[\s\S]{0,500}reverseRejectionRate/,
    'forward corridor propagation and reverse-order rejection are not measured');
});

test('R2A V2 intervention contract accepts no caller success/drop and derives both from field probes', async () => {
  const [contracts, learner] = await Promise.all([
    source('core/learning/distributed-r2a-physical-contracts.ts'),
    r2aProductionSource(),
  ]);
  const pairStart = contracts.indexOf('interface DistributedR2AInterventionPairV2');
  const pairEnd = contracts.indexOf('\n}', pairStart);
  assert(pairStart >= 0 && pairEnd > pairStart, 'V2 intervention pair contract is missing');
  assert.doesNotMatch(contracts.slice(pairStart, pairEnd),
    /pairId|relationId|changedFactorId|success|selected|drop|rate|matchedPublicContext|onlyPlannedFactorChanged/i,
    'the intervention caller can still identify/grade a relation, factor, branch, or ablation result');
  assert.doesNotMatch(learner, /selectedExpectedBranch|deletionSelectionDrop/,
    'legacy caller-certified intervention fields remain in the production learner');
  assert.match(learner, /baselineR2EventId[\s\S]{0,2000}interventionR2EventId/,
    'the learner does not resolve both real intervention events');
  assert.match(learner, /factorAblationSelectionRate[\s\S]{0,1000}factorAblationLoss/,
    'the physical factor-removal run does not derive its selection loss');
});

test('the same real intervention pair has one field-derived identity regardless of caller labels', async () => {
  const learner = await r2aProductionSource();
  const start = learner.lastIndexOf('\n  recordMatchedIntervention(');
  const end = learner.indexOf('\n  compareCurrentFactors(', start);
  assert(start >= 0 && end > start, 'intervention implementation block is not auditable');
  const record = learner.slice(start, end);
  assert.doesNotMatch(record, /value\.(?:pairId|relationId|changedFactorId)/,
    'the caller can still select the intervention identity, relation, or factor');
  assert.match(record,
    /sha\s*\([\s\S]{0,500}baselineR2EventId[\s\S]{0,500}interventionR2EventId/,
    'canonical intervention identity is not derived from the real event pair');
  assert.match(record, /#interventions\.get\([^)]+\)[\s\S]{0,1000}#interventions\.set\(/,
    'canonical real-event pair identity is not used for idempotent intervention storage');
});

test('production memory consumes only R2A physical V2 results', async () => {
  const text = await source('distributed-hierarchical-memory.ts');
  assert.match(text, /DistributedR2APhysicalPatternLearnerV2/,
    'production memory still uses the metadata-oriented V1 learner');
  assert.doesNotMatch(text, /DistributedR2AStablePatternLearnerV1|DistributedR2APhysicalStateV1/,
    'the retired V1 R2A state is still reachable from production memory');
});

test('2x2 q/s evidence produces a q-conditioned physical branch and no productive s relation', () => {
  const Ctor = learnerConstructor();
  const learner = Ctor.restore(trainedPredictiveState(), () => true);
  const relations = learner.relations();
  assert(relations.length >= 2, 'the two physical terminal branches were not discovered');
  assert(relations.every(value => value.factors.every(factor =>
    factor.sourceSignalIds.every(signal => !signal.startsWith('channel-s:')))),
  'balanced pseudo-factor s obtained a production relation');
  assert(relations.some(value => value.factors.some(factor =>
    factor.sourceSignalIds.includes('channel-q:value-1'))),
  'the physically branch-selective q condition was not discovered');
  assert(relations.every(value => value.grade === 'predictive-stable'),
    'unintervened repeated evidence was incorrectly promoted above predictive-stable');
});

test('R2A pattern continuation starts from the members real pre-action R2 prefix, never a condition eligibility basin', () => {
  const state = trainedPredictiveState();
  const selectedPrefixes: number[][] = [];
  for (const pattern of state.patterns) {
    const members = state.eventInputs.filter(value => pattern.memberR2EventIds.includes(value.eventId));
    assert(members.length > 0, 'physical pattern has no retained member footprints');
    const actualPrefix = members[0]!.projectedPulseSiteIds[0] ?? [];
    const selectedPrefix = pattern.corridor.orderedPrefixPulseSiteIds.at(-1) ?? [];
    assert(overlapFraction(selectedPrefix, actualPrefix) >= .5,
      'R2A selected an incoming physical corridor that is not the real member pre-action R2 prefix');
    const conditionSites = [...new Set(members.flatMap(value => value.conditionSiteIds))];
    assert.equal(selectedPrefix.some(siteId => conditionSites.includes(siteId)), false,
      'R2A reused a condition/eligibility basin as the real R2 continuation prefix');
    selectedPrefixes.push([...selectedPrefix].sort((left, right) => left - right));
  }
  assert(selectedPrefixes.slice(1).every(value => JSON.stringify(value) === JSON.stringify(selectedPrefixes[0])),
    'branches with the same real pre-action history did not retain the same physical prefix');
});

test('R3-only q switch changes physical branch selection without writing R2A', () => {
  const Ctor = learnerConstructor();
  const learner = Ctor.restore(trainedPredictiveState(), () => true);
  const relation = targetRelation(learner);
  const before = sha(learner.snapshot());
  const on = learner.compareCurrentFactors(relation.relationId,
    ['channel-common:value-1', 'channel-q:value-1', 'channel-s:value-0']);
  const off = learner.compareCurrentFactors(relation.relationId,
    ['channel-common:value-1', 'channel-q:value-0', 'channel-s:value-0']);
  assert(on.physicalBranchSelectionRate >= .75,
    `q:on did not physically select its branch: ${on.physicalBranchSelectionRate}`);
  assert(on.physicalBranchSelectionRate - off.physicalBranchSelectionRate >= .25,
    'changing only transient R3 condition input did not change branch probability');
  assert.equal(sha(learner.snapshot()), before, 'R3 comparison wrote into persistent R2A state');
});

test('physical terminal signals project factors only through a selected R2A branch and remain read-only', () => {
  const Ctor = learnerConstructor();
  const state = trainedPredictiveState();
  const learner = Ctor.restore(state, () => true);
  const relation = targetRelation(learner);
  const factor = relation.factors.find(value => value.sourceSignalIds.includes('channel-q:value-1'));
  assert(factor, 'target relation has no physical q factor');
  const before = sha(learner.snapshot());
  const on = learner.projectTransientFactors([relation.relationId],
    ['channel-common:value-1', 'channel-q:value-1', 'channel-s:value-0'], [factor.factorId]);
  const off = learner.projectTransientFactors([relation.relationId],
    ['channel-common:value-1', 'channel-q:value-0', 'channel-s:value-0'], [factor.factorId]);
  assert(on.physicallySelectedRelationIds.includes(relation.relationId),
    'matching transient signals did not select the real physical branch');
  assert(on.knownActiveFactorIds.includes(factor.factorId),
    'decoder match was not confirmed through the R2A physical field');
  assert.equal(off.knownActiveFactorIds.includes(factor.factorId), false,
    'the opposite terminal signal borrowed the matching branch factor');
  assert(off.knownInactiveFactorIds.includes(factor.factorId)
    || off.unknownFactorIds.includes(factor.factorId),
  'the opposite terminal signal was not retained as inactive or unknown');
  assert.equal(sha(learner.snapshot()), before,
    'transient terminal-factor projection wrote into persistent R2A');

  const erased = structuredClone(state);
  (erased.medium.sites as unknown as Array<{
    potentialDepth: number; activation: number; supportMass: number;
  }>).forEach(site => { site.potentialDepth = 0; site.activation = 0; site.supportMass = 0; });
  (erased.medium as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const empty = Ctor.restore(erased, () => true);
  const afterErasure = empty.projectTransientFactors([relation.relationId],
    ['channel-common:value-1', 'channel-q:value-1'], [factor.factorId]);
  assert.deepEqual(afterErasure.knownActiveFactorIds, []);
  assert.deepEqual(afterErasure.knownInactiveFactorIds, []);
  assert(afterErasure.unknownFactorIds.includes(factor.factorId),
    'erasing the R2A field did not turn the projected factor back into unknown');
});

test('renaming/deleting audit event metadata preserves the physical branch output', () => {
  const Ctor = learnerConstructor();
  const originalState = trainedPredictiveState();
  const original = Ctor.restore(originalState, () => true);
  const relation = targetRelation(original);
  const input = ['channel-common:value-1', 'channel-q:value-1', 'channel-s:value-0'];
  const baseline = original.compareCurrentFactors(relation.relationId, input).physicalBranchSelectionRate;

  const renamed = structuredClone(originalState) as DistributedR2APhysicalStateV3 & {
    evidenceEvents: DistributedR2ContinuousEventV1[];
  };
  // Provenance is searchable metadata.  Learned physical populations and
  // channels stay byte-identical while the event index is made unavailable.
  (renamed as unknown as { evidenceEvents: DistributedR2ContinuousEventV1[] }).evidenceEvents = [];
  const restored = Ctor.restore(renamed, () => true);
  const after = restored.compareCurrentFactors(relation.relationId, input).physicalBranchSelectionRate;
  assert.equal(after, baseline,
    'deleting the raw searchable event index deleted a supposedly physical capability');
});

test('physical branches are rediscovered after every audit index is deleted', () => {
  const Ctor = learnerConstructor();
  assert.equal(typeof (Ctor.prototype as unknown as { physicalBranches?: unknown }).physicalBranches,
    'function', 'learner exposes no metadata-free physicalBranches scan');
  assert.equal(typeof (Ctor.prototype as unknown as { probePhysicalBranches?: unknown }).probePhysicalBranches,
    'function', 'learner exposes no physical-population branch probe');
  const state = trainedPredictiveState();
  const query = targetPhysicalQuery(state);
  const intact = Ctor.restore(state, () => true);
  assert.equal(typeof intact.physicalBranches, 'function',
    'learner exposes no metadata-free physicalBranches scan');
  assert.equal(typeof intact.probePhysicalBranches, 'function',
    'learner exposes no physical-population branch probe');
  const intactBranch = matchingBranch(intact.physicalBranches(), query.expectedCoreSiteIds);
  const intactProbe = intact.probePhysicalBranches(query.input)
    .find(value => value.branchId === intactBranch.branchId);
  assert(intactProbe && !intactProbe.ambiguous && intactProbe.selectionRate >= .75,
    'intact anonymous field branch is not physically selectable');

  const indexFree = structuredClone(state);
  (indexFree as unknown as { patterns: unknown[] }).patterns = [];
  (indexFree as unknown as { relations: unknown[] }).relations = [];
  (indexFree as unknown as { evidenceEvents: unknown[] }).evidenceEvents = [];
  (indexFree as unknown as { eventInputs: unknown[] }).eventInputs = [];
  const restored = Ctor.restore(indexFree, () => true);
  const rediscovered = matchingBranch(restored.physicalBranches(), query.expectedCoreSiteIds);
  const probe = restored.probePhysicalBranches(query.input)
    .find(value => value.branchId === rediscovered.branchId);
  assert(probe && !probe.ambiguous && probe.selectionRate === intactProbe.selectionRate,
    'deleting audit indexes changed a capability that should reside in the field');
});

test('cutting only directed channels preserves wells but removes conditional branch selection', () => {
  const Ctor = learnerConstructor();
  assert.equal(typeof (Ctor.prototype as unknown as { physicalBranches?: unknown }).physicalBranches,
    'function', 'learner exposes no metadata-free physicalBranches scan');
  assert.equal(typeof (Ctor.prototype as unknown as { probePhysicalBranches?: unknown }).probePhysicalBranches,
    'function', 'learner exposes no physical-population branch probe');
  const state = trainedPredictiveState();
  const query = targetPhysicalQuery(state);
  const intact = Ctor.restore(state, () => true);
  const intactBranch = matchingBranch(intact.physicalBranches(), query.expectedCoreSiteIds);
  const intactRate = intact.probePhysicalBranches(query.input)
    .find(value => value.branchId === intactBranch.branchId)?.selectionRate ?? 0;
  assert(intactRate >= .75, 'fixture has no intact conditional branch selection');

  const cut = structuredClone(state);
  (cut.medium.learnedBonds as unknown as Array<{ directedConductance: number }>).forEach(bond => {
    bond.directedConductance = 0;
  });
  const damaged = Ctor.restore(cut, () => true);
  // Cutting the non-equilibrium channels is allowed to change the dynamic
  // residence core, so an old core identity is not a valid lookup key after
  // the ablation.  The slow local wells themselves must remain byte-identical,
  // while no surviving anonymous branch may still be conditionally selected.
  assert.deepEqual(cut.medium.sites.map(site => ({ siteId: site.siteId,
    potentialDepth: site.potentialDepth, supportMass: site.supportMass })),
  state.medium.sites.map(site => ({ siteId: site.siteId,
    potentialDepth: site.potentialDepth, supportMass: site.supportMass })),
  'directed-channel ablation changed the local physical wells');
  const damagedResults = damaged.probePhysicalBranches(query.input);
  assert.equal(Math.max(0, ...damagedResults.map(value => value.selectionRate)), 0,
    'condition branch selection survived after every directed channel was cut');
});

test('clearing the physical R2A field removes branch capability while metadata remains', () => {
  const Ctor = learnerConstructor();
  const state = trainedPredictiveState();
  const intact = Ctor.restore(state, () => true);
  const relation = targetRelation(intact);
  const input = ['channel-common:value-1', 'channel-q:value-1', 'channel-s:value-0'];
  const intactRate = intact.compareCurrentFactors(relation.relationId, input).physicalBranchSelectionRate;
  assert(intactRate > 0, 'fixture has no intact physical branch selection');

  const damaged = structuredClone(state);
  (damaged.medium.sites as unknown as Array<{
    potentialDepth: number; activation: number; supportMass: number;
  }>).forEach(site => {
    site.potentialDepth = 0; site.activation = 0; site.supportMass = 0;
  });
  (damaged.medium as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const empty = Ctor.restore(damaged, () => true);
  assert.equal(empty.physicalBranches().length, 0,
    'field erasure left an anonymous physical branch capability');
  assert.throws(() => empty.compareCurrentFactors(relation.relationId, input),
    /unknown-distributed-R2A-relation/,
    'JSON pattern/relation metadata kept a queryable production relation after field erasure');
});

test('intervention identity, relation, factor and branch conclusions are derived inside the substrate', () => {
  const Ctor = learnerConstructor();
  const learner = Ctor.restore(trainedPredictiveState(), () => true);
  const relation = targetRelation(learner);
  const factor = relation.factors.find(value =>
    value.sourceSignalIds.includes('channel-q:value-1'));
  assert(factor, 'target relation has no physical q factor');
  const assessments: DistributedR2AInterventionAssessmentV2[] = [];
  for (let index = 0; index < 4; index++) {
    const pair = {
      version: 'DistributedR2AInterventionPairV2',
      baselineR2EventId: `contrast-${index}`, interventionR2EventId: `target-${index}`,
    };
    assessments.push(learner.recordMatchedIntervention(pair));
  }
  assert(assessments.every(value => value.otherObservedChannelsMatched
    && value.manipulatedFactorActuallyChanged && value.interventionReachedRelationBranch),
  'matched intervention facts were not derived from the referenced real events');
  assert(assessments.every(value => value.fullFactorSelectionRate >= .75
    && value.factorAblationLoss >= .25),
  'physical full-factor and factor-removed runs do not support the intervention');
  const upgraded = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(upgraded.grade, 'intervention-supported');
  assert(upgraded.meanFullFactorSelectionRate >= .75);
  assert(upgraded.meanFactorAblationLoss >= .25);

  const beforeDuplicate = learner.relations().find(value => value.relationId === relation.relationId)!;
  const firstAssessment = assessments[0]!;
  const renamedDuplicate = learner.recordMatchedIntervention({
    version: 'DistributedR2AInterventionPairV2',
    baselineR2EventId: 'contrast-0', interventionR2EventId: 'target-0',
  });
  const afterDuplicate = learner.relations().find(value => value.relationId === relation.relationId)!;
  assert.equal(renamedDuplicate.pairId, firstAssessment.pairId,
    'caller pairId changed the canonical identity of the same real event pair');
  assert.equal(afterDuplicate.matchedInterventionCount, beforeDuplicate.matchedInterventionCount,
    'the same real intervention pair was counted twice');

  assert.throws(() => learner.recordMatchedIntervention({
    version: 'DistributedR2AInterventionPairV2', pairId: 'caller-id-is-forbidden',
    baselineR2EventId: 'contrast-0', interventionR2EventId: 'target-0',
  }), /unknown|field|schema|intervention/i,
  'caller-supplied pair identity was silently accepted');

  const forged = { version: 'DistributedR2AInterventionPairV2',
    relationId: relation.relationId, changedFactorId: factor.factorId,
    baselineR2EventId: 'contrast-4', interventionR2EventId: 'target-4',
    selectedExpectedBranch: true, deletionSelectionDrop: 1 };
  assert.throws(() => learner.recordMatchedIntervention(forged),
    /unknown|field|schema|intervention/i,
  'caller-supplied relation/factor/branch/drop conclusions were silently accepted');

  assert.throws(() => learner.recordMatchedIntervention({
    version: 'DistributedR2AInterventionPairV2',
    baselineR2EventId: 'target-0', interventionR2EventId: 'target-1',
  }), /not-a-physical-matched-contrast/,
  'two events from one terminal branch were accepted as a matched intervention');
});
