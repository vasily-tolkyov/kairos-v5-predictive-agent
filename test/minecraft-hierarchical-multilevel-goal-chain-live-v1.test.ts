import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1,
  HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1,
  HIERARCHICAL_MULTILEVEL_REQUIRED_CONTRAST_ARMS_LIVE_V1,
  HIERARCHICAL_MULTILEVEL_REQUIRED_PRODUCTION_ARMS_LIVE_V1,
  HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1,
  HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1,
  hierarchicalMultilevelRequiredCalibrationVocabularyKeysLiveV1,
  hierarchicalMultilevelActionCueLiveV1,
  hierarchicalMultilevelAttentionAuditLiveV1,
  hierarchicalMultilevelCStructureAuditLiveV1,
  hierarchicalMultilevelHeldoutCasePassedLiveV1,
  hierarchicalMultilevelBridgeTargetArmLiveV1,
  hierarchicalMultilevelRepresentationEvidenceLiveV1,
  materializeTrainingEpisodeLiveV1,
  minecraftHierarchicalMultilevelPlanLiveV1,
  minecraftHierarchicalMultilevelQualificationGateLiveV1,
  restoreHierarchicalMultilevelOpaqueRelationLiveV1,
  selectHierarchicalMultilevelOpaqueRelationLiveV1,
} from '../src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.js';
import type { HierarchicalMemorySnapshotV1 } from '../src/hierarchical-memory.js';
import type { R2AInterventionProtocolV1 } from '../src/core/learning/r2a-stable-pattern.js';
import { cueIdentity } from '../src/events.js';
import {
  minecraftMultilevelGuidedActionScopeLiveV1,
  minecraftMultilevelGuidedFixtureCommandsLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedFixtureReadinessLiveV1,
  minecraftMultilevelGuidedVocabularyPanelLiveV1,
} from '../src/evaluation/minecraft-multilevel-guided-training-live-v1.js';

test('hierarchical multilevel plan keeps 32 resolved controls in R1 and freezes 168 production R2 roads', () => {
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  assert.equal(plan.initialExperience, 'empty');
  assert.equal(plan.foundation.length, 128);
  assert.equal(plan.interventions.length, 56);
  assert.equal(plan.foundationR1Atoms, 256);
  assert.equal(plan.interventionR1Atoms, 112);
  assert.equal(plan.frozenR1Atoms, 368);
  assert.equal(plan.foundationR2Events, 112);
  assert.equal(plan.frozenR2Events, 168);
  assert.equal(plan.foundationProductionR2Events, 112);
  assert.equal(plan.foundationR1OnlyControlAtoms, 32);
  assert.equal(plan.frozenProductionR2Events, 168);
  assert.equal(plan.frozenR1OnlyControlAtoms, 32);
  assert.equal(plan.fullSolutionTrainingFragments, 0);
  assert(plan.foundation.every(value => value.chain.actionBoundaryBefore === 'reset'
    && value.chain.observeBoundaryBefore === 'continuous'
    && value.chain.observeTicks === 5));
});

test('the first 128 atoms and complete foundation cover all sixteen arms without a solution chain', () => {
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  const calibration = plan.foundation.slice(0, 64);
  for (const arm of plan.arms) {
    assert.equal(calibration.filter(value => value.arm === arm).length, 4);
    const all = plan.foundation.filter(value => value.arm === arm);
    assert.equal(all.length, 8);
    assert.equal(new Set(all.map(value => value.layout.id)).size, 8);
  }
  assert.equal(calibration.length * 2, 128);
  assert.equal('actionSequence' in plan, false);
});

