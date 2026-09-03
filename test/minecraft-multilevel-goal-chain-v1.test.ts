import test from 'node:test';
import assert from 'node:assert/strict';
import type { GroundedGoalV1 } from '../src/control/contracts.js';
import { sha } from '../src/util.js';
import {
  MINECRAFT_MULTILEVEL_FAILURE_CLASSES_V1,
  MULTILEVEL_ABLATIONS_V1,
  MULTILEVEL_ABLATION_CONTRACT_V1,
  MULTILEVEL_GUIDED_MODES_V1,
  MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1,
  EXISTING_BASELINE_RECURSIVE_GATE_V1,
  FOUNDATION_QUALIFICATION_GATE_V1,
  RecordingMultilevelGoalChainFixtureV1,
  auditMinecraftMultilevelGoalChainProtocolV1,
  classifyMinecraftMultilevelFailureV1,
  existingBaselineRecursiveGateCaseV1,
  foundationQualificationCasesV1,
  minecraftMultilevelGoalChainCasesV1,
  minecraftMultilevelGoalChainPerturbationsV1,
  minecraftMultilevelGoalChainProtocolV1,
  multilevelGuidedTrainingPlanIdentityV1,
  multilevelGuidedTrainingPlanV1,
  scoreExistingBaselineRecursiveGateV1,
  scoreFoundationQualificationV1,
  scoreMultilevelAblationsV1,
  scoreMultilevelGoalChainCaseV1,
  type FoundationQualificationEvidenceV1,
  type GoalChainCaseEvidenceV1,
  type MinecraftMultilevelFailureSignalsV1,
  type MultilevelDiagnosticBatchV1,
  type NoteQualificationEvidenceV1,
  type RealPublicStateMilestoneV1,
} from '../src/evaluation/minecraft-multilevel-goal-chain-v1.js';

test('precommitted empty-memory curriculum has 16 modes x 16 single-action fragments', () => {
  const plan = multilevelGuidedTrainingPlanV1();
  assert.equal(MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1.initialExperience, 'empty');
  assert.equal(MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1.totalEpisodes, 256);
  assert.equal(plan.length, 256);
  assert.equal(new Set(MULTILEVEL_GUIDED_MODES_V1).size, 16);
  for (const mode of MULTILEVEL_GUIDED_MODES_V1) {
    assert.equal(plan.filter(item => item.mode === mode).length, 16, mode);
    assert.equal(plan.slice(0, 128).filter(item => item.mode === mode).length, 8, `${mode}:first`);
    assert.equal(plan.slice(128).filter(item => item.mode === mode).length, 8, `${mode}:second`);
  }
  assert.deepEqual(plan, multilevelGuidedTrainingPlanV1(), 'precommitted ordering changed between calls');
  assert.match(multilevelGuidedTrainingPlanIdentityV1(), /^[a-f0-9]{64}$/);
  assert.equal(plan.every((item, index) => item.episode === index && item.action !== null
    && item.fullSolutionDisclosed === false), true);
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes('actionSequence'), false);
  assert.equal(serialized.includes('solutionSteps'), false);
  assert.equal(serialized.includes('stone_button'), true,
    'single-action button interaction training disappeared from the committed curriculum');
  assert.equal(MULTILEVEL_GUIDED_MODES_V1.includes('jump-forward-clear-one-block'), true);
  assert.equal(MULTILEVEL_GUIDED_MODES_V1.includes('forward-blocked'), true);
  assert.equal(MULTILEVEL_GUIDED_MODES_V1.includes('interact-wired-button-opens-iron-door'), true);
  assert.equal(MULTILEVEL_GUIDED_MODES_V1.includes('interact-visible-disconnected-button-no-door-change'), true);
  assert.notDeepEqual(plan.slice(0, 16).map(item => item.mode), MULTILEVEL_GUIDED_MODES_V1,
    'the committed order is the source order rather than a seeded shuffle');
});

