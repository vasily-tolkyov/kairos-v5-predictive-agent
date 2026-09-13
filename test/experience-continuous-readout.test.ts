import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, ActionCue, MotorClockV1, MotorReceiptV1, Observation, RealEvent } from '../src/contracts.js';
import { ExperienceLiveState, type LiveStateV1 } from '../src/experience-live-state.js';
import { ExperienceMedium, continuousEndpointIdentity, continuousIntervalIdentity, experienceInputs,
  type ExperienceWindowLiveTraceV1 } from '../src/experience-medium.js';
import { continuousReadoutField, continuousReadoutInput } from '../src/experience-timed-readout.js';
import { sha } from '../src/util.js';
import { cueFor } from '../src/events.js';

// Synthetic provenance/counterexample tests. These do not demonstrate native
// sustained learning, continuous rollout, or completion of a multistage task.
const OFF = { state: 'off', provenance: 'verified-passive', cue: null } as const;
const INTERVAL_OFF = { state: 'off', basis: 'observed-passive' } as const;
const frame = (sequence: number, signal = 0, result = 0): Observation => ({
  sequence, activeSeconds: sequence / 20, contextId: 'unlearned-apparatus', targetId: null, objects: [],
  physicalClock: { version: 'RealFrameClockV1', physicsTick: sequence, secondsPerTick: .05,
    monotonicMs: 1000 + sequence * 50, sample: 'physics' },
  motorSignal: { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state: 'off', cue: null },
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { signal, result } } });
function window(serial = 0, history = 1, result = 1, duration = 1, clock = true) {
  const live = new ExperienceLiveState({ frameCapacity: 64 });
  const accept = (observation: Observation) => {
    const physical = observation.physicalClock;
    live.accept({ provenance: 'observed-real', epoch: 'same-public-epoch', observation,
      physicalClock: physical ? { provenance: 'body-physics', physicsTick: physical.physicsTick, secondsPerTick: physical.secondsPerTick } : null,
      motor: OFF, intervalMotor: OFF });
    return live.current();
  };
  for (let i = 0; i < 2; i++) accept(frame(i, history));
  const frames = Array.from({ length: duration + 1 }, (_, i) => {
    const value = frame(2 + i, 0, i === duration ? result : 0);
    if (clock) return value;
    const { physicalClock: _clock, ...legacy } = value; return legacy;
  });
  const states = frames.map(accept);
  const event: RealEvent = { version: 'RealEventV5', id: `continuous-apparatus:event-${serial}`,
    cue: { kind: 'passive', parameters: { ticks: duration }, targetRole: null }, frames, trackedIds: ['self'],
    provenance: 'observed-passive', complete: true, bodyResult: null };
  const liveTrace: ExperienceWindowLiveTraceV1 = { version: 'ExperienceWindowLiveTraceV1',
    parentWindowId: event.id, parentEventDigest: sha(event), states };
  return { live, event, liveTrace };
}
const endpoint = (medium: ExperienceMedium, value: ReturnType<typeof window>) =>
  medium.snapshot().networks.find(([id]) => id === continuousEndpointIdentity(value.event.cue) + '/self')![1];

