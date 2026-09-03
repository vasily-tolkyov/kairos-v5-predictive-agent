import type { Action, ActionCue, PrimitiveKind, PublicValue } from '../contracts.js';
import type { GroundedGoalV1 } from '../control/contracts.js';
import { sha } from '../util.js';

/** Closed evaluation vocabulary.  A run may report null for success, but no
 * other semantic failure label is permitted. */
export const MINECRAFT_MULTILEVEL_FAILURE_CLASSES_V1 = Object.freeze([
  'fixture-failed',
  'foundation-experience-insufficient',
  'representation-insufficient',
  'physical-recall-or-rollout-failed',
  'dependency-decomposition-failed',
  'control-selection-failed',
  'control-capacity-exhausted',
  'body-integration-failed',
  'attention-failed',
  'goal-verification-failed',
  'experimental-leakage',
] as const);

export type MinecraftMultilevelFailureClassV1 =
  typeof MINECRAFT_MULTILEVEL_FAILURE_CLASSES_V1[number];

export interface MinecraftMultilevelFailureSignalsV1 {
  readonly leakageFree: boolean;
  readonly fixtureReady: boolean;
  readonly foundationExperienceReady: boolean;
  readonly representationReady: boolean;
  readonly physicalRecallAndRolloutReady: boolean;
  readonly dependencyDecompositionReady: boolean;
  readonly controlSelectionReady: boolean;
  readonly controlCapacityAvailable: boolean;
  readonly bodyIntegrationReady: boolean;
  readonly attentionReady: boolean;
  readonly goalVerified: boolean;
}

export function classifyMinecraftMultilevelFailureV1(
  signals: MinecraftMultilevelFailureSignalsV1,
): MinecraftMultilevelFailureClassV1 | null {
  if (!signals.leakageFree) return 'experimental-leakage';
  if (!signals.fixtureReady) return 'fixture-failed';
  if (!signals.foundationExperienceReady) return 'foundation-experience-insufficient';
  if (!signals.representationReady) return 'representation-insufficient';
  if (!signals.physicalRecallAndRolloutReady) return 'physical-recall-or-rollout-failed';
  if (!signals.dependencyDecompositionReady) return 'dependency-decomposition-failed';
  if (!signals.controlSelectionReady) return 'control-selection-failed';
  if (!signals.controlCapacityAvailable) return 'control-capacity-exhausted';
  if (!signals.bodyIntegrationReady) return 'body-integration-failed';
  if (!signals.attentionReady) return 'attention-failed';
  if (!signals.goalVerified) return 'goal-verification-failed';
  return null;
}

export type MultilevelGuidedModeV1 =
  | 'look-plus-15-acquire'
  | 'look-plus-15-away'
  | 'look-minus-15-acquire'
  | 'look-minus-15-away'
  | 'forward-reduce-distance'
  | 'forward-blocked'
  | 'left-clear'
  | 'left-blocked'
  | 'right-clear'
  | 'right-blocked'
  | 'jump-forward-clear-one-block'
  | 'jump-forward-blocked-low-roof-high-obstacle'
  | 'interact-wired-button-opens-iron-door'
  | 'interact-visible-disconnected-button-no-door-change'
  | 'observe-state-remains'
  | 'wait-no-relevant-change';

export const MULTILEVEL_GUIDED_MODES_V1: readonly MultilevelGuidedModeV1[] = Object.freeze([
  'look-plus-15-acquire', 'look-plus-15-away', 'look-minus-15-acquire', 'look-minus-15-away',
  'forward-reduce-distance', 'forward-blocked',
  'left-clear', 'left-blocked', 'right-clear', 'right-blocked',
  'jump-forward-clear-one-block', 'jump-forward-blocked-low-roof-high-obstacle',
  'interact-wired-button-opens-iron-door',
  'interact-visible-disconnected-button-no-door-change',
  'observe-state-remains', 'wait-no-relevant-change',
]);

export const MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1 = Object.freeze({
  version: 'MultilevelGuidedTrainingPrecommitmentV1' as const,
  manifestId: 'minecraft-multilevel-guided-empty-memory-256-v1',
  orderingAlgorithm: 'xorshift32-fisher-yates-per-half-v1' as const,
  seed: 0x4b414952,
  totalEpisodes: 256 as const,
  halfBoundary: 128 as const,
  modes: 16 as const,
  repetitionsPerMode: 16 as const,
  repetitionsPerModePerHalf: 8 as const,
  initialExperience: 'empty' as const,
  initialHabit: 'empty' as const,
  episodeReset: 'fresh-single-action-micro-layout' as const,
  disclosure: 'one-real-primitive-action-only' as const,
});

export interface MultilevelGuidedTrainingLayoutV1 {
  readonly id: string;
  readonly split: 'first-half' | 'second-half';
  readonly replication: number;
  readonly side: 'north' | 'south' | 'east' | 'west';
  readonly neutralMarkerVariant: 0 | 1 | 2 | 3;
  readonly controlType: 'stone_button';
  readonly neutralMarkerTypes: readonly ['quartz_block', 'oak_planks'];
}

export interface MultilevelGuidedTrainingFragmentV1 {
  readonly version: 'MultilevelGuidedTrainingFragmentV1';
  readonly episode: number;
  readonly half: 'first-half' | 'second-half';
  readonly mode: MultilevelGuidedModeV1;
  readonly layout: MultilevelGuidedTrainingLayoutV1;
  /** Singular by construction.  There is no action-list field. */
  readonly action: Action;
  readonly fixtureBefore: {
    readonly aimedAtTarget: boolean;
    readonly yawOffsetDegrees: -15 | 0 | 15;
    readonly condition: 'look-target' | 'forward-clear' | 'forward-blocked'
      | 'side-clear' | 'side-blocked' | 'low-obstacle' | 'jump-blocked'
      | 'wired-button' | 'disconnected-button' | 'stable-observation' | 'no-change-wait';
  };
  readonly fullSolutionDisclosed: false;
}

const TRAINING_SIDES = ['south', 'east', 'north', 'west'] as const;

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values], random = xorshift32(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function trainingFixtureBefore(mode: MultilevelGuidedModeV1):
  MultilevelGuidedTrainingFragmentV1['fixtureBefore'] {
  if (mode === 'look-plus-15-acquire')
    return { aimedAtTarget: false, yawOffsetDegrees: -15, condition: 'look-target' };
  if (mode === 'look-minus-15-acquire')
    return { aimedAtTarget: false, yawOffsetDegrees: 15, condition: 'look-target' };
  if (mode === 'look-plus-15-away' || mode === 'look-minus-15-away')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'look-target' };
  if (mode === 'forward-reduce-distance')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'forward-clear' };
  if (mode === 'forward-blocked')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'forward-blocked' };
  if (mode === 'left-clear' || mode === 'right-clear')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'side-clear' };
  if (mode === 'left-blocked' || mode === 'right-blocked')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'side-blocked' };
  if (mode === 'jump-forward-clear-one-block')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'low-obstacle' };
  if (mode === 'jump-forward-blocked-low-roof-high-obstacle')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'jump-blocked' };
  if (mode === 'interact-wired-button-opens-iron-door')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'wired-button' };
  if (mode === 'interact-visible-disconnected-button-no-door-change')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'disconnected-button' };
  if (mode === 'observe-state-remains')
    return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'stable-observation' };
  return { aimedAtTarget: true, yawOffsetDegrees: 0, condition: 'no-change-wait' };
}

function trainingAction(mode: MultilevelGuidedModeV1, buttonId: string): Action {
  if (mode.startsWith('look-plus'))
    return { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } };
  if (mode.startsWith('look-minus'))
    return { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } };
  if (mode.startsWith('forward-'))
    return { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  if (mode.startsWith('left-'))
    return { kind: 'move', parameters: { direction: 'left', ticks: 4 } };
  if (mode.startsWith('right-'))
    return { kind: 'move', parameters: { direction: 'right', ticks: 4 } };
  if (mode.startsWith('jump-forward-'))
    return { kind: 'jump', parameters: { forward: true, ticks: 4 } };
  if (mode.startsWith('interact-'))
    return { kind: 'interact', parameters: {}, targetId: buttonId };
  if (mode === 'observe-state-remains') return { kind: 'observe', parameters: { ticks: 5 } };
  return { kind: 'wait', parameters: { ticks: 5 } };
}

