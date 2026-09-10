import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import type { DistributedEpisodeV1 } from '../src/core/physics/distributed-physical-contracts.js';
import { sha } from '../src/util.js';
import { SplitMix64 } from '../src/core/random.js';

/** Original ascending full-scan sampler, kept only as an equivalence oracle. */
function scanAllocation(bound: ReadonlySet<number>, random: SplitMix64): number[] {
  const unbound = Array.from({ length: 32 ** 3 }, (_, id) => id).filter(id => !bound.has(id));
  const seed = unbound[Math.floor(random.uniform() * unbound.length)]!;
  const queue = [seed], seen = new Set([seed]), result: number[] = [];
  for (let head = 0; head < queue.length && result.length < 32; head++) {
    const id = queue[head]!;
    if (!bound.has(id)) result.push(id);
    const x = id % 32, y = Math.floor(id / 32) % 32, z = Math.floor(id / 1024);
    const neighbors: number[] = [];
    if (x > 0) neighbors.push(id - 1);
    if (x < 31) neighbors.push(id + 1);
    if (y > 0) neighbors.push(id - 32);
    if (y < 31) neighbors.push(id + 32);
    if (z > 0) neighbors.push(id - 1024);
    if (z < 31) neighbors.push(id + 1024);
    for (let index = neighbors.length - 1; index > 0; index--) {
      const swap = Math.floor(random.uniform() * (index + 1));
      [neighbors[index], neighbors[swap]] = [neighbors[swap]!, neighbors[index]!];
    }
    for (const next of neighbors) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return result;
}

test('unbound rank index preserves ascending full-scan allocation and random state after restore', () => {
  let medium = new DistributedPhysicalMedium3DV1({ name: 'allocation-equivalence' });
  const bound = new Set<number>();
  for (let round = 0; round < 128; round++) {
    const expectedRandom = new SplitMix64(BigInt(round + 127));
    const actualRandom = new SplitMix64(BigInt(round + 127));
    const expected = scanAllocation(bound, expectedRandom);
    const actual = medium.allocateSites(32, actualRandom);
    assert.deepEqual(actual, expected);
    assert.equal(actualRandom.uniform(), expectedRandom.uniform());
    const winners = actual.slice(0, 8);
    medium.bindSites(`input-${round}`, winners);
    medium.bindSites(`input-${round}`, winners);
    for (const id of winners) bound.add(id);
    if (round === 63) medium = DistributedPhysicalMedium3DV1.fromSnapshot(medium.snapshot());
  }
});

/** Golden hashes are captured from the original full-sort implementation,
 * including nonuniform input, saturation, recovery, restore and V4 gain. */
export function populationOptimizationFixture(): string[] {
  let medium = new DistributedPhysicalMedium3DV1({ name: 'population-equivalence', seedHex: '912' });
  const hashes: string[] = [];
  for (let round = 0; round < 10; round++) {
    const event: DistributedEpisodeV1 = { version: 'DistributedEpisodeV1',
      traceId: `fixture-${round}`, provenance: 'trusted-real-event',
      pulses: [0, 1, 2].map(phase => ({ version: 'SparseFieldPulseV1',
        pulseId: `fixture-${round}-${phase}`, offset: phase * .2,
        drives: Array.from({ length: phase === 0 ? 64 : 120 }, (_, index) => ({
          siteId: phase * 512 + index + (round > 5 && phase === 2 ? 128 : 0),
          intensity: .25 + (index % 5) * .15,
        })) })),
    };
    medium.applyEpisodeWithEncodingGain(event, 1, round % 2 ? 1.25 : 1);
    if (round === 4) {
      medium.recover(.4);
      medium = DistributedPhysicalMedium3DV1.fromSnapshot(medium.snapshot());
    }
    hashes.push(sha(medium.snapshot()));
  }
  hashes.push(sha(medium.readonlyClone().probe([0, 1, 2, 3], 121n, 12)));
  return hashes;
}

test('population recruitment preserves full-sort physical states and random readout', () => {
  const actual = populationOptimizationFixture();
  assert.deepEqual(actual, GOLDEN);
});

const GOLDEN: readonly string[] = [
  '44aa5cbe1d0959c5a8f88928bd0244dd938a11fb629954adf4f6ec04f49e9afe',
  '94f6fc13f92f11688ad9b9dde6342d15e131ae53e9078d50d9869d91de7fefd1',
  '21863fe16fb9c7988d18b625ad1c5690c0632455c72c332681aeddecf5afa7a7',
  '8926d5ebc14c3f98acbe8e31b60ae93603ea7994647e2b5187c8f936fbebb07c',
  '611f5cb160fe711d6051c96659056cc1ff9a56844563cc8c9ad79172ec62014d',
  'a39993cd14427680640c11a3f9689f159079b6f90981ba20989e55789e2c5a26',
  'd6b6f11f26a9bad847f3a2d0ddc833a5156978f5467bfb6597298256bc2eda22',
  'f520d22427b736602e68dfd79c7e62359870b2cb2705b0880a30cc75276ccbf0',
  'f63e1126cf33001ed2cf73ede2d6d2ae4dc272a4fb3f15854c7f6f11fadba38f',
  '3bc2c34235bdf9a7b917957e136d43614ae231e61cf79d7002ba7718d2a04df8',
  'ad964af0844d3295c2bf83aaface8c2bfcd4e7e566900d98318e2f6bc8b2f6c3',
];
