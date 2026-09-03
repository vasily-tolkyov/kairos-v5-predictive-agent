import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { Vec3 } from 'vec3';
import type { Action, ActionCue, BodyResult, Observation, PrimitiveKind, RealEvent }
  from '../contracts.js';
import { MinecraftBody, publicBlockSelectionShapesV1 } from '../body.js';
import { Compute } from '../compute.js';
import type { ActionObservationScopeV1, BranchPredictionV1, ConditionApplicabilityV1,
  EffectRecallCandidateV1, GoalEvaluationV1, GroundedGoalV1, OpaqueFactorTransitionTraceV1,
} from '../control/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../control/goal.js';
import { dependencyDepthV2, factorTransitionCandidateForControlV2,
  type PhysicalControlSnapshotV2 } from '../control/controller.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { HIERARCHICAL_MEMORY_VERSION_V1, type HierarchicalMemorySnapshotV1 }
  from '../hierarchical-memory.js';
import type { HierarchicalMemoryObservationReceiptV1 } from '../hierarchical-memory.js';
import { cueIdentity, eventRows, relativePublicFeatures, realEventHierarchyContinuityV1 } from '../events.js';
import { restoreExperience, saveExperienceBundleV1, V5Runtime } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import type { R2AInterventionEvidenceV1, R2AInterventionProtocolV1 }
  from '../core/learning/r2a-stable-pattern.js';
import { readLegacyHierarchicalMemoryV9LiveV1,
  rebuildHierarchicalRoleBindingsFromTrustedEvidenceLiveV1,
  type LegacyHierarchicalMemoryV9LiveV1 }
  from './rebuild-hierarchical-role-bindings-live-v1.js';
import { DeterministicTokenFieldEncoder } from '../core/learning/token-field.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import {
  MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1,
  applyMinecraftFixtureCommandBatchLiveV1,
  assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1,
  materializeMinecraftMultilevelGuidedActionLiveV1,
  minecraftMultilevelGuidedActionScopeLiveV1,
  minecraftMultilevelGuidedGlobalCommandsLiveV1,
  prepareMinecraftMultilevelGuidedFixtureLiveV1,
  type MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  type MinecraftMultilevelGuidedTrainingModeLiveV1,
  type MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  type MinecraftMultilevelGuidedRepresentationProfileLiveV1,
  type PreparedMinecraftMultilevelGuidedFixtureLiveV1,
} from './minecraft-multilevel-guided-training-live-v1.js';
import {
  ironDoorOpenGoalV1,
  minecraftMultilevelGoalChainPerturbationsV1,
  minecraftMultilevelGoalChainCasesV1,
  type MultilevelGoalChainCaseV1,
} from './minecraft-multilevel-goal-chain-v1.js';
import {
  goalChainCaseInitialPositionLiveV1,
  goalChainObstacleGeometryLiveV1,
  goalChainLatchFixtureCommandsLiveV1,
  materializeLiveGoalChainCaseV1,
  publicSelectionAimPointLiveV1,
  UniqueButtonDoorReadinessGateV1,
} from './minecraft-multilevel-goal-chain-live-v1.js';
import { auditFrozenPhysicalActionEvidenceLiveV1 }
  from './minecraft-hierarchical-short-chain-live-v1.js';

/**
 * New hierarchical evaluation identity.  It deliberately does not reuse the
 * legacy single-action snapshot runner or mutate the accepted
 * attempt-011 button-door evidence.
 */
export const MINECRAFT_HIERARCHICAL_MULTILEVEL_GOAL_CHAIN_LIVE_V1 =
  'MinecraftHierarchicalMultilevelGoalChainLiveV1' as const;

export type HierarchicalMultilevelArmLiveV1 = MinecraftMultilevelGuidedTrainingModeLiveV1;

export interface HierarchicalMultilevelComparisonLiveV1 {
  readonly id: 'look-plus-acquire-vs-away' | 'look-minus-acquire-vs-away'
    | 'forward-clear-vs-blocked' | 'left-clear-vs-blocked'
    | 'right-clear-vs-blocked' | 'jump-clear-vs-blocked'
    | 'interact-wired-vs-disconnected';
  readonly targetArm: HierarchicalMultilevelArmLiveV1;
  readonly contrastArm: HierarchicalMultilevelArmLiveV1;
}

export const HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1:
readonly HierarchicalMultilevelComparisonLiveV1[] = Object.freeze([
  { id: 'look-plus-acquire-vs-away', targetArm: 'look-plus-15-acquire',
    contrastArm: 'look-plus-15-away' },
  { id: 'look-minus-acquire-vs-away', targetArm: 'look-minus-15-acquire',
    contrastArm: 'look-minus-15-away' },
  { id: 'forward-clear-vs-blocked', targetArm: 'forward-reduce-distance',
    contrastArm: 'forward-blocked' },
  { id: 'left-clear-vs-blocked', targetArm: 'left-clear', contrastArm: 'left-blocked' },
  { id: 'right-clear-vs-blocked', targetArm: 'right-clear', contrastArm: 'right-blocked' },
  { id: 'jump-clear-vs-blocked', targetArm: 'jump-forward-clear-one-block',
    contrastArm: 'jump-forward-blocked-low-roof-high-obstacle' },
  { id: 'interact-wired-vs-disconnected', targetArm: 'interact-wired-button-opens-iron-door',
    contrastArm: 'interact-visible-disconnected-button-no-door-change' },
] as const);

/** Observe/wait are mechanical verification/exploration operations.  Every
 * other learned primitive must have high-confidence physical production
 * evidence before it can execute as an experienced branch. */
export const HIERARCHICAL_MULTILEVEL_REQUIRED_PRODUCTION_ARMS_LIVE_V1 = Object.freeze(
  HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.map(value => value.targetArm),
);

/** Contrast arms are real stable outcomes, not goal-producing rules.  They
 * must remain distinguishable without acquiring production eligibility for
 * the corresponding positive effect. */
export const HIERARCHICAL_MULTILEVEL_REQUIRED_CONTRAST_ARMS_LIVE_V1 = Object.freeze(
  HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.map(value => value.contrastArm),
);

export const HIERARCHICAL_MULTILEVEL_NON_PRODUCTION_CONTROL_ARMS_LIVE_V1 = Object.freeze([
  'observe-state-remains', 'wait-no-relevant-change',
] as const satisfies readonly HierarchicalMultilevelArmLiveV1[]);

function requiresProductionR2LiveV1(arm: HierarchicalMultilevelArmLiveV1): boolean {
  return !HIERARCHICAL_MULTILEVEL_NON_PRODUCTION_CONTROL_ARMS_LIVE_V1.includes(arm as never);
}

export interface HierarchicalMultilevelTwoAtomChainLiveV1 {
  readonly actionBoundaryBefore: 'reset';
  readonly observeBoundaryBefore: 'continuous';
  readonly observeTicks: 5;
  readonly actionCue: ActionCue;
  readonly verificationCue: ActionCue;
}

export interface HierarchicalMultilevelTrainingEpisodeLiveV1 {
  readonly version: 'HierarchicalMultilevelTrainingEpisodeLiveV1';
  readonly episodeId: string;
  readonly phase: 'foundation' | 'intervention';
  readonly arm: HierarchicalMultilevelArmLiveV1;
  readonly comparison: HierarchicalMultilevelComparisonLiveV1['id'] | null;
  readonly pairIndex: 0 | 1 | 2 | 3 | null;
  readonly layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1;
  readonly representationProfile: MinecraftMultilevelGuidedRepresentationProfileLiveV1;
  readonly chain: HierarchicalMultilevelTwoAtomChainLiveV1;
  readonly fullSolutionDisclosed: false;
}

export interface MinecraftHierarchicalMultilevelPlanLiveV1 {
  readonly version: 'MinecraftHierarchicalMultilevelPlanLiveV1';
  readonly initialExperience: 'empty';
  readonly arms: readonly HierarchicalMultilevelArmLiveV1[];
  readonly foundation: readonly HierarchicalMultilevelTrainingEpisodeLiveV1[];
  readonly interventions: readonly HierarchicalMultilevelTrainingEpisodeLiveV1[];
  readonly foundationR1Atoms: 256;
  readonly foundationR2Events: 112;
  readonly foundationProductionR2Events: 112;
  readonly foundationR1OnlyControlAtoms: 32;
  readonly interventionR1Atoms: 112;
  readonly interventionR2Events: 56;
  readonly frozenR1Atoms: 368;
  readonly frozenR2Events: 168;
  readonly frozenProductionR2Events: 168;
  readonly frozenR1OnlyControlAtoms: 32;
  readonly fullSolutionTrainingFragments: 0;
  readonly heldouts: readonly HierarchicalMultilevelHeldoutCaseLiveV1[];
}

const CARDINALS = ['north', 'east', 'south', 'west'] as const;

function trainingLayout(contextIndex: number, phase: 'foundation' | 'intervention',
  comparisonIndex = 0): MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  assert(Number.isInteger(contextIndex) && contextIndex >= 0,
    'invalid-hierarchical-multilevel-context-index');
  const base = phase === 'foundation' ? 1040 : 1360 + comparisonIndex * 128;
  return Object.freeze({
    id: `hierarchical-multilevel-${phase}-${comparisonIndex}-${contextIndex + 1}`,
    split: contextIndex < 4 ? 'calibration' : 'consolidation',
    replication: contextIndex,
    originX: base + (contextIndex % 4) * 24,
    originZ: 1040 + Math.floor(contextIndex / 4) * 24,
    facing: CARDINALS[(contextIndex + comparisonIndex) % CARDINALS.length]!,
    neutralMarkerMask: (contextIndex + comparisonIndex) % 8,
  });
}

export function hierarchicalMultilevelActionCueLiveV1(
  arm: HierarchicalMultilevelArmLiveV1,
): ActionCue {
  if (arm.startsWith('look-plus'))
    return { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null };
  if (arm.startsWith('look-minus'))
    return { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 }, targetRole: null };
  if (arm.startsWith('forward-'))
    return { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null };
  if (arm.startsWith('left-'))
    return { kind: 'move', parameters: { direction: 'left', ticks: 4 }, targetRole: null };
  if (arm.startsWith('right-'))
    return { kind: 'move', parameters: { direction: 'right', ticks: 4 }, targetRole: null };
  if (arm.startsWith('jump-forward-'))
    return { kind: 'jump', parameters: { forward: true, ticks: 4 }, targetRole: null };
  if (arm.startsWith('interact-'))
    return { kind: 'interact', parameters: {}, targetRole: 'stone_button' };
  if (arm === 'observe-state-remains')
    return { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };
  return { kind: 'wait', parameters: { ticks: 5 }, targetRole: null };
}

/**
 * Representation coverage is independent of the eight neutral layout masks.
 * A public button proxy is the stable movement-effect subject; obstacle
 * materials only describe generic collision mechanisms for R2A.  Static
 * vocabulary panels occur solely in first-128 observe/wait episodes and are
 * never paired with a route-producing action.
 */
export function hierarchicalMultilevelRepresentationProfileLiveV1(
  arm: HierarchicalMultilevelArmLiveV1,
  phase: 'foundation' | 'intervention',
  layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
): MinecraftMultilevelGuidedRepresentationProfileLiveV1 {
  const mechanismMaterial = arm === 'forward-blocked' ? 'iron_bars' as const
    : arm.startsWith('left-') || arm.startsWith('right-') ? 'stone_bricks' as const
      : arm === 'jump-forward-clear-one-block'
        || arm === 'jump-forward-blocked-low-roof-high-obstacle' ? 'smooth_stone' as const : null;
  const calibrationVocabularyPanel = phase === 'foundation' && layout.split === 'calibration'
    && (arm === 'observe-state-remains' || arm === 'wait-no-relevant-change');
  const crosshairVocabularyMaterial = !calibrationVocabularyPanel ? null
    : arm === 'observe-state-remains' ? 'iron_bars' as const : 'stone_bricks' as const;
  return Object.freeze({ version: 'MinecraftMultilevelGuidedRepresentationProfileLiveV1',
    effectReference: arm.startsWith('left-') || arm.startsWith('right-')
      ? 'self-and-central-obstacle' : 'stone-button-proxy', mechanismMaterial,
    calibrationVocabularyPanel, crosshairVocabularyMaterial });
}

const verificationCue = Object.freeze({ kind: 'observe' as const,
  parameters: Object.freeze({ ticks: 5 }), targetRole: null });

function chain(arm: HierarchicalMultilevelArmLiveV1): HierarchicalMultilevelTwoAtomChainLiveV1 {
  return Object.freeze({ actionBoundaryBefore: 'reset', observeBoundaryBefore: 'continuous',
    observeTicks: 5, actionCue: hierarchicalMultilevelActionCueLiveV1(arm),
    verificationCue: structuredClone(verificationCue) });
}

export interface HierarchicalMultilevelHeldoutCaseLiveV1 {
  readonly version: 'HierarchicalMultilevelHeldoutCaseLiveV1';
  readonly case: MultilevelGoalChainCaseV1;
  readonly actionBudget: 32;
  readonly rootGoalOnly: true;
  readonly learnedActionOrderDisclosed: false;
  readonly expectedMinimumDependencyDepth: 2 | 3 | 4;
}

function heldouts(): readonly HierarchicalMultilevelHeldoutCaseLiveV1[] {
  return minecraftMultilevelGoalChainCasesV1.map(value => Object.freeze({
    version: 'HierarchicalMultilevelHeldoutCaseLiveV1' as const,
    case: structuredClone(value), actionBudget: 32 as const, rootGoalOnly: true as const,
    learnedActionOrderDisclosed: false as const,
    expectedMinimumDependencyDepth: value.tier === 'A' ? 2 as const
      : value.tier === 'B' ? 3 as const : 4 as const,
  }));
}

