import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, PublicChange } from '../src/contracts.js';
import type { ActionOfferV1, BranchPredictionV1, ConditionApplicabilityV1, ContinuationPredictionV2,
  ContinuousPatternRecallV2, EffectRecallCandidateV1,
  GroundedGoalV1, HypotheticalPublicStateV1, JointTransientControlFieldConfigV2,
  OpaqueFactorTransitionTraceV1, PhysicalEvidenceReferenceV1, PhysicalReasoningPortV2,
  ProjectedParentRelationApplicabilityV1 } from '../src/control/contracts.js';
import { fairEvidenceWindowV2, fairGroundedControlWindowV2,
  hasProductionPhysicalRepresentationV2, physicalEvidenceBindingV2, PhysicalControlManagerV2,
  modulateBlindExplorationInputsV2,
  productiveGoalControlSiteV2,
  dependencyDepthV2, dependencyEdgeSatisfiedV2, explicitPredictionViolationV2,
  type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { cueFor, cueIdentity } from '../src/events.js';
import type { ControlWorkspaceSnapshotV2 } from '../src/control/workspace.js';
import { sha } from '../src/util.js';
import { distributedEvidenceFixtureV3, distributedPredictionFixtureV3 }
  from './distributed-control-fixtures.js';

const config = (seed = 20260829): JointTransientControlFieldConfigV2 => ({
  version: 'JointTransientControlFieldConfigV2', seed, branchCapacity: 8, stepSize: .02, noiseSigma: .01,
  maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
});
const physical = (id: string, applicability = .9): PhysicalEvidenceReferenceV1 =>
  distributedEvidenceFixtureV3(id, { applicability, relationIds: [`r2a:${id}`] });
const targetChange: PublicChange = { subject: 'opaque-object#0', property: 'R', before: false, after: true,
  observationIndex: 1, meaning: 'observed-co-occurrence' };
const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'neutral-R', expression: { kind: 'predicate',
  predicate: { version: 'GoalPredicateV1', id: 'R', subject: { kind: 'public-object', id: 'o', expectedType: 'opaque-object' },
    observable: 'properties.R', comparator: 'equals', target: true } } };

type SymbolicAction = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'observe';
const symbolicActions: Record<SymbolicAction, Action> = {
  alpha: { kind: 'move', parameters: { direction: 'left', ticks: 4 } },
  beta: { kind: 'interact', parameters: {}, targetId: 'o' },
  gamma: { kind: 'jump', parameters: { forward: false, ticks: 4 } },
  delta: { kind: 'move', parameters: { direction: 'right', ticks: 4 } },
  epsilon: { kind: 'select-hotbar', parameters: { slot: 1 } },
  observe: { kind: 'observe', parameters: { ticks: 5 } },
};

function symbolicActionForNode(snapshot: ControlWorkspaceSnapshotV2, nodeId: string): SymbolicAction | null {
  const observation = snapshot.observation;
  const state = snapshot.nodes.find(value => value.node.nodeId === nodeId);
  if (!observation || !state) return null;
  const cue = state.node.kind === 'experienced' ? state.node.candidate.actionCue
    : state.node.kind === 'factor-transition' ? state.node.transition.actionCue
    : state.node.kind === 'exploration' ? state.node.offer.cue
    : null;
  if (!cue) return null;
  return (Object.entries(symbolicActions).find(([, action]) =>
    cueIdentity(cueFor(action, observation)) === cueIdentity(cue))?.[0] ?? null) as SymbolicAction | null;
}

function hasSymbolicDependency(snapshot: ControlWorkspaceSnapshotV2,
  dependent: SymbolicAction, required: SymbolicAction): boolean {
  return snapshot.dependencies.some(edge =>
    symbolicActionForNode(snapshot, edge.dependentNodeId) === dependent
    && symbolicActionForNode(snapshot, edge.requiredNodeId) === required);
}

