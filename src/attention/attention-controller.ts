import type {
  AttentionCandidate,
  AttentionScoreBreakdown,
  AttentionSnapshot,
} from "./types.js";
import type { AttentionPort, RandomSourcePort } from "./types.js";

export interface AttentionConfiguration {
  readonly changeWeight: number;
  readonly derivativeWeight: number;
  readonly predictionDeviationWeight: number;
  readonly goalWeight: number;
  readonly noveltyWeight: number;
  readonly actionTargetWeight: number;
  readonly holdBias: number;
  readonly fatiguePerTick: number;
  readonly switchingCost: number;
  readonly hysteresisMargin: number;
  readonly sustainedTicks: number;
  readonly mutationPreemptionThreshold: number;
  readonly closeCallWindow: number;
}

export const DEFAULT_ATTENTION_CONFIGURATION: AttentionConfiguration = Object.freeze({
  changeWeight: 1.75,
  derivativeWeight: 1.3,
  predictionDeviationWeight: 1.25,
  goalWeight: 0.9,
  noveltyWeight: 0.65,
  actionTargetWeight: 2.4,
  holdBias: 1.15,
  fatiguePerTick: 0.025,
  switchingCost: 0.8,
  hysteresisMargin: 0.55,
  sustainedTicks: 2,
  mutationPreemptionThreshold: 1.2,
  closeCallWindow: 0.08,
});

interface MutableAttentionState {
  tick: number;
  focusTargetId: string | null;
  boundActionTargetId: string | null;
  focusHeldTicks: number;
  switchCount: number;
  preemptionCount: number;
  scores: AttentionSnapshot["scores"];
}

