import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ActionCue, PublicChange, RealEventContinuityEvidenceV1 } from '../src/contracts.js';
import { DistributedR2ContinuityStoreV1 } from '../src/core/learning/distributed-r2.js';
import type { DistributedR2AtomV1, DistributedR2ContinuousEventV1 }
  from '../src/core/learning/distributed-r2-contracts.js';
import type { DistributedTraceFootprintV1 } from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 }
  from '../src/core/prediction/distributed-prediction-clone.js';
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

const CUE: ActionCue = { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };

function footprint(traceId: string, siteIds: readonly number[], directedBondIds: readonly string[] = []):
DistributedTraceFootprintV1 {
  return {
    version: 'DistributedTraceFootprintV1', traceId, footprintId: traceId, depositedAt: 0,
    siteIds: [...siteIds], pulseSiteIds: [[...siteIds]], bondReferences: [],
    directedBondIds: [...directedBondIds], pulseCount: 1, supportMass: 1,
  };
}

function continuity(index: number): RealEventContinuityEvidenceV1 {
  return {
    dependencyId: 'anonymous-process', basis: 'public-state-carried-forward',
    subject: 'anonymous-subject', property: 'anonymous-state',
    beforeObservationSequence: index * 10, afterObservationSequence: index * 10 + 1,
    beforeValueSha256: sha(index), afterValueSha256: sha(index + 1),
    factCategory: 'public-state-transition',
  };
}

function atom(run: number, index: number, topology: readonly (readonly number[])[],
  directedBondIds: readonly string[] = []): DistributedR2AtomV1 {
  const change: PublicChange = {
    subject: 'anonymous-subject', property: 'anonymous-state', before: index, after: index + 1,
    observationIndex: run * 100 + index, meaning: 'observed-co-occurrence',
  };
  const flatSites = [...new Set(topology.flat())];
  return {
    version: 'DistributedR2AtomV1', atomId: `atom-${run}-${index}`,
    sourceEventId: `source-${run}-${index}`, exactExperienceIdentity: `anonymous-action-${index}`,
    episodePatternSha256: sha({ topology, directedBondIds }),
    r1Topology: {
      version: 'DistributedEpisodeTopologyV1',
      pulses: topology.map(pulse => pulse.map(siteId => ({ siteId, intensity: 1 }))),
      terminalSiteIds: [...topology.at(-1)!],
    },
    r1Footprint: footprint(`r1-${run}-${index}`, flatSites, directedBondIds), cue: CUE,
    contextId: `anonymous-context-${run}`, startedAt: run * 10 + index,
    endedAt: run * 10 + index + .5, startFrameSequence: run * 100 + index * 10,
    endFrameSequence: run * 100 + index * 10 + 5, sessionId: 'anonymous-session',
    continuityEpochId: 'anonymous-epoch', dependencies: [continuity(run * 10 + index)],
    publicChanges: [change], beforePublicSignals: [`anonymous:${index}`],
    afterPublicSignals: [`anonymous:${index + 1}`],
    beforePublicSignalOccurrences: [{ signalId: `anonymous:${index}`, pulseOrdinal: 0,
      channelOrdinal: 0, receptorOrdinal: 0 }],
    afterPublicSignalOccurrences: [{ signalId: `anonymous:${index + 1}`, pulseOrdinal: 0,
      channelOrdinal: 0, receptorOrdinal: 0 }],
  };
}

function commit(store: DistributedR2ContinuityStoreV1, run: number,
  secondTopology: readonly (readonly number[])[]): DistributedR2ContinuousEventV1 {
  store.ingest(atom(run, 0, [[2, 3, 4], [5, 6, 7]]), 'continuous');
  store.ingest(atom(run, 1, secondTopology), 'continuous');
  const receipt = store.close('public-process-resolved');
  assert.equal(receipt.status, 'committed');
  return receipt.event;
}

function overlapCount(left: readonly number[], right: readonly number[]): number {
  const rightSet = new Set(right);
  return [...new Set(left)].filter(siteId => rightSet.has(siteId)).length;
}

