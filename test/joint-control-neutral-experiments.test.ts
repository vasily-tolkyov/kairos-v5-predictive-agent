import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, PublicChange } from '../src/contracts.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { JointTransientControlFieldV2 } from '../src/control/field.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, EffectRecallCandidateV1,
  GroundedGoalV1, HypotheticalPublicStateV1, JointControlDrivesV2, JointTransientControlFieldConfigV2,
  OpaqueFactorTransitionTraceV1, PhysicalEvidenceReferenceV1, PhysicalReasoningPortV1 } from '../src/control/contracts.js';
import { PhysicalControlManagerV2, type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { cueFor, cueIdentity } from '../src/events.js';
import { sha } from '../src/util.js';

type Role = 'alpha' | 'beta' | 'gamma' | 'delta' | 'observe';
type Depth = 2 | 3;
type Ablation = 'none' | 'condition' | 'rollout' | 'transition-recall';

const CONFIG_BASE: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 1, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};
const config = (seed: number): JointTransientControlFieldConfigV2 => ({ ...CONFIG_BASE, seed });
const ZERO_DRIVES: JointControlDrivesV2 = { goal: 0, evidence: 0, condition: 0, rollout: 0,
  unknown: 0, attention: 0, novelty: 0, habit: 0 };

const PALETTE: readonly Action[] = [
  { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
  { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } },
  { kind: 'move', parameters: { direction: 'left', ticks: 4 } },
  { kind: 'jump', parameters: { forward: false, ticks: 4 } },
];
const OBSERVE: Action = { kind: 'observe', parameters: { ticks: 5 } };

interface IsomorphismVariant {
  readonly id: string;
  readonly actions: Readonly<Record<Role, Action>>;
  readonly candidateIds: Readonly<Record<Exclude<Role, 'observe'>, string>>;
  readonly offerOrder: readonly Role[];
  readonly recallOrder: readonly ('beta' | 'delta')[];
}

const roleOrder: readonly Exclude<Role, 'observe'>[] = ['alpha', 'beta', 'gamma', 'delta'];
const offerOrders: readonly (readonly Role[])[] = [
  ['alpha', 'beta', 'observe', 'gamma', 'delta'],
  ['beta', 'alpha', 'observe', 'delta', 'gamma'],
  ['gamma', 'beta', 'alpha', 'observe', 'delta'],
  ['observe', 'alpha', 'beta', 'delta', 'gamma'],
];
const variants: readonly IsomorphismVariant[] = Array.from({ length: 4 }, (_, index) => {
  const actions = Object.fromEntries(roleOrder.map((role, roleIndex) =>
    [role, PALETTE[(roleIndex + index) % PALETTE.length]!])) as Record<Exclude<Role, 'observe'>, Action>;
  return {
    id: `iso-${index}`,
    actions: { ...actions, observe: OBSERVE },
    candidateIds: {
      alpha: `opaque-${index}-q${(index + 2) % 7}`,
      beta: `opaque-${index}-q${(index + 5) % 7}`,
      gamma: `opaque-${index}-q${(index + 1) % 7}`,
      delta: `opaque-${index}-q${(index + 6) % 7}`,
    },
    offerOrder: offerOrders[index]!,
    recallOrder: index % 2 === 0 ? ['beta', 'delta'] : ['delta', 'beta'],
  };
});

const TARGET_CHANGE: PublicChange = { subject: 'opaque#0', property: 'R', before: false, after: true,
  observationIndex: 1, meaning: 'observed-co-occurrence' };
const GOAL: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'opaque-result',
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'R',
    subject: { kind: 'public-object', id: 'opaque', expectedType: 'opaque' },
    observable: 'properties.R', comparator: 'equals', target: true } } };

const evidence = (id: string, active = true): PhysicalEvidenceReferenceV1 => ({
  eventId: `event:${id}`, anchorId: `anchor:${id}`,
  r1: { pageId: 'r1', traceId: id, active },
  r2: { coordinate: [0, 0, 0], active },
  r2a: { relationIds: [`relation:${id}`], applicability: active ? .9 : 0,
    productionEligible: active },
});

class OpaqueEnvironment implements PhysicalControlEnvironmentV2 {
  actionCount = 0;
  // The three-step case needs three state-changing actions plus the required
  // second real verification observation.
  readonly actionBudget = 4;
  sequence = 1;
  F = false;
  F1 = false;
  F2 = false;
  R = false;
  readonly timeline: Role[] = [];
  readonly records: Array<{ readonly kind: string; readonly value: unknown }> = [];