test('existing 128-event baseline has one low-cost note 0 to note 2 recursive live gate', () => {
  assert.equal(EXISTING_BASELINE_RECURSIVE_GATE_V1.baselineRealEventCount, 128);
  assert.equal(EXISTING_BASELINE_RECURSIVE_GATE_V1.requiredLiveCaseCount, 1);
  assert.equal(EXISTING_BASELINE_RECURSIVE_GATE_V1.scoreUsesActionSequence, false);
  const trainingLayouts = new Set(multilevelGuidedTrainingPlanV1().map(item => item.layout.id));
  assert.equal(trainingLayouts.has(existingBaselineRecursiveGateCaseV1.layout.id), false);

  const specification = existingBaselineRecursiveGateCaseV1;
  const state = (sequence: number, value: string): RealPublicStateMilestoneV1 => ({
    source: 'real-public-observation', sequence, objectId: specification.noteObjectId,
    objectType: 'note_block', observable: 'properties.note', value,
  });
  const evidence: NoteQualificationEvidenceV1 = {
    caseId: specification.id, leakageAuditPassed: true, fixtureReady: true,
    baseline: { kind: 'existing-frozen-128', realEventCount: 128,
      frozenSnapshotId: 'qualified-memory-copy-source' },
    representation: { r1Active: true, r2Active: true, r2aActive: true,
      productionRelationIds: ['learned-relation-arbitrary-id'],
      groundedFactorIds: ['learned-factor-arbitrary-id'], relationFactorLinks: [{
        relationId: 'learned-relation-arbitrary-id', factorIds: ['learned-factor-arbitrary-id'],
        rootGoalId: specification.rootGoal.id,
      }] },
    rootGoal: specification.rootGoal,
    workspace: { rootNodeId: 'runtime-root-node', rootGoalId: specification.rootGoal.id,
      dependencyNodeIds: ['runtime-child-node'] },
    realStates: [state(10, '0'), state(20, '1'), state(30, '2'), state(35, '2')],
  };
  const score = scoreExistingBaselineRecursiveGateV1(specification, evidence);
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.deepEqual(score.milestones, { relation: true, factor: true, rootGoal: true,
    realInitialState: true, realIntermediateState: true, realTargetState: true,
    realTargetConfirmation: true });

  const noRelation: NoteQualificationEvidenceV1 = { ...structuredClone(evidence),
    representation: { ...structuredClone(evidence.representation), productionRelationIds: [] } };
  assert.equal(scoreExistingBaselineRecursiveGateV1(specification, noRelation).failure,
    'physical-recall-or-rollout-failed');
  const noFactor: NoteQualificationEvidenceV1 = { ...structuredClone(evidence),
    representation: { ...structuredClone(evidence.representation), groundedFactorIds: [] } };
  assert.equal(scoreExistingBaselineRecursiveGateV1(specification, noFactor).failure,
    'representation-insufficient');
});