class NeutralEnvironment implements PhysicalControlEnvironmentV2 {
  actionCount = 0; readonly actionBudget = 12; sequence = 1;
  F = false; F1 = false; F2 = false; F3 = false; F4 = false; R = false;
  readonly timeline: SymbolicAction[] = []; readonly records: Array<{ kind: string; value: unknown }> = [];
  constructor(readonly order: readonly SymbolicAction[] = ['alpha', 'beta', 'gamma', 'delta', 'observe']) {}
  frame(): Observation { return { sequence: this.sequence, activeSeconds: this.sequence * .05,
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: 'o', type: 'opaque-object', relativePosition: [1, 0, 0],
      properties: { F: this.F, F1: this.F1, F2: this.F2, F3: this.F3, F4: this.F4,
        R: this.R } }], targetId: 'o', contextId: 'neutral' }; }
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
    return this.order.map(symbol => {
      const action = symbolicActions[symbol]; return { version: 'ActionOfferV1' as const,
        offerId: sha({ action, sequence: observation.sequence }), observationSequence: observation.sequence,
        action, cue: cueFor(action, observation) };
    });
  }
  async executeOffer(offer: ActionOfferV1) {
    const symbol = (Object.entries(symbolicActions).find(([, action]) => cueIdentity(cueFor(action, this.frame()))
      === cueIdentity(offer.cue))?.[0] ?? 'observe') as SymbolicAction;
    this.actionCount++; this.sequence += symbol === 'observe' ? 5 : 6;
    if (symbol === 'alpha') { this.F = true; this.F2 = this.F1; }
    if (symbol === 'gamma') this.F1 = true;
    if (symbol === 'delta' && this.F2) this.F3 = true;
    if (symbol === 'epsilon' && this.F3) this.F4 = true;
    if (symbol === 'beta' && (this.F || this.F2 || this.F4)) this.R = true;
    this.timeline.push(symbol);
    return { executed: true, observation: this.frame(), eventId: `real-${this.actionCount}` };
  }
  async status() { return { ready: true, bufferedEvents: 128, writes: 128 }; }
  record(kind: string, value: unknown): void { this.records.push({ kind, value }); }
}

