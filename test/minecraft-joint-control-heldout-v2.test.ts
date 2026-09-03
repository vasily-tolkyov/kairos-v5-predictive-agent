import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Observation, PublicObject } from '../src/contracts.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { groupEffectCandidatesForControlV1 } from '../src/control/workspace.js';
import { PhysicalMemory } from '../src/memory.js';
import { sha } from '../src/util.js';
import { legacyCandidateAsInactiveDistributedAuditV3 }
  from '../src/legacy/audit-control-contracts.js';
import { MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2, SingleVisibleNoteReadinessGateV2,
  heldoutCaseActionChainMatchesV2, heldoutInvalidInteractionCountV2, heldoutStaleRefusalCountV2,
  heldoutDeviationAttentionNoticeCountV2,
  inspectFrozenTargetActionProductionV2, minecraftJointControlHeldoutCasesV2, noteStateGoalV2,
  readFrozenPhysicalBaselineV2 } from '../src/evaluation/minecraft-joint-control-heldout-v2.js';

const note = (id = 'block:1,65,1'): PublicObject => ({ id, type: 'note_block',
  relativePosition: [0, 1, -3], properties: { note: '0' } });
const observation = (sequence: number, objects: readonly PublicObject[]): Observation => ({ sequence,
  activeSeconds: sequence * .05, objects, targetId: null, contextId: 'heldout-fixture-test',
  self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: {} } });

test('heldout V2 declares four unseen layouts without embedding an action sequence', () => {
  assert.deepEqual(minecraftJointControlHeldoutCasesV2.map(value => value.mode), [
    'look-plus-15', 'look-minus-15', 'already-aligned', 'post-look-public-view-deviation',
  ]);
  assert.deepEqual(minecraftJointControlHeldoutCasesV2.map(value => value.initialYawOffsetDegrees), [-15, 15, 0, -15]);
  assert.deepEqual(minecraftJointControlHeldoutCasesV2.map(value => value.publicDeviationDegrees), [0, 0, 0, 30]);
  assert.equal(new Set(minecraftJointControlHeldoutCasesV2.map(value => value.layout.id)).size, 4);
  assert.equal(new Set(minecraftJointControlHeldoutCasesV2
    .map(value => `${value.layout.originX},${value.layout.originZ}`)).size, 4);
  assert.equal(JSON.stringify(minecraftJointControlHeldoutCasesV2).includes('actionSequence'), false);
});

test('fixture readiness requires the same sole public note block continuously for five ticks', () => {
  const gate = new SingleVisibleNoteReadinessGateV2();
  assert.equal(gate.accept(observation(10, [note()])).ready, false);
  assert.equal(gate.accept(observation(14, [note()])).ready, false);
  const ready = gate.accept(observation(15, [note()]));
  assert.deepEqual(ready, { ready: true, firstSequence: 10, secondSequence: 15,
    controlId: 'block:1,65,1', observedTicks: 3, reason: 'ready' });

  const interrupted = new SingleVisibleNoteReadinessGateV2();
  interrupted.accept(observation(1, [note()]));
  assert.equal(interrupted.accept(observation(3, [])).reason, 'ambiguous-or-not-visible');
  assert.equal(interrupted.accept(observation(6, [note(), note('block:2,65,2')])).ready, false);
  assert.equal(interrupted.accept(observation(7, [note()])).firstSequence, 7);
  assert.equal(interrupted.accept(observation(12, [note()])).ready, true);
});

test('heldout target contains only the grounded note state and no controller-generated method', () => {
  const goal = noteStateGoalV2('case', 'block:1,65,1');
  assert.equal(goal.expression.kind, 'predicate');
  if (goal.expression.kind !== 'predicate') throw new Error('unreachable');
  assert.deepEqual(goal.expression.predicate, { version: 'GoalPredicateV1', id: 'note-state-one',
    subject: { kind: 'public-object', id: 'block:1,65,1', expectedType: 'note_block' },
    observable: 'properties.note', comparator: 'equals', target: '1' });
  assert.equal(JSON.stringify(goal).includes('look'), false);
  assert.equal(JSON.stringify(goal).includes('interact'), false);
});

