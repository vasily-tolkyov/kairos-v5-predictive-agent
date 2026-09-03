import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createDistributedG5NeutralMatrixPlanV1,
  DISTRIBUTED_G5_ACTION_BUDGET_V1,
  DISTRIBUTED_G5_NEUTRAL_AUDIT_DEFINITION_V1,
  DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
  distributedG5PreInterventionArtifactSha256V1,
  type DistributedG5PreInterventionBaselineV1,
  type DistributedG5SharedBaselineV1,
  validateDistributedG5SharedBaselineV1,
  validateDistributedG5PreInterventionArtifactV1,
} from '../src/evaluation/distributed-g5-neutral-control-v1.js';
import { DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5 }
  from '../src/core/learning/distributed-r2a-physical.js';
import { sha } from '../src/util.js';

test('G5 matrix declares one shared 128-event baseline and the real 24x180 prediction gate', () => {
  assert.deepEqual(DISTRIBUTED_G5_NEUTRAL_AUDIT_DEFINITION_V1, {
    baselineRealEvents: 128,
    completeR2Sequences: 48,
    resetSeparatedFillers: 32,
    matchedInterventions: 12,
    repetitionsPerArm: 8,
    contextsPerArm: 4,
    predictionSeedsPerCandidate: 24,
    predictionStepsPerSeed: 180,
    twoStepCaseCount: 32,
    threeStepCaseCount: 64,
    variants: 4,
    candidatePredictionCache: 'disabled',
    evaluationWritesPhysicalExperience: false,
    expectedActionOrderInjected: false,
    caseActionBudget: 5,
  });
});

test('G5 uses one public action budget for every chain depth', () => {
  assert.equal(DISTRIBUTED_G5_ACTION_BUDGET_V1, 5);
  const source = readFileSync(resolve('src/evaluation/distributed-g5-neutral-control-v1.ts'), 'utf8');
  assert.doesNotMatch(source, /actionBudget\s*=\s*plan\.depth/);
  assert.match(source, /actionBudget\s*=\s*DISTRIBUTED_G5_ACTION_BUDGET_V1/);
});

test('G5 pre-intervention artifact commits its producer, snapshot and opaque pair plan', () => {
  const interventionPlans = Array.from({ length: 12 }, (_unused, index) => ({
    baselineR2EventId: `opaque-baseline-${index}`,
    interventionR2EventId: `opaque-intervention-${index}`,
  }));
  const snapshot = { anonymous: 'test-only-envelope' } as unknown as
    DistributedG5PreInterventionBaselineV1['snapshot'];
  const base = {
    version: 'DistributedG5PreInterventionBaselineV1' as const,
    producerIdentity: DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    snapshot, snapshotSha256: sha(snapshot), nextObservationSequence: 129,
    activeSeconds: 6.4, interventionPlans,
    interventionPlanSha256: sha(interventionPlans),
    audit: { trustedRealEventCount: 128 as const, completeR2SequenceCount: 48 as const,
      resetSeparatedFillerCount: 32 as const, plannedMatchedInterventionCount: 12 as const,
      contextsPerArm: 4 as const, repetitionsPerArm: 8 as const,
      trainingEventIdsAreOpaque: true as const, scoringLabelsEnteredPhysicalMemory: false as const,
      ready: true, writes: 128, r2PatternCount: 6, r2aRelationCount: 3 },
  };
  const artifact: DistributedG5PreInterventionBaselineV1 = { ...base,
    artifactSha256: distributedG5PreInterventionArtifactSha256V1(base) };
  assert.doesNotThrow(() => validateDistributedG5PreInterventionArtifactV1(artifact));
  const tamperedPlan = structuredClone(artifact);
  (tamperedPlan.interventionPlans as Array<{ baselineR2EventId: string;
    interventionR2EventId: string }>)[0]!.interventionR2EventId = 'opaque-substitution';
  assert.throws(() => validateDistributedG5PreInterventionArtifactV1(tamperedPlan),
    /plan-hash-mismatch/);
  assert.throws(() => validateDistributedG5PreInterventionArtifactV1({ ...artifact,
    producerIdentity: 'stale-producer' }), /producer-identity-mismatch/);
});

