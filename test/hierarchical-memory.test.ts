import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { cueIdentity, realEventHierarchyContinuityV1 } from '../src/events.js';
import { HierarchicalPhysicalMemoryV1, rebuildHierarchicalUpperLayersV1 } from '../src/hierarchical-memory.js';
import { R2AtomMeasurementAdapterV1 } from '../src/core/learning/r2-atom-measurement.js';
import { canonical, sha } from '../src/util.js';

type Mode = 'effect' | 'motion' | 'verify';

function calibrationSignal(index: number, step: number, mode: Mode): number {
  if (index >= 128) return 0;
  const t = Math.min(step, 15) / 15;
  return mode === 'effect' ? t : mode === 'motion' ? -t
    : index % 6 === 2 ? 0 : Math.sin(Math.PI * 2 * t);
}

function event(index: number, mode: Mode,
  boundaryBefore: 'continuous' | 'reset' | 'gap' | 'external-takeover' = 'continuous'): RealEvent {
  const frames: Observation[] = Array.from({ length: 21 }, (_unused, step) => ({
    sequence: index * 21 + step,
    activeSeconds: index * 1.1 + step * .05,
    self: { position: [0, mode === 'motion' ? Math.sin(Math.PI * step / 20) : 0, 0],
      yaw: 0, pitch: 0, properties: { grounded: mode !== 'motion' || step === 0 || step === 20 } },
    objects: [{ id: 'opaque-object-1', type: 'opaque-type', relativePosition: [1, 0, 0],
      properties: { state: mode === 'effect' && step >= 10,
        observablePhase: mode === 'effect' ? Math.min(step, 15) / 15
          : mode === 'motion' ? -Math.min(step, 15) / 15
            : 0,
        calibrationSignal: calibrationSignal(index, step, mode),
        publicLayoutBand: Math.floor(index / 3) % 8 } }],
    targetId: 'opaque-object-1', contextId: `opaque-context-${Math.floor(index / 3) % 8}`,
  }));
  const action: Action = mode === 'effect'
    ? { kind: 'interact' as const, parameters: {}, targetId: 'opaque-object-1' }
    : mode === 'motion' ? { kind: 'jump' as const, parameters: { forward: false, ticks: 4 } }
      : { kind: 'observe' as const, parameters: { ticks: 5 } };
  const bare: RealEvent = { version: 'RealEventV5', id: `hierarchical-event-${index}`,
    cue: { kind: action.kind, parameters: action.parameters, targetRole: mode === 'effect' ? 'opaque-type' : null },
    frames, trackedIds: ['self', 'opaque-object-1'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence,
      endSequence: frames.at(-1)!.sequence, terminationReason: 'stable' } };
  return { ...bare, hierarchyContinuity: realEventHierarchyContinuityV1(bare, 'hierarchy-session-1', boundaryBefore) };
}

function initializeR1Only(memory: HierarchicalPhysicalMemoryV1): void {
  for (let index = 0; index < 128; index++) {
    const mode: Mode = index % 3 === 0 ? 'effect' : index % 3 === 1 ? 'motion' : 'verify';
    memory.observe(event(index, mode, 'reset'));
  }
}

test('a sub-calibration checkpoint keeps empty physical clocks aligned and restores exactly', () => {
  const memory = new HierarchicalPhysicalMemoryV1();
  for (let index = 0; index < 32; index++) memory.observe(event(index, 'verify', 'reset'));
  const snapshot = memory.snapshot();

  assert.equal(snapshot.pendingInitialization.length, 32);
  assert.equal(snapshot.r1Store.atoms.length, 0);
  assert.equal(snapshot.r1Store.logicalTime, snapshot.activeSeconds);
  assert.equal(snapshot.r1Store.medium.logicalTime, snapshot.activeSeconds);
  assert.equal(snapshot.r2Store.medium.logicalTime, snapshot.activeSeconds);
  assert.equal(canonical(HierarchicalPhysicalMemoryV1.restore(snapshot).snapshot()), canonical(snapshot));
  const legacy = structuredClone(snapshot) as { version: string };
  legacy.version = 'KairosV5HierarchicalMemoryV1';
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(legacy as never),
    /legacy-hierarchy-checkpoint-is-audit-only/);
});

