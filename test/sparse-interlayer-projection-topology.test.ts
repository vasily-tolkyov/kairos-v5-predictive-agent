import test from 'node:test';
import assert from 'node:assert/strict';
import type { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { SparseInterlayerProjectionV1 } from '../src/core/learning/sparse-interlayer-projection.js';

/**
 * A tiny recording medium is enough here: the projection is responsible for
 * deciding whether an allocation is anchored, while the medium owns the
 * target-lattice geometry.  Keeping the fixture opaque prevents the test from
 * smuggling source coordinates across the layer boundary.
 */
class RecordingMedium {
  nextSiteId = 1000;
  readonly allocateCalls: number[] = [];
  readonly nearCalls: number[][] = [];
  readonly bindings = new Map<string, readonly number[]>();

  allocateSites(count: number, _random: () => number): readonly number[] {
    this.allocateCalls.push(count);
    const result = Array.from({ length: count }, () => this.nextSiteId++);
    return result;
  }

  allocateSitesNear(anchorSiteIds: readonly number[], count: number,
    _random: () => number): readonly number[] {
    this.nearCalls.push([...anchorSiteIds]);
    return this.allocateSites(count, _random);
  }

  competeForSites(candidateSiteIds: readonly number[], winnerCount: number,
    _random: () => number): readonly number[] {
    return candidateSiteIds.slice(0, winnerCount);
  }

  bindSites(bindingId: string, siteIds: readonly number[]): void {
    assert.equal(this.bindings.has(bindingId), false);
    this.bindings.set(bindingId, [...siteIds]);
  }
}

function projection(medium: RecordingMedium): SparseInterlayerProjectionV1 {
  return new SparseInterlayerProjectionV1(
    medium as unknown as DistributedPhysicalMedium3DV1,
    { projectionId: 'topology-test', seed: 0x51n, candidateCount: 8, winnerCount: 2 },
  );
}

test('non-adjacent coactivation does not infer a target neighbourhood', () => {
  const medium = new RecordingMedium();
  const project = projection(medium);

  // The two source identities are deliberately far apart in the source
  // lattice.  No source-neighbour evidence is supplied, so coactivation alone
  // must not make the second allocation local to the first target fibre.
  project.projectPulse({ pulseId: 'coactive', offset: 0, drives: [
    { siteId: 1, intensity: 1 },
    { siteId: 999, intensity: 1 },
  ] });

  assert.equal(medium.nearCalls.length, 0,
    'simultaneous source drives must not become implicit neighbourhood anchors');
  assert.equal(medium.allocateCalls.length, 2,
    'each unbound source needs an independent target allocation');
  const bindings = [...medium.bindings.values()];
  assert.equal(bindings.length, 2);
  const secondTargets = new Set(bindings[1]!);
  assert.equal(bindings[0]!.some(siteId => secondTargets.has(siteId)), false,
    'unrelated coactive sources must receive disjoint target fibres');
});

test('explicit source-lattice adjacency still permits anchored allocation', () => {
  const medium = new RecordingMedium();
  const project = projection(medium);
  project.projectPulse({ pulseId: 'first', offset: 0,
    drives: [{ siteId: 1, intensity: 1 }] });
  const firstBinding = project.snapshot().bindings.find(value => value.sourceSiteId === 1);
  assert(firstBinding);

  project.projectPulse({ pulseId: 'neighbor', offset: 1,
    drives: [{ siteId: 999, intensity: 1 }],
    sourceNeighborhoods: [{ sourceSiteId: 999, neighborSiteIds: [1] }],
  });

  assert.deepEqual(medium.nearCalls, [firstBinding.targetSiteIds],
    'only explicit source-lattice adjacency may provide target anchors');
});
