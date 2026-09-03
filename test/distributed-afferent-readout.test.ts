import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, PublicValue, RealEvent } from '../src/contracts.js';
import type {
  DistributedMediumWritePortV1,
  R1DistributedEpisodeV1,
  R1DistributedTraceFootprintV1,
  SelfOrganizingAfferentStateV1,
} from '../src/core/learning/distributed-r1-contracts.js';
import { SelfOrganizingAfferentProjectionV1 }
  from '../src/core/learning/self-organizing-afferent.js';
import { eventRows } from '../src/events.js';
import { sha } from '../src/util.js';

class FixtureMedium implements DistributedMediumWritePortV1 {
  readonly #bindings = new Map<string, number[]>();

  allocateSites(count: number, random: () => number): readonly number[] {
    const used = new Set([...this.#bindings.values()].flat());
    const available = Array.from({ length: 32 ** 3 }, (_unused, siteId) => siteId)
      .filter(siteId => !used.has(siteId));
    const result: number[] = [];
    while (result.length < count) {
      const index = Math.min(available.length - 1, Math.floor(random() * available.length));
      result.push(available.splice(index, 1)[0]!);
    }
    return result;
  }

  allocateSitesNear(_anchorSiteIds: readonly number[], count: number,
    random: () => number): readonly number[] {
    return this.allocateSites(count, random);
  }

  competeForSites(candidateSiteIds: readonly number[], winnerCount: number,
    random: () => number): readonly number[] {
    return candidateSiteIds.map(siteId => ({ siteId, score: random() }))
      .sort((left, right) => right.score - left.score || left.siteId - right.siteId)
      .slice(0, winnerCount).map(value => value.siteId);
  }

  bindSites(bindingId: string, siteIds: readonly number[]): void {
    assert.equal(this.#bindings.has(bindingId), false);
    this.#bindings.set(bindingId, [...siteIds]);
  }

  applyEpisode(_episode: R1DistributedEpisodeV1): R1DistributedTraceFootprintV1 {
    throw new Error('not-used-by-afferent-readout-test');
  }

  isFootprintActive(): boolean { return true; }

  snapshot(): unknown { return [...this.#bindings]; }
}

interface FrameState {
  readonly active: boolean;
  readonly yaw: number;
}

function frame(sequence: number, activeSeconds: number, state: FrameState,
  instanceId: string): Observation {
  return { sequence, activeSeconds, contextId: 'readout-layout', targetId: instanceId,
    self: { position: [0, 64, 0], yaw: state.yaw, pitch: 0,
      properties: { onGround: true } },
    objects: [{ id: instanceId, type: 'opaque', relativePosition: [1, 0, -2],
      properties: { active: state.active } }] };
}

function event(id: string, before: FrameState, after: FrameState): RealEvent {
  const instanceId = `${id}-instance`;
  const frames = [frame(1, 0, before, instanceId), frame(2, .1, after, instanceId),
    frame(3, .2, after, instanceId)];
  const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
  return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
    trackedIds: ['self', instanceId], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 1, endSequence: 3 } };
}

function channelByProperty(readout: ReturnType<SelfOrganizingAfferentProjectionV1['readPublicState']>,
  property: string) {
  const matches = readout.channels.filter(channel => channel.property === property);
  assert.equal(matches.length, 1, `expected exactly one ${property} channel`);
  return matches[0]!;
}

test('terminal physical populations decode opposite categorical PublicValue states', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(0xa11n);
  const rising = projection.projectEvent(event('rising', { active: false, yaw: 0 },
    { active: true, yaw: 0 }), medium).episode;
  const falling = projection.projectEvent(event('falling', { active: true, yaw: 0 },
    { active: false, yaw: 0 }), medium).episode;

  const trueReadout = channelByProperty(projection.readPublicState(rising.pulses.at(-1)!.drives), 'active');
  const falseReadout = channelByProperty(projection.readPublicState(falling.pulses.at(-1)!.drives), 'active');
  assert.equal(trueReadout.status, 'decoded');
  assert.equal(trueReadout.value, true);
  assert.equal(falseReadout.status, 'decoded');
  assert.equal(falseReadout.value, false);
});

test('continuous population readout preserves auditable bins, interval, and increase/decrease estimates', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(0xa12n);
  const resolution = Math.PI / 12;
  const increase = projection.projectEvent(event('yaw-up', { active: false, yaw: 0 },
    { active: false, yaw: resolution }), medium).episode;
  const decrease = projection.projectEvent(event('yaw-down', { active: false, yaw: resolution },
    { active: false, yaw: 0 }), medium).episode;

  const high = channelByProperty(projection.readPublicState(increase.pulses.at(-1)!.drives), 'yaw');
  const low = channelByProperty(projection.readPublicState(decrease.pulses.at(-1)!.drives), 'yaw');
  assert.equal(high.encoding, 'continuous');
  assert.equal(low.encoding, 'continuous');
  assert(high.continuous && low.continuous);
  assert(Math.abs(high.continuous.estimate - resolution) < 1e-9,
    `unexpected high estimate ${high.continuous.estimate}`);
  assert(Math.abs(low.continuous.estimate + resolution) < 1e-9,
    `unexpected low estimate ${low.continuous.estimate}`);
  assert(high.continuous.estimate > low.continuous.estimate);
  assert(high.continuous.lowerBound <= high.continuous.estimate
    && high.continuous.upperBound >= high.continuous.estimate);
  assert(high.continuous.populationBins.length >= 3);
});

test('read-only afferent lookup retains non-unit continuous drive amplitudes', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(0xa15n);
  const source = event('continuous-lookup', { active: false, yaw: 0 },
    { active: true, yaw: Math.PI / 12 });
  projection.projectEvent(source, medium);
  const lookup = projection.lookupCurrentObservation(source.frames[0]!, eventRows(source).roleBindings);
  assert(lookup.drives && lookup.drives.length === lookup.siteIds.length,
    'continuous lookup must expose its physical population drives');
  assert(lookup.drives.some(value => value.intensity !== 1),
    'overlapping continuous receptors were flattened to unit intensity');
  assert.deepEqual(lookup.drives.map(value => value.siteId), lookup.siteIds);
});

