/**
 * Merge two independently captured, real-body foundation cohorts into one
 * empty physical memory.  The cohorts remain separate sessions; the offset is
 * only a replay clock so the physical recovery law sees monotonic experience
 * time.  No event is synthesized and no outcome is supplied by this script.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonical, fileSha, saveJson } from '../dist/src/util.js';
import { canonicalStreamSha256, writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';

const { values } = parseArgs({ options: { note0: { type: 'string' }, note1: { type: 'string' },
  capture: { type: 'string' }, output: { type: 'string' } } });
if (!values.output || (values.capture ? values.note0 || values.note1 : !values.note0 || !values.note1))
  throw new Error('replay-requires-one-continuous-capture-or-two-separated-cohorts');
const sourceDirs = values.capture ? [resolve(values.capture)] : [resolve(values.note0), resolve(values.note1)],
  output = resolve(values.output);
await mkdir(output, { recursive: false });

const loadCapture = async directory => {
  const audit = JSON.parse(await readFile(resolve(directory, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
  const eventsFile = resolve(directory, 'events.jsonl'), framesFile = resolve(directory, 'frames.jsonl');
  if (!audit.passed || audit.eventsSha256 !== await fileSha(eventsFile)
    || audit.framesSha256 !== await fileSha(framesFile)) throw new Error(`capture-audit-mismatch:${directory}`);
  const records = (await readFile(eventsFile, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const events = records.filter(record => record.kind === 'real-event').map(record => record.value);
  const clean = existsSync(resolve(directory, 'CLEAN_CAPTURE_RESULT.json'));
  const capture = JSON.parse(await readFile(resolve(directory, clean ? 'CLEAN_CAPTURE_RESULT.json' : 'CAPTURE_RESULT.json'), 'utf8'));
  const completed = clean ? !capture.failure && capture.capturedEpisodes === capture.expectedEpisodes
    && capture.realEvents === capture.expectedRealEvents : capture.completedCapture;
  const eventsPerEpisode = capture.eventsPerEpisode ?? 4;
  if (!completed || events.length === 0 || events.length % eventsPerEpisode !== 0)
    throw new Error(`capture-incomplete:${directory}`);
  return { directory, audit, events, capture, eventsPerEpisode };
};
const sources = await Promise.all(sourceDirs.map(loadCapture));
const firstMax = Math.max(...sources[0].events.flatMap(event => event.frames.map(frame => frame.activeSeconds)));
const clockOffset = sources.length === 1 ? 0 : firstMax + 10;
const events = sources.flatMap((source, sourceIndex) => source.events.map(event => {
  if (sourceIndex === 0) return event;
  const frames = event.frames.map(frame => ({ ...frame, activeSeconds: frame.activeSeconds + clockOffset }));
  return { ...event, frames };
}));

const memory = new DistributedHierarchicalPhysicalMemoryV1();
memory.beginR2AConsolidationBatchV1();
const explicitlyObservedClosures = new Map(sources.flatMap(source =>
  (source.capture.observedClosures ?? []).map(closure => [closure.afterEventId, closure])));
for (const [index, event] of events.entries()) {
  memory.observe(event);
  // A continuous successor is not an episode boundary.  Production observe()
  // closes the full four-atom episode on the final publicly-resolved observe.
  // Only the older two-atom capture needs its separately recorded, real stable
  // tail closure; applying that rule to every successor truncated the R2 chain
  // before the second interaction and left its result outside the learned road.
  const closure = explicitlyObservedClosures.get(event.id);
  if (closure) {
    if (canonical(event.frames.slice(-5).map(frame => frame.sequence)) !== canonical(closure.frameSequences))
      throw new Error(`recorded-closure-frame-mismatch:${event.id}`);
    memory.closeContinuity({ completion: 'complete', reason: closure.reason });
  }
  if ((index + 1) % 16 === 0) process.stdout.write(JSON.stringify({ realEvents: index + 1 }) + '\n');
}
const consolidation = memory.endR2AConsolidationBatchV1();
const snapshot = memory.snapshot();
const r2BySourceEventId = new Map(snapshot.r2.events.flatMap(event =>
  event.atomIds.map(atomId => [atomId.replace(/^r1:/, ''), event.eventId])));
const interventionPlans = sources.flatMap(source => (source.capture.pairAudits ?? [])
  .filter(pair => pair.otherPublicChannelsMatched)
  .map(pair => ({ version: 'DistributedR2AInterventionPairV2',
    baselineR2EventId: r2BySourceEventId.get(pair.baselineEventId),
    interventionR2EventId: r2BySourceEventId.get(pair.interventionEventId) })))
  .filter(plan => plan.baselineR2EventId && plan.interventionR2EventId);
// The useful factor experiment for the recursive note task is across the two
// independently prepared cohorts: same layout, orientation, public mode and
// exact action episode, with only the initial public note state changed.  This
// is a real matched intervention; no result label is supplied here.
const episodeCount = sources[0].events.length / sources[0].eventsPerEpisode;
const crossCohortPlans = sources.length === 2 && sources[1].events.length / sources[1].eventsPerEpisode === episodeCount
  ? Array.from({ length: episodeCount }, (_, index) => {
    const baselineEventId = sources[0].events[index * sources[0].eventsPerEpisode]?.id;
    const interventionEventId = sources[1].events[index * sources[1].eventsPerEpisode]?.id;
    return { version: 'DistributedR2AInterventionPairV2',
      baselineR2EventId: r2BySourceEventId.get(baselineEventId),
      interventionR2EventId: r2BySourceEventId.get(interventionEventId) };
  }).filter(plan => plan.baselineR2EventId && plan.interventionR2EventId)
  : [];
const pairedEpisodes = new Map();
if (sources.length === 1) for (const episode of sources[0].capture.episodes) {
  const key = `${episode.repetition}:${episode.layoutOrdinal}`;
  const pair = pairedEpisodes.get(key) ?? [];
  pair.push(episode); pairedEpisodes.set(key, pair);
}
const counterbalancedPlans = [...pairedEpisodes.values()].map(pair => {
  const baseline = pair.find(episode => episode.initialNote === 0);
  const intervention = pair.find(episode => episode.initialNote === 1);
  if (pair.length !== 2 || !baseline || !intervention) throw new Error('counterbalanced-pair-incomplete');
  return { version: 'DistributedR2AInterventionPairV2',
    baselineR2EventId: r2BySourceEventId.get(baseline.eventIds[0]),
    interventionR2EventId: r2BySourceEventId.get(intervention.eventIds[0]) };
});
const allInterventionPlans = counterbalancedPlans.length > 0 ? counterbalancedPlans
  : crossCohortPlans.length > 0 ? crossCohortPlans : interventionPlans;
const saved = writeSegmentedCanonicalFileSync(output, `experience-${String(events.length).padStart(4, '0')}.json`, snapshot,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
const envelope = { version: 'MergedGuidedMinecraftFoundationReplayV1', sourceDirectories: sourceDirs,
  sourceEventsSha256: sources.map(source => source.audit.eventsSha256),
  sourceFramesSha256: sources.map(source => source.audit.framesSha256), clockOffset,
  snapshotFile: `experience-${String(events.length).padStart(4, '0')}.json`, snapshotSha256: saved.manifest.sha256,
  manifestSha256: saved.manifestSha256, interventionPlans: allInterventionPlans,
  withinCohortInterventionPlans: interventionPlans, consolidation };
await saveJson(resolve(output, 'pre-intervention.json'), envelope);
await saveJson(resolve(output, 'REPLAY_RESULT.json'), {
  realEvents: events.length, r2Events: snapshot.r2.events.length,
  patterns: snapshot.r2a.patterns.length, relations: snapshot.r2a.relations.length,
  interventionPlans: allInterventionPlans.length, withinCohortInterventionPlans: interventionPlans.length,
  snapshotSha256: envelope.snapshotSha256,
  restoredExperience: false, gameCalls: 0, physicalHashes: {
    r1: canonicalStreamSha256(snapshot.r1Medium), r2: canonicalStreamSha256(snapshot.r2Medium),
    r2a: canonicalStreamSha256(snapshot.r2a.medium),
  },
});
console.log(canonical({ completed: true, realEvents: events.length,
  r2Events: snapshot.r2.events.length, interventionPlans: interventionPlans.length }));
