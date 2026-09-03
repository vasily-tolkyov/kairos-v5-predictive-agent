import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { cueIdentity } from '../src/events.js';
import { minecraftMultilevelGoalChainCasesV1 } from
  '../src/evaluation/minecraft-multilevel-goal-chain-v1.js';
import {
  auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1,
  executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1,
  minecraftHierarchicalContinuousBridgeCurriculumIdentityLiveV1,
  minecraftHierarchicalContinuousBridgeCurriculumLiveV1,
} from '../src/evaluation/minecraft-hierarchical-continuous-bridge-curriculum-live-v1.js';

test('continuous bridge curriculum separates formation, prospective validation, and intervention', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  assert.equal(plan.formation.length, 88);
  assert.equal(plan.validations.length, 16);
  assert.equal(plan.interventions.length, 40);
  assert.equal(plan.fragments.length, 144);
  assert.equal(plan.fragments.reduce((sum, value) => sum + value.atoms.length, 0), 404);
  assert.equal(plan.expectedFinalR1Atoms, 772);
  assert.equal(plan.expectedFinalR2Events, 312);
  assert.equal(new Set(plan.fragments.map(value => value.fragmentId)).size, 144);
  assert.equal(new Set(plan.fragments.map(value => value.layout.id)).size, 144);
  assert.equal(plan.validations.every(value => value.phase === 'prospective-validation'
    && value.matchedIntervention === null), true);
  for (let index = 0; index < plan.interventions.length; index += 2) {
    const baseline = plan.interventions[index]!, intervention = plan.interventions[index + 1]!;
    assert.equal(baseline.matchedIntervention!.member, 'baseline');
    assert.equal(intervention.matchedIntervention!.member, 'intervention');
    assert.equal(baseline.matchedIntervention!.pairId, intervention.matchedIntervention!.pairId);
  }
  assert.match(minecraftHierarchicalContinuousBridgeCurriculumIdentityLiveV1(), /^[a-f0-9]{64}$/);
  assert.deepEqual(plan, minecraftHierarchicalContinuousBridgeCurriculumLiveV1());
});

test('a guided continuous fragment closes every real body atom before physical deposition begins', async () => {
  const fragment = minecraftHierarchicalContinuousBridgeCurriculumLiveV1().formation[0]!;
  const actions: Action[] = fragment.atoms.map(atom => ({ kind: atom.cue.kind as Action['kind'],
    parameters: { ...atom.cue.parameters }, ...(atom.cue.targetRole === null ? {}
      : { targetId: 'public-button' }) }));
  const trace: string[] = [], observed: RealEvent[] = [];
  const frame = (sequence: number): Observation => ({ sequence, activeSeconds: sequence * .05,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { grounded: true } },
    objects: [{ id: 'public-button', type: 'stone_button', relativePosition: [0, .5, -3],
      properties: { powered: false } }], targetId: 'public-button', contextId: 'guided-order-test' });
  let bodyIndex = 0;
  const body = { session: { id: 'guided-order-session' },
    execute: async (action: Action) => {
      const index = bodyIndex++, atom = fragment.atoms[index]!;
      trace.push(`body:${index}`);
      const frames = [frame(index * 2 + 1), frame(index * 2 + 2)];
      const event: RealEvent = { version: 'RealEventV5', id: `guided-order-event-${index}`,
        cue: structuredClone(atom.cue), frames, trackedIds: ['self', 'public-button'],
        bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence,
          endSequence: frames[1]!.sequence, terminationReason: 'stable' },
        provenance: 'executed-real-body', complete: true };
      return { result: event.bodyResult!, event };
    } };
  const compute = { call: async (method: string, value?: RealEvent) => {
    trace.push(`compute:${method}`);
    if (method === 'observe') {
      observed.push(value!);
      return { representationRejection: null };
    }
    assert.equal(method, 'snapshot');
    return { r2Store: { events: [{ completion: 'complete', sourceEventIds: observed.map(event => event.id),
      atomIds: observed.map(event => `atom:${event.id}`), learningEligible: true,
      physicalStatus: 'deposited', eventId: 'guided-order-r2' }] } };
  } };
  const prepared = { actions, scopes: actions.map(() => ({ version: 'ActionObservationScopeV1' as const,
    referencedPublicObjectIds: ['public-button'] })), fixtureCommandCountAtSeal: 0,
    currentFixtureCommandCount: () => 0, assertAtomOutcome: () => undefined };
  const result = await executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1(
    compute as never, body as never, fragment, prepared);
  assert.deepEqual(trace.slice(0, actions.length), actions.map((_action, index) => `body:${index}`));
  assert.deepEqual(trace.slice(actions.length, actions.length * 2), actions.map(() => 'compute:observe'));
  assert.equal(result.r2EventId, 'guided-order-r2');
});

test('continuous fragments never contain the wired door result or a complete route-to-door solution', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  assert.equal(plan.fullSolutionTrainingFragments, 0);
  for (const fragment of plan.fragments) {
    assert.equal(fragment.wiredDoorEffectPresent, false);
    assert.equal(fragment.fullSolutionDisclosed, false);
    assert.ok(fragment.atoms.length === 2 || fragment.atoms.length === 3);
    assert.equal(fragment.atoms.some(value => value.expectedEffect.includes('open-door')), false);
    // Interactions exist only as disconnected local fragments.  No fragment
    // combines lateral/jump navigation with interaction.
    const kinds = fragment.atoms.map(value => value.cue.kind);
    if (kinds.includes('interact'))
      assert.equal(kinds.includes('jump') || kinds.filter(value => value === 'move').length > 1, false);
  }
  const audit = auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(plan);
  assert.equal(audit.passed, true);
  assert.equal(audit.wiredDoorEffectFragments, 0);
  assert.equal(audit.fullSolutionFragments, 0);
});

