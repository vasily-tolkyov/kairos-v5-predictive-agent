import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, ActionCue, Observation, PublicObject, RealEvent } from '../src/contracts.js';
import type { EffectRecallCandidateV1, GroundedGoalV1, OpaqueFactorTransitionTraceV1,
  PhysicalEvidenceReferenceV1 } from '../src/control/contracts.js';
import { fileSha, sha } from '../src/util.js';
import { distributedEvidenceFixtureV3 } from './distributed-control-fixtures.js';
import { MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2,
  readFrozenPhysicalBaselineV2 } from '../src/evaluation/minecraft-joint-control-heldout-v2.js';
import { MINECRAFT_NOTE_RECURSIVE_DEPENDENCY_SOURCES_V1,
  MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1, SingleNoteZeroReadinessGateV1,
  auditNoteRecursiveGoalInjectionV1, extractNoteRecursiveTimelineEvidenceV1,
  independentFrozenBaselineCopyV1, noteRecursiveQualificationGoalV1,
  resolveNoteRecursiveActionBudgetV1, scoreNoteRecursiveQualificationV1,
  type NoteRecursiveTimelineRecordV1 } from '../src/evaluation/minecraft-note-recursive-qualification-v1.js';

const controlId = 'block:112,65,111';
const note = (value: string): PublicObject => ({ id: controlId, type: 'note_block',
  relativePosition: [0, 1, -3], properties: { note: value } });
const frame = (sequence: number, value: string, yaw = 0, targetId: string | null = controlId): Observation => ({
  sequence, activeSeconds: sequence * .05, objects: [note(value)], targetId,
  contextId: 'note-recursive-test', self: { position: [0, 64, 0], yaw, pitch: 0, properties: {} },
});

const physicalEvidence: PhysicalEvidenceReferenceV1 = distributedEvidenceFixtureV3('note-23', {
  relationIds: ['causal-hyperedge-000023'], applicability: 0 });

const rootCandidate: EffectRecallCandidateV1 = { candidateId: 'candidate-note-two',
  goalPredicateIds: ['note-recursive-is-two'],
  actionCue: { kind: 'interact', parameters: {}, targetRole: 'note_block' },
  observedChanges: [{ subject: 'note_block#0', property: 'note', before: '1', after: '2',
    observationIndex: 1, meaning: 'observed-co-occurrence' }], observedBefore: {}, evidence: physicalEvidence,
  unknown: [] };

const transition: OpaqueFactorTransitionTraceV1 = { version: 'OpaqueFactorTransitionTraceV1',
  transitionId: 'transition-note-one', eventId: 'baseline:event-17',
  actionCue: { kind: 'interact', parameters: {}, targetRole: 'note_block' },
  activatedFactorIds: ['causal-factor-000009'], deactivatedFactorIds: [], unchangedActiveFactorIds: [],
  evidence: { ...physicalEvidence, eventId: 'baseline:event-17' }, meaning: 'observed-factor-transition' };

const realEvent = (id: string, action: Action, frames: readonly Observation[]): RealEvent => ({
  version: 'RealEventV5', id, cue: { kind: action.kind, parameters: action.parameters,
    targetRole: action.kind === 'interact' ? 'note_block' : null }, frames, trackedIds: [controlId],
  bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence,
    endSequence: frames.at(-1)!.sequence, terminationReason: 'stable' },
  provenance: 'executed-real-body', complete: true,
});

const workspace = (goal: GroundedGoalV1, observationSequence: number,
  decision: { operation: string; nodeId: string }, includeTransition = false) => ({
  version: 'PhysicalControlSnapshotV2', field: {}, habits: {}, attentionDrive: 0, recentDispatches: [],
  lastDecision: { ...decision, siteId: `${decision.operation}:${decision.nodeId}`, converged: true,
    integrationSteps: 1, reason: 'synthetic-semantic-witness' },
  workspace: { version: 'ControlWorkspaceV2', goalId: goal.id, rootNodeId: `root:${goal.id}`, epoch: 1,
    observationSequence, observation: frame(observationSequence, observationSequence < 31 ? '0'
      : observationSequence < 46 ? '1' : '2'), offers: [], goalEvaluation: null,
    nodes: [
      { node: { nodeId: `root:${goal.id}`, kind: 'root', goal, createdEpoch: 1,
        createdObservationSequence: null }, condition: null, prediction: null, lastActionResult: null },
      { node: { nodeId: 'experienced:candidate-note-two', kind: 'experienced', candidate: rootCandidate,
        objectiveNodeId: `root:${goal.id}`, createdEpoch: 1, createdObservationSequence: 15 },
      condition: null, prediction: null, lastActionResult: null },
      ...(includeTransition ? [{ node: { nodeId: 'factor-transition:transition-note-one',
        kind: 'factor-transition', transition, createdEpoch: 1, createdObservationSequence: 22 },
      condition: null, prediction: null, lastActionResult: null }] : []),
    ],
    dependencies: includeTransition ? [{ edgeId: 'requires:factor',
      dependentNodeId: 'experienced:candidate-note-two',
      requiredNodeId: 'factor-transition:transition-note-one', factorIds: ['causal-factor-000009'],
      kind: 'opaque-factor', createdEpoch: 1, createdObservationSequence: 22 }] : [],
    pendingRequests: [], completedOperations: [], attentionNotices: [], lastFailure: null,
  },
});

