import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import type { DistributedEpisodeV1 }
  from '../src/core/physics/distributed-physical-contracts.js';

function episode(traceId: string, withEligibility: boolean): DistributedEpisodeV1 {
  const pulse = (offset: number, base: number) => ({
    version: 'SparseFieldPulseV1' as const, offset,
    drives: Array.from({ length: 8 }, (_unused, index) => ({
      siteId: base + index, intensity: 1,
    })),
  });
  return {
    version: 'DistributedEpisodeV1', traceId, provenance: 'trusted-real-event',
    pulses: [pulse(0, 0), pulse(.04, 100), pulse(.08, 200)],
    temporalEligibility: withEligibility
      ? [{ fromPulseIndex: 0, toPulseIndex: 2, strength: 1 }]
      : undefined,
  };
}

function sourceToTerminal(medium: DistributedPhysicalMedium3DV1): number {
  return medium.snapshot().learnedBonds
    .filter(bond => bond.kind === 'plastic-directed'
      && bond.fromSiteId >= 0 && bond.fromSiteId < 8
      && bond.toSiteId >= 200 && bond.toSiteId < 208)
    .reduce((sum, bond) => sum + bond.directedConductance, 0);
}

test('a real temporal eligibility trace forms a sparse long-range physical fibre', () => {
  const adjacentOnly = new DistributedPhysicalMedium3DV1({ name: 'adjacent-only' });
  const eligible = new DistributedPhysicalMedium3DV1({ name: 'eligible' });
  adjacentOnly.applyEpisode(episode('adjacent-1', false));
  eligible.applyEpisode(episode('eligible-1', true));
  assert.equal(sourceToTerminal(adjacentOnly), 0);
  const first = sourceToTerminal(eligible);
  assert(first > 0, 'the real delayed population left no long-range fibre');
  for (let index = 2; index <= 8; index += 1)
    eligible.applyEpisode(episode(`eligible-${index}`, true));
  assert(sourceToTerminal(eligible) > first,
    'repeated real eligibility did not strengthen the same physical fibre');
  assert(eligible.snapshot().learnedBonds
    .filter(bond => bond.kind === 'plastic-directed' && bond.fromSiteId < 8)
    .every((_bond, _index, all) => all.length <= 8 * 8),
  'eligibility bypassed the fixed per-site long-range capacity');
});

test('invalid or super-unit eligibility cannot write the medium', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'invalid-eligibility' });
  const invalid = { ...episode('invalid', true),
    temporalEligibility: [{ fromPulseIndex: 2, toPulseIndex: 0, strength: 1 }] };
  assert.throws(() => medium.applyEpisode(invalid), /eligibility indexes/);
  const excessive = { ...episode('excessive', true),
    temporalEligibility: [{ fromPulseIndex: 0, toPulseIndex: 2, strength: 1.01 }] };
  assert.throws(() => medium.applyEpisode(excessive), /cannot exceed one/);
  assert.equal(medium.snapshot().footprints.length, 0);
});