export class AttentionController implements AttentionPort {
  readonly #random: RandomSourcePort;
  readonly #configuration: AttentionConfiguration;
  readonly #competitionDuration = new Map<string, number>();
  #state: MutableAttentionState = {
    tick: 0,
    focusTargetId: null,
    boundActionTargetId: null,
    focusHeldTicks: 0,
    switchCount: 0,
    preemptionCount: 0,
    scores: [],
  };

  constructor(random: RandomSourcePort, configuration: AttentionConfiguration = DEFAULT_ATTENTION_CONFIGURATION) {
    this.#random = random;
    this.#configuration = { ...configuration };
  }

  bindActionTarget(targetId: string | null): void {
    this.#state.boundActionTargetId = targetId;
    // A newly committed action owns the primary focus immediately.  This is
    // an ordinary target-binding switch, not a mutation preemption.  Keeping
    // the previous focus here made an unrelated object remain the event
    // owner until a later scoring tick and contaminated post-change
    // preemption evidence.
    if (targetId !== null && this.#state.focusTargetId !== targetId) {
      const previous = this.#state.focusTargetId;
      this.#state.focusTargetId = targetId;
      this.#state.focusHeldTicks = 0;
      this.#state.switchCount += previous === null ? 0 : 1;
      this.#competitionDuration.clear();
    }
  }

  update(tick: number, candidates: readonly AttentionCandidate[]): AttentionSnapshot {
    const safeCandidates = candidates.filter((candidate) => candidate.safe);
    const scored = safeCandidates.map((candidate) => ({
      candidate,
      score: this.#score(candidate),
    }));
    this.#state.tick = tick;
    this.#state.scores = scored.map(({ candidate, score }) => ({ targetId: candidate.targetId, score }));
    if (scored.length === 0) return this.snapshot();

    const current = scored.find(({ candidate }) => candidate.targetId === this.#state.focusTargetId) ?? null;
    const strongestMutation = scored
      .filter(({ candidate }) => candidate.targetId !== this.#state.focusTargetId)
      .filter(({ candidate }) => this.#mutationStrength(candidate) >= this.#configuration.mutationPreemptionThreshold)
      .sort((left, right) => right.score.total - left.score.total || left.candidate.targetId.localeCompare(right.candidate.targetId))[0];

    let selectedTarget = current?.candidate.targetId ?? this.#selectCloseCall(scored).candidate.targetId;
    let preempted = false;
    if (strongestMutation !== undefined) {
      selectedTarget = strongestMutation.candidate.targetId;
      preempted = true;
    } else if (current !== null) {
      const competitors = scored
        .filter(({ candidate }) => candidate.targetId !== current.candidate.targetId)
        .filter(({ score }) => score.total >= current.score.total + this.#configuration.hysteresisMargin);
      const best = competitors.length === 0 ? null : this.#selectCloseCall(competitors);
      if (best !== null) {
        const duration = (this.#competitionDuration.get(best.candidate.targetId) ?? 0) + 1;
        this.#competitionDuration.set(best.candidate.targetId, duration);
        if (duration >= this.#configuration.sustainedTicks) selectedTarget = best.candidate.targetId;
      }
    }

    const previous = this.#state.focusTargetId;
    if (previous === selectedTarget) {
      this.#state.focusHeldTicks += 1;
    } else {
      this.#state.focusTargetId = selectedTarget;
      this.#state.focusHeldTicks = 1;
      this.#state.switchCount += previous === null ? 0 : 1;
      if (preempted) this.#state.preemptionCount += 1;
      this.#competitionDuration.clear();
    }
    for (const targetId of [...this.#competitionDuration.keys()]) {
      if (!scored.some(({ candidate }) => candidate.targetId === targetId)) this.#competitionDuration.delete(targetId);
    }
    return this.snapshot();
  }

  snapshot(): AttentionSnapshot {
    return structuredClone({
      tick: this.#state.tick,
      focusTargetId: this.#state.focusTargetId,
      boundActionTargetId: this.#state.boundActionTargetId,
      focusHeldTicks: this.#state.focusHeldTicks,
      switchCount: this.#state.switchCount,
      preemptionCount: this.#state.preemptionCount,
      scores: this.#state.scores,
    });
  }

  restore(snapshot: AttentionSnapshot): void {
    this.#state = structuredClone(snapshot);
    this.#competitionDuration.clear();
  }

  #score(candidate: AttentionCandidate): AttentionScoreBreakdown {
    const isCurrent = candidate.targetId === this.#state.focusTargetId;
    const targetBinding = this.#configuration.actionTargetWeight * candidate.actionTargetBinding;
    const change = this.#configuration.changeWeight * candidate.changeMagnitude;
    const derivative = this.#configuration.derivativeWeight * candidate.changeDerivative;
    const predictionDeviationKnown = candidate.predictionDeviation !== null;
    const predictionDeviation = this.#configuration.predictionDeviationWeight * (candidate.predictionDeviation ?? 0);
    const goalRelevance = this.#configuration.goalWeight * candidate.goalRelevance;
    const novelty = this.#configuration.noveltyWeight * candidate.novelty;
    const holdBias = isCurrent ? this.#configuration.holdBias : 0;
    const fatigue = isCurrent ? this.#configuration.fatiguePerTick * this.#state.focusHeldTicks : 0;
    const switchCost = isCurrent || this.#state.focusTargetId === null ? 0 : this.#configuration.switchingCost;
    return {
      targetBinding,
      change,
      derivative,
      predictionDeviation,
      predictionDeviationKnown,
      goalRelevance,
      novelty,
      holdBias,
      fatigue,
      switchCost,
      total: targetBinding + change + derivative + predictionDeviation + goalRelevance + novelty
        + holdBias - fatigue - switchCost,
    };
  }

  #mutationStrength(candidate: AttentionCandidate): number {
    return candidate.changeMagnitude + candidate.changeDerivative + 0.5 * (candidate.predictionDeviation ?? 0);
  }

  #selectCloseCall<T extends { readonly score: AttentionScoreBreakdown }>(candidates: readonly T[]): T {
    const ordered = [...candidates].sort((left, right) => right.score.total - left.score.total);
    const maximum = ordered[0]!.score.total;
    const close = ordered.filter(({ score }) => maximum - score.total <= this.#configuration.closeCallWindow);
    if (close.length === 1) return close[0]!;
    const weights = close.map(({ score }) => Math.exp(score.total - maximum));
    let draw = this.#random.next() * weights.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < close.length; index += 1) {
      draw -= weights[index]!;
      if (draw <= 0) return close[index]!;
    }
    return close[close.length - 1]!;
  }
}
