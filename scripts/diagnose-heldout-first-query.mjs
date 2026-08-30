import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GroundedGoalEvaluatorV1 } from '../dist/src/control/goal.js';
import { PhysicalMemory } from '../dist/src/memory.js';

const project = resolve(import.meta.dirname, '..');
const snapshotPath = resolve(project, 'evidence',
  'r2-measurement-resolution-and-physical-basin-repair-v1', 'rebuilt-attempt017-v7-action-event-measurement-v2',
  'experience-0128.json');
const framesPath = resolve(project, 'evidence',
  'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup', 'frames.jsonl');
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const observation = (await readFile(framesPath, 'utf8')).split(/\r?\n/).filter(Boolean)
  .map(line => JSON.parse(line)).find(record => record.kind === 'frame' && record.value.sequence === 70)?.value;
if (!observation) throw new Error('diagnostic-observation-70-missing');
const control = observation.objects.find(object => object.type === 'note_block');
if (!control) throw new Error('diagnostic-note-block-missing');
const goal = { version: 'GroundedGoalV1', id: 'diagnostic-note-one', expression: { kind: 'predicate', predicate: {
  version: 'GoalPredicateV1', id: 'note-state-one', subject: { kind: 'public-object', id: control.id,
    expectedType: 'note_block' }, observable: 'properties.note', comparator: 'equals', target: '1',
} } };
const restoreStarted = performance.now();
const memory = PhysicalMemory.restore(snapshot);
const restoreMs = performance.now() - restoreStarted;
const evaluator = new GroundedGoalEvaluatorV1();
evaluator.setGoal(goal, observation);
const evaluation = evaluator.evaluate(observation);
const recallStarted = performance.now();
const candidates = memory.recallByEffect(goal, evaluation, observation);
const recallMs = performance.now() - recallStarted;
const conditionTimings = [];
for (const candidate of candidates) {
  const started = performance.now();
  const condition = memory.compareConditions(candidate, observation);
  conditionTimings.push({ candidateId: candidate.candidateId, elapsedMs: performance.now() - started,
    applicability: condition.applicability, productionEligible: condition.productionEligible });
}
const predictionTimings = [];
for (const candidate of candidates) {
  const started = performance.now();
  const prediction = memory.predictCandidate(candidate, observation, goal);
  predictionTimings.push({ candidateId: candidate.candidateId, elapsedMs: performance.now() - started,
    validSampleCount: prediction.validSampleCount, progressSampleCount: prediction.progressSampleCount,
    support: prediction.support });
}
console.log(JSON.stringify({ restoreMs, recallMs, candidateCount: candidates.length,
  conditionTotalMs: conditionTimings.reduce((sum, value) => sum + value.elapsedMs, 0),
  predictionTotalMs: predictionTimings.reduce((sum, value) => sum + value.elapsedMs, 0),
  conditionTimings, predictionTimings, observationSequence: observation.sequence, evaluation }, null, 2));