test('hierarchical representation profile separates neutral context, effect subject and mechanism', () => {
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  assert(plan.foundation.filter(value => value.arm.startsWith('left-') || value.arm.startsWith('right-'))
    .every(value => value.representationProfile.effectReference === 'self-and-central-obstacle'));
  assert(plan.foundation.filter(value => !value.arm.startsWith('left-') && !value.arm.startsWith('right-'))
    .every(value => value.representationProfile.effectReference === 'stone-button-proxy'));
  const mechanism = (arm: typeof plan.arms[number]) => new Set(plan.foundation
    .filter(value => value.arm === arm).map(value => value.representationProfile.mechanismMaterial));
  assert.deepEqual(mechanism('forward-blocked'), new Set(['iron_bars']));
  assert.deepEqual(mechanism('left-blocked'), new Set(['stone_bricks']));
  assert.deepEqual(mechanism('right-blocked'), new Set(['stone_bricks']));
  assert.deepEqual(mechanism('left-clear'), new Set(['stone_bricks']));
  assert.deepEqual(mechanism('right-clear'), new Set(['stone_bricks']));
  assert.deepEqual(mechanism('jump-forward-clear-one-block'), new Set(['smooth_stone']));
  assert.deepEqual(mechanism('jump-forward-blocked-low-roof-high-obstacle'), new Set(['smooth_stone']));
  assert.equal(new Set(plan.foundation.filter(value => value.arm === 'forward-blocked')
    .map(value => value.layout.neutralMarkerMask)).size, 8,
  'outcome-neutral public contexts must remain eight genuinely different layouts');
  const calibrationPanels = plan.foundation.filter(value =>
    value.representationProfile.calibrationVocabularyPanel);
  assert.equal(calibrationPanels.length, 8);
  assert(calibrationPanels.every(value => value.layout.split === 'calibration'
    && (value.arm === 'observe-state-remains' || value.arm === 'wait-no-relevant-change')));
  assert.deepEqual(new Set(calibrationPanels.map(value =>
    value.representationProfile.crosshairVocabularyMaterial)), new Set(['iron_bars', 'stone_bricks']));
  assert.equal(plan.foundation.slice(64).some(value =>
    value.representationProfile.calibrationVocabularyPanel), false);
});

test('profile fixture exposes proxy scope, fixed mechanisms and heldout vocabulary cardinality', () => {
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  const byArm = (arm: typeof plan.arms[number]) => plan.foundation.find(value => value.arm === arm)!;
  const episodeFor = (arm: typeof plan.arms[number]) => materializeTrainingEpisodeLiveV1(byArm(arm));
  const forward = episodeFor('forward-reduce-distance');
  const forwardGeometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(forward.layout);
  const forwardPanel = minecraftMultilevelGuidedVocabularyPanelLiveV1(forward.layout);
  const proxyId = `block:${forwardPanel.proxyButton.join(',')}`;
  assert.deepEqual(minecraftMultilevelGuidedActionScopeLiveV1(forward,
    { buttonId: null, doorId: null, referenceId: proxyId }).referencedPublicObjectIds, [proxyId]);
  const proxyCommands = minecraftMultilevelGuidedFixtureCommandsLiveV1(forward, 'KairosTest').commands;
  assert(proxyCommands.some(value => value.startsWith(
    `setblock ${forwardPanel.proxyButton.join(' ')} minecraft:stone_button`)));
  assert.equal(proxyCommands.some(value => value.startsWith(
    `setblock ${forwardGeometry.reference.join(' ')} minecraft:copper_bulb`)), false);

  const obstacleMaterial = (arm: typeof plan.arms[number], position: readonly number[]) => {
    const episode = episodeFor(arm);
    const prefix = `setblock ${position.join(' ')} minecraft:`;
    return minecraftMultilevelGuidedFixtureCommandsLiveV1(episode, 'KairosTest').commands
      .find(value => value.startsWith(prefix))?.slice(prefix.length).split('[')[0];
  };
  const forwardBlocked = episodeFor('forward-blocked');
  assert.equal(obstacleMaterial('forward-blocked',
    minecraftMultilevelGuidedFixtureGeometryLiveV1(forwardBlocked.layout).oneBlockObstacle), 'iron_bars');
  const leftBlocked = episodeFor('left-blocked');
  const leftGeometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(leftBlocked.layout);
  const leftPosition = [leftBlocked.layout.originX - leftGeometry.right[0], 64,
    leftBlocked.layout.originZ - leftGeometry.right[1]];
  assert.equal(obstacleMaterial('left-blocked', leftPosition), 'stone_bricks');
  const jump = episodeFor('jump-forward-clear-one-block');
  assert.equal(obstacleMaterial('jump-forward-clear-one-block',
    minecraftMultilevelGuidedFixtureGeometryLiveV1(jump.layout).oneBlockObstacle), 'smooth_stone');

  const panelSpecification = plan.foundation.find(value =>
    value.representationProfile.calibrationVocabularyPanel
      && value.representationProfile.crosshairVocabularyMaterial === 'iron_bars')!;
  const panelEpisode = materializeTrainingEpisodeLiveV1(panelSpecification);
  const panel = minecraftMultilevelGuidedVocabularyPanelLiveV1(panelEpisode.layout);
  assert.equal(panel.ironBars.length, 19);
  assert.equal(panel.stoneBricks.length, 16);
  const readiness = minecraftMultilevelGuidedFixtureReadinessLiveV1(panelEpisode);
  assert.equal(readiness.present.filter(value => value.name === 'iron_bars').length, 39,
    '35-block dedicated panel plus one crosshair target and three non-occluding connections');
  assert.equal(readiness.present.filter(value => value.name === 'stone_bricks').length, 0);
  const required = hierarchicalMultilevelRequiredCalibrationVocabularyKeysLiveV1();
  assert(required.includes('visible/iron_bars/14/relativeDistance'));
  assert(required.includes('visible/stone_bricks/11/relativeDistance'));
  assert(required.includes('crosshair/target-type="iron_bars"'));
  assert(required.includes('crosshair/target-type="stone_bricks"'));
});

