import { assert, canonical, sha } from '../../util.js';

/** Physical identifiers only.  The agenda never stores a semantic factor name. */
export type InterventionArmKindV1 = 'baseline' | 'q-only' | 'r-only' | 'q+r';

export interface PredictionViolationV1 {
  readonly source: 'trusted-real-prediction-outcome';
  readonly combinationId: string;
  readonly physicalPrefixId: string;
  readonly terminalAttractorSignature: string;
  readonly predictedAttractorSignature: string;
  readonly factorIds: readonly string[];
  readonly contextId: string;
  readonly highConfidence: boolean;
}

export interface ViolationLedgerRecordV1 {
  readonly version: 'ViolationLedgerRecordV1';
  readonly combinationId: string;
  readonly factorIds: readonly string[];
  /** Physical prefixes observed in the violations; no semantic action name. */
  readonly physicalPrefixIds?: readonly string[];
  readonly violationCount: number;
  readonly contextIds: readonly string[];
  readonly firstViolationId: string;
  readonly lastViolationId: string;
}

export interface FactorialArmV1 {
  readonly arm: InterventionArmKindV1;
  readonly pairIds: readonly string[];
  readonly matchedCount: number;
  readonly correctCount: number;
  readonly ablationLosses: readonly number[];
}

export interface FactorialCellV1 {
  readonly version: 'FactorialCellV1';
  readonly cellId: string;
  readonly combinationId: string;
  readonly factorIds: readonly string[];
  readonly physicalPrefixIds?: readonly string[];
  readonly openedAfterViolationCount: number;
  readonly status: 'open' | 'causal-hypothesis' | 'intervention-supported';
  readonly arms: readonly FactorialArmV1[];
  readonly contextIds: readonly string[];
}

export interface InterventionAgendaStateV1 {
  readonly version: 'InterventionAgendaStateV1';
  readonly violations: readonly ViolationLedgerRecordV1[];
  readonly cells: readonly FactorialCellV1[];
  readonly updatedAtExperienceSeconds: number;
  readonly violationIds?: readonly string[];
}

export interface MatchedArmResultV1 {
  readonly source: 'trusted-real-intervention-result';
  readonly combinationId: string;
  readonly factorIds: readonly string[];
  readonly arm: InterventionArmKindV1;
  readonly baselineEventId: string;
  readonly interventionEventId: string;
  readonly contextId: string;
  readonly samePrefix: boolean;
  readonly sameAction: boolean;
  readonly onlyPlannedFactorsChanged: boolean;
  /** Measured by the physical PredictionClone/terminal readout, never a
   * caller-supplied semantic result label. */
  readonly physicalBranchSelectionRate: number;
  readonly factorAblationLoss: number;
}

/** A read-only request for one still-unmeasured arm.  It is deliberately an
 * unordered agenda item: the joint control field, not this store, decides
 * whether and when the body should attempt it. */
export interface InterventionArmRequestV1 {
  readonly version: 'InterventionArmRequestV1';
  readonly cellId: string;
  readonly combinationId: string;
  readonly factorIds: readonly string[];
  readonly physicalPrefixIds: readonly string[];
  readonly arm: InterventionArmKindV1;
  readonly remainingPairs: number;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function emptyArm(arm: InterventionArmKindV1): FactorialArmV1 {
  return { arm, pairIds: [], matchedCount: 0, correctCount: 0, ablationLosses: [] };
}

function cellStatus(arms: readonly FactorialArmV1[]): FactorialCellV1['status'] {
  const complete = arms.every(arm => arm.matchedCount >= 4);
  const accurate = arms.every(arm => arm.matchedCount === 0
    || arm.correctCount / arm.matchedCount >= .75);
  const ablation = arms.flatMap(arm => arm.ablationLosses);
  if (complete && accurate && ablation.length > 0 && ablation.reduce((a, b) => a + b, 0) / ablation.length >= .25)
    return 'intervention-supported';
  return complete ? 'causal-hypothesis' : 'open';
}

/**
 * Goal driven callers can use this store as a small autonomous agenda.  It
 * opens a cell only after two physically identified prediction violations;
 * it never accepts an expected result or a semantic factor label.
 */
export class InterventionAgendaStoreV1 {
  readonly #violations = new Map<string, ViolationLedgerRecordV1>();
  readonly #cells = new Map<string, FactorialCellV1>();
  readonly #violationIds = new Set<string>();
  #updatedAtExperienceSeconds = 0;

  recordPredictionViolation(value: PredictionViolationV1): ViolationLedgerRecordV1 | null {
    assert(value.source === 'trusted-real-prediction-outcome' && value.highConfidence,
      'intervention-violation-requires-high-confidence-real-outcome');
    assert(value.combinationId.length > 0 && value.physicalPrefixId.length > 0
      && value.terminalAttractorSignature !== value.predictedAttractorSignature,
      'intervention-violation-physical-identity-invalid');
    const violationId = sha({ combinationId: value.combinationId,
      predicted: value.predictedAttractorSignature, actual: value.terminalAttractorSignature,
      contextId: value.contextId });
    const existing = this.#violations.get(value.combinationId);
    if (this.#violationIds.has(violationId)) return existing ? structuredClone(existing) : null;
    this.#violationIds.add(violationId);
    const current: ViolationLedgerRecordV1 = {
      version: 'ViolationLedgerRecordV1', combinationId: value.combinationId,
      factorIds: sortedUnique(value.factorIds), violationCount: (existing?.violationCount ?? 0) + 1,
      physicalPrefixIds: sortedUnique([...(existing?.physicalPrefixIds ?? []), value.physicalPrefixId]),
      contextIds: sortedUnique([...(existing?.contextIds ?? []), value.contextId]),
      firstViolationId: existing?.firstViolationId ?? violationId, lastViolationId: violationId,
    };
    this.#violations.set(value.combinationId, current);
    if (current.violationCount >= 2 && current.factorIds.length >= 2 && !this.#cells.has(value.combinationId)) {
      const cellId = sha({ version: 'FactorialCellV1', combinationId: value.combinationId,
        factorIds: current.factorIds });
      this.#cells.set(value.combinationId, { version: 'FactorialCellV1', cellId,
        combinationId: value.combinationId, factorIds: current.factorIds,
        physicalPrefixIds: current.physicalPrefixIds,
        openedAfterViolationCount: current.violationCount, status: 'open',
        arms: (['baseline', 'q-only', 'r-only', 'q+r'] as InterventionArmKindV1[]).map(emptyArm),
        contextIds: current.contextIds });
    }
    return structuredClone(current);
  }

