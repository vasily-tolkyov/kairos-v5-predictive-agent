import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Observation, RealEvent } from '../src/contracts.js';
import type { HierarchicalMemorySnapshotV1 } from '../src/hierarchical-memory.js';
import { cueIdentity } from '../src/events.js';
import { DeterministicTokenFieldEncoder } from '../src/core/learning/token-field.js';
import {
  BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1,
  BUTTON_DOOR_NEW_BODY_SETTLE_TICKS_LIVE_V1,
  MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1,
  assertButtonDoorInteractionEventLiveV1,
  assertButtonDoorEventPartCoverageLiveV1,
  buttonDoorFixtureForceloadCommandLiveV1,
  buttonDoorInitialYawOffsetLiveV1,
  buttonDoorLookButtonPresentLiveV1,
  buttonDoorPublicCircuitDifferenceLiveV1,
  type ExpectedButtonDoorR2ChainLiveV1,
  exactCompleteTwoAtomButtonDoorR2LiveV1,
  minecraftHierarchicalButtonDoorPlanLiveV1,
  minecraftHierarchicalButtonDoorScopeLiveV1,
  selectButtonDoorOpaqueInterventionAtBranchLiveV1,
  verifyInitializedButtonDoorFoundationLiveV1,
} from '../src/evaluation/minecraft-hierarchical-button-door-live-v1.js';

test('button-door neutral context markers are public but outside the centre ray', () => {
  assert.equal(BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1.length, 4);
  assert.deepEqual([...new Set(BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1.map(value => value.lateral))],
    [-3, 3]);
  for (const marker of BUTTON_DOOR_NEUTRAL_MARKER_OFFSETS_LIVE_V1) {
    const verticalFromEye = marker.y + .5 - 65.62;
    const distance = Math.hypot(marker.lateral, marker.forwardDistance, verticalFromEye);
    assert(distance <= 8, 'neutral marker left public observation range');
    assert(marker.forwardDistance / distance > .70, 'neutral marker left public view cone');
    assert.notEqual(marker.lateral, 0, 'neutral marker entered the centre interaction ray');
    assert.notEqual(marker.lateral * 7, 2 * marker.forwardDistance,
      'neutral marker occluded the public iron-door ray');
  }
});

test('look intervention uses one pose and isolates public button presence', () => {
  assert.equal(buttonDoorInitialYawOffsetLiveV1('look-acquire'), -15);
  assert.equal(buttonDoorInitialYawOffsetLiveV1('look-miss'), -15);
  assert.equal(buttonDoorInitialYawOffsetLiveV1('wired-open'), 0);
  assert.equal(buttonDoorInitialYawOffsetLiveV1('disconnected-no-open'), 0);
  assert.equal(buttonDoorLookButtonPresentLiveV1('look-acquire'), true);
  assert.equal(buttonDoorLookButtonPresentLiveV1('look-miss'), false);
  assert.equal(buttonDoorLookButtonPresentLiveV1('wired-open'), true);
});

test('each distant button-door arena is force-loaded before fixture commands', () => {
  const layout = minecraftHierarchicalButtonDoorPlanLiveV1().foundation[0]!.layout;
  assert.equal(buttonDoorFixtureForceloadCommandLiveV1(layout),
    `forceload add ${layout.originX - 16} ${layout.originZ - 16}`
      + ` ${layout.originX + 16} ${layout.originZ + 16}`);
});

test('button-door curriculum is exactly 128 foundation atoms and 32 matched intervention atoms', () => {
  const plan = minecraftHierarchicalButtonDoorPlanLiveV1();
  assert.equal(plan.initialExperience, 'empty');
  assert.equal(plan.foundation.length, 64);
  assert.equal(plan.interventions.length, 16);
  assert.equal(plan.foundation.length * 2, plan.foundationR1Atoms);
  assert.equal(plan.interventions.length * 2, plan.interventionR1Atoms);
  assert.equal(plan.frozenR1Atoms, 160);
  assert.equal(plan.fullSolutionTrainingFragments, 0);
  for (const arm of ['look-acquire', 'look-miss', 'wired-open',
    'disconnected-no-open'] as const) {
    const episodes = plan.foundation.filter(value => value.arm === arm);
    assert.equal(episodes.length, 16);
    assert(new Set(episodes.map(value => value.layout.id)).size >= 8);
  }
  for (const comparison of ['look-acquire-vs-miss', 'wired-vs-disconnected'] as const) {
    const episodes = plan.interventions.filter(value => value.comparison === comparison);
    assert.equal(episodes.length, 8);
    for (const pair of [0, 1, 2, 3]) {
      const members = episodes.filter(value => value.pairIndex === pair);
      assert.equal(members.length, 2);
      assert.equal(new Set(members.map(value => value.layout.id)).size, 1);
    }
  }
});