test('anti-approximation R2 source contains no whole-population SHA token', async () => {
  const text = await source('core/learning/distributed-r2.ts');
  assert.equal(/R1PopulationAssemblyInR2|R1PopulationTransitionInR2/.test(text), false,
    'R2 still hashes a complete R1 population/transition into one opaque token');
});

test('anti-approximation R2 changes one source site locally instead of replacing its whole assembly', () => {
  const store = new DistributedR2ContinuityStoreV1();
  const baseline = commit(store, 0, [[20, 21, 22, 23]]);
  const oneSiteChanged = commit(store, 1, [[20, 21, 22, 99]]);
  assert.deepEqual(baseline.physicalPulseSiteIds[0], oneSiteChanged.physicalPulseSiteIds[0],
    'an unchanged R1 atom did not preserve its R2 population');
  const left = baseline.physicalPulseSiteIds.at(-1)!, right = oneSiteChanged.physicalPulseSiteIds.at(-1)!;
  const overlap = overlapCount(left, right);
  assert(overlap > 0 && overlap < Math.min(left.length, right.length),
    `one changed source site replaced the complete R2 assembly: overlap=${overlap}, left=${left.length}, right=${right.length}`);
});

test('anti-approximation R2A source contains no whole-R2-pulse SHA token', async () => {
  const text = await r2aProductionSource();
  assert.equal(/R2(?:Population|Pulse)AssemblyInR2A/.test(text), false,
    'R2A still hashes a complete R2 population into one opaque token');
  assert.equal(/SparseInterlayerProjectionV1[\s\S]{0,8000}(?:projectPulse|projectEpisode)/.test(text), true,
    'R2A has no auditable per-source-site projection');
  assert.equal(/bondReferences[\s\S]{0,1000}sourceNeighborhoods/.test(text), true,
    'R2A has no auditable per-source-bond projection');
});

