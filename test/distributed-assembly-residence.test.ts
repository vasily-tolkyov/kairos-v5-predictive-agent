import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2, physicalResidenceMatchV1 }
  from '../src/core/prediction/distributed-prediction-clone.js';
import { sha } from '../src/util.js';

function cube(x: number, y: number, z: number, size = 2): number[] {
  return Array.from({ length: size }, (_x, dx) => dx).flatMap(dx =>
    Array.from({ length: size }, (_y, dy) => dy).flatMap(dy =>
      Array.from({ length: size }, (_z, dz) => dz).map(dz =>
        x + dx + (y + dy) * 32 + (z + dz) * 32 ** 2)));
}

function onePulse(traceId: string, sites: readonly number[]): DistributedEpisodeV1 {
  return { version: 'DistributedEpisodeV1', traceId, provenance: 'trusted-real-event',
    pulses: [{ version: 'SparseFieldPulseV1', offset: 0,
      drives: sites.map(siteId => ({ siteId, intensity: 1 })) }] };
}

function trainedNestedMedium(): { medium: DistributedPhysicalMedium3DV1;
  inner: readonly number[]; outer: readonly number[] } {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'nested-assembly-test' });
  // Self-organized afferent populations are distributed, not one solid
  // Minecraft-shaped cube.  Use separated local micro-assemblies so each
  // omitted member can be restored by its real six-neighbour coupling while
  // the inner and shell populations remain distinct physical modes.
  const origins = [2, 6, 10, 14, 18, 22, 26].flatMap(x =>
    [2, 6, 10, 14, 18, 22, 26].flatMap(y =>
      [2, 6, 10, 14, 18, 22, 26].map(z => [x, y, z] as const)));
  const inner = origins.slice(0, 64).flatMap(([x, y, z]) => cube(x, y, z));
  const shell = origins.slice(64, 128).flatMap(([x, y, z]) => cube(x, y, z));
  const outer = [...inner, ...shell].sort((left, right) => left - right);
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(onePulse(`inner-${repetition}`, inner));
    medium.applyEpisode(onePulse(`outer-${repetition}`, outer));
  }
  const snapshot = medium.snapshot();
  return { medium: DistributedPhysicalMedium3DV1.fromSnapshot({ ...snapshot,
    sites: snapshot.sites.map(site => ({ ...site, activation: 0 })) }), inner, outer };
}

test('nested terminal modes are separated by symmetric coverage and purity', () => {
  const { medium, inner, outer } = trainedNestedMedium();
  const before = sha(medium.snapshot());
  const innerReadout = medium.probe(inner, 0x1001n, 180);
  const outerReadout = medium.probe(outer, 0x1002n, 180);
  assert(innerReadout.coreSiteIds.length > 0 && outerReadout.coreSiteIds.length > 0);
  assert.equal(physicalResidenceMatchV1(innerReadout.coreSiteIds,
    innerReadout.coreSiteIds).score, 1);
  assert.equal(physicalResidenceMatchV1(outerReadout.coreSiteIds,
    outerReadout.coreSiteIds).score, 1);
  assert(physicalResidenceMatchV1(innerReadout.coreSiteIds,
    outerReadout.coreSiteIds).score < .75,
  'the enclosing dynamic core treated a strict subset as the same mode');
  assert(physicalResidenceMatchV1(outerReadout.coreSiteIds,
    innerReadout.coreSiteIds).score < .75,
  'the inner dynamic core ignored the actual shell residence');
  assert.equal(sha(medium.snapshot()), before, 'assembly measurement wrote into the medium');
});

test('readout masks, ids and order cannot change the production clone field trajectory', () => {
  const { medium, inner, outer } = trainedNestedMedium();
  const snapshot = medium.snapshot();
  const innerCore = medium.probe(inner, 0x2001n, 180).coreSiteIds;
  const outerCore = medium.probe(outer, 0x2002n, 180).coreSiteIds;
  const clone = new DistributedPredictionCloneV2(snapshot);
  const base = { currentPerceptionSeedSiteIds: inner,
    currentPerceptionMode: 'sequential-prefix' as const,
    realPrefixSeedSiteIds: [inner], actionSeedSiteIds: outer,
    seed: 0x2003n, steps: 180 };
  const none = clone.run({ ...base, readoutAssemblies: [] });
  const ordered = clone.run({ ...base, readoutAssemblies: [
    { assemblyId: 'anonymous-inner', siteIds: innerCore,
      enclosingDomainSiteIds: outer },
    { assemblyId: 'anonymous-outer', siteIds: outerCore,
      enclosingDomainSiteIds: outer },
  ] });
  const renamedAndReversed = clone.run({ ...base, readoutAssemblies: [
    { assemblyId: 'renamed-z', siteIds: outerCore,
      enclosingDomainSiteIds: outer },
    { assemblyId: 'renamed-a', siteIds: innerCore,
      enclosingDomainSiteIds: outer },
  ] });
  assert.deepEqual(ordered.fieldRun, none.fieldRun);
  assert.deepEqual(renamedAndReversed.fieldRun, none.fieldRun);
  assert.deepEqual(ordered.attractorReadout, none.attractorReadout);
  assert.deepEqual(renamedAndReversed.attractorReadout, none.attractorReadout);
});

test('candidate metadata cannot survive removal of its physical support', () => {
  const { medium, inner, outer } = trainedNestedMedium();
  const metadataOnly = structuredClone(medium.snapshot());
  for (const site of metadataOnly.sites as unknown as Array<{
    potentialDepth: number; supportMass: number; activation: number }>) {
    site.potentialDepth = 0; site.supportMass = 0; site.activation = 0;
  }
  (metadataOnly as unknown as { learnedBonds: unknown[] }).learnedBonds = [];
  const empty = DistributedPhysicalMedium3DV1.fromSnapshot(metadataOnly).probe(inner, 0x3000n, 180);
  assert.equal(empty.evidenceLevel, 'none');
  assert.equal(physicalResidenceMatchV1(empty.coreSiteIds, outer).score, 0);
});