test('every action scope explicitly retains the public button and public door', () => {
  assert.deepEqual(minecraftHierarchicalButtonDoorScopeLiveV1('block:1,2,3', 'block:4,5,6'), {
    version: 'ActionObservationScopeV1',
    referencedPublicObjectIds: ['block:1,2,3', 'block:4,5,6', 'block:4,6,6'],
  });
  assert.throws(() => minecraftHierarchicalButtonDoorScopeLiveV1('block:1,2,3', 'block:1,2,3'));
});

function frame(sequence: number, doorOpen: boolean): Observation {
  return { sequence, activeSeconds: sequence / 20, targetId: 'block:0,64,3', contextId: 'c',
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { onGround: true } },
    objects: [
      { id: 'block:0,64,3', type: 'stone_button', relativePosition: [0, 0, -3],
        properties: { powered: false } },
      { id: 'block:2,64,7', type: 'iron_door', relativePosition: [2, 0, -7],
        properties: { open: doorOpen, half: 'lower' } },
      { id: 'block:2,65,7', type: 'iron_door', relativePosition: [2, 1, -7],
        properties: { open: doorOpen, half: 'upper' } },
    ] };
}

function interactionEvent(openAfter: boolean): RealEvent {
  return { version: 'RealEventV5', id: `event-${openAfter}`, cue: { kind: 'interact',
    parameters: {}, targetRole: 'stone_button' }, frames: [frame(1, false), frame(2, openAfter)],
    trackedIds: ['block:0,64,3', 'block:2,64,7'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'interact', parameters: {}, targetId: 'block:0,64,3' },
      executed: true, status: 'completed', startSequence: 1, endSequence: 2 } };
}

test('interaction audit distinguishes real wired door transition from an all-false control', () => {
  assert.doesNotThrow(() => assertButtonDoorEventPartCoverageLiveV1(interactionEvent(true)));
  const missingUpper = structuredClone(interactionEvent(true));
  for (const eventFrame of missingUpper.frames as Observation[])
    (eventFrame.objects as unknown as { type: string }[]).splice(
      eventFrame.objects.findIndex(value => value.type === 'iron_door' && value.properties.half === 'upper'), 1);
  assert.throws(() => assertButtonDoorEventPartCoverageLiveV1(missingUpper), /missing-public-door-half/);
  assert.doesNotThrow(() => assertButtonDoorInteractionEventLiveV1(interactionEvent(true),
    'block:0,64,3', 'block:2,64,7', 'false-to-true'));
  assert.doesNotThrow(() => assertButtonDoorInteractionEventLiveV1(interactionEvent(false),
    'block:0,64,3', 'block:2,64,7', 'remains-false'));
  assert.throws(() => assertButtonDoorInteractionEventLiveV1(interactionEvent(false),
    'block:0,64,3', 'block:2,64,7', 'false-to-true'), /missing-real-open-transition/);
});

test('matched wired/disconnected public prestate may differ only in real circuit objects', () => {
  const wired = frame(1, false), disconnected = frame(2, false);
  const circuitId = 'block:0,64,4';
  const withCircuit = (base: Observation, type: string): Observation => ({ ...base,
    objects: [...base.objects, { id: circuitId, type, relativePosition: [0, 0, -4], properties: {} }] });
  assert.deepEqual(buttonDoorPublicCircuitDifferenceLiveV1(withCircuit(wired, 'dropper'),
    withCircuit(disconnected, 'quartz_block'), [circuitId], 'block:0,64,3', 'block:2,64,7'),
  [circuitId]);
  assert.throws(() => buttonDoorPublicCircuitDifferenceLiveV1(withCircuit(wired, 'dropper'),
    withCircuit(disconnected, 'quartz_block'), [], 'block:0,64,3', 'block:2,64,7'),
  /changed-non-circuit/);
});

function exactTwoAtomFixture(): { snapshot: HierarchicalMemorySnapshotV1;
  expected: ExpectedButtonDoorR2ChainLiveV1[] } {
  const plan = minecraftHierarchicalButtonDoorPlanLiveV1();
  const expected = plan.foundation.map(value => ({ ...value,
    sourceEventIds: [`event-${value.episode}-action`, `event-${value.episode}-observe`] as [string, string],
    orderedExperienceIdentities: [`cue-${value.episode}-action`, `cue-${value.episode}-observe`] as [string, string] }));
  const annotations = expected.flatMap(value => value.sourceEventIds)
    .map((eventId, index) => ({ eventId, atomId: `atom-${index}` }));
  const atom = new Map(annotations.map(value => [value.eventId, value.atomId]));
  const events = expected.map((value, index) => ({ eventId: `r2-${index}`,
    sourceEventIds: value.sourceEventIds, atomIds: value.sourceEventIds.map(id => atom.get(id)!),
    orderedExperienceIdentities: value.orderedExperienceIdentities, completion: 'complete',
    learningEligible: true, boundaryReason: 'public-process-resolved' }));
  const snapshot = { annotations, writes: 128, r2Store: { events } } as unknown as HierarchicalMemorySnapshotV1;
  return { expected, snapshot };
}