test('seven prospective comparisons each contain four later matched intervention pairs', () => {
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  assert.equal(HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.length, 7);
  for (const comparison of HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1) {
    const members = plan.interventions.filter(value => value.comparison === comparison.id);
    assert.equal(members.length, 8);
    for (let pairIndex = 0; pairIndex < 4; pairIndex++) {
      const pair = members.filter(value => value.pairIndex === pairIndex);
      assert.equal(pair.length, 2);
      assert.equal(new Set(pair.map(value => value.layout.id)).size, 1);
      assert.deepEqual(new Set(pair.map(value => value.arm)),
        new Set([comparison.targetArm, comparison.contrastArm]));
    }
  }
});

test('qualification gate fails closed until every production arm and factor bridge passes', () => {
  const passingArms = HIERARCHICAL_MULTILEVEL_REQUIRED_PRODUCTION_ARMS_LIVE_V1.map(arm => ({
    arm, effectRecalled: true, r1Active: true, r2Active: true,
    relationGrade: 'intervention-supported' as const, positiveApplicability: .8,
    positiveProductionEligible: true,
    negativeApplicability: 0, validSampleCount: 8, progressFraction: .75,
    negativeProductionEligible: false,
    physicalCandidateCount: 2, attemptedPredictionCount: 1,
    winningCandidateId: `candidate:${arm}`,
    readoutDiagnostics: null,
  }));
  const bridges = HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1.map(id => ({
    id, missingFactorIds: [`opaque:${id}`],
      transitionRecalled: true, transitionProductionEligible: true,
      winningTransitionId: `transition:${id}`, factorProgressSampleCount: 18,
      progressBasis: 'predicted-parent-R2A-relation-complete' as const, baseObservationSequence: 100,
      validSampleCount: 8, progressFraction: .75, matchingTransitionCount: 2,
      conditionEligibleTransitionCount: 1, attemptedPredictionCount: 1 }));
  const contrasts = HIERARCHICAL_MULTILEVEL_REQUIRED_CONTRAST_ARMS_LIVE_V1.map(arm => ({
    arm, stablePatternRecalled: true, distinctFromTargetPattern: true,
    productionEligibleForTargetEffect: false as const,
  }));
  const passed = minecraftHierarchicalMultilevelQualificationGateLiveV1({
    version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1',
    representation: { r1Atoms: 368, r2Events: 168, productionR2Events: 168,
      r1OnlyControlAtoms: 32, representationRejections: 0, invalidR2Events: 0 },
    arms: passingArms, contrasts, bridges,
    queryChangedSnapshot: false,
  });
  assert.equal(passed.passed, true, JSON.stringify(passed));
  const continuousEvidence = {
    version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1' as const,
    representation: { r1Atoms: 772, r2Events: 312, productionR2Events: 312,
      r1OnlyControlAtoms: 32, representationRejections: 0, invalidR2Events: 0 },
    arms: passingArms, contrasts, bridges, queryChangedSnapshot: false,
  };
  const continuousPassed = minecraftHierarchicalMultilevelQualificationGateLiveV1(
    continuousEvidence, HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1);
  assert.equal(continuousPassed.passed, true, JSON.stringify(continuousPassed));
  assert.equal(minecraftHierarchicalMultilevelQualificationGateLiveV1(continuousEvidence).passed, false,
    'the legacy contract must remain the default');
  assert.equal(minecraftHierarchicalMultilevelQualificationGateLiveV1({ ...continuousEvidence,
    representation: { ...continuousEvidence.representation, invalidR2Events: 1 } },
  HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1).passed, false);
  const failed = minecraftHierarchicalMultilevelQualificationGateLiveV1({
    version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1',
    representation: { r1Atoms: 368, r2Events: 168, productionR2Events: 168,
      r1OnlyControlAtoms: 32, representationRejections: 0, invalidR2Events: 0 },
    arms: passingArms, contrasts,
    bridges: bridges.map((value, index) => index === 0 ? { ...value, transitionRecalled: false } : value),
    queryChangedSnapshot: false,
  });
  assert.equal(failed.passed, false);
  assert(failed.failures.includes('factor-transition-bridge-unqualified:forward-blocked-to-left'));
  const falsePositive = minecraftHierarchicalMultilevelQualificationGateLiveV1({
    version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1',
    representation: { r1Atoms: 368, r2Events: 168, productionR2Events: 168,
      r1OnlyControlAtoms: 32, representationRejections: 0, invalidR2Events: 0 },
    arms: passingArms, bridges,
    contrasts: contrasts.map((value, index) => index === 0
      ? { ...value, productionEligibleForTargetEffect: true } : value),
    queryChangedSnapshot: false,
  });
  assert.equal(falsePositive.passed, false);
  assert(falsePositive.failures.includes(`contrast-arm-unqualified:${contrasts[0]!.arm}`));
});