class NeutralReasoning implements PhysicalReasoningPortV2 {
  constructor(readonly environment: NeutralEnvironment, readonly depth: 2 | 3 | 4 = 2) {}
  async recallByEffect(): Promise<readonly EffectRecallCandidateV1[]> {
    return [this.candidate('beta', targetChange, this.depth === 2 ? ['F']
      : this.depth === 3 ? ['F2'] : ['F4'])];
  }
  async recallAtomicEffect(): Promise<readonly EffectRecallCandidateV1[]> { return this.recallByEffect(); }
  async recallContinuousPattern(): Promise<readonly ContinuousPatternRecallV2[]> { return []; }
  async compareCurrentFactors(relationId: string, observation: Observation): Promise<ConditionApplicabilityV1> {
    const id = relationId.startsWith('r2a:') ? relationId.slice('r2a:'.length) : '';
    if (!['alpha', 'beta', 'gamma', 'delta', 'epsilon'].includes(id)) return { matchedFactorIds: [],
      contradictedFactorIds: [], unknownFactorIds: [], applicability: 0, productionEligible: false };
    return this.compareConditions(this.candidate(id as SymbolicAction, targetChange, []), observation);
  }
  async compareProjectedParentRelations(relationIds: readonly string[], _observation: Observation,
    states: readonly HypotheticalPublicStateV1[],
    source: { readonly r1Active: boolean; readonly r2Active: boolean }):
    Promise<readonly ProjectedParentRelationApplicabilityV1[]> {
    return Promise.all(states.map(async state => {
      const relationResults = await Promise.all(relationIds.map(async relationId => {
        const id = relationId.startsWith('r2a:') ? relationId.slice('r2a:'.length) : '';
        if (!['alpha', 'beta', 'gamma', 'delta', 'epsilon'].includes(id))
          return { relationId, matchedFactorIds: [], contradictedFactorIds: [],
            unknownFactorIds: [`unknown-relation:${relationId}`], applicability: 0, productionEligible: false };
        const value = await this.compareConditions(this.candidate(id as SymbolicAction, targetChange, []), state);
        return { relationId, ...value,
          productionEligible: value.productionEligible && source.r1Active && source.r2Active };
      }));
      const selected = [...relationResults].sort((left, right) => Number(right.productionEligible)
        - Number(left.productionEligible) || right.applicability - left.applicability
        || left.relationId.localeCompare(right.relationId))[0] ?? null;
      return { version: 'ProjectedParentRelationApplicabilityV1',
        selectedRelationId: selected?.relationId ?? null, relationResults,
        matchedFactorIds: selected?.matchedFactorIds ?? [],
        contradictedFactorIds: selected?.contradictedFactorIds ?? [],
        unknownFactorIds: selected?.unknownFactorIds ?? [], applicability: selected?.applicability ?? 0,
        productionEligible: selected?.productionEligible ?? false };
    }));
  }
  async predictContinuation(patternId: string): Promise<ContinuationPredictionV2> {
    return { version: 'ContinuationPredictionV2', patternId, support: 0, samples: [],
      evidenceGrade: 'single-observation', unknown: ['test-has-no-continuous-pattern'] };
  }
  async compareConditions(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<ConditionApplicabilityV1> {
    const active = (factor: string): boolean => 'sequence' in state
      ? state.objects[0]!.properties[factor] === true : state.knownActiveFactorIds.includes(factor);
    const need = candidate.candidateId === 'beta' ? (this.depth === 2 ? 'F'
      : this.depth === 3 ? 'F2' : 'F4')
      : candidate.candidateId === 'epsilon' && this.depth === 4 ? 'F3'
        : candidate.candidateId === 'delta' && this.depth === 4 ? 'F2'
          : candidate.candidateId === 'alpha' && this.depth >= 3 ? 'F1' : null;
    if (!need || active(need)) return { matchedFactorIds: need ? [need] : [], contradictedFactorIds: [],
      unknownFactorIds: [], applicability: .9, productionEligible: true };
    return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [need],
      applicability: 0, productionEligible: true };
  }
  async recallFactorTransition(factors: readonly string[]): Promise<readonly OpaqueFactorTransitionTraceV1[]> {
    const factor = factors[0]!; const symbol: SymbolicAction = factor === 'F1' ? 'gamma'
      : factor === 'F2' ? 'alpha' : factor === 'F3' ? 'delta'
        : factor === 'F4' ? 'epsilon' : 'alpha';
    return [{ version: 'OpaqueFactorTransitionTraceV1', transitionId: symbol, eventId: `event:${symbol}`,
      actionCue: cueFor(symbolicActions[symbol], this.environment.frame()), activatedFactorIds: [factor],
      deactivatedFactorIds: [], unchangedActiveFactorIds: [], evidence: physical(symbol),
      meaning: 'observed-factor-transition' }];
  }
  async predictCandidate(candidate: EffectRecallCandidateV1,
    state: Observation | HypotheticalPublicStateV1): Promise<BranchPredictionV1> {
    const activated = candidate.candidateId === 'gamma' ? ['F1'] : candidate.candidateId === 'alpha'
      ? [this.depth === 2 ? 'F' : 'F2'] : candidate.candidateId === 'delta' ? ['F3']
        : candidate.candidateId === 'epsilon' ? ['F4'] : [];
    const next: HypotheticalPublicStateV1 = { version: 'HypotheticalPublicStateV1',
      baseObservationSequence: 'sequence' in state ? state.sequence : state.baseObservationSequence,
      knownChanges: candidate.candidateId === 'beta' ? [targetChange] : [], knownActiveFactorIds: activated,
      knownInactiveFactorIds: [], unknownFactorIds: [], unobserved: 'unknown' };
    const progress = candidate.candidateId === 'beta' ? 1 : 0;
    return { prediction: distributedPredictionFixtureV3(candidate.evidence), validSampleCount: 24,
      progressSampleCount: progress ? 24 : 0, progressFraction: progress,
      nextStates: Array.from({ length: 24 }, () => next), unknown: [] };
  }
  candidate(symbol: SymbolicAction, change: PublicChange, unknown: readonly string[]): EffectRecallCandidateV1 {
    return { candidateId: symbol, goalPredicateIds: ['R'], actionCue: cueFor(symbolicActions[symbol], this.environment.frame()),
      observedChanges: [change], observedBefore: {}, evidence: physical(symbol), unknown };
  }
}

