import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonical, fileSha, saveJson } from '../dist/src/util.js';
const output = resolve(process.argv[2] ?? 'evidence/current-two-stage-note-experience-v2');
const pointer = JSON.parse(await readFile(resolve(output, 'EXPERIENCE_LATEST.json'), 'utf8'));
const snapshot = JSON.parse(await readFile(resolve(output, pointer.filename), 'utf8'));
const r1 = JSON.parse(await readFile(resolve(output, `${pointer.filename.replace(/\.json$/, '.segments')}/r1.json`), 'utf8'));
const r2 = JSON.parse(await readFile(resolve(output, `${pointer.filename.replace(/\.json$/, '.segments')}/r2.json`), 'utf8'));
const r2a = JSON.parse(await readFile(resolve(output, `${pointer.filename.replace(/\.json$/, '.segments')}/r2a.p-000005.json`), 'utf8'));
await saveJson(resolve(output, 'REBUILD_RESULT.json'), {
  version: 'TwoStageNoteExperienceRebuildV1', inputSnapshotImported: false,
  oldRealEvents: 128, stageRealEvents: 2, r1Atoms: r1.records.length,
  r2Events: r2.events.length, r2aPatterns: r2a.patterns.length,
  r2aRelations: r2a.relations.length, snapshotSha256: pointer.sha256,
  snapshotManifestSha256: pointer.manifestSha256, pointerSha256: await fileSha(resolve(output, 'EXPERIENCE_LATEST.json')),
  sourceCapture: 'current-single-interaction-foundation-v2 plus current-guided-note-two-stage-training-v4',
});
console.log(canonical({ completed: true, eventCount: pointer.eventCount, r1Atoms: r1.records.length,
  r2Events: r2.events.length, patterns: r2a.patterns.length, snapshotSha256: pointer.sha256 }));
