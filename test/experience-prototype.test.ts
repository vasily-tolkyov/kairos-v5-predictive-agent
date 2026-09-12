import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { GroundedGoalV1 } from '../src/control/contracts.js';
import { ExperienceAgent } from '../src/experience-agent.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { ExperienceMedium, experienceState } from '../src/experience-medium.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

const action: Action = { kind: 'select-hotbar', parameters: { slot: 4 } };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'measured-terminal',
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'terminal',
    subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.z', comparator: 'equals', target: true } } };
function frame(x: boolean, y: boolean, z: boolean, sequence = 1): Observation {
  return { sequence, activeSeconds: sequence / 20, contextId: `context-${sequence % 4}`, targetId: null,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1], properties: { x, y, z } }] };
}
function event(index: number, inverted = false): RealEvent {
  const x = Boolean(index & 1), y = Boolean(index & 2), z = Boolean(index & 4);
  const before = frame(x, y, z, index * 2 + 1);
  const after = frame(x, y, inverted ? x === y : x !== y, index * 2 + 2);
  return { version: 'RealEventV5', id: `actual-${index}`, cue: cueFor(action, before), frames: [before, after],
    trackedIds: ['self', 'o'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence,
      endSequence: after.sequence, terminationReason: 'stable' } };
}
const medium = new ExperienceMedium(13);
for (let index = 0; index < 512; index++) medium.observe(event(index));
const trained = medium.snapshot();

test('independent measured planes identify motion without inventing unobserved components', () => {
  const memory = new ExperienceMedium(41);
  const sensed = (sequence: number, normal: readonly [number, number, number], after = false): Observation => {
    const base = frame(false, false, false, sequence), position = (after ? [.15, .25, -.65] : [0, 0, -1]) as [number, number, number];
    return { ...base, objects: [{ id: 'o', type: 'percept', relativePosition: position, properties: { visibleSignal: after } }],
      perception: { version: 'AttentivePerception8', attendedId: 'o', gazeId: null, receptors: 20, groups: 1,
        tracks: [{ id: 'o', position, color: [.5, .5, .5], extent: .5, sampleCount: 20, visible: true,
          confidence: 1, ambiguity: 0, age: 5, missed: 0, anchorEpoch: 0, motionEvidence: [false, false, false],
          surface: { normal, point: position } }] } };
  };
  const learn = (index: number, normal: readonly [number, number, number]) => {
    const real = event(index), before = sensed(index * 2 + 1, normal), after = sensed(index * 2 + 2, normal, true);
    memory.observe({ ...real, frames: [before, after] });
  };
  for (let index = 0; index < 32; index++) learn(index, [0, 0, 1]);
  const input = sensed(1000, [0, 0, 1]);
  const partial = memory.predict(cueFor(action, input), input);
  assert(!partial.supportedFields.includes('object:o/relativeDistance'));
  assert(partial.supportedFields.includes('object:o/properties.visibleSignal'));
  for (let index = 32; index < 96; index++) learn(index, index % 2 ? [1, 0, 0] : [0, 1, 0]);
  const full = memory.predict(cueFor(action, input), input);
  assert(full.supportedFields.includes('object:o/relativeDistance'));
  assert(Math.hypot(...full.observation!.objects[0]!.relativePosition.map((v, i) => v - [.15, .25, -.65][i]!)) < .01);
  const restored = ExperienceMedium.restore(memory.snapshot());
  assert.deepEqual(restored.predict(cueFor(action, input), input), full);
  const masked: Observation = { ...input, predictionSupport: ['self/yaw', 'self/pitch', 'self/position.0',
    'self/position.1', 'self/position.2', 'object:o/properties.visibleSignal'] };
  assert(!restored.predict(cueFor(action, masked), masked).supportedFields.includes('object:o/relativeDistance'));
  const noisy = new ExperienceMedium(41);
  for (let index = 0; index < 96; index++) {
    const normal = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][index % 3] as [number, number, number];
    const frames = [sensed(index * 2 + 1, normal), sensed(index * 2 + 2, normal, true)].map(frame => ({ ...frame,
      perception: { ...frame.perception!, tracks: frame.perception!.tracks.map(track => ({ ...track,
        surface: { ...track.surface!, residual: .01 } })) } }));
    noisy.observe({ ...event(index), frames });
  }
  assert(!noisy.predict(cueFor(action, input), input).supportedFields.includes('object:o/relativeDistance'),
    'full directional coverage cannot erase measured sensory uncertainty');
  const resetAnchors = new ExperienceMedium(41);
  for (let index = 0; index < 32; index++) {
    const normal = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][index % 3] as [number, number, number];
    const before = sensed(index * 2 + 1, normal), after = sensed(index * 2 + 2, normal, true);
    resetAnchors.observe({ ...event(index), frames: [before, { ...after,
      perception: { ...after.perception!, tracks: after.perception!.tracks.map(track => ({ ...track, anchorEpoch: 1 })) } }] });
  }
  assert(!resetAnchors.predict(cueFor(action, input), input).supportedFields.includes('object:o/relativeDistance'));
});

