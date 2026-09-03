import type { ActionCue, DesiredChange, Observation, Prediction, PublicChange,
  PublicValue, RealEvent } from './contracts.js';
import type { R1TraceSnapshot, RawExperience, Vec3 } from './core/contracts.js';
import { emptyFirewallRejections, emptyLeakageAudit, ObservationGate } from './core/firewall.js';
import { HierarchicalR1StoreV1, type HierarchicalR1StoreCheckpointV1 } from './core/learning/hierarchical-r1-store.js';
import { R2AtomMeasurementAdapterV1, type R2AtomMeasurementAdapterStateV3 } from './core/learning/r2-atom-measurement.js';
import { R2AStablePatternLearnerV1, selectProjectedR2ARelationV1,
  type R2AStablePatternGraphStateV1,
  type R2AEvidenceGradeV1, type R2AInterventionEvidenceV1,
  type R2AInterventionProtocolRegistrationV3, type R2AInterventionProtocolV1 }
  from './core/learning/r2a-stable-pattern.js';
import { R2ContinuousEventStore, assessR2ContinuityV1,
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1, type R1ClosedEventAtomV1,
  type R1ClosedEventAtomStateV1, type R2ContinuousEventStoreStateV1,
  type R2CloseReceiptV1, type R2EventBoundaryV1 } from './core/learning/r2-continuous-event.js';
import { DeterministicTokenFieldEncoder } from './core/learning/token-field.js';
import { pathInitialTangent, r1RouteSignature } from './core/learning/path-projector.js';
import { PredictionClone, transportTraceSnapshot } from './core/prediction/prediction-clone.js';
import { adaptPredictionTraceResolution, restorePredictionTracePositions } from './core/prediction/trace-resolution-adapter.js';
import { SplitMix64 } from './core/random.js';
import { R1_CONFIG } from './core/config.js';
import { DistanceEmbedding, type EmbeddingState } from './distance-embedding.js';
import { cueIdentity, eventRows, publicTransitionTopologyFromChangesV1,
  realEventHierarchyContinuityV1,
  relativePublicFeatures, validateEvent, type EventLocalPublicRoleBindingV1 } from './events.js';
import { assert, canonical, sha } from './util.js';
import type { ConditionApplicabilityV1, ContinuousPatternRecallV2, GoalExpressionV1, GoalPredicateV1,
  GroundedGoalV1, GoalEvaluationV1, HypotheticalPublicStateV1,
  ProjectedParentRelationApplicabilityV1 } from './control/contracts.js';
import type { LegacyBranchPredictionV1 as BranchPredictionV1,
  LegacyContinuationPredictionV2 as ContinuationPredictionV2,
  LegacyEffectRecallCandidateV1 as EffectRecallCandidateV1,
  LegacyOpaqueFactorTransitionTraceV1 as OpaqueFactorTransitionTraceV1,
  LegacyPhysicalEvidenceReferenceV1 as PhysicalEvidenceReferenceV1 }
  from './legacy/audit-control-contracts.js';
import { desiredChangesForGoal, evaluateGroundedPredicateValueV1, groundedPublicObservableV1 }
  from './control/goal.js';

// V5 checkpoints bind every R2 atom to its opaque cue identity, its observed
// public-transition topology, its own
// pre-event public perception, and the exact qualified R2 measurement adapter
// used by the stable-pattern topology. Older upper-layer aggregates are audit-only.
// V7 also binds directional block properties to the observer's egocentric
// frame. V5/V6 remain audit-only because replaying their token ordinals
// under the corrected ordering would silently change R2A factor identity.
export const HIERARCHICAL_MEMORY_VERSION_V1 = 'KairosV5HierarchicalMemoryV13' as const;
export const HIERARCHICAL_MEMORY_SEMANTICS_V1 =
  'R1-atom-with-public-transition-audit_R2-continuous-event-physical-corridor_R2A-physical-road-density-partition_R3-current-query' as const;

export interface R1ExperienceAtomV2 {
  readonly version: 'R1ExperienceAtomV5';
  readonly eventId: string;
  readonly atomId: string;
  readonly anchorId: string;
  readonly pageId: string;
  readonly traceId: string;
  readonly cue: ActionCue;
  readonly kind: 'action' | 'passive';
  readonly startedAt: number;
  readonly endedAt: number;
  readonly startObservationSequence: number;
  readonly endObservationSequence: number;
  readonly observationScopeIds: readonly string[];
  /** Event-local role provenance. It contains no original object ID or
   * spatial coordinate and therefore cannot copy a historical world binding. */
  readonly publicRoleBindings: readonly EventLocalPublicRoleBindingV1[];
  readonly context: ReturnType<typeof relativePublicFeatures>;
  readonly afterContext: ReturnType<typeof relativePublicFeatures>;
  readonly contextId: string;
  readonly completion: 'complete' | 'censored';
  /** Event-local compatibility identity consumed by R2/R2A. */
  readonly publicTransitionTopologyId: string;
  /** Full event-local public-resolution transition identity retained only for audit. */
  readonly publicTransitionTopologyAuditId: string;
  readonly r2Coordinate: readonly number[];
  readonly beforeFactorPerception: readonly number[];
  readonly afterFactorPerception: readonly number[];
  /** Original public/world facts used by grounded recall and prediction readout. */
  readonly kernelChanges: readonly (readonly PublicChange[])[];
  /** Self-centred measurement facts used only by the physical representation. */
  readonly measurementChanges: readonly (readonly PublicChange[])[];
}

export interface HierarchyReplayRecordV1 {
  readonly version: 'HierarchyReplayRecordV3';
  readonly atom: R1ClosedEventAtomStateV1;
  readonly contextId: string;
  readonly exactExperienceIdentity: string;
  readonly preEventPerception: readonly number[];
  readonly boundaryBefore: 'continuous' | 'reset' | 'gap' | 'external-takeover';
  readonly closeAfter: R2EventBoundaryV1 | null;
  readonly closedAtActiveSeconds: number | null;
}

export type HierarchyInterventionLedgerRecordV1 =
  | { readonly version: 'HierarchyInterventionLedgerRecordV3'; readonly kind: 'protocol';
    readonly afterProcessedR2EventCount: number;
    readonly input: R2AInterventionProtocolRegistrationV3;
    readonly registered: R2AInterventionProtocolV1 }
  | { readonly version: 'HierarchyInterventionLedgerRecordV3'; readonly kind: 'result';
    readonly afterProcessedR2EventCount: number; readonly evidence: R2AInterventionEvidenceV1 };

export interface HierarchicalMemorySnapshotV1 {
  readonly version: typeof HIERARCHICAL_MEMORY_VERSION_V1;
  readonly hierarchy: typeof HIERARCHICAL_MEMORY_SEMANTICS_V1;
  readonly activeSeconds: number;
  readonly eventMap: EmbeddingState | null;
  readonly contextKeys: readonly string[];
  readonly contextVocabulary: readonly string[];
  readonly r2AtomAdapter: R2AtomMeasurementAdapterStateV3 | null;
  readonly tokenEncoder: ReturnType<DeterministicTokenFieldEncoder['exportState']> | null;
  readonly r1Store: HierarchicalR1StoreCheckpointV1;
  readonly r2Store: R2ContinuousEventStoreStateV1;
  readonly r2a: R2AStablePatternGraphStateV1 | null;
  readonly annotations: readonly R1ExperienceAtomV2[];
  readonly hierarchyReplayLedger: readonly HierarchyReplayRecordV1[];
  readonly hierarchyInterventionLedger: readonly HierarchyInterventionLedgerRecordV1[];
  readonly pendingInitialization: readonly RealEvent[];
  readonly seenEventIds: readonly string[];
  readonly writes: number;
}

export interface HierarchicalMemoryObservationReceiptV1 {
  readonly status: 'initialization-buffer' | 'real-event-deposited' | 'real-event-not-representable';
  readonly writes: number;
  readonly buffered: number;
  readonly mapSha256: string | null;
  readonly r1Atoms: number;
  readonly r2ContinuousEvents: number;
  readonly r2aStablePatterns: number;
  readonly representationRejection: { readonly reason: string; readonly unknownKeys?: readonly string[];
    readonly maximumAdjacentGap?: number } | null;
}

class FrozenRepresentationMiss extends Error {
  constructor(readonly rejection: NonNullable<HierarchicalMemoryObservationReceiptV1['representationRejection']>) {
    super(rejection.reason);
  }
}

export function isOpenCrosshairCategoryFeatureV1(key: string): boolean {
  return key.startsWith('crosshair/target-type=')
    || /^change\/crosshair\/type\/(?:before|after)=/.test(key);
}

function matches(change: PublicChange, desired: DesiredChange): boolean {
  if (desired.subject && change.subject !== desired.subject && !change.subject.startsWith(`${desired.subject}#`)) return false;
  if (desired.property && change.property !== desired.property) return false;
  if (desired.value !== undefined && change.after !== desired.value) return false;
  if (desired.direction === 'increase') return typeof change.before === 'number' && typeof change.after === 'number' && change.after > change.before;
  if (desired.direction === 'decrease') return typeof change.before === 'number' && typeof change.after === 'number' && change.after < change.before;
  if (desired.direction === 'unchanged') return change.before === change.after;
  return desired.direction !== 'change' || change.before !== change.after;
}

/** The public state attached to one physical kernel is the cumulative event
 * prefix up to that kernel. It contains no historical frame or unobserved
 * field: only changes that were encoded before this point on the real trace. */
export function cumulativePublicChangePrefixV1(kernelChanges: readonly (readonly PublicChange[])[],
  throughKernelIndex: number): readonly PublicChange[] {
  assert(Number.isSafeInteger(throughKernelIndex) && throughKernelIndex >= 0
    && throughKernelIndex < kernelChanges.length, 'public-change-prefix-kernel-out-of-range');
  const terminal = new Map<string, PublicChange>();
  const last = Math.min(throughKernelIndex, kernelChanges.length - 1);
  for (let kernelIndex = 0; kernelIndex <= last; kernelIndex++) {
    for (const change of kernelChanges[kernelIndex] ?? []) {
      const key = `${change.subject}/${change.property}`;
      const first = terminal.get(key);
      terminal.set(key, { ...change, before: first?.before ?? change.before });
    }
  }
  return [...terminal.values()].sort((left, right) =>
    `${left.subject}/${left.property}`.localeCompare(`${right.subject}/${right.property}`, 'en'));
}

export type PredictionRoleBindingStatusV1 = 'not-required' | 'matched' | 'goal-change-not-reached'
  | 'provenance-missing' | 'target-unavailable' | 'descriptor-mismatch' | 'ambiguous';

export interface PredictionGoalReadoutEvaluationV1 {
  readonly advances: boolean;
  readonly roleBindingStatus: PredictionRoleBindingStatusV1;
  readonly goalRelevantReadout: boolean;
}

