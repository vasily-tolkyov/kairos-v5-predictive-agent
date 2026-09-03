import { SplitMix64 } from '../core/random.js';
import { assert } from '../util.js';
import type { GoalEvaluationV1, JointControlDecisionV2, JointControlDrivesV2,
  JointControlOperationV2, JointControlSiteInputV2, JointControlSiteSnapshotV2,
  JointTransientControlFieldConfigV2, JointTransientControlFieldSnapshotV2 } from './contracts.js';

interface JointSiteState {
  siteId: string;
  operation: JointControlOperationV2;
  nodeId: string;
  hardEligible: boolean;
  productiveGrounding?: JointControlSiteInputV2['productiveGrounding'];
  drives: JointControlDrivesV2;
  activation: number;
  zeroEvidenceSteps: number;
  effectiveDrive: number;
}

export const JOINT_CONTROL_OPERATIONS_V2: readonly JointControlOperationV2[] = [
  'recall-effect', 'compare-condition', 'predict-branch', 'expand-condition',
  'execute', 'observe-public', 'finish-verified', 'finish-unknown',
];

const OPERATION_SET = new Set<JointControlOperationV2>(JOINT_CONTROL_OPERATIONS_V2);
const ZERO_DRIVES: JointControlDrivesV2 = {
  goal: 0, evidence: 0, condition: 0, rollout: 0,
  unknown: 0, attention: 0, novelty: 0, habit: 0,
};
const RECURRENT_EXCITATION = 0.70;
const LATERAL_INHIBITION = 2.00;
const phi = (value: number): number => Math.max(0, Math.tanh(value));
const clampInput = (value: number): number => Math.max(0, Math.min(1, value));
const hasEvidence = (drives: JointControlDrivesV2): boolean =>
  Object.values(drives).some(value => value > 0);

const normalizedDrives = (drives: JointControlDrivesV2): JointControlDrivesV2 => ({
  goal: clampInput(drives.goal), evidence: clampInput(drives.evidence),
  condition: clampInput(drives.condition), rollout: clampInput(drives.rollout),
  unknown: clampInput(drives.unknown), attention: clampInput(drives.attention),
  novelty: clampInput(drives.novelty), habit: clampInput(drives.habit),
});

/**
 * Maps domain-neutral signals onto an operation's input. This is the fixed syntax of
 * the control field, not a task sequence: every eligible operation-by-node site is
 * evaluated at the same time and participates in one competition.
 */
const operationDrive = (operation: JointControlOperationV2, d: JointControlDrivesV2): number => {
  switch (operation) {
    case 'recall-effect':
      return clampInput(.50 * d.goal + .30 * d.unknown + .10 * d.attention + .10 * d.evidence);
    case 'compare-condition':
      return clampInput(.45 * d.evidence + .30 * d.unknown + .15 * d.attention + .10 * d.goal);
    case 'predict-branch':
      return clampInput(.35 * d.evidence + .25 * d.condition + .25 * d.goal + .15 * d.unknown);
    case 'expand-condition':
      return clampInput(.40 * d.unknown + .30 * d.evidence + .20 * d.goal + .10 * d.attention);
    case 'execute':
      // Unknown has opposite meanings at the two generic execution boundaries.
      // With physical evidence it is a missing-condition penalty; without physical
      // evidence it is the only domain-neutral pressure for a legal exploration.
      // This is derived solely from the evidence drive and does not inspect an
      // action kind, object type, target, or task stage.
      return clampInput(.25 * d.goal + .20 * d.evidence + .20 * d.condition + .25 * d.rollout
        + .25 * d.novelty + .15 * d.unknown * (1 - d.evidence)
        + d.habit - .20 * d.unknown * d.evidence - .35 * d.attention);
    case 'observe-public':
      // A currently satisfied goal still needs a second real observation.  Goal
      // drive therefore distinguishes that verification site from equally novel
      // generic observation offers without introducing a task-specific stage.
      return clampInput(.25 * d.unknown + .10 * d.attention + .10 * d.novelty + .55 * d.goal);
    case 'finish-verified':
      return clampInput(.70 * d.goal + .30 * d.evidence - .50 * d.unknown - .50 * d.attention);
    case 'finish-unknown':
      return clampInput(.60 * d.unknown + .20 * d.goal + .20 * d.evidence - .40 * d.rollout);
  }
};

