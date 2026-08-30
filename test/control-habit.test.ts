import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlHabitWeightsV1, type ControlHabitKeyV1 } from '../src/control/habit.js';

const key = (previousOperation: ControlHabitKeyV1['previousOperation'],
  nextOperation: ControlHabitKeyV1['nextOperation'], relation: ControlHabitKeyV1['relation']): ControlHabitKeyV1 =>
  ({ previousOperation, nextOperation, relation });
const dispatchExecute = (habit: ControlHabitWeightsV1, previous: ControlHabitKeyV1['previousOperation'],
  relation: ControlHabitKeyV1['relation']): number => {
  habit.recordDispatch({ operation: previous, relationsFromRecent: [] });
  return habit.recordDispatch({ operation: 'execute', relationsFromRecent: [relation] });
};

test('trusted real action progress strengthens only its nonsemantic eligibility trace', () => {
  const habit = new ControlHabitWeightsV1();
  const sequence = dispatchExecute(habit, 'predict-branch', 'same-node');
  const result = habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action',
    dispatchSequence: sequence, residualReduction: .8, predictionViolation: null });
  const expected = .05 * Math.exp(-1 / 4) * .8;
  assert.equal(result.applied, true);
  assert(Math.abs(habit.drive(key('predict-branch', 'execute', 'same-node')) - expected) < 1e-15);
  assert.equal(habit.drive(key('recall-effect', 'execute', 'same-node')), 0);
});

test('a matching high-support prediction violation weakens the eligible transition', () => {
  const habit = new ControlHabitWeightsV1();
  const positive = dispatchExecute(habit, 'predict-branch', 'same-node');
  habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: positive,
    residualReduction: 1, predictionViolation: null });
  habit.recordDispatch({ operation: 'predict-branch', relationsFromRecent:
    ['same-node', 'same-node'] });
  const negative = habit.recordDispatch({ operation: 'execute', relationsFromRecent:
    ['same-node', 'same-node', 'same-node'] });
  const before = habit.drive(key('predict-branch', 'execute', 'same-node'));
  const result = habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action',
    dispatchSequence: negative, residualReduction: 0,
    predictionViolation: { matched: true, highSupport: true, deviation: .25 } });
  assert.equal(result.applied, true);
  assert(habit.drive(key('predict-branch', 'execute', 'same-node')) < before);
  assert(result.negativeDelta > 0);
});

test('queries, simulations, no-effect actions and unsupported deviations do not learn', () => {
  const habit = new ControlHabitWeightsV1();
  const query = habit.recordDispatch({ operation: 'recall-effect', relationsFromRecent: [] });
  assert.deepEqual(habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action',
    dispatchSequence: query, residualReduction: 1,
    predictionViolation: { matched: true, highSupport: true, deviation: 1 } }),
  { applied: false, positiveDelta: 0, negativeDelta: 0, reason: 'non-execute-dispatch' });
  const action = habit.recordDispatch({ operation: 'execute', relationsFromRecent: ['root-to-branch'] });
  assert.deepEqual(habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action',
    dispatchSequence: action, residualReduction: 0,
    predictionViolation: { matched: true, highSupport: false, deviation: 1 } }),
  { applied: false, positiveDelta: 0, negativeDelta: 0, reason: 'no-learning-signal' });
  assert.equal(habit.exportCheckpoint().weights.length, 0);
});

test('habit weights are capped at 0.20 and never provide hard eligibility', () => {
  const habit = new ControlHabitWeightsV1();
  let lastSequence = 0;
  for (let index = 0; index < 32; index++) {
    if (index === 0) habit.recordDispatch({ operation: 'predict-branch', relationsFromRecent: [] });
    else habit.recordDispatch({ operation: 'predict-branch', relationsFromRecent:
      Array(Math.min(index * 2, 7)).fill('same-node') });
    lastSequence = habit.recordDispatch({ operation: 'execute', relationsFromRecent:
      Array(Math.min(index * 2 + 1, 7)).fill('same-node') });
    habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: lastSequence,
      residualReduction: 1, predictionViolation: null });
  }
  assert.equal(habit.drive(key('predict-branch', 'execute', 'same-node')), .20);
  assert.equal(typeof habit.drive(key('predict-branch', 'execute', 'same-node')), 'number');
  assert.equal('eligible' in (habit as unknown as object), false);
});

test('active experience time produces exact exponential recovery', () => {
  const habit = new ControlHabitWeightsV1();
  const sequence = dispatchExecute(habit, 'predict-branch', 'same-node');
  habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: sequence,
    residualReduction: 1, predictionViolation: null });
  const before = habit.drive(key('predict-branch', 'execute', 'same-node'));
  habit.advanceActiveTime(10_000);
  assert.equal(habit.exportCheckpoint().activeTimeSeconds, 10_000);
  assert(Math.abs(habit.drive(key('predict-branch', 'execute', 'same-node')) - before * Math.exp(-1e-5 * 10_000)) < 1e-15);
});

test('deterministic JSON restore preserves weights, time, traces and the next sequence', () => {
  const habit = new ControlHabitWeightsV1();
  const sequence = dispatchExecute(habit, 'compare-condition', 'root-to-branch');
  habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: sequence,
    residualReduction: .6, predictionViolation: null });
  habit.advanceActiveTime(123.5);
  const json = habit.exportDeterministicJson();
  const restored = ControlHabitWeightsV1.fromDeterministicJson(json);
  assert.equal(restored.exportDeterministicJson(), json);
  assert.equal(restored.recordDispatch({ operation: 'observe-public', relationsFromRecent: ['branch-to-root',
    'branch-to-root'] }), habit.recordDispatch({ operation: 'observe-public', relationsFromRecent:
    ['branch-to-root', 'branch-to-root'] }));
  assert.equal(restored.exportDeterministicJson(), habit.exportDeterministicJson());
});

test('checkpoint keys cannot contain semantic identifiers or extra fields', () => {
  const habit = new ControlHabitWeightsV1();
  const sequence = dispatchExecute(habit, 'predict-branch', 'parent-to-child');
  habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: sequence,
    residualReduction: 1, predictionViolation: null });
  const json = habit.exportDeterministicJson();
  for (const forbidden of ['minecraft', 'objectId', 'actionCue', 'goalId', 'pageId', 'coordinate'])
    assert.equal(json.includes(forbidden), false);
  const checkpoint = JSON.parse(json) as { weights: Array<{ key: Record<string, unknown> }> };
  checkpoint.weights[0]!.key.objectId = 'semantic-object';
  assert.throws(() => ControlHabitWeightsV1.restore(checkpoint), /control-habit-key-must-be-nonsemantic/);
});
