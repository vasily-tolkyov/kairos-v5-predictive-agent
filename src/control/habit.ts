import { canonical } from '../util.js';

export const CONTROL_HABIT_OPERATIONS_V1 = [
  'recall-effect', 'compare-condition', 'predict-branch', 'expand-condition',
  'execute', 'observe-public', 'finish-verified', 'finish-unknown',
] as const;
export type ControlHabitOperationV1 = typeof CONTROL_HABIT_OPERATIONS_V1[number];

export const CONTROL_HABIT_GRAPH_RELATIONS_V1 = [
  'same-node', 'parent-to-child', 'child-to-parent', 'root-to-branch', 'branch-to-root',
] as const;
export type ControlHabitGraphRelationV1 = typeof CONTROL_HABIT_GRAPH_RELATIONS_V1[number];

export interface ControlHabitKeyV1 {
  readonly previousOperation: ControlHabitOperationV1;
  readonly nextOperation: ControlHabitOperationV1;
  readonly relation: ControlHabitGraphRelationV1;
}

export interface ControlHabitDispatchInputV1 {
  readonly operation: ControlHabitOperationV1;
  /** Relations from the new dispatch to prior dispatches, newest first. Null means
   * the two branches are unrelated and therefore must not form a habit key. */
  readonly relationsFromRecent: readonly (ControlHabitGraphRelationV1 | null)[];
}

export interface TrustedRealActionOutcomeV1 {
  readonly source: 'trusted-real-executed-action';
  readonly dispatchSequence: number;
  readonly residualReduction: number;
  readonly predictionViolation: {
    readonly matched: boolean;
    readonly highSupport: boolean;
    readonly deviation: number;
  } | null;
}

interface EligibilityEntryV1 {
  readonly key: ControlHabitKeyV1;
  readonly eligibility: number;
}

interface DispatchRecordV1 {
  readonly sequence: number;
  readonly operation: ControlHabitOperationV1;
  readonly eligibility: readonly EligibilityEntryV1[];
}

export interface ControlHabitCheckpointV1 {
  readonly version: 'ControlHabitWeightsV1';
  readonly activeTimeSeconds: number;
  readonly nextDispatchSequence: number;
  readonly weights: readonly { readonly key: ControlHabitKeyV1; readonly weight: number }[];
  readonly recentDispatches: readonly DispatchRecordV1[];
}

export interface ControlHabitUpdateResultV1 {
  readonly applied: boolean;
  readonly positiveDelta: number;
  readonly negativeDelta: number;
  readonly reason: 'updated' | 'non-execute-dispatch' | 'no-learning-signal';
}

const MAX_WEIGHT = .20;
const POSITIVE_RATE = .05;
const NEGATIVE_RATE = .08;
const DECAY_LAMBDA = 1e-5;
const RECENT_DISPATCH_CAPACITY = 8;
const MAX_PRIOR_ELIGIBILITY_DISTANCE = RECENT_DISPATCH_CAPACITY - 1;

const operationSet = new Set<string>(CONTROL_HABIT_OPERATIONS_V1);
const relationSet = new Set<string>(CONTROL_HABIT_GRAPH_RELATIONS_V1);
const finiteWithin = (value: number, lower: number, upper: number): boolean =>
  Number.isFinite(value) && value >= lower && value <= upper;
const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, 'en'));
  const wanted = [...expected].sort((left, right) => left.localeCompare(right, 'en'));
  return actual.length === wanted.length && actual.every((item, index) => item === wanted[index]);
};
const requireValue: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

function validateKey(value: unknown): asserts value is ControlHabitKeyV1 {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid-control-habit-key');
  requireValue(exactKeys(value, ['previousOperation', 'nextOperation', 'relation']), 'control-habit-key-must-be-nonsemantic');
  const key = value as Record<string, unknown>;
  requireValue(typeof key.previousOperation === 'string' && operationSet.has(key.previousOperation), 'invalid-control-habit-previous-operation');
  requireValue(typeof key.nextOperation === 'string' && operationSet.has(key.nextOperation), 'invalid-control-habit-next-operation');
  requireValue(typeof key.relation === 'string' && relationSet.has(key.relation), 'invalid-control-habit-graph-relation');
}

const keyId = (key: ControlHabitKeyV1): string =>
  `${key.previousOperation}\u001f${key.nextOperation}\u001f${key.relation}`;
const compareKeys = (left: ControlHabitKeyV1, right: ControlHabitKeyV1): number =>
  keyId(left).localeCompare(keyId(right), 'en');

/**
 * A narrow, nonsemantic eligibility-trace store for control-operation habits.
 * It returns drive only: callers remain solely responsible for hard eligibility.
 */
export class ControlHabitWeightsV1 {
  readonly #weights = new Map<string, { key: ControlHabitKeyV1; weight: number }>();
  readonly #recent: DispatchRecordV1[] = [];
  #activeTimeSeconds = 0;
  #nextDispatchSequence = 1;