test('joint dependency graph solves the neutral two-step task without a parent stack', async () => {
  const environment = new NeutralEnvironment(), manager = new PhysicalControlManagerV2(
    new NeutralReasoning(environment, 2), environment, config());
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, timeline: environment.timeline,
    snapshot: manager.snapshot }));
  assert.deepEqual(environment.timeline, ['alpha', 'beta', 'observe']);
  const snapshot = manager.snapshot!;
  assert(hasSymbolicDependency(snapshot.workspace, 'beta', 'alpha'));
  assert.equal(environment.records.some(value => value.kind.includes('parent') && value.kind.includes('resum')), false);
  assert.equal(snapshot.field.lastGoalEvaluation?.status, 'satisfied');
  assert(environment.records.some(record => {
    if (record.kind !== 'joint-control-decision') return false;
    const sites = (record.value as { field?: { sites?: readonly { operation: string }[] } }).field?.sites ?? [];
    return sites.some(site => site.operation === 'finish-verified')
      && sites.some(site => site.operation === 'compare-condition' || site.operation === 'predict-branch');
  }), 'finish verification bypassed the ordinary joint competition');
});

test('three physical condition links remain simultaneously represented while actions unfold', async () => {
  const environment = new NeutralEnvironment(['delta', 'beta', 'observe', 'alpha', 'gamma']);
  const manager = new PhysicalControlManagerV2(new NeutralReasoning(environment, 3), environment, config(11));
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, timeline: environment.timeline,
    snapshot: manager.snapshot }));
  assert.deepEqual(environment.timeline, ['gamma', 'alpha', 'beta', 'observe']);
  const workspace = manager.snapshot!.workspace;
  const dependencies = workspace.dependencies;
  assert.equal(dependencies.length >= 2, true);
  assert(hasSymbolicDependency(workspace, 'beta', 'alpha'));
  assert(hasSymbolicDependency(workspace, 'alpha', 'gamma'));
});

test('four opaque dependencies are expanded and resolved without semantic node ordering', async () => {
  const environment = new NeutralEnvironment(['observe', 'epsilon', 'beta', 'delta', 'alpha', 'gamma']);
  const manager = new PhysicalControlManagerV2(new NeutralReasoning(environment, 4), environment, config(29));
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified', JSON.stringify({ result, timeline: environment.timeline,
    snapshot: manager.snapshot }));
  assert.deepEqual(environment.timeline, ['gamma', 'alpha', 'delta', 'epsilon', 'beta', 'observe']);
  const workspace = manager.snapshot!.workspace;
  assert.equal(workspace.dependencies.length >= 4, true);
  assert(hasSymbolicDependency(workspace, 'beta', 'epsilon'));
  assert(hasSymbolicDependency(workspace, 'epsilon', 'delta'));
  assert(hasSymbolicDependency(workspace, 'delta', 'alpha'));
  assert(hasSymbolicDependency(workspace, 'alpha', 'gamma'));
  assert.equal(Math.max(...workspace.nodes.map(node => node.node.nodeId === workspace.rootNodeId ? 0
    : dependencyDepthV2(node.node.nodeId, workspace.dependencies))), 4);
});

