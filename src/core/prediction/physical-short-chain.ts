import type { Observation } from '../../contracts.js';
import type { BranchPredictionV1, EffectRecallCandidateV1, GoalEvaluationV1, GroundedGoalV1,
  HypotheticalPublicStateV1, PhysicalShortChainV1 } from '../../control/contracts.js';

export type PhysicalSeedPredictionV1 = (candidate: EffectRecallCandidateV1,
  state: Observation | HypotheticalPublicStateV1, goal: GroundedGoalV1,
  evaluation: GoalEvaluationV1, seeds: readonly number[]) => BranchPredictionV1;

/** Evaluate a path nominated by the existing physical dependency graph.
 * 24 lineages, not a Cartesian resampling tree. The only future inputs are
 * real registered terminal readouts; goal/evidence never fill absent values.
 * This function has no body, workspace, writer or branch-selection authority. */
export function predictPhysicalShortChainV1(candidates: readonly EffectRecallCandidateV1[],
  observation: Observation, goal: GroundedGoalV1, evaluation: GoalEvaluationV1,
  predict: PhysicalSeedPredictionV1): PhysicalShortChainV1 {
  if (candidates.length === 0 || candidates.length > 3) throw new RangeError('short-chain-capacity-is-one-to-three-actions');
  type Lane = { seed: number; status: 'goal-reached' | 'partial' | 'unknown';
    steps: Array<PhysicalShortChainV1['lanes'][number]['steps'][number]>; reason: string };
  const lanes: Lane[] = Array.from({ length: 24 }, (_, i) => ({ seed: i + 1,
    status: 'partial', steps: [], reason: 'prediction-horizon-ended' }));
  let binding: PhysicalShortChainV1['binding'] = null;
  const unknown = new Set<string>();
  for (const [depth, candidate] of candidates.entries()) {
    const groups = new Map<string, Lane[]>();
    for (const lane of lanes) {
      if (lane.status !== 'partial') continue;
      const key = lane.steps.at(-1)?.output.physicalReadout?.readoutId ?? 'real-observation';
      const group = groups.get(key) ?? []; group.push(lane); groups.set(key, group);
    }
    for (const group of groups.values()) {
      const input = group[0]!.steps.at(-1)?.output ?? observation;
      const seeds = group.map(lane => lane.seed + depth * 24);
      const prediction = predict(candidate, input, goal, evaluation, seeds);
      binding ??= prediction.binding ?? null;
      const evidence = prediction.currentEvidence ?? candidate.evidence;
      const supported = evidence.r1.active && evidence.r2.active && evidence.r2a.productionEligible
        && evidence.r2a.applicability >= .75;
      for (const reason of prediction.unknown) unknown.add(reason);
      for (const lane of group) {
        const seed = lane.seed + depth * 24;
        const sample = prediction.prediction.samples.find(value => value.seed === seed);
        const output = prediction.nextStates.find(value => value.physicalReadout?.sourceSeed === seed);
        if (!supported || !sample || sample.status !== 'reached' || !output?.physicalReadout) {
          lane.status = 'unknown';
          lane.reason = !supported ? 'current-step-physical-condition-unsupported'
            : sample?.reason ?? prediction.unknown[0] ?? 'physical-readout-not-reached';
          unknown.add(lane.reason); continue;
        }
        lane.steps.push({ candidateId: candidate.candidateId, actionCue: candidate.actionCue,
          inputReadoutId: 'version' in input ? input.physicalReadout?.readoutId ?? null : null,
          output, sample, evidence });
        // Counts are not borrowed between stochastic lanes. A root goal may
        // finish only when this very terminal decoded its desired public value.
        const targetReached = output.goalEvaluation?.goalId === goal.id
          && output.goalEvaluation.status === 'satisfied';
        if (targetReached) { lane.status = 'goal-reached'; lane.reason = 'physical-terminal-goal-reached'; }
      }
    }
  }
  return { version: 'PhysicalShortChainV1', candidatePath: candidates.map(c => c.candidateId), binding,
    lanes, progressSampleCount: lanes.filter(lane => lane.status === 'goal-reached').length,
    totalSampleCount: lanes.length,
    horizonObservationSteps: Math.max(0, ...lanes.flatMap(lane => lane.steps.map(step =>
      step.output.physicalReadout?.horizonObservationSteps ?? 0))),
    unknown: [...unknown].sort() };
}