test('256-event frozen foundation is scored on 32 unseen layouts with all structural read-only gates', () => {
  assert.equal(foundationQualificationCasesV1.length, 32);
  assert.equal(new Set(foundationQualificationCasesV1.map(item => item.layout.id)).size, 32);
  for (const mode of MULTILEVEL_GUIDED_MODES_V1) {
    const cases = foundationQualificationCasesV1.filter(item => item.mechanism === mode);
    assert.equal(cases.length, 2, mode);
    assert.deepEqual(cases.map(item => item.replicate).sort(), [0, 1]);
  }
  assert.equal(FOUNDATION_QUALIFICATION_GATE_V1.minimumCloneValidSamples, 8);
  assert.equal(FOUNDATION_QUALIFICATION_GATE_V1.minimumCloneProgressFraction, .75);
  const trainingLayouts = new Set(multilevelGuidedTrainingPlanV1().map(item => item.layout.id));
  assert.equal(foundationQualificationCasesV1.some(item => trainingLayouts.has(item.layout.id)), false);
  const specification = foundationQualificationCasesV1[0]!;
  const evidence: FoundationQualificationEvidenceV1 = {
    caseId: specification.id, mechanism: specification.mechanism, replicate: specification.replicate,
    publicContextId: 'unseen-public-context-1', leakageAuditPassed: true, fixtureReady: true,
    sourceSnapshot: { guidedRealEventCount: 256, snapshotId: 'frozen-256',
      memoryHashBefore: 'same-memory', memoryHashAfter: 'same-memory' },
    r1: { active: true, traceIds: ['r1-any'] },
    r2: { active: true, visitIds: ['r2-any'] },
    productionR2A: { productionEligible: true, currentApplicability: .9,
      relationIds: ['relation-any'],
      factorIds: ['factor-any'] },
    factorTransition: { recalled: true, factorIds: ['factor-any'],
      transitionTraceIds: ['transition-any'] },
    predictionClone: { interpretation: 'positive-progress', validSampleCount: 8,
      progressSampleCount: 6 },
    exactEffectLookup: { queryKind: specification.query.kind,
      goalId: `foundation-effect:${specification.id}:${specification.query.target}`,
      expectedCueIdentity: sha(specification.exactActionCue), candidateIds: ['candidate-any'],
      candidateRelationIds: ['relation-any'] },
    counterevidence: { required: false, exactNoEffectCandidateIds: [], noEffectRelationIds: [],
      noEffectCurrentApplicability: 0, counterfactualCandidateIds: [],
      counterfactualMaximumApplicability: 0, counterfactualProgressSampleCount: 0 },
  };
  const score = scoreFoundationQualificationV1(specification, evidence);
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.deepEqual(score.milestones, { exactCueAndEffect: true, r1: true, r2: true, productionR2A: true,
    factorTransition: true, predictionClone: true, cloneProgressFraction: .75,
    noEffectCounterevidence: true, noWrite: true });
  const tooFewCloneSamples: FoundationQualificationEvidenceV1 = { ...structuredClone(evidence),
    predictionClone: { interpretation: 'positive-progress', validSampleCount: 7,
      progressSampleCount: 7 } };
  assert.equal(scoreFoundationQualificationV1(specification, tooFewCloneSamples).failure,
    'physical-recall-or-rollout-failed');
  const writeLeak: FoundationQualificationEvidenceV1 = { ...structuredClone(evidence),
    sourceSnapshot: { ...structuredClone(evidence.sourceSnapshot), memoryHashAfter: 'changed' } };
  assert.equal(scoreFoundationQualificationV1(specification, writeLeak).failure, 'experimental-leakage');

  const blocked = foundationQualificationCasesV1.find(item => item.mechanism === 'forward-blocked')!;
  const negative: FoundationQualificationEvidenceV1 = { ...structuredClone(evidence),
    caseId: blocked.id, mechanism: blocked.mechanism, replicate: blocked.replicate,
    publicContextId: 'unseen-public-context-blocked',
    predictionClone: { interpretation: 'no-effect-physical-readout', validSampleCount: 8,
      progressSampleCount: 0 },
    exactEffectLookup: { queryKind: blocked.query.kind, goalId: null,
      expectedCueIdentity: sha(blocked.exactActionCue), candidateIds: ['blocked-no-effect'],
      candidateRelationIds: ['relation-any'] },
    counterevidence: { required: true, exactNoEffectCandidateIds: ['blocked-no-effect'],
      noEffectRelationIds: ['relation-any'], noEffectCurrentApplicability: .9,
      counterfactualCandidateIds: ['clear-forward'], counterfactualMaximumApplicability: 0,
      counterfactualProgressSampleCount: 0 } };
  assert.equal(scoreFoundationQualificationV1(blocked, negative).passed, true);
  const falsePositive = { ...structuredClone(negative), counterevidence: {
    ...structuredClone(negative.counterevidence), counterfactualMaximumApplicability: .5 } };
  assert.equal(scoreFoundationQualificationV1(blocked, falsePositive).failure,
    'dependency-decomposition-failed');
});

