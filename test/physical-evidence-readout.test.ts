import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { Action, ActionCue, BodyResult, Observation, PublicChange, RealEvent } from '../src/contracts.js';
import type { MinecraftBody } from '../src/body.js';
import type { Compute } from '../src/compute.js';
import type { Configuration } from '../src/services.js';
import { AnalysisCore } from '../src/analysis.js';
import { CognitiveWorkspace, publicEvidenceData } from '../src/cognitive-workspace.js';
import { PhysicalMemory, readVisitedRegions, type MemorySnapshot } from '../src/memory.js';
import { V5Runtime } from '../src/runtime.js';
import { cueFor, cueIdentity, eventRows, relativePublicFeatures } from '../src/events.js';
import { canonical, fileSha, sha } from '../src/util.js';
import { ObservationGate, emptyFirewallRejections, emptyLeakageAudit } from '../src/core/firewall.js';
import { ExperienceMediaStore } from '../src/core/learning/experience-store.js';
import { r1RouteSignature } from '../src/core/learning/path-projector.js';
import { DeterministicTokenFieldEncoder } from '../src/core/learning/token-field.js';
import { OpenCausalFactorR2A } from '../src/core/learning/open-causal-factor-r2a.js';
import { ActionConditionedRuleQuery } from '../src/core/learning/action-conditioned-rule-query.js';
import { PredictionClone } from '../src/core/prediction/prediction-clone.js';
import { PhysicalMedium3D } from '../src/core/physics/physical-medium.js';
import { R1_CONFIG } from '../src/core/config.js';
import type { R3CausalEvaluation } from '../src/core/learning/causal-contrast.js';

const config = { actionBudget: 512, analysis: { baseUrl: 'http://127.0.0.1:18080/v1', context: 8192,
  maximumOutputTokens: 768, timeoutMs: 2000, nativeThinking: false, temperature: 0, topP: 1,
  topK: 0, minP: 0, presencePenalty: 0, seed: 1 } } as Configuration;
const frame = (sequence: number, slot = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'synthetic-binding-test', targetId: null, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot: slot } } });
const change = (before: number, after: number, observationIndex: number): PublicChange => ({
  subject: 'self', property: 'selectedSlot', before, after, observationIndex, meaning: 'observed-co-occurrence' });
const cue: ActionCue = { kind: 'select-hotbar', parameters: { slot: 2 }, targetRole: null };
const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
const activeEvent = (frames: readonly Observation[], a: Action = action): RealEvent => ({
  version: 'RealEventV5', id: 'synthetic-binding-event', cue: cueFor(a, frames[0]!), frames,
  trackedIds: ['self'], bodyResult: { action: a, executed: true, status: 'completed',
    startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence },
  provenance: 'executed-real-body', complete: true });

// Existing real Runtime/Monitor/Memory boundaries; only the body and worker transport are in memory.
// No model request, game process, 128 initialization, file save or replacement physics.
function runtimeFixture() {
  const memory = new PhysicalMemory(), records: { kind: string; value: any }[] = [];
  let current = frame(1), queryTail: (() => void) | undefined;
  let recallOutput: unknown;
  let execute: (a: Action) => Promise<{ result: BodyResult; event: RealEvent | null }> = async () => { throw new Error('unexpected-offline-body-call'); };
  const body = Object.assign(new EventEmitter(), { check() {}, latest: () => current,
    execute: (a: Action) => execute(a), async close() {} });
  const calls: { method: string; args: any[] }[] = [];
  const compute = { async call(method: string, ...args: any[]) {
    calls.push({ method, args });
    if (method === 'observe') return memory.observe(args[0]);
    if (method === 'advance') return memory.advanceTo(args[0]);
    if (method === 'snapshot') return memory.snapshot();
    if (method === 'recall') { const r = recallOutput ?? memory.recall(args[0], args[1], args[2]); queryTail?.(); return r; }
    if (method === 'predict') { const r = memory.predict(args[0], args[1], args[2]); if (!args[2]?.prefix) queryTail?.(); return r; }
    throw new Error(`unexpected-offline-worker-call:${method}`);
  }, async close() {} };
  const runtime = new V5Runtime(body as unknown as MinecraftBody, config,
    'D:/Kairos_V5_Predictive_Agent/tmp/no-save-in-evidence-readout-tests',
    (kind, value) => records.push({ kind, value }), { compute: compute as unknown as Compute,
      analysisHooks: { beforeModelRequest() { throw new Error('offline-test-forbids-model-request'); } } });
  runtime.analysis.workspace.startGoal('offline evidence contract, not a model qualification');
  return { runtime, memory, records, calls, current: () => current,
    push(f: Observation) { current = f; body.emit('frame', f); },
    executeWith(f: typeof execute) { execute = f; },
    duringQuery(f: () => void) { queryTail = f; },
    recallReturns(value: unknown) { recallOutput = value; } };
}
async function tool(core: AnalysisCore, name: string, args: unknown): Promise<any> {
  const entry = core.agent.state.tools.find(t => t.name === name)!;
  const result = await entry.execute('offline-contract-test', args, new AbortController().signal);
  return JSON.parse((result.content[0] as { text: string }).text);
}