test('representation contracts admit only their preregistered R2 atom cardinalities', () => {
  const makeSnapshot = (atomCounts: readonly number[], r1Count: number) => {
    let atomOrdinal = 0;
    const events = atomCounts.map((count, eventOrdinal) => ({
      eventId: `r2-${eventOrdinal}`,
      atomIds: Array.from({ length: count }, () => `atom-${atomOrdinal++}`),
      completion: 'complete', learningEligible: true, physicalStatus: 'deposited',
    }));
    const annotations = Array.from({ length: r1Count }, (_unused, ordinal) => ({
      atomId: `atom-${ordinal}`, completion: 'complete',
      cue: ordinal < atomOrdinal ? { kind: 'move' } : { kind: 'observe' },
    }));
    return { annotations, r2Store: { events } } as unknown as HierarchicalMemorySnapshotV1;
  };
  const mixed = hierarchicalMultilevelRepresentationEvidenceLiveV1(
    makeSnapshot([...Array(196).fill(2), ...Array(116).fill(3)], 772),
    HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1);
  assert.deepEqual(mixed, { r1Atoms: 772, r2Events: 312, productionR2Events: 312,
    r1OnlyControlAtoms: 32, representationRejections: 0, invalidR2Events: 0 });
  const baselineRejectsThree = hierarchicalMultilevelRepresentationEvidenceLiveV1(
    makeSnapshot([2, 3], 5), HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1);
  assert.equal(baselineRejectsThree.invalidR2Events, 1);
  const continuousRejectsFour = hierarchicalMultilevelRepresentationEvidenceLiveV1(
    makeSnapshot([2, 3, 4], 9), HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1);
  assert.equal(continuousRejectsFour.invalidR2Events, 1);
});

test('each factor bridge is evaluated in its own preregistered action state', () => {
  assert.equal(hierarchicalMultilevelBridgeTargetArmLiveV1('forward-blocked-to-left'), 'left-clear');
  assert.equal(hierarchicalMultilevelBridgeTargetArmLiveV1('forward-blocked-to-right'), 'right-clear');
});

