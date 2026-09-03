import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BodyResult, Observation, RealEvent } from '../src/contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { cueFor, realEventHierarchyContinuityV1 } from '../src/events.js';
import { auditDistributedG6BaselineV1, auditTrustedHistoryContinuityV1,
  DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1, distributedG6MultilevelGateV1,
  distributedG6PreflightV1, type DistributedGateIdentityAuditV1,
  type DistributedNeutralGateStatusV1, type TrustedHistoryContinuityAuditV1 }
  from '../src/evaluation/minecraft-distributed-g6-live-v1.js';
import { fileSha } from '../src/util.js';

const gates = (passed: boolean): DistributedNeutralGateStatusV1 => ({
  version: 'DistributedNeutralGateStatusV1', sourceIdentitySha256: 'a'.repeat(64),
  evidenceManifestSha256: 'b'.repeat(64),
  gates: Object.fromEntries((['G0', 'G1', 'G2', 'G3', 'G4', 'G5'] as const)
    .map(id => [id, { passed, evidenceRefs: passed ? [`${id}.json`] : [] }])) as
    unknown as DistributedNeutralGateStatusV1['gates'],
});

const gateIdentity = (passed: boolean): DistributedGateIdentityAuditV1 => ({
  version: 'DistributedGateIdentityAuditV1', passed,
  currentSourceIdentitySha256: 'a'.repeat(64), declaredSourceIdentitySha256: 'a'.repeat(64),
  evidenceManifestPath: 'gate-manifest.json', evidenceManifestSha256: 'b'.repeat(64),
  verifiedEvidenceRefs: passed ? ['G0.json', 'G1.json', 'G2.json', 'G3.json', 'G4.json', 'G5.json'] : [],
  blockers: passed ? [] : ['source-mismatch'],
});

const r1OnlyHistory = (count = 256): TrustedHistoryContinuityAuditV1 => ({
  version: 'TrustedHistoryContinuityAuditV1', sourcePath: 'REBUILD_AUDIT.json',
  executedBodyResults: count, realEventRecords: count, recordsWithExplicitHierarchyContinuity: 0,
  invalidRealEventRecords: 0, duplicateRealEventRecords: 0, unmatchedExecutedBodyResults: 0,
  replayableR1Candidates: count, replayableContinuousR2Events: 0,
  sourceEventsSha256: 'c'.repeat(64), expectedSourceEventsSha256: 'c'.repeat(64), verified: true,
  verificationScope: 'trusted-R1-rebuild-audit', conclusion: 'R1-only',
  reason: 'attempt-018-R1-only-new-continuous-capture-required',
});

test('G6 preflight accepts only the new distributed snapshot identity and does not treat R1 as R2', () => {
  const snapshot = new DistributedHierarchicalPhysicalMemoryV1().snapshot();
  const audit = auditDistributedG6BaselineV1(snapshot);
  assert.equal(audit.compatibleSnapshot, true);
  assert.equal(audit.deterministicRestore, true);
  assert.equal(audit.r1EventCount, 0);
  assert.equal(audit.completeR2EventCount, 0);
  assert.equal(audit.readyForFrozenHeldout, false);
  assert.ok(audit.blockers.includes('fewer-than-eight-complete-multi-R1-R2-events'));
  const preflight = distributedG6PreflightV1(gates(true), snapshot, r1OnlyHistory(), gateIdentity(true));
  assert.equal(preflight.passed, false);
  assert.equal(preflight.nextStep, 'capture-minimum-continuous-experience');
  assert.equal(preflight.minimumCapture?.completeContinuousEvents, 32);
  assert.equal(preflight.minimumCapture?.scoringLabelsWrittenToMedium, 0);
});

test('G6 neutral gate cannot be bypassed by a compatible but insufficient snapshot', () => {
  const snapshot = new DistributedHierarchicalPhysicalMemoryV1().snapshot();
  const preflight = distributedG6PreflightV1(gates(false), snapshot, null, gateIdentity(false));
  assert.equal(preflight.passed, false);
  assert.equal(preflight.nextStep, 'complete-neutral-gates');
});