test('chosen attention learns the selected measurement and rejects an outcome-only subject', () => {
  const memory = new ExperienceMedium(41);
  const sensed = (sequence: number, changed = false): Observation => {
    const objects = ['foreground', 'background'].map(id => ({ id, type: 'percept',
      relativePosition: [0, 0, -1] as const, properties: { signal: changed && id === 'foreground' } }));
    return { ...frame(false, false, false, sequence), objects,
      perception: { version: 'AttentivePerception8', attendedId: 'background', gazeId: null, receptors: 20, groups: 2,
        tracks: objects.map(object => ({ id: object.id, position: object.relativePosition, color: [.5, .5, .5],
          extent: .5, sampleCount: 10, visible: true, confidence: 1, ambiguity: 0, age: 5, missed: 0,
          anchorEpoch: 0, motionEvidence: [true, object.id === 'foreground', object.id === 'foreground'] })) } };
  };
  for (let index = 0; index < 32; index++) {
    const real = event(index), before = sensed(index * 2 + 1), after = sensed(index * 2 + 2, true);
    memory.observe({ ...real, attentionId: 'foreground', frames: [before, after], trackedIds: ['self', 'foreground'] });
  }
  const input = sensed(100), predicted = memory.predict(cueFor(action, input), input);
  assert.ok(predicted.supportedFields.includes('object:foreground/properties.signal'));
  assert.equal(predicted.observation!.objects.find(object => object.id === 'foreground')!.properties.signal, true);
  const offer = { version: 'ActionOfferV1' as const, offerId: 'a', observationSequence: 100,
    action, cue: cueFor(action, input) };
  const digest = sha(memory.snapshot());
  assert.equal(new ExperienceAgent(memory).explore(input, [offer])!.attentionId, 'foreground');
  const unseen = { ...event(100), attentionId: 'outcome-only', frames: [sensed(201), sensed(202, true)] };
  assert.throws(() => memory.observe(unseen), /attention-subject-not-observed-before-action/);
  assert.equal(sha(memory.snapshot()), digest);
});

test('learns a nonlinear conditional response from real transitions', () => {
  for (let index = 0; index < 8; index++) {
    const input = event(index).frames[0]!, predicted = medium.predict(cueFor(action, input), input);
    assert.equal(predicted.accepted, true, JSON.stringify(predicted));
    assert.deepEqual(experienceState(predicted.observation!), experienceState(event(index).frames[1]!));
  }
});

test('goals, queries, chronology labels and snapshots do not train the medium', () => {
  const restored = ExperienceMedium.restore(trained), before = sha(restored.snapshot());
  const input = frame(true, false, false);
  const renamed = { ...input, sequence: 999, activeSeconds: 5000, contextId: 'unseen-phase-name' };
  assert.deepEqual(experienceState(restored.predict(cueFor(action, input), input).observation!),
    experienceState(restored.predict(cueFor(action, renamed), renamed).observation!));
  const offer = { version: 'ActionOfferV1' as const, offerId: 'actual-offer', observationSequence: 1,
    action, cue: cueFor(action, input) };
  const plan = new ExperienceAgent(restored).plan(goal, input, [offer]);
  assert.equal(plan.reason, 'predicted-goal'); assert.equal(plan.steps.length, 1);
  assert.equal(sha(restored.snapshot()), before);
});

