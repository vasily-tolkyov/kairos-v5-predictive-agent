import type { ActionCue, DesiredChange, Observation, Prediction, PublicChange, RealEvent } from './contracts.js';
import type { R1TraceSnapshot, RawExperience, Vec3 } from './core/contracts.js';
import { emptyFirewallRejections, emptyLeakageAudit, ObservationGate } from './core/firewall.js';
import { ExperienceMediaStore } from './core/learning/experience-store.js';
import { PathProjector, pathInitialTangent, r1RouteSignature } from './core/learning/path-projector.js';
import { DeterministicTokenFieldEncoder } from './core/learning/token-field.js';
import { OpenCausalFactorR2A, type R2AActivationAuditV1 } from './core/learning/open-causal-factor-r2a.js';
import { ActionConditionedRuleQuery } from './core/learning/action-conditioned-rule-query.js';
import { PredictionClone, transportTraceSnapshot } from './core/prediction/prediction-clone.js';
import { adaptPredictionTraceResolution, restorePredictionTracePositions } from './core/prediction/trace-resolution-adapter.js';
import { SplitMix64 } from './core/random.js';
import { R1_CONFIG } from './core/config.js';
import { DistanceEmbedding, type EmbeddingState } from './distance-embedding.js';
import { cueIdentity, eventRows, R2_EVENT_MEASUREMENT_ADAPTER_V2, relativePublicFeatures, validateEvent } from './events.js';
import { assert, canonical, sha } from './util.js';
import type { BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1, GroundedGoalV1,
  GoalEvaluationV1, HypotheticalPublicStateV1, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1 } from './control/contracts.js';
import { desiredChangesForGoal } from './control/goal.js';

interface TraceAnnotation {
  readonly eventId: string; readonly anchorId: string; readonly pageId: string; readonly traceId: string;
  readonly cue: ActionCue; readonly context: ReturnType<typeof relativePublicFeatures>; readonly contextId: string;
  readonly r2Coordinate: readonly number[];
  readonly beforeFactorPerception?: readonly number[];
  readonly afterFactorPerception?: readonly number[];
  /** Local public readout labels belong to real R1 kernels, not an external outcome template. */
  readonly kernelChanges: readonly (readonly PublicChange[])[];
}
interface RepresentationRejectionV1 {
  readonly reason: 'unrepresented-public-features' | 'event-map-sampling-disconnected';
  readonly unknownKeys?: readonly string[];
  readonly maximumAdjacentGap?: number;
}
class FrozenEventRepresentationMiss extends Error {
  constructor(readonly rejection: RepresentationRejectionV1) { super(rejection.reason); }
}
export interface MemoryObservationReceipt {
  readonly status: 'initialization-buffer' | 'real-event-deposited' | 'real-event-not-representable';
  readonly writes: number; readonly buffered: number; readonly mapSha256: string | null;
  readonly representationRejection: RepresentationRejectionV1 | null;
}
export interface MemorySnapshot {
  readonly version: 'KairosV5MemoryV4';
  readonly eventMeasurementVersion: typeof R2_EVENT_MEASUREMENT_ADAPTER_V2;
  readonly activeSeconds: number;
  readonly eventMap: EmbeddingState | null; readonly contextKeys: readonly string[];
  readonly contextVocabulary: readonly string[];
  readonly projector: ReturnType<PathProjector['exportState']> | null;
  readonly tokenEncoder: ReturnType<DeterministicTokenFieldEncoder['exportState']> | null;
  readonly store: ReturnType<ExperienceMediaStore['exportCheckpointState']>;
  readonly r2a: ReturnType<OpenCausalFactorR2A['exportState']> | null;
  readonly annotations: readonly TraceAnnotation[];
  readonly pendingInitialization: readonly RealEvent[];
  readonly seenEventIds: readonly string[];
  readonly writes: number;
}

