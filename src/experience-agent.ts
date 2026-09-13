import type { Observation, RealEvent } from './contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from './control/contracts.js';
import { GroundedGoalEvaluatorV1, goalPredicates } from './control/goal.js';
import { ExperienceMedium, experienceState, experienceInputs, motorIdentity, type ExperiencePrediction } from './experience-medium.js';
import { cueIdentity } from './events.js';
import { sha } from './util.js';
import { LearnedAffordances } from './learned-affordances.js';

/** Search identity, not a change to observations or their support. Property
 * presence matters to later output binding; an unsupported property's copied
 * value is neither a predictor input nor a grounded goal measurement. Keep
 * geometry and target identity intact because their transforms are separate. */
export function experienceSearchKey(value: Observation): string {
  const support = value.predictionSupport ? new Set(value.predictionSupport) : null;
  const state = Object.fromEntries(Object.entries(experienceState(value)).map(([key, v]) => {
    const path = JSON.parse(key) as string[];
    const field = path[0] === 'self' && path[1] === 'properties' ? 'self/properties.' + path[2]
      : path[0] === 'object' && path[2] === 'properties' ? 'object:' + path[1] + '/properties.' + path[3] : null;
    return [key, field && support && !support.has(field) ? { unknown: true }
      : typeof v === 'number' ? Math.round(v / .025) : v];
  }));
  return sha({ support: support ? [...support].sort() : undefined, bounds: value.predictionBounds,
    sensoryContext: Object.fromEntries(Object.entries(experienceInputs(value)).filter(([key]) => key.startsWith('view/'))
      .map(([key, v]) => [key, typeof v === 'number' ? Math.round(v / .025) : v])), state });
}

/** Score explicitly predicted channels against later measurements. A probe's
 * assumptions remain labelled hypotheses even when comparing real feedback. */
export function compareExperiencePrediction(prediction: ExperiencePrediction, actual: Observation) {
  const read = (observation: Observation, field: string): unknown => {
    if (field.startsWith('context/')) {
      const channel = field.slice(8);
      return observation.predictionContext?.[channel] ?? experienceInputs(observation)[channel];
    }
    if (field === 'targetId') return prediction.predictedGazeRole && observation.targetId !== null
      ? prediction.predictedGazeRole : observation.targetId;
    const slash = field.indexOf('/'), subject = field.slice(0, slash), path = field.slice(slash + 1);
    const object = subject === 'self' ? observation.self : observation.objects.find(o =>
      prediction.predictedGazeRole && subject === `object:${prediction.predictedGazeRole}`
        ? o.id === observation.targetId : `object:${o.id}` === subject);
    if (path === 'visible' && prediction.predictedGazeRole && subject === `object:${prediction.predictedGazeRole}`) return Boolean(object);
    if (!object) return undefined;
    if (path === 'relativeDistance' && 'relativePosition' in object) return Math.hypot(...object.relativePosition);
    return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key] : undefined, object);
  };
  const basis = prediction.hypothesizedFields ? 'hypothesized' as const : 'supported' as const;
  const fields = [...(prediction.hypothesizedFields ?? prediction.supportedFields), ...(prediction.accepted && !prediction.hypothesizedFields
    ? Object.keys(prediction.observation?.predictionContext ?? {}).map(channel => 'context/' + channel) : [])];
  const errors = fields.map(field => {
    const expected = prediction.observation ? read(prediction.observation, field) : undefined, measured = read(actual, field);
    const error = typeof expected === 'number' && typeof measured === 'number' ? Math.abs(expected - measured) : null;
    const range = prediction.observation?.predictionBounds?.[field];
    return { field, expected, measured, error, known: measured !== undefined,
      ...(range ? { range } : {}),
      matched: measured !== undefined && (error !== null ? range && typeof measured === 'number'
        ? measured >= range[0] - 1e-6 && measured <= range[1] + 1e-6 : error <= .1 : Object.is(expected, measured)) };
  });
  return { basis, compared: errors.filter(e => e.known).length, matched: errors.filter(e => e.matched).length,
    unknown: errors.filter(e => !e.known).length, errors };
}