function validEventLocalRoleBindingV1(value: unknown): value is EventLocalPublicRoleBindingV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EventLocalPublicRoleBindingV1> & Record<string, unknown>;
  if (candidate.version !== 'EventLocalPublicRoleBindingV1'
    || typeof candidate.role !== 'string' || candidate.role.length === 0
    || typeof candidate.type !== 'string' || candidate.type.length === 0
    || typeof candidate.directActionTarget !== 'boolean'
    || !candidate.stableProperties || typeof candidate.stableProperties !== 'object'
    || Array.isArray(candidate.stableProperties)) return false;
  return Object.values(candidate.stableProperties).every(item => item === null
    || typeof item === 'string' || typeof item === 'boolean'
    || typeof item === 'number' && Number.isFinite(item));
}

function annotationHasRoleBindingProvenanceV1(value: unknown): value is R1ExperienceAtomV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<R1ExperienceAtomV2>;
  if (candidate.version !== 'R1ExperienceAtomV5' || !Array.isArray(candidate.publicRoleBindings)
    || !candidate.publicRoleBindings.every(validEventLocalRoleBindingV1)) return false;
  const roles = candidate.publicRoleBindings.map(binding => binding.role);
  if (new Set(roles).size !== roles.length
    || candidate.publicRoleBindings.filter(binding => binding.directActionTarget).length > 1
    || !Array.isArray(candidate.kernelChanges)) return false;
  const eventLocalSubjects = new Set(candidate.kernelChanges.flat()
    .map(change => change.subject)
    .filter(subject => subject !== 'self' && subject !== 'crosshair' && subject !== 'event'));
  return [...eventLocalSubjects].every(subject => roles.includes(subject))
    && candidate.publicRoleBindings.every(binding => Object.keys(binding.stableProperties).every(property =>
      !candidate.kernelChanges!.flat().some(change => change.subject === binding.role
        && change.property === property && !Object.is(change.before, change.after))));
}

function aggregateRoleBindingStatusV1(statuses: readonly PredictionRoleBindingStatusV1[],
  grounded: boolean): PredictionRoleBindingStatusV1 {
  const priority: readonly PredictionRoleBindingStatusV1[] = ['ambiguous', 'provenance-missing',
    'target-unavailable', 'descriptor-mismatch', 'matched'];
  return priority.find(status => statuses.includes(status))
    ?? (statuses.includes('not-required') ? 'not-required'
      : statuses.includes('goal-change-not-reached') || grounded ? 'goal-change-not-reached' : 'not-required');
}

/** Score only strict goal-residual reduction in the partial public state
 * reached by a physical sample. Unknown predicates stay unknown. Event-local
 * object roles must be uniquely grounded by public provenance retained from
 * the real event; type or array order alone is never a binding. */
export function evaluatePredictionChangesAgainstGoalV1(base: Observation, goal: GroundedGoalV1,
  currentEvaluation: GoalEvaluationV1, changes: readonly PublicChange[],
  roleBindings: readonly EventLocalPublicRoleBindingV1[]): PredictionGoalReadoutEvaluationV1 {
  assert(currentEvaluation.goalId === goal.id
    && currentEvaluation.observationSequence === base.sequence,
  'prediction-goal-evaluation-does-not-match-base-observation');
  const currentById = new Map(currentEvaluation.predicates.map(value => [value.predicateId, value]));
  const bindingStatuses: PredictionRoleBindingStatusV1[] = [];
  let goalRelevantReadout = false;
  const roleMatch = (predicate: GoalPredicateV1, change: PublicChange):
    'matched' | 'irrelevant' | Exclude<PredictionRoleBindingStatusV1, 'not-required' | 'goal-change-not-reached'> => {
    const subject = predicate.subject;
    if (subject.kind === 'self') return change.subject === 'self' ? 'matched' : 'irrelevant';
    if (subject.kind === 'crosshair') return change.subject === 'crosshair' ? 'matched' : 'irrelevant';
    const exact = base.objects.find(object => object.id === subject.id
      && object.type === subject.expectedType);
    if (!exact) return 'target-unavailable';
    if (change.subject === subject.id) return 'matched';
    const binding = roleBindings.find(value => value.role === change.subject);
    if (!binding) return change.subject.startsWith(`${subject.expectedType}#`)
      ? 'provenance-missing' : 'irrelevant';
    if (binding.type !== subject.expectedType) return 'descriptor-mismatch';
    const matchesDescriptor = base.objects.filter(object => object.type === binding.type
      && (!binding.directActionTarget || object.id === base.targetId)
      && Object.entries(binding.stableProperties).every(([property, value]) =>
        Object.prototype.hasOwnProperty.call(object.properties, property)
        && Object.is(object.properties[property], value)));
    if (matchesDescriptor.length > 1) return 'ambiguous';
    if (matchesDescriptor.length === 0 || matchesDescriptor[0]!.id !== exact.id)
      return 'descriptor-mismatch';
    return 'matched';
  };
  const latest = (predicate: GoalPredicateV1, property: string): readonly PublicChange[] =>
    changes.filter(change => {
      if (change.property !== property) return false;
      const status = roleMatch(predicate, change);
      if (predicate.subject.kind === 'public-object' && status !== 'irrelevant') bindingStatuses.push(status);
      if (status === 'matched') goalRelevantReadout = true;
      return status === 'matched';
    });
  const predictedValue = (predicate: GoalPredicateV1): PublicValue | number | null | undefined => {
    const key = predicate.observable;
    if (key.startsWith('properties.')) {
      const change = latest(predicate, key.slice('properties.'.length)).at(-1);
      const current = groundedPublicObservableV1(predicate, base);
      if (!change) return undefined;
      return current === change.before ? change.after : undefined;
    }
    if (predicate.subject.kind === 'self' && key.startsWith('position.')) {
      const axis = Number(key.at(-1)) as 0 | 1 | 2;
      const change = latest(predicate, `displacement.${axis}`).at(-1);
      return change && typeof change.before === 'number' && typeof change.after === 'number'
        ? base.self.position[axis]! + change.after - change.before : undefined;
    }
    if (predicate.subject.kind === 'self' && (key === 'yaw' || key === 'pitch')) {
      const change = latest(predicate, key).at(-1);
      return change && typeof change.before === 'number' && typeof change.after === 'number'
        ? base.self[key] + change.after - change.before : undefined;
    }
    if (key === 'type' || key === 'visible') return latest(predicate, key).at(-1)?.after;
    if (key === 'relativeDistance') {
      const baseValue = groundedPublicObservableV1(predicate, base);
      const deltas = latest(predicate, 'relativeDistance');
      if (typeof baseValue !== 'number' || deltas.length === 0) return undefined;
      return deltas.reduce((value, change) => typeof change.before === 'number'
        && typeof change.after === 'number' ? value + change.after - change.before : value, baseValue);
    }
    // Object world displacement cannot establish a relative-position goal.
    return undefined;
  };
  type Progress = 'improved' | 'unchanged' | 'worsened' | 'unknown';
  const predicateProgress = (predicate: GoalPredicateV1): Progress => {
    const actual = predictedValue(predicate);
    if (actual === undefined) return 'unknown';
    const before = currentById.get(predicate.id);
    assert(before, `prediction-goal-evaluation-missing-predicate:${predicate.id}`);
    const after = evaluateGroundedPredicateValueV1(predicate, actual, before.baseline);
    if (after.status === 'unknown') return 'unknown';
    if (after.residual < before.residual - 1e-12) return 'improved';
    if (after.residual > before.residual + 1e-12) return 'worsened';
    return 'unchanged';
  };
  const expressionProgress = (expression: GoalExpressionV1): Progress => {
    if (expression.kind === 'predicate') return predicateProgress(expression.predicate);
    const children = expression.children.map(expressionProgress);
    if (expression.kind === 'any') return children.includes('improved') ? 'improved'
      : children.includes('unknown') ? 'unknown'
        : children.includes('worsened') ? 'worsened' : 'unchanged';
    if (children.includes('worsened')) return 'worsened';
    if (children.includes('improved')) return 'improved';
    return children.includes('unknown') ? 'unknown' : 'unchanged';
  };
  const advances = expressionProgress(goal.expression) === 'improved';
  const hasPublicObjectPredicate = (expression: GoalExpressionV1): boolean => expression.kind === 'predicate'
    ? expression.predicate.subject.kind === 'public-object'
    : expression.children.some(hasPublicObjectPredicate);
  const roleBindingStatus = aggregateRoleBindingStatusV1(bindingStatuses,
    hasPublicObjectPredicate(goal.expression));
  return { advances, roleBindingStatus, goalRelevantReadout };
}

export function predictionChangesAdvanceGoalV1(base: Observation, goal: GroundedGoalV1,
  currentEvaluation: GoalEvaluationV1, changes: readonly PublicChange[],
  roleBindings: readonly EventLocalPublicRoleBindingV1[] = []): boolean {
  return evaluatePredictionChangesAgainstGoalV1(base, goal, currentEvaluation, changes, roleBindings).advances;
}

function readVisitedRegions(snapshot: R1TraceSnapshot, trajectory: readonly Vec3[],
  annotations: readonly (readonly PublicChange[])[], previsitedKernelIndices: readonly number[] = []): {
    readout: Prediction['samples'][number]['readout'];
    visitedKernelIndices: readonly number[]; reason: string | null } {
  const readout: Prediction['samples'][number]['readout'][number][] = [], visited = new Set(previsitedKernelIndices);
  let collision = false;
  trajectory.forEach((position, sampleStep) => {
    if (sampleStep === 0) return;
    const local = snapshot.kernels.map((kernel, kernelIndex) => ({ kernelIndex, kernel,
      distance: Math.hypot(...position.map((value, axis) => value - kernel.center[axis]!)) }))
      .filter(item => item.distance <= item.kernel.sigma * .25 && item.kernel.coefficient < -1e-7)
      .sort((a, b) => a.distance - b.distance);
    const nearest = local[0]; if (!nearest) return;
    const same = local.filter(item => Math.abs(item.distance - nearest.distance) < 1e-6);
    const values = new Map<string, unknown>();
    for (const item of same) for (const change of annotations[item.kernelIndex] ?? []) {
      const key = `${change.subject}/${change.property}`;
      if (values.has(key) && values.get(key) !== change.after) collision = true;
      values.set(key, change.after);
    }
    if (collision || visited.has(nearest.kernelIndex)) return;
    visited.add(nearest.kernelIndex);
    const changes = annotations[nearest.kernelIndex] ?? [];
    if (changes.length > 0) readout.push({ sampleStep, kernelIndex: nearest.kernelIndex,
      originalKernelIndex: nearest.kernelIndex, distance: nearest.distance,
      potential: nearest.kernel.coefficient * Math.exp(-.5 * (nearest.distance / nearest.kernel.sigma) ** 2), changes });
  });
  return { readout: collision ? [] : readout, visitedKernelIndices: [...visited].sort((a, b) => a - b),
    reason: collision ? 'indistinguishable-local-outcomes'
      : readout.length === 0 ? 'random-trajectory-did-not-reach-readout' : null };
}