test('anti-approximation R2A stable-pattern qualification uses a physical attractor/corridor readout', async () => {
  const [learner, memory] = await Promise.all([
    r2aProductionSource(),
    source('distributed-hierarchical-memory.ts'),
  ]);
  const qualificationStart = memory.indexOf('#activePatternQualification');
  const qualificationEnd = memory.indexOf('#activeRelationGrade', qualificationStart);
  assert(qualificationStart >= 0 && qualificationEnd > qualificationStart,
    'active pattern qualification block is not auditable');
  const qualification = memory.slice(qualificationStart, qualificationEnd);
  assert.equal(/medium\.probe\(|DistributedAttractorReadout|dwellSteps|returnRate|escapeRate/
    .test(`${learner}\n${qualification}`), true,
    'Jaccard/corridor annotations can upgrade a pattern without a physical attractor readout');
});

test('anti-approximation intervention evidence cannot carry scorer-selected success or deletion drop', async () => {
  const [contracts, learner, memory] = await Promise.all([
    source('core/learning/distributed-r2a-physical-contracts.ts'),
    r2aProductionSource(),
    source('distributed-hierarchical-memory.ts'),
  ]);
  const production = `${contracts}\n${learner}\n${memory}`;
  assert.equal(/selectedExpectedBranch|deletionSelectionDrop/.test(production), false,
    'an external scorer can still certify an intervention or its physical ablation');
  assert.equal(/baselineR2EventId[\s\S]{0,1200}interventionR2EventId/.test(learner), true,
    'intervention qualification does not compare its real baseline/intervention events');
  assert.equal(/ablat|withoutFactor|removeFactor|physical.*drop|probe\(/i.test(learner), true,
    'intervention qualification has no physical factor-removal computation');
});

test('anti-approximation PredictionClone request names perception, real-prefix, and action seed populations', async () => {
  const text = await source('core/prediction/distributed-prediction-clone.ts');
  for (const field of [
    'currentPerceptionSeedSiteIds', 'realPrefixSeedSiteIds', 'actionSeedSiteIds',
  ]) assert.equal(new RegExp(`readonly\\s+${field}\\s*:`).test(text), true,
    `clone request is missing ${field}`);
  assert.match(text,
    /probeConditionedSequence\(currentPerception[\s\S]{0,120}sequentialInputs[\s\S]{0,120}request\.seed[\s\S]{0,100}steps\)/,
    'clone does not hold current perception while running one ordered physical rollout');
  assert.match(text,
    /sequentialInputs\s*=\s*\[[\s\S]{0,100}realPrefix[\s\S]{0,100}action\]/,
    'clone does not inject the real prefix and candidate action in order');
  assert.doesNotMatch(text,
    /sequentialInputs\s*=\s*\[currentPerception/,
    'current perception is still treated as a decaying historical pulse');
});

for (const missing of [
  'currentPerceptionSeedSiteIds', 'realPrefixSeedSiteIds', 'actionSeedSiteIds',
] as const) {
  test(`anti-approximation PredictionClone returns unknown when ${missing} is absent`, () => {
    const clone = new DistributedPredictionCloneV2(
      new DistributedPhysicalMedium3DV1({ name: 'prediction', seedHex: 'a11ce' }).snapshot());
    const request: Record<string, unknown> = {
      currentPerceptionSeedSiteIds: [1], realPrefixSeedSiteIds: [[2]], actionSeedSiteIds: [3],
      readoutAssemblies: [{ assemblyId: 'anonymous-outcome', siteIds: [4] }], seed: 1n, steps: 1,
    };
    delete request[missing];
    const observed: { result?: { status: string; reason: string } } = {};
    assert.doesNotThrow(() => {
      observed.result = clone.run(request as never) as { status: string; reason: string };
    }, `missing ${missing} caused a protocol exception instead of physical unknown`);
    assert.equal(observed.result?.status, 'unknown');
    assert.match(observed.result?.reason ?? '', new RegExp(`missing.*${missing}`, 'i'));
  });
}

test('anti-approximation stable R1 qualification requires a physical attractor readout', async () => {
  const [memory, r1] = await Promise.all([
    source('distributed-hierarchical-memory.ts'),
    source('core/learning/distributed-r1.ts'),
  ]);
  const start = memory.indexOf('#stableR1');
  const end = memory.indexOf('#r2Event', start);
  assert(start >= 0 && end > start, 'stable R1 qualification block is not auditable');
  const qualification = `${memory.slice(start, end)}\n${r1}`;
  assert.match(qualification, /attractorQualification\(/,
    'production memory does not delegate R1 stability to the physical learner');
  assert.equal(/medium\.probe\(|DistributedAttractorReadout|dwellSteps|returnRate|escapeRate/
    .test(qualification), true,
    'annotation peer count and episode Jaccard can qualify R1 without an attractor readout');
});

test('anti-approximation JSON pattern/relation indexes cannot bypass physical field support', async () => {
  const [learner, memory] = await Promise.all([
    r2aProductionSource(),
    source('distributed-hierarchical-memory.ts'),
  ]);
  const compareStart = learner.indexOf('compareCurrentFactors(');
  const compareEnd = learner.indexOf('\n  /**', compareStart);
  assert(compareStart >= 0 && compareEnd > compareStart, 'factor comparison block is not auditable');
  assert.equal(/medium\.isFootprintActive/.test(learner.slice(compareStart, compareEnd)), true,
    'relation metadata can report current applicability after its R2A field trace disappears');

  const qualifyStart = memory.indexOf('#activePatternQualification');
  const qualifyEnd = memory.indexOf('#activeRelationGrade', qualifyStart);
  const qualification = memory.slice(qualifyStart, qualifyEnd);
  assert.equal(/isFootprintActive/.test(qualification), true,
    'pattern metadata can remain qualified after its physical footprint disappears');
  assert.equal(/medium\.probe\(|DistributedAttractorReadout|dwellSteps|returnRate|escapeRate/
    .test(qualification), true,
    'active footprint metadata is mistaken for a qualified attractor/corridor readout');
});
