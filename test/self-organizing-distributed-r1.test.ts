import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, PublicValue, RealEvent } from '../src/contracts.js';
import type {
  DistributedMediumWritePortV1,
  R1DistributedEpisodeV1,
  R1DistributedTraceFootprintV1,
} from '../src/core/learning/distributed-r1-contracts.js';
import { compareDistributedEpisodesV1, DistributedR1ExperienceStoreV1 }
  from '../src/core/learning/distributed-r1.js';
import { SelfOrganizingAfferentProjectionV1 }
  from '../src/core/learning/self-organizing-afferent.js';
import { sha } from '../src/util.js';

class FixtureMedium implements DistributedMediumWritePortV1 {
  readonly #bound = new Map<string, number[]>();
  readonly #episodes: R1DistributedEpisodeV1[] = [];

  static restore(snapshot: ReturnType<FixtureMedium['snapshot']>): FixtureMedium {
    const medium = new FixtureMedium();
    for (const [id, sites] of snapshot.bound) medium.#bound.set(id, [...sites]);
    medium.#episodes.push(...snapshot.episodes.map(value => structuredClone(value)));
    return medium;
  }

  allocateSites(count: number, random: () => number): readonly number[] {
    const used = new Set([...this.#bound.values()].flat());
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
    assert.equal(this.#bound.has(bindingId), false);
    this.#bound.set(bindingId, [...siteIds]);
  }

  applyEpisode(episode: R1DistributedEpisodeV1): R1DistributedTraceFootprintV1 {
    this.#episodes.push(structuredClone(episode));
    const directedBondIds = episode.pulses.slice(1).flatMap((pulse, index) => {
      const prior = episode.pulses[index]!;
      return prior.drives.flatMap(from => pulse.drives.map(to => `${from.siteId}>${to.siteId}`));
    });
    const traceId = `fixture-footprint-${this.#episodes.length}`;
    return { version: 'DistributedTraceFootprintV1', traceId, footprintId: traceId,
      depositedAt: this.#episodes.length,
      siteIds: [...new Set(episode.pulses.flatMap(pulse => pulse.drives.map(drive => drive.siteId)))],
      directedBondIds: [...new Set(directedBondIds)],
      bondReferences: [...new Set(directedBondIds)].map(id => {
        const [fromSiteId, toSiteId] = id.split('>').map(Number);
        return { fromSiteId: fromSiteId!, toSiteId: toSiteId!, kind: 'plastic-directed' as const };
      }), pulseCount: episode.pulses.length, supportMass: 1 };
  }

  isFootprintActive(footprint: R1DistributedTraceFootprintV1): boolean {
    return footprint.siteIds.length > 0;
  }

  snapshot() {
    return { bound: [...this.#bound].sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([id, sites]) => [id, [...sites]] as const),
    episodes: this.#episodes.map(value => structuredClone(value)) };
  }
}

function observation(sequence: number, activeSeconds: number, contextId: string,
  objectStates: readonly { id: string; type: string; x: number; properties: Record<string, PublicValue> }[],
  selfOffset = 0): Observation {
  return { sequence, activeSeconds, contextId, targetId: null,
    self: { position: [selfOffset, 64, -selfOffset], yaw: 0, pitch: 0,
      properties: { onGround: true } },
    objects: objectStates.map(value => ({ id: value.id, type: value.type,
      relativePosition: [value.x, 0, -2], properties: value.properties })) };
}

function event(id: string, timeline: readonly { time: number; a: boolean; b?: boolean }[], options: {
  readonly selfOffset?: number; readonly reverseObjects?: boolean; readonly differentTypes?: boolean;
} = {}): RealEvent {
  const aId = `${id}-instance-a`, bId = `${id}-instance-b`;
  const frames = timeline.map((state, index) => observation(index + 1, state.time, `context-${id}`,
    (options.reverseObjects ? [
      { id: bId, type: options.differentTypes ? 'opaque-b' : 'opaque', x: 1,
        properties: { active: state.b ?? false } },
      { id: aId, type: 'opaque', x: -1, properties: { active: state.a } },
    ] : [
      { id: aId, type: 'opaque', x: -1, properties: { active: state.a } },
      ...(state.b === undefined ? [] : [{ id: bId, type: options.differentTypes ? 'opaque-b' : 'opaque',
        x: 1, properties: { active: state.b } }]),
    ]), options.selfOffset ?? 0));
  const action = { kind: 'observe' as const, parameters: { ticks: 5 } };
  return { version: 'RealEventV5', id, cue: { ...action, targetRole: null }, frames,
    trackedIds: [aId, ...(timeline.some(value => value.b !== undefined) ? [bId] : [])],
    bodyResult: { action, executed: true, status: 'completed', startSequence: 1,
      endSequence: frames.length }, provenance: 'executed-real-body', complete: true };
}

function stableScopedResultEvent(id: string, stableValue: boolean,
  initialValue = stableValue): RealEvent {
  const action = { kind: 'interact' as const, targetId: 'scoped-object', parameters: {} };
  const frames: Observation[] = [
    { sequence: 1, activeSeconds: 0, contextId: `context-${id}`, targetId: 'scoped-object',
      self: { position: [0, 64, 0], yaw: 0, pitch: 0,
        properties: { onGround: true, selectedSlot: 8 } },
      objects: [{ id: 'scoped-object', type: 'opaque', relativePosition: [0, 0, -1],
        properties: { result: initialValue } },
      // This visible object is intentionally outside the event observation
      // scope and must not become part of the physical episode.
      { id: 'background-object', type: 'background', relativePosition: [1, 0, -1],
        properties: { irrelevant: true } }] },
    { sequence: 2, activeSeconds: .1, contextId: `context-${id}`, targetId: 'scoped-object',
      self: { position: [0, 64, 0], yaw: 0, pitch: 0,
        properties: { onGround: true, selectedSlot: 0 } },
      objects: [{ id: 'scoped-object', type: 'opaque', relativePosition: [0, 0, -1],
        properties: { result: stableValue } },
      { id: 'background-object', type: 'background', relativePosition: [1, 0, -1],
        properties: { irrelevant: true } }] },
  ];
  return { version: 'RealEventV5', id, cue: { kind: action.kind,
    parameters: action.parameters, targetRole: 'opaque' }, frames,
  trackedIds: ['self', 'scoped-object'], bodyResult: { action, executed: true,
    status: 'completed', startSequence: 1, endSequence: 2 },
  provenance: 'executed-real-body', complete: true };
}

test('same cue shares a physical prefix while opposite public transitions have different terminal populations', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(11n);
  const increase = projection.projectEvent(event('increase', [
    { time: 0, a: false }, { time: .1, a: false }, { time: .2, a: true }, { time: .3, a: true },
  ]), medium).episode;
  const decrease = projection.projectEvent(event('decrease', [
    { time: 0, a: true }, { time: .1, a: true }, { time: .2, a: false }, { time: .3, a: false },
  ]), medium).episode;
  const comparison = compareDistributedEpisodesV1({ version: 'DistributedEpisodeTopologyV1',
    pulses: increase.pulses.map(value => value.drives),
    terminalSiteIds: increase.pulses.at(-1)!.drives.map(value => value.siteId) },
  { version: 'DistributedEpisodeTopologyV1', pulses: decrease.pulses.map(value => value.drives),
    terminalSiteIds: decrease.pulses.at(-1)!.drives.map(value => value.siteId) });
  assert.equal(comparison.sharedActionCuePulse, true);
  assert(comparison.terminalWeightedJaccard < 1);
  assert.notEqual(increase.patternSha256, decrease.patternSha256);
});

test('an executed no-effect window remains a real distributed episode rather than being rejected', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(12n);
  const noEffect = projection.projectEvent(event('no-effect', [
    { time: 0, a: false }, { time: .1, a: false }, { time: .2, a: false },
  ]), medium).episode;
  const effect = projection.projectEvent(event('effect', [
    { time: 0, a: false }, { time: .1, a: false }, { time: .2, a: true },
  ]), medium).episode;
  assert.equal(noEffect.pulses.length, 3,
    'a no-effect event should contain real pre-state, cue, and post-action residence');
  assert.equal(noEffect.retainedTransitionWaveCount, 0);
  assert.notEqual(noEffect.patternSha256, effect.patternSha256);
});

test('a scoped unchanged result remains in the terminal population when another property changes', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(121n);
  projection.projectEvent(stableScopedResultEvent('result-channel-qualified', true, false), medium);
  const stableFalse = projection.projectEvent(stableScopedResultEvent('stable-false', false), medium).episode;
  const stableTrue = projection.projectEvent(stableScopedResultEvent('stable-true', true), medium).episode;
  const decode = (episode: R1DistributedEpisodeV1) => projection.readPublicState(
    episode.pulses.at(-1)!.drives);
  const falseReadout = decode(stableFalse), trueReadout = decode(stableTrue);
  const resultChannel = (readout: ReturnType<typeof decode>) => readout.channels.find(channel =>
    channel.channel === 'value/opaque#0/result');
  assert.deepEqual(resultChannel(falseReadout), {
    channel: 'value/opaque#0/result', property: 'result', status: 'decoded',
    encoding: 'categorical', overlap: 1, competingOverlap: 0,
    reason: 'decoded-categorical', value: false,
  });
  assert.deepEqual(resultChannel(trueReadout), {
    channel: 'value/opaque#0/result', property: 'result', status: 'decoded',
    encoding: 'categorical', overlap: 1, competingOverlap: 0,
    reason: 'decoded-categorical', value: true,
  });
  assert.equal(falseReadout.channels.some(channel => channel.channel.includes('background')), false,
    'an untracked visible object leaked into the event terminal population');
  assert.notDeepEqual(stableFalse.pulses.at(-1)!.drives, stableTrue.pulses.at(-1)!.drives,
    'opposite observed stable results collapsed behind an unrelated slot change');
});

test('unchanged frame resampling changes dwell, not the transition topology or physical populations', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(13n);
  const sparse = projection.projectEvent(event('sparse-sampling', [
    { time: 0, a: false }, { time: .1, a: false }, { time: .2, a: true }, { time: .3, a: true },
  ]), medium).episode;
  const dense = projection.projectEvent(event('dense-sampling', [
    { time: 0, a: false }, { time: .05, a: false }, { time: .1, a: false },
    { time: .2, a: true }, { time: .25, a: true }, { time: .3, a: true },
  ]), medium).episode;
  assert.equal(sparse.patternSha256, dense.patternSha256);
  assert.deepEqual(sparse.pulses.map(value => value.drives), dense.pulses.map(value => value.drives));
  assert.deepEqual(sparse.pulses.map(value => value.dwellSeconds), dense.pulses.map(value => value.dwellSeconds));
});

test('world translation cannot move a binding or change an R1 episode', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(14n);
  const base = projection.projectEvent(event('world-origin', [
    { time: 0, a: false }, { time: .1, a: true }, { time: .2, a: true },
  ]), medium).episode;
  const shifted = projection.projectEvent(event('world-shifted', [
    { time: 0, a: false }, { time: .1, a: true }, { time: .2, a: true },
  ], { selfOffset: 512 }), medium).episode;
  assert.equal(base.patternSha256, shifted.patternSha256);
  assert.deepEqual(base.pulses.map(value => value.drives), shifted.pulses.map(value => value.drives));
});

