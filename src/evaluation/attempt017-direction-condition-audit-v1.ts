import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Observation } from '../contracts.js';
import type { ConditionApplicabilityV1, EffectRecallCandidateV1, GroundedGoalV1 } from '../control/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../control/goal.js';
import { PhysicalMemory, type MemorySnapshot } from '../memory.js';
import { assert, saveJson, sha } from '../util.js';
import { reconstructAttempt017RealEventsV1 } from './rebuild-attempt017-physical-memory-v2.js';

const CROSSHAIR_NOTE_GOAL: GroundedGoalV1 = { version: 'GroundedGoalV1',
  id: 'audit-crosshair-note-block', expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'crosshair-note-block', subject: { kind: 'crosshair' },
    observable: 'type', comparator: 'equals', target: 'note_block',
  } } };

interface CandidateConditionV1 {
  readonly candidate: EffectRecallCandidateV1;
  readonly condition: ConditionApplicabilityV1;
}

function yawDegrees(candidate: EffectRecallCandidateV1): number | null {
  const value = candidate.actionCue.kind === 'look' ? candidate.actionCue.parameters.yawDegrees : undefined;
  return typeof value === 'number' ? value : null;
}

function best(items: readonly CandidateConditionV1[]): CandidateConditionV1 | null {
  return [...items].sort((left, right) => right.condition.applicability - left.condition.applicability
    || Number(right.condition.productionEligible) - Number(left.condition.productionEligible)
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId))[0] ?? null;
}

function compact(item: CandidateConditionV1 | null) {
  if (!item) return null;
  return { candidateId: item.candidate.candidateId, eventId: item.candidate.evidence.eventId,
    cue: item.candidate.actionCue, evidence: item.candidate.evidence, condition: item.condition };
}

async function evaluateCase(memory: PhysicalMemory, observation: Observation, correctYawDegrees: -15 | 15) {
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(CROSSHAIR_NOTE_GOAL, observation);
  const evaluation = evaluator.evaluate(observation);
  assert(evaluation.status === 'mismatch', `direction-audit-goal-already-satisfied:${observation.sequence}`);
  const candidates = memory.recallByEffect(CROSSHAIR_NOTE_GOAL, evaluation, observation)
    .filter(candidate => yawDegrees(candidate) === 15 || yawDegrees(candidate) === -15);
  const conditions = candidates.map(candidate => ({ candidate,
    condition: memory.compareConditions(candidate, observation) }));
  const correctItems = conditions.filter(item => yawDegrees(item.candidate) === correctYawDegrees);
  const wrongItems = conditions.filter(item => yawDegrees(item.candidate) === -correctYawDegrees);
  const correct = best(correctItems), wrong = best(wrongItems);
  assert(correct && correct.condition.productionEligible && correct.condition.applicability > 0,
    `direction-audit-correct-yaw-not-applicable:${observation.sequence}`);
  assert(!wrong || wrong.condition.applicability < correct.condition.applicability,
    `direction-audit-wrong-yaw-not-suppressed:${observation.sequence}`);
  const correctPrediction = memory.predictCandidate(correct.candidate, observation, CROSSHAIR_NOTE_GOAL);
  const wrongPrediction = wrong ? memory.predictCandidate(wrong.candidate, observation, CROSSHAIR_NOTE_GOAL) : null;
  assert(correctPrediction.validSampleCount > 0 && correctPrediction.progressSampleCount > 0,
    `direction-audit-correct-yaw-no-physical-progress:${observation.sequence}`);
  assert(!wrongPrediction || wrongPrediction.validSampleCount < correctPrediction.validSampleCount
    || wrongPrediction.progressSampleCount < correctPrediction.progressSampleCount
    || wrongPrediction.prediction.support < correctPrediction.prediction.support,
  `direction-audit-wrong-yaw-prediction-not-suppressed:${observation.sequence}`);
  const summarize = (items: readonly CandidateConditionV1[]) => ({ candidates: items.length,
    productionEligible: items.filter(item => item.condition.productionEligible).length,
    maximumApplicability: items.reduce((maximum, item) => Math.max(maximum, item.condition.applicability), 0) });
  return { observationSequence: observation.sequence, contextId: observation.contextId,
    correctYawDegrees, correct: summarize(correctItems), wrong: summarize(wrongItems),
    bestCorrect: compact(correct), bestWrong: compact(wrong),
    correctPrediction: { support: correctPrediction.prediction.support,
      validSampleCount: correctPrediction.validSampleCount, progressSampleCount: correctPrediction.progressSampleCount,
      progressFraction: correctPrediction.progressFraction, unknown: correctPrediction.unknown },
    wrongPrediction: wrongPrediction ? { support: wrongPrediction.prediction.support,
      validSampleCount: wrongPrediction.validSampleCount, progressSampleCount: wrongPrediction.progressSampleCount,
      progressFraction: wrongPrediction.progressFraction, unknown: wrongPrediction.unknown } : null };
}

export async function auditAttempt017DirectionConditionsV1(sourceDirectory: string, snapshotPath: string,
  outputPath?: string): Promise<unknown> {
  const { observations } = await reconstructAttempt017RealEventsV1(sourceDirectory);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as MemorySnapshot;
  assert(snapshot.version === 'KairosV5MemoryV4', 'direction-audit-requires-current-memory-snapshot');
  const memory = PhysicalMemory.restore(snapshot), before = sha(memory.snapshot());
  const plusObservation = observations.get(2554), minusObservation = observations.get(143);
  assert(plusObservation && minusObservation, 'direction-audit-public-observation-missing');
  const plus = await evaluateCase(memory, plusObservation, 15);
  const minus = await evaluateCase(memory, minusObservation, -15);
  const after = sha(memory.snapshot());
  assert(before === after, 'direction-audit-mutated-physical-memory');
  assert(plus.correctYawDegrees === -minus.correctYawDegrees,
    'direction-audit-mirror-did-not-reverse-correct-action');
  const result = { version: 'Attempt017DirectionConditionAuditV1', snapshotSha256: before,
    queryReadOnly: true, cases: [plus, minus] };
  if (outputPath) await saveJson(resolve(outputPath), result);
  return result;
}
