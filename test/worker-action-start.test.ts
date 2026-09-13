import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, ActionCue, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import { ExperienceSession } from '../src/experience-session.js';
import type { ExperiencePrediction } from '../src/experience-medium.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';
import { MinecraftActionStartProtocol, type WorkerActionStartReceiptV1 } from '../src/adapters/minecraft/action-start.js';
import { MinecraftExperienceEnvironment } from '../src/adapters/minecraft/experience.js';

const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
const frame = (sequence: number): Observation => ({ sequence, activeSeconds: sequence / 20, contextId: 'worker-protocol-fixture',
  targetId: null, objects: [], self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { value: sequence } } });
const offer = (observation: Observation) => ({ version: 'ActionOfferV1' as const, offerId: 'port-' + observation.sequence,
  observationSequence: observation.sequence, action, cue: cueFor(action, observation) });
const passive = (before: Observation, after: Observation): RealEvent => ({ version: 'RealEventV5',
  id: 'protocol-passive:event-' + before.sequence, cue: { kind: 'passive', parameters: { ticks: after.sequence - before.sequence }, targetRole: null },
  frames: [before, after], trackedIds: ['self'], provenance: 'observed-passive', complete: true, bodyResult: null });
function fixture() {
  let current = frame(1), calls = 0;
  const pending: RealEvent[] = [], diagnostics: WorkerActionStartReceiptV1[] = [], order: string[] = [];
  const body = { latest: () => current, takePassiveEvents: () => pending.splice(0), execute: async (selected: Action) => {
    calls++; order.push('motor-' + current.sequence); const before = current; current = frame(before.sequence + 1);
    const result = { action: selected, executed: true, status: 'completed' as const, startSequence: before.sequence, endSequence: current.sequence };
    const event: RealEvent = { version: 'RealEventV5', id: 'protocol-motor:event-' + before.sequence, cue: cueFor(selected, before),
      frames: [before, current], trackedIds: ['self'], provenance: 'executed-real-body', complete: true, bodyResult: result };
    return { result, event, precedingPassiveEvents: pending.splice(0) };
  } };
  const protocol = new MinecraftActionStartProtocol(body, receipt => diagnostics.push(receipt));
  const connection = { latest: body.latest, synchronousActionStart: false,
    listActionOffers: (observation: Observation) => [offer(observation)],
    describeActionRequirement: () => ({ satisfied: true }) as never,
    takePassiveEvents: async () => protocol.drainPassiveEvents(),
    execute: async (selected: Action) => protocol.execute(selected),
    prepareActionStart: async () => protocol.prepareActionStart(),
    executePrepared: async (token: string, selected: Action) => protocol.executePrepared(token, selected),
    cancelActionStart: async (token: string, reason: string) => protocol.cancelActionStart(token, reason),
    waitForObservationAfter: async () => current };
  return { protocol, connection, body, order, diagnostics, environment: new MinecraftExperienceEnvironment(connection),
    get current() { return current; }, set current(value: Observation) { current = value; },
    get calls() { return calls; }, advance() { const before = current; current = frame(before.sequence + 1); pending.push(passive(before, current)); } };
}

test('the asynchronous adapter predicts from its prepared frame and atomically executes that exact frame once', async () => {
  const f = fixture(); f.advance(); const before = await f.environment.observe();
  const result = await f.environment.executeOffer(offer(before), start => {
    f.order.push('predict-' + start.observation.sequence); assert(start.bindingToken);
    assert.equal(start.precedingPassiveEvents.length, 1); return true;
  });
  assert.deepEqual(f.order, ['predict-2', 'motor-2']);
  assert.equal(result.executed, true); assert.equal(result.executionBinding?.status, 'accepted');
  assert.equal(result.event!.frames[0]!.sequence, 2); assert.equal(result.precedingPassiveEvents?.length, 1);
  assert.equal(f.diagnostics.at(-1)!.checkedAnonymousDigest, sha(result.event!.frames[0]!));
  const replay = await f.protocol.executePrepared(result.executionBinding!.token, action);
  assert.equal(replay.result.executed, false); assert.equal(f.calls, 1);
});

test('a frame advancing during prediction refuses one attempt and returns every passive interval', async () => {
  const f = fixture(); f.advance(); const before = await f.environment.observe();
  const result = await f.environment.executeOffer(offer(before), start => {
    assert.equal(start.observation.sequence, 2); f.advance(); return true;
  });
  assert.equal(result.executed, false); assert.equal(result.executionBinding?.reason, 'action-start-expired');
  assert.equal(f.calls, 0); assert.equal(result.event, null);
  assert.deepEqual(result.precedingPassiveEvents?.map(event => event.frames.map(frame => frame.sequence)), [[1, 2], [2, 3]]);
  assert.deepEqual(f.diagnostics.map(value => value.phase), ['prepared', 'refused']);
});

