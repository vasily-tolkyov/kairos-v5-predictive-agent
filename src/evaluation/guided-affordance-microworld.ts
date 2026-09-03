import type { Action, Observation, PublicObject, RealEvent } from '../contracts.js';
import type { ActionOfferV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1, GoalEvaluationV1, GroundedGoalV1,
  HypotheticalPublicStateV1, JointTransientControlFieldConfigV2, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from '../control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2 } from '../control/controller.js';
import { cueFor } from '../events.js';
import { PhysicalMemory, type MemorySnapshot } from '../memory.js';
import { legacyCandidateAsInactiveDistributedAuditV3,
  legacyTransitionAsInactiveDistributedAuditV3,
  type LegacyEffectRecallCandidateV1 }
  from '../legacy/audit-control-contracts.js';
import { assert, sha } from '../util.js';

export type GuidedAffordanceMode = 'look-plus-acquire' | 'look-plus-away'
  | 'look-minus-acquire' | 'look-minus-away' | 'interact-effect' | 'interact-no-effect' | 'observe';

const startYaw = (mode: GuidedAffordanceMode): number => {
  if (mode === 'look-plus-acquire') return -15;
  if (mode === 'look-plus-away') return 15;
  if (mode === 'look-minus-acquire') return 15;
  if (mode === 'look-minus-away') return -15;
  return 0;
};
const yawDelta = (mode: GuidedAffordanceMode): number => mode.startsWith('look-plus') ? 15
  : mode.startsWith('look-minus') ? -15 : 0;

export function guidedAffordanceEvent(index: number, mode: GuidedAffordanceMode): RealEvent {
  const cycle = Math.floor(index / 8), layout = cycle % 8;
  const controlId = `control-instance-${index}`, indicatorId = `indicator-instance-${index}`;
  const enabled = mode !== 'interact-no-effect';
  const action: Action = mode.startsWith('look-plus')
    ? { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }
    : mode.startsWith('look-minus')
      ? { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } }
      : mode === 'observe' ? { kind: 'observe', parameters: { ticks: 5 } }
        : { kind: 'interact', parameters: {}, targetId: controlId };
  const frames: Observation[] = Array.from({ length: 9 }, (_, step) => {
    const progress = step / 8, yaw = (startYaw(mode) + yawDelta(mode) * progress) * Math.PI / 180;
    const acquired = mode.endsWith('acquire') && step >= 7;
    const targetId = mode.startsWith('interact') || (mode === 'observe' && cycle % 2 === 0) || acquired ? controlId : null;
    const active = mode === 'interact-effect' && step >= 4;
    const objects: PublicObject[] = [
      // The public geometry agrees with the fixture's declared aim: yaw 0
      // faces the control.  Older synthetic coordinates placed the object at
      // a different bearing and relied on an unrelated `aimed` boolean.
      { id: controlId, type: 'opaque-control', relativePosition: [0, 0, -3 - layout * .01], properties: { enabled } },
      { id: indicatorId, type: 'opaque-indicator', relativePosition: [1.5, 0, -2.5 - layout * .01], properties: { active } },
    ];
    return { sequence: index * 12 + step + 1, activeSeconds: index * .6 + step * .05,
      self: { position: [0, 0, 0], yaw, pitch: 0, properties: { stable: true } },
      objects, targetId, contextId: `guided-layout-${layout}` };
  });
  return { version: 'RealEventV5', id: `guided-${index}-${mode}`,
    cue: { kind: action.kind, parameters: { ...action.parameters },
      targetRole: action.kind === 'interact' ? 'opaque-control' : null },
    frames, trackedIds: ['self', controlId, indicatorId], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed',
      startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence } };
}

export function guidedAffordanceCurriculum(): readonly RealEvent[] {
  const pattern: readonly GuidedAffordanceMode[] = ['look-plus-acquire', 'look-plus-away',
    'look-minus-acquire', 'look-minus-away', 'interact-effect', 'interact-no-effect', 'observe', 'observe'];
  return Array.from({ length: 128 }, (_, index) => guidedAffordanceEvent(index, pattern[index % pattern.length]!));
}

export function guidedAffordanceObservation(options: { sequence: number; activeSeconds: number;
  yaw: number; enabled: boolean; active: boolean; aimed: boolean; layout?: number }): Observation {
  const layout = options.layout ?? 99;
  return { sequence: options.sequence, activeSeconds: options.activeSeconds,
    self: { position: [0, 0, 0], yaw: options.yaw * Math.PI / 180, pitch: 0, properties: { stable: true } },
    objects: [
      { id: 'test-control', type: 'opaque-control', relativePosition: [0, 0, -3 - layout * .001],
        properties: { enabled: options.enabled } },
      { id: 'test-indicator', type: 'opaque-indicator', relativePosition: [1.5, 0, -2.5 - layout * .001],
        properties: { active: options.active } },
    ], targetId: options.aimed ? 'test-control' : null, contextId: `unseen-layout-${layout}` };
}

export const guidedAffordanceGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'unseen-indicator-active',
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'indicator-active',
    subject: { kind: 'public-object', id: 'test-indicator', expectedType: 'opaque-indicator' },
    observable: 'properties.active', comparator: 'equals', target: true } } };

