import { performance } from 'node:perf_hooks';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../dist/src/core/prediction/distributed-prediction-clone.js';
import { runDistributedPredictionCloneBatchParallelV1 }
  from '../dist/src/core/prediction/distributed-prediction-clone-parallel.js';

// Performance-only fixture.  It deliberately uses the production substrate
// and public Clone API and does not alter any physical parameter or threshold.
function cube(x, y, z) {
  return [0, 1].flatMap(dx => [0, 1].flatMap(dy =>
    [0, 1].map(dz => x + dx + (y + dy) * 32 + (z + dz) * 32 ** 2)));
}

function trainedRoad() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'prediction', seedHex: '51515151' });
  const source = cube(2, 2, 2);
  const middle = cube(14, 14, 14);
  const terminal = cube(28, 28, 28);
  medium.bindSites('opaque-source', source);
  medium.bindSites('opaque-middle', middle);
  medium.bindSites('opaque-terminal', terminal);
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode({
      version: 'DistributedEpisodeV1', traceId: `trusted-road-${repetition}`,
      provenance: 'trusted-real-event', pulses: [
        { version: 'SparseFieldPulseV1', pulseId: `source-${repetition}`, offset: 0,
          drives: source.map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', pulseId: `middle-${repetition}`, offset: .04,
          drives: middle.map(siteId => ({ siteId, intensity: 1 })) },
        { version: 'SparseFieldPulseV1', pulseId: `terminal-${repetition}`, offset: .08,
          drives: terminal.map(siteId => ({ siteId, intensity: 1 })) },
      ],
    });
  }
  return { medium, source, terminal };
}

const fixtureStarted = performance.now();
const { medium, source, terminal } = trainedRoad();
const fixtureMs = performance.now() - fixtureStarted;
const snapshotStarted = performance.now();
const snapshot = medium.snapshot();
const snapshotMs = performance.now() - snapshotStarted;
const cloneStarted = performance.now();
const clone = new DistributedPredictionCloneV2(snapshot);
const cloneMs = performance.now() - cloneStarted;
const seeds = Array.from({ length: Number(process.argv[2] ?? 1) }, (_, index) => BigInt(index + 1));
const parallelism = Number(process.argv[3] ?? 1);
const request = { currentPerceptionSeedSiteIds: source,
  realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
  readoutAssemblies: [{ assemblyId: 'opaque-terminal', siteIds: terminal,
    minimumReachedFraction: .25 }], steps: 180, seeds };
const runStarted = performance.now();
const results = parallelism === 1 ? clone.runMany(request)
  : await runDistributedPredictionCloneBatchParallelV1(snapshot, request, parallelism);
const runMs = performance.now() - runStarted;
const proposals = results.reduce((sum, result) =>
  sum + result.fieldRun.acceptedSteps + result.fieldRun.rejectedSteps, 0);
console.log(JSON.stringify({ seeds: seeds.length, parallelism, fixtureMs, snapshotMs, cloneMs, runMs,
  millisecondsPerSeed: runMs / seeds.length, proposals,
  proposalsPerSeed: proposals / seeds.length,
  proposalsPerSecond: proposals / (runMs / 1000),
  finalActivationCounts: results.map(result => result.fieldRun.finalActivations.length),
  statuses: results.map(result => result.status) }, null, 2));