test('frozen resume restores an expanded relation by identity instead of requiring its formation member set', () => {
  const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1[0]!;
  const sourcePairs = Array.from({ length: 4 }, (_unused, index) => ({
    targetEventId: `target-foundation-${index}`, contrastEventId: `contrast-foundation-${index}`,
  }));
  const exactNextActionIdentity = cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.targetArm));
  const protocol = { version: 'R2AInterventionProtocolV3', protocolId: `hierarchical-multilevel-${comparison.id}-v1`,
    relationId: 'expanded-relation', factorSetId: 'factor-set', changedFactorIds: ['factor-1'],
    predictiveBoundaryEventId: 'boundary', registeredAfterEventId: 'registered', registeredEvidenceCount: 16,
    measurementBoundary: { version: 'R2AInterventionMeasurementBoundaryV1', sourcePairs,
      changedChannels: [], invariantTokenIndices: [], unresolvedChannels: [], identitySha256: 'boundary-sha' },
  } as R2AInterventionProtocolV1;
  const snapshot = { tokenEncoder: {}, r2a: {
    patterns: [
      { patternId: 'target-expanded', memberEventIds: [
        ...sourcePairs.map(value => value.targetEventId), ...Array.from({ length: 4 }, (_v, i) => `target-later-${i}`),
      ] },
      { patternId: 'contrast-expanded', memberEventIds: [
        ...sourcePairs.map(value => value.contrastEventId), ...Array.from({ length: 4 }, (_v, i) => `contrast-later-${i}`),
      ] },
    ], factors: [{ factorId: 'factor-1' }], relations: [{ relationId: 'expanded-relation',
      branchAtomIndex: 0, exactNextActionIdentity, targetPatternId: 'target-expanded',
      contrastPatternIds: ['contrast-expanded'], factorIds: ['factor-1'], grade: 'intervention-supported',
      factorSetInterventions: [{ factorSetId: 'factor-set', factorIds: ['factor-1'],
        pairIds: ['p0', 'p1', 'p2', 'p3'] }] }],
  } } as unknown as HierarchicalMemorySnapshotV1;
  const restored = restoreHierarchicalMultilevelOpaqueRelationLiveV1(snapshot, comparison, protocol);
  assert.equal(restored.relationId, 'expanded-relation');
  assert.equal(restored.targetPatternId, 'target-expanded');
  assert.deepEqual(restored.formationMatchedPairs, sourcePairs);
});

function opaqueSelectionSnapshot(targetMembers: readonly string[], contrastMembers: readonly string[],
  contrastPatternIds: readonly string[] = ['contrast-pattern']): HierarchicalMemorySnapshotV1 {
  const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1[0]!;
  const exactNextActionIdentity = cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.targetArm));
  const perception = (value: number): number[] => {
    const result = Array<number>(256).fill(0); result[0] = value; return result;
  };
  return { tokenEncoder: { width: 256, frozen: true,
    inputMean: Array<number>(256).fill(0), inputDeviation: Array<number>(256).fill(1) }, r2a: {
    patterns: [
      { patternId: 'target-pattern', memberEventIds: [...targetMembers],
        partitionStatus: 'resolved', grade: 'predictive-stable' },
      { patternId: 'contrast-pattern', memberEventIds: [...contrastMembers],
        partitionStatus: 'resolved', grade: 'predictive-stable' },
    ], factors: [{ factorId: 'factor-1', tokenIndex: 0, tolerance: .25 }],
    relations: [{ relationId: 'pairwise-relation', targetPatternId: 'target-pattern',
      contrastPatternIds: [...contrastPatternIds], branchAtomIndex: 0, exactNextActionIdentity,
      predictiveSinceEventId: 'predictive-boundary', grade: 'predictive-stable',
      factorIds: ['factor-1'] }],
    evidence: [
      ...targetMembers.map(eventId => ({ eventId, atomPrePerceptions: [perception(1)] })),
      ...contrastMembers.map(eventId => ({ eventId, atomPrePerceptions: [perception(-1)] })),
    ],
  } } as unknown as HierarchicalMemorySnapshotV1;
}

