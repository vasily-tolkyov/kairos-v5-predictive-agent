import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { encodeDistributedSnapshotForWorkersV1, decodeDistributedSnapshotInWorkerV1 }
  from '../src/core/physics/distributed-snapshot-transfer.js';
import { DistributedPredictionCloneV2 } from '../src/core/prediction/distributed-prediction-clone.js';

test('one substrate encoding preserves all values and gives each seed worker private mutable storage', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'transfer' });
  medium.applyEpisode({version:'DistributedEpisodeV1',traceId:'t',provenance:'trusted-real-event',
    pulses:[[0,1],[1024,1025]].map((sites,index)=>({version:'SparseFieldPulseV1',offset:index*.04,
      drives:sites.map(siteId=>({siteId,intensity:1}))}))});
  const before=medium.snapshot(), bytes=encodeDistributedSnapshotForWorkersV1(before);
  const left=decodeDistributedSnapshotInWorkerV1(bytes), right=decodeDistributedSnapshotInWorkerV1(bytes);
  assert.deepEqual(left,before); assert.deepEqual(right,before); assert.notStrictEqual(left,right);
  const request={currentPerceptionSeedSiteIds:[0,1],currentPerceptionMode:'held-boundary' as const,
    realPrefixSeedSiteIds:[[0,1]],actionSeedSiteIds:[0,1],steps:24,seeds:[2n,9n],
    readoutAssemblies:[{assemblyId:'a',siteIds:[1024,1025]}]};
  const owned=new DistributedPredictionCloneV2(left,[],undefined,'transferred');
  assert.deepEqual(owned.runMany(request),new DistributedPredictionCloneV2(right).runMany(request));
  // Caller-owned constructor still isolates later caller mutations.
  const copied=new DistributedPredictionCloneV2(right), expected=copied.snapshot();
  (right.sites[0] as {potentialDepth:number}).potentialDepth=999;
  assert.deepEqual(copied.snapshot(),expected); assert.deepEqual(owned.snapshot(),expected);
  assert.deepEqual(decodeDistributedSnapshotInWorkerV1(bytes),before);
  assert.deepEqual(medium.snapshot(),before);
});