test('production hierarchy writes R1 immediately, R2 only at a real multi-atom boundary, and delays R2A', () => {
  const memory = new HierarchicalPhysicalMemoryV1();
  initializeR1Only(memory);
  const initialized = memory.snapshot();
  assert.equal(initialized.r1Store.atoms.length, 128);
  assert.equal(initialized.r2Store.events.length, 0);
  assert.equal(initialized.r2Store.medium.pages.length, 0);
  assert.equal(initialized.r2a?.patterns.length, 0);
  assert.equal(initialized.r2a?.r2aMedium.pages.flatMap(page => page.kernels).length, 0);

  memory.observe(event(128, 'effect', 'reset'));
  assert.equal(memory.snapshot().r2Store.events.length, 0);
  memory.observe(event(129, 'motion'));
  const open = memory.snapshot();
  assert.equal(open.r2Store.events.length, 0);
  assert.equal(open.r2Store.pending?.atoms.length, 2);
  assert.equal(open.r2Store.medium.pages.length, 0);

  memory.observe(event(130, 'verify'));
  const closed = memory.snapshot();
  assert.equal(closed.r2Store.events.length, 1);
  assert.deepEqual(closed.r2Store.events[0]!.sourceEventIds,
    ['hierarchical-event-128', 'hierarchical-event-129', 'hierarchical-event-130']);
  assert.deepEqual(closed.r2Store.events[0]!.orderedExperienceIdentities,
    [event(128, 'effect').cue, event(129, 'motion').cue, event(130, 'verify').cue].map(cueIdentity));
  assert.deepEqual(closed.r2a?.patterns[0]!.orderedExperienceIdentities,
    closed.r2Store.events[0]!.orderedExperienceIdentities);
  assert.deepEqual(closed.r2a?.patterns[0]!.orderedTransitionTopologyIds,
    closed.r2Store.events[0]!.orderedTransitionTopologyIds);
  assert.equal(closed.r2a?.evidence[0]!.atomPrePerceptions.length, 3);
  assert(closed.hierarchyReplayLedger.slice(-3).every((record, atomIndex) =>
    record.exactExperienceIdentity === closed.r2Store.events[0]!.orderedExperienceIdentities[atomIndex]
    && record.atom.publicTransitionTopologyId
      === closed.r2Store.events[0]!.orderedTransitionTopologyIds[atomIndex]
    && canonical(record.preEventPerception) === canonical(closed.r2a!.evidence[0]!.atomPrePerceptions[atomIndex])));
  assert.equal(closed.r2Store.events[0]!.physicalStatus, 'deposited');
  assert.equal(closed.r2a?.patterns.length, 1);
  assert.equal(closed.r2a?.patterns[0]!.grade, 'single-observation');
  assert.equal(closed.r2a?.r2aMedium.pages.flatMap(page => page.kernels).length, 0);
  assert.equal(canonical(HierarchicalPhysicalMemoryV1.restore(closed).snapshot()), canonical(closed));
});

