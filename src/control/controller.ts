import type { Observation, PublicChange, PublicValue } from '../contracts.js';
import { cueIdentity } from '../events.js';
import { assert, sha } from '../util.js';
import type { AttentionNotice } from '../attention/monitor.js';
import type { ActionObservationScopeV1, ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1,
  ContinuationPredictionV2, ContinuousPatternRecallV2, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, JointControlDecisionV2,
  JointControlDrivesV2, JointControlOperationV2, JointControlSiteInputV2,
  JointTransientControlFieldConfigV2, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from './contracts.js';
import { JointTransientControlFieldV2 } from './field.js';
import { ControlHabitWeightsV1, type ControlHabitGraphRelationV1,
  type TrustedRealActionOutcomeV1 } from './habit.js';
import { goalPredicates, groundedPublicObservableV1, GroundedGoalEvaluatorV1 } from './goal.js';
import { compactBranchPredictionForControlAuditV2, ControlWorkspaceV2, type ControlWorkspaceNodeSnapshotV2,
  type ControlWorkspaceSnapshotV2, type BoundContinuationPredictionV2,
  type ControlBranchPredictionResultV2 } from './workspace.js';

export interface PhysicalControlEnvironmentV2 {
  observe(): Promise<Observation>;
  /** Block until a genuinely newer public observation exists.  This is an
   * event boundary, not a controller timeout or a fallback decision. */
  waitForObservationAfter(sequence: number): Promise<Observation>;
  listActionOffers(observation: Observation): readonly ActionOfferV1[];
  /** Public body fact. It describes only what is currently missing and
   * never recommends an action or constructs a subgoal. */
  describeActionRequirement(actionCue: EffectRecallCandidateV1['actionCue'], observation: Observation): {
    readonly satisfied: boolean;
    readonly missing: readonly string[];
    readonly goal: GroundedGoalV1 | null;
  };
  executeOffer(offer: ActionOfferV1, observationScope: ActionObservationScopeV1): Promise<{ readonly executed: boolean; readonly observation: Observation;
    readonly eventId: string | null; readonly refusal?: 'action-budget-exhausted' | 'offer-stale' | 'target-unavailable' }>;
  recordTrustedRuntimeGoalMeasurement?(eventId: string, observedAt: number,
    goalResidualBefore: number, goalResidualAfter: number): Promise<void>;
  commitHabitOutcome?(outcome: TrustedRealActionOutcomeV1): Promise<void>;
  status(): Promise<{ readonly ready: boolean; readonly bufferedEvents: number; readonly writes: number }>;
  readonly actionCount: number;
  readonly actionBudget: number;
  record(kind: string, value: unknown): void;
}

export interface PhysicalControlResultV2 {
  readonly status: 'goal-verified' | 'current-experience-and-budget-exhausted' | 'control-field-unknown'
    | 'initialization-complete' | 'initialization-budget-exhausted'
    | 'exploration-stop-condition-met' | 'exploration-budget-exhausted';
  readonly actions: number;
  readonly cycles: number;
  readonly goalEvaluation: GoalEvaluationV1 | null;
  readonly notGlobalImpossibilityClaim: true;
}

export interface PhysicalControlSnapshotV2 {
  readonly version: 'PhysicalControlSnapshotV2';
  readonly field: ReturnType<JointTransientControlFieldV2['snapshot']>;
  readonly workspace: ControlWorkspaceSnapshotV2;
  readonly habits: ReturnType<ControlHabitWeightsV1['exportCheckpoint']>;
  readonly lastDecision: JointControlDecisionV2 | null;
  readonly attentionDrive: number;
  readonly recentDispatches: readonly { readonly operation: JointControlOperationV2; readonly nodeId: string }[];
}

const zeroDrives = (): JointControlDrivesV2 => ({ goal: 0, evidence: 0, condition: 0, rollout: 0,
  unknown: 0, attention: 0, novelty: 0, habit: 0 });
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const pseudoGoal = (id: string): GroundedGoalV1 => ({ version: 'GroundedGoalV1', id,
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: `${id}:open-ended`,
    subject: { kind: 'self' }, observable: 'visible', comparator: 'equals', target: false } } });

/** Fair admission into the finite transient workspace; this never scores an action. */
export function fairEvidenceWindowV2<T>(values: readonly T[], capacity: number, rotation: number,
  identity: (value: T) => string): { readonly selected: readonly T[]; readonly nextRotation: number } {
  assert(Number.isInteger(capacity) && capacity > 0 && Number.isInteger(rotation) && rotation >= 0,
    'invalid-joint-control-evidence-window');
  if (values.length <= capacity) return { selected: [...values], nextRotation: rotation };
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = identity(value), group = groups.get(key) ?? [];
    group.push(value); groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
  const groupOffset = rotation % ordered.length, withinOffset = Math.floor(rotation / ordered.length);
  const selected: T[] = [];
  for (let round = 0; selected.length < capacity && round < values.length; round++) {
    let added = false;
    for (let offset = 0; offset < ordered.length && selected.length < capacity; offset++) {
      const group = ordered[(groupOffset + offset) % ordered.length]![1];
      if (round >= group.length) continue;
      selected.push(group[(withinOffset + round) % group.length]!); added = true;
    }
    if (!added) break;
  }
  return { selected, nextRotation: rotation + Math.max(1, Math.ceil(capacity / ordered.length)) };
}

/** Finite workspace admission must never contain only blind exploration while
 * goal-grounded physical work is available.  One rotating grounded anchor is
 * reserved; every remaining slot is still filled by the ordinary fair window,
 * so this admits evidence without choosing an operation or action winner. */
export function fairGroundedControlWindowV2<T>(values: readonly T[], capacity: number, rotation: number,
  identity: (value: T) => string, isGrounded: (value: T) => boolean):
  { readonly selected: readonly T[]; readonly nextRotation: number } {
  assert(Number.isInteger(capacity) && capacity > 0 && Number.isInteger(rotation) && rotation >= 0,
    'invalid-grounded-control-window');
  if (values.length <= capacity || !values.some(isGrounded))
    return fairEvidenceWindowV2(values, capacity, rotation, identity);
  const indexed = values.map((value, index) => ({ value, index }));
  const grounded = fairEvidenceWindowV2(indexed.filter(entry => isGrounded(entry.value)), 1, rotation,
    entry => identity(entry.value));
  const anchor = grounded.selected[0]!;
  if (capacity === 1) return { selected: [anchor.value], nextRotation: grounded.nextRotation };
  const remainder = fairEvidenceWindowV2(indexed.filter(entry => entry.index !== anchor.index), capacity - 1,
    grounded.nextRotation, entry => identity(entry.value));
  return { selected: [anchor.value, ...remainder.selected.map(entry => entry.value)],
    nextRotation: remainder.nextRotation };
}

/** Blind exploration is pressure for the absence of usable goal-grounded work,
 * not a permanent competitor to evidence that is still being compared or
 * predicted.  Keep the transient sites themselves (and their activation), but
 * remove only their unknown/novelty input while any grounded physical operation
 * remains available.  When that work is exhausted the same sites regain their
 * ordinary inputs on the next control event. */
export function modulateBlindExplorationInputsV2(sites: readonly JointControlSiteInputV2[],
  groundedWorkAvailable: boolean): readonly JointControlSiteInputV2[] {
  if (!groundedWorkAvailable) return sites;
  return sites.map(site => site.drives.goal === 0 && site.drives.evidence === 0 && site.drives.rollout === 0
    ? { ...site, drives: { ...site.drives, unknown: 0, novelty: 0 } }
    : site);
}

/** A goal-grounded operation is productive only when it is a real outstanding
 * effect/requirement query or has a complete production physical binding.  A
 * merely provisional R2A/factor node must not suppress the exploration needed
 * to obtain its missing evidence. */
export function productiveGoalControlSiteV2(site: JointControlSiteInputV2): boolean {
  if (!site.hardEligible || site.drives.goal <= 0) return false;
  const grounding = site.productiveGrounding;
  if (!grounding || grounding.kind === 'none') return false;
  if (grounding.kind === 'outstanding-effect-query')
    return site.operation === 'recall-effect' && grounding.goalNodeId === site.nodeId;
  return grounding.kind === 'physical-branch' && site.operation !== 'recall-effect'
    && grounding.evidence.some(hasProductionPhysicalRepresentationV2);
}

interface DispatchRecord { readonly operation: JointControlOperationV2; readonly nodeId: string }

type SingleCondition = NonNullable<ConditionApplicabilityV1['memberResults']>[number]['value'];
type SinglePrediction = NonNullable<BranchPredictionV1['memberResults']>[number]['value'];

