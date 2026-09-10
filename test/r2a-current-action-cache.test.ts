import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedR2APhysicalPatternLearnerV2 } from '../src/core/learning/distributed-r2a-physical.js';
import { DistributedPredictionCloneV2 } from '../src/core/prediction/distributed-prediction-clone.js';
import { sha } from '../src/util.js';

test('current-action queries reuse exact seed batches, retain result isolation and expire on recovery', t => {
  const run = t.mock.method(DistributedPredictionCloneV2.prototype, 'run');
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  const before = sha(learner.snapshot());
  const first = learner.predictCurrentAction([], [], 'unseen-cue', [1n, 2n]);
  const second = learner.predictCurrentAction([], [], 'unseen-cue', [1n, 2n]);
  assert.deepEqual(first, second);
  assert.equal(run.mock.callCount(), 2, 'identical requests reran the physical seeds');
  (second as unknown[]).pop();
  assert.deepEqual(learner.predictCurrentAction([], [], 'unseen-cue', [1n, 2n]), first);
  assert.equal(run.mock.callCount(), 2);
  assert.equal(sha(learner.snapshot()), before, 'query changed stored physics');
  learner.predictCurrentAction([], [], 'unseen-cue', [2n, 1n]);
  assert.equal(run.mock.callCount(), 4, 'seed order is part of the exact request');
  learner.recover(.05);
  learner.predictCurrentAction([], [], 'unseen-cue', [2n, 1n]);
  assert.equal(run.mock.callCount(), 6, 'recovery retained a prior physical version');
});