/**
 * A transient continuous-time field whose indivisible competitors are operation-by-node
 * sites. It cannot pair an operation winner with a different branch winner.
 */
export class JointTransientControlFieldV2 {
  readonly #sites = new Map<string, JointSiteState>();
  #random: SplitMix64;
  #goalId: string | null = null;
  #cycle = 0;
  #interrupted = false;
  #lastDecision: JointControlDecisionV2 | null = null;
  #lastGoalEvaluation: GoalEvaluationV1 | null = null;

  constructor(readonly config: JointTransientControlFieldConfigV2) {
    assert(config.version === 'JointTransientControlFieldConfigV2' && config.branchCapacity === 8
      && config.stepSize === 0.02 && config.noiseSigma === 0.01
      && config.maximumIntegrationSteps === 500 && config.winnerThreshold === 0.65
      && config.winnerMargin === 0.10 && config.winnerPersistenceSteps === 20
      && config.inactivePruneThreshold === 0.0001 && config.inactivePruneSteps === 50
      && config.predictionSeeds === 24 && config.predictionSteps === 180,
    'invalid-joint-control-field-configuration');
    this.#random = new SplitMix64(BigInt(config.seed));
  }

  setGoal(goalId: string): void {
    this.reset();
    this.#goalId = goalId;
  }