function zeroWindow(serial: number, kind: 'move' | 'passive' | 'look' | 'jump', requested = 4) {
  const action: Action = kind === 'move' ? { kind, parameters: { direction: 'forward', ticks: requested } }
    : kind === 'look' ? { kind, parameters: { yaw: .7, pitch: 0 } }
      : { kind, parameters: kind === 'passive' ? { ticks: 1 } : {} };
  const start = frame(100), end = frame(101);
  const signalCue: ActionCue = { kind: 'move', parameters: { direction: 'forward' }, targetRole: null };
  const first: Observation = { ...start, self: { ...start.self, properties: { ...start.self.properties, health: 20 } } };
  const last: Observation = { ...end, physicalClock: { ...end.physicalClock!, physicsTick: first.physicalClock!.physicsTick, sample: 'terminal' },
    ...(kind === 'move' ? { motorSignal: { version: 'BodyMotorSignalV1' as const, scope: 'instrumented-held-controls' as const,
      state: 'held' as const, cue: signalCue } } : {}),
    self: { ...end.self, yaw: kind === 'look' ? .7 : 0,
      properties: { ...end.self.properties, health: kind === 'look' ? 20 : 0 } } };
  const edge = (value: Observation): MotorClockV1 => ({ observationSequence: value.sequence,
    physicsTick: value.physicalClock!.physicsTick, activeSeconds: value.activeSeconds, monotonicMs: value.physicalClock!.monotonicMs + 1 });
  const pressedAt = edge(first), releasedAt = edge(last);
  const motorReceipt: MotorReceiptV1 | undefined = kind === 'move' ? {
    version: 'MotorReceiptV1', durationParameter: 'ticks', requestedTicks: requested,
    requestedAt: pressedAt, pressedAt, releasedAt, pressSucceeded: true, releaseSucceeded: true,
    actualTicks: 0, actualSeconds: 0, elapsedMonotonicMs: releasedAt.monotonicMs - pressedAt.monotonicMs,
    observedIntervals: 1, frameRange: { startSequence: first.sequence, endSequence: last.sequence }, releaseReason: 'death' } : undefined;
  const event: RealEvent = { version: 'RealEventV5', id: `zero-exposure:event-${serial}`, cue: cueFor(action, first),
    frames: [first, last], trackedIds: ['self'], complete: true,
    provenance: kind === 'passive' ? 'observed-passive' : 'executed-real-body',
    bodyResult: kind === 'passive' ? null : { action, executed: true, status: 'completed', startSequence: first.sequence,
      endSequence: last.sequence, terminationReason: kind === 'look' ? 'stable' : 'body-interrupted',
      ...(motorReceipt ? { motorReceipt } : {}) } };
  const live = new ExperienceLiveState(), states = event.frames.map(observation => {
    const motor = observation.motorSignal!.state === 'held'
      ? { state: 'held' as const, provenance: 'body-transition' as const, cue: signalCue } : OFF;
    live.accept({ provenance: 'observed-real', epoch: 'zero-exposure', observation, motor, intervalMotor: motor,
      physicalClock: { provenance: 'body-physics', physicsTick: observation.physicalClock!.physicsTick, secondsPerTick: .05 } });
    return live.current();
  });
  const liveTrace: ExperienceWindowLiveTraceV1 = { version: 'ExperienceWindowLiveTraceV1', parentWindowId: event.id,
    parentEventDigest: sha(event), states };
  return { event, live, liveTrace };
}

test('zero measured hold assimilates death but preserves theta and earns no requested-action certificate', () => {
  const medium = new ExperienceMedium(), prior = window(0); medium.observe(prior.event, { liveTrace: prior.liveTrace });
  const before = medium.snapshot(), short = zeroWindow(0, 'move', 4), long = zeroWindow(1, 'move', 20);
  assert.deepEqual(short.liveTrace.states[0]!.projection, long.liveTrace.states[0]!.projection);
  assert.deepEqual(short.liveTrace.states[0]!.h, long.liveTrace.states[0]!.h);
  for (const value of [short, long]) {
    assert.deepEqual(value.live.current().elapsed, { kind: 'measured', seconds: 0 });
    assert.equal(value.live.current().channels['sense/self/health'], 0);
    assert.deepEqual(value.live.current().h, value.liveTrace.states[0]!.h, 'terminal assimilation does not invent a physics step');
    const result = medium.observe(value.event, { liveTrace: value.liveTrace });
    assert.equal(result.skipped, 'no-measured-motor-interval'); assert.equal(result.learned, false);
    assert.equal(result.continuous?.endpointIndependentWindows, 0); assert.equal(result.continuous?.intervalRows, 0);
    assert.equal(result.continuous?.assimilationRows, 1); assert.equal(medium.writes, before.writes);
    assert.equal(medium.predict(value.event.cue, value.event.frames[0]!, { state: value.liveTrace.states[0] }).accepted, false);
  }
  const after = medium.snapshot(); assert.equal(after.version, 'KairosExperienceMediumV12');
  assert.deepEqual(after.networks, before.networks); assert.deepEqual(after.contexts, before.contexts);
  assert.equal(after.untrainedMotorWindows, 2); assert.equal(after.events.length, before.events.length + 2);
  assert.equal(medium.observe(short.event, { liveTrace: short.liveTrace }).skipped, 'duplicate');
  assert.deepEqual(ExperienceMedium.restore(after).snapshot(), after);
});

