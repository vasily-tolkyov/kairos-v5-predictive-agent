import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, ActionCue, Observation, PhysicalTelemetryBatchV1, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import type { ExperienceEnvironment, ExperiencePlan } from '../src/experience-agent.js';
import { ExperienceFrameFlow } from '../src/experience-frame-flow.js';
import { isActualLiveState, type LiveStateV1 } from '../src/experience-live-state.js';
import { ExperienceMedium, type ExperiencePrediction } from '../src/experience-medium.js';
import { ExperienceSession } from '../src/experience-session.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

// Software transport fixtures only: deliberately false forecasts exercise the
// controller's bookkeeping. They are not learned effects or native evidence.
const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
const frame = (sequence: number, health = 20): Observation => ({ sequence, activeSeconds: 1 + sequence * .05,
  contextId: 'session-live-apparatus', targetId: null, objects: [],
  physicalClock: { version: 'RealFrameClockV1', physicsTick: sequence, secondsPerTick: .05,
    monotonicMs: 1000 + sequence * 50, sample: 'physics' },
  motorSignal: { version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state: 'unknown', cue: null },
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { health } } });
const offer = (observation: Observation): ActionOfferV1 => ({ version: 'ActionOfferV1',
  offerId: 'hotbar-control', observationSequence: observation.sequence, action, cue: cueFor(action, observation) });
const forecast = (observation: Observation): ExperiencePrediction => ({ accepted: true, reason: null,
  observation: { ...observation, predictionSupport: ['self/position.0'],
    self: { ...observation.self, position: [1, 0, 0] } },
  supportedFields: ['self/position.0'], activationMargin: 1, prequentialAccuracy: 1, observedSamples: 20, settled: true });
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'fixture-x', expression: { kind: 'predicate',
  predicate: { version: 'GoalPredicateV1', id: 'fixture-terminal', subject: { kind: 'self' },
    observable: 'position.0', comparator: 'greater-than', target: 2 } } };
function passive(frames: readonly Observation[]): RealEvent {
  return { version: 'RealEventV5', id: 'session-live-passive:event-' + frames[0]!.sequence,
    cue: { kind: 'passive', parameters: { ticks: frames.length - 1 }, targetRole: null }, frames,
    trackedIds: ['self'], provenance: 'observed-passive', bodyResult: null, complete: true };
}
function active(frames: readonly Observation[]): RealEvent {
  const first = frames[0]!, last = frames.at(-1)!;
  return { version: 'RealEventV5', id: 'session-live-active:event-' + first.sequence,
    cue: cueFor(action, first), frames, trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: first.sequence, endSequence: last.sequence } };
}
function fixture(initial: readonly Observation[]) {
  const frames = [...initial], pending: RealEvent[] = [];
  let current = frames.at(-1)!, delivered = -1;
  const telemetry = (boundary: Observation): PhysicalTelemetryBatchV1 => {
    const missing = boundary.sequence < delivered;
    const records = frames.filter(value => value.sequence > delivered && value.sequence <= boundary.sequence)
      .map(observation => ({ kind: 'frame' as const, order: observation.sequence + 1,
        receivedMonotonicMs: observation.physicalClock!.monotonicMs + 10, observation }));
    if (records.length) delivered = records.at(-1)!.observation.sequence;
    return { version: 'PhysicalTelemetryBatchV1', records, gap: null,
      deliveredThroughOrder: delivered + 1, receivedThroughOrder: frames.at(-1)!.sequence + 1,
      serializedPayloadBytes: records.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value)), 0),
      limits: { records: 4096, serializedPayloadBytes: 64 * 1024 * 1024 }, ...(missing ? { boundaryMissing: true as const } : {}) };
  };
  const append = (...values: Observation[]) => { frames.push(...values); current = values.at(-1)!; };
  const environment: ExperienceEnvironment = {
    observe: async () => current, drainPassiveEvents: async () => pending.splice(0),
    takePhysicalTelemetryThrough: telemetry, listActionOffers: () => [],
    executeOffer: async () => { throw new Error('unexpected-fixture-motor'); },
    waitForObservationAfter: async () => current,
  };
  return { frames, pending, environment, append, get current() { return current; } };
}

test('frozen theta still assimilates every real passive and intervening frame exactly once', async t => {
  const source = Array.from({ length: 6 }, (_, index) => frame(index, index === 3 ? 7 : 20));
  const f = fixture(source), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  f.pending.push(passive(source.slice(0, 3)));
  const beforeTheta = sha(medium.snapshot()), beforeOffers = sha(session.agent.affordances.snapshot());
  const observe = t.mock.method(medium, 'observe');
  const result = await session.step(f.environment, { learn: false, exploration: false });
  assert.equal(result.status, 'no-offers'); assert.equal(observe.mock.callCount(), 0);
  assert.equal(sha(medium.snapshot()), beforeTheta); assert.equal(sha(session.agent.affordances.snapshot()), beforeOffers);
  assert.equal(session.stats.passiveWindows, 1); assert.equal(session.stats.passiveWrites, 0);
  const live = session.snapshot().live!;
  assert.equal(live.acceptedFrames, source.length); assert.equal(live.current.frame?.sequence, 5);
  assert.deepEqual(live.frames.map(value => value.key.sequence), [0, 1, 2, 3, 4, 5]);
  assert.notDeepEqual(live.frames[2]!.state.h, live.frames[3]!.state.h);
  assert.equal(session.world.stats.observations, source.length);
  await session.step(f.environment, { learn: false, exploration: false });
  assert.equal(session.liveStats()?.acceptedFrames, source.length, 'a shared boundary is not another physical frame');
  assert.equal(session.world.stats.observations, source.length);
});