test('real event-1 replay: production action formatting and public paging preserve all 100 ordered changes', async t => {
  const path = 'evidence/action-boundary-observation-order-minimal-repair-v1/short-loop-001/events.jsonl';
  assert.equal(await fileSha(path), 'ca972a5be67f16c4b0ff0b7fa461fab0ac676b26f0315c0d928a0b3b3b500956');
  const log = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const event = log.find(r => r.kind === 'real-event' && r.value.id === 'event-1').value as RealEvent;
  const expected = eventRows(event).changes.flat().map(c => ({ ...c,
    observationSequence: event.frames[c.observationIndex]!.sequence, activeSeconds: event.frames[c.observationIndex]!.activeSeconds }));
  const s = runtimeFixture(); s.push(event.frames[0]!);
  s.executeWith(async () => { event.frames.slice(1).forEach(f => s.push(f)); return { result: event.bodyResult!, event }; });
  try {
    const result = await tool(s.runtime.analysis, 'execute_chain', { actions: [event.bodyResult!.action] });
    const w = s.runtime.analysis.workspace, stored = w.evidence(result.evidenceRef).data as any;
    const preview = result.summary.results[0].publicChanges;
    t.diagnostic(JSON.stringify({ case: 'real-event-1', source: path, expectedCount: expected.length,
      storedCount: stored.results[0].publicChanges.length, preview, originalChanges: expected,
      modelCalls: s.runtime.analysis.calls, buffered: s.memory.bufferedEvents, physicalWrites: s.memory.writes }));
    assert.equal(expected.length, 100);
    assert.deepEqual(stored.results[0].publicChanges, expected);
    assert.equal(preview.total, 100); assert.equal(preview.items.length, 4);
    assert.deepEqual(preview.coveredRange, [0, 4]);
    assert.deepEqual(preview.more, { tool: 'read_context', arguments: { reference: result.evidenceRef, field: '/data/results/0/publicChanges', offset: 4, limit: 4 } });
    const pages: any[] = []; let offset: number | null = 0;
    while (offset !== null) {
      const page = await tool(s.runtime.analysis, 'read_context', { reference: result.evidenceRef,
        field: '/data/results/0/publicChanges', offset, limit: 12 });
      pages.push(...page.selectedValue); offset = page.page.nextOffset;
    }
    assert.deepEqual(pages, expected);
    assert(pages.some(c => c.observationSequence === 1281 && c.property === 'onGround' && c.after === false));
    assert(pages.some(c => c.observationSequence === 1281 && c.property === 'velocityY' && typeof c.after === 'number' && c.after > 0));
    assert(pages.some(c => c.property === 'velocityY' && typeof c.before === 'number' && typeof c.after === 'number' && c.before > 0 && c.after < 0));
    assert(pages.some(c => c.observationSequence === 1292 && c.property === 'onGround' && c.after === true));
    assert.equal(stored.results[0].completeChangeRecord, undefined);
    assert.equal(s.runtime.analysis.calls, 0); assert.equal(s.memory.bufferedEvents, 1); assert.equal(s.memory.writes, 0);
    t.diagnostic(JSON.stringify({ case: 'real-event-1-pages', pages, expectedSha256: sha(expected), pagedSha256: sha(pages) }));
  } finally { await s.runtime.close(); }
});