test('zero-time passive terminal sensing is retained without becoming passive dynamics or another theta write', () => {
  const value = zeroWindow(0, 'passive'), medium = new ExperienceMedium();
  const result = medium.observe(value.event, { liveTrace: value.liveTrace });
  assert.equal(result.skipped, 'no-positive-physical-interval'); assert.equal(result.learned, false);
  assert.equal(result.continuous?.assimilationRows, 1); assert.equal(value.live.current().channels['sense/self/health'], 0);
  const saved = medium.snapshot(); assert.equal(saved.writes, 0); assert.equal(saved.untrainedLiveWindows, 1);
  assert.equal(saved.networks.length, 0); assert.equal(saved.events.length, 1);
  assert.deepEqual(ExperienceMedium.restore(saved).snapshot(), saved);
});

test('receipt-free instantaneous endpoint measurements are preserved without any physical dynamics row', () => {
  for (const kind of ['look', 'jump'] as const) {
    const value = zeroWindow(0, kind), medium = new ExperienceMedium();
    const result = medium.observe(value.event, { liveTrace: value.liveTrace });
    assert.equal(result.learned, true); assert.equal(result.continuous?.zeroTimeEndpoint, true);
    assert.equal(result.continuous?.endpointPhysicalTicks, 0); assert.equal(result.continuous?.intervalRows, 0);
    assert.equal(result.continuous?.intervalRolloutSupported, false);
    const saved = medium.snapshot(); assert(saved.networks.every(([id]) => id.startsWith('continuous-v1/endpoint/')));
    const row = saved.contexts!.circuits[0]![1].samples[0]!;
    assert.deepEqual(row.targets['return/physicalTicks'], [0, 0]);
    if (kind === 'look') assert(Math.abs(Number(row.targets.yaw![1]) - .7) < 1e-12,
      'retain the actual sampled camera change without supplying its effect as a rule');
    assert.equal(Object.hasOwn(row.input, 'interval/dt'), false);
  }
});

test('the same current frame with different actual history enters the same learned 49-coefficient predictor', () => {
  const a = window(0, -1, -1), b = window(1, 1, 1);
  assert.deepEqual(a.event.frames[0], b.event.frames[0]);
  const field = (value: typeof a) => continuousReadoutField(continuousReadoutInput(value.liveTrace.states[0]!, experienceInputs(value.event.frames[0]!)));
  assert.deepEqual(field(a).slice(0, 33), field(b).slice(0, 33));
  assert.notDeepEqual(field(a).slice(33), field(b).slice(33));
  const medium = new ExperienceMedium();
  for (let i = 0; i < 48; i++) {
    const sign = i % 2 ? 1 : -1, value = window(i, sign, sign);
    medium.observe(value.event, { liveTrace: value.liveTrace });
  }
  const network = endpoint(medium, a), head = network.heads.find(head => head.key === 'property/result')!;
  assert.equal(head.readout[0]!.length, 49);
  assert(head.readout.some(row => row.slice(33).some(value => Math.abs(value) > 1e-12)), 'history really changes learned readout conductances');
  assert([a, b].every(value => !medium.predict(value.event.cue, value.event.frames[0]!,
    { state: value.liveTrace.states[0] }).supportedFields.includes('self/properties.result')),
  '48 synthetic windows still include too many early calibration failures; a fitted history effect is not support');
  for (let i = 48; i < 96; i++) {
    const sign = i % 2 ? 1 : -1, value = window(i, sign, sign);
    medium.observe(value.event, { liveTrace: value.liveTrace });
  }
  const predicted = [a, b].map(value => medium.predict(value.event.cue, value.event.frames[0]!, { state: value.liveTrace.states[0] }));
  assert.deepEqual(predicted.map(value => value.observation?.self.properties.result), [-1, 1]);
  assert(predicted.every(value => value.supportedFields.includes('self/properties.result')));
});

