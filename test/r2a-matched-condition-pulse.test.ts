import assert from 'node:assert/strict';
import test from 'node:test';
import { distributedR2AMatchedConditionPulseV1 }
  from '../src/core/learning/distributed-r2a-physical.js';

test('factor ablation retains every other measured condition and its amplitude', () => {
  const current = [{ siteId: 1, intensity: .125 }, { siteId: 2, intensity: .25 },
    { siteId: 5, intensity: .0625 }];
  const before = structuredClone(current);
  assert.deepEqual(distributedR2AMatchedConditionPulseV1(current, new Set([1, 3])),
    [{ siteId: 2, intensity: .25 }, { siteId: 5, intensity: .0625 }]);
  assert.deepEqual(current, before);
});

test('a state contrast substitutes only the measured variable, not the complete context', () => {
  const current = [{ siteId: 1, intensity: .125 }, { siteId: 2, intensity: .25 }];
  const alternative = [{ siteId: 3, intensity: .0625 }];
  assert.deepEqual(distributedR2AMatchedConditionPulseV1(current, new Set([1, 3]), alternative),
    [{ siteId: 2, intensity: .25 }, { siteId: 3, intensity: .0625 }]);
  assert.deepEqual(alternative, [{ siteId: 3, intensity: .0625 }]);
});

test('an unknown alternative is an ablation, not a unit-strength invented input', () => {
  assert.deepEqual(distributedR2AMatchedConditionPulseV1(
    [{ siteId: 2, intensity: .25 }], new Set([1, 3])), [{ siteId: 2, intensity: .25 }]);
});
