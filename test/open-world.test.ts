import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import { ContextualReadout } from '../src/contextual-readout.js';
import { ExperienceMedium, motorIdentity } from '../src/experience-medium.js';
import { ExperienceLedger } from '../src/experience-ledger.js';
import { ExperienceWorld } from '../src/experience-world.js';
import { LearnedAffordances } from '../src/learned-affordances.js';
import { ExperienceAgent, compareExperiencePrediction } from '../src/experience-agent.js';
import { ExperienceSession } from '../src/experience-session.js';
import { cueFor, cueIdentity } from '../src/events.js';
import { sha } from '../src/util.js';

const frame = (properties: Observation['self']['properties'], sequence = 1): Observation => ({ sequence,
  activeSeconds: sequence / 20, contextId: 'unused-label', self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties },
  objects: [], targetId: null });
function real(action: Action, before: Observation, after: Observation, id = 'event-' + before.sequence): RealEvent {
  return { version: 'RealEventV5', id, cue: cueFor(action, before), frames: [before, after], trackedIds: ['self'],
    provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } };
}

test('bounded contextual learning retains opposing unrehearsed mechanisms and rejects missing context', () => {
  const memory = new ContextualReadout(64);
  const train = (context: number, n: number) => {
    for (let i = 0; i < n; i++) memory.observe('anonymous-port', { sensation: context, irrelevant: i % 3 },
      [['effect', 0, context ? -1 : 1]]);
  };
  train(0, 48); train(1, 320);
  const old = memory.read('anonymous-port', 'effect', { sensation: 0, irrelevant: 99 });
  const recent = memory.read('anonymous-port', 'effect', { sensation: 1 });
  assert(old?.supported); assert(recent?.supported); assert.equal(old.value, 1); assert.equal(recent.value, -1);
  assert.equal(memory.read('anonymous-port', 'effect', {}), null);
  assert.equal(memory.read('anonymous-port', 'effect', { sensation: 5 })?.supported, false);
  assert(memory.snapshot().circuits[0]![1].samples.length <= 64);
  const restored = ContextualReadout.restore(memory.snapshot());
  assert.deepEqual(restored.read('anonymous-port', 'effect', { sensation: 0 }), memory.read('anonymous-port', 'effect', { sensation: 0 }));
  memory.observe('anonymous-port', { sensation: 0 }, [['effect', 0, 1]]);
  restored.observe('anonymous-port', { sensation: 0 }, [['effect', 0, 1]]);
  assert.equal(sha(memory.snapshot()), sha(restored.snapshot()));
});

test('irreducible sensory noise does not become supported prediction or persistent learning progress', () => {
  const memory = new ContextualReadout(64);
  for (let i = 0; i < 256; i++) memory.observe('port', { fixed: 0 }, [['noise', 0, i % 2 ? 1 : -1]]);
  const value = memory.read('port', 'noise', { fixed: 0 })!;
  assert.equal(value.supported, false); assert(value.progress < .05);
});

test('incremental context fitting resumes exactly between split updates and immediately retains a contradiction', () => {
  let memory = new ContextualReadout(64);
  const write = (model: ContextualReadout, i: number) => model.observe('port', { depth: i % 3 },
    [['effect', 0, i % 3 === 2 ? 1 : 0]]);
  for (let i = 0; i < 35; i++) write(memory, i);
  let restored = ContextualReadout.restore(JSON.parse(JSON.stringify(memory.snapshot())));
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  for (let i = 35; i < 120; i++) {
    write(memory, i); write(restored, i);
    assert.deepEqual(restored.read('port', 'effect', { depth: 2 }), memory.read('port', 'effect', { depth: 2 }));
    if (i === 66) restored = ContextualReadout.restore(JSON.parse(JSON.stringify(restored.snapshot())));
  }
  assert.deepEqual(restored.snapshot(), memory.snapshot());
  assert(memory.read('port', 'effect', { depth: 2 })?.supported,
    'recent correct forecasts can establish a learned region despite early errors before its split');
  memory.observe('port', { depth: 2 }, [['effect', 0, -1]]);
  const changed = memory.read('port', 'effect', { depth: 2 })!;
  assert.equal(changed.supported, false);
  assert.deepEqual(changed.bounds?.delta, [-1, 1], 'the update cannot postpone an observed contrary outcome');
  const invalid = restored.snapshot();
  invalid.structures![0]![1][0]![1] = { kind: 'branch', key: 'depth', numeric: false,
    threshold: NaN, left: null, right: null };
  assert.throws(() => ContextualReadout.restore(invalid), /invalid-contextual-structure-checkpoint/);
});

test('a bounded repeated search eventually checks a useful measured response beyond its first action prefix', t => {
  const input = frame({ signal: 0 }, 1000), memory = new ExperienceMedium(41);
  const offers: ActionOfferV1[] = Array.from({ length: 9 }, (_, slot) => {
    const action: Action = { kind: 'select-hotbar', parameters: { slot } };
    return { version: 'ActionOfferV1' as const, offerId: String(slot), observationSequence: input.sequence, action, cue: cueFor(action, input) };
  }).sort((a, b) => cueIdentity(a.cue).localeCompare(cueIdentity(b.cue), 'en'));
  const helpful = offers.at(-1)!;
  for (const [i, offer] of offers.entries()) memory.observe(real(offer.action,
    frame({ signal: 0 }, i * 2 + 1), frame({ signal: Number(offer === helpful) }, i * 2 + 2)));
  const agent = new ExperienceAgent(memory), digest = sha(memory.snapshot());
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'remembered-change', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'properties.signal',
      comparator: 'greater-than', target: .5 } } };
  // A deterministic compute budget avoids making this scheduling regression
  // depend on the test machine's speed. The predictions themselves are real.
  let clock = 0; t.mock.method(performance, 'now', () => clock);
  const predict = memory.predict.bind(memory);
  t.mock.method(memory, 'predict', (...args: Parameters<ExperienceMedium['predict']>) => { clock++; return predict(...args); });
  let recalled = false;
  for (let attempt = 0; attempt < offers.length; attempt++) {
    const selected = agent.explore(input, offers, { goal, milliseconds: 2 });
    if (agent.lastExploration?.source === 'hypothesis') {
      assert.equal(selected?.offerId, helpful.offerId); recalled = true; break;
    }
  }
  assert(recalled, 'finite search repeatedly skipped an already measured useful response');
  assert.equal(sha(memory.snapshot()), digest, 'searching is not additional experience');
});

test('a question recalls a jointly measured response without choosing its desired outcome', () => {
  const memory = new ContextualReadout();
  memory.observe('port', { scene: 0 }, [['other', 0, 0]]);
  memory.observe('port', { scene: 2 }, [['late-measurement', 0, 1], ['side-effect', 0, -2]]);
  assert.equal(memory.recall('port', { scene: 0 })?.targets['late-measurement'], undefined);
  const queried = memory.recall('port', { scene: 0 }, ['late-measurement']);
  assert.deepEqual(queried?.targets['late-measurement'], [0, 1]);
  assert.deepEqual(queried?.targets['side-effect'], [0, -2]);
  memory.observe('port', { scene: .1 }, [['late-measurement', 0, -1], ['side-effect', 0, 2]]);
  const contrary = memory.recall('port', { scene: 0 }, ['late-measurement']);
  assert.deepEqual(contrary?.targets['late-measurement'], [0, -1]);
  assert.deepEqual(contrary?.targets['side-effect'], [0, 2]);
});

