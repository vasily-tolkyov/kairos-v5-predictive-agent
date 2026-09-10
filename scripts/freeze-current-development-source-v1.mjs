/** Record source identity for a new local development attempt, without packaging. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileSha, sha } from '../dist/src/util.js';
const [previousManifest, output] = process.argv.slice(2);
if (!output) throw new Error('previous-source-manifest-and-new-output-required');
const previous = JSON.parse(await readFile(previousManifest, 'utf8'));
const paths = new Set(previous.entries.map(entry => entry.path.replaceAll('\\', '/')));
async function visit(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name).replaceAll('\\', '/');
    if (item.isDirectory()) await visit(path);
    else if (item.isFile()) paths.add(path);
  }
}
for (const root of ['src', 'test', 'scripts', 'docs']) await visit(root);
const entries = [];
for (const path of [...paths].sort()) entries.push({ path, sha256: await fileSha(path) });
const result = { git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirtyPreserved: true, entries, identity: sha(entries) };
await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ identity: result.identity, files: entries.length }));