test('all interval rows are calibrated before their original window and never become extra independent observations', () => {
  const medium = new ExperienceMedium(), value = window(0, 1, 1, 12);
  const result = medium.observe(value.event, { liveTrace: value.liveTrace });
  assert.equal(result.writes, 1); assert.equal(result.continuous?.intervalRows, 12);
  assert.equal(result.continuous?.newIndependentIntervalWindows, 0);
  const snapshot = medium.snapshot(), circuit = snapshot.contexts!.circuits.find(([id]) => id === continuousIntervalIdentity(INTERVAL_OFF) + '/self')![1];
  assert.equal(circuit.samples.length, 12);
  assert(circuit.samples.every(row => row.windowId === value.event.id));
  assert(circuit.samples.every(row => Object.keys(row.externalErrors ?? {}).length === 0), 'later rows cannot calibrate against earlier fits in this same new window');
  const read = medium.readInterval(value.event.frames[0]!, { state: value.liveTrace.states[0]!, motor: INTERVAL_OFF, deltaSeconds: .05 });
  assert.equal(read.wholeWindowSupported, false); assert.equal(read.thetaWrites, 0);
  assert(read.outputs.every(row => row.independentCalibrationWindows === 0 && !row.supported));
  assert.equal(medium.observe(value.event, { liveTrace: value.liveTrace }).skipped, 'duplicate');
  assert.deepEqual(medium.snapshot(), snapshot);
});

test('retrospective passive packaging duration is an output, never an endpoint input or motor namespace', () => {
  const a = window(0, 1, 1, 1), b = window(1, 1, 1, 5), medium = new ExperienceMedium();
  assert.equal(continuousEndpointIdentity(a.event.cue), continuousEndpointIdentity(b.event.cue));
  medium.observe(a.event, { liveTrace: a.liveTrace }); medium.observe(b.event, { liveTrace: b.liveTrace });
  const samples = medium.snapshot().contexts!.circuits.find(([id]) => id === continuousEndpointIdentity(a.event.cue) + '/self')![1].samples;
  assert.equal(samples.length, 2); assert.deepEqual(samples[0]!.input, samples[1]!.input);
  assert.deepEqual(samples.map(row => row.targets['return/physicalTicks']), [[0, 1], [0, 5]]);
  assert.equal(Object.hasOwn(samples[0]!.input, 'interval/dt'), false);
});

test('missing physical clocks cannot acquire duration from activeSeconds or frame count', () => {
  const value = window(0, 1, 1, 2, false), medium = new ExperienceMedium();
  const result = medium.observe(value.event, { liveTrace: value.liveTrace });
  assert.equal(result.skipped, 'no-verified-live-clock'); assert.equal(result.learned, false);
  assert.equal(medium.writes, 0); assert.equal(medium.snapshot().networks.length, 0);
  assert.deepEqual(ExperienceMedium.restore(medium.snapshot()).snapshot(), medium.snapshot());
});

