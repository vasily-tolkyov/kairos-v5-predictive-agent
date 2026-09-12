import assert from 'node:assert/strict';
import test from 'node:test';
import { PassiveExperienceWindows } from '../src/passive-experience.js';
import { ExperienceSession } from '../src/experience-session.js';
import { ExperienceMedium, motorIdentity } from '../src/experience-medium.js';
import { ExperienceAgent } from '../src/experience-agent.js';
import { LearnedAffordances } from '../src/learned-affordances.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { cueFor, validateEvent } from '../src/events.js';
import { sha } from '../src/util.js';

const frame = (sequence: number): Observation => ({ sequence, activeSeconds: sequence / 20, contextId: 'unit-apparatus',
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { health: 20 - sequence } }, objects: [], targetId: null });
const passive = (a: number, b: number): RealEvent => ({ version: 'RealEventV5', id: `fixture-passive:event-${b}`,
  cue: { kind: 'passive', parameters: { ticks: b - a }, targetRole: null },
  frames: Array.from({ length: b - a + 1 }, (_, i) => frame(a + i)), trackedIds: ['self'], bodyResult: null,
  provenance: 'observed-passive', complete: true });

test('passive capture excludes motor intervals, keeps actual boundaries and refuses observation gaps', () => {
  const events: RealEvent[] = [], capture = new PassiveExperienceWindows('fixture', event => events.push(event), 3);
  capture.resume(frame(0)); for (let i = 1; i <= 4; i++) capture.accept(frame(i)); capture.suspend();
  for (let i = 5; i <= 10; i++) capture.accept(frame(i)); // A motor owns these intervals.
  capture.resume(frame(10)); capture.accept(frame(11)); capture.flush();
  assert.deepEqual(events.map(event => event.frames.map(frame => frame.sequence)), [[0, 1, 2, 3], [3, 4], [10, 11]]);
  for (const event of events) { validateEvent(event); assert.equal(event.bodyResult, null); assert.equal(event.cue.parameters.ticks, event.frames.length - 1); }
  assert.throws(() => capture.accept(frame(13)), /passive-observation-gap/);
});

test('passive evidence is learned before its following action, with separate counts and exact resume', async t => {
  const medium = new ExperienceMedium(), session = new ExperienceSession(medium), order: string[] = [];
  const original = medium.observe.bind(medium);
  t.mock.method(medium, 'observe', (event: RealEvent) => { order.push(event.id); return original(event); });
  const action: Action = { kind: 'observe', parameters: { ticks: 1 } };
  const event: RealEvent = { version: 'RealEventV5', id: 'fixture-motor:event-1', cue: cueFor(action, frame(2)),
    frames: [frame(2), frame(3)], trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: 2, endSequence: 3 } };
  const offer = { version: 'ActionOfferV1' as const, offerId: 'observed-port', observationSequence: 1,
    action, cue: cueFor(action, frame(1)) };
  const decision = await session.step({ drainPassiveEvents: async () => [passive(0, 1)],
    observe: async () => frame(1), listActionOffers: () => [offer], waitForObservationAfter: async () => frame(2),
    executeOffer: async () => ({ executed: true, observation: frame(3), event, precedingPassiveEvents: [passive(1, 2)] }) });
  assert.equal(decision.status, 'executed');
  assert.deepEqual(order, ['fixture-passive:event-1', 'fixture-passive:event-2', 'fixture-motor:event-1']);
  assert.equal(session.stats.executed, 1); assert.equal(session.stats.passiveWindows, 2);
  assert.equal(session.stats.passiveWrites, 2); assert.equal(session.stats.writes, 3);
  const restored = ExperienceSession.restore(session.snapshot(), { sameWorld: true });
  assert.equal(restored.stats.passiveWrites, 2); assert.equal(restored.stats.writes, 3);
  assert.deepEqual(restored.agent.medium.snapshot(), medium.snapshot());
});

test('frozen observation records passive exposure without changing learning, and rejects a mislabeled motor', async () => {
  const session = new ExperienceSession(), digest = sha(session.agent.medium.snapshot());
  const environment = { observe: async () => frame(1), listActionOffers: () => [],
    waitForObservationAfter: async () => frame(2), executeOffer: async () => { throw new Error('no motor offered'); },
    drainPassiveEvents: async () => [passive(0, 1)] };
  await session.step(environment, { learn: false });
  assert.equal(sha(session.agent.medium.snapshot()), digest); assert.equal(session.stats.passiveWindows, 1);
  assert.equal(session.stats.passiveWrites, 0);
  await assert.rejects(session.step({ ...environment, drainPassiveEvents: async () => [{ ...passive(0, 1),
    cue: { kind: 'observe', parameters: { ticks: 1 }, targetRole: null } }] }), /motor-window-supplied-as-passive-experience/);
});