  get recentDispatchCount(): number { return this.#recent.length; }

  /** A control restart does not restore an old branch/action chain. Learned weights
   * remain, while the short eligibility trace starts from the new observation. */
  beginNewControlEpisode(): void { this.#recent.length = 0; }

  recordDispatch(input: ControlHabitDispatchInputV1): number {
    requireValue(operationSet.has(input.operation), 'invalid-control-habit-operation');
    const availablePrior = Math.min(this.#recent.length, MAX_PRIOR_ELIGIBILITY_DISTANCE);
    requireValue(input.relationsFromRecent.length === availablePrior,
      'control-habit-relation-count-must-match-recent-dispatches');
    for (const relation of input.relationsFromRecent)
      requireValue(relation === null || relationSet.has(relation), 'invalid-control-habit-graph-relation');

    const aggregate = new Map<string, EligibilityEntryV1>();
    for (let index = 0; index < availablePrior; index++) {
      const previous = this.#recent[this.#recent.length - 1 - index]!;
      if (input.relationsFromRecent[index] === null) continue;
      const key: ControlHabitKeyV1 = { previousOperation: previous.operation, nextOperation: input.operation,
        relation: input.relationsFromRecent[index]! };
      const eligibility = Math.exp(-(index + 1) / 4);
      const id = keyId(key), prior = aggregate.get(id);
      // Repeated occurrences of one transition form one bounded eligibility trace.
      aggregate.set(id, { key, eligibility: Math.min(1, (prior?.eligibility ?? 0) + eligibility) });
    }
    const record: DispatchRecordV1 = { sequence: this.#nextDispatchSequence++, operation: input.operation,
      eligibility: [...aggregate.values()].sort((left, right) => compareKeys(left.key, right.key)) };
    this.#recent.push(record);
    if (this.#recent.length > RECENT_DISPATCH_CAPACITY) this.#recent.shift();
    return record.sequence;
  }

  drive(key: ControlHabitKeyV1): number {
    validateKey(key);
    return this.#weights.get(keyId(key))?.weight ?? 0;
  }

  applyTrustedRealActionOutcome(outcome: TrustedRealActionOutcomeV1): ControlHabitUpdateResultV1 {
    requireValue(outcome.source === 'trusted-real-executed-action', 'control-habit-update-requires-trusted-real-action');
    requireValue(Number.isSafeInteger(outcome.dispatchSequence) && outcome.dispatchSequence > 0,
      'invalid-control-habit-dispatch-sequence');
    requireValue(finiteWithin(outcome.residualReduction, 0, 1), 'invalid-control-habit-residual-reduction');
    if (outcome.predictionViolation) {
      requireValue(typeof outcome.predictionViolation.matched === 'boolean'
        && typeof outcome.predictionViolation.highSupport === 'boolean'
        && finiteWithin(outcome.predictionViolation.deviation, 0, 1), 'invalid-control-habit-prediction-violation');
    }
    const dispatch = this.#recent.find(record => record.sequence === outcome.dispatchSequence);
    requireValue(dispatch, 'control-habit-dispatch-not-in-recent-trace');
    if (dispatch.operation !== 'execute') return { applied: false, positiveDelta: 0, negativeDelta: 0,
      reason: 'non-execute-dispatch' };

    const positiveScale = POSITIVE_RATE * outcome.residualReduction;
    const violation = outcome.predictionViolation;
    const negativeScale = violation?.matched && violation.highSupport ? NEGATIVE_RATE * violation.deviation : 0;
    if (positiveScale === 0 && negativeScale === 0) return { applied: false, positiveDelta: 0, negativeDelta: 0,
      reason: 'no-learning-signal' };

    let positiveDelta = 0, negativeDelta = 0;
    for (const entry of dispatch.eligibility) {
      const id = keyId(entry.key), before = this.#weights.get(id)?.weight ?? 0;
      const positive = positiveScale * entry.eligibility;
      const afterPositive = Math.min(MAX_WEIGHT, before + positive);
      const negative = negativeScale * entry.eligibility;
      const after = Math.max(0, afterPositive - negative);
      if (after > 0) this.#weights.set(id, { key: entry.key, weight: after });
      else this.#weights.delete(id);
      positiveDelta += afterPositive - before;
      negativeDelta += afterPositive - after;
    }
    return { applied: positiveDelta > 0 || negativeDelta > 0, positiveDelta, negativeDelta,
      reason: 'updated' };
  }

  advanceActiveTime(deltaSeconds: number): void {
    requireValue(Number.isFinite(deltaSeconds) && deltaSeconds >= 0, 'invalid-control-habit-active-time-delta');
    if (deltaSeconds === 0) return;
    const multiplier = Math.exp(-DECAY_LAMBDA * deltaSeconds);
    for (const [id, entry] of this.#weights) {
      const weight = entry.weight * multiplier;
      if (weight > 0) this.#weights.set(id, { key: entry.key, weight });
      else this.#weights.delete(id);
    }
    this.#activeTimeSeconds += deltaSeconds;
  }

  exportCheckpoint(): ControlHabitCheckpointV1 {
    return { version: 'ControlHabitWeightsV1', activeTimeSeconds: this.#activeTimeSeconds,
      nextDispatchSequence: this.#nextDispatchSequence,
      weights: [...this.#weights.values()].sort((left, right) => compareKeys(left.key, right.key))
        .map(entry => ({ key: structuredClone(entry.key), weight: entry.weight })),
      recentDispatches: this.#recent.map(record => structuredClone(record)) };
  }

  exportDeterministicJson(): string { return canonical(this.exportCheckpoint()); }

  static restore(value: unknown): ControlHabitWeightsV1 {
    requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'invalid-control-habit-checkpoint');
    requireValue(exactKeys(value, ['version', 'activeTimeSeconds', 'nextDispatchSequence', 'weights', 'recentDispatches']),
      'invalid-control-habit-checkpoint-fields');
    const checkpoint = value as Record<string, unknown>;
    requireValue(checkpoint.version === 'ControlHabitWeightsV1', 'invalid-control-habit-checkpoint-version');
    requireValue(typeof checkpoint.activeTimeSeconds === 'number' && Number.isFinite(checkpoint.activeTimeSeconds)
      && checkpoint.activeTimeSeconds >= 0, 'invalid-control-habit-checkpoint-time');
    requireValue(typeof checkpoint.nextDispatchSequence === 'number' && Number.isSafeInteger(checkpoint.nextDispatchSequence)
      && checkpoint.nextDispatchSequence >= 1, 'invalid-control-habit-next-sequence');
    requireValue(Array.isArray(checkpoint.weights) && Array.isArray(checkpoint.recentDispatches),
      'invalid-control-habit-checkpoint-collections');

    const restored = new ControlHabitWeightsV1();
    restored.#activeTimeSeconds = checkpoint.activeTimeSeconds;
    restored.#nextDispatchSequence = checkpoint.nextDispatchSequence;
    let priorKey: ControlHabitKeyV1 | null = null;
    for (const row of checkpoint.weights) {
      requireValue(row !== null && typeof row === 'object' && !Array.isArray(row)
        && exactKeys(row, ['key', 'weight']), 'invalid-control-habit-weight-row');
      const typed = row as Record<string, unknown>; validateKey(typed.key);
      requireValue(typeof typed.weight === 'number' && finiteWithin(typed.weight, 0, MAX_WEIGHT) && typed.weight > 0,
        'invalid-control-habit-weight');
      requireValue(!priorKey || compareKeys(priorKey, typed.key) < 0, 'control-habit-weights-not-canonical');
      priorKey = typed.key;
      restored.#weights.set(keyId(typed.key), { key: structuredClone(typed.key), weight: typed.weight });
    }
    requireValue(checkpoint.recentDispatches.length <= RECENT_DISPATCH_CAPACITY,
      'control-habit-recent-dispatch-capacity-exceeded');
    let priorSequence = 0;
    for (const row of checkpoint.recentDispatches) {
      requireValue(row !== null && typeof row === 'object' && !Array.isArray(row)
        && exactKeys(row, ['sequence', 'operation', 'eligibility']), 'invalid-control-habit-dispatch-row');
      const typed = row as Record<string, unknown>;
      requireValue(typeof typed.sequence === 'number' && Number.isSafeInteger(typed.sequence)
        && typed.sequence > priorSequence && typed.sequence < restored.#nextDispatchSequence,
      'invalid-control-habit-dispatch-order');
      requireValue(typeof typed.operation === 'string' && operationSet.has(typed.operation), 'invalid-control-habit-operation');
      requireValue(Array.isArray(typed.eligibility), 'invalid-control-habit-eligibility');
      const eligibility: EligibilityEntryV1[] = [];
      let priorEligibilityKey: ControlHabitKeyV1 | null = null;
      for (const item of typed.eligibility) {
        requireValue(item !== null && typeof item === 'object' && !Array.isArray(item)
          && exactKeys(item, ['key', 'eligibility']), 'invalid-control-habit-eligibility-row');
        const entry = item as Record<string, unknown>; validateKey(entry.key);
        requireValue(typeof entry.eligibility === 'number' && finiteWithin(entry.eligibility, 0, 1)
          && entry.eligibility > 0, 'invalid-control-habit-eligibility-value');
        requireValue(!priorEligibilityKey || compareKeys(priorEligibilityKey, entry.key) < 0,
          'control-habit-eligibility-not-canonical');
        priorEligibilityKey = entry.key;
        eligibility.push({ key: structuredClone(entry.key), eligibility: entry.eligibility });
      }
      restored.#recent.push({ sequence: typed.sequence, operation: typed.operation as ControlHabitOperationV1, eligibility });
      priorSequence = typed.sequence;
    }
    return restored;
  }

  static fromDeterministicJson(json: string): ControlHabitWeightsV1 {
    return ControlHabitWeightsV1.restore(JSON.parse(json) as unknown);
  }
}
