/** Rebuild a new physical snapshot only from sealed real frames/events.
 * No prior snapshot is imported; the older 128-event capture and the two
 * newly captured stage events are replayed through production memory. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonical, fileSha, saveJson } from '../dist/src/util.js';
import { writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';

const oldDir = resolve(process.argv[2] ?? 'evidence/current-single-interaction-foundation-v2');
const stageDir = resolve(process.argv[3] ?? 'evidence/current-guided-note-two-stage-training-v3');
const output = resolve(process.argv[4] ?? 'evidence/current-two-stage-note-experience-v1');
await mkdir(output, { recursive: false });
const readJsonl = async path => (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const oldAudit = JSON.parse(await readFile(resolve(oldDir, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!oldAudit.passed || oldAudit.eventsSha256 !== await fileSha(resolve(oldDir, 'events.jsonl'))
  || oldAudit.framesSha256 !== await fileSha(resolve(oldDir, 'frames.jsonl')))
  throw new Error('old-capture-frame-audit-failed');
const stageResult = JSON.parse(await readFile(resolve(stageDir, 'TRAINING_RESULT.json'), 'utf8'));
if (stageResult.failure || stageResult.events !== 2
  || stageResult.eventsSha256 !== await fileSha(resolve(stageDir, 'events.jsonl'))
  || stageResult.framesSha256 !== await fileSha(resolve(stageDir, 'frames.jsonl')))
  throw new Error('two-stage-capture-not-complete');
const oldRecords = await readJsonl(resolve(oldDir, 'events.jsonl'));
const stageRecords = await readJsonl(resolve(stageDir, 'events.jsonl'));
const oldEvents = oldRecords.filter(record => record.kind === 'real-event').map(record => record.value);
const stageEvents = stageRecords.filter(record => record.kind === 'real-event').map(record => record.value);
const stageEventIds = new Set(stageEvents.map(event => event.id));
if (oldEvents.length !== 128 || stageEvents.length !== 2) throw new Error('unexpected-real-event-count');
const oldCapture = JSON.parse(await readFile(resolve(oldDir, 'CAPTURE_RESULT.json'), 'utf8'));
const closures = new Map((oldCapture.observedClosures ?? []).map(value => [value.afterEventId, value]));
const oldFrameHashes = new Set((await readJsonl(resolve(oldDir, 'frames.jsonl'))).map(record => JSON.stringify(record.value)));
const stageFrameHashes = new Set((await readJsonl(resolve(stageDir, 'frames.jsonl'))).map(record => JSON.stringify(record.value)));
for (const event of [...oldEvents, ...stageEvents]) {
  if (!event.complete || !event.frames.length) throw new Error(`incomplete-real-event:${event.id}`);
  const frameSet = stageEventIds.has(event.id) ? stageFrameHashes : oldFrameHashes;
  if (event.frames.some(frame => !frameSet.has(JSON.stringify(frame)))) throw new Error(`event-frame-not-in-source:${event.id}`);
}
const memory = new DistributedHierarchicalPhysicalMemoryV1();
memory.beginR2AConsolidationBatchV1();
for (const event of oldEvents) {
  memory.observe(event);
  const closure = closures.get(event.id);
  if (closure) {
    const tail = event.frames.slice(-5);
    if (canonical(tail.map(frame => frame.sequence)) !== canonical(closure.frameSequences))
      throw new Error(`old-closure-boundary-mismatch:${event.id}`);
    memory.closeContinuity({ completion: 'complete', reason: closure.reason });
  }
}
for (const event of stageEvents) {
  memory.observe(event);
  memory.closeContinuity({ completion: 'complete', reason: 'normal-stop-after-public-stability' });
}
const consolidation = memory.endR2AConsolidationBatchV1();
const snapshot = memory.snapshot();
const saved = writeSegmentedCanonicalFileSync(output, 'experience-0130.json', snapshot,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
const pointer = { actions: 130, eventCount: 130, filename: 'experience-0130.json',
  manifestSha256: saved.manifestSha256, runtimeVersion: 'KairosV5DistributedPhysicalRuntimeV1',
  sha256: saved.manifest.sha256, sourceContextVersion: 'V5PublicRelativeLayoutV1', writes: memory.writes };
await saveJson(resolve(output, 'EXPERIENCE_LATEST.json'), pointer);
await saveJson(resolve(output, 'REBUILD_RESULT.json'), {
  version: 'TwoStageNoteExperienceRebuildV1', inputSnapshotImported: false,
  oldRealEvents: oldEvents.length, stageRealEvents: stageEvents.length,
  r1Atoms: snapshot.r1Atoms.length, r2Events: snapshot.r2.events.length,
  r2aPatterns: snapshot.r2a.patterns.length, r2aRelations: snapshot.r2a.relations.length,
  consolidation, pointer, oldEventsSha256: oldAudit.eventsSha256,
  oldFramesSha256: oldAudit.framesSha256, stageEventsSha256: stageResult.eventsSha256,
  stageFramesSha256: stageResult.framesSha256,
});
console.log(canonical({ completed: true, oldRealEvents: oldEvents.length,
  stageRealEvents: stageEvents.length, r2Events: snapshot.r2.events.length,
  patterns: snapshot.r2a.patterns.length, pointerSha256: saved.manifest.sha256 }));