test('a newly measured channel can guide an untrusted probe despite closer episodes that never measured it', () => {
  const memory = new ExperienceMedium(41), motor: Action = { kind: 'select-hotbar', parameters: { slot: 5 } };
  const scene = (value: number) => ({ visual0: value, visual1: value, visual2: value, sideEffect: 0 });
  memory.observe(real(motor, frame(scene(0), 1), frame(scene(0), 2)));
  memory.observe(real(motor, frame({ ...scene(1), lateChannel: 0 }, 3), frame({ ...scene(1), lateChannel: 1, sideEffect: -2 }, 4)));
  const current = frame({ ...scene(0), lateChannel: 0 }, 100), cue = cueFor(motor, current);
  const generic = memory.predict(cue, current, { probe: true });
  assert(!generic.hypothesizedFields?.includes('self/properties.lateChannel'));
  const question = memory.predict(cue, current, { probe: true, requestedFields: ['self/properties.lateChannel'] });
  assert.equal(question.observation?.self.properties.lateChannel, 1);
  assert.equal(question.observation?.self.properties.sideEffect, -2);
  assert.equal(question.accepted, false); assert.deepEqual(question.supportedFields, []);
  const agent = new ExperienceAgent(memory), digest = sha(memory.snapshot());
  const offer: ActionOfferV1 = { version: 'ActionOfferV1', offerId: 'port', observationSequence: current.sequence, action: motor, cue };
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'newly-observed-channel', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'properties.lateChannel',
      comparator: 'greater-than', target: .5 } } };
  assert.equal(agent.plan(goal, current, [offer], { exploratory: true, depth: 1 }).reason, 'hypothetical-goal');
  assert.equal(sha(memory.snapshot()), digest);
  memory.observe(real(motor, frame({ ...scene(0), lateChannel: 0 }, 5), frame({ ...scene(0), lateChannel: -1, sideEffect: 2 }, 6)));
  assert.equal(agent.plan(goal, current, [offer], { exploratory: true, depth: 1 }).steps.length, 0,
    'the question cannot select a favorable but less relevant measured outcome');
});

test('numeric context boundaries tolerate ordinary roundoff in a predicted familiar measurement', () => {
  const memory = new ContextualReadout();
  for (let i = 0; i < 64; i++) for (const depth of [1, 2, 8]) memory.observe('port', { depth }, [['available', false, depth < 8]]);
  for (const depth of [2 - Number.EPSILON, 2, 2 + 2 * Number.EPSILON]) {
    const read = memory.read('port', 'available', { depth }); assert(read?.supported); assert.equal(read.value, true);
  }
  assert.equal(memory.read('port', 'available', { depth: 8 })?.value, false);
});

test('global accuracy cannot certify a rare unpredictable context with the same mean response', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'wait', parameters: { ticks: 1 } };
  for (let i = 0; i < 1000; i++) {
    const noisy = i % 10 === 9, before = frame({ sensoryRegion: Number(noisy) }, i * 2 + 1);
    const displacement = noisy ? Math.floor(i / 10) % 2 ? 1 : -1 : 0;
    const after = { ...frame(before.self.properties, i * 2 + 2), self: { ...before.self, position: [displacement, 0, 0] as const } };
    memory.observe(real(action, before, after));
  }
  const predictable = frame({ sensoryRegion: 0 }, 3000), noisy = frame({ sensoryRegion: 1 }, 3000);
  assert(memory.predict(cueFor(action, predictable), predictable).supportedFields.includes('self/position.0'));
  assert(!memory.predict(cueFor(action, noisy), noisy).supportedFields.includes('self/position.0'));
});

test('retired event identities cannot be learned again after exact audit compaction', () => {
  const ledger = new ExperienceLedger(8);
  for (let i = 0; i < 1000; i++) ledger.commit('event-' + i, 'hash-' + i);
  assert.equal(ledger.check('event-0', 'hash-0'), 'retired-or-collision');
  assert.equal(ledger.check('event-999', 'hash-999'), 'duplicate');
  assert.throws(() => ledger.check('event-999', 'wrong'), /conflict/);
  const snapshot = ledger.snapshot(); assert.equal(snapshot.recent.length, 8);
  const restored = new ExperienceLedger(snapshot.capacity, snapshot.retired, snapshot.recent);
  assert.equal(restored.check('event-0', 'different'), 'retired-or-collision');
  assert.equal(restored.check('a-new-event', 'hash'), 'new');
  const live = new ExperienceLedger(8);
  for (let n = 1; n <= 10000; n++) {
    assert.equal(live.check('physical-session:event-' + n, 'hash-' + n), 'new');
    live.commit('physical-session:event-' + n, 'hash-' + n);
  }
  assert.equal(live.check('physical-session:event-1', 'new-label'), 'retired-or-collision');
  assert.deepEqual(live.snapshot().streams, [['physical-session', 10000]]);
  assert(Buffer.from(live.snapshot().retired, 'base64').every(byte => byte === 0));
  const migrated = new ExperienceLedger(128, undefined,
    Array.from({ length: 100 }, (_, i) => [`session-${i}:event-1`, `digest-${i}`]));
  assert.equal(migrated.snapshot().streams.length, 64);
  assert.equal(migrated.check('session-0:event-2', 'new'), 'retired-or-collision');
  const saturated = new ExperienceLedger(8, Buffer.alloc(1 << 19, 255).toString('base64'), [], [['live', 100]]);
  assert.equal(saturated.check('live:event-101', 'new'), 'new');
  assert.equal(saturated.check('live:event-99', 'old'), 'retired-or-collision');
});

test('re-reading one offer frame cannot manufacture confidence', () => {
  const memory = new LearnedAffordances(), observation = frame({});
  const action: Action = { kind: 'wait', parameters: { ticks: 1 } };
  const offer: ActionOfferV1 = { version: 'ActionOfferV1', observationSequence: 1, offerId: 'actual', action, cue: cueFor(action, observation) };
  memory.observe(observation, [offer]); const initial = sha(memory.snapshot());
  for (let i = 0; i < 50; i++) memory.observe(observation, [offer]);
  assert.equal(sha(memory.snapshot()), initial); assert.equal(memory.imagined(observation).length, 0);
  assert.throws(() => memory.observe(observation, []), /conflicting-affordance/);
});

