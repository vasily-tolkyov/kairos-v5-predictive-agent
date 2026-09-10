import assert from 'node:assert/strict';
import test from 'node:test';
import { compactLiveStatusV1, parseRunOptions } from '../src/main.js';

test('a live action budget is explicit and does not prescribe an action', () => {
  assert.equal(parseRunOptions(['--bootstrap-only', '--max-actions', '8']).maxActions, 8);
  assert.equal(parseRunOptions([]).maxActions, null);
  assert.throws(() => parseRunOptions(['--max-actions', '0']), /positive-integer/);
});

test('terminal output excludes growing fields and attention windows, leaving originals untouched', () => {
  const input = { lastDecision: { operation: 'predict-branch', nodeId: 'b1', converged: true },
    field: new Array(10000).fill({ activation: 1 }) };
  const before = JSON.stringify(input);
  assert(JSON.stringify(compactLiveStatusV1('joint-control-decision', input)).length < 256);
  assert.equal(compactLiveStatusV1('joint-control-attention', input), null);
  assert.equal(JSON.stringify(input), before);
});
