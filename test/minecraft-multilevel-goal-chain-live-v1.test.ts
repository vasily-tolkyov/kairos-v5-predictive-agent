import test from 'node:test';
import assert from 'node:assert/strict';
import type { Observation } from '../src/contracts.js';
import type { MemorySnapshot } from '../src/memory.js';
import type { PhysicalControlSnapshotV2 } from '../src/control/controller.js';
import { foundationQualificationCasesV1, minecraftMultilevelGoalChainCasesV1 } from
  '../src/evaluation/minecraft-multilevel-goal-chain-v1.js';
import {
  UniqueButtonDoorReadinessGateV1,
  extractGoalChainExecutedActionEvidenceV1,
  foundationQualificationCoverageLiveV1,
  goalChainCaseInitialPositionLiveV1,
  goalChainLatchFixtureCommandsLiveV1,
  goalChainObstacleGeometryLiveV1,
  materializeFoundationEpisodeLiveV1,
  materializeFoundationGoalV1,
  materializeLiveGoalChainCaseV1,
  multilevelRunnerBoundaryFlagsV1,
  publicSelectionAimPointLiveV1,
} from '../src/evaluation/minecraft-multilevel-goal-chain-live-v1.js';
import { minecraftMultilevelGuidedFixtureCommandsLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1 } from
  '../src/evaluation/minecraft-multilevel-guided-training-live-v1.js';
import { cueFor } from '../src/events.js';

function observation(sequence: number, buttonId: string, doorId: string,
  extra: Observation['objects'] = []): Observation {
  return { sequence, activeSeconds: sequence * .05,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: {} },
    objects: [{ id: buttonId, type: 'stone_button', relativePosition: [0, 1, -2], properties: {} },
      { id: doorId, type: 'iron_door', relativePosition: [0, 1, -6],
        properties: { half: 'lower', open: false } }, ...extra],
    targetId: buttonId, contextId: `context-${sequence}` };
}

test('live target materialization binds the sealed case to MinecraftBody block identity', () => {
  const specification = minecraftMultilevelGoalChainCasesV1[0]!;
  const live = materializeLiveGoalChainCaseV1(specification);
  assert.equal(specification.doorObjectId, 'goal-chain-A-01:door');
  assert.equal(live.doorObjectId, 'block:402,65,401');
  assert.equal(live.rootGoal.id, specification.rootGoal.id);
  assert.equal(live.rootGoal.expression.kind, 'predicate');
  if (live.rootGoal.expression.kind !== 'predicate') throw new Error('unreachable');
  assert.deepEqual(live.rootGoal.expression.predicate.subject,
    { kind: 'public-object', id: 'block:402,65,401', expectedType: 'iron_door' });
  assert.equal(live.rootGoal.expression.predicate.observable, 'properties.open');
  assert.equal(live.rootGoal.expression.predicate.comparator, 'equals');
  if (live.rootGoal.expression.predicate.comparator !== 'equals') throw new Error('unreachable');
  assert.equal(live.rootGoal.expression.predicate.target, true);
});

test('goal injection readiness needs the same unique button and lower door for five real ticks', () => {
  const gate = new UniqueButtonDoorReadinessGateV1('block:button', 'block:door');
  for (let sequence = 10; sequence < 15; sequence++)
    assert.equal(gate.accept(observation(sequence, 'block:button', 'block:door')).ready, false);
  const ready = gate.accept(observation(15, 'block:button', 'block:door'));
  assert.equal(ready.ready, true);
  assert.equal(ready.stableTicks, 5);
  const hidden = gate.accept(observation(16, 'block:other-button', 'block:door'));
  assert.equal(hidden.ready, false);
  assert.equal(hidden.reason, 'ambiguous-or-hidden');
  const command = gate.accept(observation(17, 'block:button', 'block:door', [{
    id: 'block:command', type: 'command_block', relativePosition: [1, 1, 1], properties: {},
  }]));
  assert.equal(command.ready, false);
  assert.equal(command.reason, 'command-block-visible');
});

test('heldout aiming uses the public vanilla outline even when the button has no collision shape', () => {
  const point = publicSelectionAimPointLiveV1([10, 64, 20], {
    name: 'stone_button', shapes: [],
    getProperties: () => ({ face: 'wall', facing: 'south', powered: false }),
  });
  assert.deepEqual(point, [10.5, 64.5, 20.0625]);
});