test('intrinsic exploration revisits a less favored learned motor without learning from its own choices', () => {
  const memory = new ExperienceMedium(41), actions: Action[] = [1, 2].map(ticks => ({ kind: 'wait', parameters: { ticks } }));
  let sequence = 1;
  for (let motor = 0; motor < 2; motor++) for (let n = 0; n < (motor ? 32 : 16); n++) {
    memory.observe(real(actions[motor]!, frame({}, sequence), frame({}, sequence + 1))); sequence += 2;
  }
  const observation = frame({}, sequence), offers: ActionOfferV1[] = actions.map((action, i) => ({ version: 'ActionOfferV1',
    observationSequence: sequence, offerId: String(i), action, cue: cueFor(action, observation) }));
  const agent = new ExperienceAgent(memory), digest = sha(memory.snapshot());
  assert.notEqual(memory.explorationDrive(offers[0]!.cue, observation), memory.explorationDrive(offers[1]!.cue, observation));
  const selected = Array.from({ length: 64 }, () => agent.explore(observation, offers)!.offerId);
  assert.equal(new Set(selected).size, 2);
  const restored = new ExperienceAgent(ExperienceMedium.restore(memory.snapshot())); restored.restoreChoices(agent.choices);
  for (let n = 0; n < 16; n++) assert.deepEqual(restored.explore(observation, offers), agent.explore(observation, offers));
  assert.equal(sha(memory.snapshot()), digest);
});

test('a matching physical counterexample immediately withdraws an old confident effect', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  for (let i = 0; i < 64; i++) {
    const before = frame({}, 2 * i + 1), after = { ...frame({}, 2 * i + 2), self: { ...before.self, position: [0, 0, -1] as const } };
    memory.observe(real(action, before, after));
  }
  const before = frame({}, 1000);
  assert(memory.predict(cueFor(action, before), before).supportedFields.includes('self/position.2'));
  memory.observe(real(action, before, frame({}, 1001)));
  const refused = memory.predict(cueFor(action, before), before);
  assert(!refused.supportedFields.includes('self/position.2'));
  const probe = memory.predict(cueFor(action, before), before, { probe: true });
  assert.equal(probe.accepted, false); assert.deepEqual(probe.supportedFields, []);
  assert.equal(probe.observation!.self.position[2], 0);
});

test('more parameter choices for one unlearned actuator do not multiply its exploration prior', () => {
  const observation = frame({}), a = new ExperienceAgent(), b = new ExperienceAgent();
  const offers = (count: number): ActionOfferV1[] => [
    { kind: 'look' as const, parameters: { yawDegrees: 15, pitchDegrees: 0 } },
    ...Array.from({ length: count }, (_, i) => ({ kind: 'observe' as const, parameters: { ticks: i + 1 } }))
  ].map((action, i) => ({ version: 'ActionOfferV1', offerId: String(i), observationSequence: 1,
    action, cue: cueFor(action, observation) }));
  const coarse = offers(1), fine = offers(9), choices: string[] = [];
  for (let i = 0; i < 128; i++) {
    const first = a.explore(observation, coarse)!.cue.kind, second = b.explore(observation, fine)!.cue.kind;
    assert.equal(first, second); choices.push(first);
  }
  assert.equal(new Set(choices).size, 2);
  assert.equal(a.medium.writes, 0); assert.equal(b.medium.writes, 0);
});

test('a stationary continuing session does not replace exploration with repeated highest-score actions', async () => {
  const memory = new ExperienceMedium(41), actions: Action[] = [5, 20].map(ticks => ({ kind: 'observe', parameters: { ticks } }));
  let sequence = 1;
  for (let motor = 0; motor < 2; motor++) for (let n = 0; n < (motor ? 32 : 16); n++) {
    memory.observe(real(actions[motor]!, frame({}, sequence), frame({}, sequence + 1))); sequence += 2;
  }
  let observation = frame({}, sequence); const selected = new Set<number>();
  const environment = { observe: async () => observation,
    listActionOffers: (): ActionOfferV1[] => actions.map((action, i) => ({ version: 'ActionOfferV1',
      offerId: String(i), observationSequence: observation.sequence, action, cue: cueFor(action, observation) })),
    executeOffer: async (offer: ActionOfferV1) => {
      selected.add(Number(offer.action.parameters.ticks)); observation = frame({}, observation.sequence + 1);
      return { executed: true, observation, event: null };
    }, waitForObservationAfter: async () => observation = frame({}, observation.sequence + 1) };
  const session = new ExperienceSession(memory);
  for (let i = 0; i < 16; i++) await session.step(environment, { learn: false });
  assert.equal(selected.size, 2);
});

test('uncertainty orthogonal to a measured displacement does not erase that direction or become zero', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  for (let i = 0; i < 64; i++) {
    const before = frame({}, i * 2 + 1), after = { ...frame({}, i * 2 + 2),
      self: { ...before.self, position: [i % 2 ? .5 : -.5, 0, -1] as const } };
    memory.observe(real(action, before, after));
  }
  const input = frame({}, 1000), prediction = memory.predict(cueFor(action, input), input);
  assert(prediction.supportedFields.includes('self/position.2'));
  assert(!prediction.supportedFields.includes('self/position.0'));
  assert.equal(prediction.observation!.self.position[2], -1);
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'measured-direction', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -.9 } } };
  const offer: ActionOfferV1 = { version: 'ActionOfferV1', offerId: 'motor', observationSequence: input.sequence,
    action, cue: cueFor(action, input) };
  assert.equal(new ExperienceAgent(memory).plan(goal, input, [offer]).steps.length, 1);
  const rotated = { ...input, self: { ...input.self, yaw: Math.PI / 2 } };
  const next = memory.predict(cueFor(action, rotated), rotated);
  assert(next.supportedFields.includes('self/position.0'));
  assert(!next.supportedFields.includes('self/position.2'));
  assert.equal(next.observation!.self.position[0], -1);
  const oblique = { ...input, self: { ...input.self, yaw: Math.PI / 4 } };
  const uncertain = memory.predict(cueFor(action, oblique), oblique);
  assert(!uncertain.supportedFields.includes('self/position.0'));
  assert(!uncertain.supportedFields.includes('self/position.2'));
});

test('a supported approach can execute beyond the search horizon without claiming a complete plan', async () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'move', parameters: { direction: 'back', ticks: 4 } };
  for (let i = 0; i < 32; i++) {
    const before = frame({}, i * 2 + 1), after = { ...frame({}, i * 2 + 2), self: { ...before.self, position: [0, 0, -1] as const } };
    memory.observe(real(action, before, after));
  }
  let observation = frame({}, 1000);
  const offers = (): ActionOfferV1[] => [{ version: 'ActionOfferV1', offerId: 'measured-port',
    observationSequence: observation.sequence, action, cue: cueFor(action, observation) }];
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'beyond-horizon', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -12.9 } } };
  const agent = new ExperienceAgent(memory), plan = agent.plan(goal, observation, offers(), { depth: 3 });
  assert.equal(plan.reason, 'predicted-progress'); assert.equal(plan.steps.length, 3);
  const environment = { observe: async () => observation, listActionOffers: offers,
    executeOffer: async () => {
      observation = { ...observation, sequence: observation.sequence + 1,
        self: { ...observation.self, position: [0, 0, observation.self.position[2] - 1] } };
      return { executed: true, observation, event: null };
    }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 } };
  const digest = sha(memory.snapshot());
  const result = await agent.runGoal(environment, goal, { actionBudget: 13, depth: 3, learn: false, allowExploration: false });
  assert.equal(result.status, 'goal-verified'); assert.equal(result.actions.length, 13);
  assert(result.actions.every(value => value.mode === 'planned' && value.planLength <= 3));
  assert.equal(sha(memory.snapshot()), digest);
});

