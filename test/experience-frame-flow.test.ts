import assert from 'node:assert/strict';
import test from 'node:test';
import type { BodyMotorSignalV1, MotorEdgeV1, Observation, PhysicalTelemetryBatchV1, RealEvent } from '../src/contracts.js';
import { PhysicalTelemetryQueue } from '../src/body.js';
import { ExperienceFrameFlow } from '../src/experience-frame-flow.js';
import { ExperienceLiveState } from '../src/experience-live-state.js';
import { experienceSearchKey } from '../src/experience-agent.js';
import { sha } from '../src/util.js';

const off: BodyMotorSignalV1 = { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state: 'off', cue: null };
const held: BodyMotorSignalV1 = { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state: 'held',
  cue: { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null } };
const frame = (sequence: number, motorSignal: BodyMotorSignalV1 = off, heat = 0): Observation => ({ sequence,
  activeSeconds: sequence / 20, physicalClock: { version: 'RealFrameClockV1', physicsTick: sequence,
    secondsPerTick: .05, monotonicMs: 1000 + sequence * 50, sample: 'physics' }, motorSignal,
  contextId: 'test-only', targetId: null, objects: [], self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { heat } } });
const edge = (sample: Observation, state: BodyMotorSignalV1, edgeSequence: number): MotorEdgeV1 => ({
  version: 'MotorEdgeV1', edgeSequence, kind: state.state === 'held' ? 'press' : 'release', signal: state, succeeded: true,
  releaseReason: state.state === 'off' ? 'interval-complete' : null,
  clock: { observationSequence: sample.sequence, physicsTick: sample.physicalClock!.physicsTick,
    activeSeconds: sample.activeSeconds, monotonicMs: sample.physicalClock!.monotonicMs + 1 } });
const passive = (frames: Observation[], id: string): RealEvent => ({ version: 'RealEventV5', id, frames,
  cue: { kind: 'passive', parameters: { ticks: frames.length - 1 }, targetRole: null },
  trackedIds: ['self'], bodyResult: null, provenance: 'observed-passive', complete: true });
const semantic = (flow: ExperienceFrameFlow) => { const state = flow.live.current(); return { h: state.h, channels: state.channels,
  projection: state.projection, elapsed: state.elapsed, motor: state.motor, intervalMotor: state.intervalMotor }; };

test('real frame flow joins same-frame release after the last held interval, before the next off interval', () => {
  const flow = new ExperienceFrameFlow(), queue = new PhysicalTelemetryQueue();
  const a = frame(0), b = frame(1, held), c = frame(2, held), d = frame(3);
  queue.push({ kind: 'frame', observation: a }); queue.push({ kind: 'motor-edge', edge: edge(a, held, 1) });
  queue.push({ kind: 'frame', observation: b }); queue.push({ kind: 'frame', observation: c });
  queue.push({ kind: 'motor-edge', edge: edge(c, off, 2) }); queue.push({ kind: 'frame', observation: d });
  flow.boundary(a, queue.takeThroughObservation(a));
  const lastHeld = flow.boundary(c, queue.takeThroughObservation(c));
  assert.equal(lastHeld.intervalMotor.state, 'held'); assert.equal(lastHeld.motor.state, 'held');
  const nextOff = flow.boundary(d, queue.takeThroughObservation(d));
  assert.equal(nextOff.intervalMotor.state, 'off'); assert.equal(nextOff.motor.state, 'off');
  assert.equal(lastHeld.motor.state, 'held', 'release never rewrites an earlier immutable real state');
  assert.equal(flow.stats.acceptedFrames, 4);
});

test('different original window packaging preserves actual recurrent history and original trace source', () => {
  const all = Array.from({ length: 11 }, (_, i) => frame(i, off, i < 3 ? 1 : 0));
  const one = new ExperienceFrameFlow(), split = new ExperienceFrameFlow();
  const whole = passive(all, 'same-stream:event-1'); const trace = one.window(whole)!;
  split.window(passive(all.slice(0, 6), 'split-stream:event-1'));
  split.window(passive(all.slice(5), 'split-stream:event-2'));
  assert.deepEqual(semantic(one), semantic(split)); assert.equal(trace.parentEventDigest, sha(whole));
  assert.equal(trace.states.length, all.length); assert.equal(one.stats.acceptedFrames, all.length);
  assert.equal(split.stats.acceptedFrames, all.length, 'shared frames do not add another activation update');
});