test('a refuted motor in one real history is reconsidered at the same scene with a different history', async t => {
  const f = fixture([frame(0, 7), frame(1)]), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  session.submit(goal); f.environment.listActionOffers = observation => [offer(observation)];
  const planning: { offers: number; state: LiveStateV1 }[] = [], starts: LiveStateV1[] = [];
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation,
    offers: readonly ActionOfferV1[], limits: { state?: LiveStateV1 } = {}): ExperiencePlan => {
    assert(isActualLiveState(limits.state)); planning.push({ offers: offers.length, state: limits.state });
    return offers.length ? { steps: [{ offer: offers[0]!, prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' }
      : { steps: [], expanded: 0, reason: 'search-exhausted' };
  });
  t.mock.method(medium, 'predict', (_cue: ActionCue, observation: Observation, options: { state?: LiveStateV1 } = {}) => {
    assert(isActualLiveState(options.state)); starts.push(options.state); return forecast(observation);
  });
  f.environment.executeOffer = async (_offered, beforeExecute) => {
    const before = f.current, rebound = offer(before);
    assert.equal(beforeExecute?.({ observation: before, offer: rebound, availableOffers: [rebound], precedingPassiveEvents: [] }), true);
    f.append(frame(before.sequence + 1));
    return { executed: true, observation: f.current, event: active([before, f.current]), availableOffers: [rebound] };
  };
  const first = await session.step(f.environment, { learn: false, exploration: false });
  assert.equal(first.status, 'executed'); assert.equal(first.refuted, true);
  f.append(frame(3, 2), frame(4));
  const second = await session.step(f.environment, { learn: false, exploration: false });
  assert.equal(second.status, 'executed'); assert.equal(second.withdrawnPlanningOffers, 0);
  assert.deepEqual(planning.map(value => value.offers), [1, 1]);
  assert.notDeepEqual(planning[0]!.state.h, planning[1]!.state.h);
  assert.notEqual(first.stateKey, second.stateKey);
  assert.equal(starts[0]!.frame?.sequence, 1); assert.equal(starts[1]!.frame?.sequence, 4);
  assert.equal(medium.writes, 0);
});

test('retired passive traces do not fall back to learning the legacy whole window', async t => {
  const source = Array.from({ length: 514 }, (_, index) => frame(index));
  const f = fixture(source), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  const observe = t.mock.method(medium, 'observe');
  await session.step(f.environment, { learn: false, exploration: false });
  assert.equal(session.snapshot().live!.frames[0]!.key.sequence, 2);
  f.pending.push(passive(source.slice(0, 2)));
  const before = sha(medium.snapshot());
  await session.step(f.environment, { learn: true, exploration: false });
  assert.equal(session.liveStats()?.missingTraceWindows, 1);
  assert.equal(observe.mock.callCount(), 0, 'missing before-z must not delete the trace option and train legacy dynamics');
  assert.equal(sha(medium.snapshot()), before); assert.equal(session.stats.passiveWrites, 0);
  assert.equal(session.stats.passiveWindows, 1, 'the observed source window is still counted');
});

test('an active window longer than the live ring remains observed without a legacy training fallback', async t => {
  const f = fixture([frame(0)]), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  session.submit(goal); f.environment.listActionOffers = observation => [offer(observation)];
  const observe = t.mock.method(medium, 'observe');
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) =>
    ({ steps: [{ offer: offers[0]!, prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' }));
  t.mock.method(medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation));
  f.environment.executeOffer = async (_offered, beforeExecute) => {
    const before = f.current, rebound = offer(before);
    assert.equal(beforeExecute?.({ observation: before, offer: rebound, availableOffers: [rebound], precedingPassiveEvents: [] }), true);
    f.append(...Array.from({ length: 513 }, (_, index) => frame(index + 1)));
    return { executed: true, observation: f.current, event: active(f.frames), availableOffers: [rebound] };
  };
  const before = sha(medium.snapshot());
  const decision = await session.step(f.environment, { learn: true, exploration: false });
  assert.equal(decision.status, 'executed'); assert.equal(decision.learned, false);
  assert.equal(session.liveStats()?.acceptedFrames, 514); assert.equal(session.liveStats()?.missingTraceWindows, 1);
  assert.equal(observe.mock.callCount(), 0); assert.equal(sha(medium.snapshot()), before);
});

test('whole-window packaging does not retrospectively upgrade a previously unknown live motor interval', () => {
  const frames = [frame(0), frame(1), frame(2)], event = passive(frames);
  const direct = new ExperienceFrameFlow(), split = new ExperienceFrameFlow();
  const a = direct.window(event)!;
  split.boundary(frames[0]!); split.boundary(frames[1]!); const b = split.window(event)!;
  for (let index = 0; index < frames.length; index++) {
    assert.deepEqual(a.states[index]!.h, b.states[index]!.h);
    assert.deepEqual(a.states[index]!.channels, b.states[index]!.channels);
    assert.equal(a.states[index]!.intervalMotor.state, 'unknown');
  }
});
