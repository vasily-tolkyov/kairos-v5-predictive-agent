import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import { ExperienceMedium, experienceInputs } from '../src/experience-medium.js';
import { ExperienceAgent, compareExperiencePrediction } from '../src/experience-agent.js';
import { LearnedAffordances } from '../src/learned-affordances.js';
import { cueFor } from '../src/events.js';
import { captureRetina } from '../src/adapters/minecraft/retina.js';
import { sha } from '../src/util.js';

function frame(stage: number, sequence: number, z = 0): Observation {
  const id = 'observed-' + sequence, color = stage === 0 ? [.8, .2, .1] as const : [.2, .6, .1] as const;
  const position = [0, 1.62, -(stage + 1)] as const;
  return { sequence, activeSeconds: sequence / 20, contextId: 'synthetic-visual-apparatus',
    self: { position: [0, 0, z], yaw: 0, pitch: 0, properties: {} }, targetId: stage < 2 ? id : null,
    objects: stage < 2 ? [{ id, type: 'percept', relativePosition: position,
      properties: { red: color[0], green: color[1], blue: color[2], extent: .2 } }] : [],
    perception: { version: 'AttentivePerception8', attendedId: stage < 2 ? id : null, gazeId: stage < 2 ? id : null,
      receptors: stage < 2 ? 475 : 0, groups: stage < 2 ? 1 : 0,
      tracks: stage < 2 ? [{ id, position, color, extent: .2, sampleCount: 475, visible: true, confidence: 1,
        ambiguity: 0, age: 1, missed: 0, anchorEpoch: 0, motionEvidence: [false, false, true] }] : [] },
    sensation: captureRetina(0, 0, (yaw, pitch) => stage < 2 ? { distance: (stage + 1) / (Math.cos(yaw) * Math.cos(pitch)), color } : null) };
}
function event(action: Action, before: Observation, after: Observation): RealEvent {
  return { version: 'RealEventV5', id: 'appearance:event-' + before.sequence, cue: cueFor(action, before),
    frames: [before, after], trackedIds: ['self', ...(before.targetId ? [before.targetId] : [])],
    provenance: 'executed-real-body', complete: true, bodyResult: { action, executed: true, status: 'completed',
      startSequence: before.sequence, endSequence: after.sequence } };
}

test('a plan can cross successively revealed unfamiliar surfaces without borrowing their future identities', async () => {
  const medium = new ExperienceMedium(41), affordances = new LearnedAffordances();
  const offers = (observation: Observation): ActionOfferV1[] => ([
    { kind: 'move' as const, parameters: { direction: 'forward', ticks: 4 } },
    ...(observation.targetId ? [{ kind: 'interact' as const, parameters: {}, targetId: observation.targetId }] : [])
  ] as Action[]).map((action, index) => ({ version: 'ActionOfferV1', offerId: String(index), observationSequence: observation.sequence,
    action, cue: cueFor(action, observation) }));
  let sequence = 1;
  for (let repeat = 0; repeat < 40; repeat++) for (let stage = 0; stage < 3; stage++) for (const chosen of offers(frame(stage, sequence))) {
    const before = frame(stage, sequence++), offer = offers(before).find(value => value.action.kind === chosen.action.kind)!;
    affordances.observe(before, offers(before));
    const after = frame(offer.action.kind === 'interact' ? stage + 1 : stage, sequence++, stage === 2 ? -1 : 0);
    medium.observe(event(offer.action, before, after));
  }
  let observation = frame(0, sequence), stage = 0;
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'unseen-composition', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -.5 } } };
  const agent = new ExperienceAgent(medium, affordances), plan = agent.plan(goal, observation, offers(observation));
  assert.equal(plan.reason, 'predicted-goal'); assert.deepEqual(plan.steps.map(step => step.offer.action.kind), ['interact', 'interact', 'move']);
  assert.equal(plan.steps[0]!.prediction.observation!.objects.some(object => object.id === observation.targetId), false,
    'loss of the old measurement must not preserve a phantom visible target');
  assert(!plan.steps[1]!.offer.action.targetId!.startsWith('observed-'), 'a future binding cannot borrow an unseen fixture identity');
  const actualNext = frame(1, observation.sequence + 1);
  const comparison = compareExperiencePrediction(plan.steps[0]!.prediction, actualNext);
  assert(comparison.errors.find(error => error.field === 'targetId')?.matched, 'a future gaze role compares appearance, not a borrowed tracking label');
  assert(comparison.errors.filter(error => error.field.includes('next-visible-gaze')).every(error => error.known && error.matched));
  const changed = { ...actualNext, objects: actualNext.objects.map(object => ({ ...object, properties: { ...object.properties, red: .99 } })) };
  assert(compareExperiencePrediction(plan.steps[0]!.prediction, changed).errors.some(error => error.field.endsWith('properties.red')
    && error.known && !error.matched), 'the new appearance prediction must still be tested against actual sensory properties');
  const executed: string[] = [], digest = sha([medium.snapshot(), affordances.snapshot()]);
  const result = await agent.runGoal({ observe: async () => observation, listActionOffers: offers,
    executeOffer: async chosen => {
      const before = observation; assert(offers(before).some(offer => offer.action.kind === chosen.action.kind));
      if (chosen.action.targetId) assert.equal(chosen.action.targetId, before.targetId, 'execution must rebind the actual current observation');
      executed.push(chosen.action.kind); if (chosen.action.kind === 'interact') stage++;
      observation = frame(stage, observation.sequence + 1, chosen.action.kind === 'move' && stage === 2 ? -1 : 0);
      return { executed: true, observation, event: event(chosen.action, before, observation) };
    }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 }
  }, goal, { actionBudget: 3, learn: false, allowExploration: false });
  assert.equal(result.status, 'goal-verified'); assert.deepEqual(executed, ['interact', 'interact', 'move']);
  assert.equal(sha([medium.snapshot(), affordances.snapshot()]), digest);
});

