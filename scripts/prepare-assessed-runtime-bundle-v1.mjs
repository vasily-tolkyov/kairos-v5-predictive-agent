/** Repackage an existing assessed snapshot; never restore, learn or remeasure it. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256, writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';
import { fileSha, saveJson } from '../dist/src/util.js';
const [source, output] = process.argv.slice(2);
await mkdir(output, { recursive: false });
const sourcePointer = resolve(source, 'EXPERIENCE_LATEST.json');
const pointerHash = await fileSha(sourcePointer);
const pointer = JSON.parse(await readFile(sourcePointer, 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(source, pointer.filename));
assert.equal(canonicalStreamSha256(snapshot), pointer.sha256);
assert.equal(snapshot.seenEventIds.length, pointer.eventCount);
const filename = `experience-${pointer.eventCount.toString().padStart(4, '0')}.json`;
const bundle = writeSegmentedCanonicalFileSync(output, filename, snapshot,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
assert.equal(bundle.manifest.sha256, pointer.sha256);
await saveJson(resolve(output, 'EXPERIENCE_LATEST.json'), { ...pointer, filename,
  manifestSha256: bundle.manifestSha256 });
assert.equal(await fileSha(sourcePointer), pointerHash);
await saveJson(resolve(output, 'REPACKAGE_AUDIT.json'), { source: resolve(source),
  sourcePointerSha256: pointerHash, canonicalSnapshotSha256: pointer.sha256,
  sameSnapshot: true, originalUnchanged: true, learning: 0, physicsQueries: 0, gameCalls: 0,
  reason: 'assessment-suffix-was-not-a-runtime-snapshot-filename' });
console.log(JSON.stringify({ filename, sameSnapshot: true, sha256: pointer.sha256 }));
