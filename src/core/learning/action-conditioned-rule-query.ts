import type {
  ActionConditionedTraceReference,
  BasinActivation,
  CoactivationTrace,
  PredictionQueryEvidenceV2,
  QueryContribution,
  QueryResult,
  R1TraceReference,
} from "../contracts.js";
import { PhysicalMedium3D } from "../physics/physical-medium.js";
import type { R3CausalEvaluation } from "./causal-contrast.js";
import { R3CausalQuery, type CausalCandidateScore } from "./r3-causal-query.js";

export const MINIMUM_ACTION_RULE_EVIDENCE = 8;

export interface ActionConditionedQueryResult {
  readonly query: QueryResult;
  readonly evidence: PredictionQueryEvidenceV2;
}

interface Candidate {
  readonly trace: CoactivationTrace;
  readonly basin: BasinActivation;
  readonly r2Activation: number;
  readonly baseWeight: number;
  readonly causal: CausalCandidateScore;
  readonly finalWeight: number;
}

function traceKey(trace: R1TraceReference): string {
  return `${trace.pageId}\u0000${trace.traceId}`;
}

function basinKey(basin: BasinActivation): string {
  return `${basin.pageId}\u0000${[...basin.memberVisitIds].sort().join("\u0000")}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function zeroEvidence(eligibleHistoricalCount: number, activeR1Count: number): PredictionQueryEvidenceV2 {
  return {
    version: "PredictionQueryEvidenceV2",
    eligibleHistoricalCount,
    activeR1Count,
    activeR2Count: 0,
    eligibleLinkCoverage: 0,
    distinctR2BasinCount: 0,
    r2IndependentSupport: 0,
    r2PhysicalSupport: 0,
    r2aMatchedCoverage: 0,
    relationReliability: 0,
    contextMatch: 0,
    residualMatch: 0,
    querySpecificR2aApplicability: 0,
    conditionalWeightConcentration: 0,
    coreEvidenceSupport: 0,
    calibratedProbability: false,
  };
}

/**
 * Read-only intervention-conditioned lookup.  It never projects a motion
 * prefix.  The action ledger constrains which real trace references are
 * eligible; R2, R2A/R3, recovery, and coactivation state then determine the
 * conditional distribution.
 */
export class ActionConditionedRuleQuery {
  readonly #r3 = new R3CausalQuery();

  query(
    r2: PhysicalMedium3D,
    r2PageId: string,
    eligibleTraces: readonly ActionConditionedTraceReference[],
    coactivations: readonly CoactivationTrace[],
    isR1TraceActive: (trace: R1TraceReference) => boolean,
    causalEvaluation: R3CausalEvaluation,
    causalEnabled = true,
  ): ActionConditionedQueryResult {
    const eligibleByTrace = new Map(eligibleTraces.map((trace) => [traceKey(trace), trace]));
    const activeR1Count = eligibleTraces.reduce(
      (count, trace) => count + (isR1TraceActive(trace) ? 1 : 0),
      0,
    );
    if (eligibleTraces.length === 0 || activeR1Count === 0) {
      return {
        query: { contributions: [], r2Basins: [], r3Matches: causalEnabled ? causalEvaluation.matches : [] },
        evidence: zeroEvidence(eligibleTraces.length, activeR1Count),
      };
    }

    const candidates: Candidate[] = [];
    for (const trace of coactivations) {
      const eligible = eligibleByTrace.get(traceKey(trace.r1Trace));
      if (eligible === undefined || eligible.experienceAnchorId !== trace.experienceAnchorId) continue;
      if (!isR1TraceActive(trace.r1Trace) || trace.currentStrength <= 0) continue;
      // A real R2 visit is already the opaque identity deposited into the
      // medium. Resolve its current connected basin exactly. Nearest-centroid
      // matching can silently choose another basin when a chained component's
      // centroid lies farther than one radius from an endpoint.
      const basin = r2.basinContainingVisit(r2PageId, trace.coactivationId);
      if (basin === null || !basin.memberVisitIds.includes(trace.coactivationId)
        || basin.queryContribution <= 0 || basin.decayFraction <= 0) continue;
      const r2Activation = basin.queryContribution * Math.log1p(basin.support);
      const causal = causalEnabled
        ? this.#r3.score(trace.r2Coordinate, causalEvaluation, trace.experienceAnchorId)
        : { causalScore: 0, multiplier: 1, matchedRelationIds: [], matchedRelations: [] };
      const baseWeight = r2Activation * trace.currentStrength;
      const finalWeight = baseWeight * causal.multiplier;
      if (baseWeight <= 1e-18 || finalWeight <= 1e-18) continue;
      candidates.push({ trace, basin, r2Activation, baseWeight, causal, finalWeight });
    }

    if (candidates.length === 0) {
      return {
        query: { contributions: [], r2Basins: [], r3Matches: causalEnabled ? causalEvaluation.matches : [] },
        evidence: zeroEvidence(eligibleTraces.length, activeR1Count),
      };
    }

    const finalTotal = candidates.reduce((sum, item) => sum + item.finalWeight, 0);
    const baseTotal = candidates.reduce((sum, item) => sum + item.baseWeight, 0);
    const contributions: QueryContribution[] = candidates.map((item) => ({
      coactivationId: item.trace.coactivationId,
      r1Trace: { ...item.trace.r1Trace },
      r2Activation: item.r2Activation,
      r3CausalScore: item.causal.causalScore,
      causalMultiplier: item.causal.multiplier,
      matchedRelationIds: [...item.causal.matchedRelationIds],
      coactivationStrength: item.trace.currentStrength,
      weight: item.finalWeight / finalTotal,
    }));

    const uniqueBasins = new Map<string, { readonly basin: BasinActivation; readonly weight: number }>();
    for (const item of candidates) {
      const key = basinKey(item.basin);
      const current = uniqueBasins.get(key);
      if (current === undefined || item.baseWeight > current.weight) {
        uniqueBasins.set(key, { basin: item.basin, weight: item.baseWeight });
      }
    }
    const unique = [...uniqueBasins.values()];
    const independentSupport = unique.reduce((sum, item) => sum + item.basin.support, 0);
    const decayWeightedIndependentSupport = unique.reduce(
      (sum, item) => sum + item.basin.support * clamp01(item.basin.decayFraction),
      0,
    );
    const eligibleLinkCoverage = candidates.length / eligibleTraces.length;
    const r2PhysicalSupport = eligibleLinkCoverage
      * Math.min(1, decayWeightedIndependentSupport / MINIMUM_ACTION_RULE_EVIDENCE);

    const matched = candidates.map((candidate) => {
      const relation = [...candidate.causal.matchedRelations]
        .sort((left, right) => right.relationApplicability - left.relationApplicability
          || left.relationId.localeCompare(right.relationId))[0] ?? null;
      return { candidate, relation };
    }).filter((item) => item.relation !== null);
    const matchedWeight = matched.reduce((sum, item) => sum + item.candidate.baseWeight, 0);
    const r2aMatchedCoverage = baseTotal <= 0 ? 0 : matchedWeight / baseTotal;
    const componentMean = (selector: (relation: NonNullable<typeof matched[number]["relation"]>) => number): number => (
      matchedWeight <= 0 ? 0 : matched.reduce(
        (sum, item) => sum + item.candidate.baseWeight * selector(item.relation!),
        0,
      ) / matchedWeight
    );
    const relationReliability = componentMean((relation) => relation.relationReliability);
    const contextMatch = componentMean((relation) => relation.contextMatch);
    const residualMatch = componentMean((relation) => relation.residualMatch);
    const meanApplicability = componentMean((relation) => relation.relationApplicability);
    const querySpecificR2aApplicability = clamp01(r2aMatchedCoverage * meanApplicability);
    const conditionalWeightConcentration = contributions.reduce(
      (sum, contribution) => sum + contribution.weight ** 2,
      0,
    );
    const coreEvidenceSupport = Math.min(
      clamp01(eligibleLinkCoverage),
      clamp01(r2PhysicalSupport),
      querySpecificR2aApplicability,
    );
    const evidence: PredictionQueryEvidenceV2 = {
      version: "PredictionQueryEvidenceV2",
      eligibleHistoricalCount: eligibleTraces.length,
      activeR1Count,
      activeR2Count: candidates.length,
      eligibleLinkCoverage: clamp01(eligibleLinkCoverage),
      distinctR2BasinCount: unique.length,
      r2IndependentSupport: independentSupport,
      r2PhysicalSupport: clamp01(r2PhysicalSupport),
      r2aMatchedCoverage: clamp01(r2aMatchedCoverage),
      relationReliability: clamp01(relationReliability),
      contextMatch: clamp01(contextMatch),
      residualMatch: clamp01(residualMatch),
      querySpecificR2aApplicability,
      conditionalWeightConcentration: clamp01(conditionalWeightConcentration),
      coreEvidenceSupport,
      calibratedProbability: false,
    };
    return {
      query: {
        contributions,
        r2Basins: unique.map((item) => item.basin),
        r3Matches: causalEnabled ? causalEvaluation.matches : [],
      },
      evidence,
    };
  }
}
