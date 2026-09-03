import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { Vec3 } from 'vec3';
import type { ActionCue, Observation, PrimitiveKind, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import type { MemorySnapshot } from '../memory.js';
import { PUBLIC_LAYOUT_SEMANTICS } from '../public-context.js';
import { V5Runtime, type ExperiencePointer, type RestoredExperience } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import type { ConditionApplicabilityV1, EffectRecallCandidateV1, GroundedGoalV1,
  OpaqueFactorTransitionTraceV1 } from '../control/contracts.js';
import type { PhysicalControlSnapshotV2 } from '../control/controller.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import { guidedFixtureGeometryV1, type GuidedMinecraftLayoutV1 } from './minecraft-guided-affordance.js';
import { MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2, inspectFrozenTargetActionProductionV2,
  readFrozenPhysicalBaselineV2, type FrozenPhysicalBaselineV2 } from './minecraft-joint-control-heldout-v2.js';
import { classifyMinecraftMultilevelFailureV1, type MinecraftMultilevelFailureClassV1 } from './minecraft-multilevel-goal-chain-v1.js';

export const MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1 = Object.freeze({
  version: 'MinecraftNoteRecursiveQualificationProtocolV1' as const,
  caseId: 'note-recursive-qualification-001',
  layout: Object.freeze({ id: 'note-recursive-qualification-layout-001', originX: 112,
    originZ: 110, side: 'south', markerVariant: 2 } satisfies GuidedMinecraftLayoutV1),
  initialNote: '0' as const,
  targetNote: '2' as const,
  initialYawOffsetDegrees: -15 as const,
  absoluteYawOffsetDegrees: 15 as const,
  readinessTicks: 5 as const,
  verificationTicks: 5 as const,
  defaultActionBudget: 16 as const,
  experience: Object.freeze({ source: 'minecraft-joint-control-heldout-baseline-v2' as const,
    eventCount: 128 as const, independentRunLocalCopy: true as const, writeBackToSource: false as const }),
  habit: Object.freeze({ initialWeightCount: 0 as const }),
  goalDisclosure: Object.freeze({ rootGoalOnly: true as const, childGoalsDisclosed: 0 as const,
    actionHintsDisclosed: 0 as const }),
});

export const MINECRAFT_NOTE_RECURSIVE_DEPENDENCY_SOURCES_V1 = Object.freeze({
  services: '../services.js', body: '../body.js', runtime: '../runtime.js',
  frozenBaseline: './minecraft-joint-control-heldout-v2.js',
});

export interface NoteRecursiveFixtureReadinessV1 {
  readonly ready: boolean;
  readonly firstSequence: number | null;
  readonly confirmationSequence: number | null;
  readonly controlId: string | null;
  readonly observedTicks: number;
  readonly reason: 'waiting' | 'ready' | 'ambiguous-or-not-visible' | 'note-is-not-zero';
}

/** The gate sees only public frames. Readiness cannot be manufactured by a fixture command receipt. */
export class SingleNoteZeroReadinessGateV1 {
  #firstSequence: number | null = null;
  #controlId: string | null = null;
  #lastSequence: number | null = null;
  #observedTicks = 0;

  accept(observation: Observation): NoteRecursiveFixtureReadinessV1 {
    const notes = observation.objects.filter(object => object.type === 'note_block');
    const sole = notes.length === 1 ? notes[0]! : null;
    const reason = !sole || (this.#controlId !== null && sole.id !== this.#controlId)
      ? 'ambiguous-or-not-visible' as const
      : sole.properties.note !== MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.initialNote
        ? 'note-is-not-zero' as const : null;
    if (reason !== null || (this.#lastSequence !== null && observation.sequence <= this.#lastSequence)) {
      this.#firstSequence = null; this.#controlId = null; this.#lastSequence = null; this.#observedTicks = 0;
      return { ready: false, firstSequence: null, confirmationSequence: null, controlId: null,
        observedTicks: 0, reason: reason ?? 'ambiguous-or-not-visible' };
    }
    this.#firstSequence ??= observation.sequence; this.#controlId ??= sole!.id;
    this.#lastSequence = observation.sequence; this.#observedTicks++;
    const ready = observation.sequence - this.#firstSequence >= MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.readinessTicks;
    return { ready, firstSequence: this.#firstSequence,
      confirmationSequence: ready ? observation.sequence : null, controlId: this.#controlId,
      observedTicks: this.#observedTicks, reason: ready ? 'ready' : 'waiting' };
  }
}

export function noteRecursiveQualificationGoalV1(controlId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `note-recursive-zero-to-two:${MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.caseId}`,
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'note-recursive-is-two',
      subject: { kind: 'public-object', id: controlId, expectedType: 'note_block' },
      observable: 'properties.note', comparator: 'equals', target: '2' } } };
}

export function resolveNoteRecursiveActionBudgetV1(
  value: number = MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.defaultActionBudget): number {
  assert(Number.isInteger(value) && value > 0, 'invalid-note-recursive-action-budget');
  return value;
}

/** This explicit clone is the only snapshot passed to the case worker. */
export function independentFrozenBaselineCopyV1(baseline: FrozenPhysicalBaselineV2): MemorySnapshot {
  return structuredClone(baseline.snapshot);
}

async function restoreIndependentExperienceV1(baseline: FrozenPhysicalBaselineV2,
  compute: Compute): Promise<{ readonly restored: RestoredExperience; readonly copyCanonicalSha256: string }> {
  const snapshot = independentFrozenBaselineCopyV1(baseline);
  const copyCanonicalSha256 = sha(snapshot);
  const pointer: ExperiencePointer = { runtimeVersion: 'KairosV5PhysicalControlRuntimeV1',
    sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename: basename(baseline.path),
    sha256: copyCanonicalSha256, actions: 0, eventCount: snapshot.seenEventIds.length, writes: snapshot.writes };
  await compute.call('restore', snapshot);
  return { restored: { pointerPath: baseline.path, snapshotPath: baseline.path, habitPath: null,
    pointer, snapshot, habit: new ControlHabitWeightsV1() }, copyCanonicalSha256 };
}

export interface NoteRecursiveTimelineRecordV1 { readonly kind: string; readonly value: unknown }

export interface NoteStateWitnessV1 {
  readonly source: 'real-public-observation';
  readonly sequence: number;
  readonly value: '0' | '1' | '2';
}

export interface NoteRecursiveRelationWitnessV1 {
  readonly source: 'control-effect-recall';
  readonly rootNodeId: string;
  readonly candidateNodeId: string;
  readonly candidateId: string;
  readonly observationSequence: number;
  readonly relationIds: readonly string[];
  readonly r1Active: boolean;
  readonly r2Active: boolean;
  readonly productionEligible: boolean;
  readonly recalledApplicability: number;
}

export interface NoteRecursiveConditionWitnessV1 {
  readonly source: 'control-condition-comparison';
  readonly candidateNodeId: string;
  readonly observationSequence: number;
  readonly matchedFactorIds: readonly string[];
  readonly missingFactorIds: readonly string[];
  readonly applicability: number;
  readonly productionEligible: boolean;
}

export interface NoteRecursiveFactorTransitionWitnessV1 {
  readonly source: 'control-factor-transition-recall';
  readonly parentCandidateNodeId: string;
  readonly transitionNodeId: string;
  readonly transitionId: string;
  readonly sourceEventId: string;
  readonly actionCue: ActionCue;
  readonly activatedFactorIds: readonly string[];
  readonly dependencyFactorIds: readonly string[];
  readonly dependencyObserved: boolean;
}

export interface NoteRecursiveRolloutWitnessV1 {
  readonly source: 'prediction-clone';
  readonly candidateNodeId: string;
  readonly observationSequence: number;
  readonly validSampleCount: number;
  readonly progressSampleCount: number;
  readonly progressFraction: number;
}

export interface NoteRecursivePhysicalActionWitnessV1 {
  readonly source: 'executed-real-body';
  readonly eventId: string;
  readonly selectedNodeId: string | null;
  readonly actionKind: PrimitiveKind;
  readonly targetId: string | null;
  readonly startSequence: number;
  readonly endSequence: number;
  readonly noteBefore: string | null;
  readonly noteAfter: string | null;
  readonly yawBefore: number;
  readonly yawAfter: number;
  readonly finalCrosshairTargetId: string | null;
}

export interface NoteRecursiveTimelineEvidenceV1 {
  readonly version: 'NoteRecursiveTimelineEvidenceV1';
  readonly caseId: string;
  readonly controlId: string;
  readonly rootGoalId: string;
  readonly states: {
    readonly zero: NoteStateWitnessV1 | null;
    readonly one: NoteStateWitnessV1 | null;
    readonly two: NoteStateWitnessV1 | null;
  };
  readonly relationCandidate: NoteRecursiveRelationWitnessV1 | null;
  readonly missingFactor: NoteRecursiveConditionWitnessV1 | null;
  readonly factorTransition: NoteRecursiveFactorTransitionWitnessV1 | null;
  readonly conditionRecheck: NoteRecursiveConditionWitnessV1 | null;
  readonly rollout: NoteRecursiveRolloutWitnessV1 | null;
  readonly rootRetention: {
    readonly rootNodeId: string;
    readonly afterTurnObservationSequence: number | null;
    readonly afterIntermediateObservationSequence: number | null;
    readonly retainedAcrossTurnAndIntermediate: boolean;
  };
  readonly physicalActions: {
    readonly turn: NoteRecursivePhysicalActionWitnessV1 | null;
    readonly zeroToOne: NoteRecursivePhysicalActionWitnessV1 | null;
    readonly oneToTwo: NoteRecursivePhysicalActionWitnessV1 | null;
  };
  readonly verification: {
    readonly firstSatisfiedObservationSequence: number;
    readonly secondSatisfiedObservationSequence: number;
    readonly ticksApart: number;
    readonly observeEventId: string;
  } | null;
}

interface RecordedOperationV1 {
  readonly index: number;
  readonly operation: string;
  readonly nodeId: string;
  readonly baseSequence: number;
  readonly result: unknown;
  readonly accepted: boolean;
}

interface RecordedDecisionV1 {
  readonly index: number;
  readonly snapshot: PhysicalControlSnapshotV2;
}

interface RecordedExecutedEventV1 {
  readonly index: number;
  readonly event: RealEvent;
  readonly selectedNodeId: string | null;
}

const noteValue = (observation: Observation, controlId: string): string | null => {
  const control = observation.objects.find(object => object.id === controlId && object.type === 'note_block');
  return typeof control?.properties.note === 'string' ? control.properties.note : null;
};

const operationRecordsV1 = (records: readonly NoteRecursiveTimelineRecordV1[]): RecordedOperationV1[] =>
  records.flatMap((record, index) => {
    if (record.kind !== 'control-operation-result') return [];
    const row = record.value as { event?: { operation?: string; nodeId?: string; baseSequence?: number; result?: unknown };
      accepted?: { accepted?: boolean } };
    const event = row.event;
    return event && typeof event.operation === 'string' && typeof event.nodeId === 'string'
      && typeof event.baseSequence === 'number'
      ? [{ index, operation: event.operation, nodeId: event.nodeId, baseSequence: event.baseSequence,
        result: event.result, accepted: row.accepted?.accepted === true }] : [];
  });

const decisionRecordsV1 = (records: readonly NoteRecursiveTimelineRecordV1[]): RecordedDecisionV1[] =>
  records.flatMap((record, index) => record.kind === 'joint-control-decision'
    ? [{ index, snapshot: record.value as PhysicalControlSnapshotV2 }] : []);

function selectedNodeBeforeEventV1(decisions: readonly RecordedDecisionV1[], eventIndex: number,
  actionKind: PrimitiveKind): string | null {
  const operation = actionKind === 'observe' || actionKind === 'wait' ? 'observe-public' : 'execute';
  return [...decisions].reverse().find(row => row.index < eventIndex && row.snapshot.lastDecision?.converged === true
    && row.snapshot.lastDecision.operation === operation)?.snapshot.lastDecision?.nodeId ?? null;
}

const executedEventsV1 = (records: readonly NoteRecursiveTimelineRecordV1[],
  decisions: readonly RecordedDecisionV1[]): RecordedExecutedEventV1[] => records.flatMap((record, index) => {
  if (record.kind !== 'real-event') return [];
  const event = record.value as RealEvent;
  if (event.provenance !== 'executed-real-body' || event.bodyResult?.executed !== true) return [];
  return [{ index, event, selectedNodeId: selectedNodeBeforeEventV1(decisions, index, event.bodyResult.action.kind) }];
});

function stateTransitionInEventV1(row: RecordedExecutedEventV1, controlId: string,
  before: string, after: string): boolean {
  const beforeFrame = row.event.frames.find(frame => noteValue(frame, controlId) === before);
  return Boolean(beforeFrame && row.event.frames.some(frame => frame.sequence > beforeFrame.sequence
    && noteValue(frame, controlId) === after));
}

function physicalWitnessV1(row: RecordedExecutedEventV1 | undefined,
  controlId: string): NoteRecursivePhysicalActionWitnessV1 | null {
  if (!row?.event.bodyResult || row.event.frames.length === 0) return null;
  const first = row.event.frames[0]!, last = row.event.frames.at(-1)!;
  return { source: 'executed-real-body', eventId: row.event.id, selectedNodeId: row.selectedNodeId,
    actionKind: row.event.bodyResult.action.kind, targetId: row.event.bodyResult.action.targetId ?? null,
    startSequence: first.sequence, endSequence: last.sequence, noteBefore: noteValue(first, controlId),
    noteAfter: noteValue(last, controlId), yawBefore: first.self.yaw, yawAfter: last.self.yaw,
    finalCrosshairTargetId: last.targetId };
}

function conditionWitnessV1(row: RecordedOperationV1 | undefined): NoteRecursiveConditionWitnessV1 | null {
  if (!row) return null;
  const value = row.result as ConditionApplicabilityV1;
  return { source: 'control-condition-comparison', candidateNodeId: row.nodeId,
    observationSequence: row.baseSequence, matchedFactorIds: [...value.matchedFactorIds],
    missingFactorIds: [...new Set([...value.unknownFactorIds, ...value.contradictedFactorIds])].sort(),
    applicability: value.applicability, productionEligible: value.productionEligible };
}

function retainedRootSequenceV1(decisions: readonly RecordedDecisionV1[], minimumSequence: number | null,
  rootNodeId: string, candidateNodeId: string | null): number | null {
  if (minimumSequence === null || candidateNodeId === null) return null;
  const row = decisions.find(item => {
    const workspace = item.snapshot.workspace;
    return (workspace.observationSequence ?? -1) >= minimumSequence && workspace.rootNodeId === rootNodeId
      && workspace.nodes.some(node => node.node.nodeId === rootNodeId && node.node.kind === 'root')
      && workspace.nodes.some(node => node.node.nodeId === candidateNodeId && node.node.kind === 'experienced'
        && node.node.objectiveNodeId === rootNodeId);
  });
  return row?.snapshot.workspace.observationSequence ?? null;
}

/** Extract semantic milestones from the real timeline. No expected action list is accepted by this API. */
export function extractNoteRecursiveTimelineEvidenceV1(records: readonly NoteRecursiveTimelineRecordV1[],
  goal: GroundedGoalV1, controlId: string): NoteRecursiveTimelineEvidenceV1 {
  assert(goal.expression.kind === 'predicate', 'note-recursive-goal-must-be-one-predicate');
  const predicateId = goal.expression.predicate.id, rootNodeId = `root:${goal.id}`;
  const frames = records.filter(record => record.kind === 'frame').map(record => record.value as Observation)
    .sort((left, right) => left.sequence - right.sequence);
  const states: NoteStateWitnessV1[] = frames.flatMap(frame => {
    const value = noteValue(frame, controlId);
    return value === '0' || value === '1' || value === '2'
      ? [{ source: 'real-public-observation' as const, sequence: frame.sequence, value }] : [];
  });
  const zero = states.find(state => state.value === '0') ?? null;
  const one = zero ? states.find(state => state.sequence > zero.sequence && state.value === '1') ?? null : null;
  const two = one ? states.find(state => state.sequence > one.sequence && state.value === '2') ?? null : null;

  const operations = operationRecordsV1(records), decisions = decisionRecordsV1(records);
  const events = executedEventsV1(records, decisions);
  const zeroToOneRow = events.find(row => row.event.bodyResult?.action.kind === 'interact'
    && stateTransitionInEventV1(row, controlId, '0', '1'));
  const oneToTwoRow = events.find(row => row.event.bodyResult?.action.kind === 'interact'
    && stateTransitionInEventV1(row, controlId, '1', '2'));
  const turnRow = events.find(row => row.event.bodyResult?.action.kind === 'look' && row.event.frames.length > 1
    && Math.abs(row.event.frames.at(-1)!.self.yaw - row.event.frames[0]!.self.yaw) > 1e-4
    && row.event.frames.at(-1)!.targetId === controlId);
  const candidateNodeId = oneToTwoRow?.selectedNodeId ?? null;

  const recalls = operations.filter(row => row.operation === 'recall-effect' && row.nodeId === rootNodeId && row.accepted);
  let recalledCandidate: { readonly row: RecordedOperationV1; readonly candidate: EffectRecallCandidateV1 } | null = null;
  for (const row of recalls) {
    const candidates = Array.isArray(row.result) ? row.result as readonly EffectRecallCandidateV1[] : [];
    const candidate = candidates.find(item => item.goalPredicateIds.includes(predicateId)
      && item.actionCue.kind === 'interact' && item.actionCue.targetRole === 'note_block'
      && item.observedChanges.some(change => change.property === 'note' && change.after === '2')
      && (candidateNodeId === null || `experienced:${item.candidateId}` === candidateNodeId));
    if (candidate) { recalledCandidate = { row, candidate }; break; }
  }
  const relationCandidate = recalledCandidate ? {
    source: 'control-effect-recall' as const, rootNodeId,
    candidateNodeId: `experienced:${recalledCandidate.candidate.candidateId}`,
    candidateId: recalledCandidate.candidate.candidateId,
    observationSequence: recalledCandidate.row.baseSequence,
    relationIds: [...recalledCandidate.candidate.evidence.r2a.relationIds],
    r1Active: recalledCandidate.candidate.evidence.r1.active,
    r2Active: recalledCandidate.candidate.evidence.r2.active,
    productionEligible: recalledCandidate.candidate.evidence.r2a.productionEligible,
    recalledApplicability: recalledCandidate.candidate.evidence.r2a.applicability,
  } satisfies NoteRecursiveRelationWitnessV1 : null;

  const rootCandidateNodeId = relationCandidate?.candidateNodeId ?? candidateNodeId;
  const conditions = rootCandidateNodeId === null ? [] : operations.filter(row => row.operation === 'compare-condition'
    && row.nodeId === rootCandidateNodeId && row.accepted);
  const missingRow = conditions.find(row => {
    const value = row.result as ConditionApplicabilityV1;
    return value.unknownFactorIds.length + value.contradictedFactorIds.length > 0
      && (!zeroToOneRow || row.baseSequence < zeroToOneRow.event.frames.at(-1)!.sequence);
  });
  const missingFactor = conditionWitnessV1(missingRow);
  const missingIds = missingFactor?.missingFactorIds ?? [];

  const expandRows = rootCandidateNodeId === null ? [] : operations.filter(row => row.operation === 'expand-condition'
    && row.nodeId === rootCandidateNodeId && row.accepted);
  let transition: { readonly row: RecordedOperationV1; readonly value: OpaqueFactorTransitionTraceV1 } | null = null;
  for (const row of expandRows) {
    const values = Array.isArray(row.result) ? row.result as readonly OpaqueFactorTransitionTraceV1[] : [];
    const value = values.find(item => (zeroToOneRow?.selectedNodeId === null
      || zeroToOneRow?.selectedNodeId === undefined || `factor-transition:${item.transitionId}` === zeroToOneRow.selectedNodeId)
      && missingIds.some(id => item.activatedFactorIds.includes(id)));
    if (value) { transition = { row, value }; break; }
  }
  const transitionNodeId = transition ? `factor-transition:${transition.value.transitionId}` : null;
  const dependency = transitionNodeId === null || rootCandidateNodeId === null ? null
    : decisions.flatMap(row => row.snapshot.workspace.dependencies).find(edge => edge.kind === 'opaque-factor'
      && edge.dependentNodeId === rootCandidateNodeId && edge.requiredNodeId === transitionNodeId
      && missingIds.every(id => edge.factorIds.includes(id))) ?? null;
  const factorTransition = transition && rootCandidateNodeId ? {
    source: 'control-factor-transition-recall' as const, parentCandidateNodeId: rootCandidateNodeId,
    transitionNodeId: `factor-transition:${transition.value.transitionId}`,
    transitionId: transition.value.transitionId, sourceEventId: transition.value.eventId,
    actionCue: structuredClone(transition.value.actionCue),
    activatedFactorIds: [...transition.value.activatedFactorIds],
    dependencyFactorIds: dependency ? [...dependency.factorIds] : [], dependencyObserved: dependency !== null,
  } satisfies NoteRecursiveFactorTransitionWitnessV1 : null;

  const intermediateEnd = zeroToOneRow?.event.frames.at(-1)?.sequence ?? null;
  const recheckRow = intermediateEnd === null ? undefined : conditions.find(row => row.baseSequence >= intermediateEnd
    && missingIds.length > 0 && missingIds.every(id => (row.result as ConditionApplicabilityV1).matchedFactorIds.includes(id))
    && (row.result as ConditionApplicabilityV1).productionEligible
    && (row.result as ConditionApplicabilityV1).applicability > 0);
  const conditionRecheck = conditionWitnessV1(recheckRow);
  const rolloutFloor = conditionRecheck?.observationSequence ?? intermediateEnd ?? 0;
  const predictionRow = rootCandidateNodeId === null ? undefined : operations.find(row => row.operation === 'predict-branch'
    && row.nodeId === rootCandidateNodeId && row.accepted && row.baseSequence >= rolloutFloor
    && Number((row.result as { validSampleCount?: number }).validSampleCount) > 0
    && Number((row.result as { progressFraction?: number }).progressFraction) > 0);
  const prediction = predictionRow?.result as { validSampleCount: number; progressSampleCount: number;
    progressFraction: number } | undefined;
  const rollout = predictionRow && prediction ? { source: 'prediction-clone' as const,
    candidateNodeId: predictionRow.nodeId, observationSequence: predictionRow.baseSequence,
    validSampleCount: prediction.validSampleCount, progressSampleCount: prediction.progressSampleCount,
    progressFraction: prediction.progressFraction } satisfies NoteRecursiveRolloutWitnessV1 : null;

  const turnEnd = turnRow?.event.frames.at(-1)?.sequence ?? null;
  const afterTurnObservationSequence = retainedRootSequenceV1(decisions, turnEnd,
    rootNodeId, rootCandidateNodeId);
  const afterIntermediateObservationSequence = retainedRootSequenceV1(decisions, intermediateEnd,
    rootNodeId, rootCandidateNodeId);

  const satisfied = records.filter(record => record.kind === 'goal-difference')
    .map(record => record.value as { goalId?: string; status?: string; observationSequence?: number })
    .filter(value => value.goalId === goal.id && value.status === 'satisfied'
      && typeof value.observationSequence === 'number')
    .map(value => value.observationSequence!).sort((left, right) => left - right);
  const firstSatisfied = two ? satisfied.find(sequence => sequence >= two.sequence) ?? null : null;
  const secondSatisfied = firstSatisfied === null ? null : satisfied.find(sequence =>
    sequence >= firstSatisfied + MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.verificationTicks) ?? null;
  const observeRow = secondSatisfied === null ? undefined : events.find(row => {
    if (row.event.bodyResult?.action.kind !== 'observe' || row.event.frames.length < 2) return false;
    const noteTwo = row.event.frames.filter(frame => noteValue(frame, controlId) === '2');
    return noteTwo.length >= 2 && noteTwo.at(-1)!.sequence - noteTwo[0]!.sequence
      >= MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.verificationTicks;
  });
  const verification = firstSatisfied !== null && secondSatisfied !== null && observeRow ? {
    firstSatisfiedObservationSequence: firstSatisfied, secondSatisfiedObservationSequence: secondSatisfied,
    ticksApart: secondSatisfied - firstSatisfied, observeEventId: observeRow.event.id } : null;

  return { version: 'NoteRecursiveTimelineEvidenceV1', caseId: MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.caseId,
    controlId, rootGoalId: goal.id, states: { zero, one, two }, relationCandidate, missingFactor,
    factorTransition, conditionRecheck, rollout,
    rootRetention: { rootNodeId, afterTurnObservationSequence, afterIntermediateObservationSequence,
      retainedAcrossTurnAndIntermediate: afterTurnObservationSequence !== null
        && afterIntermediateObservationSequence !== null },
    physicalActions: { turn: physicalWitnessV1(turnRow, controlId),
      zeroToOne: physicalWitnessV1(zeroToOneRow, controlId),
      oneToTwo: physicalWitnessV1(oneToTwoRow, controlId) }, verification };
}

export function auditNoteRecursiveGoalInjectionV1(records: readonly NoteRecursiveTimelineRecordV1[],
  goal: GroundedGoalV1): boolean {
  const injections = records.filter(record => record.kind === 'note-recursive-root-goal-injection');
  return scriptGeneratedSubgoalCountV1(records) === 0
    && !records.some(record => record.kind === 'evaluation-action-hint')
    && injections.length === 1 && canonical(injections[0]!.value) === canonical(goal);
}

export function scriptGeneratedSubgoalCountV1(records: readonly NoteRecursiveTimelineRecordV1[]): number {
  return records.filter(record => record.kind === 'script-generated-subgoal').length;
}

export interface NoteRecursiveQualificationScoreInputV1 {
  readonly evidence: NoteRecursiveTimelineEvidenceV1;
  readonly fixtureReady: boolean;
  readonly baselineWrites: number;
  readonly baselineEventCount: number;
  readonly baselineHashUnchanged: boolean;
  readonly independentCopy: boolean;
  readonly initialHabitWeightCount: number;
  readonly targetActionPreflightReady: boolean;
  readonly goalInjectionLeakageFree: boolean;
  readonly controllerStatus: string | null;
  readonly actionsExecuted: number;
  readonly actionBudget: number;
  readonly runtimeError: string | null;
}

export interface NoteRecursiveQualificationScoreV1 {
  readonly version: 'NoteRecursiveQualificationScoreV1';
  readonly passed: boolean;
  readonly failure: MinecraftMultilevelFailureClassV1 | null;
  readonly milestones: {
    readonly realStateZeroToOneToTwo: boolean;
    readonly productionRelationCandidate: boolean;
    readonly missingFactorObserved: boolean;
    readonly factorTransitionObserved: boolean;
    readonly conditionRechecked: boolean;
    readonly rootRetained: boolean;
    readonly physicalActionEvidence: boolean;
    readonly doubleObservationVerification: boolean;
  };
}

export function scoreNoteRecursiveQualificationV1(
  input: NoteRecursiveQualificationScoreInputV1): NoteRecursiveQualificationScoreV1 {
  const evidence = input.evidence;
  const realStateZeroToOneToTwo = evidence.states.zero !== null && evidence.states.one !== null
    && evidence.states.two !== null && evidence.states.zero.sequence < evidence.states.one.sequence
    && evidence.states.one.sequence < evidence.states.two.sequence;
  const productionRelationCandidate = evidence.relationCandidate !== null
    && evidence.relationCandidate.relationIds.length > 0 && evidence.relationCandidate.r1Active
    && evidence.relationCandidate.r2Active && evidence.relationCandidate.productionEligible;
  const missingFactorObserved = evidence.missingFactor !== null
    && evidence.missingFactor.missingFactorIds.length > 0 && evidence.missingFactor.productionEligible;
  const factorTransitionObserved = evidence.factorTransition !== null
    && evidence.factorTransition.dependencyObserved && evidence.factorTransition.activatedFactorIds
      .some(id => evidence.missingFactor?.missingFactorIds.includes(id));
  const conditionRechecked = evidence.conditionRecheck !== null && evidence.missingFactor !== null
    && evidence.missingFactor.missingFactorIds.every(id => evidence.conditionRecheck!.matchedFactorIds.includes(id))
    && evidence.conditionRecheck.productionEligible && evidence.conditionRecheck.applicability > 0
    && evidence.conditionRecheck.observationSequence > evidence.missingFactor.observationSequence;
  const rootRetained = evidence.rootRetention.retainedAcrossTurnAndIntermediate;
  const physicalActionEvidence = evidence.physicalActions.turn?.source === 'executed-real-body'
    && evidence.physicalActions.turn.finalCrosshairTargetId === evidence.controlId
    && evidence.physicalActions.zeroToOne?.source === 'executed-real-body'
    && evidence.physicalActions.zeroToOne.noteBefore === '0' && evidence.physicalActions.zeroToOne.noteAfter === '1'
    && evidence.physicalActions.oneToTwo?.source === 'executed-real-body'
    && evidence.physicalActions.oneToTwo.noteBefore === '1' && evidence.physicalActions.oneToTwo.noteAfter === '2';
  const doubleObservationVerification = evidence.verification !== null
    && evidence.verification.ticksApart >= MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1.verificationTicks;
  const milestones = { realStateZeroToOneToTwo, productionRelationCandidate, missingFactorObserved,
    factorTransitionObserved, conditionRechecked, rootRetained, physicalActionEvidence,
    doubleObservationVerification };
  const foundationReady = input.baselineWrites === 128 && input.baselineEventCount === 128
    && input.baselineHashUnchanged && input.independentCopy && input.initialHabitWeightCount === 0;
  const failure = classifyMinecraftMultilevelFailureV1({
    leakageFree: input.goalInjectionLeakageFree && input.baselineHashUnchanged,
    fixtureReady: input.fixtureReady,
    foundationExperienceReady: foundationReady,
    representationReady: input.targetActionPreflightReady && productionRelationCandidate,
    physicalRecallAndRolloutReady: productionRelationCandidate && evidence.rollout !== null
      && evidence.rollout.validSampleCount > 0 && evidence.rollout.progressFraction > 0,
    dependencyDecompositionReady: missingFactorObserved && factorTransitionObserved && conditionRechecked && rootRetained,
    controlSelectionReady: typeof evidence.physicalActions.turn?.selectedNodeId === 'string'
      && typeof evidence.physicalActions.zeroToOne?.selectedNodeId === 'string'
      && evidence.physicalActions.oneToTwo?.selectedNodeId === evidence.relationCandidate?.candidateNodeId,
    controlCapacityAvailable: input.actionsExecuted <= input.actionBudget
      && input.controllerStatus !== 'current-experience-and-budget-exhausted',
    bodyIntegrationReady: input.runtimeError === null && physicalActionEvidence,
    attentionReady: input.runtimeError === null,
    goalVerified: input.controllerStatus === 'goal-verified' && realStateZeroToOneToTwo
      && doubleObservationVerification,
  });
  return { version: 'NoteRecursiveQualificationScoreV1', passed: failure === null, failure, milestones };
}

async function configureNoteRecursiveFixtureV1(body: MinecraftBody, services: Services): Promise<void> {
  const protocol = MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1;
  const layout = protocol.layout, geometry = guidedFixtureGeometryV1(layout);
  const radius = 4, minX = layout.originX - radius, maxX = layout.originX + radius;
  const minZ = layout.originZ - radius, maxZ = layout.originZ + radius;
  services.command(`fill ${minX} 64 ${minZ} ${maxX} 69 ${maxZ} air`);
  services.command(`fill ${minX} 63 ${minZ} ${maxX} 63 ${maxZ} minecraft:smooth_stone`);
  services.command(`setblock ${geometry.backing.join(' ')} minecraft:redstone_lamp[lit=false]`);
  services.command(`setblock ${geometry.control.join(' ')} minecraft:note_block[instrument=harp,note=0,powered=false]`);
  for (const command of geometry.markerCommands) services.command(command);
  services.command(`tp ${body.bot.username} ${geometry.bot.join(' ')} 0 0`);
  await body.waitTicks(6);
  let control = body.bot.blockAt(new Vec3(...geometry.control));
  for (let tick = 0; control?.name !== 'note_block' && tick < 40; tick++) {
    await body.waitTicks(1); control = body.bot.blockAt(new Vec3(...geometry.control));
  }
  assert(control?.name === 'note_block' && control.shapes.length > 0,
    'note-recursive-fixture-control-shape-unavailable');
  const shape = control.shapes[0]!;
  const target = new Vec3(geometry.control[0] + (shape[0]! + shape[3]!) / 2,
    geometry.control[1] + (shape[1]! + shape[4]!) / 2,
    geometry.control[2] + (shape[2]! + shape[5]!) / 2);
  const eye = body.bot.entity.position.offset(0, 1.62, 0), delta = target.minus(eye);
  const yaw = Math.atan2(-delta.x, -delta.z), pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  await body.bot.look(yaw + protocol.initialYawOffsetDegrees * Math.PI / 180, pitch, true);
  await body.waitTicks(3);
}

async function awaitNoteRecursiveFixtureV1(body: MinecraftBody): Promise<NoteRecursiveFixtureReadinessV1> {
  const gate = new SingleNoteZeroReadinessGateV1();
  let result = gate.accept(body.latest());
  for (let tick = 0; !result.ready && tick < 200; tick++) {
    await body.waitTicks(1); result = gate.accept(body.latest());
  }
  return result;
}

export interface MinecraftNoteRecursiveQualificationOptionsV1 {
  readonly baselinePath?: string;
  readonly actionBudget?: number;
}

export interface MinecraftNoteRecursiveQualificationResultV1 {
  readonly version: 'MinecraftNoteRecursiveQualificationResultV1';
  readonly caseId: string;
  readonly passed: boolean;
  readonly failure: MinecraftMultilevelFailureClassV1 | null;
  readonly fixture: NoteRecursiveFixtureReadinessV1;
  readonly goal: GroundedGoalV1 | null;
  readonly controllerStatus: string | null;
  readonly actionBudget: number;
  readonly actionsExecuted: number;
  readonly initialHabitWeightCount: 0;
  readonly scriptGeneratedSubgoals: number;
  readonly baseline: {
    readonly path: string;
    readonly writes: 128;
    readonly eventCount: 128;
    readonly fileSha256Before: string;
    readonly fileSha256After: string;
    readonly canonicalSha256Before: string;
    readonly canonicalSha256After: string;
    readonly independentCopyCanonicalSha256: string | null;
    readonly writeBackToSource: false;
  };
  readonly targetActionPreflightReady: boolean;
  readonly temporaryExperienceHash: string | null;
  readonly timelineEvidence: NoteRecursiveTimelineEvidenceV1 | null;
  readonly score: NoteRecursiveQualificationScoreV1 | null;
  readonly error: string | null;
}

export async function runMinecraftNoteRecursiveQualificationV1(config: Configuration, evidencePath: string,
  options: MinecraftNoteRecursiveQualificationOptionsV1 = {}): Promise<MinecraftNoteRecursiveQualificationResultV1> {
  const protocol = MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1;
  const actionBudget = resolveNoteRecursiveActionBudgetV1(options.actionBudget);
  const baselinePath = options.baselinePath ?? resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath);
  await mkdir(dirname(evidencePath), { recursive: true }); await mkdir(evidencePath);
  const baseline = await readFrozenPhysicalBaselineV2(baselinePath);
  const baselineFileBefore = await fileSha(baselinePath), baselineCanonicalBefore = sha(baseline.snapshot);
  const preflight = inspectFrozenTargetActionProductionV2(baseline.snapshot,
    { kind: 'interact', parameters: {}, targetRole: 'note_block' });
  await saveJson(resolve(evidencePath, 'RUN_PROTOCOL.json'), protocol);
  await saveJson(resolve(evidencePath, 'FROZEN_TARGET_ACTION_PREFLIGHT.json'), preflight);

  const events = createWriteStream(resolve(evidencePath, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidencePath, 'frames.jsonl'), { flags: 'wx' });
  const records: NoteRecursiveTimelineRecordV1[] = [];
  const record = (kind: string, value: unknown): void => {
    const copy = structuredClone(value); records.push({ kind, value: copy });
    (kind === 'frame' ? frames : events).write(canonical({ kind, value: copy }) + '\n');
  };

  const runRoot = resolve(config.runtimeRoot, `note-recursive-qualification-v1-${Date.now()}`);
  const services = new Services(config, runRoot, evidencePath);
  let body: MinecraftBody | null = null, compute: Compute | null = null, runtime: V5Runtime | null = null;
  let fixture: NoteRecursiveFixtureReadinessV1 = { ready: false, firstSequence: null,
    confirmationSequence: null, controlId: null, observedTicks: 0, reason: 'waiting' };
  let goal: GroundedGoalV1 | null = null, controllerStatus: string | null = null;
  let actionsExecuted = 0, independentCopyCanonicalSha256: string | null = null;
  let temporaryExperienceHash: string | null = null, errorText: string | null = null;
  try {
    await services.start('empty');
    services.command('setworldspawn 1000 64 1000'); services.command('gamerule spawnRadius 0');
    services.command('gamerule doDaylightCycle false'); services.command('gamerule doWeatherCycle false');
    services.command('gamerule doMobSpawning false'); services.command('time set noon');
    services.command('forceload add 80 80 120 120');
    body = new MinecraftBody({ ...config.minecraft, worldId: protocol.caseId, sessionId: protocol.caseId,
      activeSecondsOffset: baseline.snapshot.activeSeconds }, record);
    await body.ready(); await configureNoteRecursiveFixtureV1(body, services);
    fixture = await awaitNoteRecursiveFixtureV1(body);
    if (!fixture.ready || !fixture.controlId) throw new Error(`note-recursive-fixture-not-ready:${fixture.reason}`);

    compute = new Compute();
    const restored = await restoreIndependentExperienceV1(baseline, compute);
    independentCopyCanonicalSha256 = restored.copyCanonicalSha256;
    const runConfig: Configuration = { ...config, actionBudget,
      control: { ...config.control, goalVerificationTicks: protocol.verificationTicks } };
    runtime = new V5Runtime(body, runConfig, evidencePath, record,
      { compute, restoredExperience: restored.restored });
    assert(runtime.habitCheckpointForDisplay.weights.length === 0, 'note-recursive-initial-habit-not-empty');
    goal = noteRecursiveQualificationGoalV1(fixture.controlId);
    // This is the sole post-fixture target injection. It contains a state predicate only.
    record('note-recursive-root-goal-injection', goal);
    const controlResult = await runtime.runGoal(goal);
    controllerStatus = controlResult.status; actionsExecuted = controlResult.actions;
    await runtime.save(); temporaryExperienceHash = await compute.call<string>('hash');
  } catch (error) {
    errorText = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    actionsExecuted = runtime?.actions ?? actionsExecuted;
    temporaryExperienceHash = compute ? await compute.call<string>('hash').catch(() => null) : null;
  } finally {
    if (runtime) await runtime.close().catch(() => undefined);
    else { await body?.close().catch(() => undefined); await compute?.close().catch(() => undefined); }
    await services.stop().catch(() => undefined);
    await Promise.all([new Promise<void>(done => events.end(done)), new Promise<void>(done => frames.end(done))]);
  }

  const baselineFileAfter = await fileSha(baselinePath), baselineCanonicalAfter = sha(baseline.snapshot);
  const baselineHashUnchanged = baselineFileAfter === baselineFileBefore
    && baselineCanonicalAfter === baselineCanonicalBefore;
  const timelineEvidence = goal && fixture.controlId
    ? extractNoteRecursiveTimelineEvidenceV1(records, goal, fixture.controlId) : null;
  const score = timelineEvidence && goal ? scoreNoteRecursiveQualificationV1({ evidence: timelineEvidence,
    fixtureReady: fixture.ready, baselineWrites: baseline.snapshot.writes,
    baselineEventCount: baseline.snapshot.seenEventIds.length, baselineHashUnchanged,
    independentCopy: independentCopyCanonicalSha256 === baselineCanonicalBefore,
    initialHabitWeightCount: 0, targetActionPreflightReady: preflight.ready,
    goalInjectionLeakageFree: auditNoteRecursiveGoalInjectionV1(records, goal), controllerStatus,
    actionsExecuted, actionBudget, runtimeError: errorText }) : null;
  const failure: MinecraftMultilevelFailureClassV1 | null = score?.failure
    ?? (!fixture.ready ? 'fixture-failed'
      : !preflight.ready ? 'representation-insufficient'
        : errorText ? 'body-integration-failed' : 'goal-verification-failed');
  const result: MinecraftNoteRecursiveQualificationResultV1 = {
    version: 'MinecraftNoteRecursiveQualificationResultV1', caseId: protocol.caseId,
    passed: score?.passed === true, failure: score?.passed === true ? null : failure, fixture, goal,
    controllerStatus, actionBudget, actionsExecuted, initialHabitWeightCount: 0,
    scriptGeneratedSubgoals: scriptGeneratedSubgoalCountV1(records),
    baseline: { path: baseline.path, writes: 128, eventCount: 128,
      fileSha256Before: baselineFileBefore, fileSha256After: baselineFileAfter,
      canonicalSha256Before: baselineCanonicalBefore, canonicalSha256After: baselineCanonicalAfter,
      independentCopyCanonicalSha256, writeBackToSource: false },
    targetActionPreflightReady: preflight.ready, temporaryExperienceHash, timelineEvidence, score,
    error: errorText };
  await saveJson(resolve(evidencePath, 'QUALIFICATION_RESULT.json'), result);
  return result;
}
