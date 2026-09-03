import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../src/core/prediction/distributed-prediction-clone.js';

function trainedMedium(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'weighted-clone-downstream' });
  medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId: 'weighted-road',
    provenance: 'trusted-real-event', pulses: [
      { version: 'SparseFieldPulseV1', offset: 0,
        drives: [{ siteId: 0, intensity: 1 }] },
      { version: 'SparseFieldPulseV1', offset: .04,
        drives: [{ siteId: 10, intensity: 1 }] },
    ] });
  return medium;
}

function request(weighted: boolean) {
  return {
    currentPerceptionSeedSiteIds: [0],
    ...(weighted ? { currentPerceptionSeedDrives: [{ siteId: 0, intensity: .2 }] } : {}),
    currentPerceptionMode: 'held-boundary' as const,
    realPrefixSeedSiteIds: [[0]],
    ...(weighted ? { realPrefixSeedDrives: [[{ siteId: 0, intensity: .2 }]] } : {}),
    actionSeedSiteIds: [10],
    ...(weighted ? { actionSeedDrives: [{ siteId: 10, intensity: .2 }] } : {}),
    readoutAssemblies: [{ assemblyId: 'terminal', siteIds: [10] }],
    seed: 7n,
    steps: 32,
  };
}

test('weighted Clone inputs affect the physical rollout instead of becoming unit seeds', () => {
  const snapshot = trainedMedium().snapshot();
  const unit = new DistributedPredictionCloneV2(snapshot).run(request(false));
  const weighted = new DistributedPredictionCloneV2(snapshot).run(request(true));
  assert.notDeepEqual(weighted.fieldRun, unit.fieldRun);
  const unitAtZero = unit.fieldRun.finalActivations.find(value => value.siteId === 0)?.activation ?? 0;
  const weightedAtZero = weighted.fieldRun.finalActivations.find(value => value.siteId === 0)?.activation ?? 0;
  assert(weightedAtZero < unitAtZero, 'weighted amplitude was flattened before simulation');
});

test('runMany forwards all weighted seed populations to each Clone run', () => {
  const snapshot = trainedMedium().snapshot();
  const clone = new DistributedPredictionCloneV2(snapshot);
  const one = clone.run(request(true));
  const many = clone.runMany({ ...request(true), seeds: [7n] });
  assert.deepEqual(many, [one]);
});

test('R2 source neighbourhoods exclude directed temporal bonds', async () => {
  const source = await readFile(new URL('../../src/core/learning/distributed-r2.ts', import.meta.url), 'utf8');
  const start = source.indexOf('#sourceNeighborhoods(');
  const end = source.indexOf('\n  #physicalEpisode(', start);
  assert(start >= 0 && end > start);
  assert.match(source.slice(start, end), /reference\.kind\s*!==\s*['"]local['"]\)\s*continue/);
});