test('one measured motor effect may inspire an explicitly untrusted probe, without certifying it', () => {
  const medium = new ExperienceMedium(41), before = frame(2, 1), action: Action = { kind: 'move', parameters: { direction: 'left', ticks: 4 } };
  medium.observe(event(action, before, frame(2, 2, -1)));
  assert(!medium.predict(cueFor(action, before), before).supportedFields.includes('self/position.2'));
  const hypothesis = medium.predict(cueFor(action, before), before, { probe: true });
  assert.equal(hypothesis.accepted, false); assert.deepEqual(hypothesis.supportedFields, []);
  assert(hypothesis.hypothesizedFields?.includes('self/position.2')); assert(hypothesis.observation!.self.position[2] < -.9);
});

test('an early measured response can propose a partial probe beyond the imagination horizon without certifying it', () => {
  const medium = new ExperienceMedium(41), before = frame(2, 1), action: Action = { kind: 'move', parameters: { direction: 'left', ticks: 4 } };
  medium.observe(event(action, before, frame(2, 2, -1)));
  const current = frame(2, 10), offer: ActionOfferV1 = { version: 'ActionOfferV1', offerId: 'measured-port',
    observationSequence: current.sequence, action, cue: cueFor(action, current) };
  const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'beyond-early-horizon', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'destination', subject: { kind: 'self' }, observable: 'position.2', comparator: 'less-than', target: -20 } } };
  const agent = new ExperienceAgent(medium), digest = sha(medium.snapshot());
  assert.equal(agent.plan(goal, current, [offer], { depth: 3 }).steps.length, 0);
  const probe = agent.plan(goal, current, [offer], { depth: 3, exploratory: true });
  assert.equal(probe.reason, 'hypothetical-progress'); assert.equal(probe.steps.length, 3);
  assert(probe.steps.every(step => !step.prediction.accepted && step.prediction.supportedFields.length === 0));
  assert.equal(sha(medium.snapshot()), digest);
});

test('an early probe recalls a joint measured response instead of combining averages into an unobserved outcome', () => {
  const medium = new ExperienceMedium(41), action: Action = { kind: 'move', parameters: { direction: 'left', ticks: 4 } };
  for (let i = 0; i < 4; i++) {
    const before = frame(2, 2 * i + 1), after = { ...frame(2, 2 * i + 2), self: { ...before.self,
      position: i % 2 ? [1, 0, 0] as const : [0, 0, -1] as const } };
    medium.observe(event(action, before, after));
  }
  const before = frame(2, 20), digest = sha(medium.snapshot()), recalled = medium.predict(cueFor(action, before), before, { probe: true });
  assert.equal(recalled.accepted, false); assert.deepEqual(recalled.supportedFields, []);
  assert.deepEqual(recalled.observation!.self.position, [1, 0, 0]);
  assert.equal(sha(medium.snapshot()), digest, 'recall cannot add another learning trial');
  const zero = frame(2, 22); medium.observe(event(action, frame(2, 21), zero));
  const updated = medium.predict(cueFor(action, zero), zero, { probe: true });
  assert.deepEqual(updated.observation!.self.position, [0, 0, 0], 'the latest equally matching actual response supersedes the older probe');
});