function trainingLayout(replication: number): MultilevelGuidedTrainingLayoutV1 {
  return {
    id: `guided-note-training-layout-${String(replication + 1).padStart(2, '0')}`,
    split: replication < 8 ? 'first-half' : 'second-half', replication,
    side: TRAINING_SIDES[replication % TRAINING_SIDES.length]!,
    neutralMarkerVariant: (replication % 4) as 0 | 1 | 2 | 3,
    controlType: 'stone_button', neutralMarkerTypes: ['quartz_block', 'oak_planks'],
  };
}

export function multilevelGuidedTrainingPlanV1(): readonly MultilevelGuidedTrainingFragmentV1[] {
  const half = (halfIndex: 0 | 1) => {
    const startReplication = halfIndex * 8;
    const source = Array.from({ length: 8 }, (_unused, offset) => offset + startReplication)
      .flatMap(replication => MULTILEVEL_GUIDED_MODES_V1.map(mode => ({ replication, mode })));
    return shuffled(source, MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1.seed
      ^ (halfIndex === 0 ? 0x9e3779b9 : 0x85ebca6b));
  };
  return [...half(0), ...half(1)].map(({ replication, mode }, episode) => {
    const layout = trainingLayout(replication), buttonId = `${layout.id}:public-stone-button`;
    return { version: 'MultilevelGuidedTrainingFragmentV1', episode,
      half: episode < 128 ? 'first-half' : 'second-half', mode, layout,
      action: trainingAction(mode, buttonId), fixtureBefore: trainingFixtureBefore(mode),
      fullSolutionDisclosed: false };
  });
}

export function multilevelGuidedTrainingPlanIdentityV1(): string {
  return sha({ precommitment: MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1,
    fragments: multilevelGuidedTrainingPlanV1() });
}