export interface ExperienceActionStart {
  observation: Observation;
  offer: ActionOfferV1;
  availableOffers: readonly ActionOfferV1[];
  precedingPassiveEvents: readonly RealEvent[];
  /** Opaque transport identity; never a learned input. */
  bindingToken?: string;
}
/** Called synchronously after rebinding and before issuing the motor. The
 * adapter must capture this frame before yielding, or atomically compare and
 * refuse execution if an asynchronous body's frame changed before capture.
 * Returning false refuses the motor; a Promise is not a valid authorization. */
export type BeforeExperienceAction = (start: ExperienceActionStart) => boolean;

export interface ExperienceEnvironment {
  /** Body preferences specify desired sensed conditions, never a motor or
   * its effect. Missing sensed conditions remain unknown. */
  readonly maintenanceGoals?: readonly GroundedGoalV1[];
  observe(): Promise<Observation>;
  drainPassiveEvents?(): Promise<readonly RealEvent[]>;
  listActionOffers(observation: Observation): readonly ActionOfferV1[];
  executeOffer(offer: ActionOfferV1, beforeExecute?: BeforeExperienceAction): Promise<{
    executed: boolean; observation: Observation; event: RealEvent | null;
    precedingPassiveEvents?: readonly RealEvent[];
    executionBinding?: { token: string; status: 'accepted' | 'refused' | 'cancelled'; reason: string; elapsedMs: number | null };
    /** Complete body offers from the actual first frame of the action. */
    availableOffers?: readonly ActionOfferV1[];
  }>;
  waitForObservationAfter(sequence: number): Promise<Observation>;
}
export interface ExperiencePlanStep {
  offer: ActionOfferV1;
  prediction: ExperiencePrediction;
}
export interface ExperiencePlan {
  steps: readonly ExperiencePlanStep[];
  expanded: number;
  reason: 'predicted-goal' | 'predicted-progress' | 'hypothetical-goal' | 'hypothetical-progress'
    | 'already-satisfied' | 'search-exhausted' | 'search-budget';
}
export interface ExperienceRun {
  status: 'goal-verified' | 'unknown' | 'action-budget' | 'body-refused' | 'observation-stalled';
  actions: readonly { cue: string; mode: 'planned' | 'exploration'; planLength: number;
    predictionCorrect: boolean | null; observationSequence: number }[];
  observation: Observation;
}

/** A transient model search, not a stored hierarchy of action templates.
 * Only the first action is executed; every real observation starts a new search.
 * The same predictor is used for one-step and multi-step reasoning. */