test('isolated passive experience composes between two learned motor effects without a supplied task recipe', async () => {
  const medium = new ExperienceMedium(83), affordances = new LearnedAffordances();
  const actions: Action[] = [{ kind: 'select-hotbar', parameters: { slot: 2 } },
    { kind: 'passive', parameters: { ticks: 1 } }, { kind: 'select-hotbar', parameters: { slot: 7 } }];
  const sensed = (signal: number, sequence: number): Observation => ({ ...frame(sequence),
    self: { ...frame(sequence).self, properties: { signal } } });
  const offers = (observation: Observation): ActionOfferV1[] => actions.map((action, index) => ({ version: 'ActionOfferV1',
    offerId: String(index), observationSequence: observation.sequence, action, cue: cueFor(action, observation) }));
  // Synthetic causal apparatus, separate from the learner. Each isolated
  // transition is measured; no ordered episode or proposed subgoal is taught.
  const outcome = (signal: number, port: number) => signal === port ? signal + 1 : signal;
  let sequence = 1;
  for (let repeat = 0; repeat < 48; repeat++) for (let signal = 0; signal < 4; signal++) for (const [port, action] of actions.entries()) {
    const before = sensed(signal, sequence++), after = sensed(outcome(signal, port), sequence++);
    affordances.observe(before, offers(before));
    const event: RealEvent = { version: 'RealEventV5', id: 'separate-exposure:event-' + before.sequence,
      cue: cueFor(action, before), frames: [before, after], trackedIds: ['self'], complete: true,
      provenance: port === 1 ? 'observed-passive' : 'executed-real-body', bodyResult: port === 1 ? null : {
        action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } };
    medium.observe(event);
  }
  let observation = sensed(0, sequence);
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'new-composition', expression: { kind: 'predicate',
    predicate: { version: 'GoalPredicateV1', id: 'p', subject: { kind: 'self' }, observable: 'properties.signal',
      comparator: 'greater-than', target: 2.5 } } };
  const agent = new ExperienceAgent(medium, affordances), plan = agent.plan(goal, observation, offers(observation));
  assert.equal(plan.reason, 'predicted-goal'); assert.deepEqual(plan.steps.map(step => step.offer.action), actions);
  const frozen = sha([medium.snapshot(), affordances.snapshot()]), selected: Action[] = [];
  const run = await agent.runGoal({ observe: async () => observation, listActionOffers: offers,
    executeOffer: async offer => {
      const before = observation, port = actions.findIndex(action => sha(action) === sha(offer.action)); assert(port >= 0);
      selected.push(offer.action); observation = sensed(outcome(Number(before.self.properties.signal), port), before.sequence + 1);
      return { executed: true, observation, event: { version: 'RealEventV5', id: 'evaluation:event-' + before.sequence,
        cue: offer.cue, frames: [before, observation], trackedIds: ['self'], complete: true,
        provenance: 'executed-real-body', bodyResult: { action: offer.action, executed: true, status: 'completed',
          startSequence: before.sequence, endSequence: observation.sequence } } };
    }, waitForObservationAfter: async () => observation = sensed(Number(observation.self.properties.signal), observation.sequence + 1)
  }, goal, { actionBudget: 3, learn: false, allowExploration: false });
  assert.equal(run.status, 'goal-verified'); assert.deepEqual(selected, actions);
  assert.equal(sha([medium.snapshot(), affordances.snapshot()]), frozen);
  const erased = medium.snapshot(), motor = motorIdentity(cueFor(actions[1]!, observation));
  erased.networks = erased.networks.filter(([id]) => !id.startsWith(motor + '/'));
  erased.contexts!.circuits = erased.contexts!.circuits.filter(([id]) => !id.startsWith(motor + '/'));
  erased.contexts!.structures = erased.contexts!.structures?.filter(([id]) => !id.startsWith(motor + '/'));
  observation = sensed(0, observation.sequence + 1);
  const incomplete = new ExperienceAgent(ExperienceMedium.restore(erased), affordances).plan(goal, observation, offers(observation));
  assert.equal(incomplete.reason, 'predicted-progress');
  assert.deepEqual(incomplete.steps.map(step => step.offer.action), [actions[0]],
    'erasing the passive prerequisite preserves the first measured step but removes the complete solution');
});