export function noteZeroToTwoGoalV1(caseId: string, noteObjectId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `note-zero-to-two:${caseId}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'note-is-two',
      subject: { kind: 'public-object', id: noteObjectId, expectedType: 'note_block' },
      observable: 'properties.note', comparator: 'equals', target: '2' } } };
}

export interface NoteZeroToTwoQualificationCaseV1 {
  readonly id: string;
  readonly layout: {
    readonly id: string;
    readonly origin: readonly [number, 64, number];
    readonly side: 'north' | 'south' | 'east' | 'west';
    readonly markerPermutation: number;
  };
  readonly noteObjectId: string;
  readonly initialNote: 0;
  readonly rootGoal: GroundedGoalV1;
  readonly learnedExperiencePolicy: 'frozen-read-only';
  readonly habitPolicy: 'empty';
}

/** One low-cost live recursive-goal gate over the already accepted 128-event
 * baseline.  It is intentionally separate from the new empty-memory build. */
export const existingBaselineRecursiveGateCaseV1: NoteZeroToTwoQualificationCaseV1 = Object.freeze({
  id: 'existing-128-recursive-note-zero-to-two',
  layout: { id: 'existing-128-recursive-gate-layout', origin: [180, 64, 180] as const,
    side: 'south' as const, markerPermutation: 80 },
  noteObjectId: 'block:180,65,180', initialNote: 0,
  rootGoal: noteZeroToTwoGoalV1('existing-128-recursive-note-zero-to-two', 'block:180,65,180'),
  learnedExperiencePolicy: 'frozen-read-only', habitPolicy: 'empty',
});

export const EXISTING_BASELINE_RECURSIVE_GATE_V1 = Object.freeze({
  version: 'ExistingBaselineRecursiveGateV1' as const,
  baselineRealEventCount: 128 as const,
  requiredLiveCaseCount: 1 as const,
  requiredMilestones: Object.freeze([
    'production-relation-linked-to-root',
    'grounded-factor-linked-to-relation',
    'root-goal-is-note-two',
    'real-note-zero-observed',
    'real-note-one-observed',
    'real-note-two-observed',
    'real-note-two-confirmed-after-five-ticks',
  ] as const),
  scoreUsesActionSequence: false as const,
});

export interface FoundationQualificationCaseV1 {
  readonly id: string;
  /** Exact member of the approved sixteen-mechanism curriculum. */
  readonly mechanism: MultilevelGuidedModeV1;
  /** Two unseen public layouts per mechanism, never two copies of one door query. */
  readonly replicate: 0 | 1;
  readonly layout: {
    readonly id: string;
    readonly origin: readonly [number, 64, number];
    readonly side: 'north' | 'south' | 'east' | 'west';
    readonly markerPermutation: number;
  };
  readonly exactActionCue: ActionCue;
  readonly query: {
    readonly kind: 'positive-effect' | 'no-effect-counterevidence';
    readonly target: 'crosshair-acquired' | 'crosshair-left' | 'reference-distance-decreased'
      | 'reference-distance-increased' | 'vertical-excursion-increased' | 'door-opened'
      | 'no-public-change';
    /** Negative cases query the real no-effect result and, where one exists,
     * require the corresponding positive result to be suppressed by R2A. */
    readonly counterfactualPositiveTarget: 'reference-distance-decreased'
      | 'reference-distance-increased' | 'vertical-excursion-increased' | 'door-opened' | null;
  };
  readonly sourceSnapshotPolicy: 'frozen-guided-256-read-only';
  readonly initialHabitPolicy: 'empty';
}

const foundationCue = (mode: MultilevelGuidedModeV1): ActionCue => {
  if (mode.startsWith('look-plus'))
    return { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null };
  if (mode.startsWith('look-minus'))
    return { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 }, targetRole: null };
  if (mode.startsWith('forward-'))
    return { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null };
  if (mode.startsWith('left-'))
    return { kind: 'move', parameters: { direction: 'left', ticks: 4 }, targetRole: null };
  if (mode.startsWith('right-'))
    return { kind: 'move', parameters: { direction: 'right', ticks: 4 }, targetRole: null };
  if (mode.startsWith('jump-forward-'))
    return { kind: 'jump', parameters: { forward: true, ticks: 4 }, targetRole: null };
  if (mode.startsWith('interact-'))
    return { kind: 'interact', parameters: {}, targetRole: 'stone_button' };
  if (mode === 'observe-state-remains')
    return { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };
  return { kind: 'wait', parameters: { ticks: 5 }, targetRole: null };
};

function foundationQuery(mode: MultilevelGuidedModeV1): FoundationQualificationCaseV1['query'] {
  if (mode.endsWith('-acquire'))
    return { kind: 'positive-effect', target: 'crosshair-acquired', counterfactualPositiveTarget: null };
  if (mode.endsWith('-away'))
    return { kind: 'positive-effect', target: 'crosshair-left', counterfactualPositiveTarget: null };
  if (mode === 'forward-reduce-distance' || mode === 'left-clear')
    return { kind: 'positive-effect', target: 'reference-distance-decreased',
      counterfactualPositiveTarget: null };
  if (mode === 'right-clear')
    return { kind: 'positive-effect', target: 'reference-distance-increased',
      counterfactualPositiveTarget: null };
  if (mode === 'jump-forward-clear-one-block')
    return { kind: 'positive-effect', target: 'vertical-excursion-increased',
      counterfactualPositiveTarget: null };
  if (mode === 'interact-wired-button-opens-iron-door')
    return { kind: 'positive-effect', target: 'door-opened', counterfactualPositiveTarget: null };
  if (mode === 'forward-blocked')
    return { kind: 'no-effect-counterevidence', target: 'no-public-change',
      counterfactualPositiveTarget: 'reference-distance-decreased' };
  if (mode === 'left-blocked')
    return { kind: 'no-effect-counterevidence', target: 'no-public-change',
      counterfactualPositiveTarget: 'reference-distance-decreased' };
  if (mode === 'right-blocked')
    return { kind: 'no-effect-counterevidence', target: 'no-public-change',
      counterfactualPositiveTarget: 'reference-distance-increased' };
  if (mode === 'jump-forward-blocked-low-roof-high-obstacle')
    return { kind: 'no-effect-counterevidence', target: 'no-public-change',
      counterfactualPositiveTarget: 'vertical-excursion-increased' };
  if (mode === 'interact-visible-disconnected-button-no-door-change')
    return { kind: 'no-effect-counterevidence', target: 'no-public-change',
      counterfactualPositiveTarget: 'door-opened' };
  return { kind: 'no-effect-counterevidence', target: 'no-public-change',
    counterfactualPositiveTarget: null };
}

/** The complete Cartesian gate: every approved mechanism in exactly two
 * public layouts absent from both training halves and the recursive note gate. */
export const foundationQualificationCasesV1: readonly FoundationQualificationCaseV1[] =
  Object.freeze(MULTILEVEL_GUIDED_MODES_V1.flatMap((mechanism, mechanismIndex) =>
    ([0, 1] as const).map(replicate => {
      const index = mechanismIndex * 2 + replicate;
      const x = 240 + (mechanismIndex % 4) * 56 + replicate * 24;
      const z = 240 + Math.floor(mechanismIndex / 4) * 28;
      const id = `foundation-${mechanism}-r${replicate + 1}`;
      return { id, mechanism, replicate,
        layout: { id: `unseen-foundation-${mechanism}-r${replicate + 1}`,
          origin: [x, 64, z] as const,
          side: TRAINING_SIDES[index % TRAINING_SIDES.length]!,
          markerPermutation: 200 + Math.floor(index / TRAINING_SIDES.length) },
        exactActionCue: foundationCue(mechanism), query: foundationQuery(mechanism),
        sourceSnapshotPolicy: 'frozen-guided-256-read-only' as const,
        initialHabitPolicy: 'empty' as const };
    })));

export const FOUNDATION_QUALIFICATION_GATE_V1 = Object.freeze({
  version: 'FoundationQualificationGateV1' as const,
  sourceRealEventCount: 256 as const,
  requiredUnseenCaseCount: 32 as const,
  minimumCloneValidSamples: 8 as const,
  minimumCloneProgressFraction: .75 as const,
  requiredChecks: Object.freeze([
    'exact-action-cue-and-effect', 'r1-active', 'r2-active', 'production-r2a',
    'factor-transition-recalled', 'prediction-clone-valid-samples-and-progress-or-no-effect-counterevidence',
    'all-16-mechanisms-by-2-unseen-layouts',
    'long-term-memory-no-write',
  ] as const),
  scoreUsesActionSequence: false as const,
});

export interface RealPublicStateMilestoneV1 {
  readonly source: 'real-public-observation';
  readonly sequence: number;
  readonly objectId: string;
  readonly objectType: string;
  readonly observable: string;
  readonly value: PublicValue;
}

export interface NoteQualificationEvidenceV1 {
  readonly caseId: string;
  readonly leakageAuditPassed: boolean;
  readonly fixtureReady: boolean;
  readonly baseline: {
    readonly kind: 'existing-frozen-128';
    readonly realEventCount: number;
    readonly frozenSnapshotId: string | null;
  };
  readonly representation: {
    readonly r1Active: boolean;
    readonly r2Active: boolean;
    readonly r2aActive: boolean;
    readonly productionRelationIds: readonly string[];
    readonly groundedFactorIds: readonly string[];
    readonly relationFactorLinks: readonly {
      readonly relationId: string;
      readonly factorIds: readonly string[];
      readonly rootGoalId: string;
    }[];
  };
  readonly rootGoal: GroundedGoalV1;
  readonly workspace: {
    readonly rootNodeId: string | null;
    readonly rootGoalId: string | null;
    readonly dependencyNodeIds: readonly string[];
  };
  readonly realStates: readonly RealPublicStateMilestoneV1[];
}

export interface NoteQualificationScoreV1 {
  readonly version: 'NoteQualificationScoreV1';
  readonly caseId: string;
  readonly passed: boolean;
  readonly failure: MinecraftMultilevelFailureClassV1 | null;
  readonly milestones: {
    readonly relation: boolean;
    readonly factor: boolean;
    readonly rootGoal: boolean;
    readonly realInitialState: boolean;
    readonly realIntermediateState: boolean;
    readonly realTargetState: boolean;
    readonly realTargetConfirmation: boolean;
  };
}

function exactPredicateGoal(goal: GroundedGoalV1, id: string, objectId: string,
  expectedType: string, observable: string, target: PublicValue): boolean {
  if (goal.id !== id || goal.expression.kind !== 'predicate') return false;
  const predicate = goal.expression.predicate;
  return predicate.subject.kind === 'public-object' && predicate.subject.id === objectId
    && predicate.subject.expectedType === expectedType && predicate.observable === observable
    && predicate.comparator === 'equals' && predicate.target === target;
}

export function scoreExistingBaselineRecursiveGateV1(
  specification: NoteZeroToTwoQualificationCaseV1,
  evidence: NoteQualificationEvidenceV1,
): NoteQualificationScoreV1 {
  const goalMilestone = exactPredicateGoal(evidence.rootGoal, specification.rootGoal.id,
    specification.noteObjectId, 'note_block', 'properties.note', '2')
    && evidence.workspace.rootNodeId !== null
    && evidence.workspace.rootGoalId === specification.rootGoal.id;
  const productionRelations = new Set(evidence.representation.productionRelationIds);
  const groundedFactors = new Set(evidence.representation.groundedFactorIds);
  const linked = evidence.representation.relationFactorLinks.filter(link =>
    link.rootGoalId === specification.rootGoal.id && productionRelations.has(link.relationId));
  const relationMilestone = linked.length > 0;
  const factorMilestone = linked.some(link => link.factorIds.length > 0
    && link.factorIds.every(factorId => groundedFactors.has(factorId)));
  const matchingStates = evidence.realStates.filter(state => state.source === 'real-public-observation'
    && state.objectId === specification.noteObjectId && state.objectType === 'note_block'
    && state.observable === 'properties.note').sort((a, b) => a.sequence - b.sequence);
  const zero = matchingStates.find(state => state.value === '0');
  const one = zero && matchingStates.find(state => state.sequence > zero.sequence && state.value === '1');
  const two = one && matchingStates.find(state => state.sequence > one.sequence && state.value === '2');
  const confirmed = two && matchingStates.find(state => state.sequence >= two.sequence + 5 && state.value === '2');
  const milestones = { relation: relationMilestone, factor: factorMilestone,
    rootGoal: goalMilestone, realInitialState: Boolean(zero), realIntermediateState: Boolean(one),
    realTargetState: Boolean(two), realTargetConfirmation: Boolean(confirmed) };
  const signals: MinecraftMultilevelFailureSignalsV1 = {
    leakageFree: evidence.leakageAuditPassed,
    fixtureReady: evidence.fixtureReady && milestones.realInitialState,
    foundationExperienceReady: evidence.baseline.kind === 'existing-frozen-128'
      && evidence.baseline.realEventCount === 128 && evidence.baseline.frozenSnapshotId !== null,
    representationReady: evidence.representation.r1Active && evidence.representation.r2Active
      && evidence.representation.r2aActive && groundedFactors.size > 0,
    physicalRecallAndRolloutReady: milestones.relation && milestones.factor
      && milestones.realIntermediateState,
    dependencyDecompositionReady: milestones.rootGoal,
    controlSelectionReady: true, controlCapacityAvailable: true, bodyIntegrationReady: true,
    attentionReady: true, goalVerified: milestones.realTargetState && milestones.realTargetConfirmation,
  };
  const failure = classifyMinecraftMultilevelFailureV1(signals);
  return { version: 'NoteQualificationScoreV1', caseId: specification.id,
    passed: failure === null, failure, milestones };
}

export interface FoundationQualificationEvidenceV1 {
  readonly caseId: string;
  readonly mechanism: MultilevelGuidedModeV1;
  readonly replicate: 0 | 1;
  readonly publicContextId: string;
  readonly leakageAuditPassed: boolean;
  readonly fixtureReady: boolean;
  readonly sourceSnapshot: {
    readonly guidedRealEventCount: number;
    readonly snapshotId: string | null;
    readonly memoryHashBefore: string;
    readonly memoryHashAfter: string;
  };
  readonly r1: { readonly active: boolean; readonly traceIds: readonly string[] };
  readonly r2: { readonly active: boolean; readonly visitIds: readonly string[] };
  readonly productionR2A: {
    readonly productionEligible: boolean;
    readonly currentApplicability: number;
    readonly relationIds: readonly string[];
    readonly factorIds: readonly string[];
  };
  readonly factorTransition: {
    readonly recalled: boolean;
    readonly factorIds: readonly string[];
    readonly transitionTraceIds: readonly string[];
  };
  readonly predictionClone: {
    readonly interpretation: 'positive-progress' | 'no-effect-physical-readout';
    readonly validSampleCount: number;
    readonly progressSampleCount: number;
  };
  readonly exactEffectLookup: {
    readonly queryKind: FoundationQualificationCaseV1['query']['kind'];
    readonly goalId: string | null;
    readonly expectedCueIdentity: string;
    readonly candidateIds: readonly string[];
    readonly candidateRelationIds: readonly string[];
  };
  readonly counterevidence: {
    readonly required: boolean;
    readonly exactNoEffectCandidateIds: readonly string[];
    readonly noEffectRelationIds: readonly string[];
    readonly noEffectCurrentApplicability: number;
    readonly counterfactualCandidateIds: readonly string[];
    readonly counterfactualMaximumApplicability: number;
    readonly counterfactualProgressSampleCount: number;
  };
}

export interface FoundationQualificationScoreV1 {
  readonly version: 'FoundationQualificationScoreV1';
  readonly caseId: string;
  readonly passed: boolean;
  readonly failure: MinecraftMultilevelFailureClassV1 | null;
  readonly milestones: {
    readonly exactCueAndEffect: boolean;
    readonly r1: boolean;
    readonly r2: boolean;
    readonly productionR2A: boolean;
    readonly factorTransition: boolean;
    readonly predictionClone: boolean;
    readonly cloneProgressFraction: number;
    readonly noEffectCounterevidence: boolean;
    readonly noWrite: boolean;
  };
}

export function scoreFoundationQualificationV1(specification: FoundationQualificationCaseV1,
  evidence: FoundationQualificationEvidenceV1): FoundationQualificationScoreV1 {
  const productionRelations = new Set(evidence.productionR2A.relationIds);
  const productionFactors = new Set(evidence.productionR2A.factorIds);
  const cloneProgressFraction = evidence.predictionClone.validSampleCount === 0 ? 0
    : evidence.predictionClone.progressSampleCount / evidence.predictionClone.validSampleCount;
  const counterfactualRequired = specification.query.kind === 'no-effect-counterevidence'
    && specification.query.counterfactualPositiveTarget !== null;
  const milestones = {
    exactCueAndEffect: evidence.mechanism === specification.mechanism
      && evidence.replicate === specification.replicate
      && evidence.exactEffectLookup.queryKind === specification.query.kind
      && evidence.exactEffectLookup.expectedCueIdentity === sha(specification.exactActionCue)
      && evidence.exactEffectLookup.candidateIds.length > 0
      && evidence.exactEffectLookup.candidateRelationIds.some(id => productionRelations.has(id)),
    r1: evidence.r1.active && evidence.r1.traceIds.length > 0,
    r2: evidence.r2.active && evidence.r2.visitIds.length > 0,
    productionR2A: evidence.productionR2A.productionEligible && productionRelations.size > 0
      && productionFactors.size > 0 && evidence.productionR2A.currentApplicability > 0,
    // A factor transition is required exactly where the qualification asks why
    // the same cue has a different result.  Pure positive and bounded no-change
    // cases do not invent a missing factor merely to satisfy a uniform rubric.
    factorTransition: specification.query.counterfactualPositiveTarget === null
      || evidence.factorTransition.recalled
        && evidence.factorTransition.transitionTraceIds.length > 0
        && evidence.factorTransition.factorIds.some(factorId => productionFactors.has(factorId)),
    predictionClone: evidence.predictionClone.validSampleCount
        >= FOUNDATION_QUALIFICATION_GATE_V1.minimumCloneValidSamples
      && (specification.query.kind === 'no-effect-counterevidence'
        || cloneProgressFraction >= FOUNDATION_QUALIFICATION_GATE_V1.minimumCloneProgressFraction),
    cloneProgressFraction,
    noEffectCounterevidence: specification.query.kind === 'positive-effect'
      || evidence.counterevidence.required
        && evidence.counterevidence.exactNoEffectCandidateIds.length > 0
        && evidence.counterevidence.noEffectRelationIds.some(id => productionRelations.has(id))
        && evidence.counterevidence.noEffectCurrentApplicability > 0
        && (!counterfactualRequired || evidence.counterevidence.counterfactualCandidateIds.length > 0
          && evidence.counterevidence.counterfactualMaximumApplicability === 0
          && evidence.counterevidence.counterfactualProgressSampleCount === 0),
    noWrite: evidence.sourceSnapshot.memoryHashBefore.length > 0
      && evidence.sourceSnapshot.memoryHashBefore === evidence.sourceSnapshot.memoryHashAfter,
  };
  const signals: MinecraftMultilevelFailureSignalsV1 = {
    leakageFree: evidence.leakageAuditPassed && milestones.noWrite,
    fixtureReady: evidence.fixtureReady,
    foundationExperienceReady: evidence.sourceSnapshot.guidedRealEventCount === 256
      && evidence.sourceSnapshot.snapshotId !== null,
    representationReady: milestones.exactCueAndEffect && milestones.r1 && milestones.r2
      && milestones.productionR2A,
    physicalRecallAndRolloutReady: milestones.factorTransition && milestones.predictionClone,
    dependencyDecompositionReady: milestones.noEffectCounterevidence,
    controlSelectionReady: true, controlCapacityAvailable: true, bodyIntegrationReady: true,
    attentionReady: true, goalVerified: true,
  };
  const failure = classifyMinecraftMultilevelFailureV1(signals);
  return { version: 'FoundationQualificationScoreV1', caseId: specification.id,
    passed: failure === null, failure, milestones };
}

export type MultilevelGoalChainTierV1 = 'A' | 'B' | 'C';

export interface VanillaLatchFixtureV1 {
  readonly version: 'VanillaLatchFixtureV1';
  readonly layoutId: string;
  readonly origin: readonly [number, 64, number];
  readonly mechanism: 'stone-button-dropper-barrel-comparator-redstone-repeater-iron-door-latch';
  readonly facing: 'north';
  readonly outputSide: 'right';
  readonly commandBlockPolicy: 'forbidden-and-absent';
  readonly dynamicRuleCallbacks: false;
  readonly components: readonly {
    readonly id: string;
    readonly role: 'button' | 'dropper' | 'container' | 'comparator' | 'wire' | 'repeater' | 'door';
    readonly blockType: 'stone_button' | 'dropper' | 'barrel' | 'comparator'
      | 'redstone_wire' | 'repeater' | 'iron_door';
    readonly relativePosition: readonly [number, number, number];
  }[];
}

export interface GoalChainExperienceEnvelopeV1 {
  readonly sourceSnapshotId: 'note-zero-to-two-qualified-frozen-v1';
  readonly copyId: string;
  readonly independentCaseLocalCopy: true;
  readonly writeBackToSource: false;
  readonly initialHabitWeights: readonly [];
}

export interface GoalChainPerturbationV1 {
  readonly version: 'GoalChainPerturbationV1';
  readonly id: string;
  readonly caseId: string;
  readonly trigger: 'after-first-real-non-observe-action-completed';
  readonly completedNonObserveActionOrdinal: 1;
  readonly kind: 'public-view-yaw-deviation';
  readonly yawDegrees: -30 | 30;
  readonly precommitted: true;
  readonly requiredEvidenceOrder: readonly [
    'real-public-deviation', 'attention-notification',
    'old-condition-and-prediction-invalidated', 'joint-field-recompetition'
  ];
}

export interface MultilevelGoalChainCaseV1 {
  readonly version: 'MultilevelGoalChainCaseV1';
  readonly id: string;
  readonly tier: MultilevelGoalChainTierV1;
  readonly fixture: VanillaLatchFixtureV1;
  readonly doorObjectId: string;
  readonly rootGoal: GroundedGoalV1;
  readonly initialView: {
    readonly buttonPubliclyVisible: boolean;
    readonly yawOffsetDegrees: -15 | 0 | 15;
    readonly distanceBand: 'near' | 'middle' | 'far';
  };
  readonly experience: GoalChainExperienceEnvelopeV1;
  readonly perturbationIds: readonly string[];
  readonly goalDisclosure: {
    readonly rootGoalOnly: true;
    readonly childGoalsDisclosed: 0;
    readonly actionHintsDisclosed: 0;
  };
  readonly fixtureAfterGoalInjection: readonly [
    'record-goal-injection', 'record-real-observation', 'apply-listed-precommitted-perturbation'
  ];
}

export function ironDoorOpenGoalV1(caseId: string, doorObjectId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `iron-door-open:${caseId}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'door-open',
      subject: { kind: 'public-object', id: doorObjectId, expectedType: 'iron_door' },
      observable: 'properties.open', comparator: 'equals', target: true } } };
}