export function minecraftHierarchicalMultilevelPlanLiveV1():
MinecraftHierarchicalMultilevelPlanLiveV1 {
  const arms = [...MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1];
  // Four calibration contexts per arm provide the first 64 complete chains
  // (128 R1 atoms). Four new contexts per arm consolidate the frozen map.
  const foundation = Array.from({ length: 8 }, (_unused, contextIndex) => arms.map((arm, armIndex) => {
    const layout = trainingLayout(contextIndex, 'foundation');
    return {
      version: 'HierarchicalMultilevelTrainingEpisodeLiveV1' as const,
      episodeId: `foundation-${String(contextIndex * arms.length + armIndex + 1).padStart(3, '0')}`,
      phase: 'foundation' as const, arm,
      comparison: HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.find(value =>
        value.targetArm === arm || value.contrastArm === arm)?.id ?? null,
      pairIndex: null, layout,
      representationProfile: hierarchicalMultilevelRepresentationProfileLiveV1(
        arm, 'foundation', layout),
      chain: chain(arm), fullSolutionDisclosed: false as const,
    };
  })).flat();
  // These events occur only after the predictive relation exists and its
  // exact opaque-factor protocol has been preregistered.
  const interventions = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.flatMap((comparison, comparisonIndex) =>
    Array.from({ length: 4 }, (_unused, pairIndex) =>
      ([comparison.targetArm, comparison.contrastArm] as const).map((arm, armIndex) => {
        const layout = trainingLayout(pairIndex, 'intervention', comparisonIndex);
        return {
          version: 'HierarchicalMultilevelTrainingEpisodeLiveV1' as const,
          episodeId: `intervention-${comparison.id}-${pairIndex}-${armIndex}`,
          phase: 'intervention' as const, arm, comparison: comparison.id,
          pairIndex: pairIndex as 0 | 1 | 2 | 3, layout,
          representationProfile: hierarchicalMultilevelRepresentationProfileLiveV1(
            arm, 'intervention', layout),
          chain: chain(arm), fullSolutionDisclosed: false as const,
        };
      }))).flat();
  const result: MinecraftHierarchicalMultilevelPlanLiveV1 = {
    version: 'MinecraftHierarchicalMultilevelPlanLiveV1', initialExperience: 'empty',
    arms: Object.freeze(arms), foundation: Object.freeze(foundation),
    interventions: Object.freeze(interventions), foundationR1Atoms: 256,
    foundationR2Events: 112, foundationProductionR2Events: 112,
    foundationR1OnlyControlAtoms: 32,
    interventionR1Atoms: 112, interventionR2Events: 56,
    frozenR1Atoms: 368, frozenR2Events: 168, frozenProductionR2Events: 168,
    frozenR1OnlyControlAtoms: 32, fullSolutionTrainingFragments: 0,
    heldouts: Object.freeze(heldouts()),
  };
  assert(result.foundation.length === 128 && result.interventions.length === 56,
    'hierarchical-multilevel-plan-cardinality-invalid');
  return Object.freeze(result);
}

export function minecraftHierarchicalMultilevelPlanIdentityLiveV1(): string {
  return sha(minecraftHierarchicalMultilevelPlanLiveV1());
}

export interface ExpectedHierarchicalMultilevelR2ChainLiveV1 {
  readonly episodeId: string;
  readonly phase: 'foundation' | 'intervention';
  readonly arm: HierarchicalMultilevelArmLiveV1;
  readonly sourceEventIds: readonly [string, string];
  readonly orderedExperienceIdentities: readonly [string, string];
  readonly productionRequired: boolean;
}

/** Each production fragment must become exactly one complete two-atom R2
 * road. Pure no-change observe/wait atoms close within their own bounded R1
 * window and are deliberately not passed here or forced into a degenerate R2. */
export function exactHierarchicalMultilevelR2ChainsLiveV1(snapshot: HierarchicalMemorySnapshotV1,
  expected: readonly ExpectedHierarchicalMultilevelR2ChainLiveV1[]) {
  assert(expected.every(value => value.productionRequired),
    'hierarchical-multilevel-non-production-control-cannot-be-forced-into-R2');
  return expected.map(value => {
    const matches = snapshot.r2Store.events.filter(event => event.completion === 'complete'
      && canonical(event.sourceEventIds) === canonical(value.sourceEventIds));
    assert(matches.length === 1, `hierarchical-multilevel-exact-R2-chain-count:${value.episodeId}:${matches.length}`);
    const event = matches[0]!;
    assert(event.atomIds.length === 2
      && canonical(event.orderedExperienceIdentities) === canonical(value.orderedExperienceIdentities),
    `hierarchical-multilevel-R2-chain-order-invalid:${value.episodeId}`);
    assert(event.learningEligible && event.physicalStatus === 'deposited',
      `hierarchical-multilevel-production-R2-not-deposited:${value.episodeId}`);
    return event;
  });
}

export interface HierarchicalMultilevelOpaqueSelectionLiveV1 {
  readonly comparison: HierarchicalMultilevelComparisonLiveV1['id'];
  readonly targetPatternId: string;
  readonly contrastPatternId: string;
  readonly relationId: string;
  readonly changedFactorIds: readonly string[];
  readonly branchAtomIndex: 0;
  readonly exactNextActionIdentity: string;
  readonly formationMatchedPairs: readonly {
    readonly targetEventId: string;
    readonly contrastEventId: string;
  }[];
}

/** Select an already-formed physical branch without using an outcome name,
 * world coordinate or test answer.  Arm membership is preregistered before
 * training and only identifies which real R2 events belong to each contrast. */
export function selectHierarchicalMultilevelOpaqueRelationLiveV1(
  snapshot: HierarchicalMemorySnapshotV1,
  comparison: HierarchicalMultilevelComparisonLiveV1,
  targetEventIds: readonly string[], contrastEventIds: readonly string[],
): HierarchicalMultilevelOpaqueSelectionLiveV1 {
  assert(snapshot.r2a && snapshot.tokenEncoder, 'hierarchical-multilevel-selector-requires-R2A');
  const targetSet = new Set(targetEventIds), contrastSet = new Set(contrastEventIds);
  assert(targetSet.size === targetEventIds.length && contrastSet.size === contrastEventIds.length
    && targetEventIds.length === contrastEventIds.length
    && targetEventIds.length >= 4 && [...targetSet].every(id => !contrastSet.has(id)),
  `hierarchical-multilevel-arm-membership-invalid:${comparison.id}`);
  const containingPhysicalPattern = (members: ReadonlySet<string>) => {
    const matches = snapshot.r2a!.patterns.filter(pattern => pattern.partitionStatus === 'resolved'
      && [...members].every(id => pattern.memberEventIds.includes(id)));
    assert(matches.length === 1,
      `hierarchical-multilevel-requires-one-containing-physical-pattern:${comparison.id}:${matches.length}`);
    return matches[0]!;
  };
  const target = containingPhysicalPattern(targetSet), contrast = containingPhysicalPattern(contrastSet);
  assert(target.patternId !== contrast.patternId,
    `hierarchical-multilevel-target-and-contrast-share-physical-pattern:${comparison.id}`);
  const exactNextActionIdentity = cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.targetArm));
  assert(exactNextActionIdentity
    === cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.contrastArm)),
  `hierarchical-multilevel-contrast-action-not-exact:${comparison.id}`);
  const relations = snapshot.r2a.relations.filter(relation => relation.targetPatternId === target.patternId
    && relation.contrastPatternIds.length === 1 && relation.contrastPatternIds[0] === contrast.patternId
    && relation.branchAtomIndex === 0
    && relation.exactNextActionIdentity === exactNextActionIdentity
    && relation.predictiveSinceEventId !== null
    && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(relation.grade));
  assert(relations.length === 1,
    `hierarchical-multilevel-foundation-relation-not-unique:${comparison.id}:${relations.length}`);
  const relation = relations[0]!;
  const encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
  const evidence = new Map(snapshot.r2a.evidence.map(value => [value.eventId, value]));
  const values = (eventIds: readonly string[], tokenIndex: number) => eventIds.map(eventId => {
    const item = evidence.get(eventId);
    assert(item?.atomPrePerceptions[0],
      `hierarchical-multilevel-branch-perception-missing:${comparison.id}:${eventId}`);
    return encoder.encode(`${eventId}:atom:0`,
      new Float64Array(item.atomPrePerceptions[0]!)).tokens[tokenIndex]!.standardizedValue;
  });
  const mean = (input: readonly number[]) => input.reduce((sum, value) => sum + value, 0) / input.length;
  const changedFactorIds = relation.factorIds.filter(factorId => {
    const factor = snapshot.r2a!.factors.find(value => value.factorId === factorId);
    assert(factor, `hierarchical-multilevel-relation-factor-missing:${factorId}`);
    const positive = values(target.memberEventIds, factor.tokenIndex);
    const negative = values(contrast.memberEventIds, factor.tokenIndex);
    return Math.max(...positive) - Math.min(...positive) <= factor.tolerance
      && Math.max(...negative) - Math.min(...negative) <= factor.tolerance
      && Math.abs(mean(positive) - mean(negative)) > factor.tolerance;
  }).sort((left, right) => left.localeCompare(right, 'en'));
  assert(changedFactorIds.length > 0,
    `hierarchical-multilevel-opaque-factor-set-not-recovered:${comparison.id}`);
  return Object.freeze({ comparison: comparison.id, targetPatternId: target.patternId,
    contrastPatternId: contrast.patternId, relationId: relation.relationId,
    changedFactorIds: Object.freeze(changedFactorIds), branchAtomIndex: 0,
    exactNextActionIdentity,
    formationMatchedPairs: Object.freeze(targetEventIds.map((targetEventId, index) => Object.freeze({
      targetEventId, contrastEventId: contrastEventIds[index]!,
    }))) });
}

/** Resume an already-expanded frozen relation by its persisted physical
 * identity. Formation members are a preregistration boundary, not the final
 * pattern member set after prospective intervention events have arrived. */
export function restoreHierarchicalMultilevelOpaqueRelationLiveV1(
  snapshot: HierarchicalMemorySnapshotV1,
  comparison: HierarchicalMultilevelComparisonLiveV1,
  protocol: R2AInterventionProtocolV1,
): HierarchicalMultilevelOpaqueSelectionLiveV1 {
  assert(snapshot.r2a && snapshot.tokenEncoder, 'hierarchical-multilevel-resume-selector-requires-R2A');
  const relation = snapshot.r2a.relations.find(value => value.relationId === protocol.relationId);
  assert(relation && relation.branchAtomIndex === 0,
    `hierarchical-multilevel-resume-relation-invalid:${comparison.id}`);
  const exactNextActionIdentity = cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.targetArm));
  assert(exactNextActionIdentity === cueIdentity(hierarchicalMultilevelActionCueLiveV1(comparison.contrastArm))
    && relation.exactNextActionIdentity === exactNextActionIdentity,
  `hierarchical-multilevel-resume-action-identity-mismatch:${comparison.id}`);
  assert(relation.contrastPatternIds.length === 1,
    `hierarchical-multilevel-resume-contrast-pattern-not-unique:${comparison.id}`);
  const contrastPatternId = relation.contrastPatternIds[0]!;
  const target = snapshot.r2a.patterns.find(value => value.patternId === relation.targetPatternId);
  const contrast = snapshot.r2a.patterns.find(value => value.patternId === contrastPatternId);
  assert(target && contrast && target.patternId !== contrast.patternId,
    `hierarchical-multilevel-resume-pattern-missing:${comparison.id}`);
  const formationMatchedPairs = protocol.measurementBoundary.sourcePairs;
  assert(formationMatchedPairs.length >= 4
    && new Set(formationMatchedPairs.map(value => value.targetEventId)).size === formationMatchedPairs.length
    && new Set(formationMatchedPairs.map(value => value.contrastEventId)).size === formationMatchedPairs.length
    && formationMatchedPairs.every(value => target.memberEventIds.includes(value.targetEventId)
      && contrast.memberEventIds.includes(value.contrastEventId)),
  `hierarchical-multilevel-resume-formation-members-not-contained:${comparison.id}`);
  assert(protocol.changedFactorIds.length > 0
    && protocol.changedFactorIds.every(id => relation.factorIds.includes(id)
      && snapshot.r2a!.factors.some(value => value.factorId === id)),
  `hierarchical-multilevel-resume-factor-set-invalid:${comparison.id}`);
  const intervention = relation.factorSetInterventions.find(value => value.factorSetId === protocol.factorSetId
    && canonical(value.factorIds) === canonical(protocol.changedFactorIds));
  assert(relation.grade === 'intervention-supported' && intervention?.pairIds.length === 4,
    `hierarchical-multilevel-resume-relation-not-intervention-supported:${comparison.id}`);
  return Object.freeze({ comparison: comparison.id, targetPatternId: target.patternId,
    contrastPatternId: contrast.patternId, relationId: relation.relationId,
    changedFactorIds: Object.freeze([...protocol.changedFactorIds]), branchAtomIndex: 0,
    exactNextActionIdentity,
    formationMatchedPairs: Object.freeze(formationMatchedPairs.map(value => Object.freeze({ ...value }))) });
}

function retagHierarchicalEventLiveV1(event: RealEvent, sessionId: string,
  boundaryBefore: 'continuous' | 'reset'): RealEvent {
  const publicEvent = { ...event, hierarchyContinuity: undefined };
  return { ...publicEvent,
    hierarchyContinuity: realEventHierarchyContinuityV1(publicEvent, sessionId, boundaryBefore) };
}