test('without a motor input or any learned readout there is no executable prediction', () => {
  const input = frame(true, false, false);
  assert.equal(medium.predict(null, input).accepted, false);
  assert.equal(new ExperienceMedium().predict(cueFor(action, input), input).observation, null);
  const erased = structuredClone(trained);
  // The new contextual readout is also learned state; ablate both stores.
  if (erased.contexts) { erased.contexts.circuits = []; erased.contexts.structures = []; }
  for (const [, network] of erased.networks) {
    for (const head of network.heads) {
      for (const row of head.readout) row.fill(0);
      for (const row of head.categoryReadout) row.fill(0);
      head.numericMeans.fill(0);
      head.correct = head.categoryCorrect = head.regressionCorrect = 0;
      for (const quality of head.numericQuality) quality.correct = 0;
    }
  }
  const prediction = ExperienceMedium.restore(erased).predict(cueFor(action, input), input);
  assert.equal(prediction.accepted, false); assert.equal(prediction.activationMargin, 0);
});

test('goal-directed probes stay untrusted and require actual feedback to verify a goal', async () => {
  const uncertain = structuredClone(trained);
  for (const [, network] of uncertain.networks) for (const head of network.heads) {
    head.correct = head.categoryCorrect = head.regressionCorrect = .4;
    for (const quality of head.numericQuality) quality.correct = .4;
  }
  const memory = ExperienceMedium.restore(uncertain), agent = new ExperienceAgent(memory);
  const input = frame(true, false, false, 2000), cue = cueFor(action, input), digest = sha(memory.snapshot());
  const offer = { version: 'ActionOfferV1' as const, offerId: 'learned', observationSequence: input.sequence, action, cue };
  const unknownAction: Action = { kind: 'select-hotbar', parameters: { slot: 8 } };
  const offers = [offer, { ...offer, offerId: 'unobserved', action: unknownAction, cue: cueFor(unknownAction, input) }];
  assert.equal(agent.plan(goal, input, offers).steps.length, 0);
  const probe = memory.predict(cue, input, { probe: true });
  assert.equal(probe.accepted, false); assert.deepEqual(probe.supportedFields, []);
  assert.deepEqual(probe.observation!.predictionSupport, []);
  assert(probe.hypothesizedFields!.includes('object:o/properties.z'));
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, input);
  assert.notEqual(evaluator.evaluate(probe.observation!).status, 'satisfied');
  const hypothetical = agent.plan(goal, input, offers, { exploratory: true });
  assert.equal(hypothetical.reason, 'hypothetical-goal');
  assert(hypothetical.steps.every(step => !step.prediction.accepted && !step.prediction.supportedFields.length));
  assert.equal(agent.explore(input, offers, { goal })!.offerId, 'learned');
  assert.equal(new ExperienceAgent().plan(goal, input, offers, { exploratory: true }).steps.length, 0);
  for (const actualSuccess of [false, true]) {
    let observation = input;
    const result = await agent.runGoal({ observe: async () => observation, listActionOffers: () => offers,
      executeOffer: async selected => {
        assert.equal(selected.offerId, 'learned');
        observation = frame(true, false, actualSuccess, observation.sequence + 1);
        return { executed: true, observation, event: null };
      }, waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 }
    }, goal, { actionBudget: 1, learn: false });
    assert.equal(result.status, actualSuccess ? 'goal-verified' : 'action-budget');
    assert.equal(result.actions[0]!.mode, 'exploration');
    assert.equal(result.actions[0]!.planLength, 0);
  }
  assert.equal(sha(memory.snapshot()), digest);
});

test('retains learned weights across a mechanism change and repairs predictions from new feedback', () => {
  const changing = ExperienceMedium.restore(trained);
  const wrongBefore = changing.predict(event(512, true).cue, event(512, true).frames[0]!);
  assert.notDeepEqual(experienceState(wrongBefore.observation!), experienceState(event(512, true).frames[1]!));
  const first = changing.observe(event(512, true));
  assert.equal(first.correctBeforeUpdate, false);
  for (let index = 513; index < 1024; index++) changing.observe(event(index, true));
  for (let index = 1024; index < 1032; index++) {
    const real = event(index, true), prediction = changing.predict(real.cue, real.frames[0]!);
    assert.equal(prediction.accepted, true);
    assert.deepEqual(experienceState(prediction.observation!), experienceState(real.frames[1]!));
  }
  assert.equal(changing.writes, 1024);
});

test('restore preserves the exact subsequent learning update and replay randomness', () => {
  const first = ExperienceMedium.restore(trained), second = ExperienceMedium.restore(trained);
  first.observe(event(512, true)); second.observe(event(512, true));
  assert.equal(sha(first.snapshot()), sha(second.snapshot()));
  const duplicate = first.observe(event(512, true));
  assert.equal(duplicate.learned, false);
  assert.throws(() => first.observe(event(512, false)), /event-id-conflict/);
});