test('finite admission gives distinct cues room and rotates without choosing a winner', () => {
  const repeated = [
    ...Array.from({ length: 16 }, (_, index) => ({ id: `plus-${index}`,
      cue: { kind: 'look' as const, parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null } })),
    ...Array.from({ length: 16 }, (_, index) => ({ id: `minus-${index}`,
      cue: { kind: 'look' as const, parameters: { yawDegrees: -15, pitchDegrees: 0 }, targetRole: null } })),
  ];
  const first = fairEvidenceWindowV2(repeated, 8, 0, value => cueIdentity(value.cue));
  assert.equal(first.selected.filter(value => value.id.startsWith('plus')).length, 4);
  assert.equal(first.selected.filter(value => value.id.startsWith('minus')).length, 4);
  const second = fairEvidenceWindowV2(repeated, 8, first.nextRotation, value => cueIdentity(value.cue));
  assert.notDeepEqual(second.selected.map(value => value.id), first.selected.map(value => value.id));
});

test('finite goal admission never leaves all grounded physical work outside the joint field', () => {
  const values = [
    ...Array.from({ length: 16 }, (_, index) => ({ id: `grounded-${index}`, exploration: false,
      cue: { kind: 'look' as const, parameters: { yawDegrees: index % 2 ? 15 : -15, pitchDegrees: 0 },
        targetRole: null } })),
    ...Array.from({ length: 16 }, (_, index) => ({ id: `exploration-${index}`, exploration: true,
      cue: { kind: 'select-hotbar' as const, parameters: { slot: index % 9 }, targetRole: null } })),
  ];
  for (let rotation = 0; rotation < 64; rotation++) {
    const window = fairGroundedControlWindowV2(values, 8, rotation,
      value => cueIdentity(value.cue), value => !value.exploration);
    assert.equal(window.selected.length, 8);
    assert(window.selected.some(value => !value.exploration),
      `rotation ${rotation} admitted only blind exploration`);
  }
  const oneGrounded = fairGroundedControlWindowV2([
    values[0]!, ...values.filter(value => value.exploration),
  ], 8, 0, value => cueIdentity(value.cue), value => !value.exploration);
  assert(oneGrounded.selected.some(value => !value.exploration));
  assert(oneGrounded.selected.some(value => value.exploration),
    'reserving grounded evidence must not itself choose the operation winner or erase exploration');
});

test('blind exploration keeps its field sites but loses only unknown and novelty pressure while grounded work remains', () => {
  const exploration = [{ siteId: 'execute:explore', operation: 'execute' as const,
    nodeId: 'explore', hardEligible: true, drives: {
      goal: 0, evidence: 0, condition: 0, rollout: 0,
      unknown: 1, attention: .4, novelty: .8, habit: 0,
    } }];
  const inhibited = modulateBlindExplorationInputsV2(exploration, true);
  assert.equal(inhibited.length, 1);
  assert.equal(inhibited[0]!.hardEligible, true);
  assert.equal(inhibited[0]!.operation, 'execute');
  assert.equal(inhibited[0]!.drives.unknown, 0);
  assert.equal(inhibited[0]!.drives.novelty, 0);
  assert.equal(inhibited[0]!.drives.attention, .4);
  assert.deepEqual(exploration[0]!.drives, {
    goal: 0, evidence: 0, condition: 0, rollout: 0,
    unknown: 1, attention: .4, novelty: .8, habit: 0,
  }, 'modulation mutated the caller input');
  assert.strictEqual(modulateBlindExplorationInputsV2(exploration, false), exploration,
    'blind exploration must recover unchanged when grounded work is exhausted');

  const verification = [{ ...exploration[0]!, operation: 'observe-public' as const,
    drives: { ...exploration[0]!.drives, goal: 1 } }];
  assert.strictEqual(modulateBlindExplorationInputsV2(verification, true)[0], verification[0],
    'goal-linked verification observation is not blind exploration');
});