test('serialized, end-substituted, mixed-owner, and source-conflicting traces are rejected before theta changes', () => {
  const a = window(), b = window(), medium = new ExperienceMedium(), before = medium.snapshot();
  const candidates = [structuredClone(a.liveTrace), { ...a.liveTrace, states: [a.liveTrace.states[1]!, a.liveTrace.states[1]!] },
    { ...a.liveTrace, states: [a.liveTrace.states[0]!, b.liveTrace.states[1]!] },
    { ...a.liveTrace, parentEventDigest: '0'.repeat(64) }];
  for (const liveTrace of candidates) {
    assert.throws(() => medium.observe(a.event, { liveTrace }), /live-trace/); assert.deepEqual(medium.snapshot(), before);
  }
});

test('old theta stays in legacy semantics, and new checkpoints restore both namespaces without reinterpretation', () => {
  const medium = new ExperienceMedium(), legacy = window(0);
  medium.observe(legacy.event); const old = medium.snapshot(); assert.equal(old.version, 'KairosExperienceMediumV11');
  const restored = ExperienceMedium.restore(old), value = window(1);
  assert.equal(restored.predict(value.event.cue, value.event.frames[0]!, { state: value.liveTrace.states[0] }).reason, 'unobserved-action');
  restored.observe(value.event, { liveTrace: value.liveTrace });
  const current = restored.snapshot(); assert.equal(current.version, 'KairosExperienceMediumV12');
  assert.deepEqual(current.networks.filter(([id]) => !id.startsWith('continuous-v1/')), old.networks);
  assert.equal(current.random, old.random, 'new projection does not mutate legacy random receptor initialization');
  assert.deepEqual(ExperienceMedium.restore(current).snapshot(), current);
  assert.throws(() => ExperienceMedium.restore({ ...current, version: 'KairosExperienceMediumV11' }), /semantic/);
});

test('predictions and interval queries preserve real z and theta and remove measurement provenance', () => {
  const medium = new ExperienceMedium(), value = window(); medium.observe(value.event, { liveTrace: value.liveTrace });
  const theta = medium.snapshot(), state = value.live.current(), start = value.liveTrace.states[0]!;
  const prediction = medium.predict(value.event.cue, value.event.frames[0]!, { state: start, probe: true });
  assert(prediction.observation && prediction.state);
  for (const field of ['physicalClock', 'motorSignal', 'bodySensation', 'sensation', 'perception', 'hotbarSensation'])
    assert.equal(Object.hasOwn(prediction.observation, field), false);
  assert.equal(prediction.state.origin, 'imagined'); assert.equal(prediction.state.physicalClock, null);
  assert.equal(prediction.timing?.intervalRolloutSupported, false);
  const next = medium.predict(value.event.cue, prediction.observation, { state: prediction.state });
  assert.equal(next.accepted, false); assert.deepEqual(next.supportedFields, []);
  medium.readInterval(value.event.frames[0]!, { state: start, motor: INTERVAL_OFF, deltaSeconds: .05 });
  medium.explorationDrive(value.event.cue, value.event.frames[0]!, undefined, start);
  assert.equal(value.live.current(), state); assert.deepEqual(medium.snapshot(), theta);
  assert.throws(() => medium.predict(value.event.cue, value.event.frames[0]!, { state: structuredClone(start) }), /unowned/);
  const altered = structuredClone(value.event.frames[0]!) as any; altered.self.properties.result = 99;
  assert.throws(() => medium.predict(value.event.cue, altered, { state: start }), /frame-mismatch/);
});

test('late sensory features enter continuous conductances after the old 32-slot capacity', () => {
  const value = window(), state: LiveStateV1 = value.liveTrace.states[0]!;
  const sensory = Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['feature/' + i, i]));
  const a = continuousReadoutField(continuousReadoutInput(state, sensory));
  const b = continuousReadoutField(continuousReadoutInput(state, { ...sensory, 'late-feature': 7 }));
  assert.notDeepEqual(a.slice(1, 33), b.slice(1, 33));
  assert.deepEqual(a, continuousReadoutField(continuousReadoutInput(state, Object.fromEntries(Object.entries(sensory).reverse()))));
});