test('continuous curriculum layouts do not reuse any of the twelve heldout layouts', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  const heldoutOrigins = new Set(minecraftMultilevelGoalChainCasesV1.map(value =>
    `${value.fixture.origin[0]},${value.fixture.origin[2]}`));
  assert.equal(plan.fragments.some(value => heldoutOrigins.has(
    `${value.layout.originX},${value.layout.originZ}`)), false);
  assert.equal(auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(plan)
    .trainingHeldoutLayoutOverlap, 0);
});

test('look and approach fragments teach interaction affordances without a wired result', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  for (const family of ['look-plus-acquire-disconnected-interact',
    'look-minus-acquire-disconnected-interact',
    'forward-approach-disconnected-interact'] as const) {
    const members = plan.formation.filter(value => value.family === family);
    assert.equal(members.length, 8);
    for (const member of members) {
      assert.deepEqual(member.atoms.map(value => value.cue.kind),
        family.startsWith('forward') ? ['move', 'interact', 'observe']
          : ['look', 'interact', 'observe']);
      assert.equal(member.atoms[1]!.expectedEffect,
        'disconnected-interaction-no-door-transition');
    }
  }
});

test('each side direction has separate formation, validation and intervention fragments', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  for (const direction of ['left', 'right'] as const) {
    const members = plan.fragments.filter(value => value.direction === direction);
    assert.equal(members.length, 46);
    assert.equal(members.filter(value => value.phase === 'pattern-formation').length, 24);
    assert.equal(members.filter(value => value.phase === 'prospective-validation').length, 6);
    assert.equal(members.filter(value => value.phase === 'matched-intervention').length, 16);
    for (const variant of ['side-A-', 'side-B-', 'side-C-']) assert.equal(
      members.filter(value => value.phase === 'prospective-validation'
        && value.family.startsWith(variant)).length, 2);
    const pairs = new Map<string, typeof members>();
    for (const member of members.filter(value => value.matchedIntervention)) {
      const pair = member.matchedIntervention!;
      pairs.set(pair.pairId, [...(pairs.get(pair.pairId) ?? []), member]);
    }
    assert.equal(pairs.size, 8);
    for (const pair of pairs.values()) {
      assert.equal(pair.length, 2);
      assert.deepEqual(new Set(pair.map(value => value.matchedIntervention!.member)),
        new Set(['baseline', 'intervention']));
      assert.equal(new Set(pair.map(value => value.layout.facing)).size, 1);
      assert.equal(new Set(pair.map(value => value.layout.neutralMarkerMask)).size, 1);
      assert.equal(new Set(pair.map(value => value.matchedIntervention!.branchAtomIndex)).size, 1);
      assert.equal(new Set(pair.map(value =>
        value.matchedIntervention!.exactNextActionIdentity)).size, 1);
    }
  }
});

test('A and C preserve the same first-action topology and R2 action prefix', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  for (const direction of ['left', 'right'] as const) {
    for (let context = 0; context < 8; context++) {
      const a = plan.formation.find(value => value.direction === direction
        && value.family === 'side-A-clear-then-forward-clear' && value.contextOrdinal === context)!;
      const c = plan.formation.find(value => value.direction === direction
        && value.family === 'side-C-clear-then-forward-extension-blocked'
        && value.contextOrdinal === context)!;
      assert.deepEqual(a.firstAtomTopology, c.firstAtomTopology);
      assert.equal(c.postFirstActionForwardExtension, 'blocked');
      assert.equal(a.postFirstActionForwardExtension, 'open');
      assert.equal(cueIdentity(a.atoms[0]!.cue), cueIdentity(c.atoms[0]!.cue));
      assert.equal(a.atoms[0]!.expectedEffect, c.atoms[0]!.expectedEffect);
      assert.equal(cueIdentity(a.atoms[1]!.cue), cueIdentity(c.atoms[1]!.cue));
      assert.notEqual(a.atoms[1]!.expectedEffect, c.atoms[1]!.expectedEffect);
    }
  }
  const audit = auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(plan);
  assert.equal(audit.sideACFirstAtomTopologyMismatchCount, 0);
  assert.equal(audit.sideACR2CommonPrefixMismatchCount, 0);
});

test('jump supplement is a direct effect family with four matched interventions', () => {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  const jump = plan.fragments.filter(value => value.family.startsWith('jump-'));
  assert.equal(jump.length, 28);
  assert.equal(jump.filter(value => value.phase === 'pattern-formation').length, 16);
  assert.equal(jump.filter(value => value.phase === 'prospective-validation').length, 4);
  assert.equal(jump.filter(value => value.phase === 'matched-intervention').length, 8);
  assert.equal(jump.every(value => value.atoms.length === 2
    && value.atoms[0]!.cue.kind === 'jump' && value.atoms[1]!.cue.kind === 'observe'), true);
  const pairs = new Map<string, typeof jump>();
  for (const member of jump.filter(value => value.matchedIntervention)) {
    const id = member.matchedIntervention!.pairId;
    pairs.set(id, [...(pairs.get(id) ?? []), member]);
  }
  assert.equal(pairs.size, 4);
  assert.equal([...pairs.values()].every(value => value.length === 2), true);
  assert.equal(jump.filter(value => value.matchedIntervention).every(value =>
    value.matchedIntervention!.branchAtomIndex === 0), true);
});