test('only a real query or production-bound goal site suppresses blind exploration', () => {
  const drives = { goal: 1, evidence: 1, condition: 0, rollout: 0,
    unknown: 1, attention: 0, novelty: 0, habit: 0 };
  const productionEvidence = physical('production');
  assert.equal(productiveGoalControlSiteV2({ siteId: 'predict:p', operation: 'predict-branch', nodeId: 'p',
    hardEligible: true, productiveGrounding: { kind: 'physical-branch', evidence: [productionEvidence] },
    drives }), true);
  assert.equal(productiveGoalControlSiteV2({ siteId: 'recall:r', operation: 'recall-effect', nodeId: 'r',
    hardEligible: true, productiveGrounding: { kind: 'outstanding-effect-query', goalNodeId: 'r' },
    drives: { ...drives, evidence: .2 } }), true);
  const provisionalEvidence: PhysicalEvidenceReferenceV1 = { ...productionEvidence,
    r2a: { ...productionEvidence.r2a, productionEligible: false } };
  assert.equal(productiveGoalControlSiteV2({ siteId: 'predict:provisional', operation: 'predict-branch',
    nodeId: 'provisional', hardEligible: true,
    productiveGrounding: { kind: 'physical-branch', evidence: [provisionalEvidence] },
    drives: { ...drives, evidence: .35, habit: 1 } }), false);
  assert.equal(productiveGoalControlSiteV2({ siteId: 'execute:no-goal', operation: 'execute',
    nodeId: 'no-goal', hardEligible: true,
    productiveGrounding: { kind: 'physical-branch', evidence: [productionEvidence] },
    drives: { ...drives, goal: 0 } }), false);
  assert.equal(productiveGoalControlSiteV2({ siteId: 'predict:inactive', operation: 'predict-branch',
    nodeId: 'inactive', hardEligible: false,
    productiveGrounding: { kind: 'physical-branch', evidence: [productionEvidence] }, drives }), false);

  const nativeEvidence = (cleared: 'r1' | 'r2' | 'r2a'): PhysicalEvidenceReferenceV1 => ({
    ...productionEvidence,
    r1: { ...productionEvidence.r1, active: cleared !== 'r1',
      supportStrength: cleared === 'r1' ? 0 : productionEvidence.r1.supportStrength },
    r2: { ...productionEvidence.r2, active: cleared !== 'r2',
      supportStrength: cleared === 'r2' ? 0 : productionEvidence.r2.supportStrength },
    r2a: { ...productionEvidence.r2a, active: cleared !== 'r2a',
      supportStrength: cleared === 'r2a' ? 0 : productionEvidence.r2a.supportStrength },
  });
  for (const layer of ['r1', 'r2', 'r2a'] as const) assert.equal(productiveGoalControlSiteV2({
    siteId: `predict:cleared-${layer}`, operation: 'predict-branch', nodeId: `cleared-${layer}`,
    hardEligible: true, productiveGrounding: { kind: 'physical-branch', evidence: [nativeEvidence(layer)] },
    drives: { ...drives, evidence: .9, habit: 1 },
  }), false, `${layer} clear was bypassed by residual strength or habit`);
});

test('an unconverged field cycle waits for another control event instead of ending the goal', async () => {
  class AdvancingEnvironment extends NeutralEnvironment {
    reads = 0;
    override async observe(): Promise<Observation> {
      this.reads++;
      if (this.reads === 3) this.sequence++;
      return super.observe();
    }
  }
  const environment = new AdvancingEnvironment(), manager = new PhysicalControlManagerV2(
    new NeutralReasoning(environment, 2), environment, config(17));
  const decide = manager.field.decide.bind(manager.field); let injected = false;
  manager.field.decide = () => {
    if (injected) return decide();
    injected = true;
    return { operation: 'unknown', nodeId: null, siteId: null, converged: false,
      integrationSteps: 500, reason: 'test-nonconvergence' };
  };
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified');
  assert(environment.records.some(record => record.kind === 'joint-control-awaiting-new-event'));
});

test('one reasoning chain keeps a sealed public frame until a body or attention boundary', async () => {
  class TickingObserveEnvironment extends NeutralEnvironment {
    reads = 0;
    override async observe(): Promise<Observation> {
      this.reads++;
      assert(this.reads <= 50, 'reasoning-refreshed-the-raw-physics-frame');
      this.sequence++;
      return super.observe();
    }
  }
  const environment = new TickingObserveEnvironment(), manager = new PhysicalControlManagerV2(
    new NeutralReasoning(environment, 2), environment, config(23));
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified');
  assert.deepEqual(environment.timeline, ['alpha', 'beta', 'observe']);
  assert.equal(environment.reads, 4,
    `the controller refreshed outside a real body boundary:${JSON.stringify(environment.timeline)}`);
});

