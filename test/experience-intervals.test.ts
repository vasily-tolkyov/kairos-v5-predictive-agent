import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, MotorClockV1, MotorReceiptV1, Observation, RealEvent } from '../src/contracts.js';
import { extractExperienceIntervals } from '../src/experience-intervals.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

const frame = (sequence: number, physicsTick: number, terminal = false): Observation => ({
  sequence, activeSeconds: sequence / 20, contextId: 'interval-apparatus', targetId: null, objects: [],
  physicalClock: { version: 'RealFrameClockV1', physicsTick, secondsPerTick: .05,
    monotonicMs: 1000 + (sequence - 100) * 50, sample: terminal ? 'terminal' : 'physics' },
  self: { position: [0, 0, -physicsTick / 10], yaw: 0, pitch: 0, properties: { health: terminal ? 0 : 20 } } });
const edge = (value: Observation): MotorClockV1 => ({ observationSequence: value.sequence,
  physicsTick: value.physicalClock!.physicsTick, activeSeconds: value.activeSeconds,
  monotonicMs: value.physicalClock!.monotonicMs + 1 });
function held({ actual = 4, requested = 4, settling = 2, death = false } = {}): RealEvent {
  const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: requested } };
  const frames = Array.from({ length: actual + settling + 1 }, (_, i) => frame(100 + i, 20 + i));
  if (death) frames.push(frame(100 + actual + settling + 1, 20 + actual + settling, true));
  const first = frames[0]!, last = frames.at(-1)!, pressedAt = edge(first),
    releasedAt = edge(death ? last : frames[actual]!);
  const motorReceipt: MotorReceiptV1 = { version: 'MotorReceiptV1', requestedTicks: requested,
    durationParameter: 'ticks', requestedAt: pressedAt, pressedAt, releasedAt,
    pressSucceeded: true, releaseSucceeded: true, actualTicks: actual, actualSeconds: actual * .05,
    elapsedMonotonicMs: releasedAt.monotonicMs - pressedAt.monotonicMs,
    observedIntervals: releasedAt.observationSequence - pressedAt.observationSequence,
    frameRange: { startSequence: pressedAt.observationSequence, endSequence: releasedAt.observationSequence },
    releaseReason: death ? 'death' : 'interval-complete' };
  return { version: 'RealEventV5', id: 'interval-hold:event-1', cue: cueFor(action, first), frames,
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: first.sequence,
      endSequence: last.sequence, terminationReason: death ? 'body-interrupted' : 'stable', motorReceipt } };
}
const passive = (frames: readonly Observation[], id = 'interval-passive:event-1'): RealEvent => ({
  version: 'RealEventV5', id, cue: { kind: 'passive', parameters: { ticks: frames.length - 1 }, targetRole: null },
  frames, trackedIds: ['self'], bodyResult: null, provenance: 'observed-passive', complete: true });

test('source intervals keep the last held tick and separate motor-off settling', () => {
  const event = held(), digest = sha(event), batch = extractExperienceIntervals(event);
  assert.equal(batch.clockStatus, 'verified'); assert.equal(batch.parentEventDigest, digest);
  assert.equal(batch.transitions.length, 6);
  assert.deepEqual(batch.transitions.map(row => row.kind === 'dynamics' ? row.motor.state : row.kind),
    ['held', 'held', 'held', 'held', 'off', 'off']);
  assert(batch.transitions.every(row => row.deltaTicks === 1 && row.deltaSeconds === .05));
  assert.equal(batch.transitions[3]!.afterFrameIndex, 4, 'release frame still belongs to the held interval');
  assert.equal(batch.transitions[4]!.beforeFrameIndex, 4, 'motor-off exposure begins after the release frame');
  assert.equal(sha(event), digest, 'extraction does not rewrite the original receipt, frames or request');
});