const gradeRank: Record<R2AEvidenceGradeV1, number> = {
  'single-observation': 0, 'repeated-correlation': 1, 'predictive-stable': 2,
  'causal-hypothesis': 3, 'intervention-supported': 4,
};

export interface HierarchicalUpperReplayResultV1 {
  readonly version: 'HierarchicalUpperReplayResultV1';
  readonly r2Store: R2ContinuousEventStoreStateV1;
  readonly r2a: R2AStablePatternGraphStateV1;
}

/**
 * Deterministically rebuild only the derived upper layers from immutable R1
 * atom records.  This is intentionally not a legacy-state migration: it
 * accepts the new hierarchy checkpoint and ignores its stored R2/R2A state
 * while replaying the auditable ledger and real close times.
 */
export function rebuildHierarchicalUpperLayersV1(snapshot: HierarchicalMemorySnapshotV1):
  HierarchicalUpperReplayResultV1 {
  assert(snapshot.version === HIERARCHICAL_MEMORY_VERSION_V1 && snapshot.tokenEncoder !== null,
    'upper-replay-requires-new-hierarchy-and-frozen-encoder');
  assert(Array.isArray(snapshot.hierarchyInterventionLedger),
    'legacy-hierarchy-without-intervention-ledger-is-audit-only');
  assert(snapshot.r2AtomAdapter !== null, 'upper-replay-requires-qualified-R2-adapter');
  const r2AdapterIdentity = R2AtomMeasurementAdapterV1.restore(snapshot.r2AtomAdapter)
    .exportState().identitySha256;
  const encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
  const r2Store = new R2ContinuousEventStore();
  const r2a = new R2AStablePatternLearnerV1(encoder, undefined, r2AdapterIdentity);
  const annotationByAtom = new Map(snapshot.annotations.map(value => [value.atomId, value]));
  assert(annotationByAtom.size === snapshot.annotations.length, 'upper-replay-R1-annotation-identity-invalid');
  let logicalTime = 0;
  let openLast: R1ClosedEventAtomV1 | null = null;
  const advanceTo = (activeSeconds: number): void => {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= logicalTime,
      'upper-replay-time-reversed');
    const elapsed = activeSeconds - logicalTime;
    if (elapsed > 0) { r2Store.recover(elapsed); r2a.advanceTo(activeSeconds); logicalTime = activeSeconds; }
  };
  let lastCloseTime = 0;
  let interventionCursor = 0;
  const replayInterventionsAtCurrentEvidenceCount = (): void => {
    const processedCount = r2a.snapshot().evidence.length;
    while (interventionCursor < snapshot.hierarchyInterventionLedger.length) {
      const record = snapshot.hierarchyInterventionLedger[interventionCursor]!;
      assert(record.version === 'HierarchyInterventionLedgerRecordV3'
        && Number.isSafeInteger(record.afterProcessedR2EventCount)
        && record.afterProcessedR2EventCount >= 0,
      'invalid-hierarchy-intervention-ledger-record');
      if (record.afterProcessedR2EventCount > processedCount) break;
      assert(record.afterProcessedR2EventCount === processedCount,
        'hierarchy-intervention-ledger-order-or-time-invalid');
      if (record.kind === 'protocol') {
        const registered = r2a.registerInterventionProtocol(record.input);
        assert(canonical(registered) === canonical(record.registered),
          'hierarchy-intervention-protocol-replay-mismatch');
      } else r2a.recordIntervention(record.evidence);
      interventionCursor++;
    }
  };
  for (const record of snapshot.hierarchyReplayLedger) {
    const annotation = annotationByAtom.get(record.atom.atomId);
    assert(record.version === 'HierarchyReplayRecordV3'
      && (record.closeAfter === null) === (record.closedAtActiveSeconds === null)
      && record.exactExperienceIdentity === record.atom.exactExperienceIdentity
      && annotation?.publicTransitionTopologyId === record.atom.publicTransitionTopologyId
      && annotation?.publicTransitionTopologyId
        === publicTransitionTopologyFromChangesV1(annotation.measurementChanges).compatibilitySha256
      && annotation?.publicTransitionTopologyAuditId
        === publicTransitionTopologyFromChangesV1(annotation.measurementChanges).identitySha256
      && record.preEventPerception.length === 256
      && record.preEventPerception.every(Number.isFinite)
      && annotation?.completion === 'complete'
      && record.atom.sourceEventId === annotation.eventId
      && record.atom.startedAt === annotation.startedAt && record.atom.endedAt === annotation.endedAt
      && record.atom.startFrameSequence === annotation.startObservationSequence
      && record.atom.endFrameSequence === annotation.endObservationSequence
      && canonical(record.atom.r2Coordinate) === canonical(annotation.r2Coordinate)
      && record.contextId === annotation.contextId
      && record.exactExperienceIdentity === cueIdentity(annotation.cue)
      && canonical(record.preEventPerception) === canonical(annotation.beforeFactorPerception),
    'invalid-upper-replay-record');
    const atom: R1ClosedEventAtomV1 = { ...record.atom,
      r2Coordinate: new Float64Array(record.atom.r2Coordinate) };
    advanceTo(atom.endedAt);
    if (record.boundaryBefore !== 'continuous') {
      assert(openLast === null, 'upper-replay-boundary-did-not-close-prior-chain');
    }
    if (openLast === null) r2Store.begin(atom);
    else {
      const continuity = assessR2ContinuityV1(openLast, atom);
      assert(continuity.continuous, `upper-replay-continuity-mismatch:${continuity.continuous ? '' : continuity.reason}`);
      r2Store.append(atom);
    }
    openLast = atom;
    if (record.closeAfter !== null) {
      assert(record.closedAtActiveSeconds! >= atom.endedAt
        && record.closedAtActiveSeconds! >= lastCloseTime,
      'upper-replay-close-time-invalid');
      advanceTo(record.closedAtActiveSeconds!);
      const receipt = r2Store.close(record.closeAfter);
      if (receipt.status === 'committed' && receipt.event.learningEligible) {
        const eventRecords = receipt.event.atomIds.map(atomId => snapshot.hierarchyReplayLedger
          .find(value => value.atom.atomId === atomId));
        assert(eventRecords.every((value): value is HierarchyReplayRecordV1 => value !== undefined),
          'upper-replay-R2-atom-evidence-missing');
        r2a.observe({ version: 'R2PatternEvidenceInputV1', event: receipt.event,
          contextId: record.contextId,
          atomPrePerceptions: eventRecords.map(value => new Float64Array(value.preEventPerception)),
          trustedActualObservation: true },
        (pageId, traceId) => r2Store.isTraceActive(pageId, traceId));
        replayInterventionsAtCurrentEvidenceCount();
      }
      lastCloseTime = record.closedAtActiveSeconds!;
      openLast = null;
    }
  }
  replayInterventionsAtCurrentEvidenceCount();
  assert(interventionCursor === snapshot.hierarchyInterventionLedger.length,
    'hierarchy-intervention-ledger-references-unreached-R2-evidence');
  advanceTo(snapshot.activeSeconds);
  return { version: 'HierarchicalUpperReplayResultV1', r2Store: r2Store.snapshot(), r2a: r2a.snapshot() };
}

export class HierarchicalPhysicalMemoryV1 {
  #r1Store = new HierarchicalR1StoreV1();
  #r2Store = new R2ContinuousEventStore();
  #map: DistanceEmbedding | null = null;
  #r2Adapter: R2AtomMeasurementAdapterV1 | null = null;
  #encoder = new DeterministicTokenFieldEncoder();
  #r2a: R2AStablePatternLearnerV1 | null = null;
  #contextKeys: string[] = [];
  #contextVocabulary: string[] = [];
  #annotations: R1ExperienceAtomV2[] = [];
  #ledger: HierarchyReplayRecordV1[] = [];
  #interventionLedger: HierarchyInterventionLedgerRecordV1[] = [];
  #pending: RealEvent[] = [];
  #seen = new Set<string>();
  #activeSeconds = 0;
  #writes = 0;
  #openLastAtom: R1ClosedEventAtomV1 | null = null;
  readonly #audit = emptyLeakageAudit();
  readonly #rejections = emptyFirewallRejections();
  readonly #gate = new ObservationGate(this.#audit, this.#rejections);
  readonly #clone = new PredictionClone(this.#audit, this.#rejections);

