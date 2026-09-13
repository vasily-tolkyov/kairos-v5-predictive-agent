import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, ActionCue, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import type { ExperienceEnvironment } from '../src/experience-agent.js';
import { MinecraftExperienceEnvironment } from '../src/adapters/minecraft/experience.js';
import { ExperienceSession } from '../src/experience-session.js';
import { ExperienceMedium, type ExperiencePrediction } from '../src/experience-medium.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
const frame = (sequence: number, x: number): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'action-start-apparatus', targetId: null, objects: [],
  self: { position: [x, 0, 0], yaw: 0, pitch: 0, properties: {} } });
const offerFor = (observation: Observation): ActionOfferV1 => ({ version: 'ActionOfferV1',
  offerId: 'motor-' + observation.sequence, observationSequence: observation.sequence, action, cue: cueFor(action, observation) });
const forecast = (observation: Observation, accepted = true): ExperiencePrediction => ({
  observation: { ...observation, self: { ...observation.self, position: [observation.self.position[0] + 1, 0, 0] } },
  accepted, reason: accepted ? null : 'unknown-context', supportedFields: accepted ? ['self/position.0'] : [],
  activationMargin: accepted ? 1 : 0, prequentialAccuracy: 1, observedSamples: 20, settled: true });
const window = (before: Observation, after: Observation): RealEvent => ({ version: 'RealEventV5',
  id: 'action-start-motor:event-' + before.sequence, cue: cueFor(action, before), frames: [before, after],
  trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
  bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } });
const passiveWindow = (before: Observation, after: Observation): RealEvent => ({ ...window(before, after),
  id: 'action-start-passive:event-' + before.sequence, cue: { kind: 'passive', parameters: { ticks: after.sequence - before.sequence }, targetRole: null },
  bodyResult: null, provenance: 'observed-passive' });
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'terminal', expression: { kind: 'predicate',
  predicate: { version: 'GoalPredicateV1', id: 'x', subject: { kind: 'self' }, observable: 'position.0',
    comparator: 'greater-than', target: 20 } } };

function apparatus() {
  let current = frame(1, 0), calls = 0;
  const order: string[] = [], pending: RealEvent[] = [];
  const body = { synchronousActionStart: true, latest: () => current,
    listActionOffers: (observed: Observation) => [offerFor(observed)],
    describeActionRequirement: () => ({ satisfied: true }) as never,
    takePassiveEvents: () => pending.splice(0),
    execute: async () => {
      calls++; order.push('motor'); const before = current;
      current = frame(before.sequence + 1, before.self.position[0] + 1);
      const event = window(before, current);
      return { result: event.bodyResult!, event };
    }, waitForObservationAfter: async () => current };
  const environment = new MinecraftExperienceEnvironment(body);
  return { environment, body, order, pending, get calls() { return calls; },
    get current() { return current; }, set current(value: Observation) { current = value; } };
}

test('the adapter binds a fresh synchronous forecast before the physical motor and honors a veto', async () => {
  const fixture = apparatus(), earlier = await fixture.environment.observe();
  const selected = fixture.environment.listActionOffers(earlier)[0]!;
  fixture.current = frame(2, 10);
  const refused = await fixture.environment.executeOffer(selected, start => {
    fixture.order.push('forecast'); assert.equal(start.observation.sequence, 2);
    assert.equal(start.offer.observationSequence, 2);
    assert(start.availableOffers.every(offer => offer.observationSequence === 2));
    return false;
  });
  assert.equal(refused.executed, false); assert.equal(fixture.calls, 0);
  const executed = await fixture.environment.executeOffer(selected, start => {
    fixture.order.push('forecast'); assert.equal(start.observation.self.position[0], 10); return true;
  });
  assert.equal(executed.event?.frames[0]!.sequence, 2);
  assert.deepEqual(fixture.order, ['forecast', 'forecast', 'motor']);
});