const operation = (operation: string, nodeId: string, baseSequence: number, result: unknown):
NoteRecursiveTimelineRecordV1 => ({ kind: 'control-operation-result', value: {
  event: { kind: 'operation-completed', requestId: `request:${operation}:${baseSequence}`, epoch: 1,
    operation, nodeId, baseSequence, result }, accepted: { accepted: true, reason: `${operation}-accepted`,
    registeredNodeIds: [] },
} });

function semanticTimeline(goal: GroundedGoalV1): NoteRecursiveTimelineRecordV1[] {
  const root = `root:${goal.id}`, candidate = 'experienced:candidate-note-two';
  return [
    { kind: 'frame', value: frame(10, '0', Math.PI / 12, null) },
    { kind: 'frame', value: frame(15, '0', Math.PI / 12, null) },
    { kind: 'note-recursive-root-goal-injection', value: goal },
    { kind: 'joint-control-decision', value: workspace(goal, 15,
      { operation: 'recall-effect', nodeId: root }) },
    operation('recall-effect', root, 15, [rootCandidate]),
    operation('compare-condition', candidate, 15, { matchedFactorIds: [], contradictedFactorIds: [],
      unknownFactorIds: ['causal-factor-000009'], applicability: 0, productionEligible: true }),
    operation('predict-branch', candidate, 15, { validSampleCount: 0, progressSampleCount: 0,
      progressFraction: 0, nextStates: [], unknown: [], prediction: {}, currentEvidence: physicalEvidence }),
    { kind: 'joint-control-decision', value: workspace(goal, 15,
      { operation: 'execute', nodeId: 'experienced:look-acquire' }) },
    { kind: 'frame', value: frame(20, '0', Math.PI / 12, null) },
    { kind: 'frame', value: frame(21, '0', 0, controlId) },
    { kind: 'real-event', value: realEvent('live:event-look',
      { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } },
      [frame(20, '0', Math.PI / 12, null), frame(21, '0', 0, controlId)]) },
    { kind: 'joint-control-decision', value: workspace(goal, 22,
      { operation: 'expand-condition', nodeId: candidate }) },
    operation('expand-condition', candidate, 22, [transition]),
    { kind: 'joint-control-decision', value: workspace(goal, 25,
      { operation: 'execute', nodeId: 'factor-transition:transition-note-one' }, true) },
    { kind: 'frame', value: frame(30, '0') },
    { kind: 'frame', value: frame(31, '1') },
    { kind: 'real-event', value: realEvent('live:event-zero-one',
      { kind: 'interact', parameters: {}, targetId: controlId }, [frame(30, '0'), frame(31, '1')]) },
    // An unrelated real action proves the scorer does not compare a hard-coded action string.
    { kind: 'joint-control-decision', value: workspace(goal, 31,
      { operation: 'observe-public', nodeId: 'exploration:wait' }, true) },
    { kind: 'real-event', value: realEvent('live:event-extra-wait',
      { kind: 'wait', parameters: { ticks: 1 } }, [frame(34, '1'), frame(35, '1')]) },
    { kind: 'joint-control-decision', value: workspace(goal, 36,
      { operation: 'compare-condition', nodeId: candidate }, true) },
    operation('compare-condition', candidate, 36, { matchedFactorIds: ['causal-factor-000009'],
      contradictedFactorIds: [], unknownFactorIds: [], applicability: 1, productionEligible: true }),
    operation('predict-branch', candidate, 36, { validSampleCount: 24, progressSampleCount: 24,
      progressFraction: 1, nextStates: [], unknown: [], prediction: {}, currentEvidence: physicalEvidence }),
    { kind: 'joint-control-decision', value: workspace(goal, 40,
      { operation: 'execute', nodeId: candidate }, true) },
    { kind: 'frame', value: frame(45, '1') },
    { kind: 'frame', value: frame(46, '2') },
    { kind: 'real-event', value: realEvent('live:event-one-two',
      { kind: 'interact', parameters: {}, targetId: controlId }, [frame(45, '1'), frame(46, '2')]) },
    { kind: 'goal-difference', value: { goalId: goal.id, status: 'satisfied', residual: 0,
      observationSequence: 46, predicates: [] } },
    { kind: 'joint-control-decision', value: workspace(goal, 46,
      { operation: 'observe-public', nodeId: 'exploration:verify' }, true) },
    { kind: 'frame', value: frame(47, '2') },
    { kind: 'frame', value: frame(52, '2') },
    { kind: 'real-event', value: realEvent('live:event-verify',
      { kind: 'observe', parameters: { ticks: 5 } }, [frame(47, '2'), frame(52, '2')]) },
    { kind: 'goal-difference', value: { goalId: goal.id, status: 'satisfied', residual: 0,
      observationSequence: 52, predicates: [] } },
  ];
}

