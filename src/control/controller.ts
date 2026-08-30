import type { Observation, PublicChange, PublicValue } from '../contracts.js';
import { cueIdentity } from '../events.js';
import { assert } from '../util.js';
import type { AttentionNotice } from '../attention/monitor.js';
import type { ActionOfferV1, BranchPredictionV1, EffectRecallCandidateV1,
  GroundedGoalV1, GoalEvaluationV1, JointControlDecisionV2,
  JointControlDrivesV2, JointControlOperationV2, JointControlSiteInputV2,
  JointTransientControlFieldConfigV2, PhysicalEvidenceReferenceV1, PhysicalReasoningPortV1 } from './contracts.js';
import { JointTransientControlFieldV2 } from './field.js';
import { ControlHabitWeightsV1, type ControlHabitGraphRelationV1,
  type TrustedRealActionOutcomeV1 } from './habit.js';
import { GroundedGoalEvaluatorV1 } from './goal.js';
import { compactBranchPredictionForControlAuditV2, ControlWorkspaceV2, type ControlWorkspaceNodeSnapshotV2,
  type ControlWorkspaceSnapshotV2 } from './workspace.js';

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
  executeOffer(offer: ActionOfferV1): Promise<{ readonly executed: boolean; readonly observation: Observation;
    readonly eventId: string | null; readonly refusal?: 'action-budget-exhausted' | 'offer-stale' | 'target-unavailable' }>;
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
  if (site.operation === 'recall-effect' && site.drives.evidence > 0) return true;
  return site.drives.evidence === 1;
}

interface DispatchRecord { readonly operation: JointControlOperationV2; readonly nodeId: string }

export function dependencyEdgeSatisfiedV2(edge: ControlWorkspaceSnapshotV2['dependencies'][number],
  condition: ReturnType<ControlWorkspaceV2['currentCondition']>): boolean {
  if (!condition?.productionEligible || edge.factorIds.length === 0) return false;
  const matched = new Set(condition.matchedFactorIds);
  return edge.factorIds.every(factorId => matched.has(factorId));
}

/** Only a complete, currently active production representation can replace
 * the body's generic exploration copy of the same exact cue.  Applicability is
 * deliberately not part of this identity gate: a stable but conflicting R2A
 * relation must remain a known condition constraint, not be bypassed as blind
 * exploration. */