function latchFixture(caseId: string, index: number): VanillaLatchFixtureV1 {
  const originX = 400 + (index % 4) * 16, originZ = 400 + Math.floor(index / 4) * 20;
  const component = (role: VanillaLatchFixtureV1['components'][number]['role'],
    blockType: VanillaLatchFixtureV1['components'][number]['blockType'],
    relativePosition: readonly [number, number, number], suffix = '') => ({
      id: `${caseId}:${role}${suffix}`, role, blockType, relativePosition,
    });
  return { version: 'VanillaLatchFixtureV1', layoutId: `vanilla-latch-layout-${caseId}`,
    origin: [originX, 64, originZ],
    mechanism: 'stone-button-dropper-barrel-comparator-redstone-repeater-iron-door-latch',
    facing: 'north', outputSide: 'right',
    commandBlockPolicy: 'forbidden-and-absent', dynamicRuleCallbacks: false,
    // Exact translated geometry from the real run-004 vanilla latch:
    // button -> preloaded dropper -> barrel -> comparator -> dust ->
    // lateral one-tick repeater -> lower iron door.
    components: [component('button', 'stone_button', [0, 1, 5]),
      component('dropper', 'dropper', [0, 1, 4]),
      component('container', 'barrel', [0, 1, 3]),
      component('comparator', 'comparator', [0, 1, 2]),
      component('wire', 'redstone_wire', [0, 1, 1]),
      component('repeater', 'repeater', [1, 1, 1]),
      component('door', 'iron_door', [2, 1, 1])],
  };
}