for (const query of ['recall-empty', 'recall-history', 'predict-empty'] as const)
test(`${query}: tool evidence binds captured A, neither stale workspace B nor newer body C`, async t => {
  const s = runtimeFixture(), B = frame(1), A = frame(2), C = frame(3);
  s.push(B); s.runtime.analysis.workspace.observe({ sequence: B.sequence, activeSeconds: B.activeSeconds }); s.push(A);
  if (query === 'recall-history') s.recallReturns({ kind: 'historical-observation', candidates: [{ eventId: 'synthetic-past',
    actualObserved: [change(7, 4, 9)], historicalOccurrence: { endActiveSeconds: .01, observationSequence: null } }] });
  s.duringQuery(() => s.push(C));
  try {
    const name = query.startsWith('recall') ? 'recall' : 'predict';
    const r = await tool(s.runtime.analysis, name, name === 'recall' ? { desiredChange: { subject: 'self' } } : { action });
    const w = s.runtime.analysis.workspace, e = w.evidence(r.evidenceRef) as any, page = w.readPublic(e.ref) as any;
    const material = JSON.parse(w.material().text).evidence.find((x: any) => x.ref === e.ref);
    t.diagnostic(JSON.stringify({ case: query, B, A, C, tool: r, evidence: e, page, material }));
    for (const value of [r, e, e.data, w.publicSummary(e.ref), page, material]) {
      assert.equal(value.observationSequence, A.sequence); assert.equal(value.activeSeconds, A.activeSeconds);
    }
    assert.equal(s.current().sequence, C.sequence);
    assert.equal(s.memory.snapshot().activeSeconds, A.activeSeconds);
    assert.equal(s.memory.writes, 0); assert.equal(s.runtime.analysis.calls, 0);
    if (query === 'recall-history') assert.equal((publicEvidenceData(e.kind, e.data) as any).candidates[0].historicalOccurrence.endActiveSeconds, .01);
  } finally { await s.runtime.close(); }
});

test('action receipt/end clock is separate from a newer trailing public observation; no-effect remains a real event', async t => {
  const s = runtimeFixture(); s.push(frame(1));
  const event = activeEvent([frame(1), frame(2)]);
  s.executeWith(async () => { s.push(frame(2)); s.push(frame(3)); return { result: event.bodyResult!, event }; });
  try {
    const r = await tool(s.runtime.analysis, 'execute_chain', { actions: [action] });
    const e = s.runtime.analysis.workspace.evidence(r.evidenceRef) as any;
    t.diagnostic(JSON.stringify({ case: 'action-end-versus-public-tail', result: r, evidence: e }));
    assert.equal(e.observationSequence, 2); assert.equal(e.activeSeconds, .1);
    assert.deepEqual(e.data.results[0].observationWindow, [1, 2]);
    assert.equal(e.data.results[0].startActiveSeconds, .05); assert.equal(e.data.results[0].endActiveSeconds, .1);
    assert.equal(e.data.publicObservation.sequence, 3); assert.equal(e.data.publicObservation.activeSeconds, .15);
    assert.equal(e.data.results[0].executed, true);
    assert.equal(e.data.results[0].publicChanges.length, 1);
    assert.equal(e.data.results[0].publicChanges[0].before, false);
    assert.equal(e.data.results[0].publicChanges[0].after, false);
    assert.equal(s.memory.bufferedEvents, 1); assert.equal(s.memory.writes, 0);
  } finally { await s.runtime.close(); }
});

test('a fixture result with no acquisition source remains explicitly unknown rather than inheriting workspace time', async () => {
  const core = new AnalysisCore(config.analysis, { context: () => ({}), observe: async () => ({}), execute: async () => ({}),
    recall: async () => ({ candidates: [] }), predict: async () => ({ samples: [] }) }, () => {});
  core.workspace.startGoal('unknown fixture provenance'); core.workspace.observe({ sequence: 900, activeSeconds: 45 });
  for (const name of ['recall', 'predict']) {
    const r = await tool(core, name, name === 'recall' ? { desiredChange: {} } : { action });
    assert.equal(r.observationSequence, null); assert.equal(r.activeSeconds, null);
  }
});

/** Tiny numeric port fixture, NOT a trained event map or an R2A-learning qualification.
 * Real store, R1/R2 basins, original query and Clone are used. Only R3 conditions and
 * the untrained representation state are synthetic; no production bypass is added.
 */