export const G5_EXECUTION_MINIMUM_VALID_SAMPLES_V1 = 8;
export const G5_EXECUTION_MINIMUM_PROGRESS_RATE_V1 = .75;

function executionSampleProgressRateV1(prediction: Pick<SinglePrediction,
  'validSampleCount' | 'progressSampleCount'>): number {
  if (!Number.isInteger(prediction.validSampleCount) || prediction.validSampleCount <= 0
    || !Number.isInteger(prediction.progressSampleCount) || prediction.progressSampleCount < 0
    || prediction.progressSampleCount > prediction.validSampleCount) return 0;
  return prediction.progressSampleCount / prediction.validSampleCount;
}

function predictionMeetsExecutionQualificationV1(prediction: SinglePrediction,
  evidence: PhysicalEvidenceReferenceV1, requireProgress: boolean): boolean {
  void evidence;
  return prediction.validSampleCount >= G5_EXECUTION_MINIMUM_VALID_SAMPLES_V1
    && (!requireProgress
      || executionSampleProgressRateV1(prediction) >= G5_EXECUTION_MINIMUM_PROGRESS_RATE_V1);
}

/** Select only a member whose own physical rollout satisfies the G5 execution
 * qualification. Aggregate summaries may never lend support to another member. */
export function selectQualifiedPredictionMemberV1(
  candidates: readonly EffectRecallCandidateV1[],
  memberResults: readonly NonNullable<BranchPredictionV1['memberResults']>[number][],
): NonNullable<BranchPredictionV1['memberResults']>[number] | null {
  return memberResults.filter(member => {
    const candidate = candidates.find(value => value.candidateId === member.candidateId);
    if (!candidate) return false;
    const evidence = member.value.currentEvidence ?? candidate.evidence;
    return evidence.r1.active && evidence.r2.active && evidence.r2a.productionEligible
      && predictionMeetsExecutionQualificationV1(member.value, evidence, true);
  }).sort((left, right) => executionSampleProgressRateV1(right.value)
    - executionSampleProgressRateV1(left.value)
    || right.value.validSampleCount - left.value.validSampleCount
    || (right.value.currentEvidence?.r2a.applicability ?? 0)
      - (left.value.currentEvidence?.r2a.applicability ?? 0)
    || left.candidateId.localeCompare(right.candidateId, 'en'))[0] ?? null;
}

const conditionMember = (condition: ConditionApplicabilityV1 | null, candidateId: string,
  singleton: boolean): SingleCondition | null => condition?.memberResults
    ? condition.memberResults.find(member => member.candidateId === candidateId)?.value ?? null
    : singleton && condition ? condition : null;
const predictionMember = (prediction: BranchPredictionV1 | null, candidateId: string,
  singleton: boolean): SinglePrediction | null => prediction?.memberResults
    ? prediction.memberResults.find(member => member.candidateId === candidateId)?.value ?? null
    : singleton && prediction ? prediction : null;
export const desiredFactorProgressFractionV2 = (
  prediction: Pick<BranchPredictionV1, 'nextStates' | 'progressFraction' | 'progressBasis'>,
  desiredFactors: readonly string[],
): number => {
  // A projected parent-relation score is already the complete conjunction
  // read from R2A.  Re-inspecting its individual factor arrays here would
  // silently weaken it back to the former "any changed factor" criterion.
  if (prediction.progressBasis === 'parent-R2A-relation-complete') return prediction.progressFraction;
  if (desiredFactors.length === 0) return prediction.progressFraction;
  if (prediction.nextStates.length === 0) return 0;
  return prediction.nextStates.filter(state => desiredFactors.some(id => state.knownActiveFactorIds.includes(id))).length
    / prediction.nextStates.length;
};

export function scoreDesiredFactorProgressV2(
  prediction: BranchPredictionV1, desiredFactors: readonly string[],
): BranchPredictionV1 {
  if (desiredFactors.length === 0) return prediction;
  const progressSampleCount = prediction.nextStates.filter(state => desiredFactors.some(id =>
    state.knownActiveFactorIds.includes(id))).length;
  return { ...prediction, progressSampleCount,
    progressFraction: prediction.nextStates.length ? progressSampleCount / prediction.nextStates.length : 0 };
}

/** Score a transition rollout only by whether each simulated state restores
 * one complete, currently production-eligible parent R2A relation.  The
 * physical reasoning port performs the factor conjunction; this function is
 * deliberately ignorant of factor names and cannot turn a partial match into
 * progress. */
export function scoreProjectedParentRelationProgressV1(
  prediction: BranchPredictionV1,
  projected: readonly ProjectedParentRelationApplicabilityV1[],
): BranchPredictionV1 {
  assert(projected.length === prediction.nextStates.length,
    'projected-parent-relation-result-count-mismatch');
  const progressSampleCount = projected.filter(value => value.selectedRelationId !== null
    && value.productionEligible && value.applicability > 0
    && value.contradictedFactorIds.length === 0 && value.unknownFactorIds.length === 0).length;
  return { ...prediction, progressSampleCount,
    progressFraction: prediction.nextStates.length ? progressSampleCount / prediction.nextStates.length : 0,
    progressBasis: 'parent-R2A-relation-complete' };
}

/** Resolve the complete physical parent relations of one transition node.
 * Dependencies contain no semantic action ordering: they only bind the real
 * parent branches which requested this opaque transition. */
export function projectedParentRelationIdsV1(nodeId: string,
  workspace: ControlWorkspaceSnapshotV2): readonly string[] {
  const parentIds = new Set(workspace.dependencies
    .filter(edge => edge.kind === 'opaque-factor' && edge.requiredNodeId === nodeId)
    .map(edge => edge.dependentNodeId));
  return [...new Set(workspace.nodes.flatMap(node => {
    if (!parentIds.has(node.node.nodeId)) return [];
    if (node.node.kind === 'experienced') return (node.node.candidateMembers ?? [node.node.candidate])
      .flatMap(candidate => candidate.evidence.r2a.relationIds);
    // Recursive condition expansion makes a transition branch the dependent
    // parent of another transition.  Its retained real transition events are
    // the physical candidates whose complete relations must be restored.
    if (node.node.kind === 'factor-transition') return (node.node.transitionMembers ?? [node.node.transition])
      .flatMap(transition => transition.evidence.r2a.relationIds);
    return [];
  }))].sort((left, right) => left.localeCompare(right, 'en'));
}

export function factorTransitionCandidateForControlV2(
  transition: OpaqueFactorTransitionTraceV1, desiredFactors: readonly string[],
): EffectRecallCandidateV1 {
  return { candidateId: transition.transitionId, goalPredicateIds: [], actionCue: transition.actionCue,
    observedChanges: [], observedBefore: {}, evidence: transition.evidence,
    unknown: [`opaque-factor-transition:${desiredFactors.join('+')}:observed-co-occurrence-not-causal-proof`] };
}

/** Existential hard gate over the original physical members. No aggregate
 * average can turn a failing event into an executable one. */
export function selectExecutablePhysicalMemberV1(candidates: readonly EffectRecallCandidateV1[],
  condition: ConditionApplicabilityV1 | null, prediction: BranchPredictionV1 | null,
  desiredFactors: readonly string[], requirePositiveProgress = true): { readonly candidate: EffectRecallCandidateV1;
    readonly condition: SingleCondition; readonly prediction: SinglePrediction; readonly progress: number } | null {
  const singleton = candidates.length === 1;
  return candidates.flatMap(candidate => {
    const candidateCondition = conditionMember(condition, candidate.candidateId, singleton);
    const candidatePrediction = predictionMember(prediction, candidate.candidateId, singleton);
    if (!candidateCondition || !candidatePrediction) return [];
    const evidence = candidatePrediction.currentEvidence ?? candidate.evidence;
    const factorProgress = desiredFactorProgressFractionV2(candidatePrediction, desiredFactors);
    const sampleProgress = executionSampleProgressRateV1(candidatePrediction);
    const progress = desiredFactors.length === 0 ? sampleProgress : Math.min(factorProgress, sampleProgress);
    if (!candidateCondition.productionEligible || candidateCondition.applicability <= 0
      || candidateCondition.unknownFactorIds.length > 0 || candidateCondition.contradictedFactorIds.length > 0
      || !evidence.r1.active || !evidence.r2.active || !evidence.r2a.productionEligible
      || !predictionMeetsExecutionQualificationV1(candidatePrediction, evidence, requirePositiveProgress)
      || (requirePositiveProgress && progress < G5_EXECUTION_MINIMUM_PROGRESS_RATE_V1)) return [];
    return [{ candidate, condition: candidateCondition, prediction: candidatePrediction, progress }];
  }).sort((left, right) => right.progress - left.progress
    || right.condition.applicability - left.condition.applicability
    || right.prediction.validSampleCount - left.prediction.validSampleCount
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId, 'en'))[0] ?? null;
}