test('session comparisons and recorded first predictions use the action-start frame, before outcome learning', async t => {
  const fixture = apparatus(), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  session.submit(goal);
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
    fixture.current = frame(2, 10);
    return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
  });
  t.mock.method(medium, 'predict', (_cue: ActionCue, observation: Observation) => {
    fixture.order.push('predict-' + observation.sequence);
    assert.equal(fixture.calls, 0, 'the outcome cannot be consulted to repair an earlier forecast');
    return forecast(observation);
  });
  const digest = sha(medium.snapshot());
  const result = await session.step(fixture.environment, { learn: false, exploration: false });
  assert.equal(result.prediction?.errors[0]?.expected, 11);
  assert.equal(result.prediction?.matched, 1); assert.equal(result.forecastAdvanced, true);
  assert.equal(result.planningObservationSequence, 1); assert.equal(result.predictionObservationSequence, 2);
  assert.equal(result.predictionFresh, true); assert.equal(result.actionStartLatencyFrames, 1);
  assert.equal(result.predictedSteps?.[0]?.prediction.observation?.self.position[0], 11);
  assert.equal(result.predictedSteps?.[0]?.offer.observationSequence, 2);
  assert.deepEqual(fixture.order, ['predict-2', 'motor']);
  assert.equal(sha(medium.snapshot()), digest, 'the new forecast is a read-only query');
});

test('preceding passive evidence is consumed once before the fresh forecast, then the action is learned', async t => {
  const fixture = apparatus(), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  session.submit(goal);
  const originalObserve = medium.observe.bind(medium);
  t.mock.method(medium, 'observe', (event: RealEvent) => {
    fixture.order.push(event.provenance === 'observed-passive' ? 'passive-learn' : 'motor-learn');
    return originalObserve(event);
  });
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
    fixture.current = frame(2, 10);
    fixture.pending.push({ ...window(observation, fixture.current), id: 'action-start-passive:event-2',
      cue: { kind: 'passive', parameters: { ticks: 1 }, targetRole: null }, bodyResult: null, provenance: 'observed-passive' });
    return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
  });
  t.mock.method(medium, 'predict', (_cue: ActionCue, observation: Observation) => {
    fixture.order.push('fresh-predict'); assert.equal(medium.writes, 1); return forecast(observation);
  });
  await session.step(fixture.environment, { exploration: false });
  assert.deepEqual(fixture.order, ['passive-learn', 'fresh-predict', 'motor', 'motor-learn']);
  assert.equal(session.stats.passiveWindows, 1); assert.equal(session.stats.passiveWrites, 1);
  assert.equal(medium.writes, 2);
});

test('one per-step ledger deduplicates initial, pre-preparation, callback and receipt exposure even when frozen', async t => {
  for (const learn of [true, false]) await t.test(learn ? 'online' : 'frozen', async t => {
    const f = apparatus(), session = new ExperienceSession(); session.submit(goal);
    const first = passiveWindow(frame(0, -1), frame(1, 0)), second = passiveWindow(frame(1, 0), frame(2, 1));
    const third = passiveWindow(frame(2, 1), frame(3, 2));
    let drains = 0, plans = 0;
    t.mock.method(f.body, 'takePassiveEvents', () => {
      drains++;
      if (drains === 1) return [first];
      if (drains === 2) return [first, second, second];
      assert.equal(drains, 3); f.current = frame(3, 2); return [first, second, third, third];
    });
    t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
      plans++; f.current = frame(2, 1);
      return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
    });
    t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation) => {
      assert.equal(session.stats.passiveWindows, 3); assert.equal(f.calls, 0); return forecast(observation);
    });
    const original = session.agent.medium.observe.bind(session.agent.medium), learnedIds: string[] = [];
    t.mock.method(session.agent.medium, 'observe', (event: RealEvent) => { learnedIds.push(event.id); return original(event); });
    const digest = sha(session.agent.medium.snapshot()), result = await session.step(f.environment, { learn, exploration: false });
    assert.equal(result.status, 'executed'); assert.equal(plans, 1); assert.equal(drains, 3); assert.equal(f.calls, 1);
    assert.equal(session.stats.passiveWindows, 3); assert.equal(session.stats.passiveWrites, learn ? 3 : 0);
    assert.equal(session.stats.writes, learn ? 4 : 0);
    assert.deepEqual(learnedIds, learn ? [first.id, second.id, third.id, 'action-start-motor:event-3'] : []);
    if (!learn) assert.equal(sha(session.agent.medium.snapshot()), digest);
    assert.equal(result.prePreparationPassive?.receivedWindows, 3); assert.equal(result.prePreparationPassive?.uniqueWindows, 1);
    assert.equal(result.prePreparationPassive?.learnedWindows, learn ? 1 : 0); assert.equal(result.prePreparationPassive?.boundarySequence, 2);
    assert(Object.values(result.prePreparationPassive!.timingsMs).every(value => Number.isFinite(value) && value >= 0));
  });
});