function physicalPortFixture(t: TestContext, conditional = true) {
  const store = new ExperienceMediaStore(), gate = new ObservationGate(emptyLeakageAudit(), emptyFirewallRejections());
  const prefix = activeEvent([frame(1, 0), frame(2, 1)]);
  const keys = [...new Set(eventRows(prefix).rows.flatMap(row => Object.keys(row)))];
  const tokenEncoder = { width: 256 as const, frozen: true as const, inputMean: Array(256).fill(0), inputDeviation: Array(256).fill(1) };
  const encoder = DeterministicTokenFieldEncoder.fromState(tokenEncoder);
  const annotations: MemorySnapshot['annotations'][number][] = [];
  const path = [0, .05, .10, .15].map(x => new Float64Array([x, 0, 0]));
  for (let i = 0; i < 16; i++) {
    const r2 = new Float64Array([i % 2 === 0 ? -1 : 1, 0, 0]);
    const anchorId = `experience-anchor-${String(i + 1).padStart(6, '0')}`;
    const trusted = gate.admit({ trajectory: path, perception: new Float64Array(256),
      r1State: { position: path[0]!, velocity: new Float64Array([1, 0, 0]), causalPrefix: path.slice(0, 2), observedAt: 0,
        numericAttributes: new Float64Array() },
      provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true, containsSimulatorPrivate: false,
        containsFutureObservation: false, containsSemanticRuleOrResult: false } });
    const receipt = store.writeEvent(trusted, r1RouteSignature(path), r2, anchorId, 1, 'current-model-time');
    annotations.push({ eventId: `synthetic-port-${i}`, anchorId, pageId: receipt.r1PageId, traceId: receipt.r1TraceId,
      cue, context: relativePublicFeatures(frame(1, i % 2)), contextId: 'synthetic-not-a-real-layout', r2Coordinate: [...r2],
      kernelChanges: [[], [change(0, 1, 1)], [change(1, 2, 2)], [change(2, 0, 3)]] });
  }
  const snapshot: MemorySnapshot = { ...new PhysicalMemory().snapshot(), store: store.exportCheckpointState(), annotations,
    seenEventIds: annotations.map(a => a.eventId), writes: 16, contextKeys: ['self/selectedSlot'],
    eventMap: { keys, mean: keys.map(() => 0), deviation: keys.map(() => 1), landmarks: [keys.map(() => 0)],
      weights: [[.05, 0], [0, 0], [0, 0]], bandwidth: 1, scale: 1 },
    projector: { landmarks: [[0, 0, 0]], bandwidth: 1, weights: [[0, 0], [0, 0], [0, 0]], diagnostics: {
      geometryDistanceCorrelation: 0, causalPrefixRootMeanSquaredDistance: 0, outputDimensions: 3, landmarkCount: 1 } },
    tokenEncoder, r2a: new OpenCausalFactorR2A(encoder).exportState() };
  const evaluation: R3CausalEvaluation = { scoreByOutcomeMode: new Map(), outcomeCoordinates: new Map(),
    matches: conditional ? [{ matchId: 'synthetic-match', relationId: 'synthetic-relation', inputModeId: 'test-only', inputPole: 1,
      relationReliability: .9, contextMatch: .9, residualMatch: .9, relationApplicability: .9, confidence: .9 }] : [],
    relationIds: conditional ? ['synthetic-relation'] : [], scoreByExperienceAnchor: new Map(conditional
      ? annotations.map((a, i) => [a.anchorId, { score: i % 2 === 0 ? 3.6 : -3.6, matchId: 'synthetic-match' }]) : []) };
  t.mock.method(OpenCausalFactorR2A.prototype, 'evaluate', () => evaluation);
  t.mock.method(OpenCausalFactorR2A.prototype, 'productionRelationsForAudit', () => conditional
    ? [{ hyperedgeId: 'synthetic-relation', state: 'stable', interventionKey: cueIdentity(cue) }] as any : []);
  const queries: any[] = [], original = ActionConditionedRuleQuery.prototype.query;
  t.mock.method(ActionConditionedRuleQuery.prototype, 'query', function (this: ActionConditionedRuleQuery,
    ...args: Parameters<ActionConditionedRuleQuery['query']>) {
    const result = original.apply(this, args); queries.push({ eligible: args[2], result }); return result;
  });
  return { memory: PhysicalMemory.restore(snapshot), snapshot, store, annotations, queries, prefix };
}

