/** Assess actual matched trials; never insert expected result or grade labels. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonicalStreamSha256, writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';
import { saveJson, fileSha } from '../dist/src/util.js';
import { KAIROS_V5_RUNTIME_VERSION, KAIROS_V5_CONTEXT_VERSION } from '../dist/src/core/compatibility.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
  first: { type: 'boolean' }, 'no-save': { type: 'boolean' }, capture: { type: 'string' } } });
if (!values.input || !values.output) throw new Error('assessment-requires-input-and-new-output');
const input = resolve(values.input), output = resolve(values.output);
await mkdir(output, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(input, 'pre-intervention.json'), 'utf8'));
const beforeFile = await fileSha(resolve(input, declaration.snapshotFile));
const { snapshot } = await loadSnapshotFromDisk(resolve(input, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256)
  throw new Error('physical-foundation-snapshot-mismatch');
let runtimeMetadata;
if (values.capture) {
  const capture = resolve(values.capture);
  const audit = JSON.parse(await readFile(resolve(capture, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
  const raw = await readFile(resolve(capture, 'events.jsonl'), 'utf8');
  if (!audit.passed || audit.eventsSha256 !== declaration.sourceEventsSha256
    || audit.eventsSha256 !== await fileSha(resolve(capture, 'events.jsonl'))
    || audit.framesSha256 !== await fileSha(resolve(capture, 'frames.jsonl')))
    throw new Error('runtime-pointer-requires-original-verified-capture');
  const events = raw.trim().split('\n').map(line => JSON.parse(line))
    .filter(record => record.kind === 'real-event').map(record => record.value);
  const sourceIds = new Set(events.map(event => event.id));
  if (sourceIds.size !== events.length || sourceIds.size !== snapshot.seenEventIds.length
    || snapshot.seenEventIds.some(id => !sourceIds.has(id)))
    throw new Error('runtime-pointer-event-provenance-mismatch');
  runtimeMetadata = { actions: events.filter(event => event.provenance === 'executed-real-body'
      && event.bodyResult?.executed === true).length,
    eventCount: snapshot.seenEventIds.length, writes: snapshot.writes };
}
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const restoredSha256 = canonicalStreamSha256(memory.snapshot());
if (restoredSha256 !== declaration.snapshotSha256) throw new Error('physical-restore-not-exact');
const summary = state => ({
  patterns: state.r2a.patterns.map(p => ({ id: p.patternId, basin: p.physicalBranchId,
    members: p.memberR2EventIds.length, contexts: p.contextIds.length,
    support: p.supportCount, contradictions: p.contradictionCount, grade: p.grade,
    core: p.attractor.coreSiteIds.length, dwell: p.attractor.dwellSteps,
    escape: p.attractor.escapeRate, ambiguous: p.attractor.ambiguous,
    forward: p.corridor.forwardPropagationRate, reverse: p.corridor.reverseRejectionRate })),
  relations: state.r2a.relations.map(r => ({ id: r.relationId, patternId: r.patternId,
    grade: r.grade, support: r.supportCount, contradictions: r.contradictionCount,
    pairs: r.matchedInterventionCount, correctPairs: r.physicallyCorrectInterventionCount,
    full: r.meanFullFactorSelectionRate, ablationLoss: r.meanFactorAblationLoss,
    stateContrastLoss: r.stateContrastSelectionLoss, factors: r.factors })),
});
await saveJson(resolve(output, 'RESTORE_AND_PREASSESSMENT.json'), {
  sourceSnapshotSha256: declaration.snapshotSha256, restoredSha256,
  sourceEventsSha256: declaration.sourceEventsSha256, ...summary(snapshot),
});
console.log(JSON.stringify({ stage: 'restored', ...summary(snapshot) }));
const started = performance.now();
try {
  const plans = values.first ? declaration.interventionPlans.slice(0, 1) : declaration.interventionPlans;
  const assessments = memory.recordDistributedMatchedInterventions(plans);
  const after = memory.snapshot();
  const beforePhysics = canonicalStreamSha256([snapshot.r1Medium, snapshot.r2Medium, snapshot.r2a.medium]);
  const afterPhysics = canonicalStreamSha256([after.r1Medium, after.r2Medium, after.r2a.medium]);
  if (beforePhysics !== afterPhysics) throw new Error('intervention-assessment-wrote-physical-substrate');
  const saved = values['no-save'] ? null : writeSegmentedCanonicalFileSync(output, 'experience-0128.json', after,
    { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
  if (saved && runtimeMetadata) {
    // An ordinary runtime pointer, not a G6 qualification declaration. Counts
    // come from the verified real events; no actions or evidence are invented.
    await saveJson(resolve(output, 'EXPERIENCE_LATEST.json'), {
      runtimeVersion: KAIROS_V5_RUNTIME_VERSION, sourceContextVersion: KAIROS_V5_CONTEXT_VERSION,
      filename: 'experience-0128.json', sha256: saved.manifest.sha256,
      manifestSha256: saved.manifestSha256, ...runtimeMetadata,
    });
  }
  await saveJson(resolve(output, 'ASSESSMENT_RESULT.json'), {
    assessments, ...summary(after), durationMs: performance.now() - started,
    beforePhysics, afterPhysics, physicsReadOnly: beforePhysics === afterPhysics,
    snapshotSha256: saved?.manifest.sha256 ?? null, manifestSha256: saved?.manifestSha256 ?? null,
    boundedFirstDeclaredPairOnly: values.first === true,
    derivedAssessmentSnapshotSaved: saved !== null,
    sourceSnapshotSha256: declaration.snapshotSha256,
    sourceFileUnchanged: beforeFile === await fileSha(resolve(input, declaration.snapshotFile)),
    realGameCalls: 0, hypotheticalWorldWrites: 0,
  });
  console.log(JSON.stringify({ stage: 'assessed', pairs: assessments.length,
    ...summary(after), durationMs: performance.now() - started }));
} catch (error) {
  await saveJson(resolve(output, 'ASSESSMENT_ERROR.json'), { message: error.message,
    stack: error.stack, durationMs: performance.now() - started });
  throw error;
}
