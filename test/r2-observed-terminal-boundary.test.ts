import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation, RealEvent } from '../src/contracts.js';
import { eventRows } from '../src/events.js';
import { DistributedR1ExperienceStoreV1 } from '../src/core/learning/distributed-r1.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedR2ContinuityStoreV1 } from '../src/core/learning/distributed-r2.js';
import { DistributedR2APhysicalPatternLearnerV2 } from '../src/core/learning/distributed-r2a-physical.js';
import type { DistributedR2AtomV1 } from '../src/core/learning/distributed-r2-contracts.js';

function fixture(finalVisible = true, prepareFirst = false) {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'terminal-R1' });
  const r1 = new DistributedR1ExperienceStoreV1(medium);
  const frame = (sequence: number, q: boolean, visible = true, selectedSlot = 1): Observation => ({ sequence,
    activeSeconds: sequence * .05, contextId: 'anonymous-context', targetId: visible ? 'o' : null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot } },
    objects: visible ? [{ id: 'o', type: 'anonymous', relativePosition: [0, 0, -1], properties: { q } }] : [] });
  const a: RealEvent = { version: 'RealEventV5', id: 'a',
    cue: { kind: 'interact', parameters: {}, targetRole: 'anonymous' },
    frames: [frame(1, false), frame(2, true)], trackedIds: ['self', 'o'],
    bodyResult: { action: { kind: 'interact', parameters: {}, targetId: 'o' },
      executed: true, status: 'completed', startSequence: 1, endSequence: 2 },
    complete: true, provenance: 'executed-real-body' };
  const b: RealEvent = { ...a, id: 'b', cue: { kind: 'observe', parameters: { ticks: 5 }, targetRole: null },
    frames: [frame(2, true, finalVisible), frame(3, true, finalVisible)],
    bodyResult: { action: { kind: 'observe', parameters: { ticks: 5 } }, executed: true,
      status: 'completed', startSequence: 2, endSequence: 3 } };
  const preparation: RealEvent = { ...a, id: 'preparation',
    cue: { kind: 'select-hotbar', parameters: { slot: 1 }, targetRole: null },
    frames: [frame(0, false, true, 0), frame(1, false)],
    bodyResult: { action: { kind: 'select-hotbar', parameters: { slot: 1 } }, executed: true,
      status: 'completed', startSequence: 0, endSequence: 1 } };
  const atoms = [...(prepareFirst ? [preparation] : []), a, b].map((event): DistributedR2AtomV1 => {
    const { record } = r1.observe(event), rows = eventRows(event);
    const end = r1.lookupCurrentObservation(event.frames.at(-1)!, rows.roleBindings,
      undefined, 'observed-terminal');
    return { version: 'DistributedR2AtomV1', atomId: event.id, sourceEventId: event.id,
      exactExperienceIdentity: event.cue.kind, episodePatternSha256: record.episodePatternSha256,
      r1Topology: record.episodeTopology, r1Footprint: record.footprint, cue: event.cue,
      contextId: 'anonymous-context', startedAt: event.frames[0]!.activeSeconds,
      endedAt: event.frames.at(-1)!.activeSeconds, startFrameSequence: event.frames[0]!.sequence,
      endFrameSequence: event.frames.at(-1)!.sequence, sessionId: 's', continuityEpochId: 'c',
      dependencies: [{ dependencyId: 'same-observed-object', subject: 'o', property: 'q',
        basis: 'public-state-carried-forward', beforeObservationSequence: 1, afterObservationSequence: 2,
        beforeValueSha256: 'test-before', afterValueSha256: 'test-after',
        factCategory: 'public-state-persistence' }], publicChanges: rows.changes.flat(),
      beforePublicSignals: [], afterPublicSignals: [], beforePublicSignalOccurrences: [],
      afterPublicSignalOccurrences: [],
      ...{ observedTerminalR1Drives: end.drives ?? end.siteIds.map(siteId => ({ siteId, intensity: 1 })),
        resultChannelR1SiteIds: r1.publicResultChannelSiteIds(record.episodeTopology.terminalSiteIds) } };
  });
  const r2 = new DistributedR2ContinuityStoreV1(undefined, undefined, undefined,
    footprint => medium.isFootprintActive(footprint));
  atoms.forEach(atom => r2.ingest(atom, 'continuous'));
  const closed = r2.close('public-process-resolved');
  assert.equal(closed.status, 'committed');
  if (closed.status !== 'committed') throw new Error('missing-test-event');
  return { r2, closed: closed.event, atoms };
}

test('final verification retains the actually visible process result as an R2 population', () => {
  const { r2, closed, atoms } = fixture();
  const finalReal = new Set(atoms[1]!.observedTerminalR1Drives!.map(value => value.siteId));
  const expected = r2.snapshot().projection.bindings.filter(binding => finalReal.has(binding.sourceSiteId))
    .flatMap(binding => binding.targetSiteIds).sort((a, b) => a - b);
  assert.ok(expected.length > 0);
  assert.deepEqual(closed.physicalPulseSiteIds.at(-1), expected,
    'the observation/no-change marker replaced an actually observed process outcome');
});

test('an earlier preparation stays on the road, not in the later result basin', () => {
  const { r2, closed, atoms } = fixture(true, true);
  const latestResult = new Set(atoms[1]!.r1Topology.terminalSiteIds);
  const expected = r2.snapshot().projection.bindings.filter(binding => latestResult.has(binding.sourceSiteId))
    .flatMap(binding => binding.targetSiteIds).sort((a, b) => a - b);
  assert.deepEqual(closed.physicalPulseSiteIds.at(-1), expected,
    'a prior action result was mixed into the current effect terminal');
  assert.equal(closed.atomIds.length, 3, 'preparation evidence must stay on the ordered road');
});

test('an unseen final object does not inherit a previous outcome as current reality', () => {
  const { closed, atoms } = fixture(false);
  assert.equal(atoms[1]!.observedTerminalR1Drives!.length, 0);
  assert.equal(closed.physicalPulseSiteIds.length,
    atoms.reduce((sum, atom) => sum + atom.r1Topology.pulses.length, 0));
});

test('initial R2A conditions never include later states observed inside the same process', () => {
  const { r2, closed } = fixture();
  const event = { ...closed, beforePublicSignals: ['q:false'],
    beforePublicSignalOccurrences: [{ signalId: 'q:false', pulseOrdinal: 0,
      channelOrdinal: 0, receptorOrdinal: 0 }],
    beforeSignalTimeline: [['q:false'], ['q:true']],
    beforeSignalTimelineOccurrences: [
      [{ signalId: 'q:false', pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 }],
      [{ signalId: 'q:true', pulseOrdinal: 1, channelOrdinal: 0, receptorOrdinal: 0 }],
    ] };
  const r2a = new DistributedR2APhysicalPatternLearnerV2(id => r2.isEventActive(id));
  r2a.observe(event);
  assert.deepEqual(r2a.snapshot().eventInputs[0]!.conditionSignalIds, ['q:false'],
    'the later observed result was injected as if it was known before the process');
});