export function dependencyEdgeSatisfiedV2(edge: ControlWorkspaceSnapshotV2['dependencies'][number],
  condition: ReturnType<ControlWorkspaceV2['currentCondition']>): boolean {
  if (!condition || edge.factorIds.length === 0) return false;
  const values = condition.memberResults?.map(member => member.value) ?? [condition];
  return values.some(value => value.productionEligible
    && edge.factorIds.every(factorId => new Set(value.matchedFactorIds).has(factorId)));
}

/** Only a complete, currently active production representation can replace
 * the body's generic exploration copy of the same exact cue.  Applicability is
 * deliberately not part of this identity gate: a stable but conflicting R2A
 * relation must remain a known condition constraint, not be bypassed as blind
 * exploration. */
export function hasProductionPhysicalRepresentationV2(evidence: PhysicalEvidenceReferenceV1): boolean {
  return evidence.r1.active && evidence.r2.active && evidence.r2a.active
    && evidence.r2a.productionEligible;
}

/**
 * Return the physical substrate binding of a recalled branch, independently
 * of whether the branch currently applies to the observed factors.  R2A's
 * `active`/`supportStrength` fields are intentionally current-branch
 * readouts: the distributed memory sets them to zero when the present
 * condition is missing or conflicting.  Using those fields as the existence
 * gate for a condition query made a real, physically retained branch look as
 * if it had no substrate at all, so the controller could only explore and
 * never ask R2A which factor was missing.
 *
 * The binding therefore uses only live lower-layer support and a live R2A
 * physical footprint.  It does not grant action execution: the execution
 * selector below still requires current applicability, a production relation
 * and a qualified PredictionClone rollout.
 */
export function physicalEvidenceBindingV2(evidence: PhysicalEvidenceReferenceV1): number {
  const r1 = evidence.r1.active && evidence.r1.footprintTraceIds.length > 0
    ? Math.max(0, Math.min(1, evidence.r1.supportStrength)) : 0;
  const r2 = evidence.r2.active && evidence.r2.footprintTraceIds.length > 0
    ? Math.max(0, Math.min(1, evidence.r2.supportStrength)) : 0;
  const r2a = evidence.r2a.footprintTraceIds.length > 0 && evidence.r2a.relationIds.length > 0
    && evidence.r2a.evidenceGrade !== 'single-observation' ? 1 : 0;
  return Math.min(r1, r2, r2a);
}

/**
 * Derive one public intermediate state only from a real transition which was
 * recalled for an exact public-property goal.  This is not a semantic rule and
 * does not claim that the historical before-value caused the result: it says
 * only that every currently usable physical member which actually reached the
 * requested value was observed to start from the same public value.
 *
 * A disagreement between members, an unavailable current value, or a member
 * already matching its real before-value leaves the requirement unknown rather
 * than guessing a subgoal.  Numeric ordering and Minecraft property names are
 * deliberately absent from this operation.
 */
