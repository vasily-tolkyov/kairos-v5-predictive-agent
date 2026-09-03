import test from 'node:test';
import assert from 'node:assert/strict';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1, distributedMediumConfig }
  from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 }
  from '../src/core/prediction/distributed-prediction-clone.js';
import { sha } from '../src/util.js';

function trainedRoad(): { medium: DistributedPhysicalMedium3DV1;
  source: readonly number[]; middle: readonly number[]; terminal: readonly number[];
  unused: readonly number[] } {
  const medium = new DistributedPhysicalMedium3DV1(distributedMediumConfig('prediction', '51515151'));
  // The assemblies are anonymous and spatially separated.  This ensures the
  // directed temporal channel, not accidental six-neighbour proximity,
  // carries source activation to the terminal basin.
  const cube = (x: number, y: number, z: number): number[] => [0, 1].flatMap(dx =>
    [0, 1].flatMap(dy => [0, 1].map(dz => x + dx + (y + dy) * 32 + (z + dz) * 32 ** 2)));
  const source = cube(2, 2, 2), middle = cube(14, 14, 14), terminal = cube(28, 28, 28),
    unused = cube(20, 4, 20);
  medium.bindSites('opaque-source', source); medium.bindSites('opaque-middle', middle);
  medium.bindSites('opaque-terminal', terminal); medium.bindSites('opaque-unused', unused);
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const episode: DistributedEpisodeV1 = { version: 'DistributedEpisodeV1',
      traceId: `trusted-road-${repetition}`, provenance: 'trusted-real-event', pulses: [
        { version: 'SparseFieldPulseV1', pulseId: `source-${repetition}`, offset: 0,
          drives: source.map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', pulseId: `middle-${repetition}`, offset: .04,
          drives: middle.map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', pulseId: `terminal-${repetition}`, offset: .08,
          drives: terminal.map(siteId => ({ siteId, intensity: 1 })) },
      ] };
    medium.applyEpisode(episode);
  }
  medium.settle(0x100n, 500);
  return { medium, source, middle, terminal, unused };
}

function predictions(snapshot: DistributedMediumSnapshotV1, source: readonly number[],
  terminal: readonly number[]) {
  const clone = new DistributedPredictionCloneV2(snapshot);
  return clone.runMany({ currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary',
    realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    readoutAssemblies: [{ assemblyId: 'opaque-terminal', siteIds: terminal,
      minimumCoverage: .75, minimumPurity: .75 }],
    steps: 180, seeds: Array.from({ length: 24 }, (_, index) => BigInt(index + 1)) });
}

function reachedCount(results: ReturnType<typeof predictions>): number {
  return results.filter(value => value.status === 'reached'
    && value.reachedAssemblyIds[0] === 'opaque-terminal').length;
}

test('G5 PredictionClone runs 24 real field simulations read-only and reaches learned terminal support', () => {
  const { medium, source, terminal } = trainedRoad();
  const before = sha(medium.snapshot());
  const results = predictions(medium.snapshot(), source, terminal);
  const valid = results.filter(value => value.status !== 'unknown');
  assert.equal(results.length, 24);
  assert(valid.length >= 8, `only ${valid.length}/24 random fields reached any physical readout`);
  assert(reachedCount(results) / Math.max(1, valid.length) >= .75,
    'learned distributed road did not select its terminal attractor');
  assert(results.every(value => value.fieldRun.steps === 180));
  assert.equal(sha(medium.snapshot()), before,
    'read-only prediction changed the production distributed medium');
});

