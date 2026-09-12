import type { Observation, RealEvent, XYZ } from './contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from './control/contracts.js';
import { GroundedGoalEvaluatorV1 } from './control/goal.js';
import { ExperienceAgent, compareExperiencePrediction, type ExperienceEnvironment, type ExperiencePlanStep } from './experience-agent.js';
import { ExperienceMedium, experienceInputs, motorIdentity, type ExperienceMediumSnapshot } from './experience-medium.js';
import { LearnedAffordances, type LearnedAffordancesSnapshot } from './learned-affordances.js';
import { ExperienceWorld, type ExperienceWorldSnapshot } from './experience-world.js';
import { cueIdentity, validateEvent } from './events.js';
import { sha } from './util.js';

export interface ContinuingTask { goal: GroundedGoalV1; baseline: Observation | null; status: 'pending' | 'verified';
  actions: number; firstSatisfied: number | null; confirmations?: number; lastConfirmedSequence?: number;
  bestResidual: number; lastProgress: number; unsuccessfulProbes?: number; probeAfter?: number;
  progressMetric?: 'GroundedResidual2' | 'GroundedResidual3' }
interface Investigation extends ContinuingTask { destination: XYZ }
export interface SessionDecision {
  index: number; status: 'executed' | 'refused' | 'observing' | 'goal-verified' | 'no-offers' | 'observation-stalled';
  source: 'task' | 'investigation' | 'curiosity' | 'maintenance'; goalId: string | null; observationSequence: number;
  /** Audit metadata only. An autonomous goal may leave live state on completion. */
  goal?: GroundedGoalV1; goalBaselineSequence?: number;
  offer?: ActionOfferV1; planLength?: number; planReason?: string; learned?: boolean;
  exploration?: { source: 'hypothesis' | 'curiosity'; planLength: number };
  prediction?: ReturnType<typeof compareExperiencePrediction>;
  stateKey?: string; refuted?: boolean; withdrawnPlanningOffers?: number;
  hypothesisDeferred?: boolean; measuredProgress?: boolean;
  actionStartLatencyFrames?: number;
  forecastAdvanced?: boolean;
  predictedSteps?: readonly ExperiencePlanStep[];
}
export interface ExperienceSessionSnapshot { version: 'ExperienceSession1'; medium: ExperienceMediumSnapshot;
  affordances: LearnedAffordancesSnapshot; world: ExperienceWorldSnapshot; choices: number;
  steps: number; executed: number; tasks: ContinuingTask[]; investigation: Investigation | null;
  passiveWindows?: number; passiveWrites?: number;
  maintenance?: ContinuingTask | null;
  arbitration?: { nextService: 'maintenance' | 'task' };
  deferred: { destination: XYZ; until: number }[]; recent: SessionDecision[] }
const light = (observation: Observation): Observation => {
  const { sensation: _sensation, perception: _perception, ...rest } = observation; return structuredClone(rest);
};
const distance = (a: XYZ, b: XYZ) => Math.hypot(...a.map((v, i) => v - b[i]!));
// Current execution context, never a learned circuit input. Exclude tracking
// labels and confidence so a renamed percept cannot erase physical feedback.
const stateKey = (observation: Observation): string => {
  const quantize = (value: unknown): unknown => typeof value === 'number' ? Math.round(value / .025) : value;
  const entries = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values)
    .filter(([key]) => !['confidence', 'ambiguity'].includes(key)).map(([key, value]) => [key, quantize(value)]));
  return sha({ inputs: entries(experienceInputs(observation)), position: observation.self.position.map(quantize),
    yaw: quantize(observation.self.yaw), objects: observation.objects.map(object => sha({
      relative: object.relativePosition.map(quantize), properties: entries(object.properties) })).sort() });
};

/** A continuing sensor/action loop. Budgets pause execution and leave pending
 * tasks intact. Investigations store a desired measurement, never a solution
 * sequence. Every action is selected again using fresh physical feedback. */