test('heldout latch is the proven vanilla dropper-container-comparator-turn, not a copper-bulb surrogate', () => {
  for (const specification of minecraftMultilevelGoalChainCasesV1) {
    const commands = goalChainLatchFixtureCommandsLiveV1(specification);
    assert(commands.some(command => command.includes('dropper[facing=north,triggered=false]')
      && command.includes('{Items:[{Slot:0b,id:"minecraft:cobblestone",count:1}]}')));
    assert(commands.some(command => command.includes('barrel[facing=north,open=false]')));
    assert(commands.some(command => command.includes('comparator[facing=south,mode=compare,powered=false]')));
    assert(commands.some(command => command.includes('repeater[delay=1,facing=west,locked=false,powered=false]')));
    assert(commands.some(command => command.includes('iron_door[facing=north,half=lower')));
    for (const component of specification.fixture.components.filter(value =>
      ['dropper', 'container', 'comparator', 'wire', 'repeater', 'door'].includes(value.role))) {
      const support = [specification.fixture.origin[0] + component.relativePosition[0],
        specification.fixture.origin[1] + component.relativePosition[1] - 1,
        specification.fixture.origin[2] + component.relativePosition[2]].join(' ');
      assert(commands.includes(`setblock ${support} minecraft:smooth_stone`),
        `${specification.id}:${component.role}:missing physical support`);
    }
    assert.equal(commands.some(command => command.includes('copper_bulb')), false);
    assert.equal(commands.some(command => /command_block|^execute\b|^function\b|^schedule\b/i.test(command)), false);
  }
});

test('heldout A/B/C geometry encodes the approved distance, low obstacle and mirrored side route', () => {
  const tierA = minecraftMultilevelGoalChainCasesV1.filter(value => value.tier === 'A');
  assert.equal(tierA.every(value => Math.abs(value.initialView.yawOffsetDegrees) === 15
    && value.initialView.buttonPubliclyVisible && value.initialView.distanceBand === 'middle'), true);
  for (const specification of tierA) {
    const initial = goalChainCaseInitialPositionLiveV1(specification);
    const button = specification.fixture.components.find(value => value.role === 'button')!;
    const absoluteButton = specification.fixture.origin.map((value, index) =>
      value + button.relativePosition[index]!) as [number, number, number];
    const point = publicSelectionAimPointLiveV1(absoluteButton, {
      name: 'stone_button', shapes: [],
      getProperties: () => ({ face: 'wall', facing: 'south', powered: false }),
    });
    const distance = Math.hypot(point[0] - initial[0], point[1] - (initial[1] + 1.62),
      point[2] - initial[2]);
    assert(distance > 4.5 && distance < 4.8, `${specification.id}:${distance}`);
    const lateral = initial[0] - point[0];
    assert.equal(Math.sign(specification.initialView.yawOffsetDegrees), -Math.sign(lateral),
      `${specification.id}:the offset must remain on the door-visible side of the public fan`);
  }

  for (const specification of minecraftMultilevelGoalChainCasesV1) {
    const initial = goalChainCaseInitialPositionLiveV1(specification);
    const door = specification.fixture.components.find(value => value.role === 'door')!;
    const doorMinimum = specification.fixture.origin.map((value, index) =>
      value + door.relativePosition[index]!) as [number, number, number];
    const eye = [initial[0], initial[1] + 1.62, initial[2]] as const;
    const nearest = eye.map((value, index) => Math.max(doorMinimum[index]!,
      Math.min(doorMinimum[index]! + 1, value))) as [number, number, number];
    const distance = Math.hypot(nearest[0] - eye[0], nearest[1] - eye[1], nearest[2] - eye[2]);
    assert(distance < 8, `${specification.id}:lower door lies outside the public ray range:${distance}`);
  }

  for (const specification of minecraftMultilevelGoalChainCasesV1.filter(value => value.tier === 'B')) {
    const geometry = goalChainObstacleGeometryLiveV1(specification);
    assert.equal(geometry.kind, 'one-block-low');
    if (geometry.kind !== 'one-block-low') throw new Error('unreachable');
    assert.equal(geometry.heightBlocks, 1);
    assert.equal(geometry.overheadClear, true);
    assert.equal(geometry.commands.length, 1);
    assert(geometry.commands[0]!.endsWith('minecraft:smooth_stone'));
  }

  const routes = minecraftMultilevelGoalChainCasesV1.filter(value => value.tier === 'C')
    .map(specification => goalChainObstacleGeometryLiveV1(specification));
  assert.deepEqual(routes.map(value => value.kind === 'mirrored-high-side-route' ? value.openSide : null),
    ['right', 'left', 'right', 'left']);
  for (const geometry of routes) {
    assert.equal(geometry.kind, 'mirrored-high-side-route');
    if (geometry.kind !== 'mirrored-high-side-route') throw new Error('unreachable');
    assert.equal(geometry.centralBarrier.block, 'iron_bars');
    assert.equal(geometry.centralBarrier.heightBlocks, 3);
    assert.equal(geometry.blockedSideBarrier.side === geometry.openSide, false);
    assert.equal(geometry.commands.length, 2);
  }
});