test('frozen execution withdraws a disproved local hypothesis across restart without changing transferable experience', async () => {
  const memory = new ExperienceMedium(41), jump: Action = { kind: 'jump', parameters: { forward: true, ticks: 4 } };
  const observe: Action = { kind: 'observe', parameters: { ticks: 5 } };
  for (let i = 0; i < 32; i++) {
    const before = frame({}, i * 2 + 1), after = { ...frame({}, i * 2 + 2),
      self: { ...before.self, position: [0, 0, i % 2 ? -1 : 0] as const } };
    memory.observe(real(jump, before, after));
  }
  let observation = frame({}, 1000);
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'blocked-assumption', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -2 } } };
  const environment = { observe: async () => observation,
    listActionOffers: (): ActionOfferV1[] => [jump, observe].map((action, i) => ({ version: 'ActionOfferV1',
      offerId: String(i), observationSequence: observation.sequence, action, cue: cueFor(action, observation) })),
    executeOffer: async (offer: ActionOfferV1) => {
      const before = observation; observation = frame({}, before.sequence + 1);
      return { executed: true, observation, event: real(offer.action, before, observation) };
    }, waitForObservationAfter: async () => observation = frame({}, observation.sequence + 1) };
  let session = new ExperienceSession(memory); session.submit(goal);
  const digest = sha([session.agent.medium.snapshot(), session.agent.affordances.snapshot()]);
  const first = await session.step(environment, { learn: false });
  assert.equal(first.exploration?.source, 'hypothesis'); assert.equal(first.offer!.action.kind, 'jump');
  assert.equal(first.prediction!.basis, 'hypothesized'); assert.equal(first.refuted, true);
  assert(first.prediction!.errors.some(error => error.field === 'self/position.2' && !error.matched));
  const checkpoint = JSON.parse(JSON.stringify(session.snapshot()));
  session = ExperienceSession.restore(checkpoint, { sameWorld: true });
  const second = await session.step(environment, { learn: false });
  assert.equal(second.withdrawnPlanningOffers, 1); assert.equal(second.exploration?.source, 'curiosity');
  assert.equal(sha([session.agent.medium.snapshot(), session.agent.affordances.snapshot()]), digest);
  const transferred = ExperienceSession.restore(checkpoint); transferred.submit(goal);
  assert.equal((await transferred.step(environment, { learn: false })).exploration?.source, 'hypothesis',
    'a different world must not inherit the previous task\'s local refutation');
  const bounded = new ExperienceAgent(memory);
  assert.equal((await bounded.runGoal(environment, goal, { actionBudget: 2, learn: false })).status, 'action-budget');
  assert.equal(bounded.lastExploration?.source, 'curiosity', 'bounded execution must use the same counterexample feedback');
});

test('irrelevant sliding cannot give an unsupported goal hypothesis an unlimited execution budget', async () => {
  const memory = new ExperienceMedium(41), motor: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  for (let i = 0; i < 32; i++) {
    const before = frame({}, i * 2 + 1), after = { ...frame({}, i * 2 + 2),
      self: { ...before.self, position: [0, 0, i % 2 ? -1 : 0] as const } };
    memory.observe(real(motor, before, after));
  }
  let observation = frame({}, 1000);
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'unreachable-depth', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'depth', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -2 } } };
  const environment = { observe: async () => observation,
    listActionOffers: (): ActionOfferV1[] => [motor, { kind: 'observe' as const, parameters: { ticks: 5 } }].map((action, i) => ({
      version: 'ActionOfferV1', offerId: String(i), observationSequence: observation.sequence, action, cue: cueFor(action, observation) })),
    executeOffer: async (offer: ActionOfferV1) => {
      const before = observation;
      observation = { ...frame({}, before.sequence + 1), self: { ...before.self,
        position: [before.self.position[0] + .2, 0, 0] as const } };
      return { executed: true, observation, event: real(offer.action, before, observation) };
    }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 } };
  let session = new ExperienceSession(memory); session.submit(goal);
  const digest = sha([memory.snapshot(), session.agent.affordances.snapshot()]);
  const decisions = [];
  for (let i = 0; i < 8; i++) decisions.push(await session.step(environment, { learn: false }));
  session = ExperienceSession.restore(JSON.parse(JSON.stringify(session.snapshot())), { sameWorld: true });
  for (let i = 0; i < 16; i++) decisions.push(await session.step(environment, { learn: false }));
  assert(decisions.slice(0, 8).every(d => d.exploration?.source === 'hypothesis' && !d.measuredProgress));
  assert(decisions.slice(8).every(d => d.exploration?.source === 'curiosity' && d.hypothesisDeferred));
  assert(decisions.every(d => !d.refuted), 'the body really moved, so the old exact-state check alone would never withdraw it');
  assert.equal(session.stats.pendingGoals, 1); assert.equal(session.stats.verifiedGoals.length, 0);
  assert.equal(sha([memory.snapshot(), session.agent.affordances.snapshot()]), digest);
});

test('a persistent mild maintenance deficit gives a pending external goal a bounded service opportunity', async () => {
  const goal = (id: string, property: string, target: number): GroundedGoalV1 => ({ version: 'GroundedGoalV1', id,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id, subject: { kind: 'self' },
      observable: `properties.${property}`, comparator: 'greater-than', target } } });
  const session = new ExperienceSession(); session.submit(goal('external', 'signal', .5));
  let observation = frame({ bodySignal: .9, signal: 0 }, 1000);
  const environment = { maintenanceGoals: [goal('body', 'bodySignal', .95)],
    observe: async () => observation = { ...observation, sequence: observation.sequence + 1 },
    listActionOffers: () => [], executeOffer: async () => { throw new Error('no-physical-offer'); },
    waitForObservationAfter: async () => observation };
  const decisions = [];
  for (let i = 0; i < 8; i++) {
    decisions.push(await session.step(environment, { learn: false, exploration: false }));
    assert.equal(observation.self.properties.bodySignal, .9, 'the mild deficit persists on every actual observation');
  }
  assert.equal(decisions[0]!.source, 'maintenance');
  assert(decisions.slice(0, 2).some(decision => decision.source === 'task'),
    'a persistent mild deficit must not exclude an external goal from every service opportunity');
  for (let i = 0; i < decisions.length; i += 2)
    assert.deepEqual(new Set(decisions.slice(i, i + 2).map(decision => decision.source)), new Set(['maintenance', 'task']));
  assert(decisions.every(decision => decision.status === 'no-offers'));
  assert.equal(session.stats.pendingGoals, 1); assert.equal(session.stats.verifiedGoals.length, 0);
});