  constructor(readonly variant: IsomorphismVariant) {}

  reset(): void {
    this.actionCount = 0; this.sequence += 10; this.F = false; this.F1 = false; this.F2 = false; this.R = false;
    this.timeline.length = 0; this.records.length = 0;
  }

  frame(): Observation {
    return { sequence: this.sequence, activeSeconds: this.sequence * .05,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
      objects: [{ id: 'opaque', type: 'opaque', relativePosition: [1, 0, 0],
        properties: { F: this.F, F1: this.F1, F2: this.F2, R: this.R } }],
      targetId: 'opaque', contextId: this.variant.id };
  }

  async observe(): Promise<Observation> { return this.frame(); }
  async waitForObservationAfter(afterSequence: number): Promise<Observation> {
    if (this.sequence <= afterSequence) this.sequence = afterSequence + 1;
    return this.frame();
  }
  describeActionRequirement(): { readonly satisfied: boolean; readonly missing: readonly string[];
    readonly goal: GroundedGoalV1 | null } {
    return { satisfied: true, missing: [], goal: null };
  }

  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    return this.variant.offerOrder.map(role => ({ version: 'ActionOfferV1' as const,
      offerId: sha({ role, sequence: observation.sequence, variant: this.variant.id }),
      observationSequence: observation.sequence, action: this.variant.actions[role],
      cue: cueFor(this.variant.actions[role], observation) }));
  }

  async executeOffer(offer: ActionOfferV1) {
    const role = this.variant.offerOrder.find(candidate =>
      cueIdentity(cueFor(this.variant.actions[candidate], this.frame())) === cueIdentity(offer.cue));
    assert(role, 'opaque-offer-role-not-found');
    this.actionCount++; this.sequence += role === 'observe' ? 5 : 6;
    if (role === 'alpha') { this.F = true; this.F2 = this.F1; }
    if (role === 'gamma') this.F1 = true;
    if (role === 'beta' && (this.F || this.F2)) this.R = true;
    this.timeline.push(role);
    return { executed: true, observation: this.frame(), eventId: `real:${this.actionCount}` };
  }

  async status() { return { ready: true, bufferedEvents: 128, writes: 128 }; }
  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

class OpaqueReasoning implements PhysicalReasoningPortV1 {
  readonly roleByCandidateId: ReadonlyMap<string, Exclude<Role, 'observe'>>;

  constructor(readonly environment: OpaqueEnvironment, readonly depth: Depth,
    readonly ablation: Ablation = 'none', readonly physicalLayers = { r1: true, r2: true, r2a: true },
    readonly habitProfile = false) {
    this.roleByCandidateId = new Map(Object.entries(environment.variant.candidateIds)
      .map(([role, id]) => [id, role as Exclude<Role, 'observe'>]));
  }

  async recallByEffect(): Promise<readonly EffectRecallCandidateV1[]> {
    return this.environment.variant.recallOrder.map(role => this.candidate(role,
      role === 'beta' ? TARGET_CHANGE : { ...TARGET_CHANGE, property: 'irrelevant', after: 1 }));
  }