test('historical matching changes retain repetitions and reversals, not just the last value of each property', t => {
  const s = physicalPortFixture(t), before = sha(s.memory.snapshot());
  const raw = s.memory.recall({ subject: 'self', property: 'selectedSlot', direction: 'change' }, frame(4)) as any;
  t.diagnostic(JSON.stringify({ case: 'historical-process', raw }));
  assert.deepEqual(raw.candidates[0].actualObserved, [change(0, 1, 1), change(1, 2, 2), change(2, 0, 3)]);
  assert.equal(raw.candidates[0].actualObservedScope, 'matching-historical-changes');
  const w = new CognitiveWorkspace(); w.startGoal('historical matching material');
  const e = w.addEvidence('historical-experience', 'recall', raw);
  assert.deepEqual((w.readPublic(e.ref, '/data/candidates/0/actualObserved') as any).selectedValue, raw.candidates[0].actualObserved);
  assert.equal(raw.candidates[0].historicalOccurrence.endActiveSeconds, 0);
  assert.equal(sha(s.memory.snapshot()), before);
});

test('each history keeps its signed physical query contribution; action aggregate cannot replace it', t => {
  const s = physicalPortFixture(t), before = sha(s.memory.snapshot());
  const raw = s.memory.recall({ property: 'selectedSlot' }, frame(4)) as any;
  const published = publicEvidenceData('historical-experience', raw) as any;
  t.diagnostic(JSON.stringify({ case: 'per-history-conditional-query', fixture: 'synthetic-R3-not-learning', queries: s.queries, raw, published }));
  assert(s.queries.every(q => q.eligible.length === 16), 'do not renormalize a single selected history');
  const expected = s.queries[0].result.query.contributions;
  for (let i = 0; i < 2; i++) {
    const historical = raw.candidates[i], publicHistory = published.candidates[i];
    const c = historical.currentApplicability.contributions[0];
    assert.equal(c.r3CausalScore, i === 0 ? 3.6 : -3.6);
    assert.equal(c.weight, expected.find((q: any) => q.r1Trace.pageId === historical.r1.pageId && q.r1Trace.traceId === historical.r1.traceId).weight);
    assert.equal(c.causalMultiplier, Math.exp(i === 0 ? 3.6 : -3.6));
    assert.equal(historical.currentApplicability.coreEvidenceSupport, undefined);
    assert(Math.abs(historical.actionAggregateSupport.coreEvidenceSupport - .9) < 1e-12);
    assert.equal(publicHistory.currentApplicability.contributions[0].r3CausalScore, c.r3CausalScore);
    assert.equal(publicHistory.currentApplicability.contributions[0].weight, c.weight);
    assert.equal(publicHistory.currentApplicability.contributions[0].matchedRelations[0].state, 'stable');
    assert.equal(publicHistory.actionAggregateSupport.coreEvidenceSupport, historical.actionAggregateSupport.coreEvidenceSupport);
  }
  const w = new CognitiveWorkspace(); w.startGoal('conditional evidence'); const e = w.addEvidence('historical-experience', 'recall', raw);
  const paged = w.readPublic(e.ref, '/data/candidates/1/currentApplicability/contributions') as any;
  assert.equal(paged.selectedValue[0].r3CausalScore, -3.6);
  assert(!canonical(published).includes('r1-trace-')); assert(!canonical(published).includes('synthetic-relation'));
  assert.equal(sha(s.memory.snapshot()), before);
});

test('unsupported genuine history is retained; no matching relation is not support, and erased R1/R2 cannot support recall', t => {
  const s = physicalPortFixture(t, false), raw = s.memory.recall({ property: 'selectedSlot' }, frame(4)) as any;
  t.diagnostic(JSON.stringify({ case: 'no-current-condition', raw }));
  assert.equal(raw.total, 16); assert.equal(raw.candidates.length, 2);
  for (const c of raw.candidates) {
    assert.equal(c.actionAggregateSupport.coreEvidenceSupport, 0);
    assert.equal(c.currentApplicability.contributions[0].r3CausalScore, 0);
    assert.equal(c.currentApplicability.contributions[0].matchedRelations.length, 0);
    assert(c.unknown.includes('historical-only-no-current-R2A-support'));
  }
  for (const medium of ['R1', 'R2'] as const) {
    const erased = PhysicalMemory.restore(s.snapshot); erased.ablateForTest(medium);
    assert.equal((erased.recall({ property: 'selectedSlot' }, frame(4)) as any).total, 0);
  }
});