test('persistent maintenance shares real learned actions and later task confirmation with frozen experience', async () => {
  for (const remedy of [0, 1]) {
    const memory = new ExperienceMedium(41), affordances = new LearnedAffordances();
    const ports: Action[] = [1, 2].map(ticks => ({ kind: 'wait', parameters: { ticks } }));
    const offers = (observation: Observation): ActionOfferV1[] => ports.map((action, i) => ({ version: 'ActionOfferV1',
      offerId: String(i), observationSequence: observation.sequence, action, cue: cueFor(action, observation) }));
    let sequence = 1;
    // The fixture supplies only isolated measured effects. The scheduler gets
    // no port identity, remedy mapping, or external-task solution.
    for (let repeat = 0; repeat < 48; repeat++) for (const completed of [false, true]) for (let port = 0; port < 2; port++) {
      const before = frame({ bodySignal: .9, completed }, sequence++);
      const after = frame({ bodySignal: port === remedy ? .92 : .9, completed: completed || port !== remedy }, sequence++);
      memory.observe(real(ports[port]!, before, after)); affordances.observe(before, offers(before));
    }
    const goal = (id: string, property: string, target: number): GroundedGoalV1 => ({ version: 'GroundedGoalV1', id,
      expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id, subject: { kind: 'self' },
        observable: `properties.${property}`, comparator: 'greater-than', target } } });
    let observation = frame({ bodySignal: .9, completed: false }, sequence + 100);
    const actual: Observation[] = [], observe = (next: Observation) => { actual.push(next); return observation = next; };
    const environment = { maintenanceGoals: [goal('body', 'bodySignal', .95)],
      observe: async () => observe(frame({ ...observation.self.properties, bodySignal: .9 }, observation.sequence + 1)),
      listActionOffers: offers,
      executeOffer: async (offer: ActionOfferV1) => {
        assert.equal(offer.observationSequence, observation.sequence);
        const before = observation, port = ports.findIndex(value => value.parameters.ticks === offer.action.parameters.ticks);
        assert(port >= 0, 'only a currently offered physical port can execute');
        observe(frame({ bodySignal: port === remedy ? .92 : .9,
          completed: before.self.properties.completed === true || port !== remedy }, before.sequence + 1));
        return { executed: true, observation, event: real(offer.action, before, observation) };
      },
      waitForObservationAfter: async () => observe({ ...observation, sequence: observation.sequence + 1 }) };
    const external: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'external', expression: { kind: 'predicate',
      predicate: { version: 'GoalPredicateV1', id: 'external', subject: { kind: 'self' },
        observable: 'properties.completed', comparator: 'equals', target: true } } };
    let session = new ExperienceSession(memory, affordances); session.submit(external);
    const digest = sha([memory.snapshot(), affordances.snapshot()]), decisions = [];
    for (let i = 0; i < 14; i++) {
      decisions.push(await session.step(environment, { learn: false, exploration: false, depth: 1 }));
      if (i < 13) assert.deepEqual(session.stats.verifiedGoals, [], 'an action or imagined outcome cannot verify the task');
      if (i === 0) session = ExperienceSession.restore(JSON.parse(JSON.stringify(session.snapshot())), { sameWorld: true });
    }
    for (let i = 0; i < decisions.length; i += 2) {
      assert.equal(decisions[i]!.source, 'maintenance'); assert.equal(decisions[i]!.status, 'executed');
      assert.equal(decisions[i]!.offer!.action.parameters.ticks, ports[remedy]!.parameters.ticks);
      assert.equal(decisions[i + 1]!.source, 'task');
    }
    assert.equal(decisions[1]!.status, 'executed');
    assert.equal(decisions[1]!.offer!.action.parameters.ticks, ports[1 - remedy]!.parameters.ticks);
    assert.equal(decisions.at(-1)!.status, 'goal-verified'); assert.deepEqual(session.stats.verifiedGoals, ['external']);
    const task = session.tasks[0]!;
    assert.equal(task.actions, 1); assert.equal(task.confirmations, 6);
    assert(task.firstSatisfied! > decisions[1]!.observationSequence, 'confirmation starts on a distinct later actual observation');
    assert(actual.every(value => Number(value.self.properties.bodySignal) < .95), 'maintenance remained deficient throughout');
    assert.equal(new Set(actual.map(value => value.sequence)).size, actual.length);
    assert.equal(sha([session.agent.medium.snapshot(), session.agent.affordances.snapshot()]), digest,
      'service, restart and verification cannot train frozen experience');
  }
});

test('intention arbitration resumes its service turn in the same world and clears ownership on transfer', async () => {
  const bodyGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'body', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'body', subject: { kind: 'self' },
      observable: 'properties.bodySignal', comparator: 'greater-than', target: .95 } } };
  const coordinateGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'old-world-coordinate', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'coordinate', subject: { kind: 'self' },
      observable: 'position.0', comparator: 'greater-than', target: 50 } } };
  let observation = frame({ bodySignal: .9 }, 1000);
  const environment = { maintenanceGoals: [bodyGoal], observe: async () => observation, listActionOffers: () => [],
    executeOffer: async () => { throw new Error('no-physical-offer'); }, waitForObservationAfter: async () => observation };
  const session = new ExperienceSession(); session.submit(coordinateGoal);
  assert.equal((await session.step(environment, { learn: false, exploration: false })).source, 'maintenance');
  const checkpoint = JSON.parse(JSON.stringify(session.snapshot()));
  assert.deepEqual(checkpoint.arbitration, { nextService: 'task' });
  const digest = sha([checkpoint.medium, checkpoint.affordances]);
  const restored = ExperienceSession.restore(checkpoint, { sameWorld: true });
  assert.deepEqual(restored.snapshot().arbitration, checkpoint.arbitration); assert.deepEqual(restored.tasks, session.tasks);
  for (let i = 0; i < 8; i++) {
    observation = { ...observation, sequence: observation.sequence + 1 };
    const expected = await session.step(environment, { learn: false, exploration: false });
    const actual = await restored.step(environment, { learn: false, exploration: false });
    assert.deepEqual(actual, expected); assert.equal(actual.source, i % 2 ? 'maintenance' : 'task');
  }
  assert.deepEqual(restored.snapshot(), session.snapshot());
  assert.equal(sha([restored.agent.medium.snapshot(), restored.agent.affordances.snapshot()]), digest);
  const transferred = ExperienceSession.restore(checkpoint), transfer = transferred.snapshot();
  assert.deepEqual(transfer.tasks, []); assert.equal(transfer.maintenance, null); assert.equal(transfer.investigation, null);
  assert.deepEqual(transfer.deferred, []); assert.deepEqual(transfer.recent, []); assert.equal(transferred.world.stats.retainedPlaces, 0);
  assert.deepEqual(transfer.arbitration, { nextService: 'maintenance' });
  assert.equal(sha([transfer.medium, transfer.affordances]), digest);
  transferred.submit({ ...coordinateGoal, id: 'new-world-goal' });
  assert.equal((await transferred.step(environment, { learn: false, exploration: false })).source, 'maintenance',
    'a new world cannot inherit the prior task service turn');
  const legacy = structuredClone(checkpoint); delete legacy.arbitration;
  const old = ExperienceSession.restore(legacy, { sameWorld: true });
  assert.deepEqual(old.snapshot().arbitration, { nextService: 'maintenance' });
  assert.equal((await old.step(environment, { learn: false, exploration: false })).source, 'maintenance');
  assert.equal((await old.step(environment, { learn: false, exploration: false })).source, 'task');
  for (const arbitration of [null, {}, { nextService: 'unknown' }])
    assert.throws(() => ExperienceSession.restore({ ...checkpoint, arbitration }, { sameWorld: true }), /invalid-continuing-session/);
});