  get ready(): boolean { return this.#map !== null; }
  get writes(): number { return this.#writes; }
  get bufferedEvents(): number { return this.#pending.length; }
  get mapSha256(): string | null { return this.#map ? sha(this.#map.state) : null; }

  #r2AdapterIdentity(): string {
    assert(this.#r2Adapter !== null, 'R2A-operation-requires-qualified-R2-adapter');
    return this.#r2Adapter.exportState().identitySha256;
  }

  advanceTo(activeSeconds: number): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= this.#activeSeconds, 'active-observation-time-reversed');
    // Empty pre-calibration media still carry the same physical clock as the
    // trusted event buffer.  This keeps a <128-event checkpoint restorable
    // without pretending that buffered events have already been deposited.
    this.#advanceStores(activeSeconds - this.#activeSeconds);
    this.#activeSeconds = activeSeconds;
  }

  observe(event: RealEvent): HierarchicalMemoryObservationReceiptV1 {
    validateEvent(event); assert(!this.#seen.has(event.id), 'real-event-already-observed');
    const end = event.frames.at(-1)!.activeSeconds;
    assert(end >= this.#activeSeconds, 'event-arrived-after-time-was-advanced-past-it');
    if (!this.ready) {
      this.advanceTo(end);
      this.#pending.push(structuredClone(event)); this.#seen.add(event.id);
      if (this.#pending.length === 128) this.#initialize(this.#pending);
    } else {
      this.advanceTo(end);
      try { this.#depositR1ThenAssemble(event); }
      catch (error) {
        if (error instanceof FrozenRepresentationMiss) {
          this.#seen.add(event.id); return this.#receipt('real-event-not-representable', error.rejection);
        }
        // R1 is the immutable real fact. If an upper-layer transaction fails
        // after that fact was committed, it stays committed and cannot be
        // replayed into the same live instance as a second R1 atom.
        if (this.#annotations.some(annotation => annotation.eventId === event.id)) this.#seen.add(event.id);
        throw error;
      }
      this.#seen.add(event.id);
    }
    return this.#receipt(this.ready ? 'real-event-deposited' : 'initialization-buffer', null);
  }

  /** Explicit real continuity boundary. It never closes an event from a goal or prediction. */
  closeContinuity(boundary: R2EventBoundaryV1): R2CloseReceiptV1 | null {
    if (!this.#openLastAtom) return null;
    return this.#closeOpen(boundary);
  }

  /**
   * Freeze a matched-intervention question before either member of its pair is
   * observed.  R2A owns the evidence ordinal; callers cannot back-date it.
   */
  registerMatchedInterventionProtocol(input: R2AInterventionProtocolRegistrationV3): R2AInterventionProtocolV1 {
    assert(this.#r2a !== null, 'R2A-intervention-protocol-requires-initialized-hierarchy');
    const staged = new R2AStablePatternLearnerV1(this.#encoder, this.#r2a.snapshot(), this.#r2AdapterIdentity());
    const registered = staged.registerInterventionProtocol(input);
    this.#r2a = staged;
    this.#interventionLedger.push({ version: 'HierarchyInterventionLedgerRecordV3', kind: 'protocol',
      afterProcessedR2EventCount: registered.registeredEvidenceCount,
      input: structuredClone(input),
      registered: structuredClone(registered) });
    return structuredClone(registered);
  }

  /** Register the real result of a previously frozen protocol. */
  recordMatchedIntervention(value: R2AInterventionEvidenceV1): void {
    assert(this.#r2a !== null, 'R2A-intervention-requires-initialized-hierarchy');
    const staged = new R2AStablePatternLearnerV1(this.#encoder, this.#r2a.snapshot(), this.#r2AdapterIdentity());
    staged.recordIntervention(value);
    const stagedState = staged.snapshot();
    const normalizedEvidence = stagedState.interventionRecords.find(item => item.pairId === value.pairId
      && item.relationId === value.relationId);
    assert(normalizedEvidence !== undefined, 'R2A-intervention-normalized-record-missing');
    const existing = this.#interventionLedger.find(item => item.kind === 'result'
      && item.evidence.relationId === normalizedEvidence.relationId
      && item.evidence.pairId === normalizedEvidence.pairId);
    if (existing) {
      assert(existing.kind === 'result' && sha(existing.evidence) === sha(normalizedEvidence),
        'R2A-intervention-pair-id-reused-with-different-evidence');
      return;
    }
    this.#r2a = staged;
    this.#interventionLedger.push({ version: 'HierarchyInterventionLedgerRecordV3', kind: 'result',
      afterProcessedR2EventCount: stagedState.evidence.length, evidence: structuredClone(normalizedEvidence) });
  }

  #receipt(status: HierarchicalMemoryObservationReceiptV1['status'],
    rejection: HierarchicalMemoryObservationReceiptV1['representationRejection']): HierarchicalMemoryObservationReceiptV1 {
    return { status, writes: this.#writes, buffered: this.bufferedEvents, mapSha256: this.mapSha256,
      r1Atoms: this.#r1Store.atomCount, r2ContinuousEvents: this.#r2Store.committedEventCount,
      r2aStablePatterns: this.#r2a?.patterns().filter(pattern => pattern.grade !== 'single-observation').length ?? 0,
      representationRejection: rejection };
  }

  #advanceStores(elapsed: number): void {
    if (elapsed <= 0) return;
    this.#r1Store.recover(elapsed); this.#r2Store.recover(elapsed);
    if (this.#r2a) this.#r2a.advanceTo(this.#r2a.logicalTime + elapsed);
  }

  #initialize(events: readonly RealEvent[]): void {
    assert(!this.#map && events.length === 128, 'single-128-real-event-initialization-only');
    const series = events.map(eventRows), embedding = DistanceEmbedding.fit(series.flatMap(item => item.rows));
    let maximumAdjacentGap = 0;
    for (const item of series) {
      const points = item.rows.map(row => embedding.encode(row).coordinate);
      for (let index = 1; index < points.length; index += 1) maximumAdjacentGap = Math.max(maximumAdjacentGap,
        Math.hypot(...points[index]!.map((value, axis) => value - points[index - 1]![axis]!)));
    }
    assert(maximumAdjacentGap > 1e-12, 'event-map-collapsed');
    const eventMap = new DistanceEmbedding({ ...embedding.state,
      scale: R1_CONFIG.kernelWidth * .4 / maximumAdjacentGap });
    const contexts = events.map(event => relativePublicFeatures(event.frames[0]!));
    const vocabulary = events.flatMap(event => [relativePublicFeatures(event.frames[0]!),
      relativePublicFeatures(event.frames.at(-1)!)]);
    const contextVocabulary = [...new Set(vocabulary.flatMap(row => Object.keys(row)))].sort();
    const contextKeys = [...new Set(contexts.flatMap(row => Object.keys(row)))].sort((left, right) => {
      const energy = (key: string) => contexts.reduce((sum, row) => sum + (row[key] ?? 0) ** 2, 0);
      return energy(right) - energy(left) || left.localeCompare(right);
    }).slice(0, 256);
    // Build all representation and physical state on a private instance.  A
    // failed 128-event calibration cannot expose a half-fitted map or a
    // partially deposited R1/R2/R2A hierarchy.
    const staged = new HierarchicalPhysicalMemoryV1();
    staged.#map = eventMap; staged.#contextVocabulary = contextVocabulary; staged.#contextKeys = contextKeys;
    const raw = events.map(event => staged.#raw(event));
    staged.#r2Adapter = R2AtomMeasurementAdapterV1.fit(raw.map(value => value.trajectory));
    staged.#encoder.fit(events.flatMap(event => [staged.#perception(event.frames[0]!),
      staged.#perception(event.frames.at(-1)!)]));
    staged.#encoder.freeze(); staged.#r2a = new R2AStablePatternLearnerV1(staged.#encoder, undefined,
      staged.#r2AdapterIdentity());
    let storeTime = 0;
    for (const event of events) {
      const end = event.frames.at(-1)!.activeSeconds, elapsed = end - storeTime;
      if (elapsed > 0) { staged.#r1Store.recover(elapsed); staged.#r2Store.recover(elapsed);
        staged.#r2a.advanceTo(end); }
      staged.#activeSeconds = end; storeTime = end; staged.#depositR1ThenAssemble(event);
    }
    staged.#seen = new Set(this.#seen); staged.#pending = [];
    this.#map = staged.#map; this.#contextVocabulary = staged.#contextVocabulary;
    this.#contextKeys = staged.#contextKeys; this.#r2Adapter = staged.#r2Adapter;
    this.#encoder = staged.#encoder; this.#r1Store = staged.#r1Store; this.#r2Store = staged.#r2Store;
    this.#r2a = staged.#r2a; this.#annotations = staged.#annotations; this.#ledger = staged.#ledger;
    this.#writes = staged.#writes; this.#openLastAtom = staged.#openLastAtom;
    this.#interventionLedger = []; this.#pending = [];
  }

  #perception(observation: Observation): Float64Array {
    const row = relativePublicFeatures(observation);
    return Float64Array.from({ length: 256 }, (_, index) => row[this.#contextKeys[index] ?? ''] ?? 0);
  }

  #raw(event: RealEvent): RawExperience {
    assert(this.#map, 'event-map-not-frozen');
    const encoded = eventRows(event).rows.map(row => this.#map!.encode(row));
    const trajectory = encoded.map(point => new Float64Array(point.coordinate));
    let maximumAdjacentGap = 0;
    for (let index = 1; index < trajectory.length; index += 1) maximumAdjacentGap = Math.max(maximumAdjacentGap,
      Math.hypot(...trajectory[index]!.map((value, axis) => value - trajectory[index - 1]![axis]!)));
    if (maximumAdjacentGap > .06 + 1e-9) throw new FrozenRepresentationMiss({
      reason: 'event-map-sampling-disconnected', maximumAdjacentGap });
    const vocabulary = new Set(this.#contextVocabulary);
    const unknownKeys = [...new Set([...encoded.flatMap(value => value.unknownKeys),
      ...[event.frames[0]!, event.frames.at(-1)!].flatMap(frame => Object.keys(relativePublicFeatures(frame)))
        .filter(key => !vocabulary.has(key))])]
      // Open categorical values for a presently visible crosshair target are
      // represented by the calibrated presence/change structure plus the
      // absence of a known one-hot type value. The exact public type remains
      // in the Observation and lossless change ledger. Treating every new
      // background material (including a before/after value encountered while
      // the ray sweeps across it) as a new R1 axis would make a frozen event
      // map unusable in an otherwise equivalent unseen layout. Structural
      // keys such as `observed` and every non-crosshair unknown remain strict.
      .filter(key => !isOpenCrosshairCategoryFeatureV1(key))
      .sort();
    if (unknownKeys.length > 0) throw new FrozenRepresentationMiss({ reason: 'unrepresented-public-features', unknownKeys });
    const tangent = pathInitialTangent(trajectory); assert(tangent, 'event-map-has-no-observed-progress');
    return { trajectory, perception: this.#perception(event.frames[0]!),
      r1State: { position: trajectory[0]!, velocity: tangent, causalPrefix: trajectory.slice(0, 2),
        observedAt: event.frames.at(-1)!.activeSeconds, numericAttributes: new Float64Array() },
      provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true,
        containsSimulatorPrivate: false, containsFutureObservation: false, containsSemanticRuleOrResult: false } };
  }

  #depositR1ThenAssemble(event: RealEvent): void {
    assert(this.#r2Adapter && this.#r2a, 'hierarchical-memory-not-initialized');
    const raw = this.#raw(event), trusted = this.#gate.admit(raw);
    // Complete every fallible representation check before the immutable R1
    // fact is deposited. An adapter failure can therefore never orphan R1.
    const coordinate = this.#r2Adapter.measure(raw.trajectory);
    const rows = eventRows(event);
    const transitionTopology = publicTransitionTopologyFromChangesV1(rows.measurementChanges);
    const atomId = `r1-atom-${sha({ eventId: event.id, cue: event.cue, frameIds: event.frames.map(frame => frame.sequence) })}`;
    const anchorId = `experience-anchor-${this.#r1Store.nextEventNumber.toString().padStart(6, '0')}`;
    const r1 = this.#r1Store.writeAtom(trusted, r1RouteSignature(raw.trajectory), atomId, anchorId);
    const completion = event.bodyResult?.terminationReason === 'observation-limit' ? 'censored' as const : 'complete' as const;
    const annotation: R1ExperienceAtomV2 = { version: 'R1ExperienceAtomV5', eventId: event.id, atomId, anchorId,
      pageId: r1.pageId, traceId: r1.traceId, cue: structuredClone(event.cue),
      kind: event.provenance === 'executed-real-body' ? 'action' : 'passive',
      startedAt: event.frames[0]!.activeSeconds, endedAt: event.frames.at(-1)!.activeSeconds,
      startObservationSequence: event.frames[0]!.sequence, endObservationSequence: event.frames.at(-1)!.sequence,
      observationScopeIds: [...new Set(event.trackedIds)].sort(),
      publicRoleBindings: structuredClone(rows.roleBindings),
      context: relativePublicFeatures(event.frames[0]!), afterContext: relativePublicFeatures(event.frames.at(-1)!),
      contextId: event.frames[0]!.contextId, completion,
      publicTransitionTopologyId: transitionTopology.compatibilitySha256,
      publicTransitionTopologyAuditId: transitionTopology.identitySha256,
      r2Coordinate: [...coordinate], beforeFactorPerception: [...this.#perception(event.frames[0]!)],
      afterFactorPerception: [...this.#perception(event.frames.at(-1)!)], kernelChanges: rows.changes,
      measurementChanges: rows.measurementChanges };
    this.#annotations.push(annotation); this.#writes++;
    const upperBefore = { r2: this.#r2Store.snapshot(), r2a: this.#r2a.snapshot(),
      ledgerLength: this.#ledger.length, openLastAtom: this.#openLastAtom };
    try {
      if (completion === 'censored') this.#interruptOpen('observation-ended');
      else this.#assembleR2AfterCommittedR1(event, annotation, coordinate);
    }
    catch (error) {
      this.#r2Store = R2ContinuousEventStore.restore(upperBefore.r2);
      this.#r2a = new R2AStablePatternLearnerV1(this.#encoder, upperBefore.r2a, this.#r2AdapterIdentity());
      this.#ledger.splice(upperBefore.ledgerLength);
      this.#openLastAtom = upperBefore.openLastAtom;
      throw error;
    }
  }

  #assembleR2AfterCommittedR1(event: RealEvent, annotation: R1ExperienceAtomV2,
    coordinate: Vec3): void {
    const continuity = event.hierarchyContinuity;
    if (!continuity || continuity.dependencies.length === 0) { this.#closeOpenComplete(); return; }
    const rawEvent: RealEvent = { ...event, hierarchyContinuity: undefined };
    const replayed = realEventHierarchyContinuityV1(rawEvent, continuity.sessionId, continuity.boundaryBefore);
    assert(canonical(replayed.dependencies) === canonical(continuity.dependencies)
      && replayed.processStatusAfter === continuity.processStatusAfter,
    'R2-continuity-metadata-does-not-match-public-event');
    // ActionCue contains kind, parameters and a public target role; concrete
    // target ids, outcomes, goals and world coordinates are absent by type.
    const atom: R1ClosedEventAtomV1 = { version: 'R1ClosedEventAtomV2', atomId: annotation.atomId,
      sourceEventId: event.id, exactExperienceIdentity: cueIdentity(annotation.cue),
      publicTransitionTopologyId: annotation.publicTransitionTopologyId,
      kind: event.provenance === 'executed-real-body' ? 'action' : 'passive', completion: 'complete',
      trustedActualObservation: true, publicOnly: true, sessionId: continuity.sessionId,
      continuityEpochId: continuity.continuityEpochId, startedAt: event.frames[0]!.activeSeconds,
      endedAt: event.frames.at(-1)!.activeSeconds, startFrameSequence: event.frames[0]!.sequence,
      endFrameSequence: event.frames.at(-1)!.sequence,
      publicContinuityDependencies: continuity.dependencies.map(value => ({ version: 'PublicContinuityDependencyV1',
        dependencyId: value.dependencyId, basis: value.basis, evidence: { version: 'PublicContinuityEvidenceReferenceV1',
          sourceEventId: event.id, subject: value.subject, property: value.property,
          beforeObservationSequence: value.beforeObservationSequence,
          afterObservationSequence: value.afterObservationSequence,
          beforeValueSha256: value.beforeValueSha256, afterValueSha256: value.afterValueSha256,
          factCategory: value.factCategory } })),
      coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1, r2Coordinate: coordinate };
    this.#ingestAtom(atom, annotation, continuity.boundaryBefore);
    if (continuity.processStatusAfter === 'publicly-resolved') this.#closeOpen({ version: 'R2EventBoundaryV1',
      completion: 'complete', reason: 'public-process-resolved' });
    else if (continuity.processStatusAfter === 'observation-insufficient') this.#interruptOpen('observation-ended');
  }

  #ingestAtom(atom: R1ClosedEventAtomV1, annotation: R1ExperienceAtomV2,
    boundaryBefore: HierarchyReplayRecordV1['boundaryBefore']): void {
    if (boundaryBefore !== 'continuous') this.#interruptOpen(boundaryBefore === 'gap' ? 'continuity-gap'
      : boundaryBefore === 'reset' || boundaryBefore === 'external-takeover' ? 'continuity-reset' : 'session-ended');
    if (!this.#openLastAtom) this.#r2Store.begin(atom);
    else {
      const assessment = assessR2ContinuityV1(this.#openLastAtom, atom);
      if (assessment.continuous) this.#r2Store.append(atom);
      else {
        if (assessment.reason === 'public-dependency-disconnected') this.#closeOpen({ version: 'R2EventBoundaryV1',
          completion: 'complete', reason: 'public-dependency-ended' });
        else if (assessment.reason === 'observation-gap') this.#interruptOpen('continuity-gap');
        else if (assessment.reason === 'session-changed') this.#interruptOpen('session-ended');
        else if (assessment.reason === 'epoch-reset') this.#interruptOpen('continuity-reset');
        else throw new Error(`invalid-real-R2-continuity:${assessment.reason}`);
        this.#r2Store.begin(atom);
      }
    }
    this.#openLastAtom = atom;
    this.#ledger.push({ version: 'HierarchyReplayRecordV3', atom: { ...atom, r2Coordinate: [...atom.r2Coordinate] },
      contextId: annotation.contextId, exactExperienceIdentity: cueIdentity(annotation.cue),
      preEventPerception: [...annotation.beforeFactorPerception], boundaryBefore, closeAfter: null,
      closedAtActiveSeconds: null });
  }

  #closeOpenComplete(): void {
    if (this.#openLastAtom) this.#closeOpen({ version: 'R2EventBoundaryV1', completion: 'complete',
      reason: 'public-dependency-ended' });
  }
  #interruptOpen(reason: 'observation-ended' | 'continuity-gap' | 'continuity-reset' | 'session-ended'): void {
    if (this.#openLastAtom) this.#closeOpen({ version: 'R2EventBoundaryV1', completion: 'censored', reason });
  }
  #closeOpen(boundary: R2EventBoundaryV1): R2CloseReceiptV1 {
    assert(this.#openLastAtom && this.#r2a, 'no-open-R2-event');
    // R2 deposition and delayed R2A observation form one memory transaction.
    // A failure in the upper layer must not leave a committed half-event.
    const stagedR2 = R2ContinuousEventStore.restore(this.#r2Store.snapshot());
    const stagedR2a = new R2AStablePatternLearnerV1(this.#encoder, this.#r2a.snapshot(),
      this.#r2AdapterIdentity());
    const receipt = stagedR2.close(boundary);
    if (receipt.status !== 'committed' || !receipt.event.learningEligible) {
      this.#r2Store = stagedR2; this.#r2a = stagedR2a;
      const ledger = this.#ledger.at(-1)!; Object.assign(ledger, { closeAfter: structuredClone(boundary),
        closedAtActiveSeconds: stagedR2a.logicalTime });
      this.#openLastAtom = null; return receipt;
    }
    const eventAnnotations = receipt.event.atomIds.map(atomId => this.#annotations.find(value => value.atomId === atomId));
    assert(eventAnnotations.every((value): value is R1ExperienceAtomV2 => value !== undefined),
      'R2-event-R1-annotation-missing');
    const terminal = eventAnnotations.at(-1)!;
    stagedR2a.observe({ version: 'R2PatternEvidenceInputV1', event: receipt.event,
      contextId: terminal.contextId,
      atomPrePerceptions: eventAnnotations.map(value => new Float64Array(value.beforeFactorPerception)),
      trustedActualObservation: true },
    (pageId, traceId) => stagedR2.isTraceActive(pageId, traceId));
    this.#r2Store = stagedR2; this.#r2a = stagedR2a;
    const ledger = this.#ledger.at(-1)!; Object.assign(ledger, { closeAfter: structuredClone(boundary),
      closedAtActiveSeconds: stagedR2a.logicalTime });
    this.#openLastAtom = null;
    return receipt;
  }

  #annotation(candidate: EffectRecallCandidateV1): R1ExperienceAtomV2 {
    const value = this.#annotations.find(annotation => annotation.eventId === candidate.evidence.eventId
      && annotation.anchorId === candidate.evidence.anchorId && annotation.pageId === candidate.evidence.r1.pageId
      && annotation.traceId === candidate.evidence.r1.traceId);
    assert(value && cueIdentity(value.cue) === cueIdentity(candidate.actionCue), 'unknown-or-modified-physical-candidate');
    return value;
  }

  #eventPatterns(annotation: R1ExperienceAtomV2) {
    const eventIds = new Set(this.#r2Store.events().filter(event => event.atomIds.includes(annotation.atomId)).map(event => event.eventId));
    return this.#r2a!.patterns().filter(pattern => pattern.memberEventIds.some(id => eventIds.has(id)));
  }

  #evidence(annotation: R1ExperienceAtomV2, observation?: Observation): PhysicalEvidenceReferenceV1 {
    const r1Active = this.#r1Store.medium.isTraceActive(annotation.pageId, annotation.traceId);
    const r2Events = this.#r2Store.events().filter(event => event.atomIds.includes(annotation.atomId)
      && event.pageId !== null && event.traceId !== null);
    const activeR2 = r2Events.map(event => ({ event,
      basin: this.#r2Store.basinContainingTrace(event.pageId!, event.traceId!) }))
      .filter((value): value is { event: typeof r2Events[number]; basin: NonNullable<typeof value.basin> } =>
        value.basin !== null);
    const patterns = this.#eventPatterns(annotation), patternById = new Map(patterns.map(value => [value.patternId, value]));
    const relations = this.#r2a!.relations().filter(relation => {
      const pattern = patternById.get(relation.targetPatternId);
      return pattern !== undefined && r2Events.some(event => pattern.memberEventIds.includes(event.eventId)
        && event.atomIds[relation.branchAtomIndex] === annotation.atomId
        && event.orderedExperienceIdentities[relation.branchAtomIndex] === relation.exactNextActionIdentity);
    });
    const comparisons = observation ? relations.map(relation => this.#r2a!.compareCurrentFactors(relation.relationId,
      this.#perception(observation))) : [];
    const applicability = comparisons.reduce((max, item) => Math.max(max, item.applicability), 0);
    const grades = [...patterns.map(pattern => pattern.grade), ...relations.map(relation => relation.grade)];
    const evidenceGrade = grades.sort((a, b) => gradeRank[b] - gradeRank[a])[0] ?? 'single-observation';
    return { eventId: annotation.eventId, anchorId: annotation.anchorId,
      r1: { pageId: annotation.pageId, traceId: annotation.traceId, active: r1Active },
      r2: { coordinate: [...annotation.r2Coordinate], active: activeR2.length > 0,
        ...(activeR2[0] ? { basin: { pageId: activeR2[0].event.pageId!,
          queriedTraceId: activeR2[0].event.traceId!, memberTraceIds: [...activeR2[0].basin.memberTraceIds].sort(),
          memberVisitIds: [...activeR2[0].basin.memberVisitIds].sort() } } : {}) },
      r2a: { relationIds: relations.map(value => value.relationId).sort(), applicability,
        productionEligible: comparisons.some(value => value.highConfidenceActionEligible), evidenceGrade,
        predictionEligible: comparisons.some(value => value.predictionEligible) } };
  }

  recallAtomicEffect(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    return this.recallByEffect(goal, goalDifference, observation);
  }
  recallByEffect(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    if (!this.ready) return [];
    const requests = desiredChangesForGoal(goal, goalDifference), result: EffectRecallCandidateV1[] = [];
    for (const annotation of this.#annotations) {
      if (annotation.completion !== 'complete') continue;
      if (!this.#r1Store.medium.isTraceActive(annotation.pageId, annotation.traceId)) continue;
      const matching = annotation.kernelChanges.flat().filter(change => requests.some(request => matches(change, request.desired)));
      if (matching.length === 0) continue;
      const evidence = this.#evidence(annotation, observation);
      result.push({ candidateId: sha({ eventId: annotation.eventId, atomId: annotation.atomId }),
        goalPredicateIds: [...new Set(requests.filter(request => matching.some(change => matches(change, request.desired)))
          .map(request => request.predicateId))].sort(), actionCue: structuredClone(annotation.cue),
        observedChanges: structuredClone(matching), observedBefore: structuredClone(annotation.context), evidence,
        unknown: [...new Set(['historical-atomic-effect-is-not-a-continuous-or-causal-rule',
          ...(evidence.r2.active ? [] : ['no-active-continuous-R2-event']),
          ...(evidence.r2a.predictionEligible ? [] : ['no-predictive-stable-current-pattern'])])] });
    }
    return result.sort((left, right) => Number(right.evidence.r2a.productionEligible) - Number(left.evidence.r2a.productionEligible)
      || Number(right.evidence.r2a.predictionEligible) - Number(left.evidence.r2a.predictionEligible)
      || right.evidence.r2a.applicability - left.evidence.r2a.applicability
      || left.candidateId.localeCompare(right.candidateId));
  }

  recallContinuousPattern(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): readonly ContinuousPatternRecallV2[] {
    const requests = desiredChangesForGoal(goal, goalDifference);
    return this.#r2a!.patterns().filter(pattern => {
      const memberEvents = pattern.memberEventIds
        .map(eventId => this.#r2Store.events().find(value => value.eventId === eventId))
        .filter((event): event is NonNullable<typeof event> => event !== undefined);
      const hasActiveR2Basis = memberEvents.some(event => event.pageId !== null && event.traceId !== null
        && this.#r2Store.isTraceActive(event.pageId, event.traceId));
      const hasRequestedEffect = memberEvents.some(event => event.atomIds.some(atomId =>
        this.#annotations.find(value => value.atomId === atomId)?.kernelChanges.flat()
          .some(change => requests.some(request => matches(change, request.desired))) ?? false));
      return hasActiveR2Basis && hasRequestedEffect;
    }).map(pattern => {
      const firstEvent = this.#r2Store.events().find(event => pattern.memberEventIds.includes(event.eventId));
      const active = pattern.memberEventIds.flatMap(eventId => {
        const event = this.#r2Store.events().find(value => value.eventId === eventId);
        return event?.pageId && event.traceId && this.#r2Store.isTraceActive(event.pageId, event.traceId) ? [event.traceId] : [];
      });
      const relations = this.#r2a!.relations().filter(value => value.targetPatternId === pattern.patternId);
      const comparisons = relations.map(value => this.#r2a!.compareCurrentFactors(value.relationId,
        this.#perception(observation)));
      const currentApplicability = comparisons.reduce((maximum, value) => Math.max(maximum, value.applicability), 0);
      const currentPredictionEligible = gradeRank[pattern.grade] >= gradeRank['predictive-stable']
        && (relations.length === 0 || comparisons.some(value => value.predictionEligible));
      return { patternId: pattern.patternId, memberR2EventIds: [...pattern.memberEventIds],
        orderedR1AtomIds: firstEvent ? [...firstEvent.atomIds] : [], evidenceGrade: pattern.grade,
        activePhysicalTraceIds: active, currentRelationIds: relations.map(value => value.relationId).sort(),
        currentApplicability: relations.length === 0 ? Number(active.length > 0) : currentApplicability,
        currentPredictionEligible, unknown: [...(gradeRank[pattern.grade] < gradeRank['predictive-stable']
          ? ['continuous-pattern-not-yet-predictive-stable'] : []),
        ...(gradeRank[pattern.grade] >= gradeRank['predictive-stable'] && !currentPredictionEligible
          ? ['continuous-pattern-current-factors-unsupported'] : [])] };
    }).sort((a, b) => gradeRank[b.evidenceGrade] - gradeRank[a.evidenceGrade] || a.patternId.localeCompare(b.patternId));
  }

  compareCurrentFactors(relationId: string, observation: Observation): ConditionApplicabilityV1 {
    const value = this.#r2a!.compareCurrentFactors(relationId, this.#perception(observation));
    return { matchedFactorIds: value.matchedFactorIds, contradictedFactorIds: value.conflictedFactorIds,
      unknownFactorIds: value.unknownFactorIds, applicability: value.applicability,
      productionEligible: value.highConfidenceActionEligible };
  }

  /** Evaluates every actually simulated factor state against the complete
   * parent R2A relation.  The readout is categorical by design: visiting one
   * changed factor is not equivalent to restoring the whole parent condition. */
  compareProjectedParentRelations(relationIds: readonly string[], observation: Observation,
    states: readonly HypotheticalPublicStateV1[],
    source: { readonly r1Active: boolean; readonly r2Active: boolean }):
    readonly ProjectedParentRelationApplicabilityV1[] {
    if (!this.#r2a) return [];
    const canonicalIds = [...new Set(relationIds)].sort((left, right) => left.localeCompare(right, 'en'));
    assert(canonicalIds.length === relationIds.length, 'projected-parent-relation-id-duplicated');
    const current = canonicalIds.map(id => this.#r2a!.compareCurrentFactors(id, this.#perception(observation)));
    return states.map(state => {
      assert(state.baseObservationSequence === observation.sequence,
        'projected-parent-relation-observation-version-mismatch');
      const selection = selectProjectedR2ARelationV1(current, {
        version: 'R2AProjectedFactorDeltaV1',
        activatedFactorIds: state.knownActiveFactorIds,
        deactivatedFactorIds: state.knownInactiveFactorIds,
        unknownFactorIds: state.unknownFactorIds,
        sourceR1Active: source.r1Active,
        sourceR2Active: source.r2Active,
      });
      const selected = selection.selected;
      return { version: 'ProjectedParentRelationApplicabilityV1',
        selectedRelationId: selection.selectedRelationId,
        matchedFactorIds: selected?.matchedFactorIds ?? [],
        contradictedFactorIds: selected?.conflictedFactorIds ?? [],
        unknownFactorIds: selected?.unknownFactorIds ?? [],
        applicability: selected?.applicability ?? 0,
        productionEligible: selected?.productionEligible ?? false,
        relationResults: selection.memberResults.map(value => ({ relationId: value.relationId,
          matchedFactorIds: value.matchedFactorIds, contradictedFactorIds: value.conflictedFactorIds,
          unknownFactorIds: value.unknownFactorIds, applicability: value.applicability,
          productionEligible: value.productionEligible })) };
    });
  }

  compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): ConditionApplicabilityV1 {
    const annotation = this.#annotation(candidate), relations = this.#evidence(annotation,
      'version' in state ? undefined : state).r2a.relationIds;
    if ('version' in state || relations.length === 0) return { matchedFactorIds: [], contradictedFactorIds: [],
      unknownFactorIds: [...relations], applicability: 0, productionEligible: false };
    const comparisons = relations.map(id => this.#r2a!.compareCurrentFactors(id, this.#perception(state)));
    const best = [...comparisons].sort((a, b) => Number(b.highConfidenceActionEligible) - Number(a.highConfidenceActionEligible)
      || b.applicability - a.applicability || a.relationId.localeCompare(b.relationId))[0]!;
    return { matchedFactorIds: best.matchedFactorIds, contradictedFactorIds: best.conflictedFactorIds,
      unknownFactorIds: best.unknownFactorIds, applicability: best.applicability,
      productionEligible: best.highConfidenceActionEligible };
  }

  #factorStateTransition(annotation: R1ExperienceAtomV2): {
    readonly activated: readonly string[];
    readonly deactivated: readonly string[];
    readonly unchangedActive: readonly string[];
    readonly afterActive: readonly string[];
    readonly afterInactive: readonly string[];
  } {
    assert(this.#r2a !== null, 'factor-transition-requires-initialized-R2A');
    const before = this.#encoder.encode(`${annotation.atomId}:before`,
      new Float64Array(annotation.beforeFactorPerception));
    const after = this.#encoder.encode(`${annotation.atomId}:after`,
      new Float64Array(annotation.afterFactorPerception));
    const activated: string[] = [], deactivated: string[] = [], unchangedActive: string[] = [];
    const afterActive: string[] = [], afterInactive: string[] = [];
    for (const factor of this.#r2a.factors()) {
      const beforeMatches = Math.abs(before.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      const afterMatches = Math.abs(after.tokens[factor.tokenIndex]!.standardizedValue
        - factor.expectedStandardizedValue) <= factor.tolerance;
      if (afterMatches) afterActive.push(factor.factorId); else afterInactive.push(factor.factorId);
      if (!beforeMatches && afterMatches) activated.push(factor.factorId);
      else if (beforeMatches && !afterMatches) deactivated.push(factor.factorId);
      else if (afterMatches) unchangedActive.push(factor.factorId);
    }
    const ordered = (values: string[]) => values.sort((left, right) => left.localeCompare(right, 'en'));
    return { activated: ordered(activated), deactivated: ordered(deactivated),
      unchangedActive: ordered(unchangedActive), afterActive: ordered(afterActive),
      afterInactive: ordered(afterInactive) };
  }

  #runR1Prediction(annotation: R1ExperienceAtomV2, evidence: PhysicalEvidenceReferenceV1,
    expected: readonly PublicChange[], kind: Prediction['kind'], baseObservationSequence: number,
    grounded?: { readonly observation: Observation; readonly goal: GroundedGoalV1;
      readonly evaluation: GoalEvaluationV1 }): BranchPredictionV1 {
    const empty = (reason: string): BranchPredictionV1 => ({ prediction: { kind, support: 0,
      calibratedProbability: false, samples: [], evidence, unknown: [reason], mapSha256: this.mapSha256 },
      currentEvidence: evidence, validSampleCount: 0, progressSampleCount: 0, progressFraction: 0,
      nextStates: [], unknown: [reason], readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1',
        roleBindingStatus: grounded ? evaluatePredictionChangesAgainstGoalV1(grounded.observation,
          grounded.goal, grounded.evaluation, [], annotation.publicRoleBindings).roleBindingStatus : 'not-required',
        goalRelevantReadoutCount: 0, maxVisitedOriginalKernelIndex: null,
        goalRelevantKernelVisited: false } });
    if (!evidence.r1.active) return empty('R1-trace-inactive');
    if (annotation.completion !== 'complete') return empty('R1-event-censored');
    if (!evidence.r2.active) return empty('continuous-R2-trace-inactive');
    if (!evidence.r2a.predictionEligible || evidence.r2a.applicability <= 0) return empty('current-R2A-pattern-unsupported');
    const snapshot = this.#r1Store.medium.traceSnapshot(annotation.pageId, annotation.traceId);
    if (!snapshot) return empty('R1-trace-snapshot-unavailable');
    assert(annotation.kernelChanges.length === snapshot.kernels.length,
      'R1-public-readout-kernel-count-mismatch');
    const resolution = adaptPredictionTraceResolution(snapshot), centers = resolution.snapshot.kernels.map(kernel => kernel.center);
    const tangent = pathInitialTangent(centers); if (!tangent) return empty('R1-trace-has-no-tangent');
    const samples: Prediction['samples'][number][] = []; let progressSampleCount = 0;
    let goalRelevantReadoutCount = 0, maxVisitedOriginalKernelIndex: number | null = null;
    const roleBindingStatuses: PredictionRoleBindingStatusV1[] = [];
    const nextStates: HypotheticalPublicStateV1[] = [];
    const factorState = this.#factorStateTransition(annotation);
    // The factor state is measured at the real event's sealed end.  A random
    // proposal may expose it only after physically visiting that completion
    // kernel; merely selecting this historical trace never completes the
    // factor transition or fills a future state from a template.
    const factorCompletionKernel = resolution.snapshot.kernels.length - 1;
    const factorUniverse = [...new Set([...factorState.afterActive, ...factorState.afterInactive])].sort();
    const predictionKernelChanges = annotation.kernelChanges.map((_changes, kernelIndex) =>
      cumulativePublicChangePrefixV1(annotation.kernelChanges, kernelIndex));
    for (let seed = 1; seed <= 24; seed++) {
      const predicted = this.#clone.run(resolution.snapshot, centers[0]!, tangent, new SplitMix64(BigInt(seed)), 180);
      const transported = transportTraceSnapshot(resolution.snapshot, centers[0]!, tangent)!;
      const readSnapshot = { ...resolution.snapshot, kernels: resolution.snapshot.kernels.map((kernel, index) => ({
        ...kernel, center: transported[index]! })) };
      const read = readVisitedRegions(readSnapshot, predicted.positions, predictionKernelChanges);
      const orderedReadout = [...read.readout].sort((left, right) =>
        (left.originalKernelIndex ?? left.kernelIndex) - (right.originalKernelIndex ?? right.kernelIndex));
      const deepestChanges = structuredClone(orderedReadout.at(-1)?.changes ?? []);
      const visitedFactorCompletion = read.reason !== 'indistinguishable-local-outcomes'
        && read.visitedKernelIndices.includes(factorCompletionKernel);
      const visitedMaximum = read.visitedKernelIndices.at(-1);
      if (visitedMaximum !== undefined) maxVisitedOriginalKernelIndex = Math.max(
        maxVisitedOriginalKernelIndex ?? visitedMaximum, visitedMaximum);
      const goalReadouts = grounded ? orderedReadout.map(item => evaluatePredictionChangesAgainstGoalV1(
        grounded.observation, grounded.goal, grounded.evaluation, item.changes, annotation.publicRoleBindings)) : [];
      goalRelevantReadoutCount += goalReadouts.filter(value => value.goalRelevantReadout).length;
      roleBindingStatuses.push(...goalReadouts.map(value => value.roleBindingStatus));
      if (grounded ? goalReadouts.some(value => value.advances)
        : expected.some(target => deepestChanges.some(change => change.subject === target.subject
          && change.property === target.property && change.after === target.after))) progressSampleCount++;
      samples.push({ seed, traceId: snapshot.traceId, pageId: snapshot.pageId,
        positions: restorePredictionTracePositions(predicted.positions, centers[0]!, resolution.scaleFactor).map(point => [...point]),
        readout: read.readout.map(item => ({ ...item, distance: item.distance / resolution.scaleFactor })),
        reason: read.reason, resolutionScale: resolution.scaleFactor });
      nextStates.push({ version: 'HypotheticalPublicStateV1', baseObservationSequence,
        knownChanges: deepestChanges,
        knownActiveFactorIds: visitedFactorCompletion ? [...factorState.afterActive] : [],
        knownInactiveFactorIds: visitedFactorCompletion ? [...factorState.afterInactive] : [],
        unknownFactorIds: visitedFactorCompletion ? [] : factorUniverse,
        unobserved: 'unknown' });
    }
    const validSampleCount = samples.filter(sample => sample.readout.length > 0).length;
    const prediction: Prediction = { kind, support: Math.min(1, evidence.r2a.applicability), calibratedProbability: false,
      samples, evidence, unknown: [...new Set(samples.flatMap(sample => sample.reason ? [sample.reason] : []))],
      mapSha256: this.mapSha256 };
    return { prediction, currentEvidence: evidence, validSampleCount, progressSampleCount,
      progressFraction: progressSampleCount / samples.length, nextStates, unknown: prediction.unknown,
      readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1',
        roleBindingStatus: aggregateRoleBindingStatusV1(roleBindingStatuses, grounded !== undefined),
        goalRelevantReadoutCount, maxVisitedOriginalKernelIndex,
        goalRelevantKernelVisited: goalRelevantReadoutCount > 0 } };
  }

  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1, evaluation: GoalEvaluationV1): BranchPredictionV1 {
    if ('version' in state) {
      const reason = 'hypothetical-state-current-public-perception-unavailable';
      return { prediction: { kind: 'hypothetical-prediction', support: 0, calibratedProbability: false,
        samples: [], evidence: candidate.evidence, unknown: [reason], mapSha256: this.mapSha256 },
        currentEvidence: candidate.evidence, validSampleCount: 0, progressSampleCount: 0, progressFraction: 0,
        nextStates: [], unknown: [reason], readoutDiagnostics: { version: 'BranchReadoutDiagnosticsV1',
          roleBindingStatus: 'not-required', goalRelevantReadoutCount: 0,
          maxVisitedOriginalKernelIndex: null, goalRelevantKernelVisited: false } };
    }
    const annotation = this.#annotation(candidate), evidence = this.#evidence(annotation, state);
    return this.#runR1Prediction(annotation, evidence, candidate.observedChanges,
      'hypothetical-prediction', state.sequence, { observation: state, goal, evaluation });
  }

