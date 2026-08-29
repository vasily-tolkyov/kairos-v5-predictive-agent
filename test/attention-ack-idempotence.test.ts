import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CognitiveWorkspace, type CognitiveEvidenceV1, type IntentUpdateV1 } from '../src/cognitive-workspace.js';
import { encodeStrictToolArguments as encode } from '../src/analysis-strict-wire.js';
import { loadConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

const sealedRoot = 'evidence/public-query-miss-domain-result-bootstrap-continuation-v1/bootstrap-001/';
async function fixture() {
  const document = JSON.parse(await readFile(sealedRoot + 'WORKSPACE_LATEST.json', 'utf8'));
  const rows = (await readFile(sealedRoot + 'events.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const responses = rows.filter(r => r.kind === 'analysis-response');
  assert.equal(responses.length, 9);
  const update8: IntentUpdateV1 = responses[7].value.tools.find((c: any) => c.name === 'set_intent').arguments;
  const calls9 = responses[8].value.tools;
  assert.deepEqual(update8.acknowledgeAttention, ['g1-e11']);
  assert.deepEqual(calls9[0].arguments.acknowledgeAttention, ['g1-e11', 'g1-e14']);
  assert.deepEqual(calls9.map((c: any) => c.name), ['set_intent', 'execute_chain']);
  const evidence: CognitiveEvidenceV1[] = document.workspace.evidence;
  for (const ref of ['g1-e11', 'g1-e14']) assert.equal(evidence.find(e => e.ref === ref)!.kind, 'attention');
  return { originalGoal: document.workspace.originalGoal, evidence, update8, calls9 };
}
function insert(w: CognitiveWorkspace, evidence: readonly CognitiveEvidenceV1[]) {
  for (const e of evidence) {
    assert.equal(e.sha256, sha({ ...e, sha256: undefined }));
    const added = w.addEvidence(e.kind, e.source, e.data, e.query, e.observationSequence, e.kind !== 'attention', e.activeSeconds);
    assert.equal(added.ref, e.ref); assert.deepEqual(added.data, e.data);
    assert.equal(added.observationSequence, e.observationSequence); assert.equal(added.activeSeconds, e.activeSeconds);
  }
}
function beforeNinthResponse(w: CognitiveWorkspace, f: Awaited<ReturnType<typeof fixture>>) {
  const boundary = f.evidence.findIndex(e => e.ref === 'g1-e14');
  insert(w, f.evidence.slice(0, boundary));
  assert.deepEqual(w.snapshot().pendingAttention, ['g1-e11']);
  const eighth = w.update(f.update8) as any;
  assert.deepEqual(eighth.acknowledgedAttention, ['g1-e11']);
  assert.deepEqual(w.snapshot().pendingAttention, []);
  insert(w, f.evidence.slice(boundary));
  assert.deepEqual(w.snapshot().pendingAttention, ['g1-e14']);
  return eighth;
}

test('attention acknowledgement: sealed eighth then ninth response separates already and newly acknowledged notices', async t => {
  const f = await fixture(), w = new CognitiveWorkspace(); w.startGoal(f.originalGoal);
  const eighth = beforeNinthResponse(w, f), evidenceBefore = canonical(w.snapshot().evidence);
  const ninth = w.update(f.calls9[0].arguments) as any;
  assert.deepEqual(ninth.acknowledgedAttention, ['g1-e14']);
  assert.deepEqual(ninth.alreadyAcknowledgedAttention, ['g1-e11']);
  assert.deepEqual(w.snapshot().pendingAttention, []);
  assert.equal(canonical(w.snapshot().evidence), evidenceBefore);
  const beforeRepeat = canonical(w.snapshot()), repeated = w.update(f.calls9[0].arguments) as any;
  assert.deepEqual(repeated.acknowledgedAttention, []);
  assert.deepEqual(repeated.alreadyAcknowledgedAttention, ['g1-e11', 'g1-e14']);
  assert.equal(canonical(w.snapshot()), beforeRepeat);
  t.diagnostic(canonical({ fixture: sealedRoot, eighthUpdate: f.update8, ninthUpdate: f.calls9[0].arguments,
    eighth, ninth, repeated, modelCalls: 0, bodyCalls: 0, immutableEvidenceUnchanged: true }));
});

test('attention acknowledgement: duplicate references are idempotent and unmentioned new notices stay pending', () => {
  const w = new CognitiveWorkspace(); w.startGoal('Only model-specified acknowledgements');
  const notices = [1, 2, 3].map(i => w.addEvidence('attention', 'synthetic-real-producer-boundary', { subjectId: 'o' + i }, null, i, false, i * .05));
  const [a, b, untouched] = notices.map(e => e.ref) as [string, string, string];
  const originalEvidence = canonical(w.snapshot().evidence), originalNotes = canonical(w.snapshot().tasks);
  const first = w.update({ acknowledgeAttention: [a, a] }) as any;
  assert.deepEqual(first.acknowledgedAttention, [a]); assert.deepEqual(first.alreadyAcknowledgedAttention, []);
  const before = canonical(w.snapshot()), again = w.update({ acknowledgeAttention: [a, a] }) as any;
  assert.deepEqual(again.acknowledgedAttention, []); assert.deepEqual(again.alreadyAcknowledgedAttention, [a]);
  assert.equal(canonical(w.snapshot()), before);
  const mixed = w.update({ acknowledgeAttention: [a, b, b, a] }) as any;
  assert.deepEqual(mixed.acknowledgedAttention, [b]); assert.deepEqual(mixed.alreadyAcknowledgedAttention, [a]);
  assert.deepEqual(w.snapshot().pendingAttention, [untouched]); assert.equal(w.mode, 'orient'); assert.equal(w.currentTaskId, 't0');
  assert.equal(canonical(w.snapshot().tasks), originalNotes); assert.equal(canonical(w.snapshot().evidence), originalEvidence);
  for (const notice of notices) assert.deepEqual(w.evidence(notice.ref), notice);
});

test('attention acknowledgement: invalid type unknown corrupted and internal errors cannot partially commit notes or confirmations', t => {
  const w = new CognitiveWorkspace(); w.startGoal('Atomic existing state assignment');
  const first = w.addEvidence('attention', 'synthetic', { subjectId: 'o1' }, null, 1, false, .05);
  const notAttention = w.observe({ sequence: 2, activeSeconds: .1, body: { selectedSlot: 0 } }).evidence;
  const patch = (ref: string): IntentUpdateV1 => ({ mode: 'review', tasks: [{ id: 't0', conclusion: 'must not partially commit' }],
    acknowledgeAttention: [first.ref, ref] });
  for (const [ref, error] of [['g1-e404', /context-reference-not-in-current-goal/], [notAttention.ref, /workspace-unknown-pending-attention/]] as const) {
    const before = canonical(w.snapshot()); assert.throws(() => w.update(patch(ref)), error); assert.equal(canonical(w.snapshot()), before);
  }
  const damaged = w.addEvidence('attention', 'synthetic-corruption-case', { subjectId: 'o2' }, null, 3, false, .15);
  w.update({ acknowledgeAttention: [damaged.ref] });
  // Fault injection into this test-only workspace, not a production mutation API.
  (w as any).state().evidence.find((e: CognitiveEvidenceV1) => e.ref === damaged.ref).sha256 = 'corrupted';
  const beforeDamageRead = canonical(w.snapshot());
  assert.throws(() => w.update(patch(damaged.ref)), /context-evidence-integrity-error/);
  assert.equal(canonical(w.snapshot()), beforeDamageRead);
  const original = new Error('synthetic-original-internal-failure');
  const mock = t.mock.method(w, 'evidence', () => { throw original; });
  assert.throws(() => w.update(patch(first.ref)), error => error === original);
  assert.equal(canonical(w.snapshot()), beforeDamageRead); mock.mock.restore();
  w.startGoal('A different goal');
  const newNotice = w.addEvidence('attention', 'synthetic', {}, null, 4, false, .2), newState = canonical(w.snapshot());
  assert.throws(() => w.update({ acknowledgeAttention: [newNotice.ref, first.ref] }), /context-reference-not-in-current-goal/);
  assert.equal(canonical(w.snapshot()), newState);
});

async function piFixture(invalidReference: boolean) {
  const f = await fixture(), config = await loadConfiguration(), events: any[] = [], requests: any[] = [], bodyCalls: unknown[] = [];
  let core: AnalysisCore, seeded = false, originalState = '';
  const calls = structuredClone(f.calls9);
  if (invalidReference) calls[0].arguments.acknowledgeAttention.push('g1-e404');
  const forbidden = async () => { throw Error('no-observation-or-physical-query-in-local-transport-test'); };
  const tools: AnalysisTools = {
    context: () => {
      if (!seeded) { beforeNinthResponse(core.workspace, f); seeded = true; originalState = canonical(core.workspace.snapshot()); }
      return {};
    }, observe: forbidden, recall: forbidden, predict: forbidden,
    execute: async actions => { bodyCalls.push(structuredClone(actions)); return { syntheticPortReceiptOnly: true }; },
  };
  core = new AnalysisCore(config.analysis, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async (_input, init) => {
      const request = JSON.parse(String(init?.body)); requests.push(request);
      let output: any[];
      if (requests.length === 1) output = calls;
      else {
        assert.equal(invalidReference, false); assert.equal(requests.length, 2, 'no retry or extra model turn');
        const results = request.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
        assert.equal(results.length, 2);
        assert.deepEqual(results[0].acknowledgedAttention, ['g1-e14']);
        assert.deepEqual(results[0].alreadyAcknowledgedAttention, ['g1-e11']);
        output = [{ name: 'finish', id: 'synthetic-model-finish', arguments: { status: 'completed',
          report: 'Synthetic transport check only; no real body or learned capability.', evidenceRefs: ['t0'] } }];
      }
      const tool_calls = output.map((c, index) => ({ index, id: c.id, type: 'function', function: {
        name: c.name, arguments: JSON.stringify(encode(TOOL_SCHEMAS[c.name as keyof typeof TOOL_SCHEMAS], c.arguments)) } }));
      const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'synthetic-ack', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', tool_calls }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  if (invalidReference) {
    await assert.rejects(() => core.run(f.originalGoal), /context-reference-not-in-current-goal:g1-e404/);
    assert.equal(requests.length, 1); assert.equal(bodyCalls.length, 0);
    assert.equal(canonical(core.workspace.snapshot()), originalState);
    assert.deepEqual(events.filter(e => e.kind === 'tool-start').map(e => e.value.name), ['set_intent']);
  } else {
    await core.run(f.originalGoal);
    assert.equal(requests.length, 2); assert.equal(bodyCalls.length, 1);
    assert.deepEqual(bodyCalls[0], f.calls9[1].arguments.actions);
    assert.deepEqual(events.filter(e => e.kind === 'tool-start').map(e => e.value.name), ['set_intent', 'execute_chain', 'finish']);
    assert.deepEqual(core.workspace.snapshot().pendingAttention, []);
  }
  return { transport: 'synthetic HTTP / production Pi', fixture: sealedRoot, requests: requests.length, bodyPortCalls: bodyCalls,
    realBodyCalls: 0, physicalWrites: 0, rawModelCalls: calls, toolResults: events.filter(e => e.kind === 'tool-end') };
}

test('attention acknowledgement: production Pi accepts original ninth response then forwards only its exact action chain once', async t => {
  t.diagnostic(canonical(await piFixture(false)));
});
test('attention acknowledgement: production Pi still stops before the later action on a genuine invalid acknowledgement', async t => {
  t.diagnostic(canonical(await piFixture(true)));
});