test('provisional R2A history cannot erase the same exact legal exploration cue', async () => {
  class ProvisionalHistoryEnvironment extends NeutralEnvironment {
    waits = 0;
    override listActionOffers(observation: Observation): readonly ActionOfferV1[] {
      const symbol: SymbolicAction = this.R ? 'observe' : 'beta';
      const action = symbolicActions[symbol];
      return [{ version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
        observationSequence: observation.sequence, action, cue: cueFor(action, observation) }];
    }
    override async waitForObservationAfter(afterSequence: number): Promise<Observation> {
      assert(++this.waits <= 2, 'provisional-physical-history-erased-legal-exploration');
      return super.waitForObservationAfter(afterSequence);
    }
  }
  class ProvisionalHistoryReasoning extends NeutralReasoning {
    override candidate(symbol: SymbolicAction, change: PublicChange,
      unknown: readonly string[]): EffectRecallCandidateV1 {
      const candidate = super.candidate(symbol, change, unknown);
      return { ...candidate, evidence: { ...candidate.evidence,
        r2a: { ...candidate.evidence.r2a, relationIds: ['provisional-r2a'], applicability: 0,
          productionEligible: false, predictionEligible: false, evidenceGrade: 'single-observation' } } };
    }
    override async compareConditions(): Promise<ConditionApplicabilityV1> {
      return { matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: [],
        applicability: 0, productionEligible: false };
    }
  }
  const environment = new ProvisionalHistoryEnvironment();
  environment.F = true;
  const manager = new PhysicalControlManagerV2(new ProvisionalHistoryReasoning(environment, 2),
    environment, config(29));
  const result = await manager.runGoal(goal);
  assert.equal(result.status, 'goal-verified');
  assert.deepEqual(environment.timeline, ['beta', 'observe']);
  const betaResult = environment.records.find(record => record.kind === 'control-action-result'
    && (record.value as { offer?: ActionOfferV1 }).offer?.action.kind === 'interact');
  assert(betaResult, 'the legal interact cue was not explored after provisional R2A history');
});

test('the controller has no wall-clock or cycle-count fallback outside the joint field', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('src/control/controller.ts', 'utf8'));
  assert.doesNotMatch(source, /cycles\s*<\s*4096|joint-control-event-wait-expired|setTimeout\s*\(/);
  assert.match(source, /waitForObservationAfter\(observation\.sequence\)/);
});

test('a manager rejects concurrent run entry before either run can reset shared field state', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  class BlockingEnvironment extends NeutralEnvironment {
    first = true;
    override async observe(): Promise<Observation> {
      if (this.first) { this.first = false; await gate; }
      return super.observe();
    }
  }
  const environment = new BlockingEnvironment(), manager = new PhysicalControlManagerV2(
    new NeutralReasoning(environment, 2), environment, config(19));
  const running = manager.runGoal(goal);
  await assert.rejects(manager.runGoal(goal), /physical-control-run-already-in-progress/);
  release();
  assert.equal((await running).status, 'goal-verified');
});

test('dependency satisfaction requires every factor on that exact edge and production evidence', () => {
  const edge = { edgeId: 'e', dependentNodeId: 'parent', requiredNodeId: 'child', factorIds: ['F1', 'F2'],
    kind: 'opaque-factor' as const, createdEpoch: 1, createdObservationSequence: 1 };
  assert.equal(dependencyEdgeSatisfiedV2(edge, { matchedFactorIds: ['F1'], contradictedFactorIds: [],
    unknownFactorIds: ['F2'], applicability: .9, productionEligible: true }), false);
  assert.equal(dependencyEdgeSatisfiedV2(edge, { matchedFactorIds: ['F2', 'F1'], contradictedFactorIds: [],
    unknownFactorIds: [], applicability: .9, productionEligible: true }), true);
  assert.equal(dependencyEdgeSatisfiedV2(edge, { matchedFactorIds: ['F1', 'F2'], contradictedFactorIds: [],
    unknownFactorIds: [], applicability: .9, productionEligible: false }), false);
});