test('equivalent terminal populations decode stably and readout never mutates projection state', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(0xa13n);
  const first = projection.projectEvent(event('same-a', { active: false, yaw: 0 },
    { active: true, yaw: Math.PI / 12 }), medium).episode;
  const second = projection.projectEvent(event('same-b', { active: false, yaw: 0 },
    { active: true, yaw: Math.PI / 12 }), medium).episode;
  const before = sha(projection.snapshot());
  const left = projection.readPublicState(first.pulses.at(-1)!.drives);
  const right = projection.readPublicState(second.pulses.at(-1)!.drives);
  const after = sha(projection.snapshot());
  assert.deepEqual(left, right);
  assert.equal(before, after);
});

test('off-road, mixed categorical, and legacy descriptor-free populations cannot fabricate state', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(0xa14n);
  const rising = projection.projectEvent(event('legacy-rise', { active: false, yaw: 0 },
    { active: true, yaw: 0 }), medium).episode;
  const falling = projection.projectEvent(event('legacy-fall', { active: true, yaw: 0 },
    { active: false, yaw: 0 }), medium).episode;
  const used = new Set(projection.snapshot().bindings.flatMap(binding => binding.siteIds));
  const offRoadSite = Array.from({ length: 32 ** 3 }, (_unused, siteId) => siteId)
    .find(siteId => !used.has(siteId))!;
  const offRoad = projection.readPublicState([{ siteId: offRoadSite, intensity: 1 }]);
  assert.equal(offRoad.status, 'unknown');
  assert.deepEqual(offRoad.unmatchedSiteIds, [offRoadSite]);

  const mixedDrives = [...rising.pulses.at(-1)!.drives, ...falling.pulses.at(-1)!.drives];
  const mixedActive = channelByProperty(projection.readPublicState(mixedDrives), 'active');
  assert.equal(mixedActive.status, 'ambiguous');

  const current = projection.snapshot();
  const legacy: SelfOrganizingAfferentStateV1 = { ...current,
    bindings: current.bindings.map(binding => ({ signalId: binding.signalId,
      siteIds: [...binding.siteIds], observationCount: binding.observationCount })) };
  const restored = SelfOrganizingAfferentProjectionV1.restore(legacy);
  const before = sha(restored.snapshot());
  const unreadable = restored.readPublicState(rising.pulses.at(-1)!.drives);
  assert.equal(unreadable.status, 'unknown');
  assert.equal(unreadable.legacyDescriptorUnavailable, true);
  assert.equal(sha(restored.snapshot()), before);
});