test('eight independent complete R2 roads across four contexts create one predictive stable pattern read-only', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  for (let chain = 0; chain < 8; chain++) {
    const start = 128 + chain * 3;
    memory.observe(event(start, 'effect', 'reset'));
    memory.observe(event(start + 1, 'motion'));
    memory.observe(event(start + 2, 'verify'));
  }
  const snapshot = memory.snapshot(), before = sha(snapshot);
  assert.equal(snapshot.r2Store.events.filter(value => value.learningEligible).length, 8);
  assert.equal(snapshot.r2a?.patterns.length, 1);
  assert.equal(snapshot.r2a?.patterns[0]!.supportCount, 8);
  assert.equal(snapshot.r2a?.patterns[0]!.grade, 'predictive-stable');
  assert((snapshot.r2a?.patterns[0]!.contextIds.length ?? 0) >= 4);
  const observation = event(200, 'verify').frames[0]!;
  const goal = { version: 'GroundedGoalV1' as const, id: 'opaque-state-goal', expression: {
    kind: 'predicate' as const, predicate: { version: 'GoalPredicateV1' as const, id: 'opaque-state',
      subject: { kind: 'public-object' as const, id: 'opaque-object-1', expectedType: 'opaque-type' },
      observable: 'properties.state' as const, comparator: 'equals' as const, target: true } } };
  const evaluation = { goalId: goal.id, status: 'mismatch' as const, residual: 1,
    observationSequence: observation.sequence, predicates: [{ predicateId: 'opaque-state', status: 'mismatch' as const,
      residual: 1, actual: false, baseline: false, reason: null }] };
  const patterns = memory.recallContinuousPattern(goal, evaluation, observation);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0]!.evidenceGrade, 'predictive-stable');
  const atomic = memory.recallAtomicEffect(goal, evaluation, observation);
  assert(atomic.length > 0);
  const prediction = memory.predictCandidate(atomic[0]!, observation, goal, evaluation);
  assert(prediction.readoutDiagnostics);
  assert(Number.isSafeInteger(prediction.readoutDiagnostics.goalRelevantReadoutCount));
  assert.equal(sha(memory.snapshot()), before);
});

test('unsupported semantic boundary cannot be relabeled as a physical R2 completion', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  memory.observe(event(128, 'effect', 'reset')); memory.observe(event(129, 'motion'));
  const before = sha(memory.snapshot());
  assert.throws(() => memory.closeContinuity({ version: 'R2EventBoundaryV1', completion: 'complete',
    reason: 'goal-satisfied' as never }), /invalid-complete-R2-event-boundary/);
  assert.equal(sha(memory.snapshot()), before);
});