test('foundation 16 x 2 cases occupy every public marker-mask and side pair exactly once', () => {
  assert.equal(foundationQualificationCasesV1.length, MULTILEVEL_GUIDED_MODES_V1.length * 2);
  for (const mode of MULTILEVEL_GUIDED_MODES_V1) {
    const cases = foundationQualificationCasesV1.filter(item => item.mechanism === mode);
    assert.deepEqual(cases.map(item => item.replicate).sort(), [0, 1], mode);
  }

  const publicContextKeys = foundationQualificationCasesV1.map(item =>
    `${item.layout.markerPermutation % 8}:${item.layout.side}`);
  assert.equal(new Set(publicContextKeys).size, 32,
    'foundation public marker-mask and side pairs must be one-to-one');
  assert.deepEqual([...new Set(foundationQualificationCasesV1
    .map(item => item.layout.markerPermutation % 8))].sort((left, right) => left - right),
  [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(new Set(foundationQualificationCasesV1.map(item => item.layout.side)),
    new Set(['south', 'east', 'north', 'west']));
});

test('twelve vanilla latch cases are A/B/C balanced, isolated and expose only unique door-open goals', () => {
  assert.equal(minecraftMultilevelGoalChainCasesV1.length, 12);
  for (const tier of ['A', 'B', 'C'] as const)
    assert.equal(minecraftMultilevelGoalChainCasesV1.filter(item => item.tier === tier).length, 4);
  assert.equal(new Set(minecraftMultilevelGoalChainCasesV1.map(item => item.rootGoal.id)).size, 12);
  assert.equal(new Set(minecraftMultilevelGoalChainCasesV1.map(item => item.doorObjectId)).size, 12);
  assert.equal(new Set(minecraftMultilevelGoalChainCasesV1.map(item => item.experience.copyId)).size, 12);
  for (const item of minecraftMultilevelGoalChainCasesV1) {
    assert.equal(item.experience.independentCaseLocalCopy, true);
    assert.equal(item.experience.writeBackToSource, false);
    assert.deepEqual(item.experience.initialHabitWeights, []);
    assert.equal(item.fixture.commandBlockPolicy, 'forbidden-and-absent');
    assert.equal(item.fixture.dynamicRuleCallbacks, false);
    assert.equal(item.fixture.mechanism,
      'stone-button-dropper-barrel-comparator-redstone-repeater-iron-door-latch');
    assert.deepEqual(item.fixture.components.map(value => value.role),
      ['button', 'dropper', 'container', 'comparator', 'wire', 'repeater', 'door']);
    assert.equal(JSON.stringify(item.fixture.components).includes('copper_bulb'), false);
    assert.equal(item.rootGoal.expression.kind, 'predicate');
    if (item.rootGoal.expression.kind !== 'predicate') throw new Error('unreachable');
    assert.equal(item.rootGoal.expression.predicate.subject.kind, 'public-object');
    assert.equal(item.rootGoal.expression.predicate.observable, 'properties.open');
    assert.equal(item.rootGoal.expression.predicate.comparator, 'equals');
    if (item.rootGoal.expression.predicate.comparator !== 'equals') throw new Error('unreachable');
    assert.equal(item.rootGoal.expression.predicate.target, true);
    assert.equal(item.goalDisclosure.rootGoalOnly, true);
    assert.equal(item.goalDisclosure.childGoalsDisclosed, 0);
    assert.equal(item.goalDisclosure.actionHintsDisclosed, 0);
  }
  assert.equal(JSON.stringify(minecraftMultilevelGoalChainCasesV1).includes('actionSequence'), false);
});

test('only two C cases receive the precommitted plus/minus 30 degree first-action deviation', () => {
  assert.equal(minecraftMultilevelGoalChainPerturbationsV1.length, 2);
  assert.deepEqual(minecraftMultilevelGoalChainPerturbationsV1.map(item => item.caseId),
    ['goal-chain-C-01', 'goal-chain-C-02']);
  assert.deepEqual([...minecraftMultilevelGoalChainPerturbationsV1.map(item => item.yawDegrees)].sort((a, b) => a - b),
    [-30, 30]);
  assert.equal(minecraftMultilevelGoalChainPerturbationsV1.every(item => item.precommitted
    && item.trigger === 'after-first-real-non-observe-action-completed'
    && item.completedNonObserveActionOrdinal === 1), true);

  const specification = minecraftMultilevelGoalChainCasesV1.find(item => item.id === 'goal-chain-C-01')!;
  const fixture = new RecordingMultilevelGoalChainFixtureV1(specification);
  fixture.recordPreparation({ caseId: specification.id, layoutId: specification.fixture.layoutId,
    ready: true, realObservationSequence: 10, commandBlocksObserved: 0 });
  fixture.recordRootGoalInjection(specification.rootGoal);
  fixture.recordPrecommittedPerturbation(specification.perturbationIds[0]!, {
    source: 'real-body-result', eventId: 'real-event-1', actionKind: 'look', executed: true,
    completedNonObserveActionOrdinal: 1,
  });
  assert.deepEqual(fixture.journal.map(item => item.kind), ['fixture-prepared', 'root-goal-recorded',
    'precommitted-perturbation-recorded']);
  assert.equal((fixture.journal[2]!.value as { worldSideEffectExecutedByThisRecorder: boolean })
    .worldSideEffectExecutedByThisRecorder, false);
  assert.throws(() => fixture.recordPrecommittedPerturbation('unlisted-deviation', {
    source: 'real-body-result', eventId: 'real-event-2', actionKind: 'move', executed: true,
    completedNonObserveActionOrdinal: 1,
  }), /not-precommitted/);
});

test('case scoring checks discovered dependency and real milestones, not an expected action chain', () => {
  const specification = minecraftMultilevelGoalChainCasesV1.find(item => item.id === 'goal-chain-C-01')!;
  const door = (sequence: number, value: boolean): RealPublicStateMilestoneV1 => ({
    source: 'real-public-observation', sequence, objectId: specification.doorObjectId,
    objectType: 'iron_door', observable: 'properties.open', value,
  });
  const evidence: GoalChainCaseEvidenceV1 = {
    caseId: specification.id, experienceCopyId: specification.experience.copyId,
    initialHabitWeightCount: 0, leakageAuditPassed: true, fixtureReady: true,
    foundationQualified: true, representationQualified: true,
    physicalRecallOrRolloutObserved: true,
    dependency: { rootGoalId: specification.rootGoal.id, rootNodeId: 'runtime-root',
      discoveredDependencyNodeIds: ['runtime-discovered-child'], expansionObserved: true },
    controlSelectionObserved: true, controlCapacityExhausted: false,
    bodyIntegrationSucceeded: true,
    attention: { realDeviationSequence: 20, notificationSequence: 21,
      oldConditionInvalidatedSequence: 22, oldPredictionInvalidatedSequence: 22,
      recompetitionSequence: 23 },
    realDoorStates: [door(30, true), door(35, true)],
  };
  const score = scoreMultilevelGoalChainCaseV1(specification, evidence);
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.equal(JSON.stringify(score).includes('action'), false);
  const stale: GoalChainCaseEvidenceV1 = { ...structuredClone(evidence),
    attention: { ...structuredClone(evidence.attention), oldPredictionInvalidatedSequence: null } };
  assert.equal(scoreMultilevelGoalChainCaseV1(specification, stale).failure, 'attention-failed');
});

test('four specified ablations use only four preselected diagnostic layouts and pass the contrast contract', () => {
  assert.deepEqual(MULTILEVEL_ABLATIONS_V1.map(item => item.id), [
    'dependency-expansion-disabled', 'r2a-isolated',
    'prediction-clone-progress-gate-disabled', 'attention-deviation-input-disabled',
  ]);
  assert.deepEqual(MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds,
    ['goal-chain-C-01', 'goal-chain-C-02', 'goal-chain-C-03', 'goal-chain-C-04']);
  const ids = [...MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds];
  const full: MultilevelDiagnosticBatchV1 = { variant: 'full-system', outcomes: ids.map(caseId => ({
    caseId, success: true, attentionResponseLatencyTicks: 2,
    staleConditionOrPredictionUsed: false,
  })) };
  const weak = (variant: MultilevelDiagnosticBatchV1['variant']): MultilevelDiagnosticBatchV1 => ({
    variant, outcomes: ids.map((caseId, index) => ({ caseId, success: index === 0,
      attentionResponseLatencyTicks: 3, staleConditionOrPredictionUsed: false })),
  });
  const attention: MultilevelDiagnosticBatchV1 = {
    variant: 'attention-deviation-input-disabled', outcomes: ids.map((caseId, index) => ({
      caseId, success: index >= 2, attentionResponseLatencyTicks: index < 2 ? null : 3,
      staleConditionOrPredictionUsed: index < 2,
    })),
  };
  const score = scoreMultilevelAblationsV1(full, [weak('dependency-expansion-disabled'),
    weak('r2a-isolated'), weak('prediction-clone-progress-gate-disabled'), attention]);
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.deepEqual(score.mechanismAdvantages, { 'dependency-expansion-disabled': 3,
    'r2a-isolated': 3, 'prediction-clone-progress-gate-disabled': 3 });
  assert.deepEqual(score.attentionDisabledCasesPassed, ['goal-chain-C-01', 'goal-chain-C-02']);
});

test('failure classifier is closed over the fixed user vocabulary', () => {
  assert.deepEqual(MINECRAFT_MULTILEVEL_FAILURE_CLASSES_V1, [
    'fixture-failed', 'foundation-experience-insufficient', 'representation-insufficient',
    'physical-recall-or-rollout-failed', 'dependency-decomposition-failed',
    'control-selection-failed', 'control-capacity-exhausted', 'body-integration-failed',
    'attention-failed', 'goal-verification-failed', 'experimental-leakage',
  ]);
  const passing: MinecraftMultilevelFailureSignalsV1 = { leakageFree: true, fixtureReady: true,
    foundationExperienceReady: true, representationReady: true,
    physicalRecallAndRolloutReady: true, dependencyDecompositionReady: true,
    controlSelectionReady: true, controlCapacityAvailable: true, bodyIntegrationReady: true,
    attentionReady: true, goalVerified: true };
  assert.equal(classifyMinecraftMultilevelFailureV1(passing), null);
  const cases: readonly [keyof MinecraftMultilevelFailureSignalsV1, boolean, string][] = [
    ['fixtureReady', false, 'fixture-failed'],
    ['foundationExperienceReady', false, 'foundation-experience-insufficient'],
    ['representationReady', false, 'representation-insufficient'],
    ['physicalRecallAndRolloutReady', false, 'physical-recall-or-rollout-failed'],
    ['dependencyDecompositionReady', false, 'dependency-decomposition-failed'],
    ['controlSelectionReady', false, 'control-selection-failed'],
    ['controlCapacityAvailable', false, 'control-capacity-exhausted'],
    ['bodyIntegrationReady', false, 'body-integration-failed'],
    ['attentionReady', false, 'attention-failed'],
    ['goalVerified', false, 'goal-verification-failed'],
    ['leakageFree', false, 'experimental-leakage'],
  ];
  for (const [key, value, expected] of cases)
    assert.equal(classifyMinecraftMultilevelFailureV1({ ...passing, [key]: value }), expected, key);
});

test('static leakage audit passes the sealed protocol and detects a scripted method field', () => {
  const protocol = minecraftMultilevelGoalChainProtocolV1();
  assert.deepEqual(auditMinecraftMultilevelGoalChainProtocolV1(protocol), {
    version: 'MinecraftMultilevelLeakageAuditV1', passed: true, violations: [],
  });
  const leaking = structuredClone(protocol) as unknown as {
    goalChainCases: Array<Record<string, unknown>>;
  };
  leaking.goalChainCases[0]!.actionSequence = ['look', 'interact'];
  const rejected = auditMinecraftMultilevelGoalChainProtocolV1(
    leaking as unknown as ReturnType<typeof minecraftMultilevelGoalChainProtocolV1>);
  assert.equal(rejected.passed, false);
  assert(rejected.violations.includes('evaluation-method-disclosure-field'));
});

test('recording fixture rejects an injected goal that is not the sealed root goal', () => {
  const specification = minecraftMultilevelGoalChainCasesV1[0]!;
  const fixture = new RecordingMultilevelGoalChainFixtureV1(specification);
  fixture.recordPreparation({ caseId: specification.id, layoutId: specification.fixture.layoutId,
    ready: true, realObservationSequence: 1, commandBlocksObserved: 0 });
  const wrong = structuredClone(specification.rootGoal) as GroundedGoalV1;
  (wrong as unknown as { id: string }).id = 'different-goal';
  assert.throws(() => fixture.recordRootGoalInjection(wrong), /does-not-match-precommitment/);
});
