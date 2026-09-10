import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { counterbalancedNoteStatesV1, expectedNoteMilestonesV1, balancedSingleTransitionStatesV1 }
  from '../src/evaluation/note-progression-test-contract.js';

test('new missing transition is taught in separate reset episodes, counterbalanced with its neighbour', () => {
  for (let layout = 0; layout < 8; layout++) {
    const first = counterbalancedNoteStatesV1(1, 0, layout);
    const second = counterbalancedNoteStatesV1(1, 1, layout);
    assert.deepEqual([...first].reverse(), second);
    assert.deepEqual([...first].sort(), [1, 2]);
  }
  assert.deepEqual(counterbalancedNoteStatesV1(0, 0, 0), [0, 1]);
});

test('three-step goal and changed initial state have different post-hoc milestones', () => {
  assert.deepEqual(expectedNoteMilestonesV1(0, 3), [
    { before: '0', after: '1' }, { before: '1', after: '2' }, { before: '2', after: '3' },
  ]);
  assert.deepEqual(expectedNoteMilestonesV1(1, 3), [
    { before: '1', after: '2' }, { before: '2', after: '3' },
  ]);
  assert.deepEqual(expectedNoteMilestonesV1(3, 3), []);
  assert.throws(() => expectedNoteMilestonesV1(2, 1));
  assert.throws(() => counterbalancedNoteStatesV1(23, 0, 0));
});

test('runtime fixture never imports the expected action milestone scorer', () => {
  const runner = readFileSync('scripts/run-current-grounded-minecraft-note-v1.mjs', 'utf8');
  assert.equal(runner.includes('expectedNoteMilestones'), false);
  const tail = runner.slice(runner.indexOf("record('final-goal-injected'"));
  assert.match(tail, /runtime\.runGoal\(goal\)/);
  assert.equal(tail.includes('services.command('), false);
  assert.equal(tail.includes('body.execute('), false);
});

test('balanced rehearsal gives each isolated transition 32 examples without a three-action episode', () => {
  const totals = new Map<number, number>();
  const orders = new Set<string>();
  for (let repetition = 0; repetition < 4; repetition++) {
    for (let layout = 0; layout < 8; layout++) {
      const order = balancedSingleTransitionStatesV1([0, 1, 2], repetition, layout);
      assert.deepEqual([...order].sort(), [0, 1, 2]);
      assert.deepEqual(order, balancedSingleTransitionStatesV1([0, 1, 2], repetition, layout));
      orders.add(order.join(','));
      for (const value of order) totals.set(value, (totals.get(value) ?? 0) + 1);
    }
  }
  assert.deepEqual([...totals].sort(), [[0, 32], [1, 32], [2, 32]]);
  assert.equal(orders.size, 6);
  assert.throws(() => balancedSingleTransitionStatesV1([0, 0], 0, 0));
  assert.throws(() => balancedSingleTransitionStatesV1([0, 24], 0, 0));
  const capture = readFileSync('scripts/capture-clean-note-progression-live-v1.mjs', 'utf8');
  assert.match(capture, /explicit-rehearsal-requires-single-transitions-without-pair-mode/);
  assert.match(capture, /for \(const episode of episodes\) \{[\s\S]*prepareGuidedNoteFixtureLiveV1/);
  assert.match(capture, /index === 0 \? 'reset' : 'continuous'/);
});