test('upper layers replay deterministically from the R1-derived continuity ledger and reject a tampered snapshot', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  for (let chain = 0; chain < 8; chain++) {
    const start = 128 + chain * 3;
    memory.observe(event(start, 'effect', 'reset'));
    memory.observe(event(start + 1, 'motion'));
    memory.observe(event(start + 2, 'verify'));
  }
  const snapshot = memory.snapshot();
  const rebuilt = rebuildHierarchicalUpperLayersV1(snapshot);
  assert.equal(canonical(rebuilt.r2Store), canonical(snapshot.r2Store));
  assert.equal(canonical(rebuilt.r2a), canonical(snapshot.r2a));

  const tampered = structuredClone(snapshot);
  (tampered.r2a!.patterns[0] as { grade: string }).grade = 'intervention-supported';
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(tampered),
    /R2A-checkpoint-pattern-invariant-failed|hierarchical-upper-state/);
  const tamperedIdentity = structuredClone(snapshot);
  Object.assign(tamperedIdentity.hierarchyReplayLedger.at(-2)!, { exactExperienceIdentity: 'opaque-substitution' });
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(tamperedIdentity),
    /upper-replay-record|upper-ledger|ordered-identity|hierarchical-upper-state/);
  const tamperedTransition = structuredClone(snapshot);
  Object.assign(tamperedTransition.annotations.at(-2)!, { publicTransitionTopologyId: 'f'.repeat(64) });
  Object.assign(tamperedTransition.hierarchyReplayLedger.at(-2)!.atom,
    { publicTransitionTopologyId: 'f'.repeat(64) });
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(tamperedTransition),
    /hierarchical-R1-annotation-identity-mismatch|upper-replay-record|upper-ledger/,
    'matching tampered persisted fields bypassed recomputation from real public changes');
  const tamperedMeasurement = structuredClone(snapshot);
  const measurementChange = tamperedMeasurement.annotations.at(-2)!.measurementChanges.flat()[0]!;
  Object.assign(measurementChange, { property: 'forged-measurement' });
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(tamperedMeasurement),
    /hierarchical-R1-annotation-identity-mismatch|upper-replay-record/,
    'tampered event-local measurement changes bypassed the compatibility/audit identities');
  const tamperedAudit = structuredClone(snapshot);
  Object.assign(tamperedAudit.annotations.at(-2)!, { publicTransitionTopologyAuditId: 'e'.repeat(64) });
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(tamperedAudit),
    /hierarchical-R1-annotation-identity-mismatch|upper-replay-record/,
    'a forged full topology audit identity was accepted');
  const legacyV7 = structuredClone(snapshot) as unknown as { version: string };
  legacyV7.version = 'KairosV5HierarchicalMemoryV7';
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(legacyV7 as never),
    /legacy-hierarchy-checkpoint-is-audit-only/,
    'an old world-axis topology checkpoint entered the writable production path');
  const legacyWithoutRoleProvenance = structuredClone(snapshot) as unknown as {
    version: string; annotations: { version: string; publicRoleBindings?: unknown }[] };
  legacyWithoutRoleProvenance.version = 'KairosV5HierarchicalMemoryV9';
  for (const annotation of legacyWithoutRoleProvenance.annotations) {
    annotation.version = 'R1ExperienceAtomV4';
    delete annotation.publicRoleBindings;
  }
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(legacyWithoutRoleProvenance as never),
    /R1-role-binding-provenance-missing/,
    'a legacy nonempty checkpoint guessed event-local role provenance during restore');

  const substitutedAdapter = structuredClone(snapshot);
  const adapter = substitutedAdapter.r2AtomAdapter!;
  const differentWeights = adapter.embedding.weights.map(row => [...row]);
  differentWeights[0]![0] = differentWeights[0]![0]! + 1e-6;
  Object.assign(adapter.embedding, { weights: differentWeights });
  const { identitySha256: _oldIdentity, ...adapterIdentity } = adapter;
  Object.assign(adapter, { identitySha256: sha(adapterIdentity) });
  assert.doesNotThrow(() => R2AtomMeasurementAdapterV1.restore(adapter));
  assert.throws(() => HierarchicalPhysicalMemoryV1.restore(substitutedAdapter),
    /legacy-R2A-graph-is-audit-only|hierarchical-upper-state-does-not-match-deterministic-R1-ledger-replay/,
  'a different qualified R2 coordinate map was accepted by an existing R2A topology');
});

test('continuation prediction requires the current ordered prefix and starts at its real endpoint', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  for (let chain = 0; chain < 8; chain++) {
    const start = 128 + chain * 3;
    memory.observe(event(start, 'effect', 'reset'));
    memory.observe(event(start + 1, 'motion'));
    memory.observe(event(start + 2, 'verify'));
  }
  const patternId = memory.snapshot().r2a!.patterns[0]!.patternId;
  memory.observe(event(152, 'effect', 'reset'));
  memory.observe(event(153, 'motion'));
  const prefix = memory.snapshot().r2Store.pending!.atoms.map(atom => atom.r2Coordinate);
  const before = sha(memory.snapshot());
  const prediction = memory.predictContinuation(patternId, event(154, 'verify').frames[0]!);
  assert.equal(prediction.samples.length, 24);
  assert.deepEqual(prediction.samples[0]!.positions[0], prefix.at(-1));
  assert(prediction.samples.every(sample => sample.readout.every(item => item.kernelIndex >= prefix.length)));
  assert.equal(sha(memory.snapshot()), before);

  memory.closeContinuity({ version: 'R2EventBoundaryV1', completion: 'censored', reason: 'continuity-reset' });
  memory.observe(event(155, 'motion', 'reset'));
  memory.observe(event(156, 'effect'));
  const wrong = memory.predictContinuation(patternId, event(157, 'verify').frames[0]!);
  assert.equal(wrong.samples.length, 0);
  assert(wrong.unknown.includes('real-prefix-experience-identity-mismatch'));
});