test('conflicting passive IDs across preparation phases are rejected without counting or learning the conflicting batch', async t => {
  for (const phase of ['drain', 'callback', 'receipt'] as const) for (const learn of [true, false])
    await t.test(phase + (learn ? '-online' : '-frozen'), async t => {
      const f = apparatus(), session = new ExperienceSession(); session.submit(goal);
      const event = passiveWindow(frame(1, 0), frame(2, 1));
      const conflict = { ...event, frames: [event.frames[0]!, frame(2, 99)] };
      let drains = 0;
      t.mock.method(f.environment, 'drainPassiveEvents', async () => ++drains === 1 ? [] : phase === 'drain' ? [event, conflict] : [event]);
      t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
        f.current = frame(2, 1); return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
      });
      t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation));
      if (phase === 'callback') t.mock.method(f.body, 'takePassiveEvents', () => [conflict]);
      if (phase === 'receipt') {
        const execute = f.environment.executeOffer.bind(f.environment);
        t.mock.method(f.environment, 'executeOffer', async (...args: Parameters<typeof execute>) => ({ ...await execute(...args), precedingPassiveEvents: [conflict] }));
      }
      const digest = sha(session.agent.medium.snapshot());
      await assert.rejects(session.step(f.environment, { learn, exploration: false }), /event-id-conflict/);
      assert.equal(f.calls, phase === 'receipt' ? 1 : 0);
      assert.equal(session.stats.passiveWindows, phase === 'drain' ? 0 : 1);
      assert.equal(session.stats.writes, learn && phase !== 'drain' ? 1 : 0);
      if (!learn) assert.equal(sha(session.agent.medium.snapshot()), digest);
    });
});

test('frozen phase transitions reject future and backward passive intervals without executing a motor', async t => {
  for (const mode of ['future-drain', 'backward-callback', 'backward-start', 'imagined-boundary'] as const)
    await t.test(mode, async t => {
      const f = apparatus(), session = new ExperienceSession(); session.submit(goal);
      const event = passiveWindow(frame(1, 0), frame(2, 1)), future = passiveWindow(frame(2, 1), frame(3, 2));
      let drains = 0;
      t.mock.method(f.environment, 'drainPassiveEvents', async () => ++drains === 1 ? [] : mode === 'future-drain' ? [future] : [event]);
      t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
        f.current = { ...frame(2, 1), ...(mode === 'imagined-boundary' ? { predictionSupport: ['self/position.0'] } : {}) };
        return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
      });
      if (mode === 'backward-callback') t.mock.method(f.body, 'takePassiveEvents', () => [passiveWindow(frame(0, -1), frame(1, 0))]);
      if (mode === 'backward-start') t.mock.method(f.body, 'takePassiveEvents', () => { f.current = frame(1, 0); return []; });
      const digest = sha(session.agent.medium.snapshot());
      await assert.rejects(session.step(f.environment, { learn: false, exploration: false }),
        mode === 'imagined-boundary' ? /session-received-imagined-frame/ : mode === 'backward-start' ? /invalid-measured-action-start/ : /passive-experience-does-not-precede/);
      assert.equal(f.calls, 0); assert.equal(session.stats.writes, 0); assert.equal(sha(session.agent.medium.snapshot()), digest);
      assert.equal(session.stats.passiveWindows, mode === 'future-drain' || mode === 'imagined-boundary' ? 0 : 1);
    });
});