test('a controller veto cancels its token without issuing a motor or losing preparation-time passive evidence', async () => {
  const f = fixture(); f.advance(); const before = await f.environment.observe();
  const result = await f.environment.executeOffer(offer(before), () => false);
  assert.equal(result.executed, false); assert.equal(f.calls, 0);
  assert.equal(result.executionBinding?.status, 'cancelled'); assert.equal(result.precedingPassiveEvents?.length, 1);
  const replay = await f.protocol.executePrepared(result.executionBinding!.token, action);
  assert.equal(replay.actionStartReceipt.reason, 'unknown-action-start-token'); assert.equal(f.calls, 0);
});

test('full-frame comparison rejects changed sensations with the same sequence', async () => {
  const f = fixture(), prepared = f.protocol.prepareActionStart();
  f.current = { ...f.current, sensation: { version: 'AnonymousRGBD1', width: 1, height: 1,
    horizontalFov: 1, verticalFov: 1, range: 8, samples: [.1, .2, .3, 4] } };
  const result = await f.protocol.executePrepared(prepared.token, action);
  assert.equal(result.result.executed, false); assert.equal(result.actionStartReceipt.reason, 'action-start-expired');
  assert.equal(f.calls, 0);
});

test('superseded and unprepared execution tokens cannot later execute, while their passive evidence remains available', async () => {
  const f = fixture(); f.advance(); const first = f.protocol.prepareActionStart(); f.advance();
  const second = f.protocol.prepareActionStart();
  assert.equal(second.precedingPassiveEvents.length, 2);
  assert.equal((await f.protocol.executePrepared(first.token, action)).result.executed, false);
  await f.protocol.execute(action);
  assert.equal((await f.protocol.executePrepared(second.token, action)).result.executed, false); assert.equal(f.calls, 1);
});

test('a failed motor consumes its token and preserves preparation evidence for a later drain', async t => {
  const f = fixture(); f.advance(); const prepared = f.protocol.prepareActionStart();
  t.mock.method(f.body, 'execute', async () => { throw new Error('measured-body-fault'); });
  await assert.rejects(f.protocol.executePrepared(prepared.token, action), /measured-body-fault/);
  assert.equal(f.protocol.drainPassiveEvents().length, 1);
  assert.equal((await f.protocol.executePrepared(prepared.token, action)).result.executed, false);
});

test('a preparation reply cannot be replaced with a newer controller cache frame', async () => {
  const f = fixture();
  f.connection.prepareActionStart = async () => {
    const prepared = f.protocol.prepareActionStart(); f.advance(); return prepared;
  };
  const result = await f.environment.executeOffer(offer(f.current), start => {
    assert.equal(start.observation.sequence, 1); assert.equal(f.connection.latest().sequence, 2); return true;
  });
  assert.equal(result.executed, false); assert.equal(result.executionBinding?.reason, 'action-start-expired');
  assert.equal(f.calls, 0);
});

test('a throwing forecast cancels its token and preserves all passive intervals for the evidence drain', async () => {
  const f = fixture(); f.advance();
  await assert.rejects(f.environment.executeOffer(offer(f.current), () => {
    f.advance(); throw new Error('forecast-failed');
  }), /forecast-failed/);
  assert.equal(f.calls, 0); assert.equal(f.diagnostics.at(-1)!.phase, 'cancelled');
  const events = await f.environment.drainPassiveEvents();
  assert.deepEqual(events.map(event => event.frames.map(frame => frame.sequence)), [[1, 2], [2, 3]]);
  assert.deepEqual(await f.environment.drainPassiveEvents(), []);
  assert.equal((await f.protocol.executePrepared(f.diagnostics[0]!.token, action)).result.executed, false);
});

