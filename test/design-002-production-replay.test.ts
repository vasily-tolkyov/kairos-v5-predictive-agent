import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { buildConsolidationReplayPlanV1, executeConsolidationReplayV1,
  DistributedMediumReplayWriterV1 } from '../src/core/learning/consolidation-replay.js';
import type { Observation, RealEvent } from '../src/contracts.js';

function event(id: string): RealEvent {
  const frames: Observation[] = [0, 1].map(index => ({
    sequence: index + 1, activeSeconds: index * .05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [], targetId: null, contextId: 'production-replay-fixture',
  }));
  return { version: 'RealEventV5', id,
    cue: { kind: 'wait', parameters: { ticks: 1 }, targetRole: null }, frames,
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'wait', parameters: { ticks: 1 } }, executed: true,
      status: 'completed', startSequence: 1, endSequence: 2 } };
}

test('V4 production replay refreshes existing R1 traces only while idle', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  memory.snapshotV4();
  memory.observe(event('replay-production-event'));
  const before = memory.snapshotV4();
  const receipt = memory.replayIfIdleV1({ goalActive: false, pendingAttention: false,
    novelty: 0, unknown: 0 }, 0x1234n, 1);
  assert(receipt);
  assert.equal(receipt.provenance, 'replay');
  assert(receipt.layers.r1);
  const trace = before.r1.records.find(value => value.eventId === 'replay-production-event')!;
  const after = memory.snapshotV4();
  const beforeSite = before.timescales.r1.medium.sites.find(site => site.siteId === trace.footprint.siteIds[0])!;
  const afterSite = after.timescales.r1.medium.sites.find(site => site.siteId === trace.footprint.siteIds[0])!;
  assert(afterSite.potentialDepth > beforeSite.potentialDepth * .995);
  assert.equal(afterSite.supportMass, beforeSite.supportMass);
  assert.deepEqual(after.r1.records, before.r1.records);
  assert.equal(after.timescales.r1.timescale.rehearsalCounts.length, 1);
  assert.equal(after.timescales.r1.timescale.rehearsalCounts[0]!.structureId,
    'trace:replay-production-event');
  assert.equal(memory.replayIfIdleV1({ goalActive: true, pendingAttention: false,
    novelty: 0, unknown: 0 }, 0x1234n), null);
});

test('replay is not reachable through the default V3 memory path', () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  assert.throws(() => memory.replayIfIdleV1({ goalActive: false, pendingAttention: false,
    novelty: 0, unknown: 0 }, 0x1n), /requires V4 timescale owner/);
});

test('production replay homeostasis preserves bond and evidence support', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'production-replay-bond', seedHex: 'b2' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'bond-trace', offset: 0,
    drives: [{ siteId: 0, intensity: .8 }, { siteId: 1, intensity: .7 }] });
  const before = medium.snapshot();
  const footprint = before.footprints[0]!;
  const bond = footprint.bondReferences[0]!;
  const beforeBond = before.learnedBonds.find(value => value.kind === bond.kind
    && value.fromSiteId === bond.fromSiteId && value.toSiteId === bond.toSiteId)!;
  const writer = new DistributedMediumReplayWriterV1(medium, () => undefined);
  executeConsolidationReplayV1(buildConsolidationReplayPlanV1(before, 'b2', 1), writer);
  const after = medium.snapshot();
  const afterBond = after.learnedBonds.find(value => value.kind === bond.kind
    && value.fromSiteId === bond.fromSiteId && value.toSiteId === bond.toSiteId)!;
  assert.equal(afterBond.supportMass, beforeBond.supportMass);
  assert(afterBond.symmetricCoupling > beforeBond.symmetricCoupling);
  assert.equal(after.footprints[0]!.supportMass, before.footprints[0]!.supportMass);
  assert(after.sites[0]!.potentialDepth < before.sites[0]!.potentialDepth + .01);
});