test('foundation selection locates one resolved physical superset instead of equating an arm with a pattern', () => {
  const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1[0]!;
  const targetSeeds = Array.from({ length: 8 }, (_unused, index) => `target-seed-${index}`);
  const contrastSeeds = Array.from({ length: 8 }, (_unused, index) => `contrast-seed-${index}`);
  const snapshot = opaqueSelectionSnapshot([...targetSeeds, 'target-physical-equivalent-later'],
    [...contrastSeeds, 'contrast-physical-equivalent-later']);
  const selected = selectHierarchicalMultilevelOpaqueRelationLiveV1(
    snapshot, comparison, targetSeeds, contrastSeeds);
  assert.equal(selected.targetPatternId, 'target-pattern');
  assert.equal(selected.contrastPatternId, 'contrast-pattern');
  assert.equal(selected.relationId, 'pairwise-relation');
  assert.deepEqual(selected.formationMatchedPairs, targetSeeds.map((targetEventId, index) => ({
    targetEventId, contrastEventId: contrastSeeds[index]!,
  })));
});

test('foundation selection rejects split seeds, same physical mode and non-pairwise V11 relations', () => {
  const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1[0]!;
  const targetSeeds = Array.from({ length: 8 }, (_unused, index) => `target-seed-${index}`);
  const contrastSeeds = Array.from({ length: 8 }, (_unused, index) => `contrast-seed-${index}`);
  const split = opaqueSelectionSnapshot(targetSeeds.slice(0, 4), contrastSeeds) as unknown as {
    r2a: { patterns: { patternId: string; memberEventIds: string[]; partitionStatus: string; grade: string }[] };
  };
  split.r2a.patterns.push({ patternId: 'target-pattern-2', memberEventIds: targetSeeds.slice(4),
    partitionStatus: 'resolved', grade: 'predictive-stable' });
  assert.throws(() => selectHierarchicalMultilevelOpaqueRelationLiveV1(
    split as unknown as HierarchicalMemorySnapshotV1, comparison, targetSeeds, contrastSeeds),
  /requires-one-containing-physical-pattern/);

  const sameMode = opaqueSelectionSnapshot([...targetSeeds, ...contrastSeeds], contrastSeeds) as unknown as {
    r2a: { patterns: { patternId: string; memberEventIds: string[] }[] };
  };
  sameMode.r2a.patterns[1]!.memberEventIds = [];
  assert.throws(() => selectHierarchicalMultilevelOpaqueRelationLiveV1(
    sameMode as unknown as HierarchicalMemorySnapshotV1, comparison, targetSeeds, contrastSeeds),
  /target-and-contrast-share-physical-pattern/);

  const nonPairwise = opaqueSelectionSnapshot(targetSeeds, contrastSeeds,
    ['contrast-pattern', 'unrelated-pattern']);
  assert.throws(() => selectHierarchicalMultilevelOpaqueRelationLiveV1(
    nonPairwise, comparison, targetSeeds, contrastSeeds),
  /foundation-relation-not-unique/);
});

test('all production arms are preregistered only as seven exact-action physical contrasts', () => {
  const seen = new Set<string>();
  for (const comparison of HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1) {
    assert.equal(cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.targetArm)),
      cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.contrastArm)));
    assert(!seen.has(comparison.targetArm)); assert(!seen.has(comparison.contrastArm));
    seen.add(comparison.targetArm); seen.add(comparison.contrastArm);
  }
  assert.equal(seen.size, 14);
  assert(!seen.has('observe-state-remains')); assert(!seen.has('wait-no-relevant-change'));
  assert.notEqual(cueIdentity(hierarchicalMultilevelActionCueLiveV1('look-plus-15-acquire')),
    cueIdentity(hierarchicalMultilevelActionCueLiveV1('look-minus-15-acquire')),
    'physically similar effects with different exact actions must not be merged by an arm label');
});

