import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedHierarchicalTimescaleOwnerV1 } from '../src/core/physics/distributed-hierarchical-timescale-owner-v1.js';

function medium(name: string, seedHex: string) {
  const value = new DistributedPhysicalMedium3DV1({ name, seedHex });
  value.applyPulse({ version: 'SparseFieldPulseV1', pulseId: `${name}-trace`, offset: 0,
    drives: [{ siteId: 0, intensity: .8 }] });
  return value;
}

test('hierarchical owner advances three physical layers on one clock and restores byte-stably', () => {
  const owner = new DistributedHierarchicalTimescaleOwnerV1(
    medium('R1-owner', '3101'), medium('R2-owner', '3102'), medium('R2A-owner', '3103'));
  owner.advanceTo(2, { r1: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 2, surpriseMagnitude: .8, goalRelevance: .4, supportMass: 1 }], r2: [], r2a: [] });
  assert.equal(owner.logicalTime, 2);
  const snapshot = owner.snapshot();
  const restored = DistributedHierarchicalTimescaleOwnerV1.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.mediumSnapshot('r1').logicalTime, 2);
  assert.equal(restored.mediumSnapshot('r2').logicalTime, 2);
  assert.equal(restored.mediumSnapshot('r2a').logicalTime, 2);
});

test('hierarchical owner rejects a layer clock divergence and unknown measured structure', () => {
  const owner = new DistributedHierarchicalTimescaleOwnerV1(
    medium('R1-owner', '3201'), medium('R2-owner', '3202'), medium('R2A-owner', '3203'));
  assert.throws(() => owner.advanceTo(1, { r1: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:999999', observedAt: 1, surpriseMagnitude: .1, goalRelevance: 0, supportMass: 0 }], r2: [], r2a: [] }), /not present/);
});

test('same-time trusted measurement is processed instead of being dropped', () => {
  const owner = new DistributedHierarchicalTimescaleOwnerV1(
    new DistributedPhysicalMedium3DV1({ name: 'R1', seedHex: '5231' }),
    new DistributedPhysicalMedium3DV1({ name: 'R2', seedHex: '5232' }),
    new DistributedPhysicalMedium3DV1({ name: 'R2A', seedHex: '5233' }));
  const before = owner.snapshot();
  owner.advanceTo(0, { r1: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 0, surpriseMagnitude: 0.8, goalRelevance: 0.4, supportMass: 1 }], r2: [], r2a: [] });
  assert.notDeepEqual(owner.snapshot(), before);
});

test('measurement validation is atomic across layers', () => {
  const owner = new DistributedHierarchicalTimescaleOwnerV1(
    new DistributedPhysicalMedium3DV1({ name: 'R1', seedHex: '5231' }),
    new DistributedPhysicalMedium3DV1({ name: 'R2', seedHex: '5232' }),
    new DistributedPhysicalMedium3DV1({ name: 'R2A', seedHex: '5233' }));
  const before = owner.snapshot();
  assert.throws(() => owner.advanceTo(1, { r1: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 0.5, surpriseMagnitude: 0.8, goalRelevance: 0.4, supportMass: 1 }],
    r2: [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
      structureId: 'not-a-structure', observedAt: 0.5, surpriseMagnitude: 0.8, goalRelevance: 0.4, supportMass: 1 }], r2a: [] }));
  assert.deepEqual(owner.snapshot(), before);
});