test('trusted history audit does not promote adjacent attempt records without explicit continuity', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.g6-history-test-'));
  try {
    const path = resolve(directory, 'events.jsonl');
    await writeFile(path, [
      JSON.stringify({ kind: 'body-result', value: { action: { kind: 'observe', parameters: { ticks: 5 } },
        executed: true, status: 'completed', startSequence: 1, endSequence: 4 } }),
      JSON.stringify({ kind: 'body-result', value: { action: { kind: 'observe', parameters: { ticks: 5 } },
        executed: true, status: 'completed', startSequence: 4, endSequence: 9 } }),
    ].join('\n') + '\n');
    const audit = await auditTrustedHistoryContinuityV1(path);
    assert.equal(audit.executedBodyResults, 2);
    assert.equal(audit.replayableR1Candidates, 0);
    assert.equal(audit.replayableContinuousR2Events, 0);
    assert.equal(audit.verified, false);
    assert.equal(audit.conclusion, 'R1-only');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an arbitrary nested continuity-shaped object is not promoted to a real event', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.g6-continuity-test-'));
  try {
    const path = resolve(directory, 'events.jsonl');
    await writeFile(path, JSON.stringify({ kind: 'diagnostic', value: { nested: { complete: true,
      hierarchyContinuity: { boundaryBefore: 'continuous', dependencies: [{ kind: 'public-state' }] } } } }) + '\n');
    const audit = await auditTrustedHistoryContinuityV1(path);
    assert.equal(audit.recordsWithExplicitHierarchyContinuity, 0);
    assert.equal(audit.replayableContinuousR2Events, 0);
    assert.equal(audit.conclusion, 'R1-only');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('modern wrapped real events are deduplicated exactly and form only verified explicit chains', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.g6-wrapped-continuity-test-'));
  try {
    const observation = (sequence: number, yaw: number): Observation => ({ sequence,
      activeSeconds: sequence * .05, contextId: 'held-public-layout', objects: [], targetId: null,
      self: { position: [0, 64, 0], yaw, pitch: 0, properties: { onGround: true } } });
    const makeEvent = (id: string, action: BodyResult['action'], frames: readonly Observation[],
      process: 'open' | 'publicly-resolved'): RealEvent => {
      const receipt: BodyResult = { action, executed: true, status: 'completed',
        startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence,
        terminationReason: action.kind === 'observe' ? 'no-effect-window-complete' : 'stable' };
      const raw: RealEvent = { version: 'RealEventV5', id, cue: cueFor(action, frames[0]!), frames,
        trackedIds: ['self'], bodyResult: receipt, provenance: 'executed-real-body', complete: true };
      const generated = realEventHierarchyContinuityV1(raw, 'wrapped-session', 'continuous');
      assert.equal(generated.processStatusAfter, process);
      return { ...raw, hierarchyContinuity: generated };
    };
    const first = makeEvent('wrapped-1', { kind: 'look',
      parameters: { yawDeltaDegrees: 15, pitchDeltaDegrees: 0 } },
    [observation(1, 0), observation(2, .25)], 'open');
    const second = makeEvent('wrapped-2', { kind: 'observe', parameters: { ticks: 5 } },
      [observation(2, .25), observation(3, .25)], 'publicly-resolved');
    const path = resolve(directory, 'events.jsonl');
    await writeFile(path, [
      { kind: 'body-result', value: { caseId: 'case-a', value: first.bodyResult } },
      { kind: 'real-event', value: { caseId: 'case-a', value: first } },
      { kind: 'diagnostic', value: { nested: { hierarchyContinuity: first.hierarchyContinuity } } },
      { kind: 'body-result', value: { caseId: 'case-a', value: second.bodyResult } },
      { kind: 'real-event', value: { caseId: 'case-a', value: second } },
      { kind: 'real-event', value: { caseId: 'case-a', value: first } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const sourceSha = await fileSha(path);
    const audit = await auditTrustedHistoryContinuityV1(path, sourceSha);
    assert.equal(audit.verified, true);
    assert.equal(audit.realEventRecords, 3);
    assert.equal(audit.duplicateRealEventRecords, 1);
    assert.equal(audit.invalidRealEventRecords, 0);
    assert.equal(audit.recordsWithExplicitHierarchyContinuity, 3);
    assert.equal(audit.replayableR1Candidates, 2);
    assert.equal(audit.replayableContinuousR2Events, 1);
    assert.equal(audit.unmatchedExecutedBodyResults, 0);
    assert.equal(audit.conclusion, 'continuous-evidence-present');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing verified history never passes G6 preflight', () => {
  const snapshot = new DistributedHierarchicalPhysicalMemoryV1().snapshot();
  const preflight = distributedG6PreflightV1(gates(true), snapshot, null, gateIdentity(true));
  assert.equal(preflight.passed, false);
  assert.equal(preflight.nextStep, 'provide-verified-trusted-history');
});

test('an old V10 snapshot is rejected without reading distributed fields', () => {
  const audit = auditDistributedG6BaselineV1({ version: 'KairosV5HierarchicalMemoryV10' });
  assert.equal(audit.compatibleSnapshot, false);
  assert.equal(audit.readyForFrozenHeldout, false);
  assert.ok(audit.blockers.includes('snapshot-version-is-not-distributed-v2'));
});

test('heldout contract contains only fixture geometry and never an injected action sequence', () => {
  assert.equal(DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1.length, 4);
  const text = JSON.stringify(DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1);
  assert.equal(text.includes('actionSequence'), false);
  assert.equal(text.includes('expectedActions'), false);
  assert.deepEqual(new Set(DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1.map(value => value.layout.side)),
    new Set(['south', 'east', 'north', 'west']));
});

test('multilevel gate opens only after four verified frozen-baseline short-chain cases', () => {
  const caseResult = (index: number, verified = true) => ({ caseId: `case-${index}`,
    status: verified ? 'goal-verified' : 'budget-exhausted', actions: 3,
    noteVerifiedTwice: verified, onlyGroundedGoalInjected: true as const,
    frozenBaselineUnchanged: true });
  assert.equal(distributedG6MultilevelGateV1({ shortChainPassed: true,
    heldouts: [0, 1, 2, 3].map(index => caseResult(index)) }).unlocked, true);
  assert.equal(distributedG6MultilevelGateV1({ shortChainPassed: false,
    heldouts: [0, 1, 2, 3].map(index => caseResult(index)) }).unlocked, false);
  assert.equal(distributedG6MultilevelGateV1({ shortChainPassed: true,
    heldouts: [0, 1, 2, 3].map(index => caseResult(index, index !== 2)) }).unlocked, false);
});