test('factual readout excludes observed boundary labels without removing competing physical kernels', t => {
  const medium = new PhysicalMedium3D(R1_CONFIG), page = medium.createPage();
  const path = [0, .05, .10].map(x => new Float64Array([x, 0, 0]));
  medium.depositOrderedTrajectory(page, path, 1, 'synthetic-boundary');
  const full = medium.traceSnapshot(page, 'synthetic-boundary')!;
  const tail = { ...full, kernels: full.kernels.slice(1) }, labels = [[change(0, 1, 1)], [change(1, 2, 2)]];
  const boundary = { kernelOffset: 1, observedThroughOriginalKernelIndex: 1 };
  const before = sha(tail);
  const cases = [
    { name: 'stationary', positions: [path[1]!, path[1]!, path[1]!] },
    { name: 'return-to-observed', positions: [path[1]!, new Float64Array([1, 1, 1]), path[1]!] },
    { name: 'future-then-boundary', positions: [path[1]!, path[2]!, path[1]!, path[2]!] },
    { name: 'off-road', positions: [path[1]!, new Float64Array([2, 2, 2])] },
  ].map(c => ({ ...c, result: readVisitedRegions(tail, c.positions, labels, boundary) }));
  const collisionSnapshot = { ...tail, kernels: [tail.kernels[0]!, { ...tail.kernels[1]!, center: tail.kernels[0]!.center }] };
  const collision = readVisitedRegions(collisionSnapshot, [path[1]!, path[1]!], labels, boundary);
  t.diagnostic(JSON.stringify({ case: 'observed-future-boundary', cases, collision, snapshotBefore: before, snapshotAfter: sha(tail) }));
  for (const c of cases.filter(c => c.name !== 'future-then-boundary')) {
    assert.deepEqual(c.result.readout, []); assert.equal(c.result.reason, 'random-trajectory-did-not-reach-readout');
  }
  const future = cases.find(c => c.name === 'future-then-boundary')!.result;
  assert.equal(future.readout.length, 1); assert.deepEqual(future.readout[0]!.changes, labels[1]);
  assert.equal(future.readout[0]!.sampleStep, 1); assert.equal(future.readout[0]!.kernelIndex, 1);
  assert.equal(future.readout[0]!.originalKernelIndex, 2);
  assert.deepEqual(collision.readout, []); assert.equal(collision.reason, 'indistinguishable-local-outcomes');
  assert.equal(sha(tail), before);
  // Hypothetical sampling has no observed prefix; the same reached label remains eligible.
  assert.equal(readVisitedRegions(tail, [path[1]!, path[1]!], labels).readout[0]!.changes[0]!.after, 1);
});

test('production factual caller supplies the boundary while real Clone snapshots, starts and random trajectories remain identical', t => {
  const s = physicalPortFixture(t), before = sha(s.memory.snapshot()), calls: any[] = [];
  const original = PredictionClone.prototype.run;
  t.mock.method(PredictionClone.prototype, 'run', function (this: PredictionClone, ...args: Parameters<PredictionClone['run']>) {
    const result = original.apply(this, args);
    calls.push({ snapshot: args[0], start: [...args[1]], tangent: [...args[2]], steps: args[4], positions: result.positions.map(p => [...p]) });
    return result;
  });
  const p = s.memory.predict(cue, s.prefix.frames.at(-1)!, { prefix: s.prefix, seeds: 24, steps: 180 });
  t.diagnostic(JSON.stringify({ case: 'production-caller-real-clone', fixture: 'synthetic-context-and-map-not-learning',
    physicalCallsSha256: sha(calls), memoryBefore: before, memoryAfter: sha(s.memory.snapshot()),
    prediction: { ...p, samples: p.samples.map(s => ({ ...s, positions: undefined, positionsSha256: sha(s.positions) })) } }));
  assert.equal(calls.length, 24); assert.equal(p.kind, 'factual-prediction');
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    assert.deepEqual(c.start, [.05, 0, 0]); assert.equal(c.snapshot.kernels.length, 3);
    assert.equal(c.snapshot.kernels[0].center[0], .05);
    assert.deepEqual(p.samples[i]!.positions, c.positions);
  }
  assert(p.samples.some(s => s.readout.length > 0), 'the fixture must really visit an identifiable future region');
  assert(p.samples.every(s => s.readout.every(r => r.originalKernelIndex! > 1 && r.changes.every(c => c.observationIndex > 1))));
  assert.equal(sha(s.memory.snapshot()), before);
  const again = s.memory.predict(cue, s.prefix.frames.at(-1)!, { prefix: s.prefix, seeds: 24, steps: 180 });
  assert.equal(canonical(p), canonical(again));
});
