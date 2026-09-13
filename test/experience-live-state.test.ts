import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, PublicValue } from '../src/contracts.js';
import { EXPERIENCE_LIVE_LAW, ExperienceLiveState, projectLiveChannels, isActualLiveState, areConsecutiveActualStates,
  sealRealObservation, actualObservationDigest,
  type LiveMotorSignalV1, type LiveRealFrameV1 } from '../src/experience-live-state.js';
import { canonical, sha } from '../src/util.js';

// Component counterexamples only: no native learning, effect prediction or
// capability evidence. The component deliberately has no learned theta.
const OFF: LiveMotorSignalV1 = { state: 'off', provenance: 'verified-passive', cue: null };
const UNKNOWN: LiveMotorSignalV1 = { state: 'unknown', provenance: 'unknown', cue: null };
function observation(sequence: number, red?: number): Observation {
  const objects = red === undefined ? [] : [{ id: 'visible-cue', type: 'percept', relativePosition: [0, 0, -2] as const,
    properties: { red, green: .2, blue: .3 } }];
  return { sequence, activeSeconds: sequence * .05, contextId: 'unlearned-world-identity', targetId: objects[0]?.id ?? null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { health: 20 } }, objects };
}
function real(sequence: number, red?: number, extra: Partial<LiveRealFrameV1> = {}): LiveRealFrameV1 {
  return { provenance: 'observed-real', epoch: 'body-epoch', observation: observation(sequence, red),
    physicalClock: { provenance: 'body-physics', physicsTick: sequence, secondsPerTick: .05 }, motor: OFF, intervalMotor: OFF, ...extra };
}
function imagined(sequence: number, heat: number): Observation {
  const frame = observation(sequence);
  return { ...frame, self: { ...frame.self, properties: { heat } },
    predictionSupport: ['self/pitch', 'self/yaw', 'self/properties.heat', 'targetId'], predictionBounds: {} };
}

test('frozen retained references keep actual ownership while independent exports do not', () => {
  const live = new ExperienceLiveState(); live.accept(real(0)); const first = live.current();
  live.accept(real(1)); const second = live.current();
  assert.equal(live.current(), second); assert.equal(live.stateAt(first.frame!), first);
  assert(isActualLiveState(first)); assert(areConsecutiveActualStates(first, second));
  assert.equal(isActualLiveState(live.snapshot().current), false);
  assert.equal(isActualLiveState(live.fork().current()), false);
  const other = new ExperienceLiveState(); other.accept(real(0)); other.accept(real(1));
  assert.equal(areConsecutiveActualStates(first, other.current()), false, 'equal epoch/sequence cannot splice separate actual owners');
});

test('incremental payload accounting remains exact across Unicode, retirement, digit boundaries, and reset', () => {
  const live = new ExperienceLiveState({ frameCapacity: 3 });
  const exact = (value: ExperienceLiveState) => assert.equal(value.snapshotPayloadBytes, Buffer.byteLength(canonical(value.snapshot())));
  exact(live);
  for (let sequence = 0; sequence < 14; sequence++) {
    const frame = real(sequence, sequence % 2 ? .2 : .8);
    live.accept({ ...frame, observation: { ...frame.observation, self: { ...frame.observation.self,
      properties: { health: 20, '实测/条件': '变化🙂' } } } }); exact(live);
  }
  exact(ExperienceLiveState.restore(live.snapshot(), 'same-world-restart'));
  exact(ExperienceLiveState.restore(live.snapshot(), 'transfer'));
});

test('only validated recursively sealed observations have reusable immutable digests', () => {
  const mutable = structuredClone(observation(0)) as any;
  const before = actualObservationDigest(mutable); mutable.self.properties.health = 19;
  assert.notEqual(actualObservationDigest(mutable), before, 'ordinary digest lookup must not cache a mutable frame');
  const sealed = sealRealObservation(mutable);
  assert.equal(sealRealObservation(mutable), sealed); assert.equal(actualObservationDigest(mutable), sealed);
  assert(Object.isFrozen(mutable) && Object.isFrozen(mutable.self) && Object.isFrozen(mutable.self.properties));
  assert.throws(() => { mutable.self.properties.health = 3; }, TypeError);
  assert.throws(() => sealRealObservation({ ...observation(0), predictionSupport: [] }), /imagined-frame/);
  const live = new ExperienceLiveState(), original = real(0); live.accept(original);
  const changed = structuredClone(original.observation) as any; changed.self.properties.health = 17;
  assert.throws(() => live.accept({ ...original, observation: changed }), /digest-conflict/);
  assert.equal(actualObservationDigest(original.observation), live.current().frame!.sensorySha256);
});

