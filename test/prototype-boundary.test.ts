import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('prototype public surface has no live Minecraft dependency', async () => {
  const source = await readFile(resolve('src', 'prototype.ts'), 'utf8');
  assert.doesNotMatch(source, /mineflayer|MinecraftBody|Services|viewer\.mjs|dashboard\.js/);
  const prototype = await import('../src/prototype.js');
  assert.equal(typeof prototype.ExperienceMedium, 'function');
  assert.equal(typeof prototype.ExperienceAgent, 'function');
  assert.equal(typeof prototype.GroundedGoalEvaluatorV1, 'function');
  assert.equal('DistributedHierarchicalPhysicalMemoryV1' in prototype, false);
  assert.equal('MinecraftBody' in prototype, false);
  assert.equal('Services' in prototype, false);
});
