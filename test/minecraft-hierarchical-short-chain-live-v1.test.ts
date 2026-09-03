import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cueIdentity } from '../src/events.js';
import { HierarchicalPhysicalMemoryV1, type HierarchicalMemorySnapshotV1 } from '../src/hierarchical-memory.js';
import { PhysicalMedium3D } from '../src/core/physics/physical-medium.js';
import type { Observation } from '../src/contracts.js';
import { DeterministicTokenFieldEncoder } from '../src/core/learning/token-field.js';
import {
  MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1,
  auditFrozenPhysicalActionEvidenceLiveV1,
  minecraftHierarchicalShortChainPlanLiveV1,
  selectOpaqueJointInterventionAtBranchV1,
  selectOpaqueJointInterventionV1,
  verifyInitializedFoundationR2LiveV1,
} from '../src/evaluation/minecraft-hierarchical-short-chain-live-v1.js';

test('live hierarchy protocol includes a separate post-map acquire/miss intervention curriculum', () => {
  const plan = minecraftHierarchicalShortChainPlanLiveV1();
  assert.equal(plan.singletonEpisodes.length, 20);
  assert.equal(plan.singletonEpisodes.filter(value => value.mode === 'look-plus-miss').length, 4);
  assert.equal(plan.singletonEpisodes.filter(value => value.mode === 'look-minus-miss').length, 4);
  assert.deepEqual([...new Set(plan.singletonEpisodes.filter(value => value.mode === 'look-minus-miss')
    .map(value => value.layout.markerVariant))].sort(), [0, 1, 2, 3]);
  assert.equal(plan.foundationEpisodes.length, 36);
  assert.equal(plan.lookFoundationEpisodes.length, 20);
  assert.equal(plan.interventionEpisodes.length, 8);
  assert.equal(plan.lookInterventionEpisodes.length, 8);
  assert.equal(plan.initialR1AtomCount, 128);
  assert.equal(plan.postCalibrationLookR1AtomCount, 60);
  assert.equal(plan.postProtocolR1AtomCount, 48);
  assert.equal(plan.frozenR1AtomCount, 236);
  assert.equal(plan.singletonEpisodes.length + plan.foundationEpisodes.length * 3, 128);
  assert.equal((plan.interventionEpisodes.length + plan.lookInterventionEpisodes.length) * 3, 48);
  for (const arm of ['P0-note-0-increment', 'P1-note-1-increment',
    'P2-spectator-no-increment'] as const)
    assert.deepEqual({
      episodes: plan.foundationEpisodes.filter(value => value.arm === arm).length,
      publicMarkerContexts: [...new Set(plan.foundationEpisodes.filter(value => value.arm === arm)
        .map(value => value.layout.markerVariant))].sort(),
    }, { episodes: 12, publicMarkerContexts: [0, 1, 2, 3] });
  for (const comparison of ['increment-vs-no-increment'] as const) {
    const episodes = plan.interventionEpisodes.filter(value => value.comparison === comparison);
    assert.equal(episodes.length, 8);
    assert.deepEqual([...new Set(episodes.map(value => value.pairIndex))], [0, 1, 2, 3]);
    for (const pairIndex of [0, 1, 2, 3])
      assert.equal(episodes.filter(value => value.pairIndex === pairIndex).length, 2);
  }
  assert.equal(plan.lookFoundationEpisodes.filter(value => value.arm === 'L0-acquire').length, 4);
  assert.equal(plan.lookFoundationEpisodes.filter(value => value.arm === 'L1-miss').length, 16);
  for (const pairIndex of [0, 1, 2, 3]) {
    const foundation = plan.lookFoundationEpisodes.filter(value => value.pairIndex === pairIndex
      && value.episode >= 12);
    const intervention = plan.lookInterventionEpisodes.filter(value => value.pairIndex === pairIndex);
    assert.deepEqual(foundation.map(value => value.arm), ['L0-acquire', 'L1-miss']);
    assert.deepEqual(intervention.map(value => value.arm), ['L0-acquire', 'L1-miss']);
    assert.equal(new Set(foundation.map(value => value.layout.id)).size, 1);
    assert.equal(new Set(intervention.map(value => value.layout.id)).size, 1);
  }
});