test('learning another motor response retains an unrehearsed earlier capability', () => {
  const memory = ExperienceMedium.restore(trained);
  const other: Action = { kind: 'select-hotbar', parameters: { slot: 5 } };
  for (let index = 512; index < 1024; index++) {
    const real = event(index, true);
    memory.observe({ ...real, cue: cueFor(other, real.frames[0]!), bodyResult: { ...real.bodyResult!, action: other } });
  }
  for (let index = 0; index < 8; index++) {
    const original = event(index), changed = event(index, true), input = original.frames[0]!;
    const oldResponse = memory.predict(cueFor(action, input), input), newResponse = memory.predict(cueFor(other, input), input);
    assert.equal(oldResponse.accepted, true); assert.equal(newResponse.accepted, true);
    assert.deepEqual(experienceState(oldResponse.observation!), experienceState(original.frames[1]!));
    assert.deepEqual(experienceState(newResponse.observation!), experienceState(changed.frames[1]!));
  }
});

test('rejects gaps, non-real windows and corrupt conductances without changing memory', () => {
  const copy = ExperienceMedium.restore(trained), before = sha(copy.snapshot());
  const gap = event(512);
  assert.throws(() => copy.observe({ ...gap, frames: [gap.frames[0]!, { ...gap.frames[1]!, sequence: 2000 }] }), /observation-gap/);
  assert.throws(() => copy.observe({ ...gap, complete: false }), /incomplete-real-event/);
  assert.throws(() => copy.observe({ ...gap, provenance: 'imagined' as never }), /non-real-event/);
  assert.throws(() => copy.observe({ ...gap, frames: [gap.frames[0]!,
    { ...gap.frames[1]!, predictionSupport: ['self/yaw'] }] }), /imagined-observation/);
  assert.throws(() => copy.observe({ ...gap, frames: [gap.frames[0]!, { ...gap.frames[1]!,
    self: { ...gap.frames[1]!.self, position: [Infinity, 0, 0] } }] }), /invalid-public-receptor/);
  assert.equal(sha(copy.snapshot()), before);
  const corrupt = structuredClone(trained); corrupt.networks[0]![1].weights[0]![0] = NaN;
  assert.throws(() => ExperienceMedium.restore(corrupt), /invalid-conductances/);
});

test('missing objects mask their channels without discarding measurable self channels', () => {
  const absent = frame(true, false, false);
  const missing = { ...absent, objects: [] };
  const prediction = medium.predict(cueFor(action, missing), missing);
  assert.equal(prediction.accepted, true);
  assert.deepEqual(prediction.observation!.objects, []);
  const unseen = structuredClone(absent);
  (unseen.objects[0]!.properties as Record<string, unknown>).z = 'unseen';
  assert(!medium.predict(cueFor(action, unseen), unseen).supportedFields.includes('object:o/properties.z'));
});

test('renaming objects and translating the world preserves learned local predictions', () => {
  const input = frame(true, false, false), changed: Observation = { ...input,
    self: { ...input.self, position: [400, 64, -200] },
    objects: input.objects.map(object => ({ ...object, id: 'new-track-in-new-room' })) };
  const prediction = medium.predict(cueFor(action, changed), changed);
  assert.equal(prediction.accepted, true);
  assert.deepEqual(prediction.observation!.self.position, changed.self.position);
  assert.equal(prediction.observation!.objects[0]!.properties.z, true);
  assert.equal(prediction.observation!.objects[0]!.id, 'new-track-in-new-room');
});

test('an unsupported copied value cannot become an input to the next imagined action', () => {
  const input = frame(true, false, false), prediction = medium.predict(cueFor(action, input), input);
  const imagined = { ...prediction.observation!, predictionSupport: prediction.supportedFields
    .filter(key => key !== 'object:o/properties.x') };
  const next = medium.predict(cueFor(action, imagined), imagined);
  assert(!next.supportedFields.includes('object:o/properties.z'));
  assert(next.supportedFields.includes('self/position.0'));
});

test('real later observations verify a goal even with no motor budget', async () => {
  let observation = frame(true, false, true, 100);
  const agent = new ExperienceAgent(ExperienceMedium.restore(trained));
  const environment = { observe: async () => observation, listActionOffers: () => [],
    executeOffer: async () => { throw new Error('verification-must-not-spend-an-action'); },
    waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 } };
  const result = await agent.runGoal(environment, goal, { actionBudget: 0 });
  assert.equal(result.status, 'goal-verified'); assert.equal(result.observation.sequence, 105);
  assert.equal(result.actions.length, 0);
});

