import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KAIROS_V5_COMPATIBILITY } from '../src/core/compatibility.js';

test('README names the canonical V5 protocol identities from the source registry', async () => {
  const readme = await readFile(resolve('README.md'), 'utf8');
  for (const value of Object.values(KAIROS_V5_COMPATIBILITY)) {
    assert.match(readme, new RegExp(`\\x60${value}\\x60`),
      `README is missing canonical protocol identity ${value}`);
  }
});