test('foundation triplets use the same precommitted layout and post-protocol pairs never cross comparisons', () => {
  const plan = minecraftHierarchicalShortChainPlanLiveV1();
  for (let group = 0; group < 12; group++) {
    const members = plan.foundationEpisodes.filter(value => value.pairIndex === group);
    assert.equal(members.length, 3);
    assert.equal(new Set(members.map(value => value.layout.id)).size, 1);
    assert.deepEqual(members.map(value => value.arm), ['P0-note-0-increment', 'P1-note-1-increment',
      'P2-spectator-no-increment']);
  }
  const pairKeys = plan.interventionEpisodes.map(value => `${value.comparison}:${value.pairIndex}`);
  assert.equal(new Set(pairKeys).size, 4);
});

function initializedFoundationFixture() {
  const singletonEventIds = new Set(Array.from({ length: 20 }, (_, index) => `singleton-${index}`));
  const arms = ['P0-note-0-increment', 'P1-note-1-increment',
    'P2-spectator-no-increment'] as const;
  const expected = Array.from({ length: 36 }, (_, episode) => ({ episode, arm: arms[episode % 3]!,
    sourceEventIds: [`chain-${episode}-look`, `chain-${episode}-interact`, `chain-${episode}-observe`] as [string, string, string],
    orderedExperienceIdentities: [`cue-${episode}-look`, `cue-${episode}-interact`, `cue-${episode}-observe`] as [string, string, string],
  }));
  const annotations = [...singletonEventIds, ...expected.flatMap(value => value.sourceEventIds)]
    .map((eventId, index) => ({ eventId, atomId: `atom-${index}` }));
  const atomByEvent = new Map(annotations.map(value => [value.eventId, value.atomId]));
  const events = expected.map((value, index) => ({ eventId: `r2-${index}`, sourceEventIds: value.sourceEventIds,
    atomIds: value.sourceEventIds.map(id => atomByEvent.get(id)!),
    orderedExperienceIdentities: value.orderedExperienceIdentities,
    completion: 'complete', boundaryReason: 'public-process-resolved', learningEligible: true,
  }));
  const snapshot = { annotations, writes: 128, r2Store: { events } } as unknown as HierarchicalMemorySnapshotV1;
  return { singletonEventIds, expected, snapshot };
}

test('foundation R2 is verified once after atom 128 with exact ordered three-atom closure', () => {
  const fixture = initializedFoundationFixture();
  const resolved = verifyInitializedFoundationR2LiveV1(fixture.snapshot, fixture.expected,
    fixture.singletonEventIds);
  assert.equal(resolved.length, 36);
  assert.deepEqual(resolved[0]!.event.sourceEventIds, fixture.expected[0]!.sourceEventIds);
  assert(resolved.every(value => value.event.boundaryReason === 'public-process-resolved'));
});

test('foundation R2 verification rejects swapped order, wrong closure, and singleton contamination', () => {
  const fixture = initializedFoundationFixture();
  const swapped = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  (swapped.r2Store.events[0]!.sourceEventIds as string[]).reverse();
  assert.throws(() => verifyInitializedFoundationR2LiveV1(swapped, fixture.expected,
    fixture.singletonEventIds), /exact-source-match-count/);
  const wrongClosure = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  Object.assign(wrongClosure.r2Store.events[0]!, { boundaryReason: 'continuity-reset' });
  assert.throws(() => verifyInitializedFoundationR2LiveV1(wrongClosure, fixture.expected,
    fixture.singletonEventIds), /completion-invalid/);
  const contaminated = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  const contaminatedExpected = structuredClone(fixture.expected);
  (contaminated.r2Store.events[0]!.sourceEventIds as string[])[0] = 'singleton-0';
  contaminatedExpected[0]!.sourceEventIds[0] = 'singleton-0';
  assert.throws(() => verifyInitializedFoundationR2LiveV1(contaminated, contaminatedExpected,
    fixture.singletonEventIds), /reset-singleton-was-mixed/);
});

test('foundation collector does not demand R2 from the pre-calibration 23/128 state', async () => {
  const source = await readFile('src/evaluation/minecraft-hierarchical-short-chain-live-v1.ts', 'utf8');
  assert.match(source, /executeChain\(trainingCompute, services, trainingBody, episode, false\)/);
  assert.match(source, /const initialized = await trainingCompute\.call<HierarchicalMemorySnapshotV1>\('snapshot'\);[\s\S]*verifyInitializedFoundationR2LiveV1/);
});

test('live runner must establish and intervene on the acquire/miss look branch before heldout', async () => {
  const source = await readFile('src/evaluation/minecraft-hierarchical-short-chain-live-v1.ts', 'utf8');
  assert.match(source, /executeLookChain/);
  assert.match(source, /selectOpaqueJointInterventionAtBranchV1[\s\S]*branchAtomIndex/);
  assert.match(source, /hierarchical-look-acquire-joint-factor-protocol-v1/);
  assert.match(source, /lookInterventionEpisodes/);
  assert.match(source, /hierarchical-look-intervention-did-not-reach-production-grade/);
  assert.match(source, /hierarchical-look-miss-correction-unexpectedly-acquired-control/);
  assert.match(source, /neutralMarkers: episode\.phase === 'intervention' \? 'absent' : 'visible'/);
});

