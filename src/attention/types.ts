export interface AttentionCandidate { targetId: string; safe: boolean; changeMagnitude: number; changeDerivative: number;
  predictionDeviation: number | null; goalRelevance: number; novelty: number; actionTargetBinding: number; }
export interface AttentionScoreBreakdown { targetBinding: number; change: number; derivative: number;
  predictionDeviation: number; predictionDeviationKnown: boolean; goalRelevance: number; novelty: number; holdBias: number;
  fatigue: number; switchCost: number; total: number; }
export interface AttentionSnapshot { tick: number; focusTargetId: string | null; boundActionTargetId: string | null;
  focusHeldTicks: number; switchCount: number; preemptionCount: number;
  scores: readonly { targetId: string; score: AttentionScoreBreakdown }[]; }
export interface RandomSourcePort { next(): number; }
export interface AttentionPort { bindActionTarget(id: string | null): void; update(tick: number, candidates: readonly AttentionCandidate[]): AttentionSnapshot; snapshot(): AttentionSnapshot; }