  async compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<ConditionApplicabilityV1> {
    if (this.ablation === 'condition') return { matchedFactorIds: [], contradictedFactorIds: [],
      unknownFactorIds: [], applicability: 0, productionEligible: false };
    const role = this.role(candidate);
    const active = (factor: string): boolean => 'sequence' in state
      ? state.objects[0]!.properties[factor] === true : state.knownActiveFactorIds.includes(factor);
    const needed = role === 'beta' ? (this.depth === 2 ? 'F' : 'F2')
      : role === 'alpha' && this.depth === 3 ? 'F1' : null;
    if (!needed || active(needed)) return { matchedFactorIds: needed ? [needed] : [],
      contradictedFactorIds: [], unknownFactorIds: [],
      applicability: this.habitProfile ? .5 : .9, productionEligible: true };
    return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [needed],
      applicability: 0, productionEligible: true };
  }

  async recallFactorTransition(factorIds: readonly string[]): Promise<readonly OpaqueFactorTransitionTraceV1[]> {
    if (this.ablation === 'transition-recall') return [];
    const role: 'alpha' | 'gamma' = factorIds[0] === 'F1' ? 'gamma' : 'alpha';
    return [this.transition(role, factorIds, true)];
  }

  async predictCandidate(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<BranchPredictionV1> {
    const role = this.role(candidate);
    const activated = role === 'gamma' ? ['F1'] : role === 'alpha' ? [this.depth === 2 ? 'F' : 'F2'] : [];
    const nextState: HypotheticalPublicStateV1 = { version: 'HypotheticalPublicStateV1',
      baseObservationSequence: 'sequence' in state ? state.sequence : state.baseObservationSequence,
      knownChanges: role === 'beta' ? [TARGET_CHANGE] : [], knownActiveFactorIds: activated,
      knownInactiveFactorIds: [], unknownFactorIds: [], unobserved: 'unknown' };
    const progress = this.ablation !== 'rollout' && role === 'beta' ? (this.habitProfile ? .625 : 1) : 0;
    return { prediction: { kind: 'hypothetical-prediction', support: .9, calibratedProbability: false,
      samples: [], evidence: candidate.evidence, unknown: [], mapSha256: 'opaque-map' },
      validSampleCount: 24, progressSampleCount: progress * 24, progressFraction: progress,
      nextStates: Array.from({ length: 24 }, () => nextState), unknown: [] };
  }

  candidate(role: Exclude<Role, 'observe'>, change: PublicChange): EffectRecallCandidateV1 {
    return { candidateId: this.environment.variant.candidateIds[role], goalPredicateIds: ['R'],
      actionCue: cueFor(this.environment.variant.actions[role], this.environment.frame()),
      observedChanges: [change], observedBefore: {}, evidence: this.layeredEvidence(role), unknown: [] };
  }

  transition(role: 'alpha' | 'gamma' | 'delta', factorIds: readonly string[], active: boolean): OpaqueFactorTransitionTraceV1 {
    return { version: 'OpaqueFactorTransitionTraceV1',
      transitionId: this.environment.variant.candidateIds[role], eventId: `event:${role}`,
      actionCue: cueFor(this.environment.variant.actions[role], this.environment.frame()),
      activatedFactorIds: [...factorIds], deactivatedFactorIds: [], unchangedActiveFactorIds: [],
      evidence: active ? this.layeredEvidence(role) : evidence(`inactive:${role}`, false),
      meaning: 'observed-factor-transition' };
  }

  role(candidate: EffectRecallCandidateV1): Exclude<Role, 'observe'> {
    const role = this.roleByCandidateId.get(candidate.candidateId); assert(role, 'opaque-candidate-role-not-found');
    return role;
  }

  layeredEvidence(role: Exclude<Role, 'observe'>): PhysicalEvidenceReferenceV1 {
    const base = evidence(role);
    return { ...base,
      r1: { ...base.r1, active: this.physicalLayers.r1 },
      r2: { ...base.r2, active: this.physicalLayers.r2 },
      r2a: { ...base.r2a, productionEligible: this.physicalLayers.r2a,
        applicability: this.physicalLayers.r2a ? .9 : 0 } };
  }
}

const nonzeroOperationClasses = (environment: OpaqueEnvironment): number => Math.max(0,
  ...environment.records.filter(record => record.kind === 'joint-control-decision')
    .map(record => {
      const snapshot = record.value as { readonly field?: { readonly sites?: readonly {
        readonly operation: string; readonly effectiveDrive: number }[] } };
      return new Set((snapshot.field?.sites ?? []).filter(site => site.effectiveDrive > 0)
        .map(site => site.operation)).size;
    }));

test('32/32 two-step isomorphisms form alpha -> beta -> verification-observe without list-order help', async () => {
  const failures: unknown[] = [];
  for (const variant of variants) for (let seedIndex = 0; seedIndex < 8; seedIndex++) {
    const environment = new OpaqueEnvironment(variant);
    const manager = new PhysicalControlManagerV2(new OpaqueReasoning(environment, 2), environment,
      config(40_000 + seedIndex));
    const result = await manager.runGoal(GOAL);
    if (result.status !== 'goal-verified' || environment.timeline.join(',') !== 'alpha,beta,observe'
      || nonzeroOperationClasses(environment) < 2)
      failures.push({ variant: variant.id, seedIndex, result, timeline: environment.timeline,
        maxNonzeroOperationClasses: nonzeroOperationClasses(environment), snapshot: manager.snapshot });
    const dependencies = manager.snapshot?.workspace.dependencies ?? [];
    const beta = `experienced:${variant.candidateIds.beta}`;
    const alpha = `factor-transition:${variant.candidateIds.alpha}`;
    if (!dependencies.some(edge => edge.dependentNodeId === beta && edge.requiredNodeId === alpha))
      failures.push({ variant: variant.id, seedIndex, missingDependency: `${beta}<-${alpha}`, dependencies });
  }
  assert.deepEqual(failures, []);
});