function opaqueSelectionFixture() {
  const armAIds = Array.from({ length: 12 }, (_, index) => `target-${index}`);
  const armBIds = Array.from({ length: 12 }, (_, index) => `contrast-${index}`);
  const perception = (arm: 'target' | 'contrast') => {
    const value = new Float64Array(256);
    value[0] = arm === 'target' ? 1 : 0;
    value[1] = arm === 'target' ? 0 : 1;
    return value;
  };
  const encoder = new DeterministicTokenFieldEncoder();
  encoder.fit([...armAIds.map(() => perception('target')), ...armBIds.map(() => perception('contrast'))]);
  encoder.freeze();
  const evidence = [...armAIds.map(eventId => ({ eventId, arm: 'target' as const })),
    ...armBIds.map(eventId => ({ eventId, arm: 'contrast' as const }))]
    .map(({ eventId, arm }) => ({ eventId,
      atomPrePerceptions: [Array(256).fill(0), [...perception(arm)], Array(256).fill(0)],
    }));
  const snapshot = {
    tokenEncoder: encoder.exportState(),
    r2a: {
      patterns: [
        { patternId: 'opaque-target-pattern', memberEventIds: armAIds },
        { patternId: 'opaque-contrast-pattern', memberEventIds: armBIds },
      ],
      factors: [
        { factorId: 'opaque-factor-0', tokenIndex: 0, tolerance: .1 },
        { factorId: 'opaque-factor-1', tokenIndex: 1, tolerance: .1 },
      ],
      relations: [{ relationId: 'opaque-relation', targetPatternId: 'opaque-target-pattern',
        contrastPatternIds: ['opaque-contrast-pattern'], branchAtomIndex: 1,
        exactNextActionIdentity: cueIdentity({ kind: 'interact', parameters: {}, targetRole: 'note_block' }),
        factorIds: ['opaque-factor-0', 'opaque-factor-1'], predictiveSinceEventId: 'boundary-event',
        grade: 'predictive-stable' }],
      evidence,
    },
  } as unknown as HierarchicalMemorySnapshotV1;
  return { snapshot, armAIds, armBIds };
}

test('joint selector uses pre-action opaque factors and returns a canonical multi-factor set', () => {
  const fixture = opaqueSelectionFixture();
  const selected = selectOpaqueJointInterventionV1(fixture.snapshot, fixture.armAIds, fixture.armBIds);
  assert.equal(selected.relationId, 'opaque-relation');
  assert.equal(selected.targetPatternId, 'opaque-target-pattern');
  assert.equal(selected.contrastPatternId, 'opaque-contrast-pattern');
  assert.deepEqual(selected.changedFactorIds, ['opaque-factor-0', 'opaque-factor-1']);
  assert.equal(selected.branchAtomIndex, 1);
  assert.equal(selected.targetArmCoverage, 1);
  assert.equal(selected.contrastArmCoverage, 1);
  assert.equal(selected.selectionInputs, 'precommitted-arm-membership-and-pre-action-perception-only');
});

test('joint selector rejects an incomplete precommitted-arm pattern', () => {
  const fixture = opaqueSelectionFixture();
  const snapshot = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  Object.assign(snapshot.r2a!.patterns[0]!, { memberEventIds: fixture.armAIds.slice(0, 10) });
  Object.assign(snapshot.r2a!.patterns[1]!, { memberEventIds: fixture.armBIds.slice(0, 10) });
  assert.throws(() => selectOpaqueJointInterventionV1(snapshot, fixture.armAIds, fixture.armBIds),
    /precommitted-arm-requires-one-complete-stable-R2-pattern:0/);
});

test('joint selector rejects one merged pattern spanning both precommitted arms', () => {
  const fixture = opaqueSelectionFixture();
  const snapshot = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  Object.assign(snapshot.r2a!, { patterns: [{ patternId: 'merged-lossy-pattern',
    memberEventIds: [...fixture.armAIds, ...fixture.armBIds] }] });
  assert.throws(() => selectOpaqueJointInterventionV1(snapshot, fixture.armAIds, fixture.armBIds),
    /precommitted-arm-requires-one-complete-stable-R2-pattern:0/);
});