export class ExperienceSession {
  readonly agent: ExperienceAgent;
  world = new ExperienceWorld();
  #tasks: ContinuingTask[] = []; #investigation: Investigation | null = null;
  #maintenance: ContinuingTask | null = null;
  #nextService: 'maintenance' | 'task' = 'maintenance';
  #deferred: { destination: XYZ; until: number }[] = [];
  #recent: SessionDecision[] = []; #steps = 0; #executed = 0;
  #passiveWindows = 0; #passiveWrites = 0;
  constructor(medium = new ExperienceMedium(), affordances = new LearnedAffordances()) {
    this.agent = new ExperienceAgent(medium, affordances);
  }
  submit(goal: GroundedGoalV1): void {
    if (this.#tasks.some(task => task.goal.id === goal.id)) throw new Error('duplicate-session-goal');
    if (this.#tasks.filter(task => task.status === 'pending').length >= 32) throw new Error('pending-goal-capacity-exceeded');
    this.#tasks = this.#tasks.filter((task, i, all) => task.status === 'pending' || i >= all.length - 31);
    this.#tasks.push({ goal: structuredClone(goal), baseline: null, status: 'pending', actions: 0,
      firstSatisfied: null, bestResidual: 1, lastProgress: this.#steps });
  }
  get stats() { return { decisions: this.#steps, executed: this.#executed, writes: this.agent.medium.writes,
    passiveWindows: this.#passiveWindows, passiveWrites: this.#passiveWrites,
    pendingGoals: this.#tasks.filter(t => t.status === 'pending').length,
    verifiedGoals: this.#tasks.filter(t => t.status === 'verified').map(t => t.goal.id),
    investigating: this.#investigation?.goal.id ?? null, ...this.world.stats }; }
  get tasks(): readonly ContinuingTask[] { return structuredClone(this.#tasks); }
  #record(decision: Omit<SessionDecision, 'index'>): SessionDecision {
    // Charge a completed service opportunity, including a refused action or
    // unavailable offer. An unresolvable need cannot own every later turn.
    this.#nextService = decision.source === 'maintenance' ? 'task' : 'maintenance';
    const result = { ...decision, index: ++this.#steps }; this.#recent.push(result);
    if (this.#recent.length > 256) this.#recent.shift(); return result;
  }
  #proposal(observation: Observation, offers: readonly ActionOfferV1[]): Investigation | null {
    const deadline = performance.now() + 50;
    this.#deferred = this.#deferred.filter(value => value.until > this.#steps);
    let frontier = [{ observation, steps: 0 }], best: { observation: Observation; score: number } | null = null;
    const visited = new Set<string>();
    search: for (let depth = 0; depth < 6 && frontier.length; depth++) {
      const next: { observation: Observation; steps: number; score: number }[] = [];
      for (const node of frontier) {
        const candidates = node.steps === 0 || !this.agent.affordances.size ? offers
          : this.agent.affordances.imagined(node.observation);
        for (const offer of candidates) {
          if (performance.now() >= deadline) break search;
          const prediction = this.agent.medium.predict(offer.cue, node.observation), future = prediction.observation;
          if (!future || !prediction.accepted || !['self/position.0', 'self/position.1', 'self/position.2', 'self/yaw']
            .every(field => prediction.supportedFields.includes(field))) continue;
          const key = [...future.self.position.map(v => Math.round(v / .25)), Math.round(future.self.yaw / .25)].join(',');
          if (visited.has(key)) continue; visited.add(key);
          const separation = distance(observation.self.position, future.self.position);
          const score = this.world.novelty(future) + .02 * Math.min(4, separation) - .008 * (node.steps + 1);
          next.push({ observation: future, steps: node.steps + 1, score });
          if (separation >= .75 && !this.#deferred.some(value => distance(value.destination, future.self.position) < .8)
            && score > (best?.score ?? this.world.novelty(observation) + .02)) best = { observation: future, score };
        }
      }
      frontier = next.sort((a, b) => b.score - a.score).slice(0, 8);
    }
    if (!best) return null;
    const destination = best.observation.self.position;
    const goal: GroundedGoalV1 = { version: 'GroundedGoalV1', id: 'investigation-' + this.#steps,
      expression: { kind: 'all', children: destination.map((value, axis) => ({ kind: 'predicate' as const,
        predicate: { version: 'GoalPredicateV1' as const, id: 'axis-' + axis, subject: { kind: 'self' as const },
          observable: `position.${axis}` as 'position.0' | 'position.1' | 'position.2',
          comparator: 'within' as const, lower: value - .3, upper: value + .3 } })) } };
    return { goal, destination, baseline: light(observation), status: 'pending', actions: 0, firstSatisfied: null,
      bestResidual: 1, lastProgress: this.#steps };
  }
  #consumePassive(events: readonly RealEvent[], learn: boolean): void {
    for (const event of events) {
      validateEvent(event);
      if (event.provenance !== 'observed-passive' || event.bodyResult !== null || event.cue.kind !== 'passive')
        throw new Error('motor-window-supplied-as-passive-experience');
      if (learn && this.agent.medium.observe(event).learned) this.#passiveWrites++;
      this.#passiveWindows++;
    }
  }
  async step(environment: ExperienceEnvironment, options: { learn?: boolean; exploration?: boolean;
    depth?: number; expansions?: number; verificationTicks?: number; milliseconds?: number } = {}): Promise<SessionDecision> {
    this.#consumePassive(await environment.drainPassiveEvents?.() ?? [], options.learn !== false);
    const observation = await environment.observe();
    if (observation.predictionSupport !== undefined || observation.predictionBounds !== undefined) throw new Error('session-received-imagined-frame');
    this.world.observe(observation);
    const offers = environment.listActionOffers(observation);
    if (options.learn !== false) this.agent.affordances.observe(observation, offers);
    const pending = this.#tasks.find(t => t.status === 'pending');
    const needs = (environment.maintenanceGoals ?? []).map(goal => {
      const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation);
      return { goal, measured: evaluator.evaluate(observation) };
    }).filter(value => value.measured.status === 'mismatch').sort((a, b) => b.measured.residual - a.measured.residual);
    const need = needs[0];
    if (!need) this.#maintenance = null;
    else if (!this.#maintenance || sha(this.#maintenance.goal) !== sha(need.goal))
      this.#maintenance = { goal: structuredClone(need.goal), baseline: light(observation), status: 'pending', actions: 0,
        firstSatisfied: null, bestResidual: need.measured.residual, lastProgress: this.#steps };
    // Alternate service categories while both are present. The initial turn
    // addresses the body; within each category the existing ordering stays
    // intact. This is local scheduling state, never a learned action effect.
    const maintenance = this.#maintenance && (!pending || this.#nextService === 'maintenance') ? this.#maintenance : null;
    const task = maintenance ? undefined : pending;
    if (!task && !this.#maintenance && !this.#investigation && options.exploration !== false)
      this.#investigation = this.#proposal(observation, offers);
    const source: SessionDecision['source'] = maintenance ? 'maintenance' : task ? 'task' : this.#investigation ? 'investigation' : 'curiosity';
    let intention: ContinuingTask | null = maintenance ?? task ?? this.#investigation;
    const common = { source, goalId: intention?.goal.id ?? null, observationSequence: observation.sequence,
      goal: intention ? structuredClone(intention.goal) : undefined,
      goalBaselineSequence: intention ? (intention.baseline?.sequence ?? observation.sequence) : undefined };
    if (intention) {
      intention.baseline ??= light(observation);
      const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(intention.goal, intention.baseline);
      const measured = evaluator.evaluate(observation);
      if (intention.progressMetric !== 'GroundedResidual3') {
        // Rebase an older metric on an actual current frame. A software
        // normalization change is not physical goal progress.
        intention.bestResidual = measured.residual; intention.lastProgress = this.#steps;
        intention.progressMetric = 'GroundedResidual3';
      }
      if (measured.status === 'satisfied') {
        if (intention.firstSatisfied === null || observation.sequence < intention.firstSatisfied)
          { intention.firstSatisfied = observation.sequence; intention.confirmations = 0; intention.lastConfirmedSequence = undefined; }
        if (intention.lastConfirmedSequence !== observation.sequence) {
          intention.confirmations = (intention.confirmations ?? 0) + 1;
          intention.lastConfirmedSequence = observation.sequence;
        }
        if (intention.confirmations! >= (options.verificationTicks ?? 5) + 1) {
          intention.status = 'verified';
          if (!task) this.#investigation = null;
          return this.#record({ ...common, status: 'goal-verified' });
        }
        const next = await environment.waitForObservationAfter(observation.sequence);
        return this.#record({ ...common, observationSequence: next.sequence,
          status: next.sequence > observation.sequence ? 'observing' : 'observation-stalled' });
      }
      intention.firstSatisfied = null;
      intention.confirmations = 0; intention.lastConfirmedSequence = undefined;
      if (measured.residual < intention.bestResidual - .01) {
        intention.bestResidual = measured.residual; intention.lastProgress = this.#steps;
        intention.unsuccessfulProbes = 0; intention.probeAfter = 0;
      }
      if (source === 'investigation' && this.#steps - intention.lastProgress >= 24) {
        this.#deferred.push({ destination: this.#investigation!.destination, until: this.#steps + 128 });
        this.#deferred = this.#deferred.slice(-32); this.#investigation = null;
        intention = null;
        common.source = 'curiosity'; common.goalId = null;
        common.goal = undefined; common.goalBaselineSequence = undefined;
      }
    }
    if (!offers.length) return this.#record({ ...common, status: 'no-offers' });
    const key = stateKey(observation);
    // A failed prediction with no measured state change cannot justify the
    // same branch again. Keep only recent local counterexamples; curiosity
    // may still retry any physical motor, and changed contexts are separate.
    const refuted = new Set(this.#recent.slice(-32).filter(decision => decision.refuted && decision.stateKey === key)
      .map(decision => motorIdentity(decision.offer!.cue)));
    const planningOffers = offers.filter(offer => !refuted.has(motorIdentity(offer.cue)));
    const hypothesisDeferred = !!intention && (intention.probeAfter ?? 0) > this.#steps;
    const plan = intention && !hypothesisDeferred ? this.agent.plan(intention.goal, observation, planningOffers, {
      baseline: intention.baseline!, depth: options.depth ?? 32, expansions: options.expansions ?? 128,
      milliseconds: options.milliseconds ?? 100 }) : null;
    const selected = plan?.steps[0];
    let offer = selected?.offer ?? null;
    const localVisits = new Map<string, number>();
    // Short-term motor habituation survives changed camera samples. Exact
    // scene identity is still required for local predictive refutation above.
    for (const decision of this.#recent.slice(-32)) if (decision.status === 'executed' && decision.offer) {
      const motor = motorIdentity(decision.offer.cue); localVisits.set(motor, (localVisits.get(motor) ?? 0) + 1);
    }
    if (!offer && options.exploration !== false) {
      offer = this.agent.explore(observation, offers, intention && !hypothesisDeferred ? {
        goal: intention.goal, baseline: intention.baseline!, planningOffers,
        milliseconds: options.milliseconds ?? 50 } : undefined, localVisits);
    }
    if (!offer) return this.#record({ ...common, status: 'no-offers' });
    const prediction = selected?.prediction ?? this.agent.explorationPrediction ?? this.agent.medium.predict(offer.cue, observation);
    const result = await environment.executeOffer(offer);
    // The world also advanced during selection. Consume those earlier real
    // intervals before learning the action, in physical time order.
    this.#consumePassive(result.precedingPassiveEvents ?? [], options.learn !== false);
    if (result.observation.sequence < observation.sequence) throw new Error('body-feedback-went-backward');
    if (!result.executed) return this.#record({ ...common, observationSequence: result.observation.sequence,
      status: 'refused', offer, planLength: plan?.steps.length ?? 0, planReason: plan?.reason,
      ...(!selected && this.agent.lastExploration ? { exploration: this.agent.lastExploration } : {}) });
    if (result.observation.sequence <= observation.sequence) return this.#record({ ...common, status: 'observation-stalled', offer });
    let learned = false;
    if (result.event) {
      validateEvent(result.event);
      if (cueIdentity(result.event.cue) !== cueIdentity(offer.cue)
        || result.event.frames[0]!.sequence < observation.sequence
        || result.event.frames.at(-1)!.sequence !== result.observation.sequence)
        throw new Error('body-feedback-does-not-match-commanded-window');
      if (result.availableOffers) {
        if (result.availableOffers.some(value => value.observationSequence !== result.event!.frames[0]!.sequence))
          throw new Error('action-start-affordances-do-not-match-the-measured-frame');
        if (options.learn !== false) this.agent.affordances.observe(result.event.frames[0]!, result.availableOffers);
      }
      if (options.learn !== false) learned = this.agent.medium.observe(result.event).learned;
    }
    this.#executed++; if (intention) intention.actions++;
    this.world.observe(result.observation);
    const comparison = compareExperiencePrediction(prediction, result.observation);
    const differences = compareExperiencePrediction(prediction, result.event?.frames[0] ?? observation).errors
      .filter(error => error.known && !error.matched);
    const forecastAdvanced = differences.length > 0 && differences.every(before =>
      comparison.errors.some(after => after.field === before.field && after.known && after.matched));
    let measuredProgress = false;
    if (intention) {
      const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(intention.goal, intention.baseline!);
      const measured = evaluator.evaluate(result.observation);
      const beforeAction = evaluator.evaluate(result.event?.frames[0] ?? observation);
      // A real advance can recover from a setback without beating an earlier
      // best. Credit the actual action window, not passive drift during search
      // or the magnitude of an inaccurate forecast. Ignore numerical roundoff.
      measuredProgress = measured.status !== 'unknown' && measured.residual < beforeAction.residual - 1e-12;
      if (measuredProgress) {
        intention.bestResidual = Math.min(intention.bestResidual, measured.residual); intention.lastProgress = this.#steps;
        intention.unsuccessfulProbes = 0; intention.probeAfter = 0;
      } else if (forecastAdvanced) intention.unsuccessfulProbes = 0;
      else if (selected || this.agent.lastExploration?.source === 'hypothesis') {
        // Changed but irrelevant motion does not earn unlimited faith in an
        // unrealized plan. A nominally supported tiny displacement is not
        // progress when nothing happened within measurement tolerance.
        // Realized prerequisites count even before the final goal changes.
        intention.unsuccessfulProbes = (intention.unsuccessfulProbes ?? 0) + 1;
        if (intention.unsuccessfulProbes >= 8) {
          intention.probeAfter = this.#steps + 17; intention.unsuccessfulProbes = 0;
        }
      }
    }
    return this.#record({ ...common, status: 'executed', observationSequence: result.observation.sequence, offer,
      learned, planLength: plan?.steps.length ?? 0, planReason: plan?.reason,
      hypothesisDeferred, measuredProgress,
      forecastAdvanced,
      predictedSteps: selected ? plan!.steps : this.agent.explorationPlan,
      ...(result.event ? { actionStartLatencyFrames: result.event.frames[0]!.sequence - observation.sequence } : {}),
      ...(!selected && this.agent.lastExploration ? { exploration: this.agent.lastExploration } : {}),
      prediction: comparison, stateKey: key, withdrawnPlanningOffers: offers.length - planningOffers.length,
      refuted: comparison.errors.some(error => error.known && !error.matched) && stateKey(result.observation) === key });
  }
  snapshot(): ExperienceSessionSnapshot { return structuredClone({ version: 'ExperienceSession1',
    medium: this.agent.medium.snapshot(), affordances: this.agent.affordances.snapshot(), world: this.world.snapshot(),
    choices: this.agent.choices, steps: this.#steps, executed: this.#executed, tasks: this.#tasks,
    passiveWindows: this.#passiveWindows, passiveWrites: this.#passiveWrites,
    arbitration: { nextService: this.#nextService },
    investigation: this.#investigation, maintenance: this.#maintenance, deferred: this.#deferred, recent: this.#recent }); }
  static restore(state: ExperienceSessionSnapshot, options: { sameWorld: boolean } = { sameWorld: false }): ExperienceSession {
    if (state.version !== 'ExperienceSession1' || !Number.isSafeInteger(state.steps) || state.steps < 0
      || !Number.isSafeInteger(state.executed) || state.executed < 0 || state.executed > state.steps
      || ![state.passiveWindows ?? 0, state.passiveWrites ?? 0].every(value => Number.isSafeInteger(value) && value >= 0)
      || (state.passiveWrites ?? 0) > (state.passiveWindows ?? 0)
      || (state.arbitration !== undefined && state.arbitration?.nextService !== 'maintenance' && state.arbitration?.nextService !== 'task')
      || state.tasks.length > 64 || state.recent.length > 256 || state.deferred.length > 32)
      throw new Error('invalid-continuing-session');
    const session = new ExperienceSession(ExperienceMedium.restore(state.medium), LearnedAffordances.restore(state.affordances));
    session.agent.restoreChoices(state.choices); session.#steps = state.steps; session.#executed = state.executed;
    session.#passiveWindows = state.passiveWindows ?? 0; session.#passiveWrites = state.passiveWrites ?? 0;
    if (options.sameWorld) {
      session.#recent = structuredClone(state.recent);
      session.world = ExperienceWorld.restore(state.world); session.#tasks = structuredClone(state.tasks);
      session.#investigation = structuredClone(state.investigation); session.#deferred = structuredClone(state.deferred);
      session.#maintenance = structuredClone(state.maintenance ?? null);
      session.#nextService = state.arbitration?.nextService ?? 'maintenance';
      for (const task of [...session.#tasks, ...(session.#investigation ? [session.#investigation] : [])]) task.firstSatisfied = null;
    }
    return session;
  }
}