test('attention audit requires the real yaw wake, controller ingestion, matching invalidation and fresh recompetition', () => {
  const envelope = (requestId: string, observationSequence: number,
    invalidatedBy: 'attention' | null, fresh: boolean) => ({ requestId, epoch: 1,
      observationSequence, value: {}, invalidatedBy, fresh });
  const snapshot = (observationSequence: number, invalidatedBy: 'attention' | null,
    operation: 'predict-branch' | 'execute' = 'predict-branch') => ({
    workspace: { observationSequence, nodes: [{ node: { nodeId: 'n' },
      condition: envelope('condition-old', 10, invalidatedBy, invalidatedBy === null),
      prediction: envelope('prediction-old', 10, invalidatedBy, invalidatedBy === null) }] },
    lastDecision: { converged: true, operation, nodeId: 'n' },
  });
  const notice = { kind: 'unknown-change', sequence: 11, subjectId: 'self',
    evidence: [{ subject: 'self', property: 'yaw', before: 0, after: .5 }] };
  const records = [
    { kind: 'joint-control-decision', value: snapshot(10, null) },
    { kind: 'hierarchical-multilevel-precommitted-public-yaw-deviation',
      value: { beforeSequence: 10, afterSequence: 12 } },
    { kind: 'attention-wake', value: notice },
    { kind: 'joint-control-attention', value: { notice, retainedDependencyGraph: true } },
    { kind: 'joint-control-decision', value: snapshot(12, 'attention') },
  ];
  assert.equal(hierarchicalMultilevelAttentionAuditLiveV1(records, true).passed, true);
  assert.equal(hierarchicalMultilevelAttentionAuditLiveV1(records.filter(value =>
    value.kind !== 'joint-control-attention'), true).passed, false);
  const stale = [...records, { kind: 'joint-control-decision', value: snapshot(13, 'attention', 'execute') }];
  assert.equal(hierarchicalMultilevelAttentionAuditLiveV1(stale, true).passed, false);
});

test('C structure audit accepts only a real open-side factor transition connected to the forward branch', () => {
  const specification = minecraftHierarchicalMultilevelPlanLiveV1().heldouts.find(value =>
    value.case.tier === 'C')!.case;
  const evidence = { eventId: 'frozen-event', anchorId: 'a',
    r1: { pageId: 'r1', traceId: 'trace', active: true },
    r2: { coordinate: [0, 0, 0] as const, active: true },
    r2a: { relationIds: ['relation'], applicability: 1, productionEligible: true } };
  const forwardCue = { kind: 'move' as const,
    parameters: { direction: 'forward' as const, ticks: 4 }, targetRole: null };
  const lateralCue = { kind: 'move' as const,
    parameters: { direction: 'right' as const, ticks: 4 }, targetRole: null };
  const transition = { version: 'OpaqueFactorTransitionTraceV1', transitionId: 'side', eventId: 'side-event',
    actionCue: lateralCue, activatedFactorIds: ['factor'], deactivatedFactorIds: [],
    unchangedActiveFactorIds: [], evidence, meaning: 'observed-factor-transition' };
  const decision = { workspace: { observationSequence: 10,
    observation: { self: { position: [0, 64, 0] } },
    nodes: [
      { node: { nodeId: 'forward', kind: 'experienced', candidate: { actionCue: forwardCue } } },
      { node: { nodeId: 'side', kind: 'factor-transition', transition } },
    ], dependencies: [{ edgeId: 'edge', dependentNodeId: 'forward', requiredNodeId: 'side',
      factorIds: ['factor'], kind: 'opaque-factor' }] },
    lastDecision: { converged: true, operation: 'execute', nodeId: 'side' } };
  const result = { offer: { action: { kind: 'move', parameters: { direction: 'right', ticks: 4 } },
    cue: lateralCue }, result: { executed: true,
      observation: { self: { position: [.8, 64, 0] } } } };
  const records = [{ kind: 'joint-control-decision', value: decision },
    { kind: 'control-action-result', value: result }];
  const passed = hierarchicalMultilevelCStructureAuditLiveV1(records, specification);
  assert.equal(passed.openSide, 'right');
  assert.equal(passed.passed, true);
  const withoutEdge = structuredClone(records);
  (withoutEdge[0]!.value as typeof decision).workspace.dependencies = [];
  assert.equal(hierarchicalMultilevelCStructureAuditLiveV1(withoutEdge, specification).passed, false);
});