test('a transient or stale terminal observation cannot certify success', async () => {
  let observation = frame(true, false, true, 100);
  const agent = new ExperienceAgent(ExperienceMedium.restore(trained));
  const environment = { observe: async () => observation, listActionOffers: () => [],
    executeOffer: async () => { throw new Error('no-action-available'); },
    waitForObservationAfter: async () => observation = frame(true, false, false, 101) };
  assert.equal((await agent.runGoal(environment, goal, { actionBudget: 0 })).status, 'action-budget');
  observation = frame(true, false, true, 200);
  environment.waitForObservationAfter = async () => observation;
  assert.equal((await agent.runGoal(environment, goal, { actionBudget: 0 })).status, 'observation-stalled');
});

test('plans and verifies three numeric stages learned only as isolated transitions', async () => {
  const memory = new ExperienceMedium(29);
  const numericFrame = (value: number, sequence: number): Observation => ({ ...frame(false, false, false, sequence),
    objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1], properties: { z: value } }] });
  for (let index = 0; index < 256; index++) {
    const value = index % 4, before = numericFrame(value, index * 2 + 1), after = numericFrame(Math.min(3, value + 1), index * 2 + 2);
    memory.observe({ ...event(index), cue: cueFor(action, before), frames: [before, after] });
  }
  const frozen = sha(memory.snapshot());
  let observation = numericFrame(0, 1000);
  const offers = (current: Observation) => [{ version: 'ActionOfferV1' as const, offerId: String(current.sequence),
    observationSequence: current.sequence, action, cue: cueFor(action, current) }];
  const agent = new ExperienceAgent(memory);
  const numericGoal: GroundedGoalV1 = { ...goal, expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'numeric-terminal', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.z', comparator: 'equals', target: 3 } } };
  const plan = agent.plan(numericGoal, observation, offers(observation));
  assert.equal(plan.steps.length, 3);
  const result = await agent.runGoal({ observe: async () => observation, listActionOffers: offers,
    waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 },
    executeOffer: async () => {
      observation = numericFrame(Math.min(3, Number(observation.objects[0]!.properties.z) + 1), observation.sequence + 1);
      return { executed: true, observation, event: null };
    } }, numericGoal, { actionBudget: 3, learn: false, allowExploration: false });
  assert.equal(result.status, 'goal-verified'); assert.equal(result.actions.length, 3);
  assert(result.actions.every(value => value.mode === 'planned' && value.predictionCorrect));
  assert.equal(sha(memory.snapshot()), frozen);
  observation = numericFrame(0, 2000);
  const relativeGoal: GroundedGoalV1 = { ...goal, expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'relative-terminal', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.z', comparator: 'increase', minimumDelta: 3 } } };
  const relative = await agent.runGoal({ observe: async () => observation, listActionOffers: offers,
    waitForObservationAfter: async () => observation = { ...observation, sequence: observation.sequence + 1 },
    executeOffer: async () => {
      observation = numericFrame(Math.min(3, Number(observation.objects[0]!.properties.z) + 1), observation.sequence + 1);
      return { executed: true, observation, event: null };
    } }, relativeGoal, { actionBudget: 3, learn: false, allowExploration: false });
  assert.equal(relative.status, 'goal-verified');
  assert.deepEqual(relative.actions.map(value => value.planLength), [3, 2, 1]);
});

test('numeric receptors preserve distinguishable values above sixteen', () => {
  const memory = new ExperienceMedium(29);
  const numericFrame = (z: number, sequence: number): Observation => ({ ...frame(false, false, false, sequence),
    objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1], properties: { z } }] });
  for (let i = 0; i < 512; i++) {
    const value = 20 + i % 4, before = numericFrame(value, i * 2 + 1), after = numericFrame(Math.min(23, value + 1), i * 2 + 2);
    memory.observe({ ...event(i), cue: cueFor(action, before), frames: [before, after] });
  }
  for (const value of [20, 21, 22, 23]) {
    const input = numericFrame(value, 2000), prediction = memory.predict(cueFor(action, input), input);
    assert(prediction.supportedFields.includes('object:o/properties.z'));
    assert.equal(prediction.observation!.objects[0]!.properties.z, Math.min(23, value + 1));
  }
});
