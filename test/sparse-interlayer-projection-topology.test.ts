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

test('new connected population follows its measured frontier rather than numeric source order', () => {
  // Actual anonymous source topology of the newly captured terminal. Numeric
  // order visits several unanchored leaves before their connecting nodes.
  const source = [15569, 16561, 16593, 17553, 17584, 17585, 17616, 17617];
  const edges = [[15569,16593], [16561,16593], [16561,17585], [16593,17617],
    [17553,17585], [17584,17585], [17584,17616], [17585,17617], [17616,17617]];
  const neighborhoods = source.map(sourceSiteId => ({ sourceSiteId,
    neighborSiteIds: edges.flatMap(([a,b]) => a === sourceSiteId ? [b!]
      : b === sourceSiteId ? [a!] : []) }));
  const run = (ids: readonly number[]) => {
    const medium = new RecordingMedium(), project = projection(medium);
    const pulse = { pulseId: 'connected', offset: 0,
      drives: ids.map(siteId => ({ siteId, intensity: 1 })), sourceNeighborhoods: neighborhoods };
    project.projectPulse(pulse);
    assert.equal(medium.nearCalls.length, source.length - 1,
      'one connected source population must not create extra unanchored roots while its frontier remains');
    const original = project.snapshot().bindings.map(({ sourceSiteId, targetSiteIds }) => ({ sourceSiteId, targetSiteIds }));
    project.projectPulse(pulse);
    assert.equal(medium.allocateCalls.length, source.length, 'repeat input must not allocate or relocate old fibres');
    assert.deepEqual(project.snapshot().bindings.map(({ sourceSiteId, targetSiteIds }) => ({ sourceSiteId, targetSiteIds })), original);
    return original;
  };
  assert.deepEqual(run(source), run([...source].reverse()), 'input enumeration cannot change the measured topology');
});