test('persistent maintenance preserves submitted external-goal order and distinct actual confirmations', async () => {
  const goal = (id: string, property: string, target: number): GroundedGoalV1 => ({ version: 'GroundedGoalV1', id,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id, subject: { kind: 'self' },
      observable: `properties.${property}`, comparator: 'greater-than', target } } });
  const session = new ExperienceSession(); session.submit(goal('first', 'firstSignal', .5)); session.submit(goal('second', 'secondSignal', .5));
  let observation = frame({ bodySignal: .9, firstSignal: 0, secondSignal: 1 }, 1000);
  const environment = { maintenanceGoals: [goal('body', 'bodySignal', .95)], observe: async () => observation,
    listActionOffers: () => [], executeOffer: async () => { throw new Error('no-physical-offer'); },
    waitForObservationAfter: async () => observation };
  const step = () => session.step(environment, { learn: false, exploration: false, verificationTicks: 1 });
  for (let i = 0; i < 8; i++) {
    const decision = await step(); assert.equal(decision.goalId, i % 2 ? 'first' : 'body');
  }
  assert.deepEqual(session.stats.verifiedGoals, [], 'a later satisfied task does not overtake a pending predecessor');
  observation = frame({ ...observation.self.properties, firstSignal: 1 }, observation.sequence + 1);
  for (let i = 0; i < 8; i++) await step();
  assert.deepEqual(session.stats.verifiedGoals, [], 'repeated scheduling of one actual frame is only one confirmation');
  assert.equal(session.tasks[0]!.confirmations, 1);
  observation = { ...observation, sequence: observation.sequence + 100 };
  await step(); assert.equal((await step()).status, 'goal-verified');
  assert.deepEqual(session.stats.verifiedGoals, ['first']);
  await step(); const second = await step(); assert.equal(second.goalId, 'second'); assert.equal(second.status, 'observation-stalled');
  assert.deepEqual(session.stats.verifiedGoals, ['first']);
  observation = { ...observation, sequence: observation.sequence + 1 };
  await step(); assert.equal((await step()).status, 'goal-verified');
  assert.deepEqual(session.stats.verifiedGoals, ['first', 'second']);
});

test('body conditions interrupt and resume an external task using learned, permuted motor effects', async () => {
  for (const remedy of [0, 1]) {
    const memory = new ExperienceMedium(41), ports: Action[] = [1, 2].map(ticks => ({ kind: 'wait', parameters: { ticks } }));
    let sequence = 1;
    for (let repeat = 0; repeat < 48; repeat++) for (let port = 0; port < 2; port++) {
      const before = frame({ bodySignal: 0, completed: false }, sequence++);
      const after = frame({ bodySignal: port === remedy ? 1 : 0, completed: port !== remedy }, sequence++);
      memory.observe(real(ports[port]!, before, after));
    }
    const makeGoal = (id: string, property: string, target: number | boolean): GroundedGoalV1 => ({
      version: 'GroundedGoalV1', id, expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1',
        id, subject: { kind: 'self' }, observable: `properties.${property}`, comparator: 'equals', target } } });
    let observation = frame({ bodySignal: 0, completed: false }, sequence);
    const environment = { maintenanceGoals: [makeGoal('body', 'bodySignal', 1)], observe: async () => observation,
      listActionOffers: (): ActionOfferV1[] => ports.map((action, i) => ({ version: 'ActionOfferV1', offerId: String(i),
        observationSequence: observation.sequence, action, cue: cueFor(action, observation) })),
      executeOffer: async (offer: ActionOfferV1) => {
        const before = observation, selected = ports.findIndex(port => port.parameters.ticks === offer.action.parameters.ticks);
        observation = frame({ ...before.self.properties, ...(selected === remedy ? { bodySignal: 1 } : { completed: true }) }, before.sequence + 1);
        return { executed: true, observation, event: real(offer.action, before, observation) };
      }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 } };
    const session = new ExperienceSession(memory); session.submit(makeGoal('external', 'completed', true));
    const digest = sha(memory.snapshot()), first = await session.step(environment, { learn: false });
    assert.equal(first.source, 'maintenance'); assert.equal(first.offer!.action.parameters.ticks, ports[remedy]!.parameters.ticks);
    assert.equal(session.tasks[0]!.actions, 0); assert.equal(session.stats.verifiedGoals.length, 0);
    const second = await session.step(environment, { learn: false }); assert.equal(second.source, 'task');
    for (let i = 0; i < 6; i++) await session.step(environment, { learn: false });
    assert.deepEqual(session.stats.verifiedGoals, ['external']); assert.equal(sha(memory.snapshot()), digest);
    observation = frame({ completed: false }, observation.sequence + 1);
    const unknown = new ExperienceSession(memory); unknown.submit(makeGoal('new-external', 'completed', true));
    assert.equal((await unknown.step(environment, { learn: false })).source, 'task', 'missing body sensation is not an invented deficit');
  }
});

test('a frozen learner can become locally familiar with a newly available motor without starving other choices', async () => {
  for (const changedBackground of [false, true]) {
    const memory = new ExperienceMedium(41), known: Action = { kind: 'wait', parameters: { ticks: 1 } };
    for (let i = 0; i < 64; i++) memory.observe(real(known, frame({}, i * 2 + 1), frame({}, i * 2 + 2)));
    let observation = frame({}, 1000);
    const environment = { observe: async () => observation,
      listActionOffers: (): ActionOfferV1[] => ([known, { kind: 'use-item', parameters: { holdTicks: 40 } }] as Action[])
        .map((action, i) => ({ version: 'ActionOfferV1', offerId: String(i), observationSequence: observation.sequence,
          action, cue: cueFor(action, observation) })),
      executeOffer: async (offer: ActionOfferV1) => {
        const before = observation; observation = frame(changedBackground ? { background: before.sequence } : {}, before.sequence + 1);
        return { executed: true, observation, event: real(offer.action, before, observation) };
      }, waitForObservationAfter: async () => observation = frame({}, observation.sequence + 1) };
    const session = new ExperienceSession(memory), digest = sha(memory.snapshot()), selected = new Set<string>();
    for (let i = 0; i < 32; i++) selected.add((await session.step(environment, { learn: false })).offer!.action.kind);
    assert.equal(selected.size, 2); assert.equal(sha(memory.snapshot()), digest);
  }
});