test('G5 consolidated baseline rejects stale or tampered producer and algorithm identities', () => {
  const snapshot = { anonymous: 'test-only-shared-baseline', r2a: {
    physicalIndexIdentity: { algorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5 },
  } } as unknown as
    DistributedG5SharedBaselineV1['snapshot'];
  const baseline: DistributedG5SharedBaselineV1 = {
    version: 'DistributedG5NeutralControlEvaluationV1',
    producerIdentity: DISTRIBUTED_G5_PREINTERVENTION_PRODUCER_IDENTITY_V1,
    r2aAlgorithmIdentity: DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
    snapshot, snapshotSha256: sha(snapshot), nextObservationSequence: 129,
    activeSeconds: 6.4,
    audit: { trustedRealEventCount: 128, completeR2SequenceCount: 48,
      resetSeparatedFillerCount: 32, matchedInterventionCount: 12,
      contextsPerArm: 4, repetitionsPerArm: 8, trainingEventIdsAreOpaque: true,
      scoringLabelsEnteredPhysicalMemory: false, resultCacheUsed: false,
      ready: true, writes: 128, r2PatternCount: 6, r2aRelationCount: 3 },
  };
  assert.doesNotThrow(() => validateDistributedG5SharedBaselineV1(baseline));
  assert.throws(() => validateDistributedG5SharedBaselineV1({ ...baseline,
    producerIdentity: 'stale-producer' as typeof baseline.producerIdentity }),
  /g5-shared-baseline-producer-identity-mismatch/);
  assert.throws(() => validateDistributedG5SharedBaselineV1({ ...baseline,
    r2aAlgorithmIdentity: 'old-r2a-algorithm' as typeof baseline.r2aAlgorithmIdentity }),
  /g5-shared-baseline-r2a-algorithm-identity-mismatch/);
  const staleSnapshot = structuredClone(snapshot) as unknown as Record<string, unknown>;
  staleSnapshot.r2a = { physicalIndexIdentity: { algorithmIdentity: 'old-r2a-algorithm' } };
  assert.throws(() => validateDistributedG5SharedBaselineV1({ ...baseline,
    snapshot: staleSnapshot as unknown as DistributedG5SharedBaselineV1['snapshot'],
    snapshotSha256: sha(staleSnapshot) }),
  /g5-shared-baseline-snapshot-r2a-algorithm-identity-mismatch/);
});

test('G5 plan has 4 order and opaque-identity variants over isolated 32/64 cases', () => {
  const plan = createDistributedG5NeutralMatrixPlanV1();
  assert.equal(plan.variants.length, 4);
  assert.equal(plan.twoStepCases.length, 32);
  assert.equal(plan.threeStepCases.length, 64);
  assert.equal(new Set(plan.variants.map(value => JSON.stringify(value.offerOrder))).size, 4);
  assert.equal(new Set(plan.variants.map(value => value.opaqueIdentitySalt)).size, 4);
  assert.equal(new Set(plan.variants.map(value => value.recallPermutation)).size, 4);
  assert.equal(new Set([...plan.twoStepCases, ...plan.threeStepCases]
    .map(value => value.caseId)).size, 96);
  assert.equal(new Set([...plan.twoStepCases, ...plan.threeStepCases]
    .map(value => value.fieldSeed)).size, 96);
  for (const variant of plan.variants)
    assert.deepEqual([...variant.offerOrder].sort(), ['alpha', 'beta', 'delta', 'gamma', 'observe']);
  for (const value of [...plan.twoStepCases, ...plan.threeStepCases]) {
    assert.equal('expectedActionOrder' in value, false);
    assert.equal('expectedSequence' in value, false);
    assert.equal('result' in value, false);
  }
});

test('G5 evaluator delegates predictions and has no result cache or injected solution list', () => {
  const source = readFileSync(resolve('src/evaluation/distributed-g5-neutral-control-v1.ts'), 'utf8');
  assert.match(source, /this\.delegate\.predictCandidate\(/);
  assert.match(source, /predictionResultCacheUsed:\s*false/);
  assert.match(source, /expectedActionOrderInjected:\s*false/);
  assert.match(source, /for \(const item of \[\.\.\.plan\.twoStepCases, \.\.\.plan\.threeStepCases\]\)/);
  assert.doesNotMatch(source, /expectedActionOrder\s*:/);
  assert.doesNotMatch(source, /expectedSequence\s*:/);
  assert.doesNotMatch(source, /\[['"]gamma['"],\s*['"]alpha['"],\s*['"]beta['"]\]/);
});

test('G5 cases restore the frozen baseline and cannot write simulated actions into physical memory', () => {
  const source = readFileSync(resolve('src/evaluation/distributed-g5-neutral-control-v1.ts'), 'utf8');
  assert.match(source, /DistributedHierarchicalPhysicalMemoryV1\.restore\(structuredClone\(baseline\.snapshot\)\)/);
  const environment = source.slice(source.indexOf('class NeutralControlEnvironmentV1'),
    source.indexOf('export function createDistributedG5NeutralMatrixPlanV1'));
  assert.doesNotMatch(environment, /memory\.observe\(/);
  assert.match(environment, /eventId:\s*null/);
});