function makeGoalChainCase(tier: MultilevelGoalChainTierV1, ordinal: number,
  index: number): MultilevelGoalChainCaseV1 {
  const id = `goal-chain-${tier}-${String(ordinal).padStart(2, '0')}`;
  const fixture = latchFixture(id, index), door = fixture.components.find(value => value.role === 'door')!;
  const yawCycle = [-15, 0, 15, 0] as const;
  const mirroredApproachYaw = (ordinal % 2 === 1 ? -15 : 15) as -15 | 15;
  return { version: 'MultilevelGoalChainCaseV1', id, tier, fixture,
    doorObjectId: door.id, rootGoal: ironDoorOpenGoalV1(id, door.id),
    initialView: tier === 'A'
      ? { buttonPubliclyVisible: true, yawOffsetDegrees: mirroredApproachYaw, distanceBand: 'middle' }
      : tier === 'B'
        ? { buttonPubliclyVisible: true, yawOffsetDegrees: yawCycle[ordinal - 1]!, distanceBand: 'near' }
        : { buttonPubliclyVisible: true,
          yawOffsetDegrees: yawCycle[ordinal - 1]!, distanceBand: 'near' },
    experience: { sourceSnapshotId: 'note-zero-to-two-qualified-frozen-v1',
      copyId: `independent-experience-${id}`, independentCaseLocalCopy: true,
      writeBackToSource: false, initialHabitWeights: [] },
    perturbationIds: tier === 'C' && ordinal <= 2 ? [`precommitted-${id}-yaw`] : [],
    goalDisclosure: { rootGoalOnly: true, childGoalsDisclosed: 0, actionHintsDisclosed: 0 },
    fixtureAfterGoalInjection: ['record-goal-injection', 'record-real-observation',
      'apply-listed-precommitted-perturbation'] };
}

export const minecraftMultilevelGoalChainCasesV1: readonly MultilevelGoalChainCaseV1[] =
  Object.freeze((['A', 'B', 'C'] as const).flatMap((tier, tierIndex) =>
    Array.from({ length: 4 }, (_unused, index) => makeGoalChainCase(tier, index + 1,
      tierIndex * 4 + index))));

export const minecraftMultilevelGoalChainPerturbationsV1: readonly GoalChainPerturbationV1[] =
  Object.freeze([
    { version: 'GoalChainPerturbationV1', id: 'precommitted-goal-chain-C-01-yaw',
      caseId: 'goal-chain-C-01', trigger: 'after-first-real-non-observe-action-completed',
      completedNonObserveActionOrdinal: 1, kind: 'public-view-yaw-deviation', yawDegrees: 30,
      precommitted: true, requiredEvidenceOrder: ['real-public-deviation', 'attention-notification',
        'old-condition-and-prediction-invalidated', 'joint-field-recompetition'] },
    { version: 'GoalChainPerturbationV1', id: 'precommitted-goal-chain-C-02-yaw',
      caseId: 'goal-chain-C-02', trigger: 'after-first-real-non-observe-action-completed',
      completedNonObserveActionOrdinal: 1, kind: 'public-view-yaw-deviation', yawDegrees: -30,
      precommitted: true, requiredEvidenceOrder: ['real-public-deviation', 'attention-notification',
        'old-condition-and-prediction-invalidated', 'joint-field-recompetition'] },
  ]);

export interface FixturePreparationReceiptV1 {
  readonly caseId: string;
  readonly layoutId: string;
  readonly ready: boolean;
  readonly realObservationSequence: number;
  readonly commandBlocksObserved: 0;
}

export interface RealNonObserveActionTriggerV1 {
  readonly source: 'real-body-result';
  readonly eventId: string;
  readonly actionKind: Exclude<PrimitiveKind, 'observe' | 'wait'>;
  readonly executed: true;
  readonly completedNonObserveActionOrdinal: 1;
}

export type GoalChainFixtureJournalEntryV1 =
  | { readonly kind: 'fixture-prepared'; readonly value: FixturePreparationReceiptV1 }
  | { readonly kind: 'root-goal-recorded'; readonly value: { readonly goal: GroundedGoalV1 } }
  | { readonly kind: 'real-observation-recorded'; readonly value: RealPublicStateMilestoneV1 }
  | { readonly kind: 'precommitted-perturbation-recorded'; readonly value: {
      readonly perturbation: GoalChainPerturbationV1;
      readonly trigger: RealNonObserveActionTriggerV1;
      readonly worldSideEffectExecutedByThisRecorder: false;
    } };

