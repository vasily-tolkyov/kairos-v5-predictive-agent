import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import type { DistributedEpisodeV1 } from '../src/core/physics/distributed-physical-contracts.js';
import type { Observation, RealEvent } from '../src/contracts.js';

function event(id: string, endSeconds: number): RealEvent {
  const frames: Observation[] = [0, 1].map(index => ({
    sequence: index + (endSeconds === .1 ? 0 : 2),
    activeSeconds: endSeconds - .05 + index * .05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [], targetId: null, contextId: 'encoding-gain-fixture',
  }));
  return { version: 'RealEventV5', id,
    cue: { kind: 'wait', parameters: { ticks: 1 }, targetRole: null }, frames,
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'wait', parameters: { ticks: 1 } }, executed: true,
      status: 'completed', startSequence: frames[0]!.sequence, endSequence: frames[1]!.sequence } };
}

function potentialDelta(before: ReturnType<DistributedHierarchicalPhysicalMemoryV1['snapshotV4']>,
  after: ReturnType<DistributedHierarchicalPhysicalMemoryV1['snapshotV4']>,
  siteIds: readonly number[]): number {
  const beforeSites = new Map(before.timescales.r1.medium.sites.map(site => [site.siteId, site.potentialDepth]));
  const afterSites = new Map(after.timescales.r1.medium.sites.map(site => [site.siteId, site.potentialDepth]));
  return siteIds.reduce((sum, siteId) => sum + (afterSites.get(siteId)! - beforeSites.get(siteId)!), 0);
}

test('V4 arousal increases plastic encoding while evidence still counts one event', () => {
  const baseline = new DistributedHierarchicalPhysicalMemoryV1();
  const aroused = new DistributedHierarchicalPhysicalMemoryV1();
  baseline.snapshotV4(); aroused.snapshotV4();
  const first = event('encoding-gain-first', .1);
  baseline.observe(first); aroused.observe(first);
  aroused.recordRuntimeMeasurement({ version: 'TrustedRuntimeMeasurementContextV1',
    eventId: first.id, observedAt: .2, goalResidualBefore: 1, goalResidualAfter: .1,
    predictionDeviation: { version: 'PredictionViolationMeasurementV1',
      source: 'attention-physical-comparison', expectedChangeCount: 1,
      missingExpectedChangeCount: 1, unexpectedChangeCount: 0, magnitude: .8 } });
  baseline.advanceTo(.2);
  const baselineBefore = baseline.snapshotV4();
  const arousedBefore = aroused.snapshotV4();
  const second = event('encoding-gain-second', .2);
  baseline.observe(second); aroused.observe(second);
  const baselineAfter = baseline.snapshotV4();
  const arousedAfter = aroused.snapshotV4();
  const baselineRecord = baselineAfter.r1.records.find(value => value.eventId === second.id)!;
  const arousedRecord = arousedAfter.r1.records.find(value => value.eventId === second.id)!;
  assert.deepEqual(arousedRecord.footprint.siteIds, baselineRecord.footprint.siteIds);
  assert.equal(arousedRecord.footprint.supportMass, 1);
  assert.equal(baselineRecord.footprint.supportMass, 1);
  const baselineDelta = potentialDelta(baselineBefore, baselineAfter, baselineRecord.footprint.siteIds);
  const arousedDelta = potentialDelta(arousedBefore, arousedAfter, arousedRecord.footprint.siteIds);
  assert(arousedDelta > baselineDelta, `expected aroused gain ${arousedDelta} > baseline ${baselineDelta}`);
  for (const siteId of baselineRecord.footprint.siteIds) {
    const before = baselineBefore.timescales.r1.medium.sites.find(site => site.siteId === siteId)!;
    const after = baselineAfter.timescales.r1.medium.sites.find(site => site.siteId === siteId)!;
    assert.equal(after.supportMass - before.supportMass, 1);
  }
});

test('gain-one V4 deposition is byte-equivalent to the legacy medium path', () => {
  const episode: DistributedEpisodeV1 = { version: 'DistributedEpisodeV1',
    traceId: 'encoding-gain-legacy-equivalence', provenance: 'trusted-real-event',
    pulses: [{ version: 'SparseFieldPulseV1', pulseId: 'encoding-gain-pulse', offset: 0,
      dwellSeconds: .04, drives: [{ siteId: 7, intensity: .8 }, { siteId: 8, intensity: .6 }] }] };
  const legacy = new DistributedPhysicalMedium3DV1({ name: 'gain-equivalence', seedHex: 'e1' });
  const v4 = new DistributedPhysicalMedium3DV1({ name: 'gain-equivalence', seedHex: 'e1' });
  legacy.applyEpisode(episode, 1);
  v4.applyEpisodeWithEncodingGain(episode, 1, 1);
  assert.deepEqual(v4.snapshot(), legacy.snapshot());
});