export function historicalTransitionPreconditionV1(candidates: readonly EffectRecallCandidateV1[],
  objective: GroundedGoalV1, observation: Observation): GroundedGoalV1 | null {
  if (candidates.length === 0) return null;
  const predicates = new Map(goalPredicates(objective).map(predicate => [predicate.id, predicate]));
  type RequirementPart = { readonly predicateId: string; readonly observable: `properties.${string}`;
    readonly subject: { readonly kind: 'public-object'; readonly id: string; readonly expectedType: string };
    readonly before: PublicValue };
  const requirements: RequirementPart[] = [];
  for (const candidate of candidates) {
    const memberRequirements: RequirementPart[] = [];
    let alreadyAtHistoricalBefore = false;
    for (const predicateId of candidate.goalPredicateIds) {
      const predicate = predicates.get(predicateId);
      if (!predicate || predicate.comparator !== 'equals' || predicate.subject.kind !== 'public-object'
        || !predicate.observable.startsWith('properties.')) continue;
      const property = predicate.observable.slice('properties.'.length);
      const current = groundedPublicObservableV1(predicate, observation);
      if (current === undefined) continue;
      const transitions = candidate.observedChanges.filter(change => change.property === property
        && Object.is(change.after, predicate.target));
      if (transitions.some(change => Object.is(current, change.before))) {
        alreadyAtHistoricalBefore = true; break;
      }
      const beforeValues: PublicValue[] = [...new Map(transitions.map(change =>
        [JSON.stringify(change.before), change.before] as const)).values()];
      if (beforeValues.length !== 1) continue;
      memberRequirements.push({ predicateId, observable: predicate.observable as `properties.${string}`,
        subject: predicate.subject, before: beforeValues[0]! });
    }
    if (alreadyAtHistoricalBefore) return null;
    if (memberRequirements.length !== 1) return null;
    requirements.push(memberRequirements[0]!);
  }
  const identities = new Set(requirements.map(value => JSON.stringify({ predicateId: value.predicateId,
    observable: value.observable, subject: value.subject, before: value.before })));
  if (identities.size !== 1) return null;
  const requirement = requirements[0]!;
  const identity = sha({ objectiveId: objective.id, predicateId: requirement.predicateId,
    subject: requirement.subject, observable: requirement.observable, before: requirement.before });
  return { version: 'GroundedGoalV1', id: `historical-transition-precondition:${identity}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1',
      id: `historical-transition-precondition:${requirement.predicateId}:${identity}`,
      subject: structuredClone(requirement.subject), observable: requirement.observable,
      comparator: 'equals', target: requirement.before } } };
}

/** Shortest dependency distance to any top-level branch. Sorting makes the
 * answer independent of edge insertion order when a node has several parents. */
export function dependencyDepthV2(nodeId: string,
  dependencies: ControlWorkspaceSnapshotV2['dependencies']): number {
  let frontier = [nodeId]; const visited = new Set<string>(); let depth = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const current of [...frontier].sort((left, right) => left.localeCompare(right, 'en'))) {
      if (visited.has(current)) continue; visited.add(current);
      const parents = dependencies.filter(edge => edge.requiredNodeId === current)
        .map(edge => edge.dependentNodeId).sort((left, right) => left.localeCompare(right, 'en'));
      if (parents.length === 0) return depth;
      next.push(...parents);
    }
    frontier = [...new Set(next)]; depth++;
  }
  return 0;
}

const publicValueAt = (observation: Observation, change: PublicChange): PublicValue | undefined => {
  if (change.subject === 'self') {
    if (change.property === 'yaw') return observation.self.yaw;
    if (change.property === 'pitch') return observation.self.pitch;
    if (change.property.startsWith('displacement.')) return observation.self.position[Number(change.property.at(-1))];
    return observation.self.properties[change.property];
  }
  if (change.subject === 'crosshair') {
    const target = observation.objects.find(object => object.id === observation.targetId);
    if (change.property === 'visible') return target !== undefined;
    if (change.property === 'type') return target?.type ?? null;
    return undefined;
  }
  const direct = observation.objects.find(object => object.id === change.subject);
  const match = /^(.*)#(\d+)$/.exec(change.subject);
  const typed = match ? [...observation.objects].filter(object => object.type === match[1])
    .sort((left, right) => Math.hypot(...left.relativePosition) - Math.hypot(...right.relativePosition))[Number(match[2])] : null;
  const subject = direct ?? typed;
  if (!subject) return change.property === 'visible' ? false : undefined;
  if (change.property === 'visible') return true;
  if (change.property.startsWith('displacement.')) return subject.relativePosition[Number(change.property.at(-1))];
  return subject.properties[change.property];
};

const oppositeChange = (prediction: PublicChange, actualBefore: PublicValue,
  actualAfter: PublicValue): boolean => {
  if (actualBefore === actualAfter) return false;
  if (typeof prediction.before === 'number' && typeof prediction.after === 'number'
    && typeof actualBefore === 'number' && typeof actualAfter === 'number')
    return (prediction.after - prediction.before) * (actualAfter - actualBefore) < 0;
  return actualBefore === prediction.after && actualAfter === prediction.before;
};

/** Habit punishment requires a comparable, explicitly opposite real change.
 * A goal residual that merely failed to fall is not evidence of prediction error. */
export function explicitPredictionViolationV2(prediction: BranchPredictionV1 | null,
  before: Observation, after: Observation): TrustedRealActionOutcomeV1['predictionViolation'] {
  if (!prediction || prediction.prediction.support < .5) return null;
  const predicted = prediction.nextStates.flatMap(state => state.knownChanges);
  let comparable = 0, opposite = 0;
  for (const change of predicted) {
    const actualBefore = publicValueAt(before, change), actualAfter = publicValueAt(after, change);
    if (actualBefore === undefined || actualAfter === undefined || actualBefore === actualAfter) continue;
    comparable++;
    if (oppositeChange(change, actualBefore, actualAfter)) opposite++;
  }
  if (comparable === 0 || opposite === 0) return null;
  return { matched: true, highSupport: true, deviation: opposite / comparable };
}

/** Thin coupling: one global operation-by-node competition, then one mechanical port call. */
export class PhysicalControlManagerV2 {
  readonly field: JointTransientControlFieldV2;
  readonly workspace = new ControlWorkspaceV2();
  readonly habit: ControlHabitWeightsV1;
  readonly #goalEvaluator = new GroundedGoalEvaluatorV1();
  readonly #useInhibition = new Map<string, number>();
  readonly #dispatchHistory: DispatchRecord[] = [];
  #rotation = 0;
  #requestNumber = 0;
  #attentionDrive = 0;
  #lastDecision: JointControlDecisionV2 | null = null;
  #lastSnapshot: PhysicalControlSnapshotV2 | null = null;
  #goalActive = false;
  #runInProgress = false;
  #queuedAttention: AttentionNotice[] = [];

  constructor(readonly reasoning: PhysicalReasoningPortV2, readonly environment: PhysicalControlEnvironmentV2,
    readonly config: JointTransientControlFieldConfigV2, habit = new ControlHabitWeightsV1(),
    readonly options: { readonly requirePredictionProgress?: boolean } = {}) {
    this.field = new JointTransientControlFieldV2(config); this.habit = habit;
    this.habit.beginNewControlEpisode();
  }

  get snapshot(): PhysicalControlSnapshotV2 | null {
    return this.#lastSnapshot ? structuredClone(this.#lastSnapshot) : null;
  }

  interrupt(notice: AttentionNotice): void {
    this.#attentionDrive = 1;
    if (this.#goalActive) this.workspace.ingest({ kind: 'attention', notice });
    else this.#queuedAttention.push(structuredClone(notice));
    this.field.interrupt();
    this.environment.record('joint-control-attention', { notice, retainedDependencyGraph: this.#goalActive });
  }

  async initializeFromRealExploration(): Promise<PhysicalControlResultV2> {
    return this.#run(pseudoGoal('physical-initialization'), 'initialization');
  }
  async exploreUntil(stopCondition: (observation: Observation) => boolean): Promise<PhysicalControlResultV2> {
    return this.#run(pseudoGoal('open-ended-physical-exploration'), 'exploration', stopCondition);
  }
  async runGoal(goal: GroundedGoalV1): Promise<PhysicalControlResultV2> { return this.#run(goal, 'goal'); }

  async #run(goal: GroundedGoalV1, mode: 'initialization' | 'exploration' | 'goal',
    stopCondition?: (observation: Observation) => boolean): Promise<PhysicalControlResultV2> {
    assert(!this.#runInProgress, 'physical-control-run-already-in-progress');
    this.#runInProgress = true;
    let cycles = 0, firstSatisfiedSequence: number | null = null;
    try {
      let observation = await this.environment.observe();
      this.#goalEvaluator.setGoal(goal, observation); this.workspace.setGoal(goal); this.field.setGoal(goal.id);
      this.#goalActive = true; this.#dispatchHistory.length = 0; this.habit.beginNewControlEpisode();
      for (const notice of this.#queuedAttention.splice(0)) this.workspace.ingest({ kind: 'attention', notice });
      while (true) {
        const evaluation = this.#goalEvaluator.evaluate(observation), status = await this.environment.status();
        const currentWorkspace = this.workspace.snapshot();
        if (currentWorkspace.observationSequence !== observation.sequence || currentWorkspace.goalEvaluation === null)
          this.#ingestObservation(observation, evaluation);
        this.field.setGoalEvaluation(evaluation);
        this.environment.record('goal-difference', evaluation);
        if (mode === 'initialization' && status.ready) return this.#result('initialization-complete', cycles, null);
        if (mode === 'exploration' && stopCondition?.(observation))
          return this.#result('exploration-stop-condition-met', cycles, null);

        const isRealGoal = mode === 'goal';
        if (isRealGoal && evaluation.status === 'satisfied') firstSatisfiedSequence ??= observation.sequence;
        else firstSatisfiedSequence = null;

        const budgetExhausted = this.environment.actionCount >= this.environment.actionBudget;
        let sites = status.ready && isRealGoal
          ? this.#reasoningAndActionSites(observation, evaluation, !budgetExhausted)
          : this.#explorationSites(observation, evaluation, true)
            .filter(site => !budgetExhausted || (site.operation !== 'execute' && site.operation !== 'observe-public'));
        const queryAvailable = sites.some(site => site.hardEligible && (site.operation === 'recall-effect'
          || site.operation === 'compare-condition' || site.operation === 'predict-branch'
          || site.operation === 'expand-condition'));
        sites = this.#mergeSites([...sites, ...this.#terminalSites(observation, evaluation, isRealGoal,
          firstSatisfiedSequence, budgetExhausted, queryAvailable)]);
        const decision = this.#choose(sites); cycles++;
        if (!decision.converged) {
          this.environment.record('joint-control-awaiting-new-event', {
            observationSequence: observation.sequence, epoch: this.workspace.snapshot().epoch,
            reason: decision.reason,
          });
          observation = await this.environment.waitForObservationAfter(observation.sequence);
          continue;
        }
        if (decision.operation === 'finish-verified') return this.#result('goal-verified', cycles, evaluation);
        if (decision.operation === 'finish-unknown') return this.#result(mode === 'initialization'
          ? 'initialization-budget-exhausted' : mode === 'exploration' ? 'exploration-budget-exhausted'
            : 'current-experience-and-budget-exhausted', cycles, isRealGoal ? evaluation : null);
        const dispatchEpoch = this.workspace.snapshot().epoch;
        await this.#dispatch(decision, goal, evaluation, observation);
        // A reasoning chain is evaluated against one sealed public frame. Raw
        // Minecraft ticks may continue while the worker runs, but they do not
        // silently invalidate compare -> predict -> execute before the model
        // gets a control decision.  Body results and attention are real state
        // boundaries, so both force a new public frame before the next site.
        if (decision.operation === 'execute' || decision.operation === 'observe-public')
          this.field.crossRealityBoundary();
        if (decision.operation === 'execute' || decision.operation === 'observe-public'
          || this.workspace.snapshot().epoch !== dispatchEpoch)
          observation = await this.environment.observe();
        this.#attentionDrive *= .5;
        if (this.#attentionDrive < .01) { this.#attentionDrive = 0; this.field.clearInterrupt(); }
      }
    } finally { this.#goalActive = false; this.#runInProgress = false; }
  }

  #ingestObservation(observation: Observation, evaluation: GoalEvaluationV1): void {
    const snapshot = this.workspace.snapshot();
    if (snapshot.observationSequence !== null && observation.sequence <= snapshot.observationSequence) return;
    const offers = this.environment.listActionOffers(observation);
    const result = this.workspace.ingest({ kind: 'observation', observation, offers, goalEvaluation: evaluation });
    assert(result.accepted, `control-observation-rejected:${result.reason}`);
    const window = fairEvidenceWindowV2(offers, Math.max(1, this.config.branchCapacity - 1), this.#rotation,
      value => cueIdentity(value.cue)); this.#rotation = window.nextRotation;
    for (const offer of window.selected) this.workspace.registerExploration(offer);
  }

  #terminalSites(observation: Observation, evaluation: GoalEvaluationV1, isRealGoal: boolean,
    firstSatisfiedSequence: number | null, budgetExhausted: boolean,
    queryAvailable: boolean): JointControlSiteInputV2[] {
    const root = this.workspace.snapshot().rootNodeId!;
    const sites: JointControlSiteInputV2[] = [];
    if (isRealGoal && evaluation.status === 'satisfied' && firstSatisfiedSequence !== null) {
      const verified = observation.sequence - firstSatisfiedSequence >= this.config.goalVerificationTicks;
      if (verified) sites.push(this.#site('finish-verified', root, true,
        { goal: 1, evidence: 1, attention: this.#attentionDrive }));
      else if (!budgetExhausted) {
        const offer = this.environment.listActionOffers(observation)
          .find(value => value.action.kind === 'observe' && value.action.parameters.ticks === 5);
        if (offer) {
          const nodeId = this.workspace.registerExploration(offer);
          sites.push(this.#site('observe-public', nodeId, true,
            { goal: 1, unknown: 1, attention: this.#attentionDrive, novelty: 1 }));
        }
      }
    }
    if (budgetExhausted) {
      if (!queryAvailable) sites.push(this.#site('finish-unknown', root, true,
        { goal: evaluation.residual, unknown: 1, evidence: 1 }));
    }
    return sites;
  }

  #mergeSites(sites: readonly JointControlSiteInputV2[]): JointControlSiteInputV2[] {
    const merged = new Map<string, JointControlSiteInputV2>();
    for (const site of sites) {
      const prior = merged.get(site.siteId);
      if (!prior) { merged.set(site.siteId, site); continue; }
      const drives: JointControlDrivesV2 = {
        goal: Math.max(site.drives.goal, prior.drives.goal),
        evidence: Math.max(site.drives.evidence, prior.drives.evidence),
        condition: Math.max(site.drives.condition, prior.drives.condition),
        rollout: Math.max(site.drives.rollout, prior.drives.rollout),
        unknown: Math.max(site.drives.unknown, prior.drives.unknown),
        attention: Math.max(site.drives.attention, prior.drives.attention),
        novelty: Math.max(site.drives.novelty, prior.drives.novelty),
        habit: Math.max(site.drives.habit, prior.drives.habit),
      };
      const productiveGrounding = site.productiveGrounding?.kind !== 'none'
        ? site.productiveGrounding : prior.productiveGrounding;
      merged.set(site.siteId, { ...site, hardEligible: site.hardEligible || prior.hardEligible,
        ...(productiveGrounding ? { productiveGrounding } : {}), drives });
    }
    return [...merged.values()];
  }

  #reasoningAndActionSites(observation: Observation, evaluation: GoalEvaluationV1,
    allowBodyOperations: boolean): JointControlSiteInputV2[] {
    this.#synchronizePublicRequirements(observation);
    this.#synchronizeHistoricalTransitionRequirements(observation);
    const snapshot = this.workspace.snapshot(), root = snapshot.rootNodeId!;
    const rootSites: JointControlSiteInputV2[] = [];
    if (!this.workspace.hasCompleted('recall-effect', root, { currentEpoch: true }))
      rootSites.push(this.#site('recall-effect', root, true, { goal: evaluation.residual,
        unknown: snapshot.nodes.some(value => value.node.kind === 'experienced') ? .25 : 1,
        attention: this.#attentionDrive, evidence: .2 },
      { kind: 'outstanding-effect-query', goalNodeId: root }));
    const experienced = snapshot.nodes.filter(value => value.node.kind === 'experienced'
      || value.node.kind === 'factor-transition');
    const publicRequirements = snapshot.nodes.filter(value => value.node.kind === 'public-requirement');
    // A production-qualified physical branch already represents this exact
    // cue, so a second exploration copy would bypass its condition and rollout
    // gates.  R1/R2-only or provisional R2A history is not production evidence:
    // it may guide a query, but it must not erase the body's still-legal chance
    // to explore the cue and obtain the missing real condition evidence.
    const physicallyRepresentedCues = new Set(experienced.filter(value => {
      return this.#candidates(value, snapshot).some(candidate => hasProductionPhysicalRepresentationV2(candidate.evidence));
    }).map(value => this.#nodeCueIdentity(value)));
    const exploration = snapshot.nodes.filter(value => value.node.kind === 'exploration'
      && value.node.offer.observationSequence === observation.sequence
      && !physicallyRepresentedCues.has(this.#nodeCueIdentity(value)));
    const all = [...publicRequirements, ...experienced, ...exploration];
    const active = all.map(node => ({ node, sites: this.#sitesForNode(node, snapshot, observation, evaluation)
      .filter(site => allowBodyOperations || (site.operation !== 'execute' && site.operation !== 'observe-public')) }))
      .filter(value => value.sites.some(site => site.hardEligible
        && Object.values(site.drives).some(drive => drive > 0)));
    const groundedWorkAvailable = rootSites.some(productiveGoalControlSiteV2)
      || active.some(value => value.node.node.kind !== 'exploration'
        && value.sites.some(productiveGoalControlSiteV2));
    const modulated = active.map(value => value.node.node.kind === 'exploration'
      ? { ...value, sites: modulateBlindExplorationInputsV2(value.sites, groundedWorkAvailable) }
      : value);
    // Keep one transient slot for an observation/verification event that may be
    // admitted later in this same global competition.  The remaining nodes are
    // still selected only by fair rotation; this reserve does not score or pick
    // an operation, branch, or action.
    const capacity = Math.max(1, this.config.branchCapacity - (rootSites.length ? 1 : 0) - 1);
    const window = fairGroundedControlWindowV2(modulated, capacity, this.#rotation,
      value => this.#nodeCueIdentity(value.node), value => value.node.node.kind !== 'exploration'
        && value.sites.some(productiveGoalControlSiteV2));
    this.#rotation = window.nextRotation;
    const sites = [...rootSites];
    for (const value of window.selected) sites.push(...value.sites);
    return sites;
  }

  #sitesForNode(node: ControlWorkspaceNodeSnapshotV2, workspace: ControlWorkspaceSnapshotV2,
    observation: Observation, evaluation: GoalEvaluationV1): JointControlSiteInputV2[] {
    if (node.node.kind === 'exploration') {
      const current = this.#rebindOffer(node.node.offer, observation); if (!current) return [];
      return [this.#site(current.action.kind === 'observe' || current.action.kind === 'wait'
        ? 'observe-public' : 'execute', node.node.nodeId, true,
      { unknown: 1, novelty: this.#novelty(current), attention: this.#attentionDrive })];
    }
    if (node.node.kind === 'public-requirement') {
      const requirementEvaluation = this.#evaluateGoal(node.node.goal, observation);
      if (requirementEvaluation.status === 'satisfied') return [];
      if (this.workspace.hasCompleted('recall-effect', node.node.nodeId, { currentEpoch: true })) return [];
      return [this.#site('recall-effect', node.node.nodeId, true, {
        goal: requirementEvaluation.residual, evidence: .2, unknown: 1, attention: this.#attentionDrive,
      }, { kind: 'outstanding-effect-query', goalNodeId: node.node.nodeId })];
    }
    const incomingDependencies = workspace.dependencies.filter(edge => edge.requiredNodeId === node.node.nodeId);
    // A requirement-changing branch stops consuming reasoning capacity once
    // every parent which needs it is already true in current reality. Shared
    // branches remain active while even one parent still needs them.
    const dependencyFulfilled = incomingDependencies.length > 0
      && incomingDependencies.every(edge => edge.kind === 'opaque-factor'
        ? dependencyEdgeSatisfiedV2(edge, this.workspace.currentCondition(edge.dependentNodeId))
        : edge.kind === 'public-requirement-candidate'
          ? this.#publicRequirementSatisfied(edge.dependentNodeId, workspace, observation) : false);
    if (dependencyFulfilled) return [];
    const candidates = this.#candidates(node, workspace);
    const candidate = candidates[0]!;
    const condition = this.workspace.currentCondition(node.node.nodeId);
    const prediction = this.workspace.currentPrediction(node.node.nodeId);
    const continuations = this.workspace.currentContinuationPredictions(node.node.nodeId);
    const currentEvidence = candidates.map(member =>
      predictionMember(prediction, member.candidateId, candidates.length === 1)?.currentEvidence ?? member.evidence);
    const binding = Math.max(...currentEvidence.map(evidence => physicalEvidenceBindingV2(evidence)));
    const physicalGrounding: NonNullable<JointControlSiteInputV2['productiveGrounding']> = {
      kind: 'physical-branch', evidence: currentEvidence,
    };
    const factors = this.#conditionFactors(condition);
    const desiredFactors = this.#desiredFactors(node.node.nodeId, workspace);
    const depthGoal = this.#nodeGoalDrive(node.node.nodeId, workspace, evaluation.residual);
    const requirement = candidate.actionCue.kind === 'passive' ? null
      : this.environment.describeActionRequirement(candidate.actionCue, observation);
    if (requirement && !requirement.satisfied) this.environment.record('control-public-action-requirement', {
      nodeId: node.node.nodeId, actionKind: candidate.actionCue.kind,
      observationSequence: observation.sequence, missing: requirement.missing,
    });
    const unknown = Math.max(condition
      ? clamp01(factors.length / Math.max(1, factors.length + condition.matchedFactorIds.length)) : .65,
    requirement && !requirement.satisfied ? 1 : 0);
    const sites: JointControlSiteInputV2[] = [];
    if (!condition) sites.push(this.#site('compare-condition', node.node.nodeId, binding > 0,
      { goal: depthGoal, evidence: binding, unknown, attention: this.#attentionDrive }, physicalGrounding));
    // A prediction needs a current R2A comparison.  With no comparison (or a
    // zero-applicability comparison) the physical port can only return the
    // same unsupported result; the live compare/expand sites must first be
    // allowed to expose the missing condition.  This is a material input
    // requirement, not a scripted operation order.
    if (!prediction && condition !== null && condition.applicability > 0) sites.push(this.#site('predict-branch', node.node.nodeId, binding > 0,
      { goal: depthGoal, evidence: binding, condition: condition?.applicability ?? .25,
        unknown, attention: this.#attentionDrive }, physicalGrounding));
    if (condition && factors.length > 0
      && !this.workspace.hasCompleted('expand-condition', node.node.nodeId, { currentEpoch: true }))
      sites.push(this.#site('expand-condition', node.node.nodeId, binding > 0,
        { goal: depthGoal, evidence: binding, condition: condition.applicability,
          unknown: 1, attention: this.#attentionDrive }, physicalGrounding));
    const winner = selectExecutablePhysicalMemberV1(candidates, condition, prediction, desiredFactors,
      this.options.requirePredictionProgress !== false);
    const continuationSupport = winner && continuations ? continuations
      .filter(item => item.candidateId === winner.candidate.candidateId)
      .reduce((maximum, item) => Math.max(maximum,
        item.value.evidenceGrade === 'predictive-stable' || item.value.evidenceGrade === 'causal-hypothesis'
          || item.value.evidenceGrade === 'intervention-supported' ? item.value.support : 0), 0) : 0;
    const offer = winner ? this.#offerForCandidate(node, winner.candidate, workspace, observation) : null;
    // Once a requirement-changing action has happened, reality must first re-test
    // the dependent branch. This is freshness of a graph edge, not a parent-stack
    // resume rule and not an action-order preference.
    const dependencyAwaitingRealityCheck = node.lastActionResult?.executed === true
      && workspace.dependencies.some(edge => edge.kind === 'opaque-factor' && edge.requiredNodeId === node.node.nodeId
        && this.workspace.currentCondition(edge.dependentNodeId) === null);
    if (offer && winner
      && requirement?.satisfied !== false && !dependencyAwaitingRealityCheck)
      sites.push(this.#site('execute', node.node.nodeId, true,
        { goal: depthGoal, evidence: binding, condition: winner.condition.applicability,
          rollout: Math.max(winner.progress, continuationSupport), unknown: 0, attention: this.#attentionDrive },
        physicalGrounding));
    return sites;
  }

  #explorationSites(observation: Observation, evaluation: GoalEvaluationV1, initialization: boolean): JointControlSiteInputV2[] {
    const offers = this.environment.listActionOffers(observation);
    const window = fairEvidenceWindowV2(offers, this.config.branchCapacity, this.#rotation,
      value => cueIdentity(value.cue)); this.#rotation = window.nextRotation;
    return window.selected.map(offer => {
      const nodeId = this.workspace.registerExploration(offer), observe = offer.action.kind === 'observe' || offer.action.kind === 'wait';
      return this.#site(observe ? 'observe-public' : 'execute', nodeId, true,
        { unknown: 1, novelty: this.#novelty(offer), attention: this.#attentionDrive });
    });
  }

  #site(operation: JointControlOperationV2, nodeId: string, hardEligible: boolean,
    drives: Partial<JointControlDrivesV2>,
    productiveGrounding: NonNullable<JointControlSiteInputV2['productiveGrounding']> = { kind: 'none' }): JointControlSiteInputV2 {
    const base = { ...zeroDrives(), ...drives };
    return { siteId: `${operation}:${nodeId}`, operation, nodeId, hardEligible,
      productiveGrounding, drives: { ...base, habit: this.#habitDrive(operation, nodeId) } };
  }

  #choose(sites: readonly JointControlSiteInputV2[]): JointControlDecisionV2 {
    this.field.replaceSites(sites); const decision = this.field.decide(); this.#lastDecision = decision;
    this.#lastSnapshot = { version: 'PhysicalControlSnapshotV2', field: this.field.snapshot(),
      workspace: this.workspace.snapshot(), habits: this.habit.exportCheckpoint(), lastDecision: decision,
      attentionDrive: this.#attentionDrive, recentDispatches: structuredClone(this.#dispatchHistory) };
    this.environment.record('joint-control-decision', this.#lastSnapshot); return decision;
  }

  async #dispatch(decision: JointControlDecisionV2, goal: GroundedGoalV1,
    evaluation: GoalEvaluationV1, observation: Observation): Promise<void> {
    assert(decision.converged && decision.nodeId && decision.operation !== 'unknown', 'cannot-dispatch-unknown-control-site');
    const operation = decision.operation, nodeId = decision.nodeId;
    const dispatchSequence = this.#recordDispatch(operation, nodeId);
    if (operation === 'finish-verified' || operation === 'finish-unknown') return;
    const workspace = this.workspace.snapshot();
    const node = workspace.nodes.find(value => value.node.nodeId === nodeId);
    assert(node, 'joint-control-selected-node-not-found');
    const requestId = `control-request-${++this.#requestNumber}`;

    if (operation === 'execute' || operation === 'observe-public') {
      const physicalMembers = node.node.kind === 'exploration' ? [] : this.#candidates(node, workspace);
      const winningMember = node.node.kind === 'exploration' ? null : selectExecutablePhysicalMemberV1(
        physicalMembers, node.condition?.fresh ? node.condition.value : null,
        node.prediction?.fresh ? node.prediction.value : null, this.#desiredFactors(nodeId, workspace),
        this.options.requirePredictionProgress !== false);
      const offer = node.node.kind === 'exploration' ? this.#rebindOffer(node.node.offer, observation)
        : winningMember ? this.#offerForCandidate(node, winningMember.candidate, workspace, observation) : null;
      if (!offer) {
        this.environment.record('control-action-reality-refusal', { nodeId, reason: 'offer-stale',
          observationSequence: observation.sequence }); return;
      }
      const request = this.workspace.beginRequest({ requestId, channel: 'body', operation, nodeId,
        baseSequence: observation.sequence });
      const beforeResidual = evaluation.residual;
      const selectedPrediction = winningMember?.prediction ?? null;
      const result = await this.environment.executeOffer(offer, this.#actionObservationScope(goal, workspace));
      const accepted = this.workspace.ingest({ kind: 'action-completed', requestId: request.requestId, nodeId,
        result: { executed: result.executed, observation: result.observation, result } });
      assert(accepted.accepted, `control-action-result-rejected:${accepted.reason}`);
      this.environment.record('control-action-result', { offer, result, workspace: accepted }); this.#markUsed(offer);
      if (result.executed && result.eventId) {
        const afterEvaluation = this.#goalEvaluator.evaluate(result.observation);
        const reduction = clamp01(beforeResidual - afterEvaluation.residual);
        if (this.environment.recordTrustedRuntimeGoalMeasurement)
          await this.environment.recordTrustedRuntimeGoalMeasurement(result.eventId,
            result.observation.activeSeconds, beforeResidual, afterEvaluation.residual);
        const outcome: TrustedRealActionOutcomeV1 = { source: 'trusted-real-executed-action', dispatchSequence,
          residualReduction: reduction,
          predictionViolation: explicitPredictionViolationV2(selectedPrediction, observation, result.observation) };
        if (this.environment.commitHabitOutcome) await this.environment.commitHabitOutcome(outcome);
        else this.habit.applyTrustedRealActionOutcome(outcome);
      }
      return;
    }

    const request = this.workspace.beginRequest({ requestId, channel: 'reasoning', operation, nodeId,
      baseSequence: observation.sequence, factorIds: operation === 'expand-condition'
        ? this.#missingFactors(nodeId) : undefined });
    try {
      if (operation === 'recall-effect') {
        const queryGoal = node.node.kind === 'root' || node.node.kind === 'public-requirement'
          ? node.node.goal : goal;
        const queryEvaluation = node.node.kind === 'public-requirement'
          ? this.#evaluateGoal(queryGoal, observation) : evaluation;
        const [atomicCandidates, continuousPatterns] = await Promise.all([
          this.reasoning.recallAtomicEffect(queryGoal, queryEvaluation, observation),
          this.reasoning.recallContinuousPattern(queryGoal, queryEvaluation, observation),
        ]);
        const result = { version: 'PhysicalRecallBundleV2' as const, atomicCandidates, continuousPatterns };
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      } else if (operation === 'compare-condition') {
        const result = await this.#compareCandidateGroup(this.#candidates(node, workspace), observation);
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      } else if (operation === 'predict-branch') {
        const predictionGoal = this.#objectiveGoal(node, workspace, goal);
        const predictionEvaluation = predictionGoal.id === goal.id
          ? evaluation : this.#evaluateGoal(predictionGoal, observation);
        const parentRelationIds = node.node.kind === 'factor-transition'
          ? projectedParentRelationIdsV1(nodeId, workspace) : null;
        const result = await this.#predictCandidateGroup(this.#candidates(node, workspace),
          node.continuousPatterns, observation, predictionGoal, predictionEvaluation, parentRelationIds);
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      } else if (operation === 'expand-condition') {
        const result = await this.reasoning.recallFactorTransition(request.factorIds, observation);
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      }
    } catch (error) {
      this.workspace.ingest({ kind: 'operation-failed', requestId, epoch: request.epoch, operation,
        nodeId, baseSequence: request.baseSequence, error }); throw error;
    }
  }

  #acceptOperation(event: Parameters<ControlWorkspaceV2['ingest']>[0]): void {
    const accepted = this.workspace.ingest(event);
    const auditEvent = event.kind === 'operation-completed' && event.operation === 'predict-branch'
      ? { ...event, result: { ...event.result,
        atomic: compactBranchPredictionForControlAuditV2(event.result.atomic),
        continuations: event.result.continuations.map(item => ({ ...item,
          value: this.#compactContinuationForAudit(item.value) })) } }
      : event;
    this.environment.record('control-operation-result', { event: auditEvent, accepted });
    if (!accepted.accepted && !accepted.reason.startsWith('stale-operation'))
      throw new Error(`control-operation-result-rejected:${accepted.reason}`);
  }

  #candidate(node: ControlWorkspaceNodeSnapshotV2, workspace: ControlWorkspaceSnapshotV2): EffectRecallCandidateV1 {
    return this.#candidates(node, workspace)[0]!;
  }

  #candidates(node: ControlWorkspaceNodeSnapshotV2,
    workspace: ControlWorkspaceSnapshotV2): readonly EffectRecallCandidateV1[] {
    if (node.node.kind === 'experienced') return node.node.candidateMembers ?? [node.node.candidate];
    assert(node.node.kind === 'factor-transition', 'control-node-has-no-physical-candidate');
    const desired = this.#desiredFactors(node.node.nodeId, workspace);
    return (node.node.transitionMembers ?? [node.node.transition]).map(transition =>
      factorTransitionCandidateForControlV2(transition, desired));
  }

  async #compareCandidateGroup(candidates: readonly EffectRecallCandidateV1[],
    observation: Observation): Promise<ConditionApplicabilityV1> {
    assert(candidates.length > 0, 'cannot-compare-empty-physical-group');
    const memberResults: NonNullable<ConditionApplicabilityV1['memberResults']>[number][] = [];
    for (const candidate of candidates) {
      const relationIds = [...new Set(candidate.evidence.r2a.relationIds)]
        .sort((left, right) => left.localeCompare(right, 'en'));
      const comparisons = await Promise.all(relationIds.map(relationId =>
        this.reasoning.compareCurrentFactors(relationId, observation)));
      const result = comparisons.sort((left, right) => Number(right.productionEligible) - Number(left.productionEligible)
        || right.applicability - left.applicability
        || right.matchedFactorIds.length - left.matchedFactorIds.length)[0]
        ?? { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
          applicability: 0, productionEligible: false };
      const { memberResults: _nested, selectedCandidateId: _selected, ...value } = result;
      memberResults.push({ candidateId: candidate.candidateId, value });
    }
    memberResults.sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'));
    const selected = [...memberResults].sort((left, right) =>
      Number(right.value.productionEligible) - Number(left.value.productionEligible)
      || right.value.applicability - left.value.applicability
      || right.value.matchedFactorIds.length - left.value.matchedFactorIds.length
      || left.candidateId.localeCompare(right.candidateId, 'en'))[0]!;
    if (candidates.length === 1) return selected.value;
    return { ...selected.value, memberResults, selectedCandidateId: selected.candidateId };
  }

  async #predictCandidateGroup(candidates: readonly EffectRecallCandidateV1[],
    continuousPatterns: readonly { readonly pattern: ContinuousPatternRecallV2;
      readonly sharedRelationIds: readonly string[] }[], observation: Observation,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
    parentRelationIds: readonly string[] | null): Promise<ControlBranchPredictionResultV2> {
    assert(candidates.length > 0, 'cannot-predict-empty-physical-group');
    const memberResults: NonNullable<BranchPredictionV1['memberResults']>[number][] = [];
    for (const candidate of candidates) {
      const raw = await this.reasoning.predictCandidate(candidate, observation, goal, evaluation);
      const result = parentRelationIds === null ? raw
        : await this.#scoreProjectedParentRelationProgress(candidate, raw, parentRelationIds, observation);
      const { memberResults: _nested, winningCandidateId: _winner, ...value } = result;
      memberResults.push({ candidateId: candidate.candidateId, value });
    }
    memberResults.sort((left, right) => left.candidateId.localeCompare(right.candidateId, 'en'));
    const selected = [...memberResults].sort((left, right) => right.value.progressFraction - left.value.progressFraction
      || right.value.validSampleCount - left.value.validSampleCount
      || (right.value.currentEvidence?.r2a.applicability ?? 0) - (left.value.currentEvidence?.r2a.applicability ?? 0)
      || left.candidateId.localeCompare(right.candidateId, 'en'))[0]!;
    const physicallyProgressing = selectQualifiedPredictionMemberV1(candidates, memberResults);
    const atomic: BranchPredictionV1 = candidates.length === 1 ? selected.value
      : { ...selected.value, memberResults, winningCandidateId: physicallyProgressing?.candidateId ?? null };
    const continuations: BoundContinuationPredictionV2[] = [];
    for (const candidate of candidates) for (const binding of continuousPatterns) {
      const exactIdentity = cueIdentity(candidate.actionCue);
      if (binding.pattern.nextActionCueIdentities
        && !binding.pattern.nextActionCueIdentities.includes(exactIdentity)) continue;
      continuations.push({ candidateId: candidate.candidateId, patternId: binding.pattern.patternId,
        sharedRelationIds: [...binding.sharedRelationIds],
        value: await this.reasoning.predictContinuation(binding.pattern.patternId,
          candidate.actionCue, observation) });
    }
    return { version: 'ControlBranchPredictionResultV2', atomic, continuations };
  }

  async #scoreProjectedParentRelationProgress(candidate: EffectRecallCandidateV1,
    prediction: BranchPredictionV1, parentRelationIds: readonly string[],
    observation: Observation): Promise<BranchPredictionV1> {
    const failClosed = (reason: string): BranchPredictionV1 => ({ ...prediction,
      progressSampleCount: 0, progressFraction: 0,
      progressBasis: 'parent-R2A-relation-complete',
      unknown: [...new Set([...prediction.unknown, reason])].sort((left, right) => left.localeCompare(right, 'en')) });
    if (parentRelationIds.length === 0) return failClosed('parent-R2A-relation-unavailable');
    if (prediction.nextStates.length === 0) return failClosed('parent-R2A-projection-unavailable');
    const evidence = prediction.currentEvidence ?? candidate.evidence;
    const projected = await this.reasoning.compareProjectedParentRelations(parentRelationIds, observation,
      prediction.nextStates, { r1Active: evidence.r1.active, r2Active: evidence.r2.active });
    if (projected.length !== prediction.nextStates.length)
      return failClosed('parent-R2A-projection-incomplete');
    return scoreProjectedParentRelationProgressV1(prediction, projected);
  }

  #compactContinuationForAudit(value: ContinuationPredictionV2): ContinuationPredictionV2 {
    return structuredClone(value);
  }

  /**
   * This only widens the real observation window. It neither creates a
   * subgoal nor scores an action: every ID already occurs in the grounded root
   * goal or one of its retained public requirement dependencies.
   */
  #actionObservationScope(rootGoal: GroundedGoalV1,
    workspace: ControlWorkspaceSnapshotV2): ActionObservationScopeV1 {
    const goals = [rootGoal, ...workspace.nodes.flatMap(node => node.node.kind === 'root'
      || node.node.kind === 'public-requirement' ? [node.node.goal] : [])];
    const referencedPublicObjectIds = [...new Set(goals.flatMap(goal => goalPredicates(goal))
      .flatMap(predicate => predicate.subject.kind === 'public-object' ? [predicate.subject.id] : []))];
    return { version: 'ActionObservationScopeV1', referencedPublicObjectIds };
  }
  #desiredFactors(nodeId: string, workspace = this.workspace.snapshot()): readonly string[] {
    return [...new Set(workspace.dependencies.filter(edge => edge.requiredNodeId === nodeId).flatMap(edge => edge.factorIds))].sort();
  }
  #missingFactors(nodeId: string): readonly string[] {
    const condition = this.workspace.currentCondition(nodeId);
    return this.#conditionFactors(condition);
  }
  #conditionFactors(condition: ConditionApplicabilityV1 | null): readonly string[] {
    if (!condition) return [];
    const values = condition.memberResults?.map(member => member.value) ?? [condition];
    return [...new Set(values.flatMap(value => [...value.unknownFactorIds, ...value.contradictedFactorIds]))].sort();
  }
  #offerForCandidate(node: ControlWorkspaceNodeSnapshotV2, candidate: EffectRecallCandidateV1,
    workspace: ControlWorkspaceSnapshotV2, observation: Observation): ActionOfferV1 | null {
    void node; void workspace;
    // The object whose state should change is not necessarily the object the
    // body must act on (a control can change a separate indicator or door).
    // Bind only to the body's exact current offer.  A cue with several current
    // targets is ambiguous and must not be guessed from the effect goal.
    const matches = this.environment.listActionOffers(observation)
      .filter(value => cueIdentity(value.cue) === cueIdentity(candidate.actionCue));
    return matches.length === 1 ? matches[0]! : null;
  }
  #rebindOffer(offer: ActionOfferV1, observation: Observation): ActionOfferV1 | null {
    return this.environment.listActionOffers(observation).find(value => cueIdentity(value.cue) === cueIdentity(offer.cue)
      && (offer.action.targetId === undefined || value.action.targetId === offer.action.targetId)) ?? null;
  }
  #nodeCueIdentity(node: ControlWorkspaceNodeSnapshotV2): string {
    if (node.node.kind === 'experienced') return cueIdentity(node.node.candidate.actionCue);
    if (node.node.kind === 'factor-transition') return cueIdentity(node.node.transition.actionCue);
    if (node.node.kind === 'exploration') return cueIdentity(node.node.offer.cue);
    return node.node.nodeId;
  }

  #synchronizePublicRequirements(observation: Observation): void {
    const snapshot = this.workspace.snapshot();
    for (const node of snapshot.nodes) {
      if (node.node.kind !== 'experienced' && node.node.kind !== 'factor-transition') continue;
      const candidate = this.#candidate(node, snapshot);
      if (candidate.actionCue.kind === 'passive') continue;
      const requirement = this.environment.describeActionRequirement(candidate.actionCue, observation);
      if (requirement.satisfied || requirement.goal === null) continue;
      const requirementNodeId = this.workspace.registerPublicRequirement(node.node.nodeId, requirement.goal);
      this.environment.record('control-public-requirement-goal', {
        dependentNodeId: node.node.nodeId, requirementNodeId, observationSequence: observation.sequence,
        goal: requirement.goal, missing: requirement.missing,
      });
    }
  }

  #synchronizeHistoricalTransitionRequirements(observation: Observation): void {
    const snapshot = this.workspace.snapshot();
    for (const node of snapshot.nodes) {
      if (node.node.kind !== 'experienced' || !node.prediction?.fresh) continue;
      const candidates = this.#candidates(node, snapshot);
      const memberPredictions = candidates.map(candidate => ({ candidate,
        prediction: predictionMember(node.prediction!.value, candidate.candidateId, candidates.length === 1) }));
      // A genuinely progressing physical member is already a direct plan.  A
      // prerequisite is introduced only when real random readout reached a
      // known transition but none of the members advanced the current goal.
      if (memberPredictions.some(value => value.prediction && value.prediction.validSampleCount > 0
        && value.prediction.progressFraction > 0)) continue;
      const stalled = memberPredictions.filter((value): value is typeof value & {
        readonly prediction: NonNullable<typeof value.prediction> } => value.prediction !== null
          && value.prediction.validSampleCount > 0
          && value.prediction.readoutDiagnostics?.goalRelevantKernelVisited === true
          && value.prediction.readoutDiagnostics.roleBindingStatus === 'matched')
        .map(value => value.candidate);
      if (stalled.length === 0) continue;
      const root = snapshot.nodes.find(value => value.node.nodeId === snapshot.rootNodeId)?.node;
      assert(root?.kind === 'root', 'control-workspace-root-goal-unavailable');
      const objective = this.#objectiveGoal(node, snapshot, root.goal);
      const requirement = historicalTransitionPreconditionV1(stalled, objective, observation);
      if (!requirement) continue;
      const requirementNodeId = `public-requirement:${sha(requirement)}`;
      const alreadyRegistered = snapshot.dependencies.some(edge => edge.dependentNodeId === node.node.nodeId
        && edge.requiredNodeId === requirementNodeId && edge.kind === 'historical-transition-precondition');
      this.workspace.registerPublicRequirement(node.node.nodeId, requirement,
        'historical-transition-precondition');
      if (!alreadyRegistered) this.environment.record('control-historical-transition-requirement', {
        dependentNodeId: node.node.nodeId, requirementNodeId,
        observationSequence: observation.sequence, goal: requirement,
        candidateIds: stalled.map(candidate => candidate.candidateId).sort(),
        evidenceBoundary: 'shared-real-before-value-not-causal-proof',
      });
    }
  }

  #evaluateGoal(goal: GroundedGoalV1, observation: Observation): GoalEvaluationV1 {
    const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation);
    return evaluator.evaluate(observation);
  }

  #publicRequirementSatisfied(nodeId: string, workspace: ControlWorkspaceSnapshotV2,
    observation: Observation): boolean {
    const node = workspace.nodes.find(value => value.node.nodeId === nodeId)?.node;
    return node?.kind === 'public-requirement'
      && this.#evaluateGoal(node.goal, observation).status === 'satisfied';
  }

  #objectiveGoal(node: ControlWorkspaceNodeSnapshotV2, workspace: ControlWorkspaceSnapshotV2,
    fallback: GroundedGoalV1): GroundedGoalV1 {
    if (node.node.kind !== 'experienced') return fallback;
    const objectiveNodeId = node.node.objectiveNodeId;
    const objective = workspace.nodes.find(value => value.node.nodeId === objectiveNodeId)?.node;
    return objective?.kind === 'root' || objective?.kind === 'public-requirement' ? objective.goal : fallback;
  }

  #nodeGoalDrive(nodeId: string, workspace: ControlWorkspaceSnapshotV2, rootResidual: number): number {
    const depth = dependencyDepthV2(nodeId, workspace.dependencies);
    return clamp01(rootResidual * Math.pow(.8, depth));
  }
  #novelty(offer: ActionOfferV1): number { return 1 / (1 + (this.#useInhibition.get(cueIdentity(offer.cue)) ?? 0)); }
  #markUsed(offer: ActionOfferV1): void {
    for (const [key, value] of this.#useInhibition) {
      const next = value * .85; if (next < .01) this.#useInhibition.delete(key); else this.#useInhibition.set(key, next);
    }
    const key = cueIdentity(offer.cue); this.#useInhibition.set(key, (this.#useInhibition.get(key) ?? 0) + 1);
  }
  #relation(previousNodeId: string, nextNodeId: string): ControlHabitGraphRelationV1 | null {
    if (previousNodeId === nextNodeId) return 'same-node';
    const snapshot = this.workspace.snapshot();
    if (previousNodeId === snapshot.rootNodeId) return 'root-to-branch';
    if (nextNodeId === snapshot.rootNodeId) return 'branch-to-root';
    if (snapshot.dependencies.some(edge => edge.dependentNodeId === previousNodeId && edge.requiredNodeId === nextNodeId))
      return 'parent-to-child';
    if (snapshot.dependencies.some(edge => edge.requiredNodeId === previousNodeId && edge.dependentNodeId === nextNodeId))
      return 'child-to-parent';
    return null;
  }
  #habitDrive(operation: JointControlOperationV2, nodeId: string): number {
    const previous = this.#dispatchHistory.at(-1); if (!previous) return 0;
    const relation = this.#relation(previous.nodeId, nodeId); if (!relation) return 0;
    return this.habit.drive({ previousOperation: previous.operation, nextOperation: operation, relation });
  }
  #recordDispatch(operation: JointControlOperationV2, nodeId: string): number {
    const recent = this.#dispatchHistory.slice(-Math.min(this.#dispatchHistory.length, 7)).reverse();
    const sequence = this.habit.recordDispatch({ operation,
      relationsFromRecent: recent.map(value => this.#relation(value.nodeId, nodeId)) });
    this.#dispatchHistory.push({ operation, nodeId }); if (this.#dispatchHistory.length > 8) this.#dispatchHistory.shift();
    return sequence;
  }
  #result(status: PhysicalControlResultV2['status'], cycles: number,
    goalEvaluation: GoalEvaluationV1 | null): PhysicalControlResultV2 {
    return { status, actions: this.environment.actionCount, cycles, goalEvaluation,
      notGlobalImpossibilityClaim: true };
  }
}