test('preparation-time learning can withdraw selected support and veto without replanning or another attempt', async t => {
  const f = apparatus(), session = new ExperienceSession(); session.submit(goal);
  let plans = 0, preparations = 0;
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
    plans++; f.current = frame(2, 1); f.pending.push(passiveWindow(observation, f.current));
    return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
  });
  const execute = f.environment.executeOffer.bind(f.environment);
  t.mock.method(f.environment, 'executeOffer', async (...args: Parameters<typeof execute>) => {
    preparations++; assert.equal(session.stats.writes, 1); return execute(...args);
  });
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation, false));
  const result = await session.step(f.environment, { exploration: false });
  assert.equal(result.status, 'refused'); assert.equal(result.predictionInvalidation, 'action-start-support-withdrawn');
  assert.equal(plans, 1); assert.equal(preparations, 1); assert.equal(f.calls, 0);
  assert.equal(result.prePreparationPassive?.uniqueWindows, 1); assert.equal(result.prePreparationPassive?.learnedWindows, 1);
  assert.equal(result.prediction, undefined); assert.equal(result.forecastAdvanced, undefined);
});

test('matching passive boundary sequences cannot hide conflicting full frames under different event IDs', async t => {
  for (const phase of ['within-drain', 'drain-boundary', 'callback-boundary', 'callback-window'] as const)
    await t.test(phase, async t => {
      const f = apparatus(), session = new ExperienceSession(); session.submit(goal);
      const first = passiveWindow(frame(1, 0), frame(2, 1));
      const changedFirst = passiveWindow(frame(2, 99), frame(3, 2));
      let drains = 0;
      t.mock.method(f.environment, 'drainPassiveEvents', async () => ++drains === 1 ? []
        : phase === 'within-drain' ? [first, changedFirst]
        : phase === 'drain-boundary' ? [{ ...first, frames: [first.frames[0]!, frame(2, 99)] }] : [first]);
      t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
        f.current = phase === 'within-drain' ? frame(3, 2) : frame(2, 1);
        return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
      });
      t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation));
      t.mock.method(f.body, 'takePassiveEvents', () => {
        if (phase.startsWith('callback')) f.current = phase === 'callback-window' ? frame(3, 2) : frame(2, 99);
        return phase === 'callback-window' ? [changedFirst] : [];
      });
      const digest = sha(session.agent.medium.snapshot());
      await assert.rejects(session.step(f.environment, { learn: false, exploration: false }), /passive-shared-frame-conflict/);
      assert.equal(f.calls, 0); assert.equal(session.stats.writes, 0); assert.equal(sha(session.agent.medium.snapshot()), digest);
      assert.equal(session.stats.passiveWindows, phase.startsWith('callback') ? 1 : 0);
    });
});

test('a previously supported plan is refused when its actual start context loses support', async t => {
  const fixture = apparatus(), medium = new ExperienceMedium(), session = new ExperienceSession(medium);
  session.submit(goal);
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
    fixture.current = frame(2, 10);
    return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
  });
  t.mock.method(medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation, false));
  const result = await session.step(fixture.environment, { learn: false, exploration: false });
  assert.equal(result.status, 'refused'); assert.equal(fixture.calls, 0);
  assert.equal(result.predictionInvalidation, 'action-start-support-withdrawn');
  assert.equal(result.prediction, undefined);
});

test('legacy delayed receipts cannot earn stale prediction, progress or local refutation credit', async t => {
  const session = new ExperienceSession(), before = frame(1, 0), start = frame(2, 1), after = frame(3, 1);
  session.submit(goal);
  t.mock.method(session.agent, 'plan', () => ({ steps: [{ offer: offerFor(before), prediction: forecast(before) }],
    expanded: 1, reason: 'predicted-progress' }));
  const result = await session.step({ observe: async () => before, listActionOffers: observed => [offerFor(observed)],
    waitForObservationAfter: async () => after,
    executeOffer: async () => ({ executed: true, observation: after, event: window(start, after) }) },
  { learn: false, exploration: false });
  assert.equal(result.prediction, undefined); assert.equal(result.predictionFresh, false);
  assert.equal(result.predictionInvalidation, 'action-start-changed-without-forecast');
  assert.equal(result.forecastAdvanced, false); assert.equal(result.refuted, false);
  assert.equal(result.measuredProgress, false); assert.equal(result.predictedSteps, undefined);
});