export class ExperienceAgent {
  #choices = 0;
  #lastExploration: { source: 'hypothesis' | 'curiosity'; planLength: number } | null = null;
  #explorationPrediction: ExperiencePrediction | null = null;
  #explorationPlan: readonly ExperiencePlanStep[] = [];
  constructor(readonly medium = new ExperienceMedium(), readonly affordances = new LearnedAffordances()) {}
  get choices(): number { return this.#choices; }
  get lastExploration() { return this.#lastExploration ? { ...this.#lastExploration } : null; }
  get explorationPrediction() { return this.#explorationPrediction; }
  get explorationPlan() { return this.#explorationPlan; }
  restoreChoices(choices: number): void {
    if (!Number.isSafeInteger(choices) || choices < 0) throw new Error('invalid-choice-counter');
    this.#choices = choices;
  }

  explore(observation: Observation, offers: readonly ActionOfferV1[],
    purpose?: { goal: GroundedGoalV1; baseline?: Observation; planningOffers?: readonly ActionOfferV1[];
      milliseconds?: number }, localVisits: ReadonlyMap<string, number> = new Map()): ActionOfferV1 | null {
    this.#lastExploration = null; this.#explorationPrediction = null; this.#explorationPlan = [];
    if (!offers.length) return null;
    const choiceIndex = this.#choices++;
    const probe = purpose ? this.plan(purpose.goal, observation, purpose.planningOffers ?? offers, { baseline: purpose.baseline,
      exploratory: true, depth: 6, expansions: 64, milliseconds: purpose.milliseconds ?? 50 }) : null;
    // A probe already selects a motor. Only its observational focus still
    // needs scoring; ranking all discarded motors adds delay, not evidence.
    const candidates = probe?.steps[0] ? offers.filter(offer => offer.offerId === probe.steps[0]!.offer.offerId) : offers;
    const choices = observation.perception && observation.objects.length
      ? candidates.flatMap(offer => observation.objects.map(object => ({ ...offer, attentionId: object.id }))) : candidates;
    const ranked = choices.map(offer => ({ offer,
      drive: this.medium.explorationDrive(offer.cue, observation, offer.attentionId)
        / Math.sqrt(1 + (localVisits.get(motorIdentity(offer.cue)) ?? 0)),
      tie: sha({ action: cueIdentity(offer.cue), attention: offer.attentionId, choice: choiceIndex }) }))
      .sort((a, b) => b.drive - a.drive || a.tie.localeCompare(b.tie, 'en'));
    if (probe?.steps[0]) {
      this.#lastExploration = { source: 'hypothesis', planLength: probe.steps.length };
      this.#explorationPrediction = probe.steps[0].prediction;
      this.#explorationPlan = probe.steps;
      return ranked[0]!.offer;
    }
    // Attention selects the best measurement for each motor. Sampling motors
    // by their intrinsic value avoids permanent starvation by a slightly
    // higher score. This contains no direction, route, or task-specific motor.
    const best = new Map<string, typeof ranked[number]>();
    for (const value of ranked) if (!best.has(value.offer.offerId)) best.set(value.offer.offerId, value);
    const families = new Map<string, (typeof ranked[number] & { weight: number })[]>();
    for (const value of best.values()) {
      const family = families.get(value.offer.cue.kind) ?? [];
      family.push({ ...value, weight: Math.exp(Math.max(-20, (value.drive - ranked[0]!.drive) / .2)) });
      families.set(value.offer.cue.kind, family);
    }
    const sample = <T extends { weight: number }>(values: readonly T[], part: string): T => {
      let draw = parseInt(sha({ exploration: this.#choices, part }).slice(0, 8), 16) / 0x100000000
        * values.reduce((sum, value) => sum + value.weight, 0);
      for (const value of values) if ((draw -= value.weight) <= 0) return value;
      return values.at(-1)!;
    };
    // Parameterizing one actuator more finely must not multiply its prior
    // share of exploration. Average each port's intrinsic values, then sample
    // its parameters. Port names supply grouping only, never expected effects.
    const family = sample([...families].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, motors]) => ({
      motors, weight: motors.reduce((sum, value) => sum + value.weight, 0) / motors.length })), 'port');
    this.#lastExploration = { source: 'curiosity', planLength: 0 };
    return sample(family.motors, 'parameters').offer;
  }

  plan(goal: GroundedGoalV1, observation: Observation, offers: readonly ActionOfferV1[],
    limits: { depth?: number; expansions?: number; baseline?: Observation; exploratory?: boolean;
      milliseconds?: number } = {}): ExperiencePlan {
    const deadline = performance.now() + (limits.milliseconds ?? Infinity);
    const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, limits.baseline ?? observation);
    const requestedFields = goalPredicates(goal).map(predicate => `${predicate.subject.kind === 'self' ? 'self'
      : predicate.subject.kind === 'crosshair' ? 'gaze' : 'object:' + predicate.subject.id}/${predicate.observable}`);
    if (evaluator.evaluate(observation).status === 'satisfied')
      return { steps: [], expanded: 0, reason: 'already-satisfied' };
    const keyOf = experienceSearchKey;
    const queue: { observation: Observation; steps: ExperiencePlanStep[]; priority: number }[] = [{ observation, steps: [], priority: 0 }];
    const visited = new Set([keyOf(observation)]);
    let expanded = 0;
    let progress: { steps: ExperiencePlanStep[]; residual: number } | null = null;
    const initialResidual = evaluator.evaluate(observation).residual;
    const finish = (reason: 'search-budget' | 'search-exhausted'): ExperiencePlan => progress
      ? { steps: progress.steps, expanded, reason: limits.exploratory ? 'hypothetical-progress' : 'predicted-progress' }
      : { steps: [], expanded, reason };
    const ordered = [...offers].sort((a, b) => cueIdentity(a.cue).localeCompare(cueIdentity(b.cue), 'en'));
    while (queue.length) {
      queue.sort((a, b) => a.priority - b.priority);
      const node = queue.shift()!;
      if (node.steps.length >= (limits.depth ?? 32)) continue;
      if (expanded++ >= (limits.expansions ?? 512)) return finish('search-budget');
      const candidates = node.steps.length === 0 || !this.affordances.size ? ordered : this.affordances.imagined(node.observation);
      // A wall-clock limit must not permanently exclude the same suffix of
      // motors. Failed searches lead to a real exploration choice; its saved
      // counter rotates the next search without implying any motor effect.
      const offset = candidates.length ? this.#choices % candidates.length : 0;
      const available = [...candidates.slice(offset), ...candidates.slice(0, offset)];
      for (const offer of available) {
        if (performance.now() >= deadline) return finish('search-budget');
        const prediction = this.medium.predict(offer.cue, node.observation, { probe: limits.exploratory, requestedFields });
        if (!prediction.observation || (limits.exploratory
          ? !prediction.hypothesizedFields?.length : !prediction.accepted)) continue;
        // Hypotheses receive temporary support only inside this search. The
        // returned prediction stays unaccepted with no supported fields.
        const next = limits.exploratory ? { ...prediction.observation,
          predictionSupport: prediction.hypothesizedFields } : prediction.observation;
        const key = keyOf(next);
        if (visited.has(key)) continue;
        visited.add(key);
        const steps = [...node.steps, { offer, prediction }];
        const evaluated = evaluator.evaluate(next);
        if (evaluated.status === 'satisfied') return { steps, expanded,
          reason: limits.exploratory ? 'hypothetical-goal' : 'predicted-goal' };
        // An approach can be tested beyond today's search horizon. Its
        // original support status is preserved: a hypothesis is never promoted
        // to a supported forecast or a claim of completion.
        if (evaluated.status !== 'unknown'
          && evaluated.residual < (progress?.residual ?? initialResidual) - 1e-6)
          progress = { steps, residual: evaluated.residual };
        queue.push({ observation: next, steps, priority: evaluated.residual + steps.length * .02 });
      }
    }
    return finish('search-exhausted');
  }

  async runGoal(environment: ExperienceEnvironment, goal: GroundedGoalV1,
    options: { actionBudget: number; learn?: boolean; allowExploration?: boolean;
      verificationTicks?: number; depth?: number; milliseconds?: number } = { actionBudget: 8 }): Promise<ExperienceRun> {
    // Both bounded and continuing execution share one feedback owner. The
    // dynamic import avoids a module-initialization cycle with the planner.
    const { ExperienceSession } = await import('./experience-session.js');
    const session = new ExperienceSession(this.medium, this.affordances);
    session.agent.restoreChoices(this.#choices); session.submit(goal);
    let observation = await environment.observe();
    const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, observation);
    const actions: ExperienceRun['actions'][number][] = [];
    const finish = (status: ExperienceRun['status']): ExperienceRun => ({ status, actions, observation });
    try {
      for (;;) {
        if (actions.length >= options.actionBudget && evaluator.evaluate(observation).status !== 'satisfied')
          return finish('action-budget');
        const decision = await session.step(environment, { learn: options.learn, exploration: options.allowExploration,
          depth: options.depth, expansions: 512, verificationTicks: options.verificationTicks, milliseconds: options.milliseconds });
        observation = await environment.observe();
        if (decision.status === 'goal-verified') return finish('goal-verified');
        if (decision.status === 'refused') return finish('body-refused');
        if (decision.status === 'observation-stalled') return finish('observation-stalled');
        if (decision.status === 'no-offers') return finish('unknown');
        if (decision.status !== 'executed') continue;
        const planned = (decision.planLength ?? 0) > 0, comparison = planned ? decision.prediction : null;
        actions.push({ cue: cueIdentity(decision.offer!.cue), mode: planned ? 'planned' : 'exploration',
          planLength: decision.planLength ?? 0, predictionCorrect: comparison ? comparison.compared > 0
            && comparison.unknown === 0 && comparison.matched === comparison.compared : null,
          observationSequence: decision.observationSequence });
      }
    } finally {
      this.#choices = session.agent.#choices;
      this.#lastExploration = session.agent.#lastExploration;
      this.#explorationPrediction = session.agent.#explorationPrediction;
      this.#explorationPlan = session.agent.#explorationPlan;
    }
  }
}
