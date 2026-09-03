import type { DesiredChange, Observation, PublicValue } from '../contracts.js';
import type { GoalEvaluationV1, GoalExpressionV1, GoalPredicateV1, GroundedGoalV1,
  PredicateEvaluationV1 } from './contracts.js';
import { assert } from '../util.js';

type Baseline = Map<string, PublicValue | number | null>;

export function groundedPublicObservableV1(predicate: GoalPredicateV1,
  observation: Observation): PublicValue | number | null | undefined {
  const grounded = predicate.subject;
  const key = predicate.observable;
  if (grounded.kind === 'crosshair') {
    const target = observation.objects.find(object => object.id === observation.targetId);
    if (key === 'type') return target?.type ?? null;
    if (key === 'visible') return target !== undefined;
    if (key === 'relativeDistance') return target ? Math.hypot(...target.relativePosition) : undefined;
    if (key.startsWith('relativePosition.')) return target?.relativePosition[Number(key.at(-1))];
    return undefined;
  }
  const subject = grounded.kind === 'self'
    ? { type: 'self', position: observation.self.position, yaw: observation.self.yaw, pitch: observation.self.pitch,
      properties: observation.self.properties, relativePosition: undefined }
    : observation.objects.find(object => object.id === grounded.id && object.type === grounded.expectedType);
  if (!subject) return undefined;
  if (key === 'type') return subject.type;
  if (key === 'visible') return true;
  if (key === 'relativeDistance') {
    if (!('relativePosition' in subject) || !subject.relativePosition) return undefined;
    return Math.hypot(...subject.relativePosition);
  }
  if (key === 'yaw') return 'yaw' in subject ? subject.yaw : undefined;
  if (key === 'pitch') return 'pitch' in subject ? subject.pitch : undefined;
  if (key.startsWith('position.')) {
    if (!('position' in subject)) return undefined;
    return subject.position[Number(key.at(-1))];
  }
  if (key.startsWith('relativePosition.')) {
    if (!('relativePosition' in subject) || !subject.relativePosition) return undefined;
    return subject.relativePosition[Number(key.at(-1))];
  }
  if (key.startsWith('properties.')) return subject.properties[key.slice('properties.'.length)];
  return undefined;
}

function predicateList(expression: GoalExpressionV1): GoalPredicateV1[] {
  if (expression.kind === 'predicate') return [expression.predicate];
  return expression.children.flatMap(predicateList);
}

function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

export function evaluateGroundedPredicateValueV1(predicate: GoalPredicateV1,
  actual: PublicValue | number | null | undefined,
  baseline: PublicValue | number | null): PredicateEvaluationV1 {
  if (actual === undefined) return { predicateId: predicate.id, status: 'unknown', residual: 1,
    actual: null, baseline, reason: 'public-observable-unavailable' };
  let satisfied = false, residual = 1;
  switch (predicate.comparator) {
    case 'equals': satisfied = actual === predicate.target; residual = satisfied ? 0 : 1; break;
    case 'not-equals': satisfied = actual !== predicate.target; residual = satisfied ? 0 : 1; break;
    case 'greater-than': {
      if (!finiteNumber(actual)) return { predicateId: predicate.id, status: 'unknown', residual: 1,
        actual, baseline, reason: 'numeric-goal-received-non-number' };
      const tolerance = predicate.tolerance ?? 0;
      satisfied = actual > predicate.target - tolerance;
      residual = satisfied ? 0 : clamp01((predicate.target - actual) / Math.max(1, Math.abs(predicate.target)));
      break;
    }
    case 'less-than': {
      if (!finiteNumber(actual)) return { predicateId: predicate.id, status: 'unknown', residual: 1,
        actual, baseline, reason: 'numeric-goal-received-non-number' };
      const tolerance = predicate.tolerance ?? 0;
      satisfied = actual < predicate.target + tolerance;
      residual = satisfied ? 0 : clamp01((actual - predicate.target) / Math.max(1, Math.abs(predicate.target)));
      break;
    }
    case 'within': {
      if (!finiteNumber(actual)) return { predicateId: predicate.id, status: 'unknown', residual: 1,
        actual, baseline, reason: 'numeric-goal-received-non-number' };
      satisfied = actual >= predicate.lower && actual <= predicate.upper;
      residual = satisfied ? 0 : clamp01(Math.min(Math.abs(actual - predicate.lower), Math.abs(actual - predicate.upper))
        / Math.max(1, predicate.upper - predicate.lower));
      break;
    }
    case 'increase': case 'decrease': {
      if (!finiteNumber(actual) || !finiteNumber(baseline)) return { predicateId: predicate.id, status: 'unknown', residual: 1,
        actual, baseline, reason: 'relative-goal-baseline-unavailable' };
      const delta = predicate.comparator === 'increase' ? actual - baseline : baseline - actual;
      satisfied = delta >= predicate.minimumDelta;
      residual = satisfied ? 0 : clamp01((predicate.minimumDelta - delta) / Math.max(predicate.minimumDelta, 1e-9));
      break;
    }
  }
  return { predicateId: predicate.id, status: satisfied ? 'satisfied' : 'mismatch', residual,
    actual, baseline, reason: null };
}