test('a fresh failed action is refuted in its actual starting context, independent of planning drift', async t => {
  const fixture = apparatus(), session = new ExperienceSession(); session.submit(goal);
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[]) => {
    fixture.current = frame(2, 10);
    return { steps: [{ offer: offers[0], prediction: forecast(observation) }], expanded: 1, reason: 'predicted-progress' };
  });
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation) => forecast(observation));
  t.mock.method(fixture.body, 'execute', async () => {
    const before = fixture.current, after = frame(before.sequence + 1, before.self.position[0]);
    fixture.current = after; const event = window(before, after); return { result: event.bodyResult!, event };
  });
  const result = await session.step(fixture.environment, { learn: false, exploration: false });
  assert.equal(result.prediction?.matched, 0); assert.equal(result.predictionFresh, true);
  assert.equal(result.refuted, true); assert.equal(result.forecastAdvanced, false);
});

test('a callback cannot certify a different actual action-start frame', async t => {
  const before = frame(1, 0), claimed = frame(2, 10), actual = frame(3, 20), after = frame(4, 21);
  const session = new ExperienceSession(); session.submit(goal);
  t.mock.method(session.agent, 'plan', () => ({ steps: [{ offer: offerFor(before), prediction: forecast(before) }],
    expanded: 1, reason: 'predicted-progress' }));
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observed: Observation) => forecast(observed));
  await assert.rejects(session.step({ observe: async () => before, listActionOffers: observed => [offerFor(observed)],
    waitForObservationAfter: async () => after, executeOffer: async (_offer, beforeExecute) => {
      beforeExecute?.({ observation: claimed, offer: offerFor(claimed), availableOffers: [offerFor(claimed)], precedingPassiveEvents: [] });
      return { executed: true, observation: after, event: window(actual, after) };
    } }, { learn: false, exploration: false }), /body-feedback-does-not-match-action-start-prediction/);
});

test('an asynchronous callback cannot authorize a motor across a scheduling gap', async () => {
  const fixture = apparatus(), before = await fixture.environment.observe();
  // JavaScript wrappers also cross this boundary; runtime refusal matters.
  // @ts-expect-error A Promise cannot certify a synchronous action start.
  const result = await fixture.environment.executeOffer(offerFor(before), async () => true);
  assert.equal(result.executed, false); assert.equal(fixture.calls, 0);
});

test('rebinding preserves a hypothesis as an untrusted probe after waiting-time drift', async t => {
  const fixture = apparatus(), session = new ExperienceSession(); session.submit(goal);
  t.mock.method(session.agent, 'plan', (_goal: GroundedGoalV1, observation: Observation,
    offers: readonly ActionOfferV1[], limits: { exploratory?: boolean }) => {
    if (!limits.exploratory) return { steps: [], expanded: 0, reason: 'unsupported' };
    fixture.current = frame(2, 10);
    return { steps: [{ offer: offers[0], prediction: { ...forecast(observation, false),
      hypothesizedFields: ['self/position.0'] } }], expanded: 1, reason: 'hypothetical-progress' };
  });
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, observation: Observation,
    options: { probe?: boolean; requestedFields?: readonly string[] }) => {
    assert.equal(options.probe, true); assert.deepEqual(options.requestedFields, ['self/position.0']);
    assert.equal(fixture.calls, 0);
    return { ...forecast(observation, false), hypothesizedFields: ['self/position.0'] };
  });
  const result = await session.step(fixture.environment, { learn: false });
  assert.equal(result.status, 'executed'); assert.equal(result.predictionFresh, true);
  assert.equal(result.prediction?.basis, 'hypothesized'); assert.equal(result.prediction?.matched, 1);
  assert.deepEqual(result.predictedSteps?.[0]?.prediction.supportedFields, []);
  assert.equal(result.predictedSteps?.[0]?.prediction.accepted, false);
});

test('a worker-shaped body keeps advancing across async passive drain without a false synchronous forecast', async () => {
  const fixture = apparatus(), earlier = await fixture.environment.observe();
  const environment = new MinecraftExperienceEnvironment({ ...fixture.body, synchronousActionStart: false,
    takePassiveEvents: async () => {
      await Promise.resolve(); fixture.current = frame(2, 10); return [];
    } });
  const result = await environment.executeOffer(offerFor(earlier), () => {
    throw new Error('an-IPC-body-cannot-certify-its-start-on-the-controller-thread');
  });
  assert.equal(result.executed, true); assert.equal(fixture.calls, 1);
  assert.equal(result.event?.frames[0]!.sequence, 2); assert.equal(result.observation.sequence, 3);
});

