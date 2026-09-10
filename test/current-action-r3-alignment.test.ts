import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distributedR2APhysicalApplicabilityCacheKeyV1 } from '../src/core/learning/distributed-r2a-physical.js';

test('R3 candidate cache distinguishes actual prefix amplitudes, motor cue and exact seed stream', () => {
  const input = { sourceR2PrefixDrives: [{ siteId: 7, intensity: .4 }],
    exactActionIdentity: 'opaque-a', seeds: [1n, 2n] };
  // Reflect permits this regression to run against the old three-argument API.
  const key = (value: unknown) => Reflect.apply(distributedR2APhysicalApplicabilityCacheKeyV1,
    undefined, [3, 'relation', ['signal'], value]);
  assert.notEqual(key(input), key(undefined));
  assert.notEqual(key(input), key({ ...input, sourceR2PrefixDrives: [{ siteId: 7, intensity: .5 }] }));
  assert.notEqual(key(input), key({ ...input, exactActionIdentity: 'opaque-b' }));
  assert.notEqual(key(input), key({ ...input, seeds: [2n, 1n] }));
  assert.equal(key(input), key(structuredClone(input)));
});

test('condition and prediction adapters prepare one current-action input, not a historical continuation', () => {
  const memory = readFileSync('src/distributed-hierarchical-memory.ts', 'utf8');
  const condition = memory.slice(memory.indexOf('\n  compareConditions('), memory.indexOf('\n  #annotationFor('));
  const prediction = memory.slice(memory.indexOf('\n  #predictCandidate('), memory.indexOf('\n  #emptyBranch('));
  assert.match(condition, /#currentActionInput\(/);
  assert.match(prediction, /#currentActionInput\(/);
  assert.match(prediction, /#evidence\(annotation,.*currentAction/s);
});
