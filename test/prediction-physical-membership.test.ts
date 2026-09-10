import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 } from '../src/core/prediction/distributed-prediction-clone.js';

test('a similar activation profile cannot declare arrival at an unvisited population', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'membership' });
  for (let i = 0; i < 8; i++) {
    medium.applyEpisode({ version: 'DistributedEpisodeV1', traceId: `path${i}`,
      provenance: 'trusted-real-event', pulses: [[0, 1], [100, 101]].map((sites, j) => ({
        version: 'SparseFieldPulseV1', offset: j * .04,
        drives: sites.map(siteId => ({ siteId, intensity: 1 })) })) });
    medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: `independent${i}`, offset: 0,
      drives: [300, 301].map(siteId => ({ siteId, intensity: 1 })) });
  }
  const clone = new DistributedPredictionCloneV2(medium.snapshot());
  const request = { currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary' as const, actionSeedSiteIds: [0, 1], seed: 10n, steps: 180 };
  const actual = clone.run({ ...request, readoutAssemblies: [] });
  assert(actual.attractorReadout.coreSiteIds.every(site => site !== 300 && site !== 301));
  const result = clone.run({ ...request, readoutAssemblies: [{
    assemblyId: 'unvisited-but-similar-profile', siteIds: [300, 301],
    enclosingDomainSiteIds: [100, 101, 300, 301],
    referenceActivations: actual.attractorReadout.terminalActivations!
      .filter(value => [100, 101, 300, 301].includes(value.siteId)),
  }] });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.reaches, []);
});