test('joint selector can preregister the first real action without borrowing a later atom field', () => {
  const fixture = opaqueSelectionFixture();
  const snapshot = structuredClone(fixture.snapshot) as HierarchicalMemorySnapshotV1;
  const relation = snapshot.r2a!.relations[0]!;
  const lookIdentity = cueIdentity({ kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 },
    targetRole: null });
  Object.assign(relation, { branchAtomIndex: 0, exactNextActionIdentity: lookIdentity });
  for (const evidence of snapshot.r2a!.evidence) {
    const atomPrePerceptions = evidence.atomPrePerceptions.map(value => [...value]);
    atomPrePerceptions[0] = [...atomPrePerceptions[1]!];
    atomPrePerceptions[1] = Array(256).fill(0);
    Object.assign(evidence, { atomPrePerceptions });
  }
  const selected = selectOpaqueJointInterventionAtBranchV1(snapshot,
    fixture.armAIds, fixture.armBIds, 0, lookIdentity);
  assert.equal(selected.relationId, 'opaque-relation');
  assert.equal(selected.branchAtomIndex, 0);
  assert.deepEqual(selected.changedFactorIds, ['opaque-factor-0', 'opaque-factor-1']);
});

test('joint selector rejects ambiguous arm membership rather than using an outcome label', () => {
  const fixture = opaqueSelectionFixture();
  assert.throws(() => selectOpaqueJointInterventionV1(fixture.snapshot,
    fixture.armAIds, [...fixture.armBIds.slice(0, -1), fixture.armAIds[0]!]),
  /precommitted-foundation-arm-membership-invalid/);
});

test('heldout batch contains four independent case identities with no injected action sequence', () => {
  assert.equal(MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1.length, 4);
  assert.equal(new Set(MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1.map(value => value.caseId)).size, 4);
  assert.deepEqual(MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1.map(value => value.yawOffsetDegrees),
    [-15, -15, -15, -15]);
  assert(MINECRAFT_HIERARCHICAL_SHORT_CHAIN_HELDOUTS_LIVE_V1.every(value => value.actionBudget === 16));
});

test('post-hoc heldout audit accepts only frozen R1, R2 and intervention-supported R2A actions', () => {
  const cue = { kind: 'interact' as const, parameters: {}, targetRole: 'note_block' };
  const evidence = { eventId: 'event-1', anchorId: 'atom-1',
    r1: { pageId: 'r1-page', traceId: 'r1-trace', active: true },
    r2: { coordinate: [0, 0, 0], active: true },
    r2a: { relationIds: ['relation-1'], applicability: 1, productionEligible: true,
      evidenceGrade: 'intervention-supported', predictionEligible: true } };
  const frozen = { annotations: [{ eventId: 'event-1', atomId: 'atom-1', pageId: 'r1-page',
    traceId: 'r1-trace' }], r2Store: { events: [{ atomIds: ['atom-1'], pageId: 'r2-page',
      traceId: 'r2-trace' }] }, r2a: { relations: [{ relationId: 'relation-1',
        grade: 'intervention-supported' }] } } as unknown as HierarchicalMemorySnapshotV1;
  const records = [{ kind: 'joint-control-decision', value: { lastDecision: { operation: 'execute', nodeId: 'n1' },
    workspace: { epoch: 1, observationSequence: 10, dependencies: [], nodes: [{
      node: { nodeId: 'n1', kind: 'experienced',
        candidate: { candidateId: 'candidate-1', actionCue: cue, evidence } },
      condition: { fresh: true, epoch: 1, observationSequence: 10, value: { productionEligible: true,
        applicability: 1, unknownFactorIds: [], contradictedFactorIds: [] } },
      prediction: { fresh: true, epoch: 1, observationSequence: 10, value: { currentEvidence: evidence,
        validSampleCount: 8, progressFraction: 1, nextStates: [] } },
    }] } } },
  { kind: 'control-action-result', value: { offer: { cue, observationSequence: 10,
    action: { kind: 'interact' } },
    result: { executed: true } } }];
  const audit = auditFrozenPhysicalActionEvidenceLiveV1(records, frozen);
  assert.equal(audit.passed, true);
  assert.equal(audit.actions.length, 1);
  assert.equal(audit.actions[0]!.fullyFrozenCandidateCount, 1);
});