test('an interrupted hold uses actual edges while terminal sensing has zero physical duration', () => {
  const event = held({ requested: 20, actual: 2, settling: 0, death: true });
  const batch = extractExperienceIntervals(event);
  assert.deepEqual(batch.transitions.map(row => row.kind), ['dynamics', 'dynamics', 'assimilation-only']);
  for (const row of batch.transitions.slice(0, 2)) {
    assert(row.kind === 'dynamics' && row.motor.state === 'held');
    assert.deepEqual(row.motor.signal, { kind: 'move', parameters: { direction: 'forward' } });
    assert.equal(row.deltaTicks, 1); assert.equal(row.deltaSeconds, .05);
  }
  const terminal = batch.transitions.at(-1)!;
  assert.equal(terminal.deltaTicks, 0); assert.equal(terminal.deltaSeconds, 0);
  assert.equal('motor' in terminal, false, 'terminal health assimilation is not another dynamics label');
  assert.equal(event.cue.parameters.ticks, 20, 'the original request remains unchanged');
});

test('early held inputs do not contain the future whole-window interruption duration', () => {
  const complete = extractExperienceIntervals(held()), interrupted = extractExperienceIntervals(
    held({ requested: 20, actual: 2, settling: 0, death: true }));
  const a = complete.transitions[0]!, b = interrupted.transitions[0]!;
  assert(a.kind === 'dynamics' && b.kind === 'dynamics');
  assert.deepEqual(a.motor, b.motor); assert.equal(a.deltaSeconds, b.deltaSeconds);
});

test('a zero-duration interrupted press produces no dynamics row or independent evidence', () => {
  const batch = extractExperienceIntervals(held({ requested: 20, actual: 0, settling: 0, death: true }));
  assert.equal(batch.transitions.length, 1); assert.equal(batch.transitions[0]!.kind, 'assimilation-only');
  assert.equal(batch.learningWrites, 0); assert.equal(batch.newIndependentCalibrationWindows, 0);
});

test('every adjacent row retains exactly one original parent calibration identity and compact indices', () => {
  const event = held(), batch = extractExperienceIntervals(event);
  assert.deepEqual([...new Set(batch.transitions.map(row => row.parentWindowId))], [event.id]);
  assert.deepEqual([...new Set(batch.transitions.map(row => row.parentEventDigest))], [sha(event)]);
  for (const [index, row] of batch.transitions.entries()) {
    assert.equal(row.beforeFrameIndex, index); assert.equal(row.afterFrameIndex, index + 1);
    assert.equal('id' in row, false); assert.equal('frames' in row, false); assert.equal('sensation' in row, false);
  }
  assert.equal('frames' in batch, false); assert.equal(batch.sourceFrameCount, event.frames.length);
  assert.deepEqual(extractExperienceIntervals(event), batch, 'repeat extraction does not create another observation identity');
});

test('legacy receipts cannot manufacture intermediate physical timestamps', () => {
  const original = held();
  const event = { ...original, frames: original.frames.map(({ physicalClock: _clock, ...value }) => value) };
  const batch = extractExperienceIntervals(event);
  assert.equal(batch.clockStatus, 'missing');
  assert(batch.transitions.every(row => row.kind === 'untrainable' && row.reason === 'missing-physical-clock'
    && row.deltaTicks === null && row.deltaSeconds === null));
  assert.equal(batch.boundary.physicalClock, null);
});

test('partially instrumented windows never silently train their convenient subset', () => {
  const original = held();
  const event = { ...original, frames: original.frames.map((value, index) => {
    if (index !== 2) return value; const { physicalClock: _clock, ...legacy } = value; return legacy;
  }) };
  const batch = extractExperienceIntervals(event); assert.equal(batch.clockStatus, 'partial');
  assert(batch.transitions.every(row => row.kind === 'untrainable' && row.reason === 'partial-physical-clock'));
});

test('observed passive provenance supplies motor-off intervals without fabricated hold receipts', () => {
  const event = passive([frame(100, 20), frame(101, 21), frame(102, 22)]);
  const batch = extractExperienceIntervals(event);
  assert(batch.transitions.every(row => row.kind === 'dynamics' && row.motor.state === 'off'
    && row.motor.basis === 'observed-passive'));
  assert.equal(event.bodyResult, null);
});

test('impulse actions with physical clocks but no verified motor edges remain untrainable', () => {
  const frames = [frame(100, 20), frame(101, 21)], action: Action = {
    kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } };
  const event: RealEvent = { version: 'RealEventV5', id: 'interval-look:event-1', frames,
    cue: cueFor(action, frames[0]!), trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 100, endSequence: 101 } };
  const batch = extractExperienceIntervals(event), row = batch.transitions[0]!;
  assert.equal(batch.clockStatus, 'verified'); assert.equal(row.deltaSeconds, .05);
  assert(row.kind === 'untrainable' && row.reason === 'unknown-motor-edges');
});

