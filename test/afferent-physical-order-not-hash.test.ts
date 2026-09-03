import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import type { DistributedMediumWritePortV1, R1DistributedEpisodeV1,
  R1DistributedTraceFootprintV1 } from '../src/core/learning/distributed-r1-contracts.js';
import type { DistributedR2ContinuousEventV1 }
  from '../src/core/learning/distributed-r2-contracts.js';
import { distributedPublicSignalOccurrencesV1 }
  from '../src/core/learning/distributed-r2.js';
import { SelfOrganizingAfferentProjectionV1 }
  from '../src/core/learning/self-organizing-afferent.js';
import { DistributedR2APhysicalPatternLearnerV2 }
  from '../src/core/learning/distributed-r2a.js';
import { sha } from '../src/util.js';

class AllocationOrderMedium implements DistributedMediumWritePortV1 {
  readonly bindings = new Map<string, readonly number[]>();
  #next = 0;

  allocateSites(count: number): readonly number[] {
    const result = Array.from({ length: count }, (_unused, index) => this.#next + index);
    this.#next += count;
    return result;
  }
  allocateSitesNear(_anchors: readonly number[], count: number): readonly number[] {
    return this.allocateSites(count);
  }
  competeForSites(candidates: readonly number[], count: number): readonly number[] {
    return candidates.slice(0, count);
  }
  bindSites(bindingId: string, siteIds: readonly number[]): void {
    assert.equal(this.bindings.has(bindingId), false);
    this.bindings.set(bindingId, [...siteIds]);
  }
  applyEpisode(episode: R1DistributedEpisodeV1): R1DistributedTraceFootprintV1 {
    const siteIds = [...new Set(episode.pulses.flatMap(pulse => pulse.drives.map(value => value.siteId)))];
    return { version: 'DistributedTraceFootprintV1', traceId: `trace-${episode.eventId}`,
      footprintId: `trace-${episode.eventId}`, depositedAt: 0, siteIds,
      directedBondIds: [], bondReferences: [], pulseCount: episode.pulses.length, supportMass: 1 };
  }
  isFootprintActive(): boolean { return true; }
  snapshot(): unknown { return { bindings: [...this.bindings] }; }
}

function frame(sequence: number, state: string): Observation {
  return { sequence, activeSeconds: sequence * .05, contextId: 'sensor-order', targetId: 'target',
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { onGround: true } },
    objects: [{ id: 'target', type: 'opaque', relativePosition: [0, 0, -1],
      properties: { state } }] };
}

function realEvent(id: string, before: string): RealEvent {
  const action = { kind: 'interact' as const, targetId: 'target', parameters: {} };
  return { version: 'RealEventV5', id,
    cue: { kind: 'interact', parameters: {}, targetRole: 'opaque' },
    frames: [frame(1, before), frame(2, 'terminal')], trackedIds: ['self', 'target'],
    bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 2 },
    provenance: 'executed-real-body', complete: true };
}

function exactCueSites(projection: SelfOrganizingAfferentProjectionV1): readonly number[] {
  const value = projection.snapshot().bindings.find(binding =>
    binding.descriptor?.source === 'cue' && binding.descriptor.channel === 'exact-cue');
  assert(value);
  return value.siteIds;
}

test('R1 new-afferent allocation follows pulse/channel ordinals rather than the signal hash', () => {
  // These two categorical values deliberately hash on opposite sides of the
  // exact-cue identity.  The retired signalId sort therefore moved the cue to
  // a different allocation slot even though the physical sensor order was
  // identical.
  const lowMedium = new AllocationOrderMedium(), highMedium = new AllocationOrderMedium();
  const low = new SelfOrganizingAfferentProjectionV1(0x1234n);
  const high = new SelfOrganizingAfferentProjectionV1(0x1234n);
  low.projectEvent(realEvent('low', 'opaque-475'), lowMedium);
  high.projectEvent(realEvent('high', 'opaque-236'), highMedium);
  assert.deepEqual(exactCueSites(low), exactCueSites(high));
  const lowState = low.snapshot().bindings.find(binding =>
    binding.descriptor?.channel === 'value/opaque#0/state'
      && binding.descriptor.categoricalValue === JSON.stringify('opaque-475'));
  const highState = high.snapshot().bindings.find(binding =>
    binding.descriptor?.channel === 'value/opaque#0/state'
      && binding.descriptor.categoricalValue === JSON.stringify('opaque-236'));
  assert(lowState && highState);
  assert.deepEqual(lowState.siteIds, highState.siteIds,
    'renaming a categorical value changed the physical allocation slot');
});