test('a tiny supported forecast cannot perpetually count as goal progress when the body stays still', async () => {
  const memory = new ExperienceMedium(41), motor: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  for (let i = 0; i < 32; i++) {
    const before = frame({}, i * 2 + 1), after = { ...frame({}, i * 2 + 2), self: { ...before.self, position: [0, 0, -.02] as const } };
    memory.observe(real(motor, before, after));
  }
  let observation = frame({}, 1000);
  const environment = { observe: async () => observation,
    listActionOffers: (): ActionOfferV1[] => ([motor, { kind: 'observe', parameters: { ticks: 5 } }] as Action[])
      .map((action, i) => ({ version: 'ActionOfferV1', offerId: String(i), observationSequence: observation.sequence,
        action, cue: cueFor(action, observation) })),
    executeOffer: async (offer: ActionOfferV1) => {
      const before = observation; observation = frame({}, before.sequence + 1);
      return { executed: true, observation, event: real(offer.action, before, observation) };
    }, waitForObservationAfter: async () => observation = frame({}, observation.sequence + 1) };
  const session = new ExperienceSession(memory); session.submit({ version: 'GroundedGoalV1', id: 'unrealized-approach',
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' },
      observable: 'position.2', comparator: 'less-than', target: -1 } } });
  const decisions = [];
  for (let i = 0; i < 12; i++) decisions.push(await session.step(environment, { learn: false }));
  assert(decisions[0]!.planLength! > 0); assert.equal(decisions[0]!.planReason, 'predicted-progress');
  assert(decisions.every(d => !d.measuredProgress && !d.forecastAdvanced));
  assert(decisions.filter(d => (d.planLength ?? 0) > 0 || d.exploration?.source === 'hypothesis').length <= 8);
  assert(decisions.filter(d => d.exploration?.source === 'curiosity').length >= 4,
    'measured refutation or bounded trial deferral must stop an unsupported stationary plan from monopolizing action');
  assert.equal(session.stats.verifiedGoals.length, 0); assert.equal(session.stats.pendingGoals, 1);
});

test('an older progress metric is rebased without crediting software changes and still recognizes later physical progress', async () => {
  const initial = new ExperienceSession(); initial.submit({ version: 'GroundedGoalV1', id: 'resumed-goal',
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' },
      observable: 'position.0', comparator: 'greater-than', target: 10 } } });
  const legacy = initial.snapshot(); legacy.tasks[0]!.baseline = frame({}); legacy.tasks[0]!.bestResidual = .0001;
  legacy.tasks[0]!.progressMetric = 'GroundedResidual2';
  const session = ExperienceSession.restore(legacy, { sameWorld: true });
  let observation = frame({}, 1000), actions = 0;
  const motor: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  const environment = { observe: async () => observation,
    listActionOffers: (): ActionOfferV1[] => [{ version: 'ActionOfferV1', offerId: 'actual-port',
      observationSequence: observation.sequence, action: motor, cue: cueFor(motor, observation) }],
    executeOffer: async () => {
      const before = observation; observation = { ...frame({}, before.sequence + 1),
        self: { ...before.self, position: [actions++ ? 1 : 0, 0, 0] as const } };
      return { executed: true, observation, event: real(motor, before, observation) };
    }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 } };
  assert.equal((await session.step(environment, { learn: false })).measuredProgress, false);
  assert.equal((await session.step(environment, { learn: false })).measuredProgress, true);
  assert.equal(session.stats.verifiedGoals.length, 0);
});

test('twenty thousand repetitive updates stay numerically finite and retain bounded audit state', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'wait', parameters: { ticks: 1 } };
  for (let i = 0; i < 20000; i++) memory.observe(real(action, frame({ signal: 0 }, i * 2 + 1),
    frame({ signal: 0 }, i * 2 + 2), 'long-session:event-' + (i + 1)));
  const snapshot = memory.snapshot();
  assert.equal(snapshot.writes, 20000); assert.equal(snapshot.events.length, 4096);
  assert(snapshot.contexts!.circuits.every(([, circuit]) => circuit.samples.length <= snapshot.contexts!.capacity));
  assert(snapshot.networks.every(([, network]) => network.heads.every(head => head.covariance.flat().every(Number.isFinite)
    && head.covariance.reduce((sum, row, i) => sum + row[i]!, 0) <= 1e6 + .1)));
  const restored = ExperienceMedium.restore(JSON.parse(JSON.stringify(snapshot))), observation = frame({ signal: 0 }, 50000);
  assert(restored.predict(cueFor(action, observation), observation).supportedFields.includes('self/position.0'));
});

test('world memory survives occlusion and restart without forging a visible object', () => {
  const world = new ExperienceWorld(16, 16);
  const visible = { ...frame({}, 1), objects: [{ id: 'p1', type: 'percept', relativePosition: [0, 1, -2] as const,
    properties: { red: .7, green: .2, blue: .1 } }] };
  world.observe(visible);
  for (let i = 2; i < 202; i++) world.observe(frame({}, i));
  assert.equal(world.remembered().length, 1); assert.equal(world.remembered()[0]!.visible, false);
  assert(world.remembered()[0]!.confidence < .2);
  const restored = ExperienceWorld.restore(world.snapshot());
  restored.observe({ ...visible, sequence: 203, objects: visible.objects.map(o => ({ ...o, id: 'new-percept-id' })) });
  assert.equal(restored.remembered().length, 1); assert.equal(restored.remembered()[0]!.visible, true);
  assert.equal(visible.objects[0]!.id, 'p1');
  assert.throws(() => restored.observe({ ...visible, predictionSupport: ['self/yaw'] }), /imagined/);
  for (let i = 204; i < 250; i++) restored.observe({ ...frame({}, i), self: { ...visible.self, position: [i, 0, 0] } });
  assert.equal(restored.stats.retainedPlaces, 16);
});

test('a sequence jump cannot masquerade as multiple observed goal confirmations', async () => {
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'confirmation-control', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'properties.signal', comparator: 'equals', target: true } } };
  for (const continuing of [false, true]) {
    let observation = frame({ signal: true }, 1), waits = 0;
    const environment = { observe: async () => observation, listActionOffers: () => [],
      executeOffer: async () => { throw new Error('verification-must-not-act'); },
      waitForObservationAfter: async () => observation = frame({ signal: ++waits < 2 }, observation.sequence + 100) };
    if (continuing) {
      const session = new ExperienceSession(); session.submit(goal);
      await session.step(environment); await session.step(environment); await session.step(environment);
      assert.deepEqual(session.stats.verifiedGoals, []);
    } else assert.notEqual((await new ExperienceAgent().runGoal(environment, goal, { actionBudget: 0 })).status, 'goal-verified');
  }
});

test('learned sparse measurements continue beyond the compact receptor layout', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
  for (let i = 0; i < 32; i++) {
    const values = Object.fromEntries(Array.from({ length: 48 }, (_, k) => ['channel' + k, k]));
    const before = frame(values, i * 2 + 1), after = frame({ ...values, channel47: 50 }, i * 2 + 2);
    memory.observe(real(action, before, after));
  }
  const input = frame(Object.fromEntries(Array.from({ length: 48 }, (_, k) => ['channel' + k, k])), 1000);
  const prediction = memory.predict(cueFor(action, input), input);
  assert(prediction.supportedFields.includes('self/properties.channel47'));
  assert.equal(prediction.observation!.self.properties.channel47, 50);
});

test('body consequences can depend on the anonymous surface actually under the cursor', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'interact', parameters: {}, targetId: 'seen' };
  const sensed = (red: number, sequence: number, acquired = 0): Observation => ({ ...frame({ acquired }, sequence),
    targetId: 'seen', objects: [{ id: 'seen', type: 'percept', relativePosition: [0, 1, -1],
      properties: { red, green: .3, blue: .2 } }] });
  for (let i = 0; i < 192; i++) {
    const color = i % 2;
    memory.observe({ ...real(action, sensed(color, i * 2 + 1), sensed(color, i * 2 + 2, color)), trackedIds: ['self', 'seen'] });
  }
  for (const color of [0, 1]) {
    const before = sensed(color, 1000), prediction = memory.predict(cueFor(action, before), before);
    assert(prediction.supportedFields.includes('self/properties.acquired'));
    assert.equal(prediction.observation!.self.properties.acquired, color);
  }
});