test('single recursive protocol exposes only note=2 root state and configurable 16-action boundary', () => {
  const protocol = MINECRAFT_NOTE_RECURSIVE_QUALIFICATION_V1;
  assert.equal(protocol.initialNote, '0'); assert.equal(protocol.targetNote, '2');
  assert.equal(Math.abs(protocol.initialYawOffsetDegrees), 15);
  assert.equal(protocol.defaultActionBudget, 16); assert.equal(resolveNoteRecursiveActionBudgetV1(), 16);
  assert.equal(resolveNoteRecursiveActionBudgetV1(9), 9);
  assert.throws(() => resolveNoteRecursiveActionBudgetV1(0), /invalid-note-recursive-action-budget/);
  assert.deepEqual(protocol.experience, { source: 'minecraft-joint-control-heldout-baseline-v2',
    eventCount: 128, independentRunLocalCopy: true, writeBackToSource: false });
  assert.deepEqual(protocol.habit, { initialWeightCount: 0 });
  assert.deepEqual(protocol.goalDisclosure, { rootGoalOnly: true, childGoalsDisclosed: 0,
    actionHintsDisclosed: 0 });
  assert.equal(JSON.stringify(protocol).includes('actionSequence'), false);

  const goal = noteRecursiveQualificationGoalV1(controlId);
  assert.deepEqual(goal.expression, { kind: 'predicate', predicate: { version: 'GoalPredicateV1',
    id: 'note-recursive-is-two', subject: { kind: 'public-object', id: controlId,
      expectedType: 'note_block' }, observable: 'properties.note', comparator: 'equals', target: '2' } });
  assert.equal(JSON.stringify(goal).includes('look'), false);
  assert.equal(JSON.stringify(goal).includes('interact'), false);
});

test('fixture readiness requires the same sole note=0 across five real sequence ticks', () => {
  const gate = new SingleNoteZeroReadinessGateV1();
  assert.equal(gate.accept(frame(10, '0')).ready, false);
  assert.equal(gate.accept(frame(14, '0')).ready, false);
  assert.deepEqual(gate.accept(frame(15, '0')), { ready: true, firstSequence: 10,
    confirmationSequence: 15, controlId, observedTicks: 3, reason: 'ready' });
  const reset = new SingleNoteZeroReadinessGateV1();
  reset.accept(frame(1, '0'));
  assert.equal(reset.accept(frame(2, '1')).reason, 'note-is-not-zero');
  assert.equal(reset.accept(frame(3, '0')).firstSequence, 3);
  assert.equal(reset.accept({ ...frame(4, '0'), objects: [note('0'), { ...note('0'), id: 'another-note' }] })
    .reason, 'ambiguous-or-not-visible');
});

