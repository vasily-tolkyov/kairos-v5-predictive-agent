/** Environment-neutral, experience-driven prototype. Legacy lattice APIs remain
 * at their explicit source modules for checkpoint inspection and comparisons. */
export { ExperienceMedium, experienceState } from './experience-medium.js';
export type { ExperienceMediumSnapshot, ExperiencePrediction } from './experience-medium.js';
export { ExperienceAgent } from './experience-agent.js';
export { ExperienceSession } from './experience-session.js';
export type { ExperienceSessionSnapshot, SessionDecision, ContinuingTask } from './experience-session.js';
export { ExperienceWorld } from './experience-world.js';
export { LearnedAffordances } from './learned-affordances.js';
export type { ExperienceEnvironment, ExperiencePlan, ExperiencePlanStep, ExperienceRun }
  from './experience-agent.js';
export { GroundedGoalEvaluatorV1, groundedPublicObservableV1,
  evaluateGroundedPredicateValueV1, goalPredicates } from './control/goal.js';
export type { GroundedGoalV1, GoalExpressionV1, GoalPredicateV1, ActionOfferV1 }
  from './control/contracts.js';
export type { Action, ActionCue, Observation, PublicObject, PublicValue, RealEvent }
  from './contracts.js';