test('64/64 three-step isomorphisms retain the complete dependency graph without parent restoration', async () => {
  const failures: unknown[] = [];
  for (const variant of variants) for (let seedIndex = 0; seedIndex < 16; seedIndex++) {
    const environment = new OpaqueEnvironment(variant);
    const manager = new PhysicalControlManagerV2(new OpaqueReasoning(environment, 3), environment,
      config(50_000 + seedIndex));
    const result = await manager.runGoal(GOAL);
    const dependencies = manager.snapshot?.workspace.dependencies ?? [];
    const beta = `experienced:${variant.candidateIds.beta}`;
    const alpha = `factor-transition:${variant.candidateIds.alpha}`;
    const gamma = `factor-transition:${variant.candidateIds.gamma}`;
    const complete = dependencies.some(edge => edge.dependentNodeId === beta && edge.requiredNodeId === alpha)
      && dependencies.some(edge => edge.dependentNodeId === alpha && edge.requiredNodeId === gamma);
    if (result.status !== 'goal-verified' || environment.timeline.join(',') !== 'gamma,alpha,beta,observe'
      || !complete || environment.records.some(record => /parent.*resum|resum.*parent/i.test(record.kind)))
      failures.push({ variant: variant.id, seedIndex, result, timeline: environment.timeline,
        dependencies, maxNonzeroOperationClasses: nonzeroOperationClasses(environment) });
  }
  assert.deepEqual(failures, []);
});

test('condition, rollout, factor-transition recall and joint-competition ablations expose their mechanism', async () => {
  const outcomes: Record<Ablation, number> = { none: 0, condition: 0, rollout: 0, 'transition-recall': 0 };
  const mediated: Record<Ablation, number> = { none: 0, condition: 0, rollout: 0, 'transition-recall': 0 };
  for (const ablation of ['none', 'condition', 'rollout', 'transition-recall'] as const) {
    for (const variant of variants) {
      const environment = new OpaqueEnvironment(variant);
      const manager = new PhysicalControlManagerV2(new OpaqueReasoning(environment, 2, ablation), environment,
        config(60_000));
      const result = await manager.runGoal(GOAL);
      const exact = result.status === 'goal-verified' && environment.timeline.join(',') === 'alpha,beta,observe';
      if (exact) outcomes[ablation]++;
      const dependencies = manager.snapshot?.workspace.dependencies ?? [];
      const beta = `experienced:${variant.candidateIds.beta}`;
      const alpha = `factor-transition:${variant.candidateIds.alpha}`;
      const executionNodeIds = environment.records.filter(record => record.kind === 'joint-control-decision')
        .map(record => (record.value as { field?: { lastDecision?: {
          operation?: string; nodeId?: string | null } } }).field?.lastDecision)
        .filter(decision => decision?.operation === 'execute' && typeof decision.nodeId === 'string')
        .map(decision => decision!.nodeId!);
      const hasPhysicalDependency = dependencies.some(edge => edge.dependentNodeId === beta
        && edge.requiredNodeId === alpha);
      if (exact && hasPhysicalDependency && executionNodeIds[0] === alpha) mediated[ablation]++;
      if (ablation === 'transition-recall' && exact) {
        assert.equal(hasPhysicalDependency, false, 'empty transition recall manufactured a dependency edge');
        assert(executionNodeIds[0]?.startsWith('exploration:'),
          `transition-recall ablation hid exploration as a physical child:${JSON.stringify(executionNodeIds)}`);
      }
    }
  }
  assert.equal(outcomes.none, 4);
  assert.equal(mediated.none, 4, `baseline did not use the physical dependency graph:${JSON.stringify(mediated)}`);
  for (const ablation of ['condition', 'rollout'] as const)
    assert(outcomes[ablation] <= 1, `${ablation} retained ${outcomes[ablation]}/4 exact solutions`);
  // Removing transition recall is not an edge-only intervention: once physical
  // goal work is exhausted, the controller must be free to discover alpha by
  // real exploration.  Such lucky outcomes are valid behaviour but must never
  // masquerade as dependency-mediated reasoning.
  assert.equal(mediated['transition-recall'], 0,
    `transition recall ablation retained a mediated solution:${JSON.stringify({ outcomes, mediated })}`);

  // A test-local list-order ablation deliberately removes the joint field. It can only
  // replay the first three offers and therefore fails under isomorphic permutations.
  const listOrderExact = variants.filter(variant => variant.offerOrder.slice(0, 3).join(',') === 'alpha,beta,observe').length;
  assert.equal(listOrderExact, 1);
});

