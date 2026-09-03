import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalMemory } from '../src/memory.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import type { GroundedGoalV1 } from '../src/control/contracts.js';
import { guidedAffordanceCurriculum,
  guidedAffordanceObservation } from '../src/evaluation/guided-affordance-microworld.js';
import { sha } from '../src/util.js';
import { DeterministicTokenFieldEncoder } from '../src/core/learning/token-field.js';
import { OpenCausalFactorR2A } from '../src/core/learning/open-causal-factor-r2a.js';
import { ExperienceMediaStore } from '../src/core/learning/experience-store.js';

const indicatorGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'indicator-active', expression: {
  kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'active',
    subject: { kind: 'public-object', id: 'test-indicator', expectedType: 'opaque-indicator' },
    observable: 'properties.active', comparator: 'equals', target: true } } };
const crosshairGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'aim-control', expression: {
  kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'target-type', subject: { kind: 'crosshair' },
    observable: 'type', comparator: 'equals', target: 'opaque-control' } } };

test('legacy guided fixture remains readable for audit but is not the production hierarchy', () => {
  const memory = new PhysicalMemory();
  for (const event of guidedAffordanceCurriculum()) memory.observe(event);
  assert.equal(memory.ready, true); assert.equal(memory.writes, 128);

  const aligned = guidedAffordanceObservation({ sequence: 2000, activeSeconds: 100,
    yaw: 0, enabled: true, active: false, aimed: true });
  const frozen = memory.snapshot(), readOnlyHash = sha(frozen);
  const encoder = DeterministicTokenFieldEncoder.fromState(frozen.tokenEncoder!);
  const r2a = new OpenCausalFactorR2A(encoder, new ExperienceMediaStore(frozen.store), frozen.r2a!);
  const mean = new Float64Array(frozen.tokenEncoder!.inputMean);
  const shifted = new Float64Array(mean); shifted[0] = shifted[0]! + frozen.tokenEncoder!.inputDeviation[0]!;
  assert.deepEqual(r2a.activationAudits([mean, shifted]), [r2a.activationAudit(mean), r2a.activationAudit(shifted)],
    'batched factor activation changed the scalar physical query result');
  const indicatorEvaluator = new GroundedGoalEvaluatorV1(); indicatorEvaluator.setGoal(indicatorGoal, aligned);
  const indicatorCandidates = memory.recallByEffect(indicatorGoal, indicatorEvaluator.evaluate(aligned), aligned)
    .filter(candidate => candidate.actionCue.kind === 'interact');
  assert(indicatorCandidates.length > 0, 'no physical interact history was recalled by its effect');
  const applicableInteract = indicatorCandidates.find(candidate => memory.compareConditions(candidate, aligned).applicability > 0);
  assert(applicableInteract, 'guided success condition did not become a production R2A relation');
  const interactPrediction = memory.predictCandidate(applicableInteract, aligned, indicatorGoal);
  assert(interactPrediction.validSampleCount > 0 && interactPrediction.progressSampleCount > 0,
    'real random prediction did not read the learned interaction effect');

  const readyToAcquire = guidedAffordanceObservation({ sequence: 2001, activeSeconds: 100.05,
    yaw: -15, enabled: true, active: false, aimed: false });
  const crosshairEvaluator = new GroundedGoalEvaluatorV1(); crosshairEvaluator.setGoal(crosshairGoal, readyToAcquire);
  const lookCandidates = memory.recallByEffect(crosshairGoal, crosshairEvaluator.evaluate(readyToAcquire), readyToAcquire)
    .filter(candidate => candidate.actionCue.kind === 'look');
  assert(lookCandidates.length > 0, 'no physical look history was recalled by crosshair acquisition');
  const applicableLook = lookCandidates.find(candidate => memory.compareConditions(candidate, readyToAcquire).applicability > 0);
  assert(applicableLook, 'guided target-acquisition condition did not become a production R2A relation');
  const lookPrediction = memory.predictCandidate(applicableLook, readyToAcquire, crosshairGoal);
  assert(lookPrediction.validSampleCount > 0 && lookPrediction.progressSampleCount > 0,
    'real random prediction did not read the learned crosshair acquisition');

  const oneStepEarlier = guidedAffordanceObservation({ sequence: 2002, activeSeconds: 100.1,
    yaw: 15, enabled: true, active: false, aimed: false });
  const missing = memory.compareConditions(applicableLook, oneStepEarlier);
  assert.equal(missing.applicability, 0);
  const factorTransitions = memory.recallFactorTransition([...missing.unknownFactorIds, ...missing.contradictedFactorIds], oneStepEarlier);
  assert(factorTransitions.some(transition => transition.actionCue.kind === 'look'),
    'no real factor-transition experience can reach the target-acquisition condition');
  assert.equal(sha(memory.snapshot()), readOnlyHash, 'recall, comparison and random prediction changed long-term memory');
  // R2 is first because it is the subtle stale-cache regression: unlike an
  // erased R1 trace it still leaves a perfectly readable road snapshot.
  for (const layer of ['R2', 'R1'] as const) {
    const erased = PhysicalMemory.restore(frozen); erased.ablateForTest(layer);
    assert.equal(erased.recallByEffect(indicatorGoal, indicatorEvaluator.evaluate(aligned), aligned).length, 0,
      `${layer} ablation left target-effect recall active`);
    const erasedHash = sha(erased.snapshot());
    const staleCandidatePrediction = erased.predictCandidate(applicableInteract, aligned, indicatorGoal);
    assert.equal(staleCandidatePrediction.validSampleCount, 0,
      `${layer} ablation was bypassed by evidence cached in an earlier recall candidate`);
    assert(staleCandidatePrediction.currentEvidence, 'prediction omitted its freshly observed physical evidence');
    assert.equal(staleCandidatePrediction.currentEvidence[layer.toLowerCase() as 'r1' | 'r2'].active, false,
      `${layer} current evidence was copied from historical recall provenance`);
    assert.equal(sha(erased.snapshot()), erasedHash, `${layer} freshness query wrote to physical memory`);
  }
  const r2aErased = PhysicalMemory.restore(frozen); r2aErased.ablateForTest('R2A');
  const r2aErasedHash = sha(r2aErased.snapshot());
  const r2aPrediction = r2aErased.predictCandidate(applicableInteract, aligned, indicatorGoal);
  assert.equal(r2aPrediction.validSampleCount, 0,
    'R2A ablation left the interaction prediction active');
  assert(r2aPrediction.currentEvidence, 'R2A-disabled prediction omitted current evidence');
  assert.equal(r2aPrediction.currentEvidence.r2a.productionEligible, false,
    'R2A production eligibility was copied from historical recall provenance');
  assert.equal(sha(r2aErased.snapshot()), r2aErasedHash, 'R2A freshness query wrote to physical memory');

  const hypotheticalFollowup = memory.predictCandidate(applicableInteract, interactPrediction.nextStates[0]!, indicatorGoal);
  assert.equal(hypotheticalFollowup.validSampleCount, 0,
    'a hypothetical state without current public perception inherited historical applicability');
  assert.equal(hypotheticalFollowup.currentEvidence?.r2a.productionEligible, false,
    'hypothetical evidence was exposed as current production evidence');
});