  /** Store a real matched arm result.  Invalid matching is a hard error. */
  recordMatchedArm(value: MatchedArmResultV1): FactorialCellV1 {
    assert(value.source === 'trusted-real-intervention-result' && value.samePrefix
      && value.sameAction && value.onlyPlannedFactorsChanged,
      'intervention-arm-is-not-matched');
    assert(Number.isFinite(value.factorAblationLoss) && value.factorAblationLoss >= 0
      && value.factorAblationLoss <= 1 && Number.isFinite(value.physicalBranchSelectionRate)
      && value.physicalBranchSelectionRate >= 0 && value.physicalBranchSelectionRate <= 1,
      'intervention-arm-physical-measurement-invalid');
    const cell = this.#cells.get(value.combinationId);
    assert(cell && cell.factorIds.length === 2
      && canonical(sortedUnique(value.factorIds)) === canonical(cell.factorIds),
      'intervention-cell-not-open');
    const pairId = sha({ combinationId: value.combinationId, arm: value.arm,
      baselineEventId: value.baselineEventId, interventionEventId: value.interventionEventId });
    const prior = cell.arms.find(arm => arm.arm === value.arm)!;
    if (prior.pairIds.includes(pairId)) return structuredClone(cell);
    const updatedArm: FactorialArmV1 = { ...prior, pairIds: [...prior.pairIds, pairId].sort(),
      matchedCount: prior.matchedCount + 1,
      correctCount: prior.correctCount + value.physicalBranchSelectionRate,
      ablationLosses: [...prior.ablationLosses, value.factorAblationLoss] };
    const arms = cell.arms.map(arm => arm.arm === value.arm ? updatedArm : arm);
    const updated: FactorialCellV1 = { ...cell, arms, status: cellStatus(arms),
      contextIds: sortedUnique([...cell.contextIds, value.contextId]) };
    this.#cells.set(value.combinationId, updated);
    return structuredClone(updated);
  }

  setExperienceTime(seconds: number): void {
    assert(Number.isFinite(seconds) && seconds >= this.#updatedAtExperienceSeconds,
      'intervention-agenda-time-reversed');
    this.#updatedAtExperienceSeconds = seconds;
  }

  pending(): readonly FactorialCellV1[] {
    return [...this.#cells.values()].filter(cell => cell.status !== 'intervention-supported')
      .sort((a, b) => a.cellId.localeCompare(b.cellId, 'en')).map(value => structuredClone(value));
  }

  /** Return all incomplete arms without imposing an execution order. */
  pendingArmRequests(): readonly InterventionArmRequestV1[] {
    return [...this.#cells.values()].filter(cell => cell.status !== 'intervention-supported')
      .flatMap(cell => cell.arms.filter(arm => arm.matchedCount < 4).map(arm => ({
        version: 'InterventionArmRequestV1' as const, cellId: cell.cellId,
        combinationId: cell.combinationId, factorIds: [...cell.factorIds],
        physicalPrefixIds: [...(cell.physicalPrefixIds ?? [])], arm: arm.arm,
        remainingPairs: 4 - arm.matchedCount,
      })))
      .sort((left, right) => left.cellId.localeCompare(right.cellId, 'en')
        || left.arm.localeCompare(right.arm, 'en'))
      .map(value => structuredClone(value));
  }

  snapshot(): InterventionAgendaStateV1 {
    return { version: 'InterventionAgendaStateV1',
      violations: [...this.#violations.values()].sort((a, b) => a.combinationId.localeCompare(b.combinationId, 'en'))
        .map(value => structuredClone(value)),
      cells: [...this.#cells.values()].sort((a, b) => a.cellId.localeCompare(b.cellId, 'en'))
        .map(value => structuredClone(value)), updatedAtExperienceSeconds: this.#updatedAtExperienceSeconds,
      ...(this.#violationIds.size > 0 ? { violationIds: [...this.#violationIds].sort() } : {}) };
  }

  static restore(state: InterventionAgendaStateV1): InterventionAgendaStoreV1 {
    assert(state.version === 'InterventionAgendaStateV1', 'intervention-agenda-version-invalid');
    const store = new InterventionAgendaStoreV1();
    store.#updatedAtExperienceSeconds = state.updatedAtExperienceSeconds;
    for (const item of state.violations) store.#violations.set(item.combinationId, {
      ...structuredClone(item), physicalPrefixIds: [...(item.physicalPrefixIds ?? [])],
    });
    for (const item of state.cells) store.#cells.set(item.combinationId, {
      ...structuredClone(item), physicalPrefixIds: [...(item.physicalPrefixIds ?? [])],
    });
    for (const id of state.violationIds ?? state.violations.flatMap(item =>
      [item.firstViolationId, item.lastViolationId])) store.#violationIds.add(id);
    return store;
  }
}
