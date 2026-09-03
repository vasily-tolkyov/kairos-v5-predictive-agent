import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { KairosV5DistributedPhysicalMemoryV3 }
  from '../src/distributed-hierarchical-memory.js';
import { cueFor } from '../src/events.js';
import {
  auditDistributedG6PublicPairV1,
  auditMinecraftDistributedG6ContinuousCapturePlanV1,
  auditMinecraftDistributedG6ContinuousCaptureV1,
  minecraftDistributedG6ContinuousCapturePlanV1,
  retagDistributedG6ContinuousEpisodeV1,
  type DistributedG6CapturedEpisodeV1,
  type DistributedG6PublicPairAuditV1,
} from '../src/evaluation/minecraft-distributed-g6-continuous-capture-v1.js';

function frame(sequence: number, note: number, gameMode: string, yaw = 0,
  onGround = true): Observation {
  return { sequence, activeSeconds: sequence * .05,
    self: { position: [0, 64, 0], yaw, pitch: 0,
      properties: { onGround, health: 20, food: 20, selectedSlot: 0, heldItem: null,
        gameMode, velocityX: 0, velocityY: 0, velocityZ: 0 } },
    objects: [{ id: 'block:0,65,-3', type: 'note_block', relativePosition: [0, 1, -3],
      properties: { instrument: 'harp', note, powered: false } }],
    targetId: 'block:0,65,-3', contextId: 'opaque-context' };
}

function event(id: string, action: Action, startSequence: number, before: number,
  after: number, gameMode = 'survival'): RealEvent {
  const first = frame(startSequence, before, gameMode);
  const last = frame(startSequence + 1, after, gameMode,
    action.kind === 'look' ? Math.PI / 12 : 0);
  const bound = action.kind === 'interact' ? { ...action, targetId: 'block:0,65,-3' } : action;
  return { version: 'RealEventV5', id, cue: cueFor(bound, first), frames: [first, last],
    trackedIds: ['self', 'block:0,65,-3'], bodyResult: { action: bound,
      executed: true, status: 'completed', startSequence, endSequence: startSequence + 1,
      terminationReason: 'stable' }, provenance: 'executed-real-body', complete: true };
}

function fourEvents(prefix: string, mode = 'survival'):
[RealEvent, RealEvent, RealEvent, RealEvent] {
  return [
    event(`${prefix}-0`, { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }, 1, 0, 0, mode),
    event(`${prefix}-1`, { kind: 'interact', parameters: {} }, 3, 0,
      mode === 'survival' ? 1 : 0, mode),
    event(`${prefix}-2`, { kind: 'interact', parameters: {} }, 5,
      mode === 'survival' ? 1 : 0, mode === 'survival' ? 2 : 0, mode),
    event(`${prefix}-3`, { kind: 'observe', parameters: { ticks: 5 } }, 7,
      mode === 'survival' ? 2 : 0, mode === 'survival' ? 2 : 0, mode),
  ];
}

test('G6 capture plan preregisters eight layouts, four arms per layout, and exactly 128 atoms', () => {
  const plan = minecraftDistributedG6ContinuousCapturePlanV1();
  const audit = auditMinecraftDistributedG6ContinuousCapturePlanV1(plan);
  assert.equal(audit.passed, true);
  assert.equal(audit.layoutCount, 8);
  assert.equal(audit.episodeCount, 32);
  assert.equal(audit.atomCount, 128);
  assert.deepEqual([...new Set(plan.episodes.map(value => value.arm))].sort(), [
    'look-minus-effect', 'look-minus-no-effect', 'look-plus-effect', 'look-plus-no-effect']);
  assert.equal(plan.episodes.every(value => value.actions.map(action => action.kind).join(',')
    === 'look,interact,interact,observe'), true);
  assert.equal(plan.episodes.some(value => value.layout.originX === 420
    || value.layout.originZ === 420 || value.layout.originX === 444
    || value.layout.originZ === 444), false);
});

