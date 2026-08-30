import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('production controller is a thin joint-field loop rather than a staged cognition script', async () => {
  const source = await readFile(resolve('src/control/controller.ts'), 'utf8');
  assert.match(source, /JointTransientControlFieldV2/);
  assert.doesNotMatch(source, /parentFrames|resumeParent|body-target-affordance/);
  assert.doesNotMatch(source, /recalled\s*===\s*null|conditions\.has\(|predictions\.has\(/);
  assert.doesNotMatch(source, /setOperationInputs\s*\(/);
  assert.doesNotMatch(source, /cycles\s*<\s*4096|joint-control-event-wait-expired|setTimeout\s*\(/);
  assert.match(source, /waitForObservationAfter\(observation\.sequence\)/);
});

test('production runtime connects public action requirements and event waiting to the body', async () => {
  const source = await readFile(resolve('src/runtime.ts'), 'utf8');
  assert.match(source, /body\.describeActionRequirement\(actionCue, observation\)/);
  assert.match(source, /body\.waitForObservationAfter\(sequence\)/);
});

test('condition comparison is an independently represented control operation', async () => {
  const contracts = await readFile(resolve('src/control/contracts.ts'), 'utf8');
  assert.match(contracts, /'compare-condition'/);
  assert.match(contracts, /'observe-public'/);
  assert.doesNotMatch(contracts, /'observe-explore'/);
});