test('G5 off-road and metadata-only readouts remain unknown instead of copying a historical result', () => {
  const { medium, source, terminal, unused } = trainedRoad();
  const clone = new DistributedPredictionCloneV2(medium.snapshot());
  const offRoad = clone.run({ currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary',
    realPrefixSeedSiteIds: [source], actionSeedSiteIds: source, seed: 0x1n, steps: 180,
    readoutAssemblies: [{ assemblyId: 'unused', siteIds: unused }] });
  assert.equal(offRoad.status, 'unknown');
  assert.equal(offRoad.reason, 'trajectory-did-not-reach-readout-assembly');

  const metadata = structuredClone(medium.snapshot());
  for (const site of metadata.sites as unknown as Array<{
    potentialDepth: number; supportMass: number; activation: number }>) {
    site.potentialDepth = 0; site.supportMass = 0; site.activation = 0;
  }
  (metadata as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const fromIndexes = new DistributedPredictionCloneV2(metadata).run({
    currentPerceptionSeedSiteIds: source, realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary',
    seed: 0x2n, steps: 180, readoutAssemblies: [{ assemblyId: 'historical-terminal', siteIds: terminal }] });
  assert.equal(fromIndexes.status, 'unknown',
    'binding/footprint metadata reconstructed a result without physical field support');
});

test('G5 physically indistinguishable result assemblies are reported ambiguous', () => {
  const { medium, source, terminal } = trainedRoad();
  const qualifyingSeed = predictions(medium.snapshot(), source, terminal)
    .findIndex(value => value.status === 'reached') + 1;
  assert(qualifyingSeed > 0, 'fixture has no reached field trajectory');
  const result = new DistributedPredictionCloneV2(medium.snapshot()).run({
    currentPerceptionSeedSiteIds: source, realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary',
    seed: BigInt(qualifyingSeed), steps: 180, readoutAssemblies: [
      { assemblyId: 'outcome-a', siteIds: terminal },
      { assemblyId: 'outcome-b', siteIds: terminal },
    ] });
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.reachedAssemblyIds, ['outcome-a', 'outcome-b']);
});

test('G5 an intermediate learned assembly is not decoded as the terminal result', () => {
  const { medium, source, middle, terminal } = trainedRoad();
  const results = new DistributedPredictionCloneV2(medium.snapshot()).runMany({
    currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary',
    realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    readoutAssemblies: [
      { assemblyId: 'intermediate', siteIds: middle, minimumCoverage: .75,
        minimumPurity: .75 },
      { assemblyId: 'terminal', siteIds: terminal, minimumCoverage: .75,
        minimumPurity: .75 },
    ],
    steps: 180, seeds: Array.from({ length: 24 }, (_unused, index) => BigInt(index + 1)),
  });
  assert(results.every(value => !value.reachedAssemblyIds.includes('intermediate')),
    'a population visited before terminal settling was returned as a future result');
  assert(results.filter(value => value.status === 'reached'
    && value.reachedAssemblyIds[0] === 'terminal').length >= 8,
  'terminal-only decoding removed the learned continuation');
});

test('G5 shuffled channels, removed channels, flat potential, and center-only collapse damage prediction', () => {
  const { medium, source, middle, terminal, unused } = trainedRoad();
  const learned = medium.snapshot();
  const baseline = reachedCount(predictions(learned, source, terminal));
  assert(baseline >= 8, 'baseline does not qualify for ablation');

  const noConnections = structuredClone(learned);
  (noConnections as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const noConnectionCount = reachedCount(predictions(noConnections, source, terminal));
  assert(noConnectionCount <= baseline * .5,
    `removing channels did not materially damage prediction:${baseline}->${noConnectionCount}`);

  const shuffled = structuredClone(learned);
  const plastic = (shuffled.learnedBonds as unknown as Array<{
    kind: string; fromSiteId: number; toSiteId: number }>).filter(value => value.kind === 'plastic-directed');
  plastic.forEach((bond, index) => { bond.toSiteId = unused[index % unused.length]!; });
  const shuffledCount = reachedCount(predictions(shuffled, source, terminal));
  assert(shuffledCount <= baseline * .75,
    `shuffling learned topology preserved terminal prediction:${baseline}->${shuffledCount}`);

  const flat = structuredClone(learned);
  for (const site of flat.sites as unknown as Array<{ potentialDepth: number; supportMass: number }>) {
    site.potentialDepth = 0; site.supportMass = 0;
  }
  assert.equal(reachedCount(predictions(flat, source, terminal)), 0,
    'flat physical field retained a learned outcome');

  const centerOnly = structuredClone(learned);
  const retained = new Set([source[0]!, middle[0]!, terminal[0]!]);
  for (const site of centerOnly.sites as unknown as Array<{
    siteId: number; potentialDepth: number; supportMass: number; activation: number }>) {
    if (!retained.has(site.siteId)) { site.potentialDepth = 0; site.supportMass = 0; site.activation = 0; }
  }
  (centerOnly as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const centerCount = reachedCount(predictions(centerOnly, [source[0]!], [terminal[0]!]));
  assert(centerCount <= baseline * .5,
    `one-center degeneration substituted for distributed topology:${baseline}->${centerCount}`);
});