test('the same actual current frame retains different measured histories in the recurrent state', () => {
  const red = new ExperienceLiveState(), blue = new ExperienceLiveState();
  for (let i = 0; i < 3; i++) { red.accept(real(i, .9)); blue.accept(real(i, .1)); }
  const sameCurrent = real(3); red.accept(sameCurrent); blue.accept(sameCurrent);
  assert.deepEqual(red.current().frame, blue.current().frame);
  assert.notDeepEqual(red.current().h, blue.current().h);
  assert.notDeepEqual(red.current().channels, blue.current().channels);
  assert.equal(red.current().channels['sense/gaze-measured'], false);
  assert.equal(red.current().memories[0]!.properties.red, .9);
  assert.equal(blue.current().memories[0]!.properties.red, .1);
});

test('changing batch boundaries and transport latency preserves every state exactly', () => {
  const frames = Array.from({ length: 12 }, (_, i) => real(i, i < 4 ? .6 : undefined));
  const direct = new ExperienceLiveState(), delayed = new ExperienceLiveState();
  for (const frame of frames) direct.accept({ ...frame, receivedMonotonicMs: 100 + frame.observation.sequence * 50 });
  for (const group of [frames.slice(0, 1), frames.slice(1, 8), frames.slice(8)])
    for (const frame of group) delayed.accept({ ...frame, receivedMonotonicMs: 10_000 + frame.observation.sequence });
  assert.deepEqual(delayed.snapshot(), direct.snapshot());
});

test('a duplicate shared frame does not advance state and conflicting motor/clock data is rejected', () => {
  const state = new ExperienceLiveState(); state.accept(real(0, .4)); state.accept(real(1));
  const before = sha(state.snapshot());
  assert.equal(state.accept(real(0, .4)).disposition, 'duplicate');
  assert.equal(sha(state.snapshot()), before);
  assert.throws(() => state.accept(real(1, undefined, { motor: UNKNOWN })), /digest-conflict/);
  assert.throws(() => state.accept(real(1, .8)), /digest-conflict/);
  assert.equal(sha(state.snapshot()), before);
});

test('a missing interval resets continuous activation and never invents elapsed physical time', () => {
  const state = new ExperienceLiveState(); state.accept(real(0, .8)); state.accept(real(1));
  assert.equal(state.accept(real(4)).disposition, 'gap');
  const current = state.current();
  assert.deepEqual(current.elapsed, { kind: 'unknown', reason: 'gap' });
  assert.equal(current.continuity, 'gap'); assert.equal(current.memories.length, 0);
  assert.equal(current.channels['time/known'], false);
  assert(!Object.hasOwn(current.channels, 'time/dt'));
  assert.equal(state.snapshot().gapCount, 1);
  state.accept(real(5)); assert.equal(state.current().continuity, 'continuous');
});

test('retired frames cannot be silently consumed again and the frame history is bounded', () => {
  const state = new ExperienceLiveState({ frameCapacity: 2 });
  state.accept(real(0)); const retired = state.current().frame!;
  state.accept(real(1)); state.accept(real(2));
  assert.equal(state.snapshot().frames.length, 2); assert.equal(state.stateAt(retired), null);
  const before = sha(state.snapshot());
  assert.throws(() => state.accept(real(0)), /out-of-order-or-retired/);
  assert.equal(sha(state.snapshot()), before);
  assert.throws(() => state.accept(real(3, undefined, { epoch: 'different-body' })), /explicit-restart/);
});

test('legacy activeSeconds cannot substitute for an absent physical clock', () => {
  const state = new ExperienceLiveState();
  state.accept(real(0, .4, { physicalClock: null }));
  state.accept(real(1, undefined, { physicalClock: null,
    observation: { ...observation(1), activeSeconds: 5000 } }));
  assert.deepEqual(state.current().elapsed, { kind: 'unknown', reason: 'missing-clock' });
  assert.equal(state.current().memories[0]!.agePhysicalSeconds, null);
  assert.equal(state.current().channels['time/known'], false);
});