test('each four-atom chain carries explicit reset/continuity and closes only on real observation', () => {
  const tagged = retagDistributedG6ContinuousEpisodeV1(fourEvents('chain'), 'real-session');
  assert.equal(tagged[0].hierarchyContinuity?.boundaryBefore, 'reset');
  assert.deepEqual(tagged.slice(1).map(value => value.hierarchyContinuity?.boundaryBefore),
    ['continuous', 'continuous', 'continuous']);
  assert.deepEqual(tagged.map(value => value.hierarchyContinuity?.processStatusAfter),
    ['open', 'open', 'open', 'publicly-resolved']);
  assert.equal(tagged.every(value => value.hierarchyContinuity?.sessionId === 'real-session'), true);
  assert.equal(tagged.every(value => value.hierarchyContinuity!.dependencies.length > 0), true);
});

test('public matched-pair audit permits gameMode but reports every other public mismatch', () => {
  const survival = fourEvents('effect', 'survival');
  const spectator = fourEvents('contrast', 'spectator');
  const matched = auditDistributedG6PublicPairV1(0, 15, spectator, survival);
  assert.equal(matched.otherPublicChannelsMatched, true);
  assert.equal(matched.permittedManipulatedChannels.every(value => value.startsWith('self/gameMode=')), true);
  assert.equal(matched.preResultPoints.length, spectator[0].frames.length + 1);
  assert.equal(matched.preResultPoints.at(-1)?.pointId, 'event-1/pre-action-frame');
  assert.equal(matched.excludedPostResultFrameCount > 0, true);

  const alteredLook: typeof spectator = [...spectator];
  alteredLook[0] = { ...spectator[0],
    frames: spectator[0].frames.map((value, index) => index === 1
      ? { ...value, self: { ...value.self,
        properties: { ...value.self.properties, onGround: false } } } : value) };
  const rejectedLook = auditDistributedG6PublicPairV1(0, 15, alteredLook, survival);
  assert.equal(rejectedLook.otherPublicChannelsMatched, false);
  assert.equal(rejectedLook.changedPublicChannels.some(value => value.startsWith('self/onGround=')), true);

  const alteredPreInteract: typeof spectator = [...spectator];
  alteredPreInteract[1] = { ...spectator[1], frames: spectator[1].frames.map((value, index) => index === 0
    ? { ...value, self: { ...value.self,
      properties: { ...value.self.properties, onGround: false } } } : value) };
  const rejectedPreInteract = auditDistributedG6PublicPairV1(0, 15, alteredPreInteract, survival);
  assert.equal(rejectedPreInteract.otherPublicChannelsMatched, false);
  assert.equal(rejectedPreInteract.preResultPoints.at(-1)?.otherPublicChannelsMatched, false);

  const alteredAfterOutcome: typeof spectator = [...spectator];
  alteredAfterOutcome[1] = { ...spectator[1], frames: spectator[1].frames.map((value, index) => index === 1
    ? { ...value, self: { ...value.self,
      properties: { ...value.self.properties, onGround: false } } } : value) };
  const acceptedAfterOutcome = auditDistributedG6PublicPairV1(0, 15, alteredAfterOutcome, survival);
  assert.equal(acceptedAfterOutcome.otherPublicChannelsMatched, true,
    'post-result differences must not be smuggled into pre-result fixture matching');

  const misalignedActions: typeof spectator = [...spectator];
  misalignedActions[0] = event('wrong-turn',
    { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } }, 1, 0, 0, 'spectator');
  const rejectedActions = auditDistributedG6PublicPairV1(0, 15, misalignedActions, survival);
  assert.equal(rejectedActions.otherPublicChannelsMatched, false);
  assert.equal(rejectedActions.structuralMismatchReasons.includes(
    'paired-look-does-not-match-preregistered-turn'), true);
});