test('only an active R1/R2 branch with production R2A suppresses its exploration copy', () => {
  const base = physical('representation-gate');
  assert.equal(hasProductionPhysicalRepresentationV2(base), true);
  assert.equal(hasProductionPhysicalRepresentationV2({ ...base,
    r2a: { ...base.r2a, applicability: 0 } }), true,
  'a stable but currently conflicting condition must not be bypassed as blind exploration');
  assert.equal(hasProductionPhysicalRepresentationV2({ ...base,
    r2a: { ...base.r2a, productionEligible: false } }), false);
  assert.equal(hasProductionPhysicalRepresentationV2({ ...base,
    r1: { ...base.r1, active: false } }), false);
  assert.equal(hasProductionPhysicalRepresentationV2({ ...base,
    r2: { ...base.r2, active: false } }), false);
});

test('a live R2A footprint with zero current applicability still admits condition comparison', () => {
  const historical = physical('missing-condition', 0);
  const currentMismatch: PhysicalEvidenceReferenceV1 = { ...historical,
    r2a: { ...historical.r2a, active: false, supportStrength: 0, applicability: 0,
      branchSelectionStrength: 0, productionEligible: false, predictionEligible: false,
      evidenceGrade: 'predictive-stable' } };
  // `active` and `supportStrength` on R2A are current-condition readouts.  The
  // retained footprint and relation are the physical substrate that makes a
  // compare/expand query meaningful; they are not an execution qualification.
  assert.equal(physicalEvidenceBindingV2(currentMismatch), .85);
});

test('multi-parent dependency depth is insertion-order independent', () => {
  const edges = [
    { edgeId: 'z', dependentNodeId: 'top-b', requiredNodeId: 'leaf', factorIds: ['B'],
      kind: 'opaque-factor' as const, createdEpoch: 1, createdObservationSequence: 1 },
    { edgeId: 'a', dependentNodeId: 'middle', requiredNodeId: 'leaf', factorIds: ['A'],
      kind: 'opaque-factor' as const, createdEpoch: 1, createdObservationSequence: 1 },
    { edgeId: 'm', dependentNodeId: 'top-a', requiredNodeId: 'middle', factorIds: ['M'],
      kind: 'opaque-factor' as const, createdEpoch: 1, createdObservationSequence: 1 },
  ];
  assert.equal(dependencyDepthV2('leaf', edges), 1);
  assert.equal(dependencyDepthV2('leaf', [...edges].reverse()), 1);
});

test('habit violation requires an explicitly comparable opposite readout', () => {
  const environment = new NeutralEnvironment(), reasoning = new NeutralReasoning(environment, 2);
  const candidate = reasoning.candidate('beta', targetChange, []);
  const prediction: BranchPredictionV1 = { prediction: distributedPredictionFixtureV3(candidate.evidence),
    validSampleCount: 24, progressSampleCount: 24, progressFraction: 1,
    nextStates: [{ version: 'HypotheticalPublicStateV1', baseObservationSequence: 1,
      knownChanges: [targetChange], knownActiveFactorIds: [], knownInactiveFactorIds: [],
      unknownFactorIds: [], unobserved: 'unknown' }], unknown: [] };
  const unchanged = environment.frame();
  assert.equal(explicitPredictionViolationV2(prediction, unchanged, unchanged), null);
  const before: Observation = { ...unchanged, objects: [{ ...unchanged.objects[0]!, properties: { R: true } }] };
  const after: Observation = { ...before, sequence: 2,
    objects: [{ ...before.objects[0]!, properties: { R: false } }] };
  assert.deepEqual(explicitPredictionViolationV2(prediction, before, after),
    { matched: true, highSupport: true, deviation: 1 });
});