test('four ablations are runner-boundary flags and leave the full-system defaults intact', () => {
  assert.deepEqual(multilevelRunnerBoundaryFlagsV1('full-system'), {
    dependencyExpansionEnabled: true, r2aConnectedToControl: true,
    predictionCloneProgressGateEnabled: true, attentionDeviationInputEnabled: true,
  });
  assert.equal(multilevelRunnerBoundaryFlagsV1('dependency-expansion-disabled')
    .dependencyExpansionEnabled, false);
  assert.equal(multilevelRunnerBoundaryFlagsV1('r2a-isolated').r2aConnectedToControl, false);
  assert.equal(multilevelRunnerBoundaryFlagsV1('prediction-clone-progress-gate-disabled')
    .predictionCloneProgressGateEnabled, false);
  assert.equal(multilevelRunnerBoundaryFlagsV1('attention-deviation-input-disabled')
    .attentionDeviationInputEnabled, false);
});

test('foundation is exactly sixteen approved mechanisms by two unseen mode-specific fixtures', () => {
  assert.equal(foundationQualificationCasesV1.length, 32);
  const commandTexts = new Map<string, string[]>();
  for (const specification of foundationQualificationCasesV1) {
    const episode = materializeFoundationEpisodeLiveV1(specification);
    assert.equal(episode.mode, specification.mechanism);
    assert.equal(episode.layout.id, specification.layout.id);
    assert.equal(episode.layout.originX, specification.layout.origin[0]);
    assert.equal(episode.layout.originZ, specification.layout.origin[2]);
    const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
    const first: Observation = { sequence: 1, activeSeconds: .05,
      self: { position: geometry.bot, yaw: geometry.yaw, pitch: 0, properties: { onGround: true } },
      objects: specification.exactActionCue.targetRole === 'stone_button' ? [{ id: geometry.buttonId,
        type: 'stone_button', relativePosition: [0, 1, -3], properties: {} }] : [],
      targetId: specification.exactActionCue.targetRole === 'stone_button' ? geometry.buttonId : null,
      contextId: specification.layout.id };
    assert.deepEqual(cueFor({ ...episode.action,
      ...(episode.action.kind === 'interact' ? { targetId: geometry.buttonId } : {}) }, first),
    specification.exactActionCue);
    const commands = minecraftMultilevelGuidedFixtureCommandsLiveV1(episode, 'KairosBot').commands;
    commandTexts.set(specification.mechanism, [...(commandTexts.get(specification.mechanism) ?? []),
      commands.join('\n')]);
    const positiveTarget = specification.query.target === 'no-public-change'
      ? specification.query.counterfactualPositiveTarget : specification.query.target;
    if (positiveTarget) {
      const goal = materializeFoundationGoalV1(specification, geometry, positiveTarget);
      assert.equal(goal.id, `foundation-effect:${specification.id}:${positiveTarget}`);
    }
  }
  assert.equal(commandTexts.get('forward-blocked')!.every(text => text.includes('setblock')), true);
  assert.equal(commandTexts.get('jump-forward-blocked-low-roof-high-obstacle')!
    .every(text => text.includes('smooth_stone')), true);
  assert.equal(commandTexts.get('interact-wired-button-opens-iron-door')!
    .every(text => text.includes('redstone_wire') && text.includes('iron_door')), true);
  assert.equal(commandTexts.get('interact-visible-disconnected-button-no-door-change')!
    .every(text => text.includes('quartz_block') && text.includes('iron_door')), true);
});

test('foundation batch coverage rejects repeats and requires 32 unique public contexts', () => {
  const complete = foundationQualificationCasesV1.map((value, index) => ({ mechanism: value.mechanism,
    replicate: value.replicate, evidence: { publicContextId: `unseen-context-${index}` } }));
  assert.deepEqual(foundationQualificationCoverageLiveV1(complete), {
    modeCounts: Object.fromEntries([...new Set(complete.map(value => value.mechanism))]
      .map(mode => [mode, 2])),
    modeReplicatePairs: complete.map(value => `${value.mechanism}:${value.replicate}`).sort(),
    uniquePublicContextIds: 32, completeCartesianCoverage: true,
  });
  const repeatedContext = complete.map((value, index) => ({ ...value,
    evidence: { publicContextId: index === 31 ? 'unseen-context-0' : value.evidence.publicContextId } }));
  assert.equal(foundationQualificationCoverageLiveV1(repeatedContext).uniquePublicContextIds, 31);
  assert.equal(foundationQualificationCoverageLiveV1(complete.slice(1)).completeCartesianCoverage, false);
});