export function hasProductionPhysicalRepresentationV2(evidence: PhysicalEvidenceReferenceV1): boolean {
  return evidence.r1.active && evidence.r2.active && evidence.r2a.productionEligible;
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

  constructor(readonly reasoning: PhysicalReasoningPortV1, readonly environment: PhysicalControlEnvironmentV2,
    readonly config: JointTransientControlFieldConfigV2, habit = new ControlHabitWeightsV1()) {
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
      merged.set(site.siteId, { ...site, hardEligible: site.hardEligible || prior.hardEligible, drives });
    }
    return [...merged.values()];
  }

  #reasoningAndActionSites(observation: Observation, evaluation: GoalEvaluationV1,
    allowBodyOperations: boolean): JointControlSiteInputV2[] {
    this.#synchronizePublicRequirements(observation);
    const snapshot = this.workspace.snapshot(), root = snapshot.rootNodeId!;
    const rootSites: JointControlSiteInputV2[] = [];
    if (!this.workspace.hasCompleted('recall-effect', root, { currentEpoch: true }))
      rootSites.push(this.#site('recall-effect', root, true, { goal: evaluation.residual,
        unknown: snapshot.nodes.some(value => value.node.kind === 'experienced') ? .25 : 1,
        attention: this.#attentionDrive, evidence: .2 }));
    const experienced = snapshot.nodes.filter(value => value.node.kind === 'experienced'
      || value.node.kind === 'factor-transition');
    const publicRequirements = snapshot.nodes.filter(value => value.node.kind === 'public-requirement');
    // A production-qualified physical branch already represents this exact
    // cue, so a second exploration copy would bypass its condition and rollout
    // gates.  R1/R2-only or provisional R2A history is not production evidence:
    // it may guide a query, but it must not erase the body's still-legal chance
    // to explore the cue and obtain the missing real condition evidence.
    const physicallyRepresentedCues = new Set(experienced.filter(value => {
      const candidate = this.#candidate(value, snapshot);
      return hasProductionPhysicalRepresentationV2(candidate.evidence);
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
      })];
    }
    const candidate = this.#candidate(node, workspace);
    const condition = this.workspace.currentCondition(node.node.nodeId);
    const prediction = this.workspace.currentPrediction(node.node.nodeId);
    const currentEvidence = this.#currentPhysicalEvidence(candidate, prediction);
    const binding = this.#physicalBinding(currentEvidence);
    const factors = condition ? [...new Set([...condition.unknownFactorIds, ...condition.contradictedFactorIds])].sort() : [];
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
      { goal: depthGoal, evidence: binding, unknown, attention: this.#attentionDrive }));
    if (!prediction) sites.push(this.#site('predict-branch', node.node.nodeId, binding > 0,
      { goal: depthGoal, evidence: binding, condition: condition?.applicability ?? .25,
        unknown, attention: this.#attentionDrive }));
    if (condition && factors.length > 0
      && !this.workspace.hasCompleted('expand-condition', node.node.nodeId, { currentEpoch: true }))
      sites.push(this.#site('expand-condition', node.node.nodeId, binding > 0,
        { goal: depthGoal, evidence: binding, condition: condition.applicability,
          unknown: 1, attention: this.#attentionDrive }));
    const offer = this.#offerForCandidate(node, candidate, workspace, observation);
    const dependencyFulfilled = workspace.dependencies.some(edge => edge.requiredNodeId === node.node.nodeId
      && (edge.kind === 'opaque-factor'
        ? dependencyEdgeSatisfiedV2(edge, this.workspace.currentCondition(edge.dependentNodeId))
        : edge.kind === 'public-requirement-candidate'
          ? this.#publicRequirementSatisfied(edge.dependentNodeId, workspace, observation) : false));
    // Once a requirement-changing action has happened, reality must first re-test
    // the dependent branch. This is freshness of a graph edge, not a parent-stack
    // resume rule and not an action-order preference.
    const dependencyAwaitingRealityCheck = node.lastActionResult?.executed === true
      && workspace.dependencies.some(edge => edge.kind === 'opaque-factor' && edge.requiredNodeId === node.node.nodeId
        && this.workspace.currentCondition(edge.dependentNodeId) === null);
    const productionCondition = condition?.productionEligible === true && condition.applicability > 0
      && condition.unknownFactorIds.length === 0 && condition.contradictedFactorIds.length === 0;
    const progress = prediction ? this.#progressForNode(prediction, desiredFactors) : 0;
    const physicalHardGate = currentEvidence.r1.active && currentEvidence.r2.active
      && currentEvidence.r2a.productionEligible;
    if (offer && productionCondition && progress > 0 && physicalHardGate
      && requirement?.satisfied !== false && !dependencyFulfilled && !dependencyAwaitingRealityCheck)
      sites.push(this.#site('execute', node.node.nodeId, true,
        { goal: depthGoal, evidence: binding, condition: condition.applicability,
          rollout: progress, unknown: 0, attention: this.#attentionDrive }));
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
    drives: Partial<JointControlDrivesV2>): JointControlSiteInputV2 {
    const base = { ...zeroDrives(), ...drives };
    return { siteId: `${operation}:${nodeId}`, operation, nodeId, hardEligible,
      drives: { ...base, habit: this.#habitDrive(operation, nodeId) } };
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
      const offer = node.node.kind === 'exploration' ? this.#rebindOffer(node.node.offer, observation)
        : this.#offerForCandidate(node, this.#candidate(node, workspace), workspace, observation);
      if (!offer) {
        this.environment.record('control-action-reality-refusal', { nodeId, reason: 'offer-stale',
          observationSequence: observation.sequence }); return;
      }
      const request = this.workspace.beginRequest({ requestId, channel: 'body', operation, nodeId,
        baseSequence: observation.sequence });
      const beforeResidual = evaluation.residual;
      const selectedPrediction = node.node.kind === 'experienced' && node.prediction?.fresh
        ? node.prediction.value : null;
      const result = await this.environment.executeOffer(offer);
      const accepted = this.workspace.ingest({ kind: 'action-completed', requestId: request.requestId, nodeId,
        result: { executed: result.executed, observation: result.observation, result } });
      assert(accepted.accepted, `control-action-result-rejected:${accepted.reason}`);
      this.environment.record('control-action-result', { offer, result, workspace: accepted }); this.#markUsed(offer);
      if (result.executed && result.eventId) {
        const afterEvaluation = this.#goalEvaluator.evaluate(result.observation);
        const reduction = clamp01(beforeResidual - afterEvaluation.residual);
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
        const result = await this.reasoning.recallByEffect(queryGoal, queryEvaluation, observation);
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      } else if (operation === 'compare-condition') {
        const result = await this.reasoning.compareConditions(this.#candidate(node, workspace), observation);
        this.#acceptOperation({ kind: 'operation-completed', requestId, epoch: request.epoch, operation,
          nodeId, baseSequence: request.baseSequence, result });
      } else if (operation === 'predict-branch') {
        const predictionGoal = this.#objectiveGoal(node, workspace, goal);
        let result = await this.reasoning.predictCandidate(this.#candidate(node, workspace), observation, predictionGoal);
        const desired = this.#desiredFactors(nodeId, workspace);
        if (desired.length > 0) {
          const progress = result.nextStates.filter(state => desired.some(id => state.knownActiveFactorIds.includes(id))).length;
          result = { ...result, progressSampleCount: progress,
            progressFraction: result.nextStates.length ? progress / result.nextStates.length : 0 };
        }
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
      ? { ...event, result: compactBranchPredictionForControlAuditV2(event.result) }
      : event;
    this.environment.record('control-operation-result', { event: auditEvent, accepted });
    if (!accepted.accepted && !accepted.reason.startsWith('stale-operation'))
      throw new Error(`control-operation-result-rejected:${accepted.reason}`);
  }

  #candidate(node: ControlWorkspaceNodeSnapshotV2, workspace: ControlWorkspaceSnapshotV2): EffectRecallCandidateV1 {
    if (node.node.kind === 'experienced') return node.node.candidate;
    assert(node.node.kind === 'factor-transition', 'control-node-has-no-physical-candidate');
    const desired = this.#desiredFactors(node.node.nodeId, workspace);
    return { candidateId: node.node.transition.transitionId, goalPredicateIds: [], actionCue: node.node.transition.actionCue,
      observedChanges: [], observedBefore: {}, evidence: node.node.transition.evidence,
      unknown: [`opaque-factor-transition:${desired.join('+')}:observed-co-occurrence-not-causal-proof`] };
  }
  #desiredFactors(nodeId: string, workspace = this.workspace.snapshot()): readonly string[] {
    return [...new Set(workspace.dependencies.filter(edge => edge.requiredNodeId === nodeId).flatMap(edge => edge.factorIds))].sort();
  }
  #missingFactors(nodeId: string): readonly string[] {
    const condition = this.workspace.currentCondition(nodeId);
    return condition ? [...new Set([...condition.unknownFactorIds, ...condition.contradictedFactorIds])].sort() : [];
  }
  #currentPhysicalEvidence(candidate: EffectRecallCandidateV1,
    prediction: BranchPredictionV1 | null): PhysicalEvidenceReferenceV1 {
    return prediction?.currentEvidence ?? candidate.evidence;
  }
  #physicalBinding(evidence: PhysicalEvidenceReferenceV1): number {
    return Math.min(evidence.r1.active ? 1 : 0, evidence.r2.active ? 1 : 0,
      evidence.r2a.productionEligible ? 1 : .35);
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
  #progressForNode(prediction: BranchPredictionV1, desiredFactors: readonly string[]): number {
    if (desiredFactors.length === 0) return prediction.progressFraction;
    if (prediction.nextStates.length === 0) return 0;
    return prediction.nextStates.filter(state => desiredFactors.some(id => state.knownActiveFactorIds.includes(id))).length
      / prediction.nextStates.length;
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