test('physical dt, not wall or sequence-derived activeSeconds, drives continuous updates', () => {
  const ordinary = new ExperienceLiveState(), shifted = new ExperienceLiveState();
  for (let i = 0; i < 3; i++) {
    ordinary.accept(real(i)); shifted.accept(real(i, undefined, {
      observation: { ...observation(i), activeSeconds: 8000 + i * 500 }, receivedMonotonicMs: 100_000 + i }));
  }
  assert.deepEqual(ordinary.current().h, shifted.current().h);
  assert.deepEqual(ordinary.current().projection, shifted.current().projection);
  assert.deepEqual(ordinary.current().elapsed, { kind: 'measured', seconds: .05 });
  const slow = new ExperienceLiveState();
  for (let i = 0; i < 3; i++) slow.accept(real(i, undefined, {
    physicalClock: { provenance: 'body-physics', physicsTick: i, secondsPerTick: .5 } }));
  assert.notDeepEqual(slow.current().h, ordinary.current().h);
  assert.deepEqual(slow.current().elapsed, { kind: 'measured', seconds: .5 });
});

test('terminal sensing with zero physical ticks changes current sensation without inventing dynamics', () => {
  const state = new ExperienceLiveState(); state.accept(real(0)); state.accept(real(1));
  const before = state.current();
  const terminal = observation(2);
  state.accept(real(2, undefined, { physicalClock: { provenance: 'body-physics', physicsTick: 1, secondsPerTick: .05 },
    observation: { ...terminal, self: { ...terminal.self, properties: { health: 0 } } } }));
  assert.deepEqual(state.current().elapsed, { kind: 'measured', seconds: 0 });
  assert.deepEqual(state.current().h, before.h);
  assert.notDeepEqual(state.current().projection, before.projection);
});

test('actual off, held and unknown signals stay distinct while requested duration is not elapsed time', () => {
  const held = (ticks: number): LiveMotorSignalV1 => ({ state: 'held', provenance: 'body-transition',
    cue: { kind: 'move', parameters: { direction: 'forward', ticks }, targetRole: null } });
  const states = [OFF, UNKNOWN, held(4), held(20)].map(motor => {
    const state = new ExperienceLiveState(); state.accept(real(0, undefined, { motor })); return state.current();
  });
  assert.notDeepEqual(states[0]!.projection, states[1]!.projection);
  assert.notDeepEqual(states[0]!.projection, states[2]!.projection);
  assert.deepEqual(states[2]!.projection, states[3]!.projection);
  assert.equal(states[1]!.channels['motor/known'], false);
  assert(!Object.hasOwn(states[2]!.channels, 'motor/parameter/ticks'));
});

test('a release sample keeps its preceding held interval separate from the current off signal', () => {
  const held: LiveMotorSignalV1 = { state: 'held', provenance: 'body-transition',
    cue: { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null } };
  const correct = new ExperienceLiveState(), wrong = new ExperienceLiveState(), missing = new ExperienceLiveState();
  for (const state of [correct, wrong, missing]) state.accept(real(0, undefined, { motor: held }));
  correct.accept(real(1, undefined, { motor: OFF, intervalMotor: held }));
  wrong.accept(real(1, undefined, { motor: OFF, intervalMotor: OFF }));
  missing.accept(real(1, undefined, { motor: OFF, intervalMotor: undefined }));
  assert.equal(correct.current().channels['motor/state'], 'off');
  assert.equal(correct.current().channels['motor/interval-state'], 'held');
  assert.notDeepEqual(correct.current().projection, wrong.current().projection);
  assert.equal(missing.current().channels['motor/interval-known'], false);
  assert(!Object.hasOwn(missing.current().channels, 'motor/interval-state'));
});