class HierarchicalMultilevelFixtureCommandsLiveV1 {
  #sealed = false;
  #count = 0;
  readonly #forced = new Set<string>();
  constructor(readonly services: Services) {}
  command(command: string): void {
    assert(!this.#sealed, 'hierarchical-multilevel-fixture-command-after-seal');
    this.services.command(command); this.#count++;
  }
  ensureLoaded(originX: number, originZ: number): boolean {
    const command = `forceload add ${originX - 16} ${originZ - 16} ${originX + 16} ${originZ + 16}`;
    if (this.#forced.has(command)) return false;
    this.command(command); this.#forced.add(command); return true;
  }
  seal(): number { assert(!this.#sealed, 'hierarchical-multilevel-fixture-already-sealed');
    this.#sealed = true; return this.#count; }
  get count(): number { return this.#count; }
}

export function materializeTrainingEpisodeLiveV1(
  specification: HierarchicalMultilevelTrainingEpisodeLiveV1,
): MinecraftMultilevelGuidedTrainingEpisodeLiveV1 {
  const cue = specification.chain.actionCue;
  const action: Action = { kind: cue.kind as PrimitiveKind, parameters: { ...cue.parameters },
    ...(cue.kind === 'interact' ? { targetId: `${specification.layout.id}:materialized-at-runtime` } : {}) };
  const ordinal = Number(specification.episodeId.match(/(\d+)$/)?.[1] ?? 0);
  return { version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1', episode: ordinal,
    half: specification.phase === 'foundation' && ordinal <= 64
      ? 'first-128-calibration' : 'second-128-consolidation',
    mode: specification.arm, layout: specification.layout, action,
    representationProfile: specification.representationProfile,
    reset: 'before-this-episode-only', fullSolutionDisclosed: false };
}

function submitHierarchicalAtomLiveV1(compute: Compute, event: RealEvent) {
  return compute.call<HierarchicalMemoryObservationReceiptV1>('observe', event).then(
    receipt => ({ receipt } as const), error => ({ error } as const));
}

function acceptedHierarchicalAtomLiveV1(
  outcome: Awaited<ReturnType<typeof submitHierarchicalAtomLiveV1>>,
): HierarchicalMemoryObservationReceiptV1 {
  if ('error' in outcome) throw outcome.error;
  assert(outcome.receipt.representationRejection === null,
    `hierarchical-multilevel-event-unrepresented:${canonical(outcome.receipt.representationRejection)}`);
  return outcome.receipt;
}

export interface HierarchicalMultilevelTrainingChainExecutionLiveV1 {
  readonly specification: HierarchicalMultilevelTrainingEpisodeLiveV1;
  readonly prepared: PreparedMinecraftMultilevelGuidedFixtureLiveV1;
  readonly expectation: ExpectedHierarchicalMultilevelR2ChainLiveV1;
  readonly r2EventId: string | null;
}

export interface HierarchicalMultilevelCalibrationCoverageAuditLiveV1 {
  readonly version: 'HierarchicalMultilevelCalibrationCoverageAuditLiveV1';
  readonly atR1Atom: 128;
  readonly requiredVocabularyKeys: number;
  readonly missingVocabularyKeys: readonly string[];
  readonly forwardProxyEffectEventIds: readonly string[];
  readonly sideReferenceVisibilityExitEventIds: readonly string[];
  readonly neutralMarkerRelativeDistanceEffects: readonly string[];
  readonly comparisonContextDiscriminators: Readonly<Record<
    HierarchicalMultilevelComparisonLiveV1['id'], readonly string[]>>;
  readonly contextVocabularySha256: string;
  readonly passed: true;
}

export function hierarchicalMultilevelRequiredCalibrationVocabularyKeysLiveV1(): readonly string[] {
  const spatialKeys = (type: string, count: number) => Array.from({ length: count }, (_unused, ordinal) => [
    `visible/${type}/${ordinal}/present`, `visible/${type}/${ordinal}/relativeDistance`,
    `visible/${type}/${ordinal}/egocentric/forward`, `visible/${type}/${ordinal}/egocentric/right`,
    `visible/${type}/${ordinal}/egocentric/up`,
  ]).flat();
  const ironStateKeys = Array.from({ length: 15 }, (_unused, ordinal) => [
    ...['north', 'east', 'south', 'west'].flatMap(direction => [
      `visible/iron_bars/${ordinal}/${direction}=true`,
      `visible/iron_bars/${ordinal}/${direction}=false`,
    ]),
    `visible/iron_bars/${ordinal}/waterlogged=false`,
  ]).flat();
  return Object.freeze([
    ...spatialKeys('iron_bars', 15), ...ironStateKeys,
    ...spatialKeys('stone_bricks', 12),
    'crosshair/target-type="iron_bars"', 'crosshair/target-type="stone_bricks"',
  ].sort());
}

/** Fail at the map-freeze boundary, before a 129th real atom can be attempted. */
export function auditHierarchicalMultilevelCalibrationCoverageLiveV1(
  snapshot: HierarchicalMemorySnapshotV1,
  timeline: readonly HierarchicalMultilevelTrainingChainExecutionLiveV1[],
): HierarchicalMultilevelCalibrationCoverageAuditLiveV1 {
  assert(snapshot.eventMap && snapshot.writes === 128 && snapshot.annotations.length === 128,
    'hierarchical-multilevel-calibration-audit-not-at-128-atoms');
  assert(timeline.length === 64,
    'hierarchical-multilevel-calibration-audit-not-at-64-chains');
  const vocabulary = new Set(snapshot.contextVocabulary);
  const required = hierarchicalMultilevelRequiredCalibrationVocabularyKeysLiveV1();
  const missingVocabularyKeys = required.filter(key => !vocabulary.has(key));
  assert(missingVocabularyKeys.length === 0,
    `hierarchical-multilevel-calibration-vocabulary-incomplete:${canonical(missingVocabularyKeys)}`);
  const annotations = new Map(snapshot.annotations.map(value => [value.eventId, value]));
  const forwardProxyEffectEventIds = timeline.filter(value =>
    value.specification.arm === 'forward-reduce-distance').map(value => {
    const eventId = value.expectation.sourceEventIds[0];
    const annotation = annotations.get(eventId);
    assert(annotation?.kernelChanges.flat().some(change => change.subject.startsWith('stone_button#')
      && change.property === 'relativeDistance' && typeof change.before === 'number'
      && typeof change.after === 'number' && change.after < change.before),
    `hierarchical-multilevel-forward-proxy-effect-missing:${eventId}`);
    return eventId;
  });
  assert(forwardProxyEffectEventIds.length === 4,
    'hierarchical-multilevel-forward-proxy-calibration-count-invalid');
  const sideReferenceVisibilityExitEventIds = timeline.filter(value =>
    value.specification.arm === 'left-clear' || value.specification.arm === 'right-clear').map(value => {
    const eventId = value.expectation.sourceEventIds[0];
    const annotation = annotations.get(eventId);
    assert(annotation?.kernelChanges.flat().some(change => change.subject.startsWith('iron_bars#')
      && change.property === 'visible' && change.before === true && change.after === false),
    `hierarchical-multilevel-side-visibility-exit-missing:${eventId}`);
    return eventId;
  });
  assert(sideReferenceVisibilityExitEventIds.length === 8,
    'hierarchical-multilevel-side-visibility-calibration-count-invalid');
  const neutralMarkerRelativeDistanceEffects = snapshot.annotations.flatMap(annotation =>
    annotation.kernelChanges.flat().filter(change => /_wool#[0-9]+$/.test(change.subject)
      && change.property === 'relativeDistance').map(change => `${annotation.eventId}:${change.subject}`));
  assert(neutralMarkerRelativeDistanceEffects.length === 0,
    `hierarchical-multilevel-neutral-marker-became-effect:${canonical(neutralMarkerRelativeDistanceEffects)}`);
  // The public vocabulary can be larger than the 256 values actually exposed
  // to R2A.  A calibration panel is useful only if it does not crowd every
  // real target/contrast difference out of those active condition channels.
  // Require a consistently signed discriminator for every preregistered
  // comparison, using only the real before-action observations already in
  // the first 128 atoms.  This checks capacity without naming a Minecraft
  // feature or teaching an action order.
  const activeContextKeys = new Set(snapshot.contextKeys);
  const comparisonContextDiscriminators = Object.fromEntries(
    HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.map(comparison => {
      const target = timeline.filter(value => value.specification.arm === comparison.targetArm);
      const contrast = timeline.filter(value => value.specification.arm === comparison.contrastArm);
      assert(target.length === 4 && contrast.length === 4,
        `hierarchical-multilevel-calibration-comparison-cardinality:${comparison.id}`);
      const contrastByLayout = new Map(contrast.map(value =>
        [value.specification.layout.id, relativePublicFeatures(value.prepared.observation)]));
      const pairs = target.map(value => {
        const other = contrastByLayout.get(value.specification.layout.id);
        assert(other, `hierarchical-multilevel-calibration-comparison-layout-missing:${comparison.id}`);
        return [relativePublicFeatures(value.prepared.observation), other] as const;
      });
      const discriminators = [...activeContextKeys].filter(key => {
        const differences = pairs.map(([positive, negative]) =>
          (positive[key] ?? 0) - (negative[key] ?? 0));
        return differences.every(value => Math.abs(value) > 1e-9)
          && (differences.every(value => value > 0) || differences.every(value => value < 0));
      }).sort();
      assert(discriminators.length > 0,
        `hierarchical-multilevel-calibration-condition-capacity-missing:${comparison.id}`);
      return [comparison.id, Object.freeze(discriminators)] as const;
    }),
  ) as Readonly<Record<HierarchicalMultilevelComparisonLiveV1['id'], readonly string[]>>;
  return Object.freeze({ version: 'HierarchicalMultilevelCalibrationCoverageAuditLiveV1',
    atR1Atom: 128, requiredVocabularyKeys: required.length,
    missingVocabularyKeys: Object.freeze(missingVocabularyKeys),
    forwardProxyEffectEventIds: Object.freeze(forwardProxyEffectEventIds),
    sideReferenceVisibilityExitEventIds: Object.freeze(sideReferenceVisibilityExitEventIds),
    neutralMarkerRelativeDistanceEffects: Object.freeze(neutralMarkerRelativeDistanceEffects),
    comparisonContextDiscriminators,
    contextVocabularySha256: sha(snapshot.contextVocabulary), passed: true });
}

async function executeHierarchicalMultilevelTrainingChainLiveV1(compute: Compute,
  commands: HierarchicalMultilevelFixtureCommandsLiveV1, body: MinecraftBody,
  specification: HierarchicalMultilevelTrainingEpisodeLiveV1,
  verifyImmediately: boolean,
): Promise<HierarchicalMultilevelTrainingChainExecutionLiveV1> {
  if (commands.ensureLoaded(specification.layout.originX, specification.layout.originZ))
    await body.waitTicks(20);
  const episode = materializeTrainingEpisodeLiveV1(specification);
  const prepared = await prepareMinecraftMultilevelGuidedFixtureLiveV1(commands, body, episode);
  const scope = minecraftMultilevelGuidedActionScopeLiveV1(episode, prepared);
  const action = materializeMinecraftMultilevelGuidedActionLiveV1(episode, prepared);
  const firstExecution = await body.execute(action, scope);
  assert(firstExecution.result.executed && firstExecution.event,
    `hierarchical-multilevel-guided-action-failed:${specification.episodeId}`);
  assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(episode, prepared, firstExecution.event);
  const first = retagHierarchicalEventLiveV1(firstExecution.event, body.session.id, 'reset');
  const firstLearning = submitHierarchicalAtomLiveV1(compute, first);
  const secondExecution = await body.execute({ kind: 'observe', parameters: { ticks: 5 } }, scope);
  assert(secondExecution.result.executed && secondExecution.event,
    `hierarchical-multilevel-verification-observe-failed:${specification.episodeId}`);
  const second = retagHierarchicalEventLiveV1(secondExecution.event, body.session.id, 'continuous');
  acceptedHierarchicalAtomLiveV1(await firstLearning);
  acceptedHierarchicalAtomLiveV1(await submitHierarchicalAtomLiveV1(compute, second));
  const expectation: ExpectedHierarchicalMultilevelR2ChainLiveV1 = {
    episodeId: specification.episodeId, phase: specification.phase, arm: specification.arm,
    sourceEventIds: [first.id, second.id],
    orderedExperienceIdentities: [cueIdentity(first.cue), cueIdentity(second.cue)],
    productionRequired: requiresProductionR2LiveV1(specification.arm),
  };
  const r2Event = verifyImmediately
    ? exactHierarchicalMultilevelR2ChainsLiveV1(
      await compute.call<HierarchicalMemorySnapshotV1>('snapshot'), [expectation])[0]! : null;
  return { specification, prepared, expectation, r2EventId: r2Event?.eventId ?? null };
}

export type HierarchicalMultilevelProductionArmQualificationLiveV1 = {
  readonly arm: typeof HIERARCHICAL_MULTILEVEL_REQUIRED_PRODUCTION_ARMS_LIVE_V1[number];
  readonly effectRecalled: boolean;
  readonly r1Active: boolean;
  readonly r2Active: boolean;
  readonly relationGrade: 'single-observation' | 'repeated-correlation' | 'predictive-stable'
    | 'causal-hypothesis' | 'intervention-supported';
  readonly positiveApplicability: number;
  readonly positiveProductionEligible: boolean;
  readonly negativeApplicability: number;
  readonly validSampleCount: number;
  readonly progressFraction: number;
  readonly negativeProductionEligible: boolean;
  /** All members are fixed before rollout by exact action and physical
   * relation identity.  The controller is allowed to compare those members;
   * the qualification gate must not substitute an arbitrary hash-first one. */
  readonly physicalCandidateCount: number;
  readonly attemptedPredictionCount: number;
  readonly winningCandidateId: string | null;
  readonly readoutDiagnostics: BranchPredictionV1['readoutDiagnostics'] | null;
};

export interface HierarchicalMultilevelContrastQualificationLiveV1 {
  readonly arm: typeof HIERARCHICAL_MULTILEVEL_REQUIRED_CONTRAST_ARMS_LIVE_V1[number];
  readonly stablePatternRecalled: boolean;
  readonly distinctFromTargetPattern: boolean;
  readonly productionEligibleForTargetEffect: boolean;
}

export const HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1 = Object.freeze([
  'forward-blocked-to-left', 'forward-blocked-to-right',
] as const);

export interface HierarchicalMultilevelFactorBridgeQualificationLiveV1 {
  readonly id: typeof HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1[number];
  readonly missingFactorIds: readonly string[];
  readonly transitionRecalled: boolean;
  readonly transitionProductionEligible: boolean;
  readonly winningTransitionId: string | null;
  readonly factorProgressSampleCount: number;
  readonly progressBasis: 'predicted-parent-R2A-relation-complete';
  readonly baseObservationSequence: number | null;
  readonly validSampleCount: number;
  readonly progressFraction: number;
  readonly matchingTransitionCount: number;
  readonly conditionEligibleTransitionCount: number;
  readonly attemptedPredictionCount: number;
}

export interface HierarchicalMultilevelRepresentationContractLiveV1 {
  readonly version: 'HierarchicalMultilevelRepresentationContractLiveV1';
  readonly contractId: 'baseline-368-168-v1' | 'continuous-bridge-772-312-v1';
  readonly r1Atoms: number;
  readonly r2Events: number;
  readonly productionR2Events: number;
  readonly r1OnlyControlAtoms: number;
  readonly allowedR2AtomCounts: readonly number[];
}

export const HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1:
HierarchicalMultilevelRepresentationContractLiveV1 = Object.freeze({
  version: 'HierarchicalMultilevelRepresentationContractLiveV1',
  contractId: 'baseline-368-168-v1',
  r1Atoms: 368,
  r2Events: 168,
  productionR2Events: 168,
  r1OnlyControlAtoms: 32,
  allowedR2AtomCounts: Object.freeze([2]),
});

export const HIERARCHICAL_MULTILEVEL_CONTINUOUS_BRIDGE_REPRESENTATION_CONTRACT_LIVE_V1:
HierarchicalMultilevelRepresentationContractLiveV1 = Object.freeze({
  version: 'HierarchicalMultilevelRepresentationContractLiveV1',
  contractId: 'continuous-bridge-772-312-v1',
  r1Atoms: 772,
  r2Events: 312,
  productionR2Events: 312,
  r1OnlyControlAtoms: 32,
  allowedR2AtomCounts: Object.freeze([2, 3]),
});

export interface HierarchicalMultilevelRepresentationEvidenceLiveV1 {
  readonly r1Atoms: number;
  readonly r2Events: number;
  readonly productionR2Events: number;
  readonly r1OnlyControlAtoms: number;
  readonly representationRejections: number;
  readonly invalidR2Events: number;
}

export interface MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1 {
  readonly version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1';
  readonly representation: HierarchicalMultilevelRepresentationEvidenceLiveV1;
  readonly arms: readonly HierarchicalMultilevelProductionArmQualificationLiveV1[];
  readonly contrasts: readonly HierarchicalMultilevelContrastQualificationLiveV1[];
  readonly bridges: readonly HierarchicalMultilevelFactorBridgeQualificationLiveV1[];
  readonly queryChangedSnapshot: boolean;
}

export interface MinecraftHierarchicalMultilevelQualificationResultLiveV1 {
  readonly version: 'MinecraftHierarchicalMultilevelQualificationResultLiveV1';
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/** Pure fail-closed gate used before any A/B/C fixture is built. */
export function minecraftHierarchicalMultilevelQualificationGateLiveV1(
  evidence: MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1,
  representationContract: HierarchicalMultilevelRepresentationContractLiveV1 =
    HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1,
): MinecraftHierarchicalMultilevelQualificationResultLiveV1 {
  const failures: string[] = [];
  const representation = evidence.representation;
  if (representation.r1Atoms !== representationContract.r1Atoms
    || representation.r2Events !== representationContract.r2Events
    || representation.productionR2Events !== representationContract.productionR2Events
    || representation.r1OnlyControlAtoms !== representationContract.r1OnlyControlAtoms
    || representation.representationRejections !== 0
    || representation.invalidR2Events !== 0)
    failures.push('hierarchical-representation-cardinality-or-completion-failed');
  const byArm = new Map(evidence.arms.map(value => [value.arm, value]));
  if (byArm.size !== evidence.arms.length) failures.push('duplicate-production-arm-qualification');
  for (const arm of HIERARCHICAL_MULTILEVEL_REQUIRED_PRODUCTION_ARMS_LIVE_V1) {
    const value = byArm.get(arm);
    if (!value || !value.effectRecalled || !value.r1Active || !value.r2Active
      || value.relationGrade !== 'intervention-supported'
      || !(value.positiveApplicability > 0) || !value.positiveProductionEligible
      || value.negativeApplicability !== 0
      || value.negativeProductionEligible
      || value.validSampleCount < 8 || value.progressFraction < .75)
      failures.push(`production-arm-unqualified:${arm}`);
  }
  const byContrast = new Map(evidence.contrasts.map(value => [value.arm, value]));
  if (byContrast.size !== evidence.contrasts.length) failures.push('duplicate-contrast-arm-qualification');
  for (const arm of HIERARCHICAL_MULTILEVEL_REQUIRED_CONTRAST_ARMS_LIVE_V1) {
    const value = byContrast.get(arm);
    if (!value || !value.stablePatternRecalled || !value.distinctFromTargetPattern
      || value.productionEligibleForTargetEffect !== false)
      failures.push(`contrast-arm-unqualified:${arm}`);
  }
  const byBridge = new Map(evidence.bridges.map(value => [value.id, value]));
  if (byBridge.size !== evidence.bridges.length) failures.push('duplicate-factor-transition-bridge-qualification');
  for (const id of HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1) {
    const value = byBridge.get(id);
    if (!value || value.missingFactorIds.length === 0 || !value.transitionRecalled
      || !value.transitionProductionEligible || value.validSampleCount < 8
      || value.progressFraction < .75)
      failures.push(`factor-transition-bridge-unqualified:${id}`);
  }
  if (evidence.queryChangedSnapshot) failures.push('read-only-qualification-mutated-frozen-snapshot');
  return Object.freeze({ version: 'MinecraftHierarchicalMultilevelQualificationResultLiveV1',
    passed: failures.length === 0, failures: Object.freeze(failures) });
}

export interface HierarchicalMultilevelReadOnlyProbeLiveV1 {
  readonly comparison: HierarchicalMultilevelComparisonLiveV1;
  readonly selection: HierarchicalMultilevelOpaqueSelectionLiveV1;
  readonly target: PreparedMinecraftMultilevelGuidedFixtureLiveV1;
  readonly targetObservation: Observation;
  readonly contrast: PreparedMinecraftMultilevelGuidedFixtureLiveV1;
  readonly contrastObservation: Observation;
}

function predicateGoalLiveV1(id: string, subject: GroundedGoalV1['expression'] extends never
  ? never : import('../control/contracts.js').GroundedSubjectV1,
observable: import('../control/contracts.js').PublicObservableV2,
comparator: 'equals' | 'greater-than' | 'less-than' | 'decrease', target: unknown): GroundedGoalV1 {
  const predicate = comparator === 'decrease'
    ? { version: 'GoalPredicateV1' as const, id: `${id}:predicate`, subject, observable,
      comparator, minimumDelta: target as number }
    : comparator === 'equals'
      ? { version: 'GoalPredicateV1' as const, id: `${id}:predicate`, subject, observable,
        comparator, target: target as import('../contracts.js').PublicValue }
      : { version: 'GoalPredicateV1' as const, id: `${id}:predicate`, subject, observable,
        comparator, target: target as number };
  return { version: 'GroundedGoalV1', id,
    expression: { kind: 'predicate', predicate } };
}

function effectGoalForProbeLiveV1(probe: HierarchicalMultilevelReadOnlyProbeLiveV1): GroundedGoalV1 {
  const id = `hierarchical-multilevel-D:${probe.comparison.id}`;
  const observation = probe.targetObservation, fixture = probe.target;
  if (probe.comparison.targetArm.startsWith('look-'))
    return predicateGoalLiveV1(id, { kind: 'crosshair' }, 'type', 'equals', 'stone_button');
  if (probe.comparison.targetArm === 'forward-reduce-distance') {
    const object = observation.objects.find(value => value.id === fixture.referenceId);
    assert(object, `hierarchical-multilevel-D-reference-not-public:${probe.comparison.id}`);
    return predicateGoalLiveV1(id, { kind: 'public-object', id: object.id, expectedType: object.type },
      'relativeDistance', 'decrease', .25);
  }
  if (probe.comparison.targetArm === 'left-clear' || probe.comparison.targetArm === 'right-clear') {
    const geometry = fixture.geometry, left = probe.comparison.targetArm === 'left-clear';
    const axis = geometry.right[0] === 0 ? 2 as const : 0 as const;
    const signed = (left ? -1 : 1) * (axis === 0 ? geometry.right[0] : geometry.right[1]);
    const current = observation.self.position[axis]!, target = current + Math.sign(signed) * .25;
    return predicateGoalLiveV1(id, { kind: 'self' }, `position.${axis}`,
      signed < 0 ? 'less-than' : 'greater-than', target);
  }
  if (probe.comparison.targetArm === 'jump-forward-clear-one-block') {
    const object = observation.objects.find(value => value.id === fixture.referenceId);
    assert(object, `hierarchical-multilevel-D-reference-not-public:${probe.comparison.id}`);
    return predicateGoalLiveV1(id, { kind: 'public-object', id: object.id, expectedType: object.type },
      'relativeDistance', 'decrease', .25);
  }
  assert(fixture.doorId, 'hierarchical-multilevel-D-door-id-missing');
  return predicateGoalLiveV1(id, { kind: 'public-object', id: fixture.doorId,
    expectedType: 'iron_door' }, 'properties.open', 'equals', true);
}

function exactPhysicalCandidatesLiveV1(candidates: readonly EffectRecallCandidateV1[],
  selection: HierarchicalMultilevelOpaqueSelectionLiveV1): readonly EffectRecallCandidateV1[] {
  return candidates.filter(candidate => cueIdentity(candidate.actionCue) === selection.exactNextActionIdentity
    && candidate.evidence.r2a.relationIds.includes(selection.relationId));
}

const qualificationProgressPassedLiveV1 = (prediction: BranchPredictionV1): boolean =>
  prediction.validSampleCount >= 8 && prediction.progressFraction >= .75;

type QualificationCandidateEvaluationLiveV1 = {
  readonly candidate: EffectRecallCandidateV1;
  readonly positive: ConditionApplicabilityV1;
  readonly negative: ConditionApplicabilityV1;
  readonly prediction: BranchPredictionV1;
};

const qualificationCandidatePassedLiveV1 = (value: QualificationCandidateEvaluationLiveV1): boolean =>
  value.positive.productionEligible && value.positive.applicability > 0
  && value.positive.unknownFactorIds.length === 0 && value.positive.contradictedFactorIds.length === 0
  && !value.negative.productionEligible && value.negative.applicability === 0
  && qualificationProgressPassedLiveV1(value.prediction);

/** The production controller predicts every losslessly grouped physical
 * member and lets rollout evidence select a member.  Gate D mirrors that
 * semantics, but stops once the frozen threshold is proven.  Candidate order
 * is deterministic and contains no result label or heldout information. */
async function qualifyPhysicalCandidateGroupLiveV1(compute: Compute,
  candidates: readonly EffectRecallCandidateV1[], targetObservation: Observation,
  contrastObservation: Observation, goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
): Promise<{ readonly best: QualificationCandidateEvaluationLiveV1 | null;
  readonly attemptedPredictionCount: number }> {
  const attempted: QualificationCandidateEvaluationLiveV1[] = [];
  let attemptedPredictionCount = 0;
  for (const candidate of candidates) {
    const positive = await compute.call<ConditionApplicabilityV1>('compareConditions',
      candidate, targetObservation);
    const negative = await compute.call<ConditionApplicabilityV1>('compareConditions',
      candidate, contrastObservation);
    const conditionEligible = positive.productionEligible && positive.applicability > 0
      && positive.unknownFactorIds.length === 0 && positive.contradictedFactorIds.length === 0
      && !negative.productionEligible && negative.applicability === 0;
    const prediction: BranchPredictionV1 = conditionEligible
      ? await (async () => {
        attemptedPredictionCount++;
        return compute.call<BranchPredictionV1>('predictCandidate',
          candidate, targetObservation, goal, evaluation);
      })()
      : { prediction: { kind: 'hypothetical-prediction', support: 0,
        version: 'DistributedPredictionV3', calibratedProbability: false, samples: [],
        evidence: candidate.evidence,
        unknown: ['D-current-condition-or-contrast-gate-failed'], substrateSha256: null },
      currentEvidence: candidate.evidence, validSampleCount: 0, progressSampleCount: 0,
      progressFraction: 0, nextStates: [], unknown: ['D-current-condition-or-contrast-gate-failed'] };
    const value = { candidate, positive, negative, prediction };
    attempted.push(value);
    if (qualificationCandidatePassedLiveV1(value)) break;
  }
  const best = [...attempted].sort((left, right) =>
    Number(qualificationCandidatePassedLiveV1(right)) - Number(qualificationCandidatePassedLiveV1(left))
    || Number(qualificationProgressPassedLiveV1(right.prediction))
      - Number(qualificationProgressPassedLiveV1(left.prediction))
    || Number(right.positive.productionEligible) - Number(left.positive.productionEligible)
    || right.prediction.progressFraction - left.prediction.progressFraction
    || right.prediction.validSampleCount - left.prediction.validSampleCount
    || right.positive.applicability - left.positive.applicability
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId, 'en'))[0] ?? null;
  return { best, attemptedPredictionCount };
}

const BRIDGE_TARGET_ARMS_LIVE_V1: Readonly<Record<
typeof HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1[number],
HierarchicalMultilevelArmLiveV1>> = Object.freeze({
  'forward-blocked-to-left': 'left-clear',
  'forward-blocked-to-right': 'right-clear',
});

export function hierarchicalMultilevelBridgeTargetArmLiveV1(
  id: typeof HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1[number],
): HierarchicalMultilevelArmLiveV1 { return BRIDGE_TARGET_ARMS_LIVE_V1[id]; }

/** Gate D performs only worker queries.  It does not execute an action or
 * submit an observation; the pre/post hash equality is therefore mandatory. */
export async function collectHierarchicalMultilevelQualificationLiveV1(compute: Compute,
  frozen: HierarchicalMemorySnapshotV1,
  probes: readonly HierarchicalMultilevelReadOnlyProbeLiveV1[],
  representationContract: HierarchicalMultilevelRepresentationContractLiveV1 =
    HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1,
): Promise<MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1> {
  const before = await compute.call<string>('hash');
  assert(before === sha(frozen), 'hierarchical-multilevel-D-input-is-not-frozen-snapshot');
  const arms: HierarchicalMultilevelProductionArmQualificationLiveV1[] = [];
  const contrasts: HierarchicalMultilevelContrastQualificationLiveV1[] = [];
  const working = new Map<HierarchicalMultilevelComparisonLiveV1['id'], {
    probe: HierarchicalMultilevelReadOnlyProbeLiveV1;
    candidates: readonly EffectRecallCandidateV1[];
    best: QualificationCandidateEvaluationLiveV1 | null }>();
  for (const probe of probes) {
    const goal = effectGoalForProbeLiveV1(probe), evaluator = new GroundedGoalEvaluatorV1();
    evaluator.setGoal(goal, probe.targetObservation);
    const evaluation = evaluator.evaluate(probe.targetObservation);
    const candidates = await compute.call<readonly EffectRecallCandidateV1[]>('recallAtomicEffect',
      goal, evaluation, probe.targetObservation);
    const physicalCandidates = exactPhysicalCandidatesLiveV1(candidates, probe.selection);
    const emptyCondition: ConditionApplicabilityV1 = { matchedFactorIds: [], contradictedFactorIds: [],
      unknownFactorIds: [], applicability: 0, productionEligible: false };
    const emptyPrediction: BranchPredictionV1 = { prediction: { kind: 'hypothetical-prediction',
      version: 'DistributedPredictionV3', support: 0, calibratedProbability: false, samples: [],
      evidence: null, unknown: ['D-effect-candidate-missing'],
      substrateSha256: frozen.eventMap ? sha(frozen.eventMap) : null },
    validSampleCount: 0, progressSampleCount: 0, progressFraction: 0,
    nextStates: [], unknown: ['D-effect-candidate-missing'] };
    const group = physicalCandidates.length > 0
      ? await qualifyPhysicalCandidateGroupLiveV1(compute, physicalCandidates,
        probe.targetObservation, probe.contrastObservation, goal, evaluation)
      : { best: null, attemptedPredictionCount: 0 };
    const positive = group.best?.positive ?? emptyCondition;
    const negative = group.best?.negative ?? emptyCondition;
    const prediction = group.best?.prediction ?? emptyPrediction;
    const relation = frozen.r2a?.relations.find(value => value.relationId === probe.selection.relationId);
    const targetPattern = frozen.r2a?.patterns.find(value => value.patternId === probe.selection.targetPatternId);
    const contrastPattern = frozen.r2a?.patterns.find(value => value.patternId === probe.selection.contrastPatternId);
    arms.push({ arm: probe.comparison.targetArm, effectRecalled: physicalCandidates.length > 0,
      r1Active: group.best?.candidate.evidence.r1.active ?? false,
      r2Active: group.best?.candidate.evidence.r2.active ?? false,
      relationGrade: relation?.grade ?? 'single-observation',
      positiveApplicability: positive.applicability,
      positiveProductionEligible: positive.productionEligible,
      negativeApplicability: negative.applicability,
      validSampleCount: prediction.validSampleCount, progressFraction: prediction.progressFraction,
      negativeProductionEligible: negative.productionEligible,
      physicalCandidateCount: physicalCandidates.length,
      attemptedPredictionCount: group.attemptedPredictionCount,
      winningCandidateId: qualificationProgressPassedLiveV1(prediction)
        ? group.best?.candidate.candidateId ?? null : null,
      readoutDiagnostics: prediction.readoutDiagnostics ?? null });
    contrasts.push({ arm: probe.comparison.contrastArm,
      stablePatternRecalled: contrastPattern !== undefined
        && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(contrastPattern.grade),
      distinctFromTargetPattern: targetPattern !== undefined && contrastPattern !== undefined
        && targetPattern.patternId !== contrastPattern.patternId,
      productionEligibleForTargetEffect: negative.productionEligible });
    working.set(probe.comparison.id, { probe, candidates: physicalCandidates, best: group.best });
  }
  const forward = working.get('forward-clear-vs-blocked');
  const bridgeCues: Readonly<Record<typeof HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1[number],
  ActionCue>> = {
    'forward-blocked-to-left': hierarchicalMultilevelActionCueLiveV1('left-clear'),
    'forward-blocked-to-right': hierarchicalMultilevelActionCueLiveV1('right-clear'),
  };
  const bridges: HierarchicalMultilevelFactorBridgeQualificationLiveV1[] = [];
  for (const id of HIERARCHICAL_MULTILEVEL_REQUIRED_BRIDGES_LIVE_V1) {
    const cue = bridgeCues[id];
    const bridge = [...working.values()].find(value =>
      value.probe.comparison.targetArm === hierarchicalMultilevelBridgeTargetArmLiveV1(id));
    const bridgeObservation = bridge?.probe.targetObservation ?? null;
    const forwardCandidate = forward?.best?.candidate ?? forward?.candidates[0] ?? null;
    const forwardAtBridge = forwardCandidate && bridgeObservation
      ? await compute.call<ConditionApplicabilityV1>('compareConditions',
        forwardCandidate, bridgeObservation) : null;
    const missing = forwardAtBridge ? [...new Set([...forwardAtBridge.contradictedFactorIds,
      ...forwardAtBridge.unknownFactorIds])].sort() : [];
    const transitions = bridgeObservation && missing.length > 0
      ? await compute.call<readonly OpaqueFactorTransitionTraceV1[]>('recallFactorTransition',
        missing, bridgeObservation) : [];
    const matchingTransitions = transitions.filter(value =>
      cueIdentity(value.actionCue) === cueIdentity(cue)
      && value.activatedFactorIds.some(factorId => missing.includes(factorId)));
    const evaluated = [] as { transition: OpaqueFactorTransitionTraceV1;
      condition: ConditionApplicabilityV1; prediction: BranchPredictionV1 }[];
    let conditionEligibleTransitionCount = 0;
    if (bridgeObservation) for (const transition of matchingTransitions) {
      const candidate = factorTransitionCandidateForControlV2(transition, missing);
      const condition = await compute.call<ConditionApplicabilityV1>('compareConditions',
        candidate, bridgeObservation);
      const evidence = candidate.evidence;
      const conditionEligible = condition.productionEligible && condition.applicability > 0
        && condition.unknownFactorIds.length === 0 && condition.contradictedFactorIds.length === 0
        && evidence.r1.active && evidence.r2.active && evidence.r2a.productionEligible;
      if (!conditionEligible) continue;
      conditionEligibleTransitionCount++;
      const bridgeGoal = effectGoalForProbeLiveV1(bridge!.probe);
      const bridgeEvaluator = new GroundedGoalEvaluatorV1();
      bridgeEvaluator.setGoal(bridgeGoal, bridgeObservation);
      const rawPrediction = await compute.call<BranchPredictionV1>('predictCandidate', candidate,
        bridgeObservation, bridgeGoal, bridgeEvaluator.evaluate(bridgeObservation));
      const parentRelationIds = [...new Set(forwardCandidate?.evidence.r2a.relationIds ?? [])].sort();
      const projected = parentRelationIds.length === 0 ? []
        : await compute.call<readonly import('../control/contracts.js').ProjectedParentRelationApplicabilityV1[]>(
          'compareProjectedParentRelations', parentRelationIds, bridgeObservation,
          rawPrediction.nextStates, { r1Active: evidence.r1.active, r2Active: evidence.r2.active });
      assert(projected.length === rawPrediction.nextStates.length,
        'hierarchical-multilevel-D-projected-parent-result-count-mismatch');
      const progressSampleCount = projected.filter(value => value.productionEligible
        && value.applicability > 0 && value.unknownFactorIds.length === 0
        && value.contradictedFactorIds.length === 0).length;
      const prediction: BranchPredictionV1 = { ...rawPrediction, progressSampleCount,
        progressFraction: rawPrediction.nextStates.length
          ? progressSampleCount / rawPrediction.nextStates.length : 0,
        progressBasis: 'parent-R2A-relation-complete' };
      evaluated.push({ transition, condition, prediction });
      if (qualificationProgressPassedLiveV1(prediction)) break;
    }
    const eligible = evaluated.filter(row => {
      const evidence = row.prediction.currentEvidence ?? row.transition.evidence;
      return row.condition.productionEligible && row.condition.applicability > 0
        && row.condition.unknownFactorIds.length === 0 && row.condition.contradictedFactorIds.length === 0
        && evidence.r1.active && evidence.r2.active && evidence.r2a.productionEligible;
    }).sort((left, right) => right.prediction.progressFraction - left.prediction.progressFraction
      || right.prediction.validSampleCount - left.prediction.validSampleCount
      || left.transition.transitionId.localeCompare(right.transition.transitionId, 'en'));
    const winner = eligible[0] ?? null;
    bridges.push({ id, missingFactorIds: Object.freeze([...missing]),
      transitionRecalled: matchingTransitions.length > 0,
      transitionProductionEligible: winner !== null,
      winningTransitionId: winner?.transition.transitionId ?? null,
      factorProgressSampleCount: winner?.prediction.progressSampleCount ?? 0,
      progressBasis: 'predicted-parent-R2A-relation-complete',
      baseObservationSequence: bridgeObservation?.sequence ?? null,
      validSampleCount: winner?.prediction.validSampleCount ?? 0,
      progressFraction: winner?.prediction.progressFraction ?? 0,
      matchingTransitionCount: matchingTransitions.length,
      conditionEligibleTransitionCount,
      attemptedPredictionCount: evaluated.length });
  }
  const after = await compute.call<string>('hash');
  return { version: 'MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1',
    representation: hierarchicalMultilevelRepresentationEvidenceLiveV1(frozen, representationContract),
    arms: Object.freeze(arms), contrasts: Object.freeze(contrasts), bridges: Object.freeze(bridges),
    queryChangedSnapshot: before !== after };
}

/** Representation cardinality is an explicit experiment contract.  The
 * continuous supplement admits genuine two- and three-atom roads; it does
 * not relax completion or deposition semantics. */
export function hierarchicalMultilevelRepresentationEvidenceLiveV1(
  frozen: HierarchicalMemorySnapshotV1,
  representationContract: HierarchicalMultilevelRepresentationContractLiveV1 =
    HIERARCHICAL_MULTILEVEL_BASELINE_REPRESENTATION_CONTRACT_LIVE_V1,
): HierarchicalMultilevelRepresentationEvidenceLiveV1 {
  const r2AtomIds = new Set(frozen.r2Store.events.flatMap(value => value.atomIds));
  return Object.freeze({ r1Atoms: frozen.annotations.length,
    r2Events: frozen.r2Store.events.length,
    productionR2Events: frozen.r2Store.events.filter(value => value.learningEligible
      && value.physicalStatus === 'deposited').length,
    r1OnlyControlAtoms: frozen.annotations.filter(value => !r2AtomIds.has(value.atomId)
      && value.completion === 'complete'
      && (value.cue.kind === 'observe' || value.cue.kind === 'wait')).length,
    representationRejections: 0,
    invalidR2Events: frozen.r2Store.events.filter(value =>
      !representationContract.allowedR2AtomCounts.includes(value.atomIds.length)
      || value.completion !== 'complete'
      || value.physicalStatus === 'audit-only-censored').length });
}

export interface SealedFixtureCommandBoundaryLiveV1 {
  readonly count: number;
  seal(): number;
}

/** Shared heldout boundary: the fixture must already be ready and sealed.
 * The controller receives only the final grounded goal. */
export async function runHierarchicalMultilevelHeldoutBoundaryLiveV1(
  runtime: Pick<V5Runtime, 'runGoal'>, goal: GroundedGoalV1,
  commands: SealedFixtureCommandBoundaryLiveV1,
) {
  const fixtureCommandCountAtGoal = commands.seal();
  const rootGoalOnly = true;
  const result = await runtime.runGoal(goal);
  assert(rootGoalOnly && commands.count === fixtureCommandCountAtGoal,
    'hierarchical-multilevel-fixture-mutated-after-goal');
  return result;
}

export interface MinecraftHierarchicalMultilevelLiveResultV1 {
  readonly version: typeof MINECRAFT_HIERARCHICAL_MULTILEVEL_GOAL_CHAIN_LIVE_V1;
  readonly passed: boolean;
  readonly planSha256: string;
  readonly qualification: MinecraftHierarchicalMultilevelQualificationResultLiveV1;
  readonly frozenSnapshotSha256: string;
  readonly heldout: readonly HierarchicalMultilevelHeldoutResultLiveV1[];
}

type AbsoluteBlockPositionLiveV1 = readonly [number, number, number];

function liveFixturePosition(specification: MultilevelGoalChainCaseV1,
  role: MultilevelGoalChainCaseV1['fixture']['components'][number]['role']): AbsoluteBlockPositionLiveV1 {
  const component = specification.fixture.components.find(value => value.role === role);
  assert(component, `hierarchical-multilevel-fixture-component-missing:${specification.id}:${role}`);
  return [specification.fixture.origin[0] + component.relativePosition[0],
    specification.fixture.origin[1] + component.relativePosition[1],
    specification.fixture.origin[2] + component.relativePosition[2]];
}

const liveBlockId = (position: AbsoluteBlockPositionLiveV1): string => `block:${position.join(',')}`;

async function aimAtPublicBlockLiveV1(body: MinecraftBody, position: AbsoluteBlockPositionLiveV1,
  expectedType: string, yawOffsetDegrees = 0): Promise<void> {
  let block = body.bot.blockAt(new Vec3(...position));
  for (let tick = 0; (block?.name !== expectedType
    || publicBlockSelectionShapesV1(block).length === 0) && tick < 40; tick++) {
    await body.waitTicks(1); block = body.bot.blockAt(new Vec3(...position));
  }
  assert(block?.name === expectedType, `hierarchical-multilevel-public-block-missing:${expectedType}`);
  const point = publicSelectionAimPointLiveV1(position, block);
  const eye = body.bot.entity.position.offset(0, 1.62, 0), delta = new Vec3(...point).minus(eye);
  const yaw = Math.atan2(-delta.x, -delta.z) + yawOffsetDegrees * Math.PI / 180;
  const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  await body.bot.look(yaw, pitch, true); await body.waitTicks(2);
}

function publicDoorOpenLiveV1(observation: Observation, doorId: string): boolean {
  return observation.objects.some(value => value.id === doorId && value.type === 'iron_door'
    && value.properties.open === true);
}

async function waitUniqueFixtureLiveV1(body: MinecraftBody, buttonId: string, doorId: string) {
  const gate = new UniqueButtonDoorReadinessGateV1(buttonId, doorId);
  let value = gate.accept(body.latest());
  for (let tick = 0; !value.ready && tick < 200; tick++) {
    await body.waitTicks(1); value = gate.accept(body.latest());
  }
  assert(value.ready && value.commandBlocksObserved === 0,
    `hierarchical-multilevel-heldout-readiness-failed:${value.reason}`);
  return value;
}

class HierarchicalMultilevelHeldoutBodyLiveV1 extends MinecraftBody {
  #armed = false;
  #nonObserveActions = 0;
  #applied = false;
  constructor(configuration: ConstructorParameters<typeof MinecraftBody>[0],
    record: ConstructorParameters<typeof MinecraftBody>[1],
    readonly perturbationDegrees: number | null) { super(configuration, record); }
  armPerturbation(): void { this.#armed = true; }
  override async execute(action: Action, scope?: ActionObservationScopeV1):
  Promise<{ result: BodyResult; event: RealEvent | null }> {
    const result = await super.execute(action, scope);
    if (this.#armed && result.result.executed && action.kind !== 'observe' && action.kind !== 'wait')
      this.#nonObserveActions++;
    if (this.#armed && !this.#applied && this.perturbationDegrees !== null
      && result.result.executed && action.kind !== 'observe' && action.kind !== 'wait'
      && this.#nonObserveActions === 1) {
      this.#applied = true;
      const beforeSequence = this.latest().sequence;
      await this.bot.look(this.bot.entity.yaw + this.perturbationDegrees * Math.PI / 180,
        this.bot.entity.pitch, true);
      await this.waitTicks(25);
      this.record('hierarchical-multilevel-precommitted-public-yaw-deviation', {
        beforeSequence, afterSequence: this.latest().sequence,
        yawDegrees: this.perturbationDegrees, sourceEventId: result.event?.id ?? null,
      });
    }
    return result;
  }
}

async function prepareHeldoutFixtureLiveV1(commands: HierarchicalMultilevelFixtureCommandsLiveV1,
  body: MinecraftBody, specification: MultilevelGoalChainCaseV1): Promise<{ goal: GroundedGoalV1;
  buttonId: string; doorId: string; readiness: ReturnType<UniqueButtonDoorReadinessGateV1['accept']> }> {
  const live = materializeLiveGoalChainCaseV1(specification);
  if (commands.ensureLoaded(live.fixture.origin[0], live.fixture.origin[2])) await body.waitTicks(20);
  const rebuild = () => {
    for (const command of goalChainLatchFixtureCommandsLiveV1(live)) commands.command(command);
    const initial = goalChainCaseInitialPositionLiveV1(live);
    commands.command(`tp ${body.bot.username} ${initial.join(' ')} 0 0`);
  };
  rebuild(); await body.waitTicks(8);
  const buttonPosition = liveFixturePosition(live, 'button');
  const doorPosition = liveFixturePosition(live, 'door');
  const buttonId = liveBlockId(buttonPosition), doorId = liveBlockId(doorPosition);
  await aimAtPublicBlockLiveV1(body, buttonPosition, 'stone_button');
  const pulse = await body.execute({ kind: 'interact', parameters: {}, targetId: buttonId },
    { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [doorId] });
  assert(pulse.result.executed, 'hierarchical-multilevel-latch-preflight-pulse-failed');
  for (let tick = 0; !publicDoorOpenLiveV1(body.latest(), doorId) && tick < 40; tick++)
    await body.waitTicks(1);
  assert(publicDoorOpenLiveV1(body.latest(), doorId),
    'hierarchical-multilevel-latch-preflight-did-not-open');
  await body.waitTicks(200);
  assert(publicDoorOpenLiveV1(body.latest(), doorId),
    'hierarchical-multilevel-latch-preflight-did-not-hold-200-ticks');
  rebuild(); await body.waitTicks(8);
  await aimAtPublicBlockLiveV1(body, buttonPosition, 'stone_button', live.initialView.yawOffsetDegrees);
  const readiness = await waitUniqueFixtureLiveV1(body, buttonId, doorId);
  return { goal: ironDoorOpenGoalV1(live.id, doorId), buttonId, doorId, readiness };
}

function realHeldoutDoorEventLiveV1(after: HierarchicalMemorySnapshotV1,
  frozen: HierarchicalMemorySnapshotV1): boolean {
  const old = new Set(frozen.annotations.map(value => value.eventId));
  return after.annotations.filter(value => !old.has(value.eventId)).some(annotation =>
    annotation.cue.kind === 'interact' && annotation.cue.targetRole === 'stone_button'
    && annotation.kernelChanges.flat().some(change => change.subject.startsWith('iron_door#')
      && change.property === 'open' && change.before === false && change.after === true));
}

function maximumDependencyDepthLiveV1(records: readonly { kind: string; value: unknown }[]): number {
  let maximum = 0;
  for (const record of records) if (record.kind === 'joint-control-decision') {
    const snapshot = record.value as PhysicalControlSnapshotV2;
    for (const wrapper of snapshot.workspace.nodes)
      // Report the number of non-root reasoning nodes in the chain.  The
      // generic dependency helper reports edges and top-level recalled
      // experience is intentionally not connected to the root by an edge.
      maximum = Math.max(maximum, wrapper.node.kind === 'root' ? 0
        : dependencyDepthV2(wrapper.node.nodeId, snapshot.workspace.dependencies) + 1);
  }
  return maximum;
}

export interface HierarchicalMultilevelAttentionAuditLiveV1 {
  readonly required: boolean;
  readonly realDeviationSequence: number | null;
  readonly notificationSequence: number | null;
  readonly wakeKind: string | null;
  readonly wakeEvidenceYaw: boolean;
  readonly controllerIngested: boolean;
  readonly oldConditionInvalidatedSequence: number | null;
  readonly oldPredictionInvalidatedSequence: number | null;
  readonly recompetitionSequence: number | null;
  readonly staleEvidenceUsedAfterDeviation: boolean;
  readonly passed: boolean;
}

export function hierarchicalMultilevelAttentionAuditLiveV1(
  records: readonly { kind: string; value: unknown }[], required: boolean,
): HierarchicalMultilevelAttentionAuditLiveV1 {
  const rawDeviation: unknown = records.find(record =>
    record.kind === 'hierarchical-multilevel-precommitted-public-yaw-deviation')?.value;
  const deviation = rawDeviation as { beforeSequence?: number; afterSequence?: number } | undefined;
  const realDeviationSequence = deviation?.beforeSequence === undefined
    ? null : deviation.beforeSequence + 1;
  const wakeIndex = realDeviationSequence === null ? -1 : records.findIndex(record => {
    if (record.kind !== 'attention-wake') return false;
    const notice = record.value as { sequence?: number; subjectId?: string;
      evidence?: readonly { subject?: string; property?: string; before?: unknown; after?: unknown }[] };
    const sequence = Number(notice.sequence);
    return sequence >= realDeviationSequence
      && (deviation?.afterSequence === undefined || sequence <= deviation.afterSequence)
      && notice.subjectId === 'self' && (notice.evidence ?? []).some(change =>
        change.subject === 'self' && change.property === 'yaw' && change.before !== change.after);
  });
  const wake = wakeIndex < 0 ? null : records[wakeIndex]!;
  const wakeNotice = wake?.value as { sequence?: number; kind?: string } | undefined;
  const notificationSequence = wakeNotice?.sequence ?? null;
  const wakeEvidenceYaw = wake !== null;
  const controllerAttentionIndex = wake === null ? -1 : records.findIndex((record, index) =>
    index > wakeIndex && record.kind === 'joint-control-attention'
      && (record.value as { retainedDependencyGraph?: boolean }).retainedDependencyGraph === true
      && canonical((record.value as { notice?: unknown }).notice) === canonical(wake.value));
  const controllerIngested = controllerAttentionIndex >= 0;
  const preWakeSnapshot = wakeIndex < 0 ? null : records.slice(0, wakeIndex).reverse()
    .find(record => record.kind === 'joint-control-decision')?.value as PhysicalControlSnapshotV2 | undefined;
  const oldConditionRequestIds = new Set(preWakeSnapshot?.workspace.nodes
    .flatMap(node => node.condition?.fresh ? [node.condition.requestId] : []) ?? []);
  const oldPredictionRequestIds = new Set(preWakeSnapshot?.workspace.nodes
    .flatMap(node => node.prediction?.fresh ? [node.prediction.requestId] : []) ?? []);
  let oldConditionInvalidatedSequence: number | null = null;
  let oldPredictionInvalidatedSequence: number | null = null;
  let recompetitionSequence: number | null = null;
  let staleEvidenceUsedAfterDeviation = false;
  if (notificationSequence !== null) for (const [index, record] of records.entries()) {
    if (record.kind !== 'joint-control-decision') continue;
    const snapshot = record.value as PhysicalControlSnapshotV2;
    const sequence = snapshot.workspace.observationSequence;
    if (sequence === null || sequence < notificationSequence || index <= controllerAttentionIndex) continue;
    if (oldConditionInvalidatedSequence === null && snapshot.workspace.nodes.some(node =>
      node.condition?.invalidatedBy === 'attention'
        && oldConditionRequestIds.has(node.condition.requestId))) oldConditionInvalidatedSequence = sequence;
    if (oldPredictionInvalidatedSequence === null && snapshot.workspace.nodes.some(node =>
      node.prediction?.invalidatedBy === 'attention'
        && oldPredictionRequestIds.has(node.prediction.requestId))) oldPredictionInvalidatedSequence = sequence;
    if (snapshot.lastDecision?.converged && snapshot.lastDecision.operation === 'execute'
      && snapshot.lastDecision.nodeId !== null) {
      const selected = snapshot.workspace.nodes.find(node =>
        node.node.nodeId === snapshot.lastDecision!.nodeId);
      staleEvidenceUsedAfterDeviation ||= !!selected && [selected.condition, selected.prediction]
        .filter(value => value !== null)
        .some(value => value!.invalidatedBy !== null
          || value!.observationSequence < notificationSequence);
    }
    if (recompetitionSequence === null && oldConditionInvalidatedSequence !== null
      && oldPredictionInvalidatedSequence !== null && snapshot.lastDecision?.converged)
      recompetitionSequence = sequence;
  }
  const passed = !required || realDeviationSequence !== null && notificationSequence !== null
    && wakeEvidenceYaw && controllerIngested
    && oldConditionRequestIds.size > 0 && oldPredictionRequestIds.size > 0
    && oldConditionInvalidatedSequence !== null && oldPredictionInvalidatedSequence !== null
    && recompetitionSequence !== null && !staleEvidenceUsedAfterDeviation;
  return { required, realDeviationSequence, notificationSequence, wakeKind: wakeNotice?.kind ?? null,
    wakeEvidenceYaw, controllerIngested,
    oldConditionInvalidatedSequence, oldPredictionInvalidatedSequence, recompetitionSequence,
    staleEvidenceUsedAfterDeviation, passed };
}

function hierarchicalMultilevelStaleRefusalsLiveV1(
  records: readonly { kind: string; value: unknown }[]): number {
  return records.filter(record => record.kind === 'control-action-reality-refusal'
    && (record.value as { reason?: string }).reason === 'offer-stale'
    || record.kind === 'control-action-result'
      && (record.value as { result?: { refusal?: string } }).result?.refusal === 'offer-stale').length;
}

function hierarchicalMultilevelInvalidInteractionsLiveV1(
  records: readonly { kind: string; value: unknown }[]): number {
  return records.filter(record => record.kind === 'control-action-result'
    && (record.value as { offer?: { action?: Action }; result?: { executed?: boolean } })
      .offer?.action?.kind === 'interact'
    && (record.value as { result?: { executed?: boolean } }).result?.executed !== true).length;
}

function hierarchicalMultilevelRootRetainedLiveV1(
  records: readonly { kind: string; value: unknown }[], goalId: string): boolean {
  const decisions = records.filter(record => record.kind === 'joint-control-decision')
    .map(record => record.value as PhysicalControlSnapshotV2);
  return decisions.length > 0 && decisions.every(snapshot => {
    const root = snapshot.workspace.rootNodeId;
    return snapshot.workspace.goalId === goalId && root !== null
      && snapshot.workspace.nodes.some(node => node.node.nodeId === root && node.node.kind === 'root');
  });
}

export interface HierarchicalMultilevelHeldoutResultLiveV1 {
  readonly caseId: string;
  readonly tier: 'A' | 'B' | 'C';
  readonly status: string;
  readonly actions: number;
  readonly verified: boolean;
  readonly dependencyDepth: number;
  readonly expectedMinimumDependencyDepth: 2 | 3 | 4;
  readonly baselineHashUnchanged: boolean;
  readonly frozenPhysicalEvidencePassed: boolean;
  readonly realButtonDoorEventPassed: boolean;
  readonly rootRetained: boolean;
  readonly staleRefusals: number;
  readonly invalidInteractions: number;
  readonly attention: HierarchicalMultilevelAttentionAuditLiveV1;
  readonly cStructure: HierarchicalMultilevelCStructureAuditLiveV1;
}

export interface HierarchicalMultilevelCStructureAuditLiveV1 {
  readonly required: boolean;
  readonly openSide: 'left' | 'right' | null;
  readonly firstLateralDirection: 'left' | 'right' | null;
  readonly firstLateralDeltaX: number | null;
  readonly selectedFactorTransitionNodeId: string | null;
  readonly opaqueDependencyObserved: boolean;
  readonly factorIntersectionObserved: boolean;
  readonly forwardParentObserved: boolean;
  readonly openSideMatched: boolean;
  readonly passed: boolean;
}

export function hierarchicalMultilevelCStructureAuditLiveV1(
  records: readonly { kind: string; value: unknown }[], specification: MultilevelGoalChainCaseV1,
): HierarchicalMultilevelCStructureAuditLiveV1 {
  const geometry = goalChainObstacleGeometryLiveV1(specification);
  const required = specification.tier === 'C';
  const openSide = geometry.kind === 'mirrored-high-side-route' ? geometry.openSide : null;
  let latestDecision: PhysicalControlSnapshotV2 | null = null;
  for (const record of records) {
    if (record.kind === 'joint-control-decision') {
      latestDecision = record.value as PhysicalControlSnapshotV2; continue;
    }
    if (record.kind !== 'control-action-result') continue;
    const value = record.value as { offer?: { action?: Action; cue?: ActionCue };
      result?: { executed?: boolean; observation?: Observation } };
    const direction = value.offer?.action?.kind === 'move'
      && (value.offer.action.parameters.direction === 'left'
        || value.offer.action.parameters.direction === 'right')
      ? value.offer.action.parameters.direction : null;
    if (!direction || value.result?.executed !== true || !latestDecision) continue;
    const selectedNodeId = latestDecision.lastDecision?.operation === 'execute'
      ? latestDecision.lastDecision.nodeId : null;
    const selected = latestDecision.workspace.nodes.find(node => node.node.nodeId === selectedNodeId);
    const transitionMembers = selected?.node.kind === 'factor-transition'
      ? selected.node.transitionMembers ?? [selected.node.transition] : [];
    const matchingTransitions = transitionMembers.filter(transition => value.offer?.cue
      && cueIdentity(transition.actionCue) === cueIdentity(value.offer.cue));
    const edges = latestDecision.workspace.dependencies.filter(edge => edge.kind === 'opaque-factor'
      && edge.requiredNodeId === selectedNodeId && edge.factorIds.length > 0);
    const factorIntersectionObserved = edges.some(edge => matchingTransitions.some(transition =>
      [...transition.activatedFactorIds, ...transition.deactivatedFactorIds]
        .some(factorId => edge.factorIds.includes(factorId))));
    const forwardParentObserved = edges.some(edge => {
      const parent = latestDecision!.workspace.nodes.find(node => node.node.nodeId === edge.dependentNodeId);
      const members = parent?.node.kind === 'experienced'
        ? parent.node.candidateMembers ?? [parent.node.candidate] : [];
      return members.some(candidate => candidate.actionCue.kind === 'move'
        && candidate.actionCue.parameters.direction === 'forward');
    });
    const beforeX = latestDecision.workspace.observation?.self.position[0];
    const afterX = value.result.observation?.self.position[0];
    const deltaX = beforeX === undefined || afterX === undefined ? null : afterX - beforeX;
    const openSideMatched = openSide !== null && deltaX !== null && Math.abs(deltaX) >= .25
      && (openSide === 'right' ? deltaX > 0 : deltaX < 0);
    const opaqueDependencyObserved = edges.length > 0;
    const passed = !required || selected?.node.kind === 'factor-transition'
      && matchingTransitions.length > 0 && opaqueDependencyObserved && factorIntersectionObserved
      && forwardParentObserved && openSideMatched;
    return { required, openSide, firstLateralDirection: direction, firstLateralDeltaX: deltaX,
      selectedFactorTransitionNodeId: selected?.node.kind === 'factor-transition'
        ? selected.node.nodeId : null,
      opaqueDependencyObserved, factorIntersectionObserved, forwardParentObserved,
      openSideMatched, passed };
  }
  return { required, openSide, firstLateralDirection: null, firstLateralDeltaX: null,
    selectedFactorTransitionNodeId: null, opaqueDependencyObserved: false,
    factorIntersectionObserved: false, forwardParentObserved: false,
    openSideMatched: !required, passed: !required };
}

export function hierarchicalMultilevelHeldoutCasePassedLiveV1(
  value: HierarchicalMultilevelHeldoutResultLiveV1,
): boolean {
  return value.status === 'goal-verified' && value.verified && value.baselineHashUnchanged
    && value.frozenPhysicalEvidencePassed && value.realButtonDoorEventPassed
    && value.rootRetained && value.staleRefusals === 0 && value.invalidInteractions === 0
    && value.attention.passed && value.cStructure.passed
    && value.dependencyDepth >= value.expectedMinimumDependencyDepth;
}

async function closeStreamsLiveV1(streams: readonly ReturnType<typeof createWriteStream>[]) {
  await Promise.all(streams.map(stream => new Promise<void>((done, reject) => {
    stream.once('error', reject); stream.end(done);
  })));
}

function qualificationLayoutLiveV1(index: number): MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  return trainingLayout(8, 'intervention', index + HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.length);
}

async function prepareReadOnlyProbeLiveV1(commands: HierarchicalMultilevelFixtureCommandsLiveV1,
  body: MinecraftBody, comparison: HierarchicalMultilevelComparisonLiveV1,
  selection: HierarchicalMultilevelOpaqueSelectionLiveV1,
  index: number): Promise<HierarchicalMultilevelReadOnlyProbeLiveV1> {
  const layout = qualificationLayoutLiveV1(index);
  if (commands.ensureLoaded(layout.originX, layout.originZ)) await body.waitTicks(20);
  const specification = (arm: HierarchicalMultilevelArmLiveV1, suffix: string):
  HierarchicalMultilevelTrainingEpisodeLiveV1 => ({
    version: 'HierarchicalMultilevelTrainingEpisodeLiveV1',
    episodeId: `qualification-${index}-${suffix}`, phase: 'intervention', arm,
    comparison: comparison.id, pairIndex: null, layout, chain: chain(arm),
    representationProfile: hierarchicalMultilevelRepresentationProfileLiveV1(
      arm, 'intervention', layout),
    fullSolutionDisclosed: false,
  });
  const targetSpecification = specification(comparison.targetArm, 'target');
  const targetEpisode = materializeTrainingEpisodeLiveV1(targetSpecification);
  const target = await prepareMinecraftMultilevelGuidedFixtureLiveV1(commands, body, targetEpisode);
  const targetObservation = structuredClone(body.latest());
  const contrastSpecification = specification(comparison.contrastArm, 'contrast');
  const contrastEpisode = materializeTrainingEpisodeLiveV1(contrastSpecification);
  const contrast = await prepareMinecraftMultilevelGuidedFixtureLiveV1(commands, body, contrastEpisode);
  const contrastObservation = structuredClone(body.latest());
  return { comparison, selection, target, targetObservation, contrast, contrastObservation };
}

/** One production run: train from an empty hierarchical-memory worker, freeze once, run Gate D
 * read-only, then restore that exact file independently for the single A/B/C
 * heldout batch. */
export async function runMinecraftHierarchicalMultilevelGoalChainLiveV1(
  config: Configuration, evidenceDirectory: string,
  options: { readonly resumeFrozenFrom?: string } = {},
): Promise<MinecraftHierarchicalMultilevelLiveResultV1> {
  await mkdir(evidenceDirectory);
  const events = createWriteStream(resolve(evidenceDirectory, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidenceDirectory, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frames : events).write(canonical({ kind, value }) + '\n');
  };
  const plan = minecraftHierarchicalMultilevelPlanLiveV1();
  await saveJson(resolve(evidenceDirectory, 'RUN_PROTOCOL.json'), plan);
  const services = new Services(config, resolve(config.runtimeRoot,
    `hierarchical-multilevel-goal-chain-${Date.now()}`), evidenceDirectory);
  let trainingBody: MinecraftBody | null = null, trainingCompute: Compute | null = null;
  try {
    await services.start('empty');
    applyMinecraftFixtureCommandBatchLiveV1(services, minecraftMultilevelGuidedGlobalCommandsLiveV1());
    trainingBody = new MinecraftBody({ ...config.minecraft,
      worldId: 'hierarchical-multilevel-training-v1', sessionId: 'hierarchical-multilevel-training-v1' }, record);
    await trainingBody.ready(); await trainingBody.waitTicks(20); trainingCompute = new Compute();
    const trainingCommands = new HierarchicalMultilevelFixtureCommandsLiveV1(services);
    const selections = new Map<HierarchicalMultilevelComparisonLiveV1['id'],
    HierarchicalMultilevelOpaqueSelectionLiveV1>();
    let frozen: HierarchicalMemorySnapshotV1;
    let interventionTimeline: HierarchicalMultilevelTrainingChainExecutionLiveV1[] = [];
    let resumeSourceFrozenPath: string | null = null, resumeSourceFrozenByteSha256: string | null = null;
    if (options.resumeFrozenFrom) {
      assert(isAbsolute(options.resumeFrozenFrom), 'hierarchical-multilevel-resume-source-must-be-absolute');
      const source = resolve(options.resumeFrozenFrom);
      assert(source !== resolve(evidenceDirectory), 'hierarchical-multilevel-resume-source-is-output');
      const parse = async <T>(file: string): Promise<T> => JSON.parse(await readFile(resolve(source, file), 'utf8')) as T;
      const sourcePlan = await parse<ReturnType<typeof minecraftHierarchicalMultilevelPlanLiveV1>>('RUN_PROTOCOL.json');
      assert(canonical(sourcePlan) === canonical(plan), 'hierarchical-multilevel-resume-plan-mismatch');
      resumeSourceFrozenPath = resolve(source, 'FROZEN_HIERARCHICAL_EXPERIENCE.json');
      resumeSourceFrozenByteSha256 = await fileSha(resumeSourceFrozenPath);
      const sourceSnapshot = await parse<HierarchicalMemorySnapshotV1 | LegacyHierarchicalMemoryV9LiveV1>(
        'FROZEN_HIERARCHICAL_EXPERIENCE.json');
      if (sourceSnapshot.version === 'KairosV5HierarchicalMemoryV9') {
        // V9 has no event-local public-object role provenance.  Rebuild it only
        // from the complete trusted frames/body receipts; never invent an ID
        // binding or migrate the old annotations in place.
        const legacy = await readLegacyHierarchicalMemoryV9LiveV1(source);
        assert(canonical(legacy) === canonical(sourceSnapshot),
          'hierarchical-multilevel-resume-legacy-read-mismatch');
        const rebuilt = await rebuildHierarchicalRoleBindingsFromTrustedEvidenceLiveV1(
          trainingCompute, source, legacy);
        frozen = rebuilt.snapshot;
        await saveJson(resolve(evidenceDirectory, 'ROLE_BINDING_REBUILD_AUDIT.json'), rebuilt.audit);
        await saveJson(resolve(evidenceDirectory,
          'REBUILT_ROLE_BOUND_HIERARCHICAL_EXPERIENCE.json'), frozen);
      } else {
        frozen = sourceSnapshot;
        await trainingCompute.call('restore', frozen);
      }
      assert(frozen.annotations.length === 368 && frozen.writes === 368
        && frozen.r2Store.events.length === 168
        && frozen.r2Store.events.filter(value => value.learningEligible).length === 168
        && frozen.r2Store.events.every(value => value.physicalStatus === 'deposited'),
      'hierarchical-multilevel-resume-frozen-cardinality-invalid');
      assert(await trainingCompute.call<string>('hash') === sha(frozen),
        'hierarchical-multilevel-resume-worker-hash-mismatch');
      for (const comparison of HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1) {
        const protocolId = `hierarchical-multilevel-${comparison.id}-v1`;
        const protocol = frozen.r2a?.interventionProtocols.find(value => value.protocolId === protocolId);
        assert(protocol && protocol.version === 'R2AInterventionProtocolV3',
          `hierarchical-multilevel-resume-protocol-missing:${comparison.id}`);
        const selection = restoreHierarchicalMultilevelOpaqueRelationLiveV1(frozen, comparison, protocol);
        assert(selection.relationId === protocol.relationId
          && canonical(selection.changedFactorIds) === canonical(protocol.changedFactorIds),
        `hierarchical-multilevel-resume-selection-mismatch:${comparison.id}`);
        selections.set(comparison.id, selection);
        const relation = frozen.r2a?.relations.find(value => value.relationId === selection.relationId);
        const intervention = relation?.factorSetInterventions.find(value =>
          canonical(value.factorIds) === canonical(selection.changedFactorIds));
        assert(relation?.grade === 'intervention-supported' && intervention?.pairIds.length === 4,
          `hierarchical-multilevel-resume-relation-not-intervention-supported:${comparison.id}`);
      }
      await saveJson(resolve(evidenceDirectory, 'RESUME_SOURCE.json'), {
        version: 'HierarchicalMultilevelFrozenResumeSourceV1', source,
        sourceSnapshotVersion: sourceSnapshot.version,
        sourceSnapshotSha256: sha(sourceSnapshot), rebuiltSnapshotSha256: sha(frozen),
        frozenFileSha256: resumeSourceFrozenByteSha256,
        sourceInterventionTimelineSha256: await fileSha(resolve(source, 'INTERVENTION_TIMELINE.json')),
        planSha256: minecraftHierarchicalMultilevelPlanIdentityLiveV1(), trainingActionsInCurrentRun: 0,
      });
    } else {
    const foundationTimeline: HierarchicalMultilevelTrainingChainExecutionLiveV1[] = [];
    let calibrationCoverage: HierarchicalMultilevelCalibrationCoverageAuditLiveV1 | null = null;
    for (const specification of plan.foundation) {
      foundationTimeline.push(await executeHierarchicalMultilevelTrainingChainLiveV1(trainingCompute,
        trainingCommands, trainingBody, specification, false));
      if (foundationTimeline.length === 64) {
        const atFreeze = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
        calibrationCoverage = auditHierarchicalMultilevelCalibrationCoverageLiveV1(
          atFreeze, foundationTimeline);
        await saveJson(resolve(evidenceDirectory, 'CALIBRATION_128_COVERAGE.json'),
          calibrationCoverage);
      }
    }
    assert(calibrationCoverage?.passed,
      'hierarchical-multilevel-calibration-coverage-not-audited');
    const foundation = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(foundation.annotations.length === 256 && foundation.writes === 256,
      'hierarchical-multilevel-foundation-R1-cardinality-invalid');
    const productionFoundationTimeline = foundationTimeline.filter(value =>
      value.expectation.productionRequired);
    const foundationR2 = exactHierarchicalMultilevelR2ChainsLiveV1(foundation,
      productionFoundationTimeline.map(value => value.expectation));
    assert(foundationR2.length === 112 && foundation.r2Store.events.length === 112
      && foundation.r2Store.events.filter(value => value.learningEligible).length === 112
      && foundation.annotations.filter(value => !new Set(foundation.r2Store.events
        .flatMap(event => event.atomIds)).has(value.atomId)
        && (value.cue.kind === 'observe' || value.cue.kind === 'wait')).length === 32,
    'hierarchical-multilevel-foundation-R2-cardinality-invalid');
    const eventIdsByArm = new Map<HierarchicalMultilevelArmLiveV1, string[]>(
      plan.arms.map(arm => [arm, []]));
    productionFoundationTimeline.forEach((value, index) =>
      eventIdsByArm.get(value.specification.arm)!.push(foundationR2[index]!.eventId));
    const protocols = new Map<HierarchicalMultilevelComparisonLiveV1['id'], R2AInterventionProtocolV1>();
    for (const comparison of HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1) {
      const selection = selectHierarchicalMultilevelOpaqueRelationLiveV1(foundation, comparison,
        eventIdsByArm.get(comparison.targetArm)!, eventIdsByArm.get(comparison.contrastArm)!);
      selections.set(comparison.id, selection);
      const protocol = await trainingCompute.call<R2AInterventionProtocolV1>(
        'registerMatchedInterventionProtocol', { protocolId: `hierarchical-multilevel-${comparison.id}-v1`,
          relationId: selection.relationId, changedFactorIds: selection.changedFactorIds,
          formationMatchedPairs: selection.formationMatchedPairs });
      protocols.set(comparison.id, protocol);
    }
    // Durable stage barrier: later intervention or heldout failures must not
    // force another 256-atom real foundation capture merely to recover facts
    // that were already committed successfully.
    await saveJson(resolve(evidenceDirectory, 'FOUNDATION_HIERARCHICAL_EXPERIENCE.json'),
      await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot'));
    await saveJson(resolve(evidenceDirectory, 'FOUNDATION_TIMELINE.json'), foundationTimeline);
    interventionTimeline = [];
    const pairs = new Map<string, { target?: string; contrast?: string }>();
    for (const specification of plan.interventions) {
      const execution = await executeHierarchicalMultilevelTrainingChainLiveV1(trainingCompute,
        trainingCommands, trainingBody, specification, true);
      assert(execution.r2EventId && specification.comparison !== null && specification.pairIndex !== null,
        'hierarchical-multilevel-intervention-chain-invalid');
      const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.find(value =>
        value.id === specification.comparison)!;
      const key = `${comparison.id}:${specification.pairIndex}`, pair = pairs.get(key) ?? {};
      if (specification.arm === comparison.targetArm) pair.target = execution.r2EventId;
      else pair.contrast = execution.r2EventId;
      pairs.set(key, pair); interventionTimeline.push(execution);
      if (pair.target && pair.contrast) {
        const selection = selections.get(comparison.id)!, protocol = protocols.get(comparison.id)!;
        const intervention: R2AInterventionEvidenceV1 = { version: 'R2AInterventionEvidenceV1',
          pairId: `hierarchical-multilevel-${key}`, protocolId: protocol.protocolId,
          relationId: selection.relationId, baselineEventId: pair.target,
          interventionEventId: pair.contrast, changedFactorIds: selection.changedFactorIds,
          trustedActualObservation: true };
        await trainingCompute.call('recordMatchedIntervention', intervention);
      }
    }
    assert(pairs.size === 28 && [...pairs.values()].every(value => value.target && value.contrast),
      'hierarchical-multilevel-intervention-pairs-incomplete');
    frozen = await trainingCompute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(frozen.annotations.length === 368 && frozen.writes === 368
      && frozen.r2Store.events.length === 168
      && frozen.r2Store.events.filter(value => value.learningEligible).length === 168
      && frozen.r2Store.events.every(value => value.physicalStatus === 'deposited'),
    'hierarchical-multilevel-frozen-cardinality-invalid');
    for (const selection of selections.values()) {
      const relation = frozen.r2a?.relations.find(value => value.relationId === selection.relationId);
      const intervention = relation?.factorSetInterventions.find(value =>
        canonical(value.factorIds) === canonical(selection.changedFactorIds));
      assert(relation?.grade === 'intervention-supported' && intervention?.pairIds.length === 4,
        `hierarchical-multilevel-relation-not-intervention-supported:${selection.comparison}`);
    }
    // Persist the immutable candidate before Gate D.  A failed read-only gate
    // remains auditable but does not receive a usable EXPERIENCE_LATEST pointer.
    await saveJson(resolve(evidenceDirectory, 'FROZEN_HIERARCHICAL_EXPERIENCE.json'), frozen);
    }
    const probes: HierarchicalMultilevelReadOnlyProbeLiveV1[] = [];
    for (let index = 0; index < HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1.length; index++) {
      const comparison = HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1[index]!;
      probes.push(await prepareReadOnlyProbeLiveV1(trainingCommands, trainingBody, comparison,
        selections.get(comparison.id)!, index));
    }
    // Freeze the public-only query inputs before any qualification calculation,
    // so a failed gate can be diagnosed offline without another Minecraft run.
    await saveJson(resolve(evidenceDirectory, 'GATE_D_PROBES.json'), probes);
    const qualificationEvidence = await collectHierarchicalMultilevelQualificationLiveV1(
      trainingCompute, frozen, probes);
    const qualification = minecraftHierarchicalMultilevelQualificationGateLiveV1(qualificationEvidence);
    await saveJson(resolve(evidenceDirectory, 'INTERVENTION_TIMELINE.json'), interventionTimeline);
    await saveJson(resolve(evidenceDirectory, 'GATE_D_EVIDENCE.json'), qualificationEvidence);
    await saveJson(resolve(evidenceDirectory, 'GATE_D_RESULT.json'), qualification);
    if (resumeSourceFrozenPath && resumeSourceFrozenByteSha256) assert(
      await fileSha(resumeSourceFrozenPath) === resumeSourceFrozenByteSha256,
      'hierarchical-multilevel-resume-source-mutated');
    assert(qualification.passed, `hierarchical-multilevel-gate-D-failed:${qualification.failures.join(',')}`);
    const baselineDirectory = resolve(evidenceDirectory, 'frozen-baseline'); await mkdir(baselineDirectory);
    assert(frozen.version === HIERARCHICAL_MEMORY_VERSION_V1
      && frozen.r2a?.version === 'R2AStablePatternGraphV11',
    'hierarchical-multilevel-baseline-version-not-current');
    const baselineHabit = new ControlHabitWeightsV1();
    const baselinePointer = await saveExperienceBundleV1(baselineDirectory, frozen,
      { actions: 0, eventCount: 368, writes: 368 }, baselineHabit);
    const pointerPath = resolve(baselineDirectory, 'EXPERIENCE_LATEST.json');
    assert(baselinePointer.sha256 === sha(frozen) && baselinePointer.habitFilename
      && baselinePointer.habitSha256 === sha(baselineHabit.exportCheckpoint()),
    'hierarchical-multilevel-baseline-bundle-identity-invalid');
    const baselineSnapshotPath = resolve(baselineDirectory, baselinePointer.filename);
    const baselineHabitPath = resolve(baselineDirectory, baselinePointer.habitFilename);
    const baselinePointerBefore = await fileSha(pointerPath);
    const baselineSnapshotBefore = await fileSha(baselineSnapshotPath);
    const baselineHabitBefore = await fileSha(baselineHabitPath);
    await trainingBody.close(); trainingBody = null; await trainingCompute.close(); trainingCompute = null;

    const heldout: HierarchicalMultilevelHeldoutResultLiveV1[] = [];
    for (const heldoutCase of plan.heldouts) {
      const caseEvidence = resolve(evidenceDirectory, heldoutCase.case.id); await mkdir(caseEvidence);
      const compute = new Compute(), restored = await restoreExperience(compute, pointerPath);
      assert(restored && sha(restored.snapshot) === sha(frozen)
        && canonical(restored.pointer) === canonical(baselinePointer)
        && restored.snapshotPath === baselineSnapshotPath && restored.habitPath === baselineHabitPath
        && sha(restored.habit.exportCheckpoint()) === baselinePointer.habitSha256,
        'hierarchical-multilevel-heldout-hierarchical-memory-restore-failed');
      const caseRecords: { kind: string; value: unknown }[] = [];
      const caseRecord = (kind: string, value: unknown): void => {
        const copy = structuredClone(value); caseRecords.push({ kind, value: copy });
        record(kind, { caseId: heldoutCase.case.id, value: copy });
      };
      const perturbation = minecraftMultilevelGoalChainPerturbationsV1.find(value =>
        value.caseId === heldoutCase.case.id)?.yawDegrees ?? null;
      const body = new HierarchicalMultilevelHeldoutBodyLiveV1({ ...config.minecraft,
        worldId: heldoutCase.case.id, sessionId: heldoutCase.case.id,
        activeSecondsOffset: frozen.activeSeconds }, caseRecord, perturbation);
      let runtime: V5Runtime | null = null;
      try {
        await body.ready(); await body.waitTicks(60);
        const commands = new HierarchicalMultilevelFixtureCommandsLiveV1(services);
        const prepared = await prepareHeldoutFixtureLiveV1(commands, body, heldoutCase.case);
        runtime = new V5Runtime(body, { ...config, actionBudget: heldoutCase.actionBudget },
          caseEvidence, caseRecord, { compute, restoredExperience: restored });
        const fixtureCommandCountAtGoal = commands.seal();
        caseRecord('hierarchical-multilevel-root-goal-injection', prepared.goal);
        body.armPerturbation();
        const result = await runtime.runGoal(prepared.goal);
        const first = body.latest(); await body.waitTicks(5); const second = body.latest();
        const verified = publicDoorOpenLiveV1(first, prepared.doorId)
          && publicDoorOpenLiveV1(second, prepared.doorId) && second.sequence - first.sequence >= 5;
        await runtime.save();
        assert(commands.count === fixtureCommandCountAtGoal,
          'hierarchical-multilevel-fixture-mutated-after-root-goal');
        const after = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
        const physicalAudit = auditFrozenPhysicalActionEvidenceLiveV1(caseRecords, frozen);
        const realButtonDoorEventPassed = realHeldoutDoorEventLiveV1(after, frozen);
        const attention = hierarchicalMultilevelAttentionAuditLiveV1(caseRecords,
          perturbation !== null);
        heldout.push({ caseId: heldoutCase.case.id, tier: heldoutCase.case.tier,
          status: result.status, actions: result.actions, verified,
          dependencyDepth: maximumDependencyDepthLiveV1(caseRecords),
          expectedMinimumDependencyDepth: heldoutCase.expectedMinimumDependencyDepth,
          baselineHashUnchanged: await fileSha(pointerPath) === baselinePointerBefore
            && await fileSha(baselineSnapshotPath) === baselineSnapshotBefore
            && await fileSha(baselineHabitPath) === baselineHabitBefore,
          frozenPhysicalEvidencePassed: physicalAudit.passed, realButtonDoorEventPassed,
          rootRetained: hierarchicalMultilevelRootRetainedLiveV1(caseRecords, prepared.goal.id),
          staleRefusals: hierarchicalMultilevelStaleRefusalsLiveV1(caseRecords),
          invalidInteractions: hierarchicalMultilevelInvalidInteractionsLiveV1(caseRecords),
          attention,
          cStructure: hierarchicalMultilevelCStructureAuditLiveV1(caseRecords, heldoutCase.case) });
        await saveJson(resolve(caseEvidence, 'FROZEN_PHYSICAL_ACTION_EVIDENCE_AUDIT.json'), physicalAudit);
      } finally {
        if (runtime) await runtime.close(); else { await body.close(); await compute.close(); }
      }
    }
    const passed = heldout.length === 12
      && heldout.filter(hierarchicalMultilevelHeldoutCasePassedLiveV1).length >= 10
      && (['A', 'B', 'C'] as const).every(tier => heldout.filter(value => value.tier === tier
        && hierarchicalMultilevelHeldoutCasePassedLiveV1(value)).length >= 3);
    const result: MinecraftHierarchicalMultilevelLiveResultV1 = {
      version: MINECRAFT_HIERARCHICAL_MULTILEVEL_GOAL_CHAIN_LIVE_V1, passed,
      planSha256: minecraftHierarchicalMultilevelPlanIdentityLiveV1(), qualification,
      frozenSnapshotSha256: sha(frozen), heldout: Object.freeze(heldout) };
    await saveJson(resolve(evidenceDirectory, 'RESULT.json'), result);
    assert(result.passed, 'hierarchical-multilevel-heldout-batch-failed');
    return result;
  } catch (error) {
    const failure = error as Error;
    await saveJson(resolve(evidenceDirectory, 'RUN_FAILURE.json'), { version: 'HierarchicalMultilevelFailureV1',
      message: failure.message, name: failure.name, stack: failure.stack ?? null,
      planSha256: minecraftHierarchicalMultilevelPlanIdentityLiveV1(), retryCount: 0 });
    throw error;
  } finally {
    await trainingBody?.close(); await trainingCompute?.close(); await services.stop();
    await closeStreamsLiveV1([events, frames]);
  }
}