export interface MultilevelGoalChainFixturePortV1 {
  readonly specification: MultilevelGoalChainCaseV1;
  readonly journal: readonly GoalChainFixtureJournalEntryV1[];
  recordPreparation(receipt: FixturePreparationReceiptV1): void;
  recordRootGoalInjection(goal: GroundedGoalV1): void;
  recordRealObservation(state: RealPublicStateMilestoneV1): void;
  recordPrecommittedPerturbation(perturbationId: string,
    trigger: RealNonObserveActionTriggerV1): void;
}

/**
 * Narrow fixture boundary for the later live adapter.  Once the goal is
 * recorded, it exposes only evidence recording and the listed perturbation.
 * This implementation is deliberately a no-Minecraft, no-side-effect journal.
 */
export class RecordingMultilevelGoalChainFixtureV1 implements MultilevelGoalChainFixturePortV1 {
  readonly journal: GoalChainFixtureJournalEntryV1[] = [];
  readonly #perturbations: ReadonlyMap<string, GoalChainPerturbationV1>;
  #phase: 'fresh' | 'prepared' | 'goal-recorded' = 'fresh';
  #usedPerturbations = new Set<string>();

  constructor(readonly specification: MultilevelGoalChainCaseV1,
    perturbations: readonly GoalChainPerturbationV1[] = minecraftMultilevelGoalChainPerturbationsV1) {
    this.#perturbations = new Map(perturbations.filter(value => value.caseId === specification.id)
      .map(value => [value.id, value]));
  }

  recordPreparation(receipt: FixturePreparationReceiptV1): void {
    if (this.#phase !== 'fresh') throw new Error('fixture-preparation-already-recorded');
    if (receipt.caseId !== this.specification.id || receipt.layoutId !== this.specification.fixture.layoutId
      || !receipt.ready || receipt.commandBlocksObserved !== 0)
      throw new Error('fixture-preparation-receipt-invalid');
    this.journal.push({ kind: 'fixture-prepared', value: structuredClone(receipt) });
    this.#phase = 'prepared';
  }

  recordRootGoalInjection(goal: GroundedGoalV1): void {
    if (this.#phase !== 'prepared') throw new Error('root-goal-recording-out-of-order');
    if (!exactPredicateGoal(goal, this.specification.rootGoal.id, this.specification.doorObjectId,
      'iron_door', 'properties.open', true)) throw new Error('root-goal-does-not-match-precommitment');
    this.journal.push({ kind: 'root-goal-recorded', value: { goal: structuredClone(goal) } });
    this.#phase = 'goal-recorded';
  }

  recordRealObservation(state: RealPublicStateMilestoneV1): void {
    if (this.#phase !== 'goal-recorded') throw new Error('post-goal-observation-out-of-order');
    this.journal.push({ kind: 'real-observation-recorded', value: structuredClone(state) });
  }

  recordPrecommittedPerturbation(perturbationId: string,
    trigger: RealNonObserveActionTriggerV1): void {
    if (this.#phase !== 'goal-recorded') throw new Error('perturbation-out-of-order');
    const perturbation = this.#perturbations.get(perturbationId);
    if (!perturbation || !this.specification.perturbationIds.includes(perturbationId))
      throw new Error('perturbation-not-precommitted-for-case');
    if (this.#usedPerturbations.has(perturbationId)) throw new Error('perturbation-already-recorded');
    if (trigger.source !== 'real-body-result' || !trigger.executed
      || trigger.completedNonObserveActionOrdinal !== 1)
      throw new Error('perturbation-trigger-is-not-first-real-non-observe-action');
    this.#usedPerturbations.add(perturbationId);
    this.journal.push({ kind: 'precommitted-perturbation-recorded', value: {
      perturbation: structuredClone(perturbation), trigger: structuredClone(trigger),
      worldSideEffectExecutedByThisRecorder: false } });
  }
}

export interface GoalChainCaseEvidenceV1 {
  readonly caseId: string;
  readonly experienceCopyId: string;
  readonly initialHabitWeightCount: number;
  readonly leakageAuditPassed: boolean;
  readonly fixtureReady: boolean;
  readonly foundationQualified: boolean;
  readonly representationQualified: boolean;
  readonly physicalRecallOrRolloutObserved: boolean;
  readonly dependency: {
    readonly rootGoalId: string | null;
    readonly rootNodeId: string | null;
    readonly discoveredDependencyNodeIds: readonly string[];
    readonly expansionObserved: boolean;
  };
  readonly controlSelectionObserved: boolean;
  readonly controlCapacityExhausted: boolean;
  readonly bodyIntegrationSucceeded: boolean;
  readonly attention: {
    readonly realDeviationSequence: number | null;
    readonly notificationSequence: number | null;
    readonly oldConditionInvalidatedSequence: number | null;
    readonly oldPredictionInvalidatedSequence: number | null;
    readonly recompetitionSequence: number | null;
  };
  readonly realDoorStates: readonly RealPublicStateMilestoneV1[];
}

export interface GoalChainCaseScoreV1 {
  readonly version: 'GoalChainCaseScoreV1';
  readonly caseId: string;
  readonly passed: boolean;
  readonly failure: MinecraftMultilevelFailureClassV1 | null;
  readonly milestones: {
    readonly dependencyExpansion: boolean;
    readonly attentionRecovery: boolean;
    readonly realDoorOpen: boolean;
    readonly realDoorOpenConfirmed: boolean;
  };
}

function attentionRecoverySatisfied(specification: MultilevelGoalChainCaseV1,
  evidence: GoalChainCaseEvidenceV1): boolean {
  if (specification.perturbationIds.length === 0) return true;
  const attention = evidence.attention;
  if (attention.realDeviationSequence === null || attention.notificationSequence === null
    || attention.oldConditionInvalidatedSequence === null
    || attention.oldPredictionInvalidatedSequence === null
    || attention.recompetitionSequence === null) return false;
  return attention.realDeviationSequence <= attention.notificationSequence
    && attention.notificationSequence <= attention.oldConditionInvalidatedSequence
    && attention.notificationSequence <= attention.oldPredictionInvalidatedSequence
    && Math.max(attention.oldConditionInvalidatedSequence, attention.oldPredictionInvalidatedSequence)
      <= attention.recompetitionSequence;
}

export function scoreMultilevelGoalChainCaseV1(specification: MultilevelGoalChainCaseV1,
  evidence: GoalChainCaseEvidenceV1): GoalChainCaseScoreV1 {
  const doorStates = evidence.realDoorStates.filter(state => state.source === 'real-public-observation'
    && state.objectId === specification.doorObjectId && state.objectType === 'iron_door'
    && state.observable === 'properties.open').sort((a, b) => a.sequence - b.sequence);
  const opened = doorStates.find(state => state.value === true);
  const confirmed = opened && doorStates.find(state => state.sequence >= opened.sequence + 5
    && state.value === true);
  const dependencyExpansion = evidence.dependency.rootGoalId === specification.rootGoal.id
    && evidence.dependency.rootNodeId !== null && evidence.dependency.expansionObserved
    && evidence.dependency.discoveredDependencyNodeIds.length > 0;
  const attentionRecovery = attentionRecoverySatisfied(specification, evidence);
  const stateIsolation = evidence.experienceCopyId === specification.experience.copyId
    && evidence.initialHabitWeightCount === 0;
  const signals: MinecraftMultilevelFailureSignalsV1 = {
    leakageFree: evidence.leakageAuditPassed && stateIsolation,
    fixtureReady: evidence.fixtureReady,
    foundationExperienceReady: evidence.foundationQualified,
    representationReady: evidence.representationQualified,
    physicalRecallAndRolloutReady: evidence.physicalRecallOrRolloutObserved,
    dependencyDecompositionReady: dependencyExpansion,
    controlSelectionReady: evidence.controlSelectionObserved,
    controlCapacityAvailable: !evidence.controlCapacityExhausted,
    bodyIntegrationReady: evidence.bodyIntegrationSucceeded,
    attentionReady: attentionRecovery,
    goalVerified: Boolean(opened && confirmed),
  };
  const failure = classifyMinecraftMultilevelFailureV1(signals);
  return { version: 'GoalChainCaseScoreV1', caseId: specification.id,
    passed: failure === null, failure, milestones: { dependencyExpansion, attentionRecovery,
      realDoorOpen: Boolean(opened), realDoorOpenConfirmed: Boolean(confirmed) } };
}

export type MultilevelAblationV1 =
  | 'dependency-expansion-disabled'
  | 'r2a-isolated'
  | 'prediction-clone-progress-gate-disabled'
  | 'attention-deviation-input-disabled';

export const MULTILEVEL_ABLATIONS_V1 = Object.freeze([
  { id: 'dependency-expansion-disabled', intervention: 'disable-dependency-expansion' },
  { id: 'r2a-isolated', intervention: 'isolate-r2a-from-control' },
  { id: 'prediction-clone-progress-gate-disabled', intervention: 'disable-prediction-clone-progress-gate' },
  { id: 'attention-deviation-input-disabled', intervention: 'disable-attention-deviation-input' },
] as const satisfies readonly { readonly id: MultilevelAblationV1; readonly intervention: string }[]);

export const MULTILEVEL_ABLATION_CONTRACT_V1 = Object.freeze({
  version: 'MultilevelAblationContractV1' as const,
  diagnosticCaseIds: Object.freeze([
    'goal-chain-C-01', 'goal-chain-C-02', 'goal-chain-C-03', 'goal-chain-C-04',
  ] as const),
  perturbedAttentionCaseIds: Object.freeze(['goal-chain-C-01', 'goal-chain-C-02'] as const),
  fullSystemMinimumSuccessAdvantage: 2 as const,
  advantageRequiredAgainst: Object.freeze([
    'dependency-expansion-disabled', 'r2a-isolated',
    'prediction-clone-progress-gate-disabled',
  ] as const),
  attentionDisabledRequirement:
    'slower-response-and-stale-prediction-use-or-failure' as const,
});

export const MULTILEVEL_GOAL_CHAIN_STAGE_CONTRACT_V1 = Object.freeze({
  version: 'MultilevelGoalChainStageContractV1' as const,
  orderedStages: Object.freeze([
    'existing-baseline-128-recursive-gate-1', 'empty-memory-guided-training-256',
    'unseen-foundation-qualification-32',
    'goal-chain-tier-A-4', 'goal-chain-tier-B-4', 'goal-chain-tier-C-4',
    'four-layout-ablation-diagnostics',
  ] as const),
  existingBaselineGateRequiredBeforeNewTraining: true as const,
  foundationQualificationRequiredBeforeGoalChain: true as const,
  tierAdvancePolicy: 'all-four-cases-score-before-next-tier' as const,
  laterStageCannotRepairEarlierFailure: true as const,
});

export interface MultilevelDiagnosticOutcomeV1 {
  readonly caseId: string;
  readonly success: boolean;
  readonly attentionResponseLatencyTicks: number | null;
  readonly staleConditionOrPredictionUsed: boolean;
}

export interface MultilevelDiagnosticBatchV1 {
  readonly variant: 'full-system' | MultilevelAblationV1;
  readonly outcomes: readonly MultilevelDiagnosticOutcomeV1[];
}

export interface MultilevelAblationScoreV1 {
  readonly version: 'MultilevelAblationScoreV1';
  readonly passed: boolean;
  readonly mechanismAdvantages: Readonly<Record<
    'dependency-expansion-disabled' | 'r2a-isolated' | 'prediction-clone-progress-gate-disabled',
    number>>;
  readonly attentionDisabledCasesPassed: readonly string[];
  readonly contractViolations: readonly string[];
}

export function scoreMultilevelAblationsV1(fullSystem: MultilevelDiagnosticBatchV1,
  ablations: readonly MultilevelDiagnosticBatchV1[]): MultilevelAblationScoreV1 {
  const requiredIds = [...MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds];
  const violations: string[] = [];
  const validate = (batch: MultilevelDiagnosticBatchV1) => {
    const ids = batch.outcomes.map(value => value.caseId);
    if (ids.length !== 4 || new Set(ids).size !== 4
      || requiredIds.some(id => !ids.includes(id))) violations.push(`invalid-diagnostic-batch:${batch.variant}`);
  };
  validate(fullSystem);
  const byVariant = new Map(ablations.map(batch => [batch.variant, batch]));
  for (const variant of MULTILEVEL_ABLATIONS_V1) {
    const batch = byVariant.get(variant.id);
    if (!batch) violations.push(`missing-ablation-batch:${variant.id}`); else validate(batch);
  }
  const successCount = (batch: MultilevelDiagnosticBatchV1 | undefined) =>
    batch?.outcomes.filter(outcome => outcome.success).length ?? 0;
  const fullSuccesses = successCount(fullSystem);
  const mechanismAdvantages = {
    'dependency-expansion-disabled': fullSuccesses
      - successCount(byVariant.get('dependency-expansion-disabled')),
    'r2a-isolated': fullSuccesses - successCount(byVariant.get('r2a-isolated')),
    'prediction-clone-progress-gate-disabled': fullSuccesses
      - successCount(byVariant.get('prediction-clone-progress-gate-disabled')),
  };
  for (const [variant, advantage] of Object.entries(mechanismAdvantages))
    if (advantage < MULTILEVEL_ABLATION_CONTRACT_V1.fullSystemMinimumSuccessAdvantage)
      violations.push(`insufficient-full-system-advantage:${variant}:${advantage}`);
  const attention = byVariant.get('attention-deviation-input-disabled');
  const attentionDisabledCasesPassed: string[] = [];
  for (const caseId of MULTILEVEL_ABLATION_CONTRACT_V1.perturbedAttentionCaseIds) {
    const full = fullSystem.outcomes.find(value => value.caseId === caseId);
    const disabled = attention?.outcomes.find(value => value.caseId === caseId);
    const slower = Boolean(full && disabled && full.attentionResponseLatencyTicks !== null
      && (!disabled.success || (disabled.attentionResponseLatencyTicks !== null
        && disabled.attentionResponseLatencyTicks > full.attentionResponseLatencyTicks)));
    const staleOrFailed = Boolean(disabled && (disabled.staleConditionOrPredictionUsed || !disabled.success));
    if (full?.success && slower && staleOrFailed) attentionDisabledCasesPassed.push(caseId);
    else violations.push(`attention-disabled-contrast-not-demonstrated:${caseId}`);
  }
  return { version: 'MultilevelAblationScoreV1', passed: violations.length === 0,
    mechanismAdvantages, attentionDisabledCasesPassed, contractViolations: violations };
}

export interface MinecraftMultilevelGoalChainProtocolV1 {
  readonly version: 'MinecraftMultilevelGoalChainProtocolV1';
  readonly trainingPrecommitment: typeof MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1;
  readonly existingBaselineRecursiveGate: readonly [NoteZeroToTwoQualificationCaseV1];
  readonly training: readonly MultilevelGuidedTrainingFragmentV1[];
  readonly foundationQualification: readonly FoundationQualificationCaseV1[];
  readonly goalChainCases: readonly MultilevelGoalChainCaseV1[];
  readonly perturbations: readonly GoalChainPerturbationV1[];
  readonly ablations: typeof MULTILEVEL_ABLATIONS_V1;
  readonly ablationContract: typeof MULTILEVEL_ABLATION_CONTRACT_V1;
}

export function minecraftMultilevelGoalChainProtocolV1(): MinecraftMultilevelGoalChainProtocolV1 {
  return { version: 'MinecraftMultilevelGoalChainProtocolV1',
    trainingPrecommitment: MULTILEVEL_GUIDED_TRAINING_PRECOMMITMENT_V1,
    existingBaselineRecursiveGate: [existingBaselineRecursiveGateCaseV1],
    training: multilevelGuidedTrainingPlanV1(),
    foundationQualification: foundationQualificationCasesV1,
    goalChainCases: minecraftMultilevelGoalChainCasesV1,
    perturbations: minecraftMultilevelGoalChainPerturbationsV1,
    ablations: MULTILEVEL_ABLATIONS_V1, ablationContract: MULTILEVEL_ABLATION_CONTRACT_V1 };
}

export interface MinecraftMultilevelLeakageAuditV1 {
  readonly version: 'MinecraftMultilevelLeakageAuditV1';
  readonly passed: boolean;
  readonly violations: readonly string[];
}

function disclosedMethodKeys(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => disclosedMethodKeys(item, `${path}[${index}]`));
  const forbidden = new Set(['actionSequence', 'expectedActions', 'solutionSteps', 'subgoalSequence',
    ['script', 'Generated', 'Subgoals'].join('')]);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    ...(forbidden.has(key) ? [`${path}.${key}`] : []), ...disclosedMethodKeys(item, `${path}.${key}`),
  ]);
}

export function auditMinecraftMultilevelGoalChainProtocolV1(
  protocol: MinecraftMultilevelGoalChainProtocolV1 = minecraftMultilevelGoalChainProtocolV1(),
): MinecraftMultilevelLeakageAuditV1 {
  const violations: string[] = [];
  const half = (name: 'first-half' | 'second-half') => protocol.training.filter(item => item.half === name);
  if (protocol.training.length !== 256 || half('first-half').length !== 128
    || half('second-half').length !== 128) violations.push('training-cardinality-or-half-boundary');
  for (const mode of MULTILEVEL_GUIDED_MODES_V1) {
    const total = protocol.training.filter(item => item.mode === mode).length;
    const first = half('first-half').filter(item => item.mode === mode).length;
    const second = half('second-half').filter(item => item.mode === mode).length;
    if (total !== 16 || first !== 8 || second !== 8)
      violations.push(`training-mode-balance:${mode}:${total}:${first}:${second}`);
  }
  if (protocol.training.some(item => !item.action || item.fullSolutionDisclosed !== false))
    violations.push('training-fragment-is-not-single-action');
  if (disclosedMethodKeys(protocol.training).length > 0)
    violations.push('training-method-disclosure-field');
  const trainingText = JSON.stringify(protocol.training).toLowerCase();
  // The approved single-action curriculum directly observes vanilla buttons,
  // wiring and doors. Those public fixture types are evidence, not a disclosed
  // solution chain; only a command-driven fixture is forbidden here.
  if (trainingText.includes('command_block'))
    violations.push('target-fixture-leaked-into-training:command_block');
  const trainingLayouts = new Set(protocol.training.map(item => item.layout.id));
  if (protocol.existingBaselineRecursiveGate.length !== 1)
    violations.push('existing-baseline-recursive-gate-not-single-case');
  const qualificationLayouts = new Set(protocol.foundationQualification.map(item => item.layout.id));
  if (protocol.foundationQualification.length !== 32 || qualificationLayouts.size !== 32
    || [...qualificationLayouts].some(id => trainingLayouts.has(id))
    || qualificationLayouts.has(protocol.existingBaselineRecursiveGate[0]?.layout.id ?? ''))
    violations.push('foundation-qualification-layouts-not-32-unseen-layouts');
  for (const mode of MULTILEVEL_GUIDED_MODES_V1) {
    const cases = protocol.foundationQualification.filter(item => item.mechanism === mode);
    if (cases.length !== 2 || new Set(cases.map(item => item.replicate)).size !== 2
      || cases.some(item => sha(item.exactActionCue) !== sha(foundationCue(mode))))
      violations.push(`foundation-qualification-not-mode-x-two:${mode}`);
  }
  const tierCounts = Object.fromEntries((['A', 'B', 'C'] as const)
    .map(tier => [tier, protocol.goalChainCases.filter(item => item.tier === tier).length]));
  if (protocol.goalChainCases.length !== 12 || Object.values(tierCounts).some(count => count !== 4))
    violations.push('goal-chain-tier-cardinality');
  const goalIds = new Set(protocol.goalChainCases.map(item => item.rootGoal.id));
  const doorIds = new Set(protocol.goalChainCases.map(item => item.doorObjectId));
  const copyIds = new Set(protocol.goalChainCases.map(item => item.experience.copyId));
  if (goalIds.size !== 12 || doorIds.size !== 12) violations.push('door-goals-or-targets-not-unique');
  if (copyIds.size !== 12 || protocol.goalChainCases.some(item =>
    !item.experience.independentCaseLocalCopy || item.experience.writeBackToSource
      || item.experience.initialHabitWeights.length !== 0))
    violations.push('case-experience-or-habit-not-isolated');
  for (const item of protocol.goalChainCases) {
    if (!exactPredicateGoal(item.rootGoal, `iron-door-open:${item.id}`, item.doorObjectId,
      'iron_door', 'properties.open', true)) violations.push(`invalid-door-root-goal:${item.id}`);
    if (item.fixture.commandBlockPolicy !== 'forbidden-and-absent' || item.fixture.dynamicRuleCallbacks
      || item.fixture.facing !== 'north' || item.fixture.outputSide !== 'right'
      || item.fixture.components.some(component => !['stone_button', 'dropper', 'barrel',
        'comparator', 'redstone_wire', 'repeater', 'iron_door'].includes(component.blockType)))
      violations.push(`non-vanilla-or-command-driven-fixture:${item.id}`);
    if (!item.goalDisclosure.rootGoalOnly || item.goalDisclosure.childGoalsDisclosed !== 0
      || item.goalDisclosure.actionHintsDisclosed !== 0)
      violations.push(`method-disclosed-to-controller:${item.id}`);
    if (!item.initialView.buttonPubliclyVisible)
      violations.push(`goal-chain-button-not-public-before-injection:${item.id}`);
    if (item.tier === 'A' && (Math.abs(item.initialView.yawOffsetDegrees) !== 15
      || item.initialView.distanceBand !== 'middle'))
      violations.push(`tier-a-approach-view-not-plus-minus-15-and-outside-reach:${item.id}`);
  }
  if (disclosedMethodKeys(protocol.goalChainCases).length > 0)
    violations.push('evaluation-method-disclosure-field');
  const perturbationsValid = protocol.perturbations.length === 2
    && new Set(protocol.perturbations.map(value => value.caseId)).size === 2
    && protocol.perturbations.every(value => value.caseId === 'goal-chain-C-01'
      || value.caseId === 'goal-chain-C-02')
    && [...protocol.perturbations.map(value => value.yawDegrees)].sort((a, b) => a - b).join(',') === '-30,30'
    && protocol.perturbations.every(value => value.trigger === 'after-first-real-non-observe-action-completed'
      && value.completedNonObserveActionOrdinal === 1 && value.precommitted);
  if (!perturbationsValid) violations.push('precommitted-perturbations-not-exactly-two-cases-plus-minus-30');
  for (const item of protocol.goalChainCases) {
    const expected = protocol.perturbations.filter(value => value.caseId === item.id).map(value => value.id);
    if (expected.length !== item.perturbationIds.length
      || expected.some(id => !item.perturbationIds.includes(id)))
      violations.push(`case-perturbation-reference-mismatch:${item.id}`);
  }
  if (protocol.ablations.length !== 4
    || new Set(protocol.ablations.map(value => value.id)).size !== 4
    || protocol.ablationContract.diagnosticCaseIds.length !== 4)
    violations.push('ablation-contract-cardinality');
  return { version: 'MinecraftMultilevelLeakageAuditV1', passed: violations.length === 0, violations };
}