test('a late channel beyond the original 32 has a stable path independent of discovery order', () => {
  const channels = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['measurement/' + i, i / 100]));
  const changed = { ...channels, 'measurement/79': .99 };
  const reverse = Object.fromEntries(Object.entries(channels).reverse());
  assert.deepEqual(projectLiveChannels(channels), projectLiveChannels(reverse));
  assert.notDeepEqual(projectLiveChannels(channels), projectLiveChannels(changed));
  const a = new ExperienceLiveState(), b = new ExperienceLiveState();
  const withProperties = (sequence: number, properties: Record<string, number>) => {
    const frame = observation(sequence); return real(sequence, undefined, { observation: { ...frame, self: { ...frame.self, properties } } });
  };
  a.accept(withProperties(0, channels)); b.accept(withProperties(0, reverse));
  a.accept(withProperties(1, changed)); b.accept(withProperties(1, Object.fromEntries(Object.entries(changed).reverse())));
  assert.deepEqual(a.current().h, b.current().h);
  assert.equal(a.current().projection.length, 32); assert.equal(a.current().h.length, 16);
});

test('world, frame and percept identities never become predictive channels', () => {
  const a = new ExperienceLiveState(), b = new ExperienceLiveState();
  a.accept(real(0, .4));
  const renamed = observation(0, .4);
  b.accept(real(0, undefined, { epoch: 'other-epoch', observation: { ...renamed, contextId: 'other-world', targetId: 'renamed',
    self: { ...renamed.self, position: [100, 64, -200] }, objects: renamed.objects.map(object => ({ ...object, id: 'renamed' })) } }));
  assert.deepEqual(a.current().projection, b.current().projection);
  assert.deepEqual(a.current().h, b.current().h);
  assert.deepEqual(a.current().channels, b.current().channels);
});

test('an ambiguous observed cue remains sourced memory and never becomes a visible object', () => {
  const state = new ExperienceLiveState(), seen = observation(0, .7);
  const ambiguous: Observation = { ...seen, perception: { version: 'AttentivePerception8',
    attendedId: 'visible-cue', gazeId: 'visible-cue', receptors: 1, groups: 1,
    tracks: [{ id: 'visible-cue', position: [0, 0, -2], color: [.7, .2, .3], extent: 1, sampleCount: 1,
      visible: true, confidence: .6, ambiguity: .8, age: 1, missed: 0, anchorEpoch: 0,
      motionEvidence: [false, false, false] }] } };
  state.accept(real(0, undefined, { observation: ambiguous }));
  const hidden = real(1), before = sha(hidden); state.accept(hidden);
  const memory = state.current().memories[0]!;
  assert.equal(memory.provenance, 'remembered-real-cue'); assert.equal(memory.association, 'ambiguous-at-observation');
  assert.equal(memory.visibleNow, false); assert.equal(memory.currentPosition, null); assert.equal(memory.persistence, 'unverified');
  assert.equal(hidden.observation.objects.length, 0); assert.equal(sha(hidden), before);
  assert.equal(state.current().channels['sense/gaze-measured'], false);
});

test('private imagined branches and readonly exports cannot mutate real state or create observed cue memory', () => {
  const live = new ExperienceLiveState(); live.accept(real(0, .4)); live.accept(real(1));
  const before = sha(live.snapshot()), branch = live.fork(), untouched = branch.fork();
  const oldBranch = sha(untouched.current());
  branch.advance(imagined(2, 30), { kind: 'measured', seconds: .05 }, OFF);
  assert.equal(sha(live.snapshot()), before); assert.equal(sha(untouched.current()), oldBranch);
  assert.equal(branch.current().origin, 'imagined'); assert.equal(branch.current().memories.length, 1);
  assert.deepEqual(branch.current().frame, live.current().frame, 'imagining cannot mint a real frame identity');
  const exported = live.current();
  assert(Object.isFrozen(exported) && Object.isFrozen(exported.h) && Object.isFrozen(exported.memories[0]!.properties));
  assert.throws(() => { (exported.h as number[])[0] = 999; }, TypeError);
  assert.throws(() => { (exported.memories[0]!.properties as Record<string, PublicValue>).red = 999; }, TypeError);
  assert.equal(sha(live.snapshot()), before);
  assert.throws(() => live.accept(real(2, undefined, { observation: imagined(2, 30) })), /imagined-frame/);
  assert.throws(() => branch.advance(observation(2), { kind: 'measured', seconds: .05 }, OFF), /explicit-imagined-support/);
});