  predictContinuation(patternId: string, observation: Observation): ContinuationPredictionV2 {
    const pattern = this.#r2a!.patterns().find(value => value.patternId === patternId);
    if (!pattern) throw new Error('unknown-continuous-pattern');
    const pending = this.#r2Store.snapshot().pending;
    const empty = (reason: string): ContinuationPredictionV2 => ({ version: 'ContinuationPredictionV2', patternId,
      support: 0, samples: [], evidenceGrade: pattern.grade, unknown: [reason] });
    if (!pending || pending.atoms.length < 2) return empty('current-real-R2-prefix-unavailable');
    const prefix = pending.atoms.map(atom => atom.r2Coordinate);
    const assessment = this.#r2a!.assessContinuation(patternId, prefix, this.#perception(observation),
      pending.atoms.map(atom => atom.exactExperienceIdentity),
      pending.atoms.map(atom => atom.publicTransitionTopologyId));
    if (!assessment.predictionEligible) return empty(assessment.reason ?? 'pattern-continuation-unsupported');
    const event = pattern.memberEventIds.map(id => this.#r2Store.events().find(value => value.eventId === id))
      .find(value => value?.pageId && value.traceId && this.#r2Store.isTraceActive(value.pageId, value.traceId));
    if (!event?.pageId || !event.traceId) return empty('stable-pattern-has-no-active-R2-trace');
    const snapshot = this.#r2Store.traceSnapshot(event.pageId, event.traceId); if (!snapshot) return empty('R2-trace-snapshot-unavailable');
    const centers = snapshot.kernels.map(kernel => kernel.center);
    const start = new Float64Array(prefix.at(-1)!);
    const previous = prefix.at(-2)!;
    const tangent = new Float64Array(start.map((value, axis) => value - previous[axis]!));
    const tangentMagnitude = Math.hypot(...tangent);
    if (tangentMagnitude <= 1e-12) return empty('current-real-R2-prefix-has-no-tangent');
    for (let axis = 0; axis < tangent.length; axis++) tangent[axis] = tangent[axis]! / tangentMagnitude;
    const atomChanges = event.atomIds.map(atomId => this.#annotations.find(value => value.atomId === atomId)?.kernelChanges.flat() ?? []);
    const samples: Prediction['samples'][number][] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const predicted = this.#clone.run(snapshot, start, tangent, new SplitMix64(BigInt(seed)), 180);
      const read = readVisitedRegions(snapshot, predicted.positions, atomChanges,
        Array.from({ length: prefix.length }, (_unused, index) => index));
      samples.push({ seed, traceId: event.traceId, pageId: event.pageId, positions: predicted.positions.map(point => [...point]),
        readout: read.readout, reason: read.reason });
    }
    return { version: 'ContinuationPredictionV2', patternId,
      support: assessment.applicability,
      samples, evidenceGrade: pattern.grade,
      unknown: [...new Set(samples.flatMap(sample => sample.reason ? [sample.reason] : []))] };
  }

  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    readonly OpaqueFactorTransitionTraceV1[] {
    if ('version' in state || factorIds.length === 0) return [];
    const requested = new Set(factorIds);
    const traces: OpaqueFactorTransitionTraceV1[] = [];
    for (const annotation of this.#annotations) {
      if (annotation.completion !== 'complete') continue;
      const transition = this.#factorStateTransition(annotation);
      if (![...transition.activated, ...transition.deactivated].some(factorId => requested.has(factorId))) continue;
      traces.push({ version: 'OpaqueFactorTransitionTraceV1', transitionId: sha({ atomId: annotation.atomId,
        activated: transition.activated, deactivated: transition.deactivated,
        unchangedActive: transition.unchangedActive }), eventId: annotation.eventId,
        actionCue: structuredClone(annotation.cue),
        activatedFactorIds: transition.activated, deactivatedFactorIds: transition.deactivated,
        unchangedActiveFactorIds: transition.unchangedActive, evidence: this.#evidence(annotation, state),
        meaning: 'observed-factor-transition' });
    }
    return traces;
  }

  recall(desired: DesiredChange, observation: Observation, offset = 0): unknown {
    const candidates = this.#annotations.filter(annotation => annotation.completion === 'complete'
      && this.#r1Store.medium.isTraceActive(annotation.pageId, annotation.traceId)
      && annotation.kernelChanges.flat().some(change => matches(change, desired)));
    return { kind: 'historical-atomic-observation', total: candidates.length, offset,
      nextOffset: offset + 2 < candidates.length ? offset + 2 : null,
      candidates: candidates.slice(offset, offset + 2).map(annotation => ({ eventId: annotation.eventId,
        action: annotation.cue, actualObserved: annotation.kernelChanges.flat().filter(change => matches(change, desired)),
        observedBefore: annotation.context, evidence: this.#evidence(annotation, observation),
        unknown: ['atomic-history-is-not-continuous-pattern-or-causal-proof'] })) };
  }