test('public receptor ordinals are stable under caller object insertion order and are not hash order', () => {
  // Raw sensor/000 precedes sensor/001, while their channel hashes have the
  // opposite lexical order.  This makes the regression observable.
  const left = distributedPublicSignalOccurrencesV1({ 'sensor/001': 2, 'sensor/000': 1 });
  const right = distributedPublicSignalOccurrencesV1({ 'sensor/000': 1, 'sensor/001': 2 });
  assert.deepEqual(left, right);
  assert.deepEqual(left.map(value => [value.channelOrdinal, value.receptorOrdinal]), [[0, 0], [1, 0]]);
  assert.notDeepEqual(left.map(value => value.signalId),
    [...left].sort((a, b) => a.signalId.localeCompare(b.signalId, 'en')).map(value => value.signalId),
  'fixture accidentally has the same sensor and identity-hash order');
});

function footprint(id: string): NonNullable<DistributedR2ContinuousEventV1['physicalFootprint']> {
  return { version: 'DistributedTraceFootprintV1', traceId: id, footprintId: id,
    depositedAt: 0, siteIds: [10, 11, 20, 21, 30, 31],
    pulseSiteIds: [[10, 11], [20, 21], [30, 31]],
    directedBondIds: ['10>20', '20>30'], bondReferences: [
      { fromSiteId: 10, toSiteId: 20, kind: 'plastic-directed' },
      { fromSiteId: 20, toSiteId: 30, kind: 'plastic-directed' },
    ], pulseCount: 3, supportMass: 1 };
}

function r2Event(id: string, ordinalZeroSignal: string,
  ordinalOneSignal: string, callerOrder: readonly string[]): DistributedR2ContinuousEventV1 {
  const occurrences = [
    { signalId: ordinalZeroSignal, pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 },
    { signalId: ordinalOneSignal, pulseOrdinal: 0, channelOrdinal: 1, receptorOrdinal: 0 },
  ];
  return { version: 'DistributedR2ContinuousEventV1', eventId: id,
    atomIds: [`${id}-a`, `${id}-b`], sourceEventIds: [`${id}-sa`, `${id}-sb`],
    orderedExperienceIdentities: ['action-a', 'action-b'],
    orderedEpisodePatternIds: ['pattern-a', 'pattern-b'], dependencyIds: ['dependency'],
    contextIds: ['context'], completion: 'complete', boundaryReason: 'public-process-resolved',
    learningEligible: true, physicalFootprint: footprint(`r2-${id}`), processChanges: [],
    terminalChanges: [], beforePublicSignals: [...callerOrder],
    beforeSignalTimeline: [[...callerOrder]], beforePublicSignalOccurrences: occurrences,
    beforeSignalTimelineOccurrences: [occurrences], physicalPulseSiteIds: [[10, 11], [20, 21], [30, 31]],
    atomPulseRanges: [
      { atomId: `${id}-a`, startPulseIndex: 0, endPulseIndexExclusive: 1 },
      { atomId: `${id}-b`, startPulseIndex: 1, endPulseIndexExclusive: 3 },
    ], patternSha256: sha({ pattern: 'same' }) };
}

function mediumBinding(learner: DistributedR2APhysicalPatternLearnerV2,
  signal: string): readonly number[] {
  const binding = learner.rawPhysicalMediumSnapshotForAudit().bindings.find(value =>
    value.bindingId === `r2a:condition:${signal}`);
  assert(binding);
  return binding.siteIds;
}

test('R2A condition allocation uses explicit public sensor ordinals, not identity or caller array order', () => {
  const first = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const renamedAndPermuted = new DistributedR2APhysicalPatternLearnerV2(() => true);
  first.observe(r2Event('first', 'opaque-a', 'opaque-z', ['opaque-z', 'opaque-a']));
  renamedAndPermuted.observe(r2Event('second', 'opaque-z', 'opaque-a', ['opaque-a', 'opaque-z']));
  assert.deepEqual(mediumBinding(first, 'opaque-a'), mediumBinding(renamedAndPermuted, 'opaque-z'));
  assert.deepEqual(mediumBinding(first, 'opaque-z'), mediumBinding(renamedAndPermuted, 'opaque-a'));
});
