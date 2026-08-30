import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAction } from '../src/action-contract.js';

test('primitive action parameters and current public target identity remain exact', () => {
  assert.doesNotThrow(() => validateAction({ kind: 'move', parameters: { direction: 'left', ticks: 4 } }));
  assert.doesNotThrow(() => validateAction({ kind: 'interact', parameters: {}, targetId: 'public-object-1' }));
  assert.throws(() => validateAction({ kind: 'move', parameters: { direction: 'left', ticks: 4, answer: true } }),
    /action-parameters-not-exact/);
  assert.throws(() => validateAction({ kind: 'interact', parameters: {} }), /action-target-not-exact/);
  assert.throws(() => validateAction({ kind: 'look', parameters: { yawDegrees: 0 } }), /action-parameters-not-exact/);
});
