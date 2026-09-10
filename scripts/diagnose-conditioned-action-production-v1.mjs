/** Production reasoning calls against immutable real recorded observations. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../dist/src/distributed-hierarchical-memory.js';
import { GroundedGoalEvaluatorV1 } from '../dist/src/control/goal.js';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { eventRows } from '../dist/src/events.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { fileSha, saveJson } from '../dist/src/util.js';

const [inputDirectory, captureDirectory, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error('input-capture-output-required');
await mkdir(outputDirectory, { recursive: false });
const declaration = JSON.parse(await readFile(resolve(inputDirectory, 'pre-intervention.json'), 'utf8'));
const { snapshot } = await loadSnapshotFromDisk(resolve(inputDirectory, declaration.snapshotFile));
if (canonicalStreamSha256(snapshot) !== declaration.snapshotSha256) throw new Error('source-hash-mismatch');
const audit = JSON.parse(await readFile(resolve(captureDirectory, 'RAW_FRAME_RECEIPT_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(captureDirectory, 'events.jsonl')))
  throw new Error('real-event-audit-mismatch');
const raw = (await readFile(resolve(captureDirectory, 'events.jsonl'), 'utf8')).trim()
  .split(/\r?\n/).map(JSON.parse).filter(row => row.kind === 'real-event').map(row => row.value);
const representatives = new Map();
for (const event of raw.filter(event => event.cue.kind === 'interact')) {
  const change = eventRows(event).changes.flat().find(change => change.property === 'note');
  if (change && !representatives.has(String(change.before))) representatives.set(String(change.before), event);
}
const memory = DistributedHierarchicalPhysicalMemoryV1.restore(snapshot);
const before = canonicalStreamSha256(memory.snapshot());
console.log(JSON.stringify({ phase: 'restored', before, source: declaration.snapshotSha256 }));
const results = [];
for (const [from, target] of [['0', '1'], ['1', '2'], ['0', '2']]) {
  const event = representatives.get(from);
  if (!event) throw new Error(`missing-real-source:${from}`);
  const observation = event.frames[0];
  const object = observation.objects.find(object => object.id === observation.targetId);
  if (!object) throw new Error('recorded-target-not-public');
  const goal = { version: 'GroundedGoalV1', id: `diagnostic-${from}-${target}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'public-state',
      subject: { kind: 'public-object', id: object.id, expectedType: object.type },
      observable: 'properties.note', comparator: 'equals', target } } };
  const evaluator = new GroundedGoalEvaluatorV1();
  evaluator.setGoal(goal, observation);
  const evaluation = evaluator.evaluate(observation), start = performance.now();
  const candidates = memory.recallByEffect(goal, evaluation, observation);
  const candidate = candidates.find(candidate => candidate.actionCue.kind === 'interact');
  await saveJson(resolve(outputDirectory, `QUERY_${from}_${target}.json`),
    { goal, observation, evaluation, candidates });
  console.log(JSON.stringify({ phase: 'recalled', from, target, candidates: candidates.length }));
  if (!candidate) throw new Error(`no-physical-candidate:${from}-${target}`);
  const conditions = memory.compareConditions(candidate, observation);
  const prediction = memory.predictCandidate(candidate, observation, goal, evaluation);
  await saveJson(resolve(outputDirectory, `PREDICTION_${from}_${target}.json`), { candidate, conditions, prediction });
  const actual = [...new Set(prediction.nextStates.flatMap(state => state.knownChanges)
    .filter(change => change.property === 'note').map(change => String(change.after)))];
  const row = { from, target, valid: prediction.validSampleCount, progress: prediction.progressFraction,
    actual, conditions, unknown: prediction.unknown, durationMs: performance.now() - start,
    passed: prediction.validSampleCount >= 8 && actual.length === 1
      && actual[0] === (from === '0' ? '1' : '2')
      && (target === '2' && from === '0' ? prediction.progressFraction === 0 : prediction.progressFraction >= .75) };
  results.push(row); console.log(JSON.stringify(row));
}
const after = canonicalStreamSha256(memory.snapshot());
await saveJson(resolve(outputDirectory, 'RESULT.json'), { results, before, after,
  readOnly: before === after, sourceUnchanged: declaration.snapshotSha256 === canonicalStreamSha256(snapshot),
  passed: before === after && results.every(row => row.passed),
  actualMinecraftCalls: 0, learningCalls: 0, heldoutCapabilityTest: false });
if (before !== after || results.some(row => !row.passed)) process.exitCode = 1;