test('unknown or interval-valued hypothetical inputs cannot smuggle precise values into branch activation', () => {
  const live = new ExperienceLiveState(); live.accept(real(0));
  for (const bounds of [undefined, { 'self/properties.heat': [0, 1000] as const }]) {
    const a = live.fork(), b = live.fork();
    const future = (value: number): Observation => ({ ...imagined(1, value),
      predictionSupport: bounds ? ['self/properties.heat'] : [], predictionBounds: bounds });
    a.advance(future(1), { kind: 'measured', seconds: .05 }, OFF);
    b.advance(future(999), { kind: 'measured', seconds: .05 }, OFF);
    assert.deepEqual(a.current().projection, b.current().projection);
    assert.deepEqual(a.current().h, b.current().h);
  }
});

test('same-world restart retains only unanchored remembered cues; transfer resets all history', () => {
  const live = new ExperienceLiveState(); live.accept(real(0, .4)); live.accept(real(1));
  const saved = live.snapshot(), same = ExperienceLiveState.restore(saved, 'same-world-restart');
  const transfer = ExperienceLiveState.restore(saved, 'transfer');
  for (const restored of [same, transfer]) {
    assert.equal(restored.current().frame, null); assert.equal(restored.current().physicalClock, null);
    assert.equal(restored.current().motor.state, 'unknown'); assert(restored.current().h.every(value => value === 0));
    assert.equal(restored.snapshot().frames.length, 0);
  }
  assert.equal(same.current().memories[0]!.association, 'unanchored-restart');
  assert.equal(same.current().memories[0]!.agePhysicalSeconds, null);
  assert.equal(transfer.current().memories.length, 0);
  same.accept(real(0, undefined, { epoch: 'restarted-body' }));
  assert.equal(same.current().frame!.epoch, 'restarted-body');
  assert.equal(same.current().memories[0]!.lastSeen.epoch, 'body-epoch');
  assert.deepEqual(live.snapshot(), saved);
});

test('bad provenance, clock order, and memory-forging snapshots leave the real state unchanged', () => {
  const live = new ExperienceLiveState(); live.accept(real(0, .4)); live.accept(real(1));
  const before = sha(live.snapshot());
  assert.throws(() => live.accept({ ...real(2), provenance: 'imagined' } as unknown as LiveRealFrameV1), /real-provenance/);
  assert.throws(() => live.accept(real(2, undefined, { physicalClock: { provenance: 'body-physics', physicsTick: 0, secondsPerTick: .05 } })), /clock-order/);
  assert.throws(() => live.accept(real(2, undefined, { motor: { state: 'held', provenance: 'verified-passive',
    cue: { kind: 'move', parameters: { direction: 'forward' }, targetRole: null } } as unknown as LiveMotorSignalV1 })), /body-evidence/);
  assert.equal(sha(live.snapshot()), before);
  const forged = structuredClone(live.snapshot()) as any; forged.current.memories[0].visibleNow = true;
  assert.throws(() => ExperienceLiveState.restore(forged, 'same-world-restart'), /memory-provenance/);
  const wrongLaw = structuredClone(live.snapshot()) as any; wrongLaw.law = EXPERIENCE_LIVE_LAW + '-altered';
  assert.throws(() => ExperienceLiveState.restore(wrongLaw, 'transfer'), /snapshot-version/);
});

test('cue count and serialized bytes stay bounded, with explicit transactional refusal on overflow', () => {
  const state = new ExperienceLiveState({ cueCapacity: 2, frameCapacity: 2 });
  for (let i = 0; i < 5; i++) state.accept(real(i, i / 10));
  assert.equal(state.current().memories.length, 2); assert.equal(state.snapshot().frames.length, 2);
  const small = new ExperienceLiveState({ maximumSnapshotBytes: 4096 });
  const frame = observation(0), properties = Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['channel/' + i, 'x'.repeat(100)]));
  const before = sha(small.snapshot());
  assert.throws(() => small.accept(real(0, undefined, { observation: { ...frame, self: { ...frame.self, properties } } })), /byte-capacity/);
  assert.equal(sha(small.snapshot()), before);
  const channels = new ExperienceLiveState({ maximumChannels: 64 });
  assert.throws(() => channels.accept(real(0, undefined, { observation: { ...frame, self: { ...frame.self,
    properties: Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['late/' + i, i])) } } })), /channel-capacity/);
  assert.equal(channels.snapshot().acceptedFrames, 0);
});