test('a changed retina invalidates a claimed action-start frame even when its sequence and body channels agree', async t => {
  const before = frame(1, 0), observed = { ...frame(2, 10), sensation: { version: 'AnonymousRGBD1' as const,
    width: 1, height: 1, horizontalFov: 1, verticalFov: 1, range: 8, samples: [.5, .5, .5, 1] } };
  const altered = { ...observed, sensation: { ...observed.sensation, samples: [.5, .5, .5, 5] } }, after = frame(3, 11);
  const session = new ExperienceSession(); session.submit(goal);
  t.mock.method(session.agent, 'plan', () => ({ steps: [{ offer: offerFor(before), prediction: forecast(before) }],
    expanded: 1, reason: 'predicted-progress' }));
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, input: Observation) => forecast(input));
  await assert.rejects(session.step({ observe: async () => before, listActionOffers: input => [offerFor(input)],
    waitForObservationAfter: async () => after, executeOffer: async (_offer, beforeExecute) => {
      beforeExecute?.({ observation: observed, offer: offerFor(observed), availableOffers: [offerFor(observed)], precedingPassiveEvents: [] });
      return { executed: true, observation: after, event: window(altered, after) };
    } }, { learn: false, exploration: false }), /body-feedback-does-not-match-action-start-prediction/);
});

test('a future passive window cannot train an allegedly pre-execution forecast', async t => {
  const before = frame(1, 0), start = frame(2, 10), after = frame(3, 11), session = new ExperienceSession();
  session.submit(goal);
  t.mock.method(session.agent, 'plan', () => ({ steps: [{ offer: offerFor(before), prediction: forecast(before) }],
    expanded: 1, reason: 'predicted-progress' }));
  const future: RealEvent = { ...window(start, after), bodyResult: null, provenance: 'observed-passive',
    cue: { kind: 'passive', parameters: { ticks: 1 }, targetRole: null } };
  await assert.rejects(session.step({ observe: async () => before, listActionOffers: input => [offerFor(input)],
    waitForObservationAfter: async () => after, executeOffer: async (_offer, beforeExecute) => {
      beforeExecute?.({ observation: start, offer: offerFor(start), availableOffers: [offerFor(start)], precedingPassiveEvents: [future] });
      throw new Error('the-future-window-must-be-refused-before-issuing-a-motor');
    } }, { exploration: false }), /passive-experience-does-not-precede-action-start/);
  assert.equal(session.agent.medium.writes, 0);
});

test('retransmitting consumed passive evidence under its old ID cannot hide changed content', async t => {
  const before = frame(1, 0), after = frame(2, 1), session = new ExperienceSession(); session.submit(goal);
  t.mock.method(session.agent, 'plan', () => ({ steps: [{ offer: offerFor(before), prediction: forecast(before) }],
    expanded: 1, reason: 'predicted-progress' }));
  t.mock.method(session.agent.medium, 'predict', (_cue: ActionCue, input: Observation) => forecast(input));
  const passive: RealEvent = { ...window(frame(0, 0), before), bodyResult: null, provenance: 'observed-passive',
    cue: { kind: 'passive', parameters: { ticks: 1 }, targetRole: null } };
  await assert.rejects(session.step({ observe: async () => before, listActionOffers: input => [offerFor(input)],
    waitForObservationAfter: async () => after, executeOffer: async (_offer, beforeExecute) => {
      beforeExecute?.({ observation: before, offer: offerFor(before), availableOffers: [offerFor(before)], precedingPassiveEvents: [passive] });
      return { executed: true, observation: after, event: window(before, after),
        precedingPassiveEvents: [{ ...passive, frames: [frame(0, 9), before] }] };
    } }, { exploration: false }), /event-id-conflict/);
  assert.equal(session.agent.medium.writes, 1, 'only the original preceding window was learned');
});
