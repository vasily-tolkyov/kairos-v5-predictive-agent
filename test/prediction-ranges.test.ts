import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../src/control/contracts.js';
import { ExperienceMedium } from '../src/experience-medium.js';
import { ExperienceAgent, compareExperiencePrediction } from '../src/experience-agent.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { LearnedAffordances } from '../src/learned-affordances.js';
import { cueFor } from '../src/events.js';
import { rotateRanges } from '../src/numeric-ranges.js';
import { bodyToWorld, worldToBody } from '../src/perception.js';

const frame = (sequence: number, z = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'synthetic-range-apparatus', self: { position: [0, 0, z], yaw: 0, pitch: 0, properties: {} },
  objects: [], targetId: null });
const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
const offer = (observation: Observation, motor = action): ActionOfferV1 => ({ version: 'ActionOfferV1',
  offerId: 'current-motor', observationSequence: observation.sequence, action: motor, cue: cueFor(motor, observation) });
function measured(before: Observation, after: Observation): RealEvent {
  return { version: 'RealEventV5', id: 'range:' + before.sequence, cue: cueFor(action, before), frames: [before, after],
    trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: before.sequence, endSequence: after.sequence } };
}
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'displacement', expression: { kind: 'predicate',
  predicate: { version: 'GoalPredicateV1', id: 'past-boundary', subject: { kind: 'self' },
    observable: 'position.2', comparator: 'less-than', target: -.0055 } } };

test('observed stationary outcomes remain possible throughout a multistep forecast', () => {
  const medium = new ExperienceMedium(41);
  for (let i = 0; i < 64; i++) medium.observe(measured(frame(i * 2 + 1), frame(i * 2 + 2, i % 2 ? -.001 : 0)));
  const start = frame(1000), first = medium.predict(offer(start).cue, start);
  assert(first.supportedFields.includes('self/position.2'));
  assert(first.observation!.self.position[2] < 0, 'the mean can move while the empirical envelope still includes no motion');
  let current = start;
  for (let i = 0; i < 16; i++) {
    current = medium.predict(offer(current).cue, current).observation!;
    const range = current.predictionBounds!['self/position.2']!;
    assert(range[0] <= -.001 * (i + 1) + 1e-10); assert(range[1] >= 0);
  }
  assert.equal(new ExperienceAgent(medium).plan(goal, start, [offer(start)]).steps.length, 0,
    'averaging an observed stall cannot certify even a supported progress prefix');
});

test('small consistently measured motion can still compose a valid goal without an arbitrary dead zone', () => {
  const medium = new ExperienceMedium(41);
  for (let i = 0; i < 64; i++) medium.observe(measured(frame(i * 2 + 1), frame(i * 2 + 2, -.001)));
  const start = frame(1000), plan = new ExperienceAgent(medium).plan(goal, start, [offer(start)]);
  assert.equal(plan.reason, 'predicted-goal'); assert.equal(plan.steps.length, 6);
  const future = plan.steps.at(-1)!.prediction.observation!;
  assert(future.predictionBounds!['self/position.2']![1] < -.0055);
  const comparison = compareExperiencePrediction(plan.steps[0]!.prediction, frame(1001));
  assert(comparison.errors.some(error => error.field === 'self/position.2' && !error.matched),
    'an actual stall contradicts a precise learned millimetre movement even within the old 0.1 tolerance');
});

test('uncertain geometry obeys the measured coordinate transform and includes all possible yaw rotations', () => {
  const vector = [.3, -.7, 1.2];
  for (const yaw of [-3, -.2, 0, .5, Math.PI / 2, 3.1]) for (const toBody of [false, true]) {
    const ranges = rotateRanges(vector.map(value => [value, value]), [yaw, yaw], toBody);
    const point = (toBody ? worldToBody : bodyToWorld)(vector, yaw);
    ranges.forEach((range, i) => assert(range && Math.abs(range[0] - point[i]!) < 1e-12 && Math.abs(range[1] - point[i]!) < 1e-12));
  }
  const ranges = rotateRanges([[1, 1], [0, 0], [0, 0]], [0, Math.PI / 2]);
  assert(ranges[0]![0] <= -1 && ranges[0]![1] >= 0); assert(ranges[2]![0] <= -1 && ranges[2]![1] >= -1e-12);
  const partial = rotateRanges([[1, 1], null, [0, 0]], [0, 0]);
  assert.equal(partial[0], null); assert.deepEqual(partial[2], [-1, -1]);
});

test('a future action cannot select the convenient side of an uncertain prerequisite', () => {
  const learned = new LearnedAffordances();
  for (let i = 0; i < 128; i++) {
    const observation = { ...frame(i + 1), self: { ...frame(i + 1).self, properties: { signal: i % 2 } } };
    learned.observe(observation, i % 2 ? [] : [offer(observation)]);
  }
  const imagined: Observation = { ...frame(1000), self: { ...frame(1000).self, properties: { signal: .25 } },
    predictionSupport: ['self/properties.signal'], predictionBounds: { 'self/properties.signal': [0, 1] } };
  assert.equal(learned.imagined(imagined).length, 0);
  assert.equal(learned.imagined({ ...imagined, predictionBounds: { 'self/properties.signal': [0, .25] } }).length, 1);
});

test('a globally accurate small mean cannot overrule a missing context with incompatible responses', () => {
  const medium = new ExperienceMedium(41);
  for (let i = 0; i < 128; i++) {
    const before = { ...frame(i * 2 + 1), self: { ...frame(i * 2 + 1).self, properties: { sensedContext: i % 2 } } };
    medium.observe(measured(before, { ...frame(i * 2 + 2, i % 2 ? -.04 : 0),
      self: { ...frame(i * 2 + 2, i % 2 ? -.04 : 0).self, properties: before.self.properties } }));
  }
  const unseen = frame(1000), prediction = medium.predict(offer(unseen).cue, unseen);
  assert(!prediction.supportedFields.includes('self/position.2'));
  assert.equal(new ExperienceAgent(medium).plan(goal, unseen, [offer(unseen)]).steps.length, 0);
});

test('grounded gaze goals use the predicted visible role and its numeric possibility range', () => {
  const evaluator = new GroundedGoalEvaluatorV1(), observation: Observation = { ...frame(1), targetId: 'future-gaze',
    objects: [{ id: 'future-gaze', type: 'percept', relativePosition: [0, 0, -1], properties: { red: .3 } }],
    predictionSupport: ['targetId', 'object:future-gaze/properties.red'],
    predictionBounds: { 'object:future-gaze/properties.red': [.1, .4] } };
  evaluator.setGoal({ version: 'GroundedGoalV1', id: 'gaze', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'visible-property', subject: { kind: 'crosshair' }, observable: 'properties.red',
    comparator: 'greater-than', target: .2 } } }, frame(0));
  assert.equal(evaluator.evaluate(observation).status, 'mismatch');
  assert.equal(evaluator.evaluate({ ...observation, predictionBounds: { 'object:future-gaze/properties.red': [.25, .4] } }).status, 'satisfied');
  assert.equal(evaluator.evaluate({ ...observation, predictionSupport: ['targetId'] }).status, 'unknown');
});

test('imagined numeric envelopes cannot be learned as additional physical evidence', () => {
  const medium = new ExperienceMedium(41);
  assert.throws(() => medium.observe(measured(frame(1), { ...frame(2), predictionBounds: {} })), /imagined/);
  assert.equal(medium.writes, 0);
});