  predict(cue: ActionCue, observation: Observation, options: { seeds?: number; steps?: number; prefix?: RealEvent } = {}): Prediction {
    void options;
    const candidates = this.#annotations.filter(annotation => annotation.completion === 'complete'
      && cueIdentity(annotation.cue) === cueIdentity(cue));
    const selected = candidates.map(annotation => ({ annotation, evidence: this.#evidence(annotation, observation) }))
      .filter(value => value.evidence.r2a.predictionEligible && value.evidence.r2a.applicability > 0)
      .sort((a, b) => b.evidence.r2a.applicability - a.evidence.r2a.applicability)[0];
    const kind = options.prefix ? 'factual-prediction' as const : 'hypothetical-prediction' as const;
    if (!selected) return { kind, support: 0, calibratedProbability: false, samples: [], evidence: null,
      unknown: ['no-current-predictive-stable-continuous-pattern'], mapSha256: this.mapSha256 };
    return this.#runR1Prediction(selected.annotation, selected.evidence,
      selected.annotation.kernelChanges.flat(), kind, observation.sequence).prediction;
  }

  snapshot(): HierarchicalMemorySnapshotV1 {
    return { version: HIERARCHICAL_MEMORY_VERSION_V1,
      hierarchy: HIERARCHICAL_MEMORY_SEMANTICS_V1,
      activeSeconds: this.#activeSeconds,
      eventMap: this.#map?.state ?? null, contextKeys: [...this.#contextKeys], contextVocabulary: [...this.#contextVocabulary],
      r2AtomAdapter: this.#r2Adapter?.exportState() ?? null,
      tokenEncoder: this.ready ? this.#encoder.exportState() : null,
      r1Store: this.#r1Store.snapshot(), r2Store: this.#r2Store.snapshot(), r2a: this.#r2a?.snapshot() ?? null,
      annotations: structuredClone(this.#annotations), hierarchyReplayLedger: structuredClone(this.#ledger),
      hierarchyInterventionLedger: structuredClone(this.#interventionLedger),
      pendingInitialization: structuredClone(this.#pending), seenEventIds: [...this.#seen], writes: this.#writes };
  }

  static restore(snapshot: HierarchicalMemorySnapshotV1): HierarchicalPhysicalMemoryV1 {
    assert(snapshot.version === HIERARCHICAL_MEMORY_VERSION_V1
      && snapshot.hierarchy === HIERARCHICAL_MEMORY_SEMANTICS_V1,
    'legacy-hierarchy-checkpoint-is-audit-only');
    const rawAnnotations = (snapshot as unknown as { readonly annotations?: readonly unknown[] }).annotations;
    assert(!Array.isArray(rawAnnotations) || rawAnnotations.length === 0
      || rawAnnotations.every(annotationHasRoleBindingProvenanceV1),
    'R1-role-binding-provenance-missing');
    assert(Number.isFinite(snapshot.activeSeconds) && snapshot.activeSeconds >= 0,
      'invalid-hierarchical-active-time');
    assert(Array.isArray(snapshot.hierarchyInterventionLedger),
      'legacy-hierarchy-without-intervention-ledger-is-audit-only');
    const ready = snapshot.eventMap !== null;
    let normalizedInputR2A = snapshot.r2a;
    assert(ready === (snapshot.r2AtomAdapter !== null && snapshot.tokenEncoder !== null && snapshot.r2a !== null)
      && (ready ? snapshot.pendingInitialization.length === 0
        : snapshot.r1Store.atoms.length === 0 && snapshot.annotations.length === 0
          && snapshot.hierarchyReplayLedger.length === 0 && snapshot.hierarchyInterventionLedger.length === 0
          && snapshot.r2Store.events.length === 0),
    'inconsistent-hierarchical-ready-state');
    assert(snapshot.r1Store.logicalTime === snapshot.activeSeconds
      && snapshot.r1Store.medium.logicalTime === snapshot.activeSeconds
      && snapshot.r2Store.medium.logicalTime === snapshot.activeSeconds
      && (!snapshot.r2a || snapshot.r2a.logicalTime === snapshot.activeSeconds
        && snapshot.r2a.r2aMedium.logicalTime === snapshot.activeSeconds),
    'hierarchical-physical-clock-mismatch');
    assert(snapshot.writes === snapshot.r1Store.atoms.length
      && snapshot.annotations.length === snapshot.r1Store.atoms.length,
    'hierarchical-R1-annotation-count-mismatch');
    const annotationByAtom = new Map(snapshot.annotations.map(value => [value.atomId, value]));
    assert(annotationByAtom.size === snapshot.annotations.length
      && snapshot.r1Store.atoms.every(atom => {
        const annotation = annotationByAtom.get(atom.atomId);
        return annotation?.version === 'R1ExperienceAtomV5'
          && annotationHasRoleBindingProvenanceV1(annotation)
          && annotation.anchorId === atom.anchorId && annotation.pageId === atom.pageId
          && annotation.traceId === atom.traceId && annotation.eventId.length > 0
          && annotation.startedAt >= 0 && annotation.endedAt === atom.observedAt
          && annotation.endedAt >= annotation.startedAt
          && Number.isSafeInteger(annotation.startObservationSequence)
          && Number.isSafeInteger(annotation.endObservationSequence)
          && annotation.endObservationSequence >= annotation.startObservationSequence
          && /^[a-f0-9]{64}$/i.test(annotation.publicTransitionTopologyId)
          && annotation.publicTransitionTopologyId
            === publicTransitionTopologyFromChangesV1(annotation.measurementChanges).compatibilitySha256
          && /^[a-f0-9]{64}$/i.test(annotation.publicTransitionTopologyAuditId)
          && annotation.publicTransitionTopologyAuditId
            === publicTransitionTopologyFromChangesV1(annotation.measurementChanges).identitySha256
          && new Set(annotation.observationScopeIds).size === annotation.observationScopeIds.length;
      }), 'hierarchical-R1-annotation-identity-mismatch');
    const ledgerAtomIds = snapshot.hierarchyReplayLedger.map(value => value.atom.atomId);
    assert(new Set(ledgerAtomIds).size === ledgerAtomIds.length
      && snapshot.hierarchyReplayLedger.every(record => {
        const annotation = annotationByAtom.get(record.atom.atomId);
        return annotation?.completion === 'complete'
          && record.version === 'HierarchyReplayRecordV3'
          && record.atom.sourceEventId === annotation.eventId
          && record.atom.startedAt === annotation.startedAt && record.atom.endedAt === annotation.endedAt
          && record.atom.startFrameSequence === annotation.startObservationSequence
          && record.atom.endFrameSequence === annotation.endObservationSequence
          && canonical(record.atom.r2Coordinate) === canonical(annotation.r2Coordinate)
          && record.atom.exactExperienceIdentity === cueIdentity(annotation.cue)
          && record.atom.publicTransitionTopologyId === annotation.publicTransitionTopologyId
          && record.exactExperienceIdentity === cueIdentity(annotation.cue)
          && record.contextId === annotation.contextId
          && canonical(record.preEventPerception) === canonical(annotation.beforeFactorPerception)
          && (record.closeAfter === null) === (record.closedAtActiveSeconds === null);
      }), 'hierarchical-upper-ledger-does-not-reference-complete-R1-facts');
    if (ready) {
      const rebuilt = rebuildHierarchicalUpperLayersV1(snapshot);
      assert(snapshot.tokenEncoder && snapshot.r2AtomAdapter && snapshot.r2a,
        'incomplete-hierarchical-memory-checkpoint');
      const normalizedStoredR2A = new R2AStablePatternLearnerV1(
        DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder), snapshot.r2a,
        R2AtomMeasurementAdapterV1.restore(snapshot.r2AtomAdapter).exportState().identitySha256,
      ).snapshot();
      normalizedInputR2A = normalizedStoredR2A;
      assert(canonical(rebuilt.r2Store) === canonical(snapshot.r2Store)
        && canonical(rebuilt.r2a) === canonical(normalizedStoredR2A),
      'hierarchical-upper-state-does-not-match-deterministic-R1-ledger-replay');
    }
    const memory = new HierarchicalPhysicalMemoryV1(); memory.#activeSeconds = snapshot.activeSeconds;
    memory.#seen = new Set(snapshot.seenEventIds); memory.#writes = snapshot.writes;
    memory.#pending = [...structuredClone(snapshot.pendingInitialization)]; memory.#contextKeys = [...snapshot.contextKeys];
    memory.#contextVocabulary = [...snapshot.contextVocabulary]; memory.#annotations = [...structuredClone(snapshot.annotations)];
    memory.#ledger = [...structuredClone(snapshot.hierarchyReplayLedger)];
    memory.#interventionLedger = [...structuredClone(snapshot.hierarchyInterventionLedger)];
    memory.#r1Store = new HierarchicalR1StoreV1(snapshot.r1Store);
    memory.#r2Store = R2ContinuousEventStore.restore(snapshot.r2Store);
    if (snapshot.eventMap) {
      assert(snapshot.r2AtomAdapter && snapshot.tokenEncoder && snapshot.r2a, 'incomplete-hierarchical-memory-checkpoint');
      memory.#map = new DistanceEmbedding(snapshot.eventMap);
      memory.#r2Adapter = R2AtomMeasurementAdapterV1.restore(snapshot.r2AtomAdapter);
      memory.#encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
      memory.#r2a = new R2AStablePatternLearnerV1(memory.#encoder, snapshot.r2a,
        memory.#r2AdapterIdentity());
    }
    const pendingAtom = snapshot.r2Store.pending?.atoms.at(-1);
    memory.#openLastAtom = pendingAtom ? { ...pendingAtom, r2Coordinate: new Float64Array(pendingAtom.r2Coordinate) } : null;
    assert(canonical(memory.snapshot()) === canonical({ ...snapshot, r2a: normalizedInputR2A }),
      'hierarchical-memory-snapshot-not-reproducible');
    return memory;
  }

  /** Test-only physical ablation; never exposed by the worker protocol. */
  ablateForTest(medium: 'R1' | 'R2' | 'R2A'): void {
    if (medium === 'R1') this.#r1Store.medium.recover(1e9);
    if (medium === 'R2') this.#r2Store.recover(1e9);
    if (medium === 'R2A') this.#r2a?.advanceTo(this.#r2a.logicalTime + 1e9);
  }
}