test('heldout V2 behavior gate checks the requested chain rather than mere final state', () => {
  const action = (kind: string, parameters: Record<string, string | number | boolean> = {}) =>
    JSON.stringify({ kind, parameters });
  assert.equal(heldoutCaseActionChainMatchesV2('look-plus-15', [action('look', { yawDegrees: 15, pitchDegrees: 0 }),
    action('interact'), action('observe', { ticks: 5 })]), true);
  assert.equal(heldoutCaseActionChainMatchesV2('look-plus-15', [action('look', { yawDegrees: -15, pitchDegrees: 0 }),
    action('interact'), action('observe', { ticks: 5 })]), false);
  assert.equal(heldoutCaseActionChainMatchesV2('already-aligned', [action('interact'), action('observe')]), true);
  assert.equal(heldoutCaseActionChainMatchesV2('already-aligned', [action('look'), action('interact'), action('observe')]), false);
  assert.equal(heldoutCaseActionChainMatchesV2('post-look-public-view-deviation', [
    action('look', { yawDegrees: 15 }), action('look', { yawDegrees: -15 }), action('interact'), action('observe'),
  ]), true);
});

test('cleanly rebuilt attempt-017 memory has current scale, basin identity and exact approved hashes', async () => {
  const baseline = await readFrozenPhysicalBaselineV2(resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath));
  assert.equal(baseline.snapshot.seenEventIds.length, 128);
  assert.equal(baseline.snapshot.writes, 128);
  assert.equal(baseline.snapshot.pendingInitialization.length, 0);
  assert.equal(baseline.snapshot.version, 'KairosV5MemoryV4');
  assert.equal(baseline.snapshot.eventMeasurementVersion, 'R2EventMeasurementAdapterV2');
  assert.equal(baseline.snapshot.projector?.version, 'PathProjectorStateV4');
  assert.equal(baseline.snapshot.projector?.measurementGeometry, 'source-translated-global-event-frame-v1');
  assert.equal(baseline.snapshot.projector?.resolution.equivalentGeometryMethod,
    'vertex-preserving-polyline-densification');
  assert.equal(baseline.snapshot.projector?.resolution.boundaryGeometry,
    'max-centered-radius-within-inscribed-sphere');
  assert.equal(baseline.snapshot.r2a?.version, 'CausalFactorGraphStateV3');
  assert.equal(baseline.snapshot.r2a?.outcomeIdentityVersion, 'ActiveR2BasinMembershipV1');
  assert.equal(baseline.fileSha256, MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.fileSha256);
  assert.equal(baseline.canonicalSha256, MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.canonicalSha256);
  assert.equal(baseline.eventMapSha256, MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.eventMapSha256);
});

test('heldout preflight accepts the rebuilt target relation and rejects the same evidence when it is non-production', async () => {
  const baseline = await readFrozenPhysicalBaselineV2(resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath));
  const interact = inspectFrozenTargetActionProductionV2(baseline.snapshot,
    { kind: 'interact', parameters: {}, targetRole: 'note_block' });
  assert.equal(interact.ready, true);
  assert.equal(interact.reason, 'ready');
  assert.equal(interact.productionRelationIds.length, 2);
  assert.equal(interact.productionFactorIds.length > 0, true);
  assert.equal(interact.sourceEventCount >= 8, true);

  assert(baseline.snapshot.r2a);
  const insufficient = {
    ...structuredClone(baseline.snapshot),
    r2a: {
      ...structuredClone(baseline.snapshot.r2a),
      hyperedges: baseline.snapshot.r2a.hyperedges.map(edge => edge.interventionKey === interact.interventionKey
        ? { ...edge, state: 'provisional' as const } : structuredClone(edge)),
    },
  } as typeof baseline.snapshot;
  const rejected = inspectFrozenTargetActionProductionV2(insufficient,
    { kind: 'interact', parameters: {}, targetRole: 'note_block' });
  assert.equal(rejected.ready, false);
  assert.equal(rejected.reason, 'experience-insufficient:target-action-has-no-production-r2a-relation');
  assert.equal(rejected.relationCount > 0, true, 'historical non-production relations must not be hidden');
  assert.deepEqual(rejected.productionRelationIds, []);

  const representedLook = inspectFrozenTargetActionProductionV2(baseline.snapshot,
    { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null });
  assert.equal(representedLook.ready, true);
  assert.equal(representedLook.productionRelationIds.length > 0, true);
  assert.equal(representedLook.productionFactorIds.length > 0, true);
  assert.equal(representedLook.sourceEventCount >= 8, true);
});

