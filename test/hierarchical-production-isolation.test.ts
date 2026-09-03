import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('production worker uses the hierarchical memory and legacy evaluators are audit-only commands', async () => {
  const [worker, packageText] = await Promise.all([
    readFile(resolve('src/worker.ts'), 'utf8'),
    readFile(resolve('package.json'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageText) as { scripts: Record<string, string> };

  assert.match(worker, /HierarchicalPhysicalMemoryV1 as PhysicalMemory/);
  assert.doesNotMatch(worker, /from ['"]\.\/memory\.js['"]/,
    'production worker still imports the retired immediate R2/R2A pipeline');
  const legacyMinecraftEntries = Object.entries(packageJson.scripts)
    .filter(([, command]) => /run-minecraft-(guided|joint|note|multilevel)|rebuild-attempt017/.test(command));
  assert(legacyMinecraftEntries.length > 0);
  assert(legacyMinecraftEntries.every(([name]) => name.startsWith('audit:legacy:')),
    'a legacy single-action/R2 pipeline is still exposed as a production training or evaluation command');
});