test('a learned sensory change enables a later motor effect without a body-state shortcut', () => {
  const memory = new ExperienceMedium(41);
  const move: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  const change: Action = { kind: 'wait', parameters: { ticks: 7 } };
  const sensed = (open: boolean, sequence: number, z = 0): Observation => ({ ...frame({}, sequence),
    self: { ...frame({}).self, position: [0, 0, z] }, sensation: { version: 'AnonymousRGBD1', width: 3, height: 2,
      horizontalFov: 1, verticalFov: 1, range: 8, samples: Array.from({ length: 6 }, () => [.5, .5, .5, open ? 4 : 1]).flat() } });
  for (let i = 0; i < 512; i++) {
    const open = Boolean(i & 1), action = i & 2 ? change : move;
    const before = sensed(open, i * 2 + 1), after = sensed(action === change || open, i * 2 + 2, action === move && open ? -1 : 0);
    memory.observe(real(action, before, after));
  }
  const input = sensed(false, 2000), offers: ActionOfferV1[] = [move, change].map((action, i) => ({ version: 'ActionOfferV1',
    observationSequence: input.sequence, offerId: String(i), action, cue: cueFor(action, input) }));
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'sensory-prerequisite', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'terminal', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -.9 } } };
  const plan = new ExperienceAgent(memory).plan(goal, input, offers);
  assert.equal(plan.reason, 'predicted-goal'); assert.deepEqual(plan.steps.map(step => step.offer.action), [change, move]);
  assert.deepEqual(plan.steps[0]!.prediction.observation!.self.position, input.self.position);
  const comparison = compareExperiencePrediction(plan.steps[0]!.prediction, sensed(false, 2001));
  assert(comparison.errors.some(error => error.field.startsWith('context/view/') && !error.matched),
    'unchanged body channels must not hide a failed predicted sensory prerequisite');
});

test('ten causal stages are composed from isolated experience with changing action availability', async () => {
  const memory = new ExperienceMedium(73), affordances = new LearnedAffordances();
  const permutation = [7, 1, 8, 3, 0, 6, 2, 9, 4, 5]; // Test world mechanics, never supplied to the learner.
  const ports: Action[] = permutation.map(slot => ({ kind: 'wait', parameters: { ticks: slot + 1 } }));
  const offers = (observation: Observation): ActionOfferV1[] => ports.flatMap((action, stage) =>
    stage === 0 || observation.self.properties['signal' + (stage - 1)] === true ? [{ version: 'ActionOfferV1',
      offerId: 'actual-' + stage + '-' + observation.sequence, observationSequence: observation.sequence,
      action, cue: cueFor(action, observation) }] : []);
  let random = 73, seq = 0;
  const bits = () => Object.fromEntries(Array.from({ length: 10 }, (_, stage) => {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    return ['signal' + stage, Boolean((random >>> 0) & 1)];
  }));
  for (let i = 0; i < 320; i++) {
    const before = frame(bits(), ++seq), available = offers(before); affordances.observe(before, available);
    const chosen = available[i % available.length]!;
    const stage = ports.findIndex(p => p.parameters.ticks === chosen.action.parameters.ticks);
    const after = frame({ ...before.self.properties, ['signal' + stage]: true }, ++seq);
    memory.observe(real(chosen.action, before, after));
  }
  let observation = frame(Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['signal' + i, false])), 2000);
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'unseen-ten-stage-composition', expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'terminal', subject: { kind: 'self' },
      observable: 'properties.signal9', comparator: 'equals', target: true } } };
  const agent = new ExperienceAgent(memory, affordances), digest = sha([memory.snapshot(), affordances.snapshot()]);
  const plan = agent.plan(goal, observation, offers(observation));
  assert.equal(plan.reason, 'predicted-goal'); assert.equal(plan.steps.length, 10);
  const environment = { observe: async () => observation, listActionOffers: offers,
    executeOffer: async (chosen: ActionOfferV1) => {
      assert(offers(observation).some(o => o.action.parameters.ticks === chosen.action.parameters.ticks));
      const stage = ports.findIndex(p => p.parameters.ticks === chosen.action.parameters.ticks);
      observation = frame({ ...observation.self.properties, ['signal' + stage]: true }, observation.sequence + 1);
      return { executed: true, observation, event: null };
    }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 }
  };
  // This test measures causal composition, bounded by 512 node expansions,
  // independently of CPU contention in concurrent test files. A zero wall
  // budget must still refuse to execute an unsupported/uncomputed plan.
  const timedOut = await agent.runGoal(environment, goal,
    { actionBudget: 10, learn: false, allowExploration: false, milliseconds: 0 });
  assert.equal(timedOut.status, 'unknown'); assert.equal(timedOut.actions.length, 0);
  assert.equal(sha([memory.snapshot(), affordances.snapshot()]), digest);
  const result = await agent.runGoal(environment, goal,
    { actionBudget: 10, learn: false, allowExploration: false, milliseconds: Infinity });
  assert.equal(result.status, 'goal-verified'); assert.equal(result.actions.length, 10);
  assert.equal(sha([memory.snapshot(), affordances.snapshot()]), digest);
  observation = frame(Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['signal' + i, false])), 3000);
  const cold = new ExperienceAgent(new ExperienceMedium(73), affordances);
  assert.equal(cold.plan(goal, observation, offers(observation)).steps.length, 0);
  const erased = memory.snapshot(), removed = motorIdentity(cueFor(ports[5]!, observation));
  erased.networks = erased.networks.filter(([id]) => !id.startsWith(removed + '/'));
  erased.contexts!.circuits = erased.contexts!.circuits.filter(([id]) => !id.startsWith(removed + '/'));
  erased.contexts!.structures = erased.contexts!.structures?.filter(([id]) => !id.startsWith(removed + '/'));
  assert.equal(new ExperienceAgent(ExperienceMedium.restore(erased), affordances).plan(goal, observation, offers(observation)).steps.length, 0);
  let session = new ExperienceSession(memory, affordances); session.submit(goal);
  for (let i = 0; i < 5; i++) assert.equal((await session.step(environment,
    { learn: false, exploration: false, milliseconds: Infinity })).status, 'executed');
  session = ExperienceSession.restore(JSON.parse(JSON.stringify(session.snapshot())), { sameWorld: true });
  for (let i = 0; i < 12 && !session.stats.verifiedGoals.length; i++) await session.step(environment,
    { learn: false, exploration: false, milliseconds: Infinity });
  assert.equal(session.stats.executed, 10); assert.deepEqual(session.stats.verifiedGoals, [goal.id]);
  const transferred = ExperienceSession.restore(session.snapshot());
  assert.equal(transferred.tasks.length, 0); assert.equal(transferred.world.stats.retainedPlaces, 0);
});