function combine(expression: GoalExpressionV1, byId: ReadonlyMap<string, PredicateEvaluationV1>): { status: GoalEvaluationV1['status']; residual: number } {
  if (expression.kind === 'predicate') {
    const result = byId.get(expression.predicate.id)!;
    return { status: result.status, residual: result.residual };
  }
  assert(expression.children.length > 0, 'empty-goal-expression');
  const children = expression.children.map(child => combine(child, byId));
  if (expression.kind === 'all') {
    if (children.every(child => child.status === 'satisfied')) return { status: 'satisfied', residual: 0 };
    if (children.some(child => child.status === 'mismatch')) return { status: 'mismatch',
      residual: children.reduce((sum, child) => sum + child.residual, 0) / children.length };
    return { status: 'unknown', residual: 1 };
  }
  if (children.some(child => child.status === 'satisfied')) return { status: 'satisfied', residual: 0 };
  if (children.every(child => child.status === 'mismatch')) return { status: 'mismatch', residual: Math.min(...children.map(child => child.residual)) };
  return { status: 'unknown', residual: 1 };
}

export class GroundedGoalEvaluatorV1 {
  #goal: GroundedGoalV1 | null = null;
  #baseline: Baseline = new Map();
  setGoal(goal: GroundedGoalV1, observation: Observation): void {
    const predicates = predicateList(goal.expression);
    assert(predicates.length > 0 && new Set(predicates.map(predicate => predicate.id)).size === predicates.length,
      'invalid-or-duplicate-goal-predicate');
    this.#goal = structuredClone(goal); this.#baseline.clear();
    for (const predicate of predicates) this.#baseline.set(predicate.id,
      groundedPublicObservableV1(predicate, observation) ?? null);
  }
  get goal(): GroundedGoalV1 | null { return this.#goal ? structuredClone(this.#goal) : null; }
  evaluate(observation: Observation): GoalEvaluationV1 {
    assert(this.#goal, 'goal-not-set');
    const predicates = predicateList(this.#goal.expression).map(predicate => evaluateGroundedPredicateValueV1(predicate,
      groundedPublicObservableV1(predicate, observation), this.#baseline.get(predicate.id) ?? null));
    const combined = combine(this.#goal.expression, new Map(predicates.map(predicate => [predicate.predicateId, predicate])));
    return { goalId: this.#goal.id, status: combined.status, residual: combined.residual,
      observationSequence: observation.sequence, predicates };
  }
  reset(): void { this.#goal = null; this.#baseline.clear(); }
}

export function goalPredicates(goal: GroundedGoalV1): readonly GoalPredicateV1[] { return predicateList(goal.expression); }

export function desiredChangesForGoal(goal: GroundedGoalV1, evaluation: GoalEvaluationV1): readonly {
  readonly predicateId: string; readonly desired: DesiredChange;
}[] {
  const byId = new Map(evaluation.predicates.map(predicate => [predicate.predicateId, predicate]));
  return predicateList(goal.expression).flatMap(predicate => {
    const result = byId.get(predicate.id);
    if (!result || result.status === 'satisfied'
      || (predicate.observable === 'type' && predicate.subject.kind !== 'crosshair')) return [];
    const subject = predicate.subject.kind === 'self' ? 'self'
      : predicate.subject.kind === 'crosshair' ? 'crosshair' : predicate.subject.expectedType;
    const property = predicate.observable.startsWith('properties.') ? predicate.observable.slice('properties.'.length)
      : predicate.observable.startsWith('position.') || predicate.observable.startsWith('relativePosition.')
        ? `displacement.${predicate.observable.at(-1)}` : predicate.observable;
    let desired: DesiredChange;
    switch (predicate.comparator) {
      case 'equals': desired = { subject, property, value: predicate.target }; break;
      case 'not-equals': desired = { subject, property, direction: 'change' }; break;
      case 'greater-than': desired = { subject, property, direction: 'increase' }; break;
      case 'less-than': desired = { subject, property, direction: 'decrease' }; break;
      case 'within': desired = { subject, property, direction: typeof result.actual === 'number' && result.actual > predicate.upper
        ? 'decrease' : 'increase' }; break;
      case 'increase': desired = { subject, property, direction: 'increase' }; break;
      case 'decrease': desired = { subject, property, direction: 'decrease' }; break;
    }
    return [{ predicateId: predicate.id, desired }];
  });
}