test('a coarse surface hypothesis cannot erase the actual visual sample at the actuator', () => {
  const focused = (color: readonly number[], sequence: number, z = 0) => {
    const observation = frame(0, sequence, z), visual = observation.sensation!;
    const samples = [...visual.samples], center = 4 * (Math.floor(visual.height / 2) * visual.width + Math.floor(visual.width / 2));
    color.forEach((value, channel) => samples[center + channel] = value);
    return { ...observation, sensation: { ...visual, samples } };
  };
  const colors = [[.2, .6, .1], [.8, .2, .1]], before = colors.map(color => focused(color, 1));
  assert.deepEqual(before[0]!.objects, before[1]!.objects, 'the coarse grouping is deliberately identical');
  assert.notDeepEqual(experienceInputs(before[0]!), experienceInputs(before[1]!),
    'the local retinal measurements are different despite identical group averages');
  const medium = new ExperienceMedium(47), action: Action = { kind: 'interact', parameters: {}, targetId: before[0]!.targetId! };
  let sequence = 1;
  for (let repeat = 0; repeat < 48; repeat++) for (const [condition, color] of colors.entries()) {
    const a = focused(color, sequence++), b = focused(color, sequence++, condition ? -1 : 0);
    medium.observe(event({ ...action, targetId: a.targetId! }, a, b));
  }
  for (const [condition, color] of colors.entries()) {
    const observation = focused(color, sequence++), prediction = medium.predict(cueFor(action, observation), observation);
    assert(prediction.supportedFields.includes('self/position.2'), 'the distinct measured responses can be learned');
    assert.equal(prediction.observation!.self.position[2], condition ? -1 : 0);
    assert.deepEqual([0, 1, 2].map(channel => prediction.observation!.predictionContext?.[`view/fovea/${channel}`]), color,
      'imagined local appearance is supplied by learned response channels');
  }
  const unmeasured = { ...before[0]!, sensation: undefined };
  assert.equal(experienceInputs(unmeasured)['view/fovea/0'], undefined, 'a group color cannot impersonate a missing local sample');
});

test('unowned native physiology cannot enter learning or return through an old model checkpoint', () => {
  const memory = new ExperienceMedium(41), action: Action = { kind: 'observe', parameters: { ticks: 5 } };
  const withAir = (sequence: number): Observation => {
    const observed = frame(0, sequence);
    return { ...observed, self: { ...observed.self, properties: { oxygen: 7 } } };
  };
  const before = withAir(1), after = withAir(2), digest = sha(memory.snapshot());
  assert.throws(() => memory.observe(event(action, before, after)), /unowned-native-body-channel/);
  assert.equal(sha(memory.snapshot()), digest);
  const owned = (observed: Observation): Observation => ({ ...observed, bodySensation: {
    version: 'OwnedBodySignals1', oxygen: { rawAir: 105, value: 7 } } });
  memory.observe(event(action, owned(before), owned(after)));
  const current = memory.snapshot(); assert.equal(current.version, 'KairosExperienceMediumV11');
  assert.equal(ExperienceMedium.restore(current).writes, 1);
  const legacy = { ...current, version: 'KairosExperienceMediumV10' as const };
  assert.throws(() => ExperienceMedium.restore(legacy), /unowned-native-body-channel/);
  assert.equal(memory.predict(cueFor(action, before), owned(before), { probe: true }).observation?.bodySensation, undefined,
    'an imagined value cannot retain actual measurement provenance');
});

test('a recalled unchanged scene cannot replace a different current scene or invent a newly visible object', () => {
  const memory = new ExperienceMedium(41), before = frame(0, 1), after = frame(0, 2);
  const action: Action = { kind: 'interact', parameters: {}, targetId: before.targetId! };
  memory.observe(event(action, before, after));
  const color = [.3, .4, .7] as const, position = [0, 1.62, -3] as const;
  const original = frame(0, 10), current: Observation = { ...original,
    objects: original.objects.map(object => ({ ...object, relativePosition: position,
      properties: { ...object.properties, red: color[0], green: color[1], blue: color[2] } })),
    sensation: captureRetina(0, 0, (yaw, pitch) => ({ distance: 3 / (Math.cos(yaw) * Math.cos(pitch)), color })) };
  const digest = sha(memory.snapshot()), predicted = memory.predict(cueFor(action, current), current, { probe: true });
  const gaze = predicted.observation!.objects.find(object => object.id === predicted.observation!.targetId)!;
  assert(gaze); assert.deepEqual(gaze.relativePosition, position);
  for (const [axis, key] of ['red', 'green', 'blue'].entries()) assert(Math.abs(Number(gaze.properties[key]) - color[axis]!) < 1e-12);
  assert.equal(predicted.accepted, false); assert.deepEqual(predicted.supportedFields, []);
  const empty = frame(2, 20), absent = memory.predict(cueFor(action, empty), empty, { probe: true });
  assert.equal(absent.observation!.targetId, null, 'remembering an unchanged visible surface cannot create one in a currently empty gaze');
  assert.equal(sha(memory.snapshot()), digest);
});