test('subject identity and event order remain distributed distinctions', () => {
  const medium = new FixtureMedium(), projection = new SelfOrganizingAfferentProjectionV1(15n);
  const aThenBProjection = projection.projectEvent(event('a-then-b', [
    { time: 0, a: false, b: false }, { time: .1, a: true, b: false },
    { time: .2, a: true, b: true }, { time: .3, a: true, b: true },
  ]), medium);
  const bThenAProjection = projection.projectEvent(event('b-then-a', [
    { time: 0, a: false, b: false }, { time: .1, a: false, b: true },
    { time: .2, a: true, b: true }, { time: .3, a: true, b: true },
  ]), medium);
  const aThenB = aThenBProjection.episode, bThenA = bThenAProjection.episode;
  assert.equal(bThenAProjection.newlyAllocatedSignalCount, 0,
    'reversing the same source states allocated a forbidden sequence identity');
  assert.notEqual(aThenB.patternSha256, bThenA.patternSha256);
  assert.notDeepEqual(aThenB.pulses.at(-2)!.drives, bThenA.pulses.at(-2)!.drives,
    'the real intermediate source states lost their temporal distinction');
  assert.deepEqual(aThenB.pulses.at(-1)!.drives, bThenA.pulses.at(-1)!.drives,
    'the identical final public state was split by order metadata');
  const forwardFootprint = medium.applyEpisode(aThenB);
  const reverseFootprint = medium.applyEpisode(bThenA);
  assert.notDeepEqual(forwardFootprint.directedBondIds, reverseFootprint.directedBondIds,
    'source reversal did not form distinct directed physical channels');

  const subjectA = projection.projectEvent(event('subject-a', [
    { time: 0, a: false, b: false }, { time: .1, a: true, b: false },
  ], { differentTypes: true }), medium).episode;
  const subjectB = projection.projectEvent(event('subject-b', [
    { time: 0, a: false, b: false }, { time: .1, a: false, b: true },
  ], { differentTypes: true }), medium).episode;
  assert.notEqual(subjectA.patternSha256, subjectB.patternSha256);
});

test('one event stays a weak footprint and snapshot restoration is deterministic and idempotent', () => {
  const medium = new FixtureMedium();
  const store = new DistributedR1ExperienceStoreV1(medium, 16n);
  const source = event('stored-event', [
    { time: 0, a: false }, { time: .1, a: true }, { time: .2, a: true },
  ]);
  const first = store.observe(source);
  assert.equal(first.status, 'deposited');
  assert.equal(first.record.anchorStatus, 'weak-footprint');
  const mediumState = medium.snapshot(), state = store.snapshot();
  assert.equal(state.projection.bindings.every(binding => binding.siteIds.length === 8), true);

  const restoredMedium = FixtureMedium.restore(mediumState);
  const restored = DistributedR1ExperienceStoreV1.restore(restoredMedium, state);
  const duplicate = restored.observe(source);
  assert.equal(duplicate.status, 'already-observed');
  assert.equal(sha(restored.snapshot()), sha(state));
  assert.equal(restored.activeRecords().length, 1);

  const repeated = new FixtureMedium(), repeatedStore = new DistributedR1ExperienceStoreV1(repeated, 16n);
  repeatedStore.observe(source);
  assert.equal(sha(repeated.snapshot()), sha(mediumState));
});