test('retired window states stay unavailable and cannot be recreated from later state', () => {
  const flow = new ExperienceFrameFlow(new ExperienceLiveState({ frameCapacity: 3 }));
  const all = Array.from({ length: 9 }, (_, i) => frame(i));
  for (const sample of all) flow.boundary(sample);
  const before = sha(flow.snapshot());
  assert.equal(flow.window(passive(all.slice(0, 3), 'past:event-1')), undefined);
  assert.equal(sha(flow.snapshot()), before); assert.equal(flow.stats.missingTraceWindows, 1);
  assert.throws(() => flow.boundary({ ...all[8]!, self: { ...all[8]!.self, pitch: .5 } }), /digest-conflict/);
});

test('a delivered frame gap remains visible and never acquires guessed elapsed time', () => {
  const flow = new ExperienceFrameFlow(); flow.boundary(frame(0));
  const batch: PhysicalTelemetryBatchV1 = { version: 'PhysicalTelemetryBatchV1', records: [], boundaryMissing: true,
    gap: { firstOrder: 1, lastOrder: 2, records: 2, frames: 2, motorEdges: 0, reason: 'payload-or-record-capacity' },
    receivedThroughOrder: 3, deliveredThroughOrder: 2, serializedPayloadBytes: 0,
    limits: { records: 2, serializedPayloadBytes: 1024 } };
  const state = flow.boundary(frame(4), batch);
  assert.equal(state.continuity, 'gap'); assert.deepEqual(state.elapsed, { kind: 'unknown', reason: 'gap' });
  assert.equal(flow.stats.telemetryGaps, 1); assert.equal(flow.stats.unavailableTelemetryBoundaries, 1);
});

test('same current scene with different actual histories is not collapsed by search identity', () => {
  const a = new ExperienceFrameFlow(), b = new ExperienceFrameFlow();
  for (let i = 0; i < 3; i++) { a.boundary(frame(i, off, 1)); b.boundary(frame(i, off, -1)); }
  const current = frame(3); const za = a.boundary(current), zb = b.boundary(current);
  assert.notEqual(experienceSearchKey(current, za), experienceSearchKey(current, zb));
  const c = new ExperienceFrameFlow(); for (let i = 0; i < 3; i++) c.boundary(frame(i, off, 1));
  assert.equal(experienceSearchKey(current, za), experienceSearchKey(current, c.boundary(current)),
    'different audit epochs do not multiply otherwise equivalent search states');
});

test('invalid full capture clock is rejected before live state and world publication', () => {
  const flow = new ExperienceFrameFlow(); flow.boundary(frame(0));
  const before = sha(flow.snapshot()), measured = frame(1);
  for (const clock of [
    { ...measured.physicalClock!, sample: 'terminal' as const },
    { ...measured.physicalClock!, monotonicMs: 900 },
    { ...measured.physicalClock!, secondsPerTick: .1 },
    { ...measured.physicalClock!, version: 'OtherClock' }
  ]) {
    let published = false;
    assert.throws(() => flow.boundary({ ...measured, physicalClock: clock } as Observation, undefined,
      () => { published = true; }), /invalid-live-source-clock/);
    assert.equal(published, false); assert.equal(sha(flow.snapshot()), before);
  }
});

test('a motor edge reported after the next capture cannot label an already completed interval', () => {
  const flow = new ExperienceFrameFlow(), queue = new PhysicalTelemetryQueue(), a = frame(0), b = frame(1, held);
  queue.push({ kind: 'frame', observation: a }); flow.boundary(a, queue.takeThroughObservation(a));
  const late = edge(a, held, 1);
  queue.push({ kind: 'motor-edge', edge: { ...late, clock: { ...late.clock, monotonicMs: b.physicalClock!.monotonicMs + 1 } } });
  queue.push({ kind: 'frame', observation: b });
  const before = sha(flow.snapshot());
  assert.throws(() => flow.boundary(b, queue.takeThroughObservation(b)), /outside-measured-interval/);
  assert.equal(sha(flow.snapshot()), before);
});

test('telemetry record order and motor edge sequence must progress across deliveries', () => {
  const a = frame(0), b = frame(1, held), c = frame(2), flow = new ExperienceFrameFlow(), queue = new PhysicalTelemetryQueue();
  queue.push({ kind: 'frame', observation: a }); flow.boundary(a, queue.takeThroughObservation(a));
  queue.push({ kind: 'motor-edge', edge: edge(a, held, 1) }); queue.push({ kind: 'frame', observation: b });
  flow.boundary(b, queue.takeThroughObservation(b));
  queue.push({ kind: 'motor-edge', edge: edge(b, off, 1) }); queue.push({ kind: 'frame', observation: c });
  assert.throws(() => flow.boundary(c, queue.takeThroughObservation(c)), /invalid-live-motor-edge/);
});