test('terminal passive sensing assimilates a changed body without claiming another physical step', () => {
  const batch = extractExperienceIntervals(passive([frame(100, 20), frame(101, 20, true)]));
  assert.equal(batch.transitions[0]!.kind, 'assimilation-only'); assert.equal(batch.transitions[0]!.deltaSeconds, 0);
});

test('shared boundaries accept the same original frame and reject conflicting values or skipped frames', () => {
  const a = frame(100, 20), boundary = frame(101, 21), next = frame(102, 22);
  const previous = extractExperienceIntervals(passive([a, boundary]));
  const event = passive([boundary, next], 'interval-passive:event-2');
  assert.equal(extractExperienceIntervals(event, { previousBoundary: previous.boundary }).transitions.length, 1);
  const changed = { ...boundary, self: { ...boundary.self, yaw: .1 } };
  assert.throws(() => extractExperienceIntervals({ ...event, frames: [changed, next] },
    { previousBoundary: previous.boundary }), /conflicting-experience-shared-frame/);
  assert.throws(() => extractExperienceIntervals(passive([next, frame(103, 23)]),
    { previousBoundary: previous.boundary }), /shared-frame-gap-or-backward/);
  assert.throws(() => extractExperienceIntervals(event, { previousBoundary: { ...previous.boundary,
    physicalClock: { ...previous.boundary.physicalClock!, physicsTick: 999 } } }), /conflicting-experience-shared-clock/);
});

test('backward physical clocks, conflicting terminal clocks and receipt/frame disagreements are rejected', () => {
  assert.throws(() => extractExperienceIntervals(passive([frame(100, 20), frame(101, 19)])), /physical-clock/);
  assert.throws(() => extractExperienceIntervals(passive([frame(100, 20), frame(101, 21, true)])), /clock/);
  const earlier = frame(100, 20), later = frame(101, 21);
  assert.throws(() => extractExperienceIntervals(passive([earlier, { ...later,
    physicalClock: { ...later.physicalClock!, monotonicMs: earlier.physicalClock!.monotonicMs - 1 } }])), /physical-clock/);
  const original = held(), receipt = original.bodyResult!.motorReceipt!;
  const moved = (clock: MotorClockV1) => ({ ...clock, physicsTick: clock.physicsTick + 100 });
  assert.throws(() => extractExperienceIntervals({ ...original, bodyResult: { ...original.bodyResult!, motorReceipt: {
    ...receipt, requestedAt: moved(receipt.requestedAt), pressedAt: moved(receipt.pressedAt), releasedAt: moved(receipt.releasedAt) } } }), /clock|receipt/);
});

test('duplicate frames, imagined state and motor provenance disguised as passive are rejected', () => {
  const a = frame(100, 20), b = frame(101, 21);
  assert.throws(() => extractExperienceIntervals(passive([a, a])), /observation-gap/);
  assert.throws(() => extractExperienceIntervals(passive([a, { ...b, predictionSupport: [] }])), /imagined/);
  assert.throws(() => extractExperienceIntervals({ ...held(), provenance: 'observed-passive' }), /invalid-motor-receipt/);
});

test('sampled controls agree with actual receipt intervals, including the release capture', () => {
  const original = held();
  const event: RealEvent = { ...original, frames: original.frames.map((value, index) => ({ ...value,
    motorSignal: index >= 1 && index <= 4 ? { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls',
      state: 'held', cue: { ...original.cue, targetRole: null } } : {
      version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state: 'off', cue: null } })) };
  assert.equal(extractExperienceIntervals(event).transitions.length, 6);
  assert.throws(() => extractExperienceIntervals({ ...event, frames: event.frames.map((value, index) => index !== 4
    ? value : { ...value, motorSignal: { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls',
      state: 'off', cue: null } }) }), /sampled-motor-conflict/);
  assert.throws(() => extractExperienceIntervals({ ...event, frames: event.frames.map((value, index) => index !== 1
    ? value : { ...value, motorSignal: { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls',
      state: 'held', cue: { ...original.cue, parameters: { direction: 'back', ticks: 4 } } } }) }), /sampled-motor-conflict/);
});
