import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Bounded software differential check against an explicitly pinned old build.
// Vary partitions, missing channels, capacities, window sizes and eviction;
// no environment simulator, real action or new independent evidence exists.
const [oldBuild, newBuild, output] = process.argv.slice(2);
assert(output, 'usage: PINNED_OLD_DIST NEW_DIST NEW_RESULT_JSON');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const oldPath = resolve(oldBuild, 'src/contextual-readout.js'), newPath = resolve(newBuild, 'src/contextual-readout.js');
const [{ ContextualReadout: Old }, { ContextualReadout: New }] = await Promise.all([
  import(pathToFileURL(oldPath).href), import(pathToFileURL(newPath).href) ]);
const result = { version: 'ContextWindowRefreshDifferential1', status: 'running',
  oldModule: { path: oldPath, sha256: hash(await readFile(oldPath)) },
  newModule: { path: newPath, sha256: hash(await readFile(newPath)) },
  cases: [], checkedWindows: 0, checkedQueries: 0, failure: null,
  scope: 'Synthetic software equivalence only. Original grouped errors, retained rows, structures, reads and support must agree; no native evidence or changed calibration threshold.' };
let position;
try {
  for (const capacity of [32, 48, 192]) {
    const old = new Old(capacity), candidate = new New(capacity);
    for (let window = 0; window < 64; window++) {
      position = { capacity, window };
      const rows = Array.from({ length: 3 + (window * 7 % 15) }, (_, i) => {
        const n = window * 19 + i;
        const input = Object.fromEntries(Array.from({ length: 12 }, (_, axis) => ['x/' + axis, (n * (axis + 1) % 17) / 4]));
        input.category = ['a', 'b', 'c'][n % 3];
        if (n % 5 === 0) delete input['x/3'];
        if (window > 23 && window < 51) input.late = n % 7;
        const targets = Array.from({ length: 10 }, (_, k) => ['y/' + k, 0,
          n % (k + 3) < (k + 3) / 2 ? (n % 3) - 1 : ((window + k) % 4)]);
        if (n % 4) targets.push(['sparse-category', null, n % 2 ? 'open' : 'closed']);
        const externalErrors = Object.fromEntries(targets.map(([key], k) => [key, (n + k) % 11 ? 0 : 2]));
        return { input, targets, externalErrors };
      });
      old.observeWindow('shared-circuit', 'original-window:' + window, rows);
      candidate.observeWindow('shared-circuit', 'original-window:' + window, rows);
      assert.deepEqual(candidate.snapshot(), old.snapshot(), 'posterior rows or partition shape changed');
      for (const query of [rows[0].input, rows.at(-1).input, { category: 'unseen' }, { ...rows[0].input, 'x/0': 12 }])
        for (const key of ['y/0', 'y/4', 'y/9', 'sparse-category']) {
          assert.deepEqual(candidate.read('shared-circuit', key, query), old.read('shared-circuit', key, query));
          result.checkedQueries++;
        }
      result.checkedWindows++;
    }
    result.cases.push({ capacity, windows: 64, finalDigest: hash(JSON.stringify(candidate.snapshot())) });
  }
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.failure = { ...position, message: String(error.message).slice(0, 4000) }; }
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
assert.equal(result.status, 'passed', 'window-refresh comparison failed; preserve the result');
