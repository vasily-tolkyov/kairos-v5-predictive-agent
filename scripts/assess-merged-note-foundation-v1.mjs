/** Read-only physical assessment of the two real foundation cohorts. */
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { canonicalStreamSha256, writeSegmentedCanonicalFileSync } from '../dist/src/util-stream.js';
import { canonical } from '../dist/src/util.js';
import { saveJson } from '../dist/src/util.js';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { KAIROS_V5_RUNTIME_VERSION, KAIROS_V5_CONTEXT_VERSION } from '../dist/src/core/compatibility.js';

const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
  'max-relations': { type: 'string' }, 'relation-index': { type: 'string' },
  'pairs-per-relation': { type: 'string', default: '1' } } });
if (!values.input || !values.output) throw new Error('assessment-requires-replay-and-new-output');
const input = resolve(values.input), output = resolve(values.output);
await mkdir(output, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(input, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(input, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256) throw new Error('replay-snapshot-hash-mismatch');
// Restore already checks the exact index algorithm, dependencies and hash.
// Do not erase a valid derived index only to recompute the same physical probes.
await saveJson(resolve(output, 'PHASE.json'), { phase: 'restore-physical-index', source: declaration.snapshotSha256 });
console.log(JSON.stringify({ phase: 'restore-physical-index', source: declaration.snapshotSha256 }));
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const reindexed = memory.snapshot();
const beforePhysics = canonicalStreamSha256([snapshot.r1Medium, snapshot.r2Medium, snapshot.r2a.medium]);
const pre = { r1: reindexed.r1.records?.length ?? null, r2: reindexed.r2.events.length,
  patterns: reindexed.r2a.patterns.length, relations: reindexed.r2a.relations.length,
  interventionPlans: declaration.interventionPlans.length, sourceSnapshotSha256: declaration.snapshotSha256,
  derivedRelationsRebuilt: canonicalStreamSha256(reindexed.r2a)
    !== canonicalStreamSha256(snapshot.r2a) };
await saveJson(resolve(output, 'RESTORE_PREASSESSMENT.json'), { restoredSha256: canonicalStreamSha256(reindexed), ...pre });
const prepared = writeSegmentedCanonicalFileSync(output, 'experience-reindexed.json', reindexed,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
await saveJson(resolve(output, 'pre-intervention.json'), { ...declaration,
  snapshotFile: 'experience-reindexed.json', snapshotSha256: prepared.manifest.sha256 });
console.log(JSON.stringify({ phase: 'physical-index-restored', ...pre }));
const started = performance.now();
const assessments = [];
const unavailable = [];
const eventInputs = new Map(reindexed.r2a.eventInputs.map(value => [value.eventId, value]));
const patternByEvent = new Map(reindexed.r2a.patterns.flatMap(pattern =>
  pattern.memberR2EventIds.map(eventId => [eventId, pattern])));
const plansBothDirections = [...declaration.interventionPlans,
  ...declaration.interventionPlans.map(plan => ({ ...plan,
    baselineR2EventId: plan.interventionR2EventId,
    interventionR2EventId: plan.baselineR2EventId }))];
// The requested number of distinct real pairs is measured for each relation.
// Both directions are considered; the physical learner decides qualification.
const maxRelations = values['max-relations'] === undefined ? reindexed.r2a.relations.length
  : Number(values['max-relations']);
if (!Number.isInteger(maxRelations) || maxRelations < 1) throw new Error('max-relations-invalid');
const relationIndex = values['relation-index'] === undefined ? 0 : Number(values['relation-index']);
if (!Number.isInteger(relationIndex) || relationIndex < 0) throw new Error('relation-index-invalid');
const pairsPerRelation = Number(values['pairs-per-relation']);
if (!Number.isInteger(pairsPerRelation) || pairsPerRelation < 1 || pairsPerRelation > 32)
  throw new Error('pairs-per-relation-invalid');
const selectedPlans = reindexed.r2a.relations.slice(relationIndex, relationIndex + maxRelations).flatMap(relation => {
  const factorSites = new Set(relation.factors.flatMap(factor => factor.afferentSiteIds));
  return plansBothDirections.filter(plan => {
    const interventionPattern = patternByEvent.get(plan.interventionR2EventId);
    const baseline = eventInputs.get(plan.baselineR2EventId);
    const intervention = eventInputs.get(plan.interventionR2EventId);
    if (!interventionPattern || interventionPattern.patternId !== relation.patternId
      || !baseline || !intervention) return false;
    const changed = new Set([...baseline.conditionSiteIds, ...intervention.conditionSiteIds]
      .filter(siteId => baseline.conditionSiteIds.includes(siteId)
        !== intervention.conditionSiteIds.includes(siteId)));
    return [...factorSites].every(siteId => changed.has(siteId));
  }).slice(0, pairsPerRelation);
});
// One batch lets the production assessor reuse identical physical queries.
// Pair ids and qualification counts still refer to distinct real episodes.
await saveJson(resolve(output, 'PHASE.json'), { phase: 'matched-interventions', selectedPlans });
console.log(JSON.stringify({ phase: 'matched-interventions', pairCount: selectedPlans.length }));
assessments.push(...memory.recordDistributedMatchedInterventions(selectedPlans));
const after = memory.snapshot();
const afterPhysics = canonicalStreamSha256([after.r1Medium, after.r2Medium, after.r2a.medium]);
if (beforePhysics !== afterPhysics) throw new Error('intervention-assessment-wrote-physical-medium');
const summary = state => ({
  patterns: state.r2a.patterns.map(pattern => ({ id: pattern.patternId, members: pattern.memberR2EventIds.length,
    contexts: pattern.contextIds.length, support: pattern.supportCount, contradictions: pattern.contradictionCount,
    grade: pattern.grade, basin: pattern.physicalBranchId, dwell: pattern.attractor.dwellSteps,
    escape: pattern.attractor.escapeRate, ambiguous: pattern.attractor.ambiguous })),
  relations: state.r2a.relations.map(relation => ({ id: relation.relationId, patternId: relation.patternId,
    grade: relation.grade, support: relation.supportCount, contradictions: relation.contradictionCount,
    pairs: relation.matchedInterventionCount, correctPairs: relation.physicallyCorrectInterventionCount,
    full: relation.meanFullFactorSelectionRate, ablationLoss: relation.meanFactorAblationLoss,
    stateContrastLoss: relation.stateContrastSelectionLoss, factors: relation.factors })),
});
const filename = `experience-${after.seenEventIds.length.toString().padStart(4, '0')}.json`;
const saved = writeSegmentedCanonicalFileSync(output, filename, after,
  { segmentLimitBytes: 64 * 1024 * 1024, pageLimitBytes: 32 * 1024 * 1024 });
const sourceEvents = (await Promise.all(declaration.sourceDirectories.map(async directory => {
  const rows = (await readFile(resolve(directory, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  return rows.filter(row => row.kind === 'real-event').map(row => row.value);
}))).flat();
const ids = new Set(sourceEvents.map(event => event.id));
if (ids.size !== after.seenEventIds.length || after.seenEventIds.some(id => !ids.has(id)))
  throw new Error('assessed-runtime-pointer-event-provenance-mismatch');
await saveJson(resolve(output, 'EXPERIENCE_LATEST.json'), {
  runtimeVersion: KAIROS_V5_RUNTIME_VERSION, sourceContextVersion: KAIROS_V5_CONTEXT_VERSION,
  filename, sha256: saved.manifest.sha256,
  manifestSha256: saved.manifestSha256, eventCount: after.seenEventIds.length,
  actions: sourceEvents.filter(event => event.provenance === 'executed-real-body' && event.bodyResult?.executed).length,
  writes: after.writes,
});
await saveJson(resolve(output, 'ASSESSMENT_RESULT.json'), { assessments, unavailable, ...summary(after), pre,
  durationMs: performance.now() - started, beforePhysics, afterPhysics, physicsReadOnly: beforePhysics === afterPhysics,
  snapshotSha256: saved.manifest.sha256, manifestSha256: saved.manifestSha256,
  realGameCalls: 0, writerCalls: 0, expectedOutcomeInjected: false });
console.log(canonical({ completed: true, ...pre, assessmentCount: assessments.length,
  unavailableCount: unavailable.length,
  patterns: after.r2a.patterns.length, relations: after.r2a.relations.length,
  snapshotSha256: saved.manifest.sha256, durationMs: performance.now() - started }));