test('nonsemantic real-outcome habits reduce settling time but cannot bypass any physical layer', () => {
  const habit = new ControlHabitWeightsV1(), integrationSteps: number[] = [];
  for (let episode = 0; episode < 16; episode++) {
    habit.beginNewControlEpisode();
    habit.recordDispatch({ operation: 'predict-branch', relationsFromRecent: [] });
    const dispatchSequence = habit.recordDispatch({ operation: 'execute', relationsFromRecent: ['same-node'] });
    const habitDrive = habit.drive({ previousOperation: 'predict-branch', nextOperation: 'execute', relation: 'same-node' });
    const field = new JointTransientControlFieldV2(config(70_000)); field.setGoal('opaque-habit');
    field.replaceSites([{ siteId: 'execute:opaque', operation: 'execute', nodeId: 'opaque', hardEligible: true,
      drives: { ...ZERO_DRIVES, goal: .3, evidence: .3, condition: .3, rollout: .3, habit: habitDrive } }]);
    const decision = field.decide(); assert.equal(decision.operation, 'execute');
    integrationSteps.push(decision.integrationSteps);
    habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence,
      residualReduction: 1, predictionViolation: null });
  }
  const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = average(integrationSteps.slice(0, 4)), last = average(integrationSteps.slice(-4));
  assert(last <= first * .9, JSON.stringify({ integrationSteps, first, last }));

  const learned = habit.drive({ previousOperation: 'predict-branch', nextOperation: 'execute', relation: 'same-node' });
  assert(learned > 0);
  for (const clearedLayer of ['r1', 'r2', 'r2a'] as const) {
    const field = new JointTransientControlFieldV2(config(71_000)); field.setGoal(`cleared-${clearedLayer}`);
    field.replaceSites([
      { siteId: 'execute:experienced', operation: 'execute', nodeId: 'experienced', hardEligible: false,
        drives: { ...ZERO_DRIVES, goal: 1, evidence: 1, condition: 1, rollout: 1, habit: learned } },
      { siteId: 'observe:root', operation: 'observe-public', nodeId: 'root', hardEligible: true,
        drives: { ...ZERO_DRIVES, goal: .5, unknown: 1, novelty: 1 } },
    ]);
    const decision = field.decide();
    assert.equal(decision.operation, 'observe-public', `${clearedLayer} clear was bypassed by habit`);
  }
});

test('controller-level trusted outcomes train only nonsemantic dispatch habits across 16 real episodes', async () => {
  const habit = new ControlHabitWeightsV1(), settling: number[] = [];
  for (let episode = 0; episode < 16; episode++) {
    const environment = new OpaqueEnvironment(variants[0]!);
    const manager = new PhysicalControlManagerV2(new OpaqueReasoning(environment, 2, 'none',
      { r1: true, r2: true, r2a: true }, true), environment,
      config(72_000), habit);
    const result = await manager.runGoal(GOAL);
    assert.equal(result.status, 'goal-verified');
    assert.deepEqual(environment.timeline, ['alpha', 'beta', 'observe']);
    const decisions = environment.records.filter(record => record.kind === 'joint-control-decision')
      .map(record => (record.value as { readonly lastDecision?: {
        readonly converged: boolean; readonly operation: string; readonly integrationSteps: number } }).lastDecision)
      .filter((decision): decision is { readonly converged: boolean; readonly operation: string;
        readonly integrationSteps: number } => decision?.converged === true && decision.operation === 'execute');
    assert.equal(decisions.length, 2);
    // The second execute is the dispatch whose trusted real result lowers the
    // root residual and therefore owns the eligibility-trace update. Measure
    // that learned transition rather than unrelated reasoning operations.
    settling.push(decisions.at(-1)!.integrationSteps);
  }
  const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = average(settling.slice(0, 4)), last = average(settling.slice(-4));
  const checkpoint = habit.exportCheckpoint();
  assert(last <= first * .9, JSON.stringify({ settling, first, last, weights: checkpoint.weights }));
  assert(checkpoint.weights.length > 0);
  for (const entry of checkpoint.weights) {
    const encoded = JSON.stringify(entry.key);
    assert(!/alpha|beta|gamma|delta|opaque|move|jump|look|interact/i.test(encoded),
      `habit key leaked task or action semantics: ${encoded}`);
  }
});