test('post-hoc heldout audit rejects stale rollout or test-period candidate evidence', () => {
  const cue = { kind: 'interact' as const, parameters: {}, targetRole: 'note_block' };
  const frozen = ({ annotations: [{ eventId: 'frozen-event', atomId: 'frozen-atom', pageId: 'p', traceId: 't' }],
    r2Store: { events: [{ atomIds: ['frozen-atom'], pageId: 'r2p', traceId: 'r2t' }] },
    r2a: { relations: [{ relationId: 'frozen-relation', grade: 'intervention-supported' }] } } as unknown as HierarchicalMemorySnapshotV1);
  const testEvidence = { eventId: 'heldout-new-event', r1: { pageId: 'p2', traceId: 't2', active: true },
    r2: { active: true }, r2a: { productionEligible: true, relationIds: ['frozen-relation'] } };
  const records = [{ kind: 'joint-control-decision', value: { lastDecision: { operation: 'execute', nodeId: 'n' },
    workspace: { epoch: 3, observationSequence: 40, dependencies: [], nodes: [{ node: { nodeId: 'n', kind: 'experienced',
      candidate: { candidateId: 'new', actionCue: cue, evidence: testEvidence } },
    condition: { fresh: true, epoch: 3, observationSequence: 40, value: { productionEligible: true,
      applicability: 1, unknownFactorIds: [], contradictedFactorIds: [] } },
    prediction: { fresh: true, epoch: 3, observationSequence: 39, value: { currentEvidence: testEvidence,
      validSampleCount: 8, progressFraction: 1, nextStates: [] } } }] } } },
  { kind: 'control-action-result', value: { offer: { cue, observationSequence: 40,
    action: { kind: 'interact' } }, result: { executed: true } } }];
  const audit = auditFrozenPhysicalActionEvidenceLiveV1(records, frozen);
  assert.equal(audit.passed, false);
  assert(audit.actions[0]!.reasons.includes('missing-fresh-PredictionClone-at-execution'));
  assert(audit.actions[0]!.reasons.includes('no-member-has-frozen-R1-R2-intervention-R2A'));
});

test('post-hoc heldout audit rejects a successful non-observation exploration action', () => {
  const cue = { kind: 'look' as const, parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null };
  const frozen = ({ annotations: [], r2Store: { events: [] }, r2a: { relations: [] } } as unknown as HierarchicalMemorySnapshotV1);
  const records = [{ kind: 'joint-control-decision', value: { lastDecision: { operation: 'execute', nodeId: 'x' },
    workspace: { nodes: [{ node: { nodeId: 'x', kind: 'exploration', offer: { cue } } }] } } },
  { kind: 'control-action-result', value: { offer: { cue, action: { kind: 'look' } },
    result: { executed: true } } }];
  const audit = auditFrozenPhysicalActionEvidenceLiveV1(records, frozen);
  assert.equal(audit.passed, false);
  assert(audit.actions[0]!.reasons.includes('non-observation-action-came-from-exploration'));
  assert(audit.actions[0]!.reasons.includes('no-member-has-frozen-R1-R2-intervention-R2A'));
});

test('legacy V4 sealed hierarchy is audit-only after public-transition topology becomes persistent', async () => {
  const evidenceRoot = 'evidence/hierarchical-minecraft-short-chain-live-v1-r2a-topology-001';
  const snapshot = JSON.parse(await readFile(
    `${evidenceRoot}/FROZEN_HIERARCHICAL_EXPERIENCE.json`, 'utf8')) as HierarchicalMemorySnapshotV1;
  assert.equal((snapshot as { version: string }).version, 'KairosV5HierarchicalMemoryV4');
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(snapshot),
    /legacy-hierarchy-checkpoint-is-audit-only/);
});

test('live short-chain entry requires a fresh V13 evidence name and the runner audits empty current memory', async () => {
  const [entry, runner] = await Promise.all([
    readFile('scripts/run-minecraft-hierarchical-short-chain-live-v1.mjs', 'utf8'),
    readFile('src/evaluation/minecraft-hierarchical-short-chain-live-v1.ts', 'utf8'),
  ]);
  assert.doesNotMatch(entry, /attempt-009|transition-topology-repair-009/);
  assert.match(entry, /KAIROS_HIERARCHICAL_SHORT_CHAIN_EVIDENCE_NAME/);
  assert.match(entry, /hierarchical-minecraft-short-chain-live-v1-v13-attempt-/);
  assert.match(runner, /EMPTY_HIERARCHY_PREFLIGHT\.json/);
  assert.match(runner, /hierarchical-short-chain-did-not-start-from-empty-current-memory/);
  assert.match(runner, /hierarchical-heldout-did-not-restore-this-run-frozen-baseline/);
  assert.match(runner, /hierarchical-heldout-habit-was-not-empty/);
});
