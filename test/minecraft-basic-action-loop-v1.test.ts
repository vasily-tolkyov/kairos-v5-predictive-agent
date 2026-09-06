import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { MINECRAFT_BASIC_ACTION_LOOP_V1 } from '../src/evaluation/minecraft-basic-action-loop-v1.js';

test('basic action loop limits live actions to harmless public controls', async () => {
  assert.equal(MINECRAFT_BASIC_ACTION_LOOP_V1.maxActions, 16);
  assert.deepEqual([...MINECRAFT_BASIC_ACTION_LOOP_V1.forbiddenKinds], ['attack', 'break', 'place']);
  assert(MINECRAFT_BASIC_ACTION_LOOP_V1.allowedKinds.includes('interact'));
});

test('basic action runner keeps fixture setup outside the generic prototype', async () => {
  const runner = await readFile(resolve('src', 'evaluation', 'minecraft-basic-action-loop-v1.ts'), 'utf8');
  const prototype = await readFile(resolve('src', 'prototype.ts'), 'utf8');
  assert.match(runner, /controllerAccess: false/);
  assert.match(runner, /runtime\.exploreUntil/);
  assert.doesNotMatch(runner, /runtime\?\.writes \?\? 0\) === 0/);
  assert.doesNotMatch(prototype, /mineflayer|MinecraftBody|Services|viewer\.mjs|dashboard\.js/);
});