test('foundation verification accepts exactly 64 ordered two-atom real R2 events', () => {
  const fixture = exactTwoAtomFixture();
  const events = verifyInitializedButtonDoorFoundationLiveV1(fixture.snapshot, fixture.expected);
  assert.equal(events.length, 64);
  assert(events.every(value => value.sourceEventIds.length === 2));
  const swapped = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  (swapped.r2Store.events[0]!.sourceEventIds as string[]).reverse();
  assert.throws(() => exactCompleteTwoAtomButtonDoorR2LiveV1(swapped, fixture.expected[0]!),
    /exact-source-match-count/);
});

test('cross-object selector keeps exact full arms and accepts one opaque circuit factor', () => {
  const targetIds = Array.from({ length: 16 }, (_, index) => `wired-${index}`);
  const contrastIds = Array.from({ length: 16 }, (_, index) => `disconnected-${index}`);
  const perception = (value: number) => { const result = new Float64Array(256); result[0] = value; return result; };
  const encoder = new DeterministicTokenFieldEncoder();
  encoder.fit([...targetIds.map(() => perception(1)), ...contrastIds.map(() => perception(0))]);
  encoder.freeze();
  const evidence = [...targetIds.map(eventId => ({ eventId, value: 1 })),
    ...contrastIds.map(eventId => ({ eventId, value: 0 }))].map(item => ({ eventId: item.eventId,
    atomPrePerceptions: [[...perception(item.value)], Array(256).fill(0)] }));
  const cue = cueIdentity({ kind: 'interact', parameters: {}, targetRole: 'stone_button' });
  const snapshot = { tokenEncoder: encoder.exportState(), r2a: {
    patterns: [{ patternId: 'wired-pattern', memberEventIds: targetIds },
      { patternId: 'disconnected-pattern', memberEventIds: contrastIds }],
    factors: [{ factorId: 'circuit-factor', tokenIndex: 0, tolerance: .1 }],
    relations: [{ relationId: 'circuit-relation', targetPatternId: 'wired-pattern',
      contrastPatternIds: ['disconnected-pattern'], branchAtomIndex: 0,
      exactNextActionIdentity: cue, factorIds: ['circuit-factor'],
      predictiveSinceEventId: 'after-foundation', grade: 'predictive-stable' }], evidence,
  } } as unknown as HierarchicalMemorySnapshotV1;
  const selected = selectButtonDoorOpaqueInterventionAtBranchLiveV1(snapshot,
    targetIds, contrastIds, 0, cue);
  assert.deepEqual(selected.changedFactorIds, ['circuit-factor']);
  assert.equal(selected.targetArmCoverage, 1);
  const incomplete = structuredClone(snapshot) as HierarchicalMemorySnapshotV1;
  (incomplete.r2a!.patterns[0]!.memberEventIds as string[]).pop();
  assert.throws(() => selectButtonDoorOpaqueInterventionAtBranchLiveV1(incomplete,
    targetIds, contrastIds, 0, cue), /one-complete-stable-pattern:0/);
});

test('heldout protocol exposes only the final door goal boundary, never an action sequence', async () => {
  assert.equal(BUTTON_DOOR_NEW_BODY_SETTLE_TICKS_LIVE_V1, 60);
  assert.equal(MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1.length, 4);
  assert.deepEqual(MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1
    .map(value => value.yawOffsetDegrees), [0, 0, -15, -15]);
  assert(MINECRAFT_HIERARCHICAL_BUTTON_DOOR_HELDOUTS_LIVE_V1.every(value => value.actionBudget === 12));
  const source = await readFile('src/evaluation/minecraft-hierarchical-button-door-live-v1.ts', 'utf8');
  assert.match(source, /executeRealAtom\(body, action, scope, 'reset'\)[\s\S]*submitRealAtom\(compute, first\.event\)[\s\S]*kind: 'observe'[\s\S]*scope, 'continuous'/);
  assert.match(source, /prepareButtonDoorFixture\(commands, body, specification, offset, true\)/,
    'matched interventions must retain outcome-neutral public context variation');
  assert.match(source, /registerMatchedInterventionProtocol[\s\S]*for \(const specification of plan\.interventions\)/);
  assert.match(source, /const fixtureCommandCountAtGoal = caseCommands\.seal\(\)[\s\S]*root-goal-injection[\s\S]*runGoal\(goal\)/);
  assert.match(source, /new ControlHabitWeightsV1\(\)/);
  assert.match(source, /auditFrozenPhysicalActionEvidenceLiveV1/);
  assert.match(source, /realButtonDoorHeldoutEventPassed/);
  assert.doesNotMatch(source, /parentFrames|resumeParent|body-target-affordance|actionSequence/);
});