  setGoalEvaluation(evaluation: GoalEvaluationV1): void {
    assert(this.#goalId === evaluation.goalId, 'joint-control-field-goal-evaluation-mismatch');
    this.#lastGoalEvaluation = structuredClone(evaluation);
  }

  replaceSites(sites: readonly JointControlSiteInputV2[]): void {
    const nodeIds = new Set(sites.map(site => site.nodeId));
    assert(nodeIds.size <= this.config.branchCapacity, 'joint-control-field-branch-capacity-exhausted');
    assert(new Set(sites.map(site => site.siteId)).size === sites.length, 'joint-control-field-duplicate-site-id');

    const incoming = new Set(sites.map(site => site.siteId));
    for (const state of this.#sites.values()) {
      if (incoming.has(state.siteId)) continue;
      state.hardEligible = false;
      state.drives = ZERO_DRIVES;
      state.effectiveDrive = 0;
    }

    for (const site of sites) {
      assert(site.siteId.length > 0 && site.nodeId.length > 0, 'joint-control-field-empty-site-identity');
      assert(OPERATION_SET.has(site.operation), 'joint-control-field-unknown-operation');
      const drives = normalizedDrives(site.drives);
      const prior = this.#sites.get(site.siteId);
      const effectiveDrive = site.hardEligible ? operationDrive(site.operation, drives) : 0;
      if (prior) {
        Object.assign(prior, {
          operation: site.operation, nodeId: site.nodeId, hardEligible: site.hardEligible,
          productiveGrounding: site.productiveGrounding
            ? structuredClone(site.productiveGrounding) : undefined,
          drives, effectiveDrive,
        });
        if (site.hardEligible && hasEvidence(drives)) prior.zeroEvidenceSteps = 0;
      } else {
        this.#sites.set(site.siteId, {
          siteId: site.siteId, operation: site.operation, nodeId: site.nodeId,
          hardEligible: site.hardEligible,
          productiveGrounding: site.productiveGrounding
            ? structuredClone(site.productiveGrounding) : undefined,
          drives, activation: 0,
          zeroEvidenceSteps: 0, effectiveDrive,
        });
      }
    }
  }

  interrupt(): void {
    this.#interrupted = true;
    for (const state of this.#sites.values()) {
      if (!state.hardEligible) continue;
      state.drives = { ...state.drives, unknown: 1, attention: 1 };
      state.effectiveDrive = operationDrive(state.operation, state.drives);
      state.zeroEvidenceSteps = 0;
    }
  }

  clearInterrupt(): void { this.#interrupted = false; }

  /**
   * A completed body operation starts a new reality epoch.  Activations from
   * the prior public state must not carry an already selected action across
   * that boundary and suppress a newly available verification or branch.
   * The goal, learned habit input and random stream remain intact.
   */
  crossRealityBoundary(): void {
    for (const state of this.#sites.values()) {
      state.activation = 0;
      state.zeroEvidenceSteps = 0;
    }
    this.#lastDecision = null;
  }

  decide(): JointControlDecisionV2 {
    assert(this.#goalId, 'joint-control-field-goal-not-set');
    this.#cycle++;
    let priorSiteId: string | null = null;
    let persistence = 0;

    for (let step = 1; step <= this.config.maximumIntegrationSteps; step++) {
      this.#stepSites();
      this.#pruneInactiveSites();
      const winner = this.#winner();
      if (winner?.siteId === priorSiteId) persistence++;
      else {
        priorSiteId = winner?.siteId ?? null;
        persistence = winner ? 1 : 0;
      }
      if (winner && persistence >= this.config.winnerPersistenceSteps) {
        this.#lastDecision = {
          operation: winner.operation, nodeId: winner.nodeId, siteId: winner.siteId,
          converged: true, integrationSteps: step,
          reason: 'joint-field-threshold-and-dominance-persisted',
        };
        return structuredClone(this.#lastDecision);
      }
    }

    this.#lastDecision = {
      operation: 'unknown', nodeId: null, siteId: null, converged: false,
      integrationSteps: this.config.maximumIntegrationSteps, reason: 'joint-field-did-not-converge',
    };
    return structuredClone(this.#lastDecision);
  }

  #stepSites(): void {
    const states = [...this.#sites.values()].sort((left, right) => left.siteId.localeCompare(right.siteId));
    const previous = states.map(state => state.activation);
    for (let index = 0; index < states.length; index++) {
      const state = states[index]!;
      const old = previous[index]!;
      const inhibition = state.hardEligible ? previous.reduce((sum, value, other) => {
        if (other === index || !states[other]!.hardEligible) return sum;
        return sum + phi(value);
      }, 0) : 0;
      const drive = state.hardEligible
        ? state.effectiveDrive + RECURRENT_EXCITATION * phi(old) - LATERAL_INHIBITION * inhibition
        : 0;
      state.activation = old + this.config.stepSize * (-old + drive)
        + (state.hardEligible && state.effectiveDrive > 0
          ? this.config.noiseSigma * Math.sqrt(this.config.stepSize) * this.#random.gaussian()
          : 0);

      const externallySilent = !state.hardEligible || !hasEvidence(state.drives);
      if (externallySilent && Math.abs(state.activation) < this.config.inactivePruneThreshold)
        state.zeroEvidenceSteps++;
      else state.zeroEvidenceSteps = 0;
    }
  }

  #pruneInactiveSites(): void {
    for (const [siteId, state] of this.#sites) {
      if ((!state.hardEligible || !hasEvidence(state.drives))
        && state.zeroEvidenceSteps >= this.config.inactivePruneSteps)
        this.#sites.delete(siteId);
    }
  }

  #winner(): JointSiteState | null {
    const sorted = [...this.#sites.values()].filter(state => state.hardEligible)
      .sort((left, right) => right.activation - left.activation || left.siteId.localeCompare(right.siteId));
    const first = sorted[0];
    if (!first || first.activation < this.config.winnerThreshold) return null;
    const second = sorted[1];
    if (second && first.activation - second.activation < this.config.winnerMargin) return null;
    return first;
  }

  snapshot(): JointTransientControlFieldSnapshotV2 {
    const sites: JointControlSiteSnapshotV2[] = [...this.#sites.values()]
      .sort((left, right) => left.siteId.localeCompare(right.siteId))
      .map(state => ({
        siteId: state.siteId, operation: state.operation, nodeId: state.nodeId,
        hardEligible: state.hardEligible,
        ...(state.productiveGrounding
          ? { productiveGrounding: structuredClone(state.productiveGrounding) } : {}),
        drives: structuredClone(state.drives),
        activation: state.activation, zeroEvidenceSteps: state.zeroEvidenceSteps,
        effectiveDrive: state.effectiveDrive,
      }));
    return {
      version: 'JointTransientControlFieldSnapshotV2', goalId: this.#goalId, cycle: this.#cycle,
      interrupted: this.#interrupted, sites,
      lastDecision: this.#lastDecision ? structuredClone(this.#lastDecision) : null,
      lastGoalEvaluation: this.#lastGoalEvaluation ? structuredClone(this.#lastGoalEvaluation) : null,
    };
  }

  reset(): void {
    this.#sites.clear();
    this.#goalId = null;
    this.#cycle = 0;
    this.#interrupted = false;
    this.#lastDecision = null;
    this.#lastGoalEvaluation = null;
    this.#random = new SplitMix64(BigInt(this.config.seed));
  }
}