test('offline cardinality audit requires 256+128 R1, exactly 32 explicit four-atom R2 events', () => {
  const plan = minecraftDistributedG6ContinuousCapturePlanV1();
  const baselineRaw = { version: 'KairosV5DistributedPhysicalMemoryV3', seenEventIds:
    Array.from({ length: 256 }, (_, index) => `old-${index}`), r2: { events: [] } };
  const baseline = baselineRaw as unknown as KairosV5DistributedPhysicalMemoryV3;
  const captured: DistributedG6CapturedEpisodeV1[] = [];
  const raw: { plan: typeof plan.episodes[number]; events:
    [RealEvent, RealEvent, RealEvent, RealEvent] }[] = [];
  const r2Events: Record<string, unknown>[] = [];
  for (const episode of plan.episodes) {
    const events = retagDistributedG6ContinuousEpisodeV1(
      fourEvents(`new-${episode.episodeOrdinal}`), 'real-session');
    const eventIds = events.map(value => value.id) as [string, string, string, string];
    captured.push({ episodeOrdinal: episode.episodeOrdinal, layoutOrdinal: episode.layoutOrdinal,
      arm: episode.arm, eventIds, r2EventId: `r2-${episode.episodeOrdinal}`,
      finalPublicNote: '2', noteTransitions: ['0->1', '1->2'] });
    raw.push({ plan: episode, events: [...events] });
    r2Events.push({ eventId: `r2-${episode.episodeOrdinal}`, sourceEventIds: eventIds,
      completion: 'complete', learningEligible: true, physicalFootprint: { traceId: `t-${episode.episodeOrdinal}` },
      atomIds: eventIds.map(id => `r1:${id}`) });
  }
  const finalSnapshot = ({ version: 'KairosV5DistributedPhysicalMemoryV3',
    seenEventIds: [...baseline.seenEventIds, ...captured.flatMap(value => value.eventIds)],
    r2: { events: r2Events } } as unknown as KairosV5DistributedPhysicalMemoryV3);
  const pairs: DistributedG6PublicPairAuditV1[] = Array.from({ length: 16 }, (_, index) => ({
    version: 'DistributedG6PublicPairAuditV1', pairId: `pair-${index}`,
    layoutOrdinal: Math.floor(index / 2), turnDegrees: index % 2 ? -15 : 15,
    baselineEventId: `b-${index}`, interventionEventId: `i-${index}`,
    changedPublicChannels: ['self/gameMode="spectator"', 'self/gameMode="survival"'],
    permittedManipulatedChannels: ['self/gameMode="spectator"', 'self/gameMode="survival"'],
    preResultPoints: [{ pointId: 'event-0/frame-0', baselineSequence: 1,
      interventionSequence: 1,
      changedPublicChannels: ['self/gameMode="spectator"', 'self/gameMode="survival"'],
      permittedManipulatedChannels: ['self/gameMode="spectator"', 'self/gameMode="survival"'],
      otherPublicChannelsMatched: true }],
    structuralMismatchReasons: [], excludedPostResultFrameCount: 1,
    otherPublicChannelsMatched: true }));
  const audit = auditMinecraftDistributedG6ContinuousCaptureV1(plan, baseline, finalSnapshot,
    captured, raw, pairs, 16, true);
  assert.equal(audit.passed, true, audit.blockers.join(','));
  assert.equal(audit.finalR1Atoms, 384);
  assert.equal(audit.finalR2Events, 32);
  assert.equal(audit.fourAtomCompleteR2Events, 32);

  const missing = auditMinecraftDistributedG6ContinuousCaptureV1(plan, baseline,
    { ...finalSnapshot, seenEventIds: finalSnapshot.seenEventIds.slice(0, -1) },
    captured, raw, pairs, 16, true);
  assert.equal(missing.passed, false);
  assert.equal(missing.blockers.includes('capture-final-R1-cardinality-is-not-exactly-384'), true);
});