test('executed-action audit uses the selected runtime node and frozen provenance', () => {
  const evidence = { eventId: 'source-event-1', anchorId: 'anchor-1',
    r1: { pageId: 'r1-page', traceId: 'r1-trace', active: true },
    r2: { coordinate: [0, 0, 0] as const, active: true },
    r2a: { relationIds: ['relation-1'], applicability: 1, productionEligible: true } };
  const prediction = { prediction: { kind: 'hypothetical-prediction', support: 1,
    calibratedProbability: false, samples: [], evidence, unknown: [], mapSha256: 'map' },
    currentEvidence: evidence, validSampleCount: 8, progressSampleCount: 6,
    progressFraction: .75, nextStates: [], unknown: [] };
  const rootGoalId = 'iron-door-open:case';
  const snapshot = { version: 'PhysicalControlSnapshotV2',
    lastDecision: { operation: 'execute', nodeId: 'experienced:1', siteId: 'execute:experienced:1',
      converged: true, integrationSteps: 20, reason: 'winner' }, attentionDrive: 0,
    recentDispatches: [], field: {}, habits: {}, workspace: {
      version: 'ControlWorkspaceV2', goalId: rootGoalId, rootNodeId: 'root:case', epoch: 1,
      observationSequence: 20, observation: null, offers: [], goalEvaluation: null,
      nodes: [{ node: { nodeId: 'root:case', kind: 'root', createdEpoch: 0,
        createdObservationSequence: 10, goal: { version: 'GroundedGoalV1', id: rootGoalId,
          expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'door-open',
            subject: { kind: 'public-object', id: 'block:door', expectedType: 'iron_door' },
            observable: 'properties.open', comparator: 'equals', target: true } } } },
        condition: null, prediction: null, lastActionResult: null },
      { node: { nodeId: 'experienced:1', kind: 'experienced', createdEpoch: 0,
        createdObservationSequence: 10, objectiveNodeId: 'root:case', candidate: {
          candidateId: 'candidate-1', goalPredicateIds: ['door-open'],
          actionCue: { kind: 'interact', parameters: {}, targetRole: 'stone_button' },
          observedChanges: [], observedBefore: {}, evidence, unknown: [] } },
        condition: { requestId: 'condition', epoch: 1, observationSequence: 20,
          value: { matchedFactorIds: ['factor-1'], contradictedFactorIds: [],
            unknownFactorIds: [], applicability: 1, productionEligible: true },
          invalidatedBy: null, fresh: true },
        prediction: { requestId: 'prediction', epoch: 1, observationSequence: 20,
          value: prediction, invalidatedBy: null, fresh: true }, lastActionResult: null }],
      dependencies: [{ edgeId: 'edge-1', dependentNodeId: 'root:case',
        requiredNodeId: 'experienced:1', factorIds: ['factor-1'], kind: 'opaque-factor',
        createdEpoch: 1, createdObservationSequence: 20 }], pendingRequests: [],
      completedOperations: [], attentionNotices: [], lastFailure: null } } as unknown as PhysicalControlSnapshotV2;
  const baseline = { snapshot: { r2a: { hyperedges: [{ hyperedgeId: 'relation-1',
    factorIds: ['factor-1'] }] } } as unknown as MemorySnapshot,
    sourceAnnotationEventIds: new Set(['source-event-1']),
    sourceRelationIds: new Set(['relation-1']), sourceFactorIds: new Set(['factor-1']) };
  const rows = extractGoalChainExecutedActionEvidenceV1([
    { kind: 'joint-control-decision', value: snapshot },
    { kind: 'control-action-result', value: { offer: { action: { kind: 'interact',
      parameters: {}, targetId: 'block:button' } }, result: { executed: true,
      eventId: 'case-event-1' } } },
  ], baseline, rootGoalId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.dependencyDepth, 1);
  assert.equal(rows[0]!.rootRetained, true);
  assert.equal(rows[0]!.sourceFrozenBaseline, true);
  assert.deepEqual(rows[0]!.productionFactorIds, ['factor-1']);
  assert.deepEqual(rows[0]!.predictionClone,
    { validSampleCount: 8, progressSampleCount: 6, progressFraction: .75 });
});