test('timeline extraction proves recursive milestones without matching an action list', () => {
  const goal = noteRecursiveQualificationGoalV1(controlId), records = semanticTimeline(goal);
  assert.equal(auditNoteRecursiveGoalInjectionV1(records, goal), true);
  const evidence = extractNoteRecursiveTimelineEvidenceV1(records, goal, controlId);
  assert.deepEqual([evidence.states.zero?.value, evidence.states.one?.value, evidence.states.two?.value],
    ['0', '1', '2']);
  assert.deepEqual(evidence.relationCandidate?.relationIds, ['causal-hyperedge-000023']);
  assert.equal(evidence.relationCandidate?.recalledApplicability, 0);
  assert.deepEqual(evidence.missingFactor?.missingFactorIds, ['causal-factor-000009']);
  assert.equal(evidence.factorTransition?.transitionId, 'transition-note-one');
  assert.equal(evidence.factorTransition?.dependencyObserved, true);
  assert.deepEqual(evidence.conditionRecheck?.matchedFactorIds, ['causal-factor-000009']);
  assert.equal(evidence.rootRetention.retainedAcrossTurnAndIntermediate, true);
  assert.equal(evidence.physicalActions.turn?.finalCrosshairTargetId, controlId);
  assert.deepEqual([evidence.physicalActions.zeroToOne?.noteBefore,
    evidence.physicalActions.zeroToOne?.noteAfter], ['0', '1']);
  assert.deepEqual([evidence.physicalActions.oneToTwo?.noteBefore,
    evidence.physicalActions.oneToTwo?.noteAfter], ['1', '2']);
  assert.deepEqual(evidence.verification, { firstSatisfiedObservationSequence: 46,
    secondSatisfiedObservationSequence: 52, ticksApart: 6, observeEventId: 'live:event-verify' });
  const score = scoreNoteRecursiveQualificationV1({ evidence, fixtureReady: true,
    baselineWrites: 128, baselineEventCount: 128, baselineHashUnchanged: true, independentCopy: true,
    initialHabitWeightCount: 0, targetActionPreflightReady: true, goalInjectionLeakageFree: true,
    controllerStatus: 'goal-verified', actionsExecuted: 5, actionBudget: 16, runtimeError: null });
  assert.equal(score.passed, true, JSON.stringify(score));
  assert.equal(score.failure, null);
  assert.equal(records.some(record => record.kind === 'real-event'
    && (record.value as RealEvent).bodyResult?.action.kind === 'wait'), true,
  'the semantic score should tolerate an unrelated real action');

  const noRelation = scoreNoteRecursiveQualificationV1({ evidence: { ...evidence, relationCandidate: null },
    fixtureReady: true, baselineWrites: 128, baselineEventCount: 128, baselineHashUnchanged: true,
    independentCopy: true, initialHabitWeightCount: 0, targetActionPreflightReady: true,
    goalInjectionLeakageFree: true, controllerStatus: 'goal-verified', actionsExecuted: 5,
    actionBudget: 16, runtimeError: null });
  assert.equal(noRelation.failure, 'representation-insufficient');
});

test('goal injection audit rejects a second target or any script-provided method hint', () => {
  const goal = noteRecursiveQualificationGoalV1(controlId), records = semanticTimeline(goal);
  assert.equal(auditNoteRecursiveGoalInjectionV1([...records,
    { kind: 'evaluation-action-hint', value: { kind: 'interact' } }], goal), false);
  assert.equal(auditNoteRecursiveGoalInjectionV1([...records,
    { kind: 'note-recursive-root-goal-injection', value: goal }], goal), false);
});

test('runner reads the approved 128 baseline and gives the worker an independent copy without write-back', async () => {
  const baselinePath = resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath);
  const before = await fileSha(baselinePath), baseline = await readFrozenPhysicalBaselineV2(baselinePath);
  const sourceCanonical = sha(baseline.snapshot), copy = independentFrozenBaselineCopyV1(baseline);
  assert.notStrictEqual(copy, baseline.snapshot);
  assert.equal(sha(copy), sourceCanonical);
  (copy as unknown as { writes: number }).writes = 0;
  assert.equal(baseline.snapshot.writes, 128);
  assert.equal(sha(baseline.snapshot), sourceCanonical);
  assert.equal(await fileSha(baselinePath), before);
});

test('runner dependency and post-fixture boundaries use production adapters with no evaluator action hints', async () => {
  assert.deepEqual(MINECRAFT_NOTE_RECURSIVE_DEPENDENCY_SOURCES_V1, {
    services: '../services.js', body: '../body.js', runtime: '../runtime.js',
    frozenBaseline: './minecraft-joint-control-heldout-v2.js' });
  const source = await readFile(resolve('src/evaluation/minecraft-note-recursive-qualification-v1.ts'), 'utf8');
  assert.match(source, /import \{ MinecraftBody \} from '\.\.\/body\.js'/);
  assert.match(source, /import \{ V5Runtime,/);
  assert.match(source, /import \{ Services, type Configuration \} from '\.\.\/services\.js'/);
  assert.match(source, /readFrozenPhysicalBaselineV2/);
  assert.match(source, /independentFrozenBaselineCopyV1\(baseline\)/);
  assert.doesNotMatch(source, /saveJson\(baselinePath/);
  const injectionIndex = source.indexOf("record('note-recursive-root-goal-injection', goal)");
  assert(injectionIndex > 0);
  assert.doesNotMatch(source.slice(injectionIndex), /services\.command\(/,
    'world/fixture mutation must not occur after root-goal injection');
  assert.doesNotMatch(source, /heldoutCaseActionChainMatchesV2|expectedActions|solutionSteps/);
});