export function matches(change: PublicChange, desired: DesiredChange): boolean {
  if (desired.subject && change.subject !== desired.subject && !change.subject.startsWith(desired.subject + '#')) return false;
  if (desired.property && change.property !== desired.property) return false;
  if (desired.value !== undefined && change.after !== desired.value) return false;
  if (desired.direction === 'increase') return typeof change.before === 'number' && typeof change.after === 'number' && change.after > change.before;
  if (desired.direction === 'decrease') return typeof change.before === 'number' && typeof change.after === 'number' && change.after < change.before;
  if (desired.direction === 'unchanged') return change.before === change.after;
  return desired.direction !== 'change' || change.before !== change.after;
}
export interface ReadoutBoundary {
  readonly kernelOffset: number;
  /** Inclusive original-kernel boundary. Hypothetical actions have no observed prefix. */
  readonly observedThroughOriginalKernelIndex: number | null;
}
export function readVisitedRegions(snapshot: R1TraceSnapshot, trajectory: readonly Vec3[],
  annotations: readonly (readonly PublicChange[])[], boundary: ReadoutBoundary = { kernelOffset: 0, observedThroughOriginalKernelIndex: null }
): { readout: Prediction['samples'][number]['readout']; reason: string | null } {
  assert(Number.isInteger(boundary.kernelOffset) && boundary.kernelOffset >= 0
    && (boundary.observedThroughOriginalKernelIndex === null || Number.isInteger(boundary.observedThroughOriginalKernelIndex)
      && boundary.observedThroughOriginalKernelIndex >= 0), 'invalid-readout-boundary');
  const readout: Array<Prediction['samples'][number]['readout'][number]> = [];
  const visited = new Set<number>(); let collision = false;
  trajectory.forEach((position, sampleStep) => {
    if (sampleStep === 0) return;
    const local = snapshot.kernels.map((kernel, kernelIndex) => ({ kernelIndex, kernel,
      distance: Math.hypot(...position.map((value, axis) => value - kernel.center[axis]!)) }))
      .filter(item => item.distance <= item.kernel.sigma * .25 && item.kernel.coefficient < -1e-7)
      .sort((a, b) => a.distance - b.distance);
    const nearest = local[0]; if (!nearest) return;
    // Competing concrete values at indistinguishable locations are uncertainty, never label completion.
    const sameLocation = local.filter(item => Math.abs(item.distance - nearest.distance) < 1e-6);
    const values = new Map<string, unknown>();
    for (const item of sameLocation) for (const change of annotations[item.kernelIndex] ?? []) {
      const key = `${change.subject}/${change.property}`;
      if (values.has(key) && values.get(key) !== change.after) collision = true;
      values.set(key, change.after);
    }
    if (collision || visited.has(nearest.kernelIndex)) return;
    visited.add(nearest.kernelIndex);
    const originalKernelIndex = boundary.kernelOffset + nearest.kernelIndex;
    // Keep observed kernels in the ambiguity comparison and in the physical simulation.
    // Only their already-observed labels lose eligibility as a future result.
    if (boundary.observedThroughOriginalKernelIndex !== null && originalKernelIndex <= boundary.observedThroughOriginalKernelIndex) return;
    const changes = annotations[nearest.kernelIndex] ?? [];
    if (changes.length > 0) readout.push({ sampleStep, kernelIndex: nearest.kernelIndex, originalKernelIndex, distance: nearest.distance,
      potential: nearest.kernel.coefficient * Math.exp(-.5 * (nearest.distance / nearest.kernel.sigma) ** 2), changes });
  });
  return { readout: collision ? [] : readout,
    reason: collision ? 'indistinguishable-local-outcomes' : readout.length === 0 ? 'random-trajectory-did-not-reach-readout' : null };
}

export class PhysicalMemory {
  #store = new ExperienceMediaStore();
  #map: DistanceEmbedding | null = null;
  #projector = new PathProjector();
  #encoder = new DeterministicTokenFieldEncoder();
  #r2a = new OpenCausalFactorR2A(this.#encoder, this.#store);
  #contextKeys: string[] = [];
  #contextVocabulary: string[] = [];
  #annotations: TraceAnnotation[] = [];
  #pending: RealEvent[] = [];
  #seen = new Set<string>();
  #activeSeconds = 0;
  #writes = 0;
  readonly #audit = emptyLeakageAudit();
  readonly #rejections = emptyFirewallRejections();
  readonly #gate = new ObservationGate(this.#audit, this.#rejections);
  readonly #query = new ActionConditionedRuleQuery();
  readonly #clone = new PredictionClone(this.#audit, this.#rejections);

