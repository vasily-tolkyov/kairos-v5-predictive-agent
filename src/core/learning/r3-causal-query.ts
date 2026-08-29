import type { R3FactorMatch, Vec3 } from "../contracts.js";
import { distanceSquared3 } from "../vector.js";
import type { R3CausalEvaluation } from "./causal-contrast.js";

const OUTCOME_MATCH_RADIUS = 0.32;

export interface CausalCandidateScore {
  readonly causalScore: number;
  readonly multiplier: number;
  readonly matchedRelationIds: readonly string[];
  readonly matchedRelations: readonly {
    readonly relationId: string;
    readonly signedOutcomeEvidence: number;
    readonly relationReliability: number;
    readonly contextMatch: number;
    readonly residualMatch: number;
    readonly relationApplicability: number;
  }[];
}

export interface ExperimentProposal {
  readonly contextAnchorIds: readonly string[];
  readonly targetRelationIds: readonly string[];
  readonly uncertainty: number;
  readonly interventionBudget: number;
}

export interface ExperimentPlannerPort {
  propose(matches: readonly R3FactorMatch[], uncertainty: number): ExperimentProposal | null;
}

export class R3CausalQuery {
  score(candidate: Vec3, evaluation: R3CausalEvaluation, experienceAnchorId?: string): CausalCandidateScore {
    const anchored = experienceAnchorId === undefined
      ? undefined
      : evaluation.scoreByExperienceAnchor?.get(experienceAnchorId);
    if (anchored !== undefined) {
      const match = evaluation.matches.find((candidateMatch) => candidateMatch.matchId === anchored.matchId);
      const causalScore = anchored.score;
      const relationId = match?.relationId ?? anchored.matchId;
      return {
        causalScore,
        multiplier: Math.exp(Math.max(-4, Math.min(4, causalScore))),
        matchedRelationIds: [relationId],
        matchedRelations: [{
          relationId,
          signedOutcomeEvidence: causalScore,
          relationReliability: match?.relationReliability ?? 0,
          contextMatch: match?.contextMatch ?? 0,
          residualMatch: match?.residualMatch ?? 0,
          relationApplicability: match?.relationApplicability ?? 0,
        }],
      };
    }
    const perMatch = new Map<string, { score: number; distance: number }>();
    for (const [key, coordinate] of evaluation.outcomeCoordinates) {
      const separator = key.indexOf("\u0000");
      const matchId = separator < 0 ? key : key.slice(0, separator);
      const distance = distanceSquared3(candidate, coordinate);
      const current = perMatch.get(matchId);
      if (current === undefined || distance < current.distance) {
        perMatch.set(matchId, {
          score: distance <= OUTCOME_MATCH_RADIUS * OUTCOME_MATCH_RADIUS
            ? (evaluation.scoreByOutcomeMode.get(key) ?? 0)
            : 0,
          distance,
        });
      }
    }
    if (perMatch.size === 0) {
      return { causalScore: 0, multiplier: 1, matchedRelationIds: [], matchedRelations: [] };
    }
    const causalScore = [...perMatch.values()].reduce((sum, item) => sum + item.score, 0);
    const clamped = Math.max(-4, Math.min(4, causalScore));
    const matchedRelations = [...perMatch.entries()]
      .filter(([, item]) => item.score !== 0)
      .map(([matchId, item]) => {
        const match = evaluation.matches.find((candidate) => candidate.matchId === matchId);
        return {
          relationId: match?.relationId ?? matchId,
          signedOutcomeEvidence: item.score,
          relationReliability: match?.relationReliability ?? 0,
          contextMatch: match?.contextMatch ?? 0,
          residualMatch: match?.residualMatch ?? 0,
          relationApplicability: match?.relationApplicability ?? 0,
        };
      })
      .sort((left, right) => left.relationId.localeCompare(right.relationId));
    return {
      causalScore,
      multiplier: Math.exp(clamped),
      matchedRelationIds: [...new Set(matchedRelations.map((item) => item.relationId))].sort(),
      matchedRelations,
    };
  }
}