test('an aligned sealed real frame has production interaction conditions and random physical progress', async () => {
  const baseline = await readFrozenPhysicalBaselineV2(resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath));
  const records = (await readFile(resolve('evidence',
    'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup', 'frames.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { kind: string; value: Observation });
  const frame = records.find(record => record.kind === 'frame' && record.value.sequence === 70)?.value;
  assert(frame, 'sealed real frame 70 must remain available');
  const control = frame.objects.find(object => object.type === 'note_block');
  assert(control, 'sealed real frame must expose the note block');
  const goal = noteStateGoalV2('aligned-production-preflight', control.id);
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, frame);
  const memory = PhysicalMemory.restore(baseline.snapshot), before = sha(memory.snapshot());
  const candidates = memory.recallByEffect(goal, evaluator.evaluate(frame), frame)
    .filter(candidate => candidate.actionCue.kind === 'interact'
      && candidate.actionCue.targetRole === 'note_block');
  assert.equal(candidates.length, 16, 'raw physical provenance remains event-level');
  const groups = groupEffectCandidatesForControlV1(`root:${goal.id}`,
    candidates.map(legacyCandidateAsInactiveDistributedAuditV3));
  assert.equal(groups.length, 1, 'sixteen equivalent events must occupy one control branch');
  assert.equal(groups[0]!.members.length, 16, 'grouping must retain every physical event');
  const candidate = candidates[0]!;
  const condition = memory.compareConditions(candidate, frame);
  assert.equal(condition.productionEligible, true);
  assert(condition.applicability >= 0.5);
  const prediction = memory.predictCandidate(candidate, frame, goal);
  assert(prediction.validSampleCount >= 8);
  assert(prediction.progressSampleCount / prediction.validSampleCount >= 0.6);
  assert.equal(sha(memory.snapshot()), before, 'preflight recall, condition and prediction must be read-only');
});

test('a recalled concrete R2 result keeps its own relation when another result currently matches', async () => {
  const baseline = await readFrozenPhysicalBaselineV2(resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath));
  const records = (await readFile(resolve('evidence',
    'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup', 'frames.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { kind: string; value: Observation });
  const frame = records.find(record => record.kind === 'frame' && record.value.sequence === 70)?.value;
  assert(frame, 'sealed real frame 70 must remain available');
  const control = frame.objects.find(object => object.type === 'note_block');
  assert(control, 'sealed real frame must expose the note block');
  assert.equal(control.properties.note, '0');
  const goal = { version: 'GroundedGoalV1' as const, id: 'note-two-relation-provenance', expression: {
    kind: 'predicate' as const, predicate: { version: 'GoalPredicateV1' as const, id: 'note-state-two',
      subject: { kind: 'public-object' as const, id: control.id, expectedType: 'note_block' },
      observable: 'properties.note' as const, comparator: 'equals' as const, target: '2' } } };
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, frame);
  const memory = PhysicalMemory.restore(baseline.snapshot);
  const candidate = memory.recallByEffect(goal, evaluator.evaluate(frame), frame)
    .find(item => item.actionCue.kind === 'interact'
      && item.observedChanges.some(change => change.property === 'note' && change.after === '2'));
  assert(candidate, 'note=2 history was not recalled');

  assert.deepEqual(candidate.evidence.r2a.relationIds, ['causal-hyperedge-000023']);
  assert.equal(candidate.evidence.r2a.applicability, 0);
  assert.equal(candidate.evidence.r2a.productionEligible, true);
  assert.deepEqual(memory.compareConditions(candidate, frame), {
    matchedFactorIds: [], contradictedFactorIds: [], unknownFactorIds: ['causal-factor-000009'],
    applicability: 0, productionEligible: true,
  });
});

test('a random rollout that reaches the last recorded public outcome can carry its observed opaque factor transition', async () => {
  const baseline = await readFrozenPhysicalBaselineV2(resolve(MINECRAFT_JOINT_CONTROL_HELDOUT_BASELINE_V2.relativePath));
  const records = (await readFile(resolve('evidence',
    'minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup', 'frames.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as { kind: string; value: Observation });
  const frame = records.find(record => record.kind === 'frame' && record.value.sequence === 70)?.value;
  assert(frame, 'sealed real frame 70 must remain available');
  const control = frame.objects.find(object => object.type === 'note_block');
  assert(control, 'sealed real frame must expose the note block');
  const goal = { version: 'GroundedGoalV1' as const, id: 'note-two-factor-rollout', expression: {
    kind: 'predicate' as const, predicate: { version: 'GoalPredicateV1' as const, id: 'note-state-two',
      subject: { kind: 'public-object' as const, id: control.id, expectedType: 'note_block' },
      observable: 'properties.note' as const, comparator: 'equals' as const, target: '2' } } };
  const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, frame);
  const memory = PhysicalMemory.restore(baseline.snapshot), before = sha(memory.snapshot());
  const candidate = memory.recallByEffect(goal, evaluator.evaluate(frame), frame)
    .find(item => item.actionCue.kind === 'interact'
      && item.observedChanges.some(change => change.property === 'note' && change.after === '2'));
  assert(candidate, 'note=2 history was not recalled');
  const missing = memory.compareConditions(candidate, frame);
  assert.deepEqual(missing.unknownFactorIds, ['causal-factor-000009']);
  const transition = memory.recallFactorTransition(missing.unknownFactorIds, frame)
    .find(value => value.actionCue.kind === 'interact'
      && value.activatedFactorIds.includes('causal-factor-000009'));
  assert(transition, 'the real interaction transition that establishes the missing factor must remain recallable');
  const transitionCandidate = { candidateId: transition.transitionId, goalPredicateIds: [],
    actionCue: transition.actionCue, observedChanges: [], observedBefore: {}, evidence: transition.evidence,
    unknown: ['opaque-factor-transition:observed-co-occurrence-not-causal-proof'] };
  const condition = memory.compareConditions(transitionCandidate, frame);
  assert.equal(condition.productionEligible, true);
  assert(condition.applicability >= .5);
  const prediction = memory.predictCandidate(transitionCandidate, frame, goal);
  const established = prediction.nextStates.filter(state =>
    state.knownActiveFactorIds.includes('causal-factor-000009')).length;
  assert(prediction.validSampleCount >= 8);
  assert(established / prediction.nextStates.length >= .75,
    'physically visiting the final recorded public outcome must not require traversing later no-change tail kernels');
  assert.equal(sha(memory.snapshot()), before, 'factor-transition prediction must remain read-only');
});

test('heldout accounting includes pre-body reality refusals and failed interaction results', () => {
  const records = [
    { kind: 'control-action-reality-refusal', value: { nodeId: 'n1', reason: 'offer-stale' } },
    { kind: 'control-action-result', value: { offer: { action: { kind: 'move' } },
      result: { executed: false, refusal: 'offer-stale' } } },
    { kind: 'control-action-result', value: { offer: { action: { kind: 'interact' } },
      result: { executed: false, refusal: 'target-unavailable' } } },
  ];
  assert.equal(heldoutStaleRefusalCountV2(records), 2);
  assert.equal(heldoutInvalidInteractionCountV2(records), 1);
});

test('deviation attention gate counts only a self yaw unknown-change inside the injected interval', () => {
  const yaw = { subject: 'self', property: 'yaw', before: 0, after: Math.PI / 6 };
  const records = [
    { kind: 'attention-wake', value: { kind: 'unknown-change', subjectId: 'self', sequence: 20,
      evidence: [yaw] } },
    { kind: 'heldout-public-view-deviation', value: { beforeSequence: 30, afterSequence: 55, degrees: 30 } },
    { kind: 'attention-wake', value: { kind: 'prediction-violation', subjectId: 'self', sequence: 40,
      evidence: [yaw] } },
    { kind: 'attention-wake', value: { kind: 'unknown-change', subjectId: 'external', sequence: 41,
      evidence: [yaw] } },
    { kind: 'attention-wake', value: { kind: 'unknown-change', subjectId: 'self', sequence: 42,
      evidence: [{ ...yaw, property: 'pitch' }] } },
    { kind: 'attention-wake', value: { kind: 'unknown-change', subjectId: 'self', sequence: 43,
      evidence: [yaw] } },
  ];
  assert.equal(heldoutDeviationAttentionNoticeCountV2(records), 1);
});

test('heldout catch path retains the fixture readiness obtained before control fails', async () => {
  const source = await readFile(resolve('src/evaluation/minecraft-joint-control-heldout-v2.ts'), 'utf8');
  assert.match(source, /let fixture: FixtureVisibilityReadinessV2/);
  assert.match(source, /fixture = await awaitFixtureReadiness\(body\)/);
  assert.match(source, /caseResult = \{ caseId: heldout\.id, mode: heldout\.mode, fixture,/);
});