  get ready(): boolean { return this.#map !== null; }
  get writes(): number { return this.#writes; }
  get bufferedEvents(): number { return this.#pending.length; }
  get mapSha256(): string | null { return this.#map ? sha(this.#map.state) : null; }
  advanceTo(activeSeconds: number): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= this.#activeSeconds, 'active-observation-time-reversed');
    if (this.ready) { const elapsed = activeSeconds - this.#store.logicalTime;
      this.#store.recoverAll(elapsed); this.#r2a.recover(elapsed, true); }
    this.#activeSeconds = activeSeconds;
  }
  observe(event: RealEvent): MemoryObservationReceipt {
    validateEvent(event); assert(!this.#seen.has(event.id), 'real-event-already-observed');
    const end = event.frames.at(-1)!.activeSeconds;
    assert(end >= this.#activeSeconds, 'event-arrived-after-time-was-advanced-past-it');
    if (!this.ready) {
      this.#pending.push(structuredClone(event)); this.#seen.add(event.id); this.#activeSeconds = end;
      if (this.#pending.length === 128) this.#initialize(this.#pending);
    } else {
      this.advanceTo(end);
      try { this.#deposit(event); }
      catch (error) {
        if (!(error instanceof FrozenEventRepresentationMiss)) throw error;
        this.#seen.add(event.id);
        return { status: 'real-event-not-representable', writes: this.#writes, buffered: this.bufferedEvents,
          mapSha256: this.mapSha256, representationRejection: structuredClone(error.rejection) };
      }
      this.#seen.add(event.id);
    }
    return { status: this.ready ? 'real-event-deposited' : 'initialization-buffer', writes: this.#writes,
      buffered: this.bufferedEvents, mapSha256: this.mapSha256, representationRejection: null };
  }
  #initialize(events: readonly RealEvent[]): void {
    assert(this.#map === null && events.length === 128, 'single-128-real-event-initialization-only');
    const series = events.map(eventRows);
    const embedding = DistanceEmbedding.fit(series.flatMap(value => value.rows));
    let maxGap = 0;
    for (const event of series) {
      const points = event.rows.map(row => embedding.encode(row).coordinate);
      for (let i = 1; i < points.length; i++) maxGap = Math.max(maxGap, Math.hypot(...points[i]!.map((v, j) => v - points[i - 1]![j]!)));
    }
    assert(maxGap > 1e-12, 'event-map-collapsed');
    // Scale is derived once from real adjacent observations and the existing R1 kernel width.
    // No extra samples are inserted. Unseen events exceeding this scale are reported, not interpolated.
    this.#map = new DistanceEmbedding({ ...embedding.state, scale: R1_CONFIG.kernelWidth * .4 / maxGap });
    // The frozen factor vocabulary must cover the public states genuinely
    // observed at both ends of bootstrap events. Candidate retrieval still
    // uses only the event-before perception; admitting the terminal public
    // value here merely prevents a real observed transition from becoming an
    // unrepresentable feature in its own initialization batch.
    const contexts = events.map(event => relativePublicFeatures(event.frames[0]!));
    const vocabularyContexts = events.flatMap(event => [relativePublicFeatures(event.frames[0]!),
      relativePublicFeatures(event.frames.at(-1)!)]);
    this.#contextVocabulary = [...new Set(vocabularyContexts.flatMap(row => Object.keys(row)))].sort();
    const keys = [...new Set(contexts.flatMap(row => Object.keys(row)))];
    // Slots are calibrated public features, not hashed meanings or world-to-R1 coordinates.
    this.#contextKeys = keys.sort((a, b) => {
      const energy = (key: string) => contexts.reduce((s, row) => s + (row[key] ?? 0) ** 2, 0);
      return energy(b) - energy(a) || a.localeCompare(b);
    }).slice(0, 256);
    const admitted = events.map(event => this.#gate.admit(this.#raw(event)));
    this.#projector.fit(admitted);
    this.#encoder.fit(admitted.map(value => value.perception())); this.#encoder.freeze();
    this.#r2a = new OpenCausalFactorR2A(this.#encoder, this.#store);
    for (const event of events) {
      const elapsed = event.frames.at(-1)!.activeSeconds - this.#store.logicalTime;
      this.#store.recoverAll(elapsed); this.#r2a.recover(elapsed, true); this.#deposit(event);
    }
    this.#pending = [];
  }
  #perception(observation: Observation): Float64Array {
    const row = relativePublicFeatures(observation);
    return Float64Array.from({ length: 256 }, (_, i) => row[this.#contextKeys[i] ?? ''] ?? 0);
  }
  #raw(event: RealEvent): RawExperience {
    assert(this.#map, 'map-not-frozen');
    const encoded = eventRows(event).rows.map(row => this.#map!.encode(row));
    const trajectory = encoded.map(point => new Float64Array(point.coordinate));
    let maximumAdjacentGap = 0;
    for (let i = 1; i < trajectory.length; i++) maximumAdjacentGap = Math.max(maximumAdjacentGap,
      Math.hypot(...trajectory[i]!.map((v, j) => v - trajectory[i - 1]![j]!)));
    if (maximumAdjacentGap > .06 + 1e-9) throw new FrozenEventRepresentationMiss({
      reason: 'event-map-sampling-disconnected', maximumAdjacentGap });
    const representedContextKeys = new Set(this.#contextVocabulary);
    const contextUnknownKeys = [event.frames[0]!, event.frames.at(-1)!]
      .flatMap(frame => Object.keys(relativePublicFeatures(frame)))
      .filter(key => !representedContextKeys.has(key));
    const unknownKeys = [...new Set([...encoded.flatMap(row => row.unknownKeys), ...contextUnknownKeys])].sort();
    if (unknownKeys.length > 0) throw new FrozenEventRepresentationMiss({ reason: 'unrepresented-public-features', unknownKeys });
    const tangent = pathInitialTangent(trajectory); assert(tangent, 'event-map-has-no-observed-progress');
    return { trajectory, perception: this.#perception(event.frames[0]!),
      r1State: { position: trajectory[0]!, velocity: tangent, causalPrefix: trajectory.slice(0, 2),
        observedAt: event.frames.at(-1)!.activeSeconds, numericAttributes: new Float64Array() },
      provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true,
        containsSimulatorPrivate: false, containsFutureObservation: false, containsSemanticRuleOrResult: false } };
  }
  #deposit(event: RealEvent): void {
    const raw = this.#raw(event), trusted = this.#gate.admit(raw);
    const anchorId = `experience-anchor-${this.#store.nextEventNumber.toString().padStart(6, '0')}`;
    const ticket = this.#r2a.freezeCandidatePool({ anchorId, eventNumber: this.#store.nextEventNumber,
      observedAt: this.#store.logicalTime, perception: raw.perception, interventionKey: cueIdentity(event.cue),
      sourceContextId: event.frames[0]!.contextId, sourceContextIdentityVersion: 'CausalEvidenceContextIdV2',
      // Never let an object discovered later in the event enter before-event candidate retrieval.
      publicR1Signature: sha(relativePublicFeatures(event.frames[0]!)) });
    const r2Coordinate = this.#projector.projectTrustedPath(trusted);
    const receipt = this.#store.writeEvent(trusted, r1RouteSignature(raw.trajectory), r2Coordinate, anchorId, 1, 'current-model-time');
    this.#r2a.commitOutcome(ticket, { r2Coordinate, r2PageId: receipt.r2PageId, r2VisitId: receipt.coactivationId,
      trustedActualObservation: true, r1Trace: { pageId: receipt.r1PageId, traceId: receipt.r1TraceId } }, this.#store.logicalTime);
    this.#annotations.push({ eventId: event.id, anchorId, pageId: receipt.r1PageId, traceId: receipt.r1TraceId,
      cue: structuredClone(event.cue), context: relativePublicFeatures(event.frames[0]!), contextId: event.frames[0]!.contextId,
      r2Coordinate: [...r2Coordinate], beforeFactorPerception: [...this.#perception(event.frames[0]!)],
      afterFactorPerception: [...this.#perception(event.frames.at(-1)!)], kernelChanges: eventRows(event).changes });
    this.#writes++;
  }
  #active(annotation: TraceAnnotation): boolean {
    const coactivation = this.#store.coactivations().find(value => value.experienceAnchorId === annotation.anchorId
      && value.r1Trace.pageId === annotation.pageId && value.r1Trace.traceId === annotation.traceId);
    return this.#store.r1.isTraceActive(annotation.pageId, annotation.traceId)
      && coactivation !== undefined && coactivation.currentStrength > 0
      && this.#store.resolveActiveR2Basin(coactivation.coactivationId) !== null;
  }
  #prepared(cue: ActionCue, observation: Observation) {
    const eligible = this.#annotations.filter(a => cueIdentity(a.cue) === cueIdentity(cue));
    const causal = this.#r2a.evaluate(this.#perception(observation), new Set(eligible.map(a => a.anchorId)));
    return this.#query.query(this.#store.r2, this.#store.r2PageId,
      eligible.map(a => ({ pageId: a.pageId, traceId: a.traceId, experienceAnchorId: a.anchorId })),
      this.#store.coactivations(), trace => this.#store.r1.isTraceActive(trace.pageId, trace.traceId), causal);
  }
  #productionRelations(annotation: TraceAnnotation) {
    const identity = cueIdentity(annotation.cue);
    const visit = this.#store.coactivations().find(value => value.experienceAnchorId === annotation.anchorId
      && value.r1Trace.pageId === annotation.pageId && value.r1Trace.traceId === annotation.traceId);
    if (visit === undefined) return [];
    const current = this.#store.resolveActiveR2Basin(visit.coactivationId);
    if (current === null) return [];
    return this.#r2a.productionRelationsForAudit().filter(relation => {
      if (relation.interventionKey !== identity) return false;
      const target = this.#store.resolveActiveR2Basin(relation.targetR2VisitId);
      return target !== null && target.pageId === current.pageId
        && target.memberVisitIds.length === current.memberVisitIds.length
        && target.memberVisitIds.every((visitId, index) => visitId === current.memberVisitIds[index]);
    });
  }
  #activeFactorsFromAudit(audit: readonly R2AActivationAuditV1[],
    nodeById: ReadonlyMap<string, ReturnType<OpenCausalFactorR2A['exportState']>['factorNodes'][number]>): ReadonlyMap<string, number> {
    const active = new Map<string, number>();
    for (const item of audit) {
      const node = nodeById.get(item.factorId);
      if (!node || item.state !== 'stable') continue;
      const residual = Math.max(0, item.fullSimilarity, item.sparseSimilarity);
      if (residual < .20 || item.contextMatch <= 0 || item.physicalSupport <= 0) continue;
      const reliability = (node.supportStrength + .5) / (node.supportStrength + node.contradictionStrength + 1);
      active.set(item.factorId, Math.min(residual, item.contextMatch, item.physicalSupport, reliability));
    }
    return active;
  }
  #activeFactors(perception: Float64Array): ReadonlyMap<string, number> {
    const state = this.#r2a.exportState();
    const nodeById = new Map(state.factorNodes.map(node => [node.factorId, node]));
    return this.#activeFactorsFromAudit(this.#r2a.activationAudit(perception), nodeById);
  }
  #evidence(annotation: TraceAnnotation, observation?: Observation): PhysicalEvidenceReferenceV1 {
    const coactivation = this.#store.coactivations().find(value => value.experienceAnchorId === annotation.anchorId
      && value.r1Trace.pageId === annotation.pageId && value.r1Trace.traceId === annotation.traceId);
    const r1Active = this.#store.r1.isTraceActive(annotation.pageId, annotation.traceId);
    const r2Active = !!coactivation && coactivation.currentStrength > 0
      && this.#store.resolveActiveR2Basin(coactivation.coactivationId) !== null;
    const relations = this.#productionRelations(annotation);
    let relationIds: readonly string[] = [];
    let applicability = 0;
    if (observation) {
      const prepared = this.#prepared(annotation.cue, observation);
      const contribution = prepared.query.contributions.find(value => value.r1Trace.pageId === annotation.pageId
        && value.r1Trace.traceId === annotation.traceId);
      relationIds = contribution?.matchedRelationIds ?? [];
      applicability = relationIds.reduce((maximum, relationId) => Math.max(maximum,
        ...prepared.query.r3Matches.filter(match => match.relationId === relationId)
          .map(match => match.relationApplicability)), 0);
    }
    // A historical trace can still be recalled when its current condition is absent.  In that
    // case keep the surviving physical relation references but report zero current applicability.
    if (relationIds.length === 0) relationIds = relations.map(relation => relation.hyperedgeId);
    return { eventId: annotation.eventId, anchorId: annotation.anchorId,
      r1: { pageId: annotation.pageId, traceId: annotation.traceId, active: r1Active },
      r2: { coordinate: [...annotation.r2Coordinate], active: r2Active },
      r2a: { relationIds: [...relationIds].sort(), applicability,
        productionEligible: relations.some(relation => relationIds.includes(relation.hyperedgeId)) } };
  }
  #annotation(candidate: EffectRecallCandidateV1): TraceAnnotation {
    const annotation = this.#annotations.find(value => value.eventId === candidate.evidence.eventId
      && value.anchorId === candidate.evidence.anchorId && value.pageId === candidate.evidence.r1.pageId
      && value.traceId === candidate.evidence.r1.traceId);
    assert(annotation && cueIdentity(annotation.cue) === cueIdentity(candidate.actionCue), 'unknown-or-modified-physical-candidate');
    return annotation;
  }
  recallByEffect(goal: GroundedGoalV1, goalDifference: GoalEvaluationV1,
    observation: Observation): readonly EffectRecallCandidateV1[] {
    if (!this.ready) return [];
    const requests = desiredChangesForGoal(goal, goalDifference);
    const results: EffectRecallCandidateV1[] = [];
    for (const annotation of this.#annotations) {
      if (!this.#active(annotation)) continue;
      const matching = annotation.kernelChanges.flat().filter(change => requests.some(request => matches(change, request.desired)));
      if (matching.length === 0) continue;
      const goalPredicateIds = requests.filter(request => matching.some(change => matches(change, request.desired)))
        .map(request => request.predicateId);
      const evidence = this.#evidence(annotation, observation);
      results.push({ candidateId: sha({ eventId: annotation.eventId, anchorId: annotation.anchorId,
        pageId: annotation.pageId, traceId: annotation.traceId }), goalPredicateIds: [...new Set(goalPredicateIds)].sort(),
        actionCue: structuredClone(annotation.cue), observedChanges: structuredClone(matching),
        observedBefore: structuredClone(annotation.context), evidence,
        unknown: [...new Set(['observed-context-is-not-proof-of-necessity',
          ...(evidence.r2a.applicability <= 0 ? ['historical-only-current-condition-unsupported'] : [])])] });
    }
    return results.sort((left, right) => Number(right.evidence.r1.active && right.evidence.r2.active)
      - Number(left.evidence.r1.active && left.evidence.r2.active)
      || right.evidence.r2a.applicability - left.evidence.r2a.applicability
      || left.candidateId.localeCompare(right.candidateId));
  }
  compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): ConditionApplicabilityV1 {
    const annotation = this.#annotation(candidate);
    const relations = this.#productionRelations(annotation)
      .filter(relation => candidate.evidence.r2a.relationIds.length === 0
        || candidate.evidence.r2a.relationIds.includes(relation.hyperedgeId));
    if (relations.length === 0) return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: 0, productionEligible: false };
    let active: ReadonlyMap<string, number>, inactive: ReadonlySet<string>;
    if ('version' in state) {
      active = new Map(state.knownActiveFactorIds.map(factorId => [factorId, 1]));
      inactive = new Set(state.knownInactiveFactorIds);
    } else { active = this.#activeFactors(this.#perception(state)); inactive = new Set<string>(); }
    let best: { relation: typeof relations[number]; matched: string[]; contradicted: string[]; unknown: string[]; applicability: number } | null = null;
    for (const relation of relations) {
      const matched = relation.factorIds.filter(factorId => active.has(factorId));
      const contradicted = relation.factorIds.filter(factorId => inactive.has(factorId));
      const unknown = relation.factorIds.filter(factorId => !active.has(factorId) && !inactive.has(factorId));
      const applicability = contradicted.length > 0 || unknown.length > 0 ? 0
        : Math.min(relation.relationStrength, ...relation.factorIds.map(factorId => active.get(factorId)!));
      const item = { relation, matched, contradicted, unknown, applicability };
      if (!best || item.applicability > best.applicability || item.matched.length > best.matched.length
        || item.relation.hyperedgeId.localeCompare(best.relation.hyperedgeId) < 0) best = item;
    }
    return { matchedFactorIds: [...best!.matched].sort(), contradictedFactorIds: [...best!.contradicted].sort(),
      unknownFactorIds: [...best!.unknown].sort(), applicability: best!.applicability, productionEligible: true };
  }
  #factorTransitionFromActive(annotation: TraceAnnotation, before: ReadonlyMap<string, number>,
    after: ReadonlyMap<string, number>): Omit<OpaqueFactorTransitionTraceV1, 'evidence'> | null {
    const activated = [...after.keys()].filter(factorId => !before.has(factorId)).sort();
    const deactivated = [...before.keys()].filter(factorId => !after.has(factorId)).sort();
    const unchanged = [...after.keys()].filter(factorId => before.has(factorId)).sort();
    if (activated.length === 0 && deactivated.length === 0) return null;
    return { version: 'OpaqueFactorTransitionTraceV1', transitionId: sha({ eventId: annotation.eventId,
      activated, deactivated, unchanged }), eventId: annotation.eventId, actionCue: structuredClone(annotation.cue),
      activatedFactorIds: activated, deactivatedFactorIds: deactivated, unchangedActiveFactorIds: unchanged,
      meaning: 'observed-factor-transition' };
  }
  #factorTransition(annotation: TraceAnnotation): Omit<OpaqueFactorTransitionTraceV1, 'evidence'> | null {
    if (!annotation.beforeFactorPerception || !annotation.afterFactorPerception) return null;
    return this.#factorTransitionFromActive(annotation,
      this.#activeFactors(new Float64Array(annotation.beforeFactorPerception)),
      this.#activeFactors(new Float64Array(annotation.afterFactorPerception)));
  }
  recallFactorTransition(factorIds: readonly string[], state: Observation | HypotheticalPublicStateV1):
    readonly OpaqueFactorTransitionTraceV1[] {
    const requested = new Set(factorIds);
    if (!this.ready || requested.size === 0) return [];
    const annotations = this.#annotations.filter(annotation => this.#active(annotation)
      && annotation.beforeFactorPerception && annotation.afterFactorPerception);
    const perceptions = annotations.flatMap(annotation => [
      new Float64Array(annotation.beforeFactorPerception!),
      new Float64Array(annotation.afterFactorPerception!),
    ]);
    const audits = this.#r2a.activationAudits(perceptions);
    const graph = this.#r2a.exportState();
    const nodeById = new Map(graph.factorNodes.map(node => [node.factorId, node]));
    const traces: OpaqueFactorTransitionTraceV1[] = [];
    for (let index = 0; index < annotations.length; index++) {
      const annotation = annotations[index]!;
      const before = this.#activeFactorsFromAudit(audits[index * 2]!, nodeById);
      const after = this.#activeFactorsFromAudit(audits[index * 2 + 1]!, nodeById);
      const transition = this.#factorTransitionFromActive(annotation, before, after);
      if (!transition || ![...transition.activatedFactorIds, ...transition.deactivatedFactorIds]
        .some(factorId => requested.has(factorId))) continue;
      traces.push({ ...transition, evidence: this.#evidence(annotation, 'version' in state ? undefined : state) });
    }
    return traces.sort((left, right) => left.transitionId.localeCompare(right.transitionId));
  }
  predictCandidate(candidate: EffectRecallCandidateV1, state: Observation | HypotheticalPublicStateV1,
    goal: GroundedGoalV1): BranchPredictionV1 {
    void goal;
    const annotation = this.#annotation(candidate);
    // A recall candidate is historical provenance, not a cache of the current
    // physical state.  Re-read every physical layer at prediction time.  A
    // hypothetical state has no public perception with which to query R2A, so
    // it must not inherit the historical candidate's applicability.
    const observedState = 'version' in state ? null : state;
    const liveEvidence = this.#evidence(annotation, observedState ?? undefined);
    const currentEvidence: PhysicalEvidenceReferenceV1 = observedState ? liveEvidence : {
      ...liveEvidence,
      r2a: { ...liveEvidence.r2a, applicability: 0, productionEligible: false },
    };
    const refreshedCandidate: EffectRecallCandidateV1 = { ...candidate, evidence: currentEvidence };
    const condition = observedState ? this.compareConditions(refreshedCandidate, state) : {
      matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [...currentEvidence.r2a.relationIds],
      applicability: 0, productionEligible: false,
    };
    const kind = 'hypothetical-prediction' as const;
    const empty = (reason: string): BranchPredictionV1 => ({ prediction: { kind, support: 0, calibratedProbability: false,
      samples: [], evidence: currentEvidence, unknown: [reason], mapSha256: this.mapSha256 }, currentEvidence,
      validSampleCount: 0, progressSampleCount: 0, progressFraction: 0, nextStates: [], unknown: [reason] });
    if (!observedState) return empty('hypothetical-state-current-public-perception-unavailable');
    if (!currentEvidence.r1.active) return empty('r1-trace-inactive');
    if (!currentEvidence.r2.active) return empty('r2-basin-inactive');
    if (!currentEvidence.r2a.productionEligible || currentEvidence.r2a.applicability <= 0)
      return empty('current-R2A-condition-unsupported');
    if (!condition.productionEligible || condition.applicability <= 0) return empty('current-R2A-condition-unsupported');
    const snapshot = this.#store.r1.traceSnapshot(annotation.pageId, annotation.traceId);
    if (!snapshot) return empty('r1-trace-snapshot-unavailable');
    const resolution = adaptPredictionTraceResolution(snapshot);
    const predictionSnapshot = resolution.snapshot;
    const centers = predictionSnapshot.kernels.map(kernel => kernel.center), tangent = pathInitialTangent(centers);
    if (!tangent) return empty('r1-trace-has-no-tangent');
    const expected = annotation.kernelChanges.flat().filter(change => candidate.observedChanges.some(observed =>
      observed.subject === change.subject && observed.property === change.property));
    const samples: Prediction['samples'][number][] = [];
    const nextStates: HypotheticalPublicStateV1[] = [];
    let progressSampleCount = 0;
    const transition = this.#factorTransition(annotation);
    // The production relation set is immutable for this read-only prediction.
    // Exporting the complete R2A graph once per random seed made one 24-sample
    // rollout repeat the same large graph traversal 24 times.
    const factorUniverse = new Set(this.#productionRelations(annotation).flatMap(relation => relation.factorIds));
    for (let seed = 0; seed < 24; seed++) {
      const random = new SplitMix64(BigInt(seed + 1));
      const predicted = this.#clone.run(predictionSnapshot, centers[0]!, tangent, random, 180);
      const transported = transportTraceSnapshot(predictionSnapshot, centers[0]!, tangent)!;
      const readSnapshot = { ...predictionSnapshot, kernels: predictionSnapshot.kernels.map((kernel, index) => ({ ...kernel, center: transported[index]! })) };
      const read = readVisitedRegions(readSnapshot, predicted.positions, annotation.kernelChanges);
      const visitedTerminal = read.readout.some(item => item.originalKernelIndex === snapshot.kernels.length - 1);
      const changes = read.readout.flatMap(item => item.changes);
      const progresses = expected.some(desired => changes.some(change => change.subject === desired.subject
        && change.property === desired.property && change.after === desired.after));
      if (progresses) progressSampleCount++;
      samples.push({ seed, traceId: snapshot.traceId, pageId: snapshot.pageId,
        positions: restorePredictionTracePositions(predicted.positions, centers[0]!, resolution.scaleFactor).map(position => [...position]),
        readout: read.readout.map(item => ({ ...item, distance: item.distance / resolution.scaleFactor })),
        reason: read.reason, resolutionScale: resolution.scaleFactor });
      const baseObservationSequence = 'version' in state ? state.baseObservationSequence : state.sequence;
      nextStates.push({ version: 'HypotheticalPublicStateV1', baseObservationSequence,
        knownChanges: structuredClone(changes),
        knownActiveFactorIds: visitedTerminal && transition ? [...transition.activatedFactorIds, ...transition.unchangedActiveFactorIds].sort() : [],
        knownInactiveFactorIds: visitedTerminal && transition ? [...transition.deactivatedFactorIds].sort() : [],
        unknownFactorIds: visitedTerminal && transition ? [] : [...factorUniverse].sort(), unobserved: 'unknown' });
    }
    const validSampleCount = samples.filter(sample => sample.readout.length > 0).length;
    const support = Math.min(currentEvidence.r1.active ? 1 : 0, currentEvidence.r2.active ? 1 : 0,
      currentEvidence.r2a.applicability, condition.applicability);
    const prediction: Prediction = { kind, support, calibratedProbability: false,
      samples, evidence: { candidate: refreshedCandidate, condition },
      unknown: [...new Set(samples.flatMap(sample => sample.reason ? [sample.reason] : []))], mapSha256: this.mapSha256 };
    return { prediction, currentEvidence, validSampleCount, progressSampleCount,
      progressFraction: samples.length === 0 ? 0 : progressSampleCount / samples.length, nextStates,
      unknown: prediction.unknown };
  }
  recall(desired: DesiredChange, observation: Observation, offset = 0): unknown {
    if (!this.ready) return { kind: 'historical-observation', candidates: [], unknown: 'physical-initialization-not-ready', buffered: this.bufferedEvents };
    const current = relativePublicFeatures(observation);
    const candidates = this.#annotations.filter(a => this.#active(a) && a.kernelChanges.flat().some(c => matches(c, desired)));
    return { kind: 'historical-observation', total: candidates.length, offset, nextOffset: offset + 2 < candidates.length ? offset + 2 : null,
      candidates: candidates.slice(offset, offset + 2).map(a => {
      // The action is already conditioned on. Preserve its whole candidate distribution,
      // then bind this history to its own trace contributions, never to the action average.
      const prepared = this.#prepared(a.cue, observation);
      const relations = this.#r2a.productionRelationsForAudit();
      const contributions = prepared.query.contributions
        .filter(c => c.r1Trace.pageId === a.pageId && c.r1Trace.traceId === a.traceId)
        .map(c => ({ ...c, matchedRelations: c.matchedRelationIds.flatMap(relationId => {
          const matches = prepared.query.r3Matches.filter(match => match.relationId === relationId);
          return (matches.length ? matches : [null]).map(match => ({ ...match, relationId,
            state: relations.find(edge => edge.hyperedgeId === relationId)?.state ?? 'unknown' }));
        }) }));
      const different = Object.entries(a.context).filter(([key, value]) => current[key] !== value).map(([property, historical]) =>
        ({ property, historical, current: current[property] ?? 'unknown', necessaryCondition: false }));
      const matching = a.kernelChanges.flat().filter(c => matches(c, desired));
      const occurred = this.#store.coactivations().find(c => c.experienceAnchorId === a.anchorId
        && c.r1Trace.pageId === a.pageId && c.r1Trace.traceId === a.traceId);
      return { eventId: a.eventId, action: a.cue, actualObserved: matching, actualObservedScope: 'matching-historical-changes',
        // Old annotations have event-local indices, not absolute frame numbers. Do not infer missing times.
        historicalOccurrence: { endActiveSeconds: occurred?.observedAt ?? null, observationSequence: null },
        observedBefore: a.context, currentDifferences: different, r1: { pageId: a.pageId, traceId: a.traceId }, r2: a.r2Coordinate,
        currentApplicability: { scope: 'this-historical-trace-in-full-action-query', calibratedProbability: false, contributions },
        actionAggregateSupport: prepared.evidence, r2a: relations.filter(edge => edge.interventionKey === cueIdentity(a.cue)),
        unknown: ['observed-context-is-not-proof-of-necessity', ...(contributions.every(c => c.matchedRelationIds.length === 0)
          ? ['historical-only-no-current-R2A-support'] : [])] };
    }) };
  }
  predict(cue: ActionCue, observation: Observation, options: { seeds?: number; steps?: number; prefix?: RealEvent } = {}): Prediction {
    const kind = options.prefix ? 'factual-prediction' as const : 'hypothetical-prediction' as const;
    const empty = (reason: string, evidence: unknown = null): Prediction => ({ kind, support: 0, calibratedProbability: false,
      samples: [], evidence, unknown: [reason], mapSha256: this.mapSha256 });
    if (!this.ready) return empty('physical-initialization-not-ready');
    const prepared = this.#prepared(cue, observation);
    if (prepared.evidence.querySpecificR2aApplicability <= 0) return empty('no-current-physical-R2A-condition', prepared.evidence);
    let source: Vec3 | null = null;
    if (options.prefix) {
      validateEvent(options.prefix);
      assert(this.#map, 'event-map-missing');
      const points = eventRows(options.prefix).rows.map(row => this.#map!.encode(row));
      if (points.some(point => point.unknownKeys.length > 0)) return empty('unrepresented-factual-prefix', prepared.evidence);
      source = new Float64Array(points.at(-1)!.coordinate);
    }
    const samples: Array<Prediction['samples'][number]> = [];
    for (let seed = 0; seed < (options.seeds ?? 24); seed++) {
      const random = new SplitMix64(BigInt(seed + 1)); let draw = random.uniform();
      let selected = prepared.query.contributions.at(-1)!;
      for (const candidate of prepared.query.contributions) { draw -= candidate.weight; if (draw <= 0) { selected = candidate; break; } }
      const snapshot = this.#store.r1.traceSnapshot(selected.r1Trace.pageId, selected.r1Trace.traceId);
      if (!snapshot) continue;
      let actualSnapshot = snapshot;
      let kernelOffset = 0;
      if (source) {
        const nearest = snapshot.kernels.map((kernel, i) => ({ i, distance: Math.hypot(...source!.map((v, j) => v - kernel.center[j]!)) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!nearest || nearest.distance > R1_CONFIG.kernelWidth * .25 || nearest.i >= snapshot.kernels.length - 1) continue;
        kernelOffset = nearest.i;
        actualSnapshot = { ...snapshot, kernels: snapshot.kernels.slice(kernelOffset) };
      }
      const resolution = adaptPredictionTraceResolution(actualSnapshot);
      const predictionSnapshot = resolution.snapshot;
      const centers = predictionSnapshot.kernels.map(k => k.center), tangent = pathInitialTangent(centers);
      if (!tangent) continue;
      // A genuine prefix can select a locally aligned *remaining physical road*, not a historical result.
      // Clone still performs every isotropic proposal and Metropolis decision unchanged.
      const start = source ?? centers[0]!;
      const predicted = this.#clone.run(predictionSnapshot, start, tangent, random, options.steps ?? 180);
      const annotation = this.#annotations.find(a => a.traceId === snapshot.traceId)!;
      const transported = transportTraceSnapshot(predictionSnapshot, start, tangent)!;
      const readSnapshot = { ...predictionSnapshot, kernels: predictionSnapshot.kernels.map((kernel, i) => ({ ...kernel, center: transported[i]! })) };
      const read = readVisitedRegions(readSnapshot, predicted.positions, annotation.kernelChanges.slice(kernelOffset), {
        kernelOffset, observedThroughOriginalKernelIndex: source === null ? null : kernelOffset });
      samples.push({ seed, traceId: snapshot.traceId, pageId: snapshot.pageId,
        positions: restorePredictionTracePositions(predicted.positions, start, resolution.scaleFactor).map(p => [...p]),
        readout: read.readout.map(item => ({ ...item, distance: item.distance / resolution.scaleFactor })),
        reason: read.reason, resolutionScale: resolution.scaleFactor });
    }
    if (source !== null && samples.length === 0) return empty('factual-prefix-continuation-not-identifiable', prepared.evidence);
    return { kind, support: prepared.evidence.coreEvidenceSupport, calibratedProbability: false, samples,
      evidence: prepared, unknown: [...new Set(samples.flatMap(s => s.reason ? [s.reason] : []))], mapSha256: this.mapSha256 };
  }
  snapshot(): MemorySnapshot {
    return { version: 'KairosV5MemoryV4', eventMeasurementVersion: R2_EVENT_MEASUREMENT_ADAPTER_V2,
      activeSeconds: this.#activeSeconds, eventMap: this.#map?.state ?? null,
      contextKeys: [...this.#contextKeys], contextVocabulary: [...this.#contextVocabulary],
      projector: this.ready ? this.#projector.exportState() : null,
      tokenEncoder: this.ready ? this.#encoder.exportState() : null, store: this.#store.exportCheckpointState(),
      r2a: this.ready ? this.#r2a.exportState() : null, annotations: structuredClone(this.#annotations),
      pendingInitialization: structuredClone(this.#pending), seenEventIds: [...this.#seen], writes: this.#writes };
  }
  static restore(snapshot: MemorySnapshot): PhysicalMemory {
    assert(snapshot.version === 'KairosV5MemoryV4'
      && snapshot.eventMeasurementVersion === R2_EVENT_MEASUREMENT_ADAPTER_V2
      && Array.isArray(snapshot.contextVocabulary),
    'V5-rejects-legacy-experience-rebuild-from-trusted-raw-events');
    const memory = new PhysicalMemory(); memory.#activeSeconds = snapshot.activeSeconds;
    memory.#seen = new Set(snapshot.seenEventIds); memory.#writes = snapshot.writes;
    memory.#pending = structuredClone([...snapshot.pendingInitialization]);
    memory.#store = new ExperienceMediaStore(snapshot.store);
    memory.#annotations = structuredClone([...snapshot.annotations]); memory.#contextKeys = [...snapshot.contextKeys];
    memory.#contextVocabulary = [...snapshot.contextVocabulary];
    if (snapshot.eventMap) {
      assert(snapshot.projector && snapshot.tokenEncoder && snapshot.r2a, 'incomplete-V5-map-snapshot');
      memory.#map = new DistanceEmbedding(snapshot.eventMap); memory.#projector = PathProjector.fromState(snapshot.projector);
      memory.#encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
      memory.#r2a = new OpenCausalFactorR2A(memory.#encoder, memory.#store, snapshot.r2a);
    }
    assert(canonical(memory.snapshot()) === canonical(snapshot), 'V5-snapshot-not-reproducible');
    return memory;
  }
  /** Test-only destructive ablation. The public worker protocol does not expose this method. */
  ablateForTest(medium: 'R1' | 'R2' | 'R2A'): void {
    if (medium === 'R1') this.#store.r1.recover(1e9);
    if (medium === 'R2') this.#store.r2.recover(1e9);
    if (medium === 'R2A') this.#r2a.recover(1e9, true);
  }
}
