/** Physical learning from sealed real frames, with no game or simulator writes. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonical, fileSha, saveJson } from '../dist/src/util.js';
import { writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
if (!values.input || !values.output) throw new Error('replay-requires-capture-and-new-output');
const input = resolve(values.input), output = resolve(values.output);
await mkdir(output, { recursive: false });
const loadedCodeFiles = [
  'dist/src/distributed-hierarchical-memory.js', 'dist/src/events.js',
  'dist/src/core/learning/self-organizing-afferent.js', 'dist/src/core/learning/distributed-r1.js',
  'dist/src/core/learning/distributed-r2.js', 'dist/src/core/learning/distributed-r2a-physical.js',
  'dist/src/core/physics/distributed-physical-medium.js',
  'dist/src/core/physics/distributed-medium-probe-parallel.js',
  'dist/src/core/prediction/distributed-prediction-clone.js', 'dist/src/util-stream.js',
];
await saveJson(resolve(output, 'CODE_INPUTS.json'), {
  capturedBeforeReplay: true,
  files: await Promise.all(loadedCodeFiles.map(async path => ({ path, sha256: await fileSha(path) }))),
});
const audit = JSON.parse(await readFile(resolve(input, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(input, 'events.jsonl'))
  || audit.framesSha256 !== await fileSha(resolve(input, 'frames.jsonl')))
  throw new Error('replay-requires-unchanged-verified-raw-frames-and-receipts');
const events = (await readFile(resolve(input, 'events.jsonl'), 'utf8')).trim().split('\n')
  .map(line => JSON.parse(line)).filter(record => record.kind === 'real-event').map(record => record.value);
const capture = JSON.parse(await readFile(resolve(input, 'CAPTURE_RESULT.json'), 'utf8'));
const observedClosures = new Map((capture.observedClosures ?? []).map(value => [value.afterEventId, value]));
const memory = new DistributedHierarchicalPhysicalMemoryV1();
const started = performance.now();
memory.beginR2AConsolidationBatchV1();
for (const [index, event] of events.entries()) {
  memory.observe(event);
  const closure = observedClosures.get(event.id);
  if (closure) {
    const tail = event.frames.slice(-5);
    if (canonical(tail.map(frame => frame.sequence)) !== canonical(closure.frameSequences))
      throw new Error('replay-closure-frame-boundary-mismatch');
    // The capture's raw frame/receipt audit above binds this explicit normal
    // stop to its observed window. No old four-action event is resegmented.
    memory.closeContinuity({ completion: 'complete', reason: closure.reason });
  }
  if ((index + 1) % 4 === 0) process.stdout.write(JSON.stringify({ realEvents: index + 1,
    durationMs: performance.now() - started }) + '\n');
}
const consolidation = memory.endR2AConsolidationBatchV1();
const snapshot = memory.snapshot();
const r2ForFirstAtom = id => {
  const matches = snapshot.r2.events.filter(event => event.sourceEventIds[0] === id);
  if (matches.length !== 1) throw new Error(`replay-no-unique-continuous-event:${id}`);
  return matches[0].eventId;
};
// A failed public match is retained as correlation, never relabelled intervention.
const interventionPlans = capture.pairAudits.filter(pair => pair.otherPublicChannelsMatched)
  .map(pair => ({ version: 'DistributedR2AInterventionPairV2',
    baselineR2EventId: r2ForFirstAtom(pair.baselineEventId),
    interventionR2EventId: r2ForFirstAtom(pair.interventionEventId) }));
const saved = writeSegmentedCanonicalFileSync(output, 'experience-0128.json', snapshot,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
const envelope = { version: 'GuidedMinecraftPreInterventionReplayV1',
  sourceEventsSha256: audit.eventsSha256, sourceFramesSha256: audit.framesSha256,
  snapshotFile: 'experience-0128.json', snapshotSha256: saved.manifest.sha256,
  manifestSha256: saved.manifestSha256, interventionPlans, consolidation };
await saveJson(resolve(output, 'pre-intervention.json'), envelope);
await saveJson(resolve(output, 'REPLAY_RESULT.json'), {
  realEvents: events.length, writes: memory.writes, r2Events: snapshot.r2.events.length,
  patterns: snapshot.r2a.patterns.length, relations: snapshot.r2a.relations.length,
  matchedInterventionPlans: interventionPlans.length, snapshotSha256: envelope.snapshotSha256,
  durationMs: performance.now() - started, sourceEventsSha256: audit.eventsSha256,
  inputSnapshotImported: false, currentGameCalls: 0,
});
console.log(canonical({ completed: true, realEvents: events.length,
  r2Events: snapshot.r2.events.length, interventionPlans: interventionPlans.length }));