test('a censored R1 atom remains auditable but cannot be recalled as a complete effect', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  const observation = event(128, 'verify').frames[0]!;
  const query = { subject: 'opaque-type#0', property: 'state', value: true } as const;
  const before = memory.recall(query, observation) as { total: number };
  const source = event(128, 'effect', 'reset');
  const censored: RealEvent = { ...source, id: 'hierarchical-censored-effect',
    bodyResult: { ...source.bodyResult!, terminationReason: 'observation-limit' } };
  memory.observe(censored);
  const after = memory.recall(query, observation) as { total: number };
  assert.equal(after.total, before.total);
  assert.equal(memory.snapshot().annotations.at(-1)!.completion, 'censored');
});

test('a completed bounded no-effect window remains a complete R1 fact', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  const source = event(128, 'effect', 'reset');
  const boundedNoEffect: RealEvent = { ...source, id: 'hierarchical-bounded-no-effect',
    bodyResult: { ...source.bodyResult!, terminationReason: 'no-effect-window-complete' } };
  memory.observe(boundedNoEffect);
  const annotation = memory.snapshot().annotations.at(-1)!;
  assert.equal(annotation.eventId, boundedNoEffect.id);
  assert.equal(annotation.completion, 'complete');
});

test('two independently resolved no-change observations remain R1 atoms instead of a forced R2 road', () => {
  const memory = new HierarchicalPhysicalMemoryV1(); initializeR1Only(memory);
  memory.observe(event(128, 'verify', 'reset'));
  memory.observe(event(129, 'verify', 'continuous'));
  const snapshot = memory.snapshot();
  assert.equal(snapshot.annotations.length, 130);
  assert.equal(snapshot.r2Store.events.length, 0);
  assert.equal(snapshot.r2Store.pending, null);
});

test('new hierarchy ablations remove atomic recall at R1 and continuous recall at R2', () => {
  const observation = event(300, 'verify').frames[0]!;
  const goal = { version: 'GroundedGoalV1' as const, id: 'opaque-ablation-goal', expression: {
    kind: 'predicate' as const, predicate: { version: 'GoalPredicateV1' as const, id: 'opaque-ablation-predicate',
      subject: { kind: 'public-object' as const, id: 'opaque-object-1', expectedType: 'opaque-type' },
      observable: 'properties.state' as const, comparator: 'equals' as const, target: true } } };
  const evaluation = { goalId: goal.id, status: 'mismatch' as const, residual: 1,
    observationSequence: observation.sequence, predicates: [{ predicateId: 'opaque-ablation-predicate',
      status: 'mismatch' as const, residual: 1, actual: false, baseline: false, reason: null }] };

  const atomic = new HierarchicalPhysicalMemoryV1(); initializeR1Only(atomic);
  assert(atomic.recallAtomicEffect(goal, evaluation, observation).length > 0);
  atomic.ablateForTest('R1');
  assert.equal(atomic.recallAtomicEffect(goal, evaluation, observation).length, 0);

  const continuous = new HierarchicalPhysicalMemoryV1(); initializeR1Only(continuous);
  for (let chain = 0; chain < 8; chain++) {
    const start = 128 + chain * 3;
    continuous.observe(event(start, 'effect', 'reset'));
    continuous.observe(event(start + 1, 'motion'));
    continuous.observe(event(start + 2, 'verify'));
  }
  assert.equal(continuous.recallContinuousPattern(goal, evaluation, observation).length, 1);
  continuous.ablateForTest('R2');
  assert.equal(continuous.recallContinuousPattern(goal, evaluation, observation).length, 0);
});