test('heldout scorer cannot pass a goal while structural, attention or reality audits fail', () => {
  const value = { caseId: 'A01', tier: 'A' as const, status: 'goal-verified', actions: 3,
    verified: true, dependencyDepth: 2, expectedMinimumDependencyDepth: 2 as const,
    baselineHashUnchanged: true, frozenPhysicalEvidencePassed: true,
    realButtonDoorEventPassed: true, rootRetained: true, staleRefusals: 0, invalidInteractions: 0,
    attention: { required: false, realDeviationSequence: null, notificationSequence: null,
      wakeKind: null, wakeEvidenceYaw: false, controllerIngested: false,
      oldConditionInvalidatedSequence: null, oldPredictionInvalidatedSequence: null,
      recompetitionSequence: null, staleEvidenceUsedAfterDeviation: false, passed: true },
    cStructure: { required: false, openSide: null, firstLateralDirection: null,
      firstLateralDeltaX: null, selectedFactorTransitionNodeId: null,
      opaqueDependencyObserved: false, factorIntersectionObserved: false,
      forwardParentObserved: false, openSideMatched: true, passed: true },
  };
  assert.equal(hierarchicalMultilevelHeldoutCasePassedLiveV1(value), true);
  assert.equal(hierarchicalMultilevelHeldoutCasePassedLiveV1({ ...value,
    realButtonDoorEventPassed: false }), false);
});

test('new runner is isolated from legacy memory and exposes only final goals after fixture seal', async () => {
  const source = await readFile('src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.ts', 'utf8');
  assert.doesNotMatch(source,
    /from ['"]\.\.\/memory\.js['"]|\bMemorySnapshot\b|PathProjector|parentFrames|resumeParent/);
  assert.match(source, /HierarchicalMemorySnapshotV1/);
  assert.match(source, /fixtureCommandCountAtGoal/);
  assert.match(source, /runGoal\(goal\)/);
  assert.match(source, /rootGoalOnly/);
  assert.doesNotMatch(source, /controller.*actionSequence|scripted.*subgoal|hardcoded.*jump/i);
});

test('production runner freezes and qualifies the current hierarchy before opening the single A/B/C batch', async () => {
  const source = await readFile('src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.ts', 'utf8');
  const atom128 = source.indexOf('foundationTimeline.length === 64');
  const coverageAudit = source.indexOf('auditHierarchicalMultilevelCalibrationCoverageLiveV1(', atom128);
  const coverageEvidence = source.indexOf("'CALIBRATION_128_COVERAGE.json'", coverageAudit);
  const save = source.indexOf('await saveExperienceBundleV1(baselineDirectory, frozen');
  const gate = source.indexOf('assert(qualification.passed');
  const heldout = source.indexOf('for (const heldoutCase of plan.heldouts)');
  const restore = source.indexOf('await restoreExperience(compute, pointerPath)', heldout);
  const runtime = source.indexOf('new V5Runtime(body', heldout);
  const runGoal = source.indexOf('runtime.runGoal(prepared.goal)', heldout);
  assert(atom128 >= 0 && coverageAudit > atom128 && coverageEvidence > coverageAudit);
  assert(gate >= 0 && save > gate && heldout > save);
  assert(restore > heldout && runtime > restore && runGoal > runtime);
  assert.match(source, /frozen\.annotations\.length === 368/);
  assert.match(source, /frozen\.r2Store\.events[\s\S]*=== 168/);
  assert.doesNotMatch(source, /hierarchical-multilevel-live-executor-not-yet-wired/);
});

test('frozen heldouts follow the committed pointer, snapshot and habit identities without legacy resume', async () => {
  const source = await readFile('src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.ts', 'utf8');
  const script = await readFile('scripts/run-minecraft-hierarchical-multilevel-goal-chain-live-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /experience-0368\.json/);
  assert.match(source, /baselinePointer\.filename/);
  assert.match(source, /baselinePointer\.habitFilename/);
  assert.match(source, /baselinePointerBefore/);
  assert.match(source, /baselineHabitBefore/);
  assert.doesNotMatch(source, /restoredExperience:\s*restored,[\s\S]{0,80}habit:\s*new ControlHabitWeightsV1/);
  assert.match(script, /hierarchical-multilevel-resume-is-audit-only/);
  assert.doesNotMatch(script, /resumeFrozenFrom/);
});