export const guidedAffordanceCrosshairGoal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'aim-control',
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'target-type',
    subject: { kind: 'crosshair' }, observable: 'type', comparator: 'equals', target: 'opaque-control' } } };

export const guidedAffordanceControlConfig: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260829, branchCapacity: 8,
  stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

export class GuidedAffordanceEnvironment implements PhysicalControlEnvironmentV2 {
  readonly actionBudget = 8;
  actionCount = 0;
  readonly timeline: Array<{ readonly kind: string; readonly value: unknown }> = [];
  #sequence = 3000;
  #activeSeconds = 80;
  #yawDegrees: number;
  #aimed = false;
  #indicatorActive = false;
  constructor(readonly memory: PhysicalMemory, yawDegrees: -15 | 15, readonly layout = 101) {
    this.#yawDegrees = yawDegrees;
  }
  async observe(): Promise<Observation> { return this.#frame(); }
  async waitForObservationAfter(afterSequence: number): Promise<Observation> {
    if (this.#sequence <= afterSequence) { this.#sequence = afterSequence + 1; this.#activeSeconds += .05; }
    return this.#frame();
  }
  describeActionRequirement(actionCue: ActionOfferV1['cue'], observation: Observation): {
    readonly satisfied: boolean; readonly missing: readonly string[];
    readonly goal: GroundedGoalV1 | null } {
    // This is the abstract body's public affordance report, not a planning
    // rule: an interaction learned against an opaque control is executable
    // only while that same public type is under the crosshair.  How to make
    // the predicate true must still be recovered from physical experience.
    if (actionCue.kind !== 'interact') return { satisfied: true, missing: [], goal: null };
    const target = observation.targetId === null ? null
      : observation.objects.find(object => object.id === observation.targetId) ?? null;
    const satisfied = target?.type === actionCue.targetRole;
    return { satisfied, missing: satisfied ? [] : ['public-crosshair-block'],
      goal: satisfied ? null : guidedAffordanceCrosshairGoal };
  }
  #frame(): Observation { return guidedAffordanceObservation({ sequence: this.#sequence,
    activeSeconds: this.#activeSeconds, yaw: this.#yawDegrees, enabled: true,
    active: this.#indicatorActive, aimed: this.#aimed, layout: this.layout }); }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    assert(observation.sequence === this.#sequence, 'micro-world-offers-require-latest-observation');
    const actions: Action[] = [
      { kind: 'observe', parameters: { ticks: 5 } },
      { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } },
      { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
    ];
    if (this.#aimed) actions.push({ kind: 'interact', parameters: {}, targetId: 'test-control' });
    return actions.map(action => ({ version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
      observationSequence: observation.sequence, action, cue: cueFor(action, observation) }));
  }
  async executeOffer(offer: ActionOfferV1): Promise<{ readonly executed: boolean;
    readonly observation: Observation; readonly eventId: string | null }> {
    assert(offer.observationSequence === this.#sequence, 'micro-world-stale-action-offer');
    this.actionCount++;
    const start = this.#frame(), frames: Observation[] = [start];
    const startYaw = this.#yawDegrees, startActive = this.#indicatorActive;
    for (let step = 1; step <= 8; step++) {
      const progress = step / 8;
      if (offer.action.kind === 'look') this.#yawDegrees = startYaw + Number(offer.action.parameters.yawDegrees) * progress;
      if (offer.action.kind === 'interact' && step >= 4) this.#indicatorActive = true;
      this.#aimed = Math.abs(this.#yawDegrees) <= 2;
      this.#sequence++; this.#activeSeconds += .05; frames.push(this.#frame());
    }
    const event: RealEvent = { version: 'RealEventV5', id: `unseen-layout-${this.layout}-event-${this.actionCount}`,
      cue: structuredClone(offer.cue), frames, trackedIds: ['self', 'test-control', 'test-indicator'],
      provenance: 'executed-real-body', complete: true,
      bodyResult: { action: structuredClone(offer.action), executed: true, status: 'completed',
        startSequence: start.sequence, endSequence: frames.at(-1)!.sequence } };
    const receipt = this.memory.observe(event);
    assert(receipt.status !== 'real-event-not-representable', `evaluation-event-not-representable:${JSON.stringify(receipt)}`);
    this.timeline.push({ kind: 'physical-action', value: { action: offer.action, startYaw,
      endYaw: this.#yawDegrees, startActive, endActive: this.#indicatorActive, receipt } });
    return { executed: true, observation: this.#frame(), eventId: event.id };
  }
  async status(): Promise<{ readonly ready: boolean; readonly bufferedEvents: number; readonly writes: number }> {
    return { ready: this.memory.ready, bufferedEvents: this.memory.bufferedEvents, writes: this.memory.writes };
  }
  record(kind: string, value: unknown): void { this.timeline.push({ kind, value: structuredClone(value) }); }
}

export interface GuidedAffordanceEvaluationResultV1 {
  readonly version: 'GuidedAffordanceEvaluationResultV1';
  readonly training: { readonly realEvents: 128; readonly mapSha256: string; readonly memorySha256: string };
  readonly cases: readonly { readonly initialYawDegrees: -15 | 15; readonly status: string;
    readonly actions: readonly string[]; readonly finalActive: boolean; readonly timeline: readonly unknown[] }[];
}

/** Explicitly legacy evaluation adapter. It keeps the old V1 fixture buildable
 * without presenting its one-event R2/R2A state as hierarchical evidence. */
class LegacyGuidedReasoningAuditAdapterV2 implements PhysicalReasoningPortV2 {
  readonly #legacyCandidates = new Map<string, LegacyEffectRecallCandidateV1>();
  constructor(readonly memory: PhysicalMemory) {}
  #candidates(values: readonly LegacyEffectRecallCandidateV1[]): readonly EffectRecallCandidateV1[] {
    for (const value of values) this.#legacyCandidates.set(value.candidateId, value);
    return values.map(legacyCandidateAsInactiveDistributedAuditV3);
  }
  recallByEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.#candidates(this.memory.recallByEffect(goal, difference, observation));
  }
  recallAtomicEffect(goal: GroundedGoalV1, difference: GoalEvaluationV1, observation: Observation) {
    return this.#candidates(this.memory.recallByEffect(goal, difference, observation));
  }
  recallContinuousPattern(): readonly ContinuousPatternRecallV2[] { return []; }
  compareConditions(candidate: EffectRecallCandidateV1, observation: Observation) {
    const legacy = this.#legacyCandidates.get(candidate.candidateId);
    assert(legacy, 'legacy-audit-candidate-not-recalled');
    return this.memory.compareConditions(legacy, observation);
  }
  compareCurrentFactors(): ConditionApplicabilityV1 {
    return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
      applicability: 0, productionEligible: false };
  }
  compareProjectedParentRelations(_relationIds: readonly string[], _observation: Observation,
    states: readonly HypotheticalPublicStateV1[]): readonly ProjectedParentRelationApplicabilityV1[] {
    return states.map(() => ({ version: 'ProjectedParentRelationApplicabilityV1',
      selectedRelationId: null, relationResults: [], matchedFactorIds: [], contradictedFactorIds: [],
      unknownFactorIds: ['legacy-audit-has-no-hierarchical-R2A-relation'], applicability: 0,
      productionEligible: false }));
  }
  predictCandidate(candidate: EffectRecallCandidateV1, observation: Observation, goal: GroundedGoalV1,
    _evaluation: GoalEvaluationV1) {
    void observation; void goal;
    return { prediction: { version: 'DistributedPredictionV3' as const,
      kind: 'hypothetical-prediction' as const, support: 0, calibratedProbability: false as const,
      samples: [], evidence: candidate.evidence,
      unknown: ['legacy-audit-rollout-is-not-distributed-physical-evidence'], substrateSha256: null },
    currentEvidence: candidate.evidence, validSampleCount: 0, progressSampleCount: 0,
    progressFraction: 0, nextStates: [],
    unknown: ['legacy-audit-rollout-is-not-distributed-physical-evidence'] };
  }
  predictContinuation(patternId: string): ContinuationPredictionV2 {
    return { version: 'ContinuationPredictionV2', patternId, support: 0, samples: [],
      evidenceGrade: 'single-observation', unknown: ['legacy-audit-has-no-continuous-R2-pattern'] };
  }
  recallFactorTransition(factorIds: readonly string[], observation: Observation) {
    return this.memory.recallFactorTransition(factorIds, observation)
      .map(legacyTransitionAsInactiveDistributedAuditV3);
  }
}

export async function runGuidedAffordanceEvaluation(): Promise<GuidedAffordanceEvaluationResultV1> {
  const memory = new PhysicalMemory(); for (const event of guidedAffordanceCurriculum()) memory.observe(event);
  assert(memory.ready && memory.mapSha256, 'guided-curriculum-did-not-initialize-physical-memory');
  const frozen: MemorySnapshot = memory.snapshot(), memorySha256 = sha(frozen);
  const cases = [] as Array<GuidedAffordanceEvaluationResultV1['cases'][number]>;
  for (const initialYawDegrees of [-15, 15] as const) {
    const isolatedMemory = PhysicalMemory.restore(frozen);
    const environment = new GuidedAffordanceEnvironment(isolatedMemory, initialYawDegrees,
      initialYawDegrees < 0 ? 101 : 102);
    const manager = new PhysicalControlManagerV2(new LegacyGuidedReasoningAuditAdapterV2(isolatedMemory),
      environment, guidedAffordanceControlConfig);
    const result = await manager.runGoal(guidedAffordanceGoal);
    const actions = environment.timeline.filter(item => item.kind === 'physical-action')
      .map(item => ((item.value as { action: Action }).action.kind));
    const final = await environment.observe();
    cases.push({ initialYawDegrees, status: result.status, actions,
      finalActive: final.objects.find(object => object.id === 'test-indicator')?.properties.active === true,
      timeline: structuredClone(environment.timeline) });
  }
  return { version: 'GuidedAffordanceEvaluationResultV1', training: { realEvents: 128,
    mapSha256: memory.mapSha256, memorySha256 }, cases };
}
