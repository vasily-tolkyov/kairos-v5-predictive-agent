import assert from 'node:assert/strict';
import test from 'node:test';
import { sha } from '../src/util.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { runTemporalFidelityProbeCaseV1,
  allocateProportionalPrefixTicksV1 } from '../src/evaluation/temporal-fidelity-probe-v1.js';

function episode(id: string, target: readonly number[]) {
  return { version: 'DistributedEpisodeV1' as const, traceId: id,
    provenance: 'trusted-real-event' as const,
    pulses: [{ version: 'SparseFieldPulseV1' as const, offset: 0,
      drives: [0, 1].map(siteId => ({ siteId, intensity: 1 })) },
    { version: 'SparseFieldPulseV1' as const, offset: .04,
      drives: target.map(siteId => ({ siteId, intensity: 1 })) }] };
}

test('DESIGN-006 allocates proportional prefix ticks deterministically', () => {
  assert.deepEqual(allocateProportionalPrefixTicksV1([1, 2, 5], 8), [1, 2, 5]);
  assert.deepEqual(allocateProportionalPrefixTicksV1([1, 2, 5], 8),
    allocateProportionalPrefixTicksV1([1, 2, 5], 8));
  assert.throws(() => allocateProportionalPrefixTicksV1([1, 2], 1), /must cover/);
});

test('DESIGN-006 replay comparison is read-only and reproducible', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'design-006-test' });
  for (let index = 0; index < 8; index += 1) medium.applyEpisode(episode(`event-${index}`, [100, 101]));
  const before = sha(medium.snapshot());
  const request = { currentPerceptionSeedSiteIds: [0, 1],
    currentPerceptionMode: 'held-boundary' as const,
    realPrefixSeedSiteIds: [[0, 1]], actionSeedSiteIds: [0, 1], steps: 16,
    readoutAssemblies: [{ assemblyId: 'result', siteIds: [100, 101],
      minimumCoverage: .75, minimumPurity: .75 }] };
  const input = { caseId: 'fixture-1', request, prefixDwell: [1], seeds: [1n, 2n, 3n] };
  const one = runTemporalFidelityProbeCaseV1(medium.snapshot(), input);
  const two = runTemporalFidelityProbeCaseV1(medium.snapshot(), input);
  assert.deepEqual(one, two);
  assert.equal(sha(medium.snapshot()), before);
});
