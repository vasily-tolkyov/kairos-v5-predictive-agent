import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileSha } from '../src/util.js';
import { readFile } from 'node:fs/promises';
test('streamed file identity is byte-exact and independent of whole-file buffering', async () => {
  const path = new URL('../src/core/physics/physical-medium.js', import.meta.url);
  const bytes = await readFile(path);
  assert.equal(await fileSha(path.pathname.slice(1)), createHash('sha256').update(bytes).digest('hex'));
});
