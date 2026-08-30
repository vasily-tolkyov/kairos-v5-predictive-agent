import test from 'node:test';
import assert from 'node:assert/strict';
import { JointTransientControlFieldV2 } from '../src/control/field.js';
import type { JointControlDrivesV2, JointControlOperationV2, JointControlSiteInputV2,
  JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import { canonical } from '../src/util.js';

const config: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260829,
  branchCapacity: 8, stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

const zero: JointControlDrivesV2 = {
  goal: 0, evidence: 0, condition: 0, rollout: 0,
  unknown: 0, attention: 0, novelty: 0, habit: 0,
};
const site = (siteId: string, operation: JointControlOperationV2, nodeId: string,
  drives: Partial<JointControlDrivesV2>, hardEligible = true): JointControlSiteInputV2 => ({
  siteId, operation, nodeId, hardEligible, drives: { ...zero, ...drives },
});

test('joint competitors never cross-pair an operation from one node with another node', () => {
  const definitions = [
    site('predict-A', 'predict-branch', 'A', { goal: 1, evidence: 1, condition: 1, unknown: 1 }),
    site('expand-B', 'expand-condition', 'B', { goal: 1, evidence: 1, unknown: 1, attention: 1 }),
    site('execute-C', 'execute', 'C', { goal: 1, evidence: 1, condition: 1, rollout: 1, habit: 1 }),
  ];
  const allowed = new Map(definitions.map(value => [value.siteId, `${value.operation}:${value.nodeId}`]));
  for (let phase = 0; phase < 32; phase++) {
    const field = new JointTransientControlFieldV2({ ...config, seed: config.seed + phase });
    field.setGoal('g');
    field.replaceSites(definitions);
    const decision = field.decide();
    assert.equal(decision.converged, true, `phase ${phase} did not converge`);
    assert.equal(`${decision.operation}:${decision.nodeId}`, allowed.get(decision.siteId!),
      `phase ${phase} constructed a cross-paired decision`);
  }
});

test('multiple operation classes have simultaneous drive and physical inputs change the winner', () => {
  const run = (surprise: boolean) => {
    const field = new JointTransientControlFieldV2(config);
    field.setGoal('g');
    field.replaceSites([
      site('execute-n', 'execute', 'n', {
        goal: 1, evidence: 1, condition: 1, rollout: 1,
        unknown: surprise ? 1 : 0, attention: surprise ? 1 : 0,
      }),
      site('observe-n', 'observe-public', 'n', {
        goal: .5, unknown: surprise ? 1 : .1, attention: surprise ? 1 : 0, novelty: .5,
      }),
      site('recall-root', 'recall-effect', 'root', { goal: .4, unknown: .2 }),
    ]);
    const before = field.snapshot();
    return { before, decision: field.decide() };
  };
  const ordinary = run(false), surprised = run(true);
  assert(ordinary.before.sites.filter(value => value.effectiveDrive > 0).length >= 2);
  assert.equal(ordinary.decision.operation, 'execute');
  assert.equal(surprised.decision.operation, 'observe-public');
});

test('fixed seed produces byte-identical joint trajectories and a single persistent winner', () => {
  const run = () => {
    const field = new JointTransientControlFieldV2(config);
    field.setGoal('g');
    field.replaceSites(Array.from({ length: 8 }, (_, index) => site(
      `observe-${index}`, 'observe-public', `node-${index}`,
      { goal: 1, unknown: 1, attention: 1, novelty: 1 },
    )));
    return { decision: field.decide(), snapshot: field.snapshot() };
  };
  const first = run(), second = run();
  assert.equal(canonical(first), canonical(second));
  assert.equal(first.decision.converged, true);
  assert.equal(first.decision.operation, 'observe-public');
  const ordered = [...first.snapshot.sites].sort((left, right) => right.activation - left.activation);
  assert(ordered[0]!.activation >= config.winnerThreshold);
  assert(ordered[0]!.activation - ordered[1]!.activation >= config.winnerMargin);
});

test('zero input naturally decays, never falls back to argmax, and prunes only after silence', () => {
  const field = new JointTransientControlFieldV2(config);
  field.setGoal('g');
  field.replaceSites([site('execute-n', 'execute', 'n', {
    goal: 1, evidence: 1, condition: 1, rollout: 1,
  })]);
  assert.equal(field.decide().operation, 'execute');
  const active = field.snapshot().sites[0]!.activation;
  assert(active >= config.winnerThreshold);

  field.replaceSites([]);
  const immediatelyAfterRemoval = field.snapshot();
  assert.equal(immediatelyAfterRemoval.sites.length, 1, 'site was deleted instead of allowed to decay');
  assert.equal(immediatelyAfterRemoval.sites[0]!.hardEligible, false);
  assert.equal(immediatelyAfterRemoval.sites[0]!.activation, active);

  const firstDecayDecision = field.decide();
  assert.equal(firstDecayDecision.operation, 'unknown');
  assert.equal(firstDecayDecision.converged, false);
  for (let pass = 0; pass < 2 && field.snapshot().sites.length > 0; pass++) field.decide();
  assert.equal(field.snapshot().sites.length, 0, 'silent site did not decay and prune');
});

test('habit input cannot bypass hard eligibility', () => {
  const field = new JointTransientControlFieldV2(config);
  field.setGoal('g');
  field.replaceSites([
    site('ineligible-execute', 'execute', 'n', {
      goal: 1, evidence: 1, condition: 1, rollout: 1, habit: 1,
    }, false),
    site('eligible-observe', 'observe-public', 'root', {
      goal: .5, unknown: 1, novelty: 1,
    }),
  ]);
  const decision = field.decide();
  assert.equal(decision.operation, 'observe-public');
  assert.equal(decision.siteId, 'eligible-observe');
});
