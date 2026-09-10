import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { writeSegmentedCanonicalFileSync } from '../src/util-stream.js';

test('page packing visits growing data linearly and preserves the recorded legacy manifest exactly', async () => {
  const root = resolve(process.cwd());
  const directory = await mkdtemp(resolve(root, '.tmp-linear-paging-'));
  try {
    const count = 192;
    let visits = 0;
    const item = (index: number) => ({ index, get payload() { visits++; return 'x'.repeat(1024); } });
    const snapshot = { version: 'PrefixByteCountReproductionV1', seenEventIds: [], writes: 0,
      array: Array.from({ length: count }, (_, index) => item(index)),
      object: Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, item(index)])) };
    const result = writeSegmentedCanonicalFileSync(directory, 'experience.json', snapshot,
      { segmentLimitBytes: 96 * 1024, pageLimitBytes: 64 * 1024 });
    // Measured with the unmodified production writer before this repair. This
    // identity binds page names, boundaries, byte counts and every page hash.
    assert.equal(result.manifestSha256, 'a13fa41c49c81395a8c23f86ab079605ca8b44eccc38147afc10fa8743dcb833');
    assert(visits <= count * 2 * 15, `quadratic-prefix-visits:${visits}`);
  } finally {
    assert(directory.startsWith(root + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