test('session grants execution credit only to the prepared frame, while expiry learns only intervening passive evidence', async t => {
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'terminal', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'value', subject: { kind: 'self' }, observable: 'properties.value', comparator: 'greater-than', target: 20 } } };
  const forecast = (observation: Observation): ExperiencePrediction => ({ observation: { ...observation,
    self: { ...observation.self, properties: { value: Number(observation.self.properties.value) + 1 } } },
    accepted: true, reason: null, supportedFields: ['self/properties.value'], activationMargin: 1,
    prequentialAccuracy: 1, observedSamples: 10, settled: true });
  for (const expire of [false, true]) await t.test(expire ? 'expired' : 'accepted', async subtest => {
    const f = fixture(), session = new ExperienceSession(); session.submit(goal);
    subtest.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observed: Observation, offers: readonly ActionOfferV1[]) => {
      f.advance(); return { steps: [{ offer: offers[0], prediction: forecast(observed) }], expanded: 1, reason: 'predicted-progress' };
    });
    subtest.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observed: Observation) => {
      assert.equal(session.agent.medium.writes, 1); assert.equal(f.calls, 0);
      assert.equal(observed.sequence, 2); return forecast(observed);
    });
    if (expire) f.connection.executePrepared = async (token, selected) => {
      f.advance(); return f.protocol.executePrepared(token, selected);
    };
    const result = await session.step(f.environment, { exploration: false });
    assert.equal(result.status, expire ? 'refused' : 'executed');
    assert.equal(result.predictionFresh, !expire); assert.equal(result.predictionObservationSequence, 2);
    assert.equal(result.actionStartToken, f.diagnostics[0]!.token); assert.equal(typeof result.actionStartElapsedMs, 'number');
    assert.equal(session.stats.passiveWindows, expire ? 2 : 1); assert.equal(session.agent.medium.writes, 2);
    if (expire) {
      assert.equal(result.predictionInvalidation, 'action-start-expired'); assert.equal(result.prediction, undefined);
      assert.equal(result.forecastAdvanced ?? false, false); assert.equal(result.refuted ?? false, false);
    } else {
      assert.equal(result.prediction?.errors[0]?.expected, 3); assert.equal(result.prediction?.matched, 1);
      assert.equal(result.predictedSteps?.[0]?.offer.observationSequence, 2);
      assert.equal(result.predictedSteps?.[0]?.prediction.observation?.self.properties.value, 3);
    }
  });
});

test('passive evidence from after the accepted start is rejected before outcome learning', async t => {
  const f = fixture(), session = new ExperienceSession();
  const execute = f.connection.executePrepared;
  f.connection.executePrepared = async (token, selected) => {
    const receipt = await execute(token, selected);
    return { ...receipt, precedingPassiveEvents: [passive(frame(3), frame(4))] };
  };
  // Curiosity may choose the only measured motor; no task answer is supplied.
  await assert.rejects(session.step(f.environment), /passive-experience-does-not-precede-body-feedback/);
  assert.equal(session.agent.medium.writes, 0);
});

test('an unknown token cannot steal newer passive evidence ahead of a legitimate prepared window', async () => {
  const f = fixture(); f.advance(); const prepared = f.protocol.prepareActionStart(); f.advance();
  const unknown = await f.protocol.executePrepared('wrong-token', action);
  assert.deepEqual(unknown.precedingPassiveEvents, []);
  assert.deepEqual(f.protocol.cancelActionStart('wrong-token', 'controller-veto').precedingPassiveEvents, []);
  const own = await f.protocol.executePrepared(prepared.token, action);
  assert.equal(own.result.executed, false);
  assert.deepEqual(own.precedingPassiveEvents?.map(event => event.frames.map(frame => frame.sequence)), [[1, 2], [2, 3]]);
  assert.equal(f.calls, 0);
});

test('local preparation evidence remains retrievable after the worker and its cancellation RPC fail', async () => {
  const f = fixture(); f.advance();
  f.connection.cancelActionStart = async () => { throw new Error('worker-fatal'); };
  f.connection.takePassiveEvents = async () => { throw new Error('worker-fatal'); };
  await assert.rejects(f.environment.executeOffer(offer(f.current), () => false), /worker-fatal/);
  assert.equal((await f.environment.drainPassiveEvents()).length, 1);
  await assert.rejects(f.environment.drainPassiveEvents(), /worker-fatal/);
  assert.equal(f.calls, 0);
});

test('a diagnostic failure after token consumption preserves preparation evidence and prevents the motor', async t => {
  const f = fixture(); f.advance(); const prepared = f.protocol.prepareActionStart();
  t.mock.method(f.protocol, 'record', () => { throw new Error('diagnostic-channel-failed'); });
  await assert.rejects(f.protocol.executePrepared(prepared.token, action), /diagnostic-channel-failed/);
  assert.equal(f.protocol.drainPassiveEvents().length, 1); assert.equal(f.calls, 0);
});

test('frozen callbacks reject conflicting IDs before trusting or counting a passive batch', async () => {
  const f = fixture(), session = new ExperienceSession();
  const prepare = f.connection.prepareActionStart;
  f.connection.prepareActionStart = async () => {
    f.advance(); f.advance(); const prepared = await prepare();
    const events = prepared.precedingPassiveEvents;
    return { ...prepared, precedingPassiveEvents: [events[0]!, { ...events[1]!, id: events[0]!.id }] };
  };
  await assert.rejects(session.step(f.environment, { learn: false }), /event-id-conflict/);
  assert.equal(session.stats.passiveWindows, 0); assert.equal(session.agent.medium.writes, 0); assert.equal(f.calls, 0);
});
