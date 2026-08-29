import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CognitiveWorkspace, type CognitiveEvidenceV1 } from '../src/cognitive-workspace.js';
import { encodeStrictToolArguments as encode } from '../src/analysis-strict-wire.js';
import { loadConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

const sealedRoot = 'evidence/public-document-path-bootstrap-continuation-v1/bootstrap-001/';
async function fixture() {
  const document = JSON.parse(await readFile(sealedRoot + 'WORKSPACE_LATEST.json', 'utf8'));
  const rows = (await readFile(sealedRoot + 'events.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const evidence: CognitiveEvidenceV1[] = document.workspace.evidence;
  const stored = evidence.find(e => e.ref === 'g1-e16')!;
  assert(stored); assert.equal(stored.kind, 'public-observation'); assert.equal(stored.source, 'current-public-frame');
  assert.equal(stored.observationSequence, 7912); assert.equal(stored.activeSeconds, 783.7);
  assert.equal((stored.data as any).crosshair, null); assert(!Object.hasOwn(stored.data as object, 'candidates'));
  const calls = rows.filter(r => r.kind === 'analysis-response').at(-1).value.tools;
  assert.deepEqual(calls.map((c: any) => c.arguments), [
    { reference: stored.ref, field: '/data/candidates', offset: 0, limit: 12 },
    { reference: stored.ref, field: '/data/crosshair', offset: 0, limit: 12 },
  ]);
  return { originalGoal: document.workspace.originalGoal, evidence, stored, calls };
}
function seed(workspace: CognitiveWorkspace, evidence: readonly CognitiveEvidenceV1[]) {
  for (const e of evidence) {
    assert.equal(e.sha256, sha({ ...e, sha256: undefined }));
    const copy = workspace.addEvidence(e.kind, e.source, e.data, e.query, e.observationSequence, true, e.activeSeconds);
    assert.equal(copy.ref, e.ref);
  }
}

test('public query miss: sealed g1-e16 missing candidates is not an empty recall and its real null crosshair is found', async t => {
  const { originalGoal, evidence, stored, calls } = await fixture();
  const workspace = new CognitiveWorkspace(); workspace.startGoal(originalGoal); seed(workspace, evidence);
  const before = canonical(workspace.snapshot());
  const result = calls.map((call: any) => {
    const a = call.arguments; return workspace.readPublic(a.reference, a.field, a.offset, a.limit) as any;
  });
  assert.deepEqual(result[0], { ref: stored.ref, kind: stored.kind, source: stored.source,
    observationSequence: stored.observationSequence, activeSeconds: stored.activeSeconds, query: stored.query,
    status: 'field-not-found', reference: stored.ref, field: '/data/candidates' });
  for (const absent of ['selectedValue', 'candidates', 'data', 'page', 'more']) assert(!Object.hasOwn(result[0], absent));
  assert.equal(result[1].status, 'found'); assert.equal(result[1].selectedValue, null);
  assert.equal(result[1].page.field, '/data/crosshair'); assert.equal(result[1].source, stored.source);
  assert.equal(result[1].observationSequence, 7912); assert.equal(result[1].activeSeconds, 783.7);
  assert.equal(canonical(workspace.snapshot()), before);
  t.diagnostic(canonical({ fixture: sealedRoot, originalCalls: calls, results: result, writes: 0, realModelCalls: 0 }));
});

test('public query miss: false zero empty values and paging remain found while missing paths do not repair the root', () => {
  const w = new CognitiveWorkspace(); w.startGoal('query result semantics');
  const values = { nullValue: null, falseValue: false, zeroValue: 0, emptyString: '', emptyArray: [],
    items: Array.from({ length: 17 }, (_, i) => i) };
  const e = w.addEvidence('public-observation', 'synthetic-public-source', values, null, 20, true, 1);
  const before = canonical(w.snapshot());
  for (const key of ['nullValue', 'falseValue', 'zeroValue', 'emptyString', 'emptyArray'] as const) {
    const result = w.readPublic(e.ref, '/data/' + key) as any;
    assert.equal(result.status, 'found'); assert.deepEqual(result.selectedValue, values[key]);
  }
  const page = w.readPublic(e.ref, '/data/items', 4, 12) as any;
  assert.equal(page.status, 'found'); assert.deepEqual(page.selectedValue, values.items.slice(4, 16));
  assert.deepEqual(page.page, { field: '/data/items', offset: 4, total: 17, nextOffset: 16 });
  const next = page.more.arguments;
  assert.deepEqual((w.readPublic(next.reference, next.field, next.offset, next.limit) as any).selectedValue, [16]);
  for (const path of ['/items', '/data/data/items', '/data/absent', '/data/nullValue/absent']) {
    const missing = w.readPublic(e.ref, path) as any;
    assert.equal(missing.status, 'field-not-found'); assert.equal(missing.field, path);
    assert.equal(missing.reference, e.ref); assert.equal(missing.selectedValue, undefined); assert.equal(missing.more, undefined);
  }
  assert.equal(canonical(w.snapshot()), before);
});

test('public query miss: unknown references invalid arguments special keys and original internal exceptions still throw', t => {
  const w = new CognitiveWorkspace(); w.startGoal('strict error boundary');
  const e = w.addEvidence('historical-experience', 'recall', { candidates: [{ eventId: 'synthetic',
    r1: { secret: 'private' }, r2: [1, 2, 3], r2a: { secret: 'private' }, observedBefore: { state: false } }] });
  const before = canonical(w.snapshot());
  for (const path of ['/data/candidates/0/r1', '/data/candidates/0/r2', '/data/candidates/0/r2a', '/sha256']) {
    const result = w.readPublic(e.ref, path) as any;
    assert.equal(result.status, 'field-not-found'); assert.equal(result.selectedValue, undefined);
    assert(!canonical(result).includes('private'));
  }
  for (const path of ['/constructor', '/__proto__', '/data/prototype', '/absent/constructor'])
    assert.throws(() => w.readPublic(e.ref, path), /context-public-field-missing/);
  assert.throws(() => w.readPublic('unknown-ref', '/data/candidates'), /context-reference-not-in-current-goal/);
  assert.throws(() => w.readPublic(e.ref, 'data/candidates'), /context-field-needs-json-pointer/);
  for (const [offset, limit] of [[-1, 1], [.5, 1], [0, 0], [0, 13], [NaN, 1]])
    assert.throws(() => w.readPublic(e.ref, '', offset, limit), /context-invalid-page/);
  const originalError = new Error('synthetic-original-integrity-error');
  const mock = t.mock.method(w, 'evidence', () => { throw originalError; });
  assert.throws(() => w.readPublic(e.ref, '/data/absent'), error => error === originalError);
  mock.mock.restore(); assert.equal(canonical(w.snapshot()), before);
});

test('public query miss: production Pi delivers both sealed reads to the next model turn without adding a tool or action', async t => {
  const { originalGoal, evidence, stored, calls } = await fixture(), config = await loadConfiguration();
  const events: any[] = [], payloads: any[] = []; let seeded = false, before = '', otherToolCalls = 0;
  let core: AnalysisCore;
  const forbidden = async () => { otherToolCalls++; throw Error('no-body-or-physical-query-authorized'); };
  const tools: AnalysisTools = {
    context: () => {
      if (!seeded) {
        seed(core.workspace, evidence); core.workspace.update({ tasks: [{ id: 't0', evidenceRefs: [stored.ref] }] });
        seeded = true; before = canonical(core.workspace.snapshot());
      }
      return {};
    }, observe: forbidden, recall: forbidden, predict: forbidden, execute: forbidden,
  };
  core = new AnalysisCore(config.analysis, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET',
    fetchForTest: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)); payloads.push(payload);
      let responseCalls: any[];
      if (payloads.length === 1) responseCalls = calls;
      else {
        assert.equal(payloads.length, 2, 'no retry or substituted call');
        const returned = payload.messages.filter((m: any) => m.role === 'tool').map((m: any) => ({ id: m.tool_call_id, result: JSON.parse(m.content) }));
        assert.equal(returned.length, 2); assert.deepEqual(returned.map((r: any) => r.id), calls.map((c: any) => c.id));
        assert.equal(returned[0].result.status, 'field-not-found'); assert.equal(returned[0].result.field, '/data/candidates');
        assert(!Object.hasOwn(returned[0].result, 'selectedValue'));
        assert.equal(returned[1].result.status, 'found'); assert.equal(returned[1].result.selectedValue, null);
        for (const { result } of returned) {
          assert.equal(result.ref, stored.ref); assert.equal(result.kind, stored.kind); assert.equal(result.source, stored.source);
          assert.equal(result.observationSequence, stored.observationSequence); assert.equal(result.activeSeconds, stored.activeSeconds);
        }
        responseCalls = [{ id: 'synthetic-model-finish', name: 'finish', arguments: {
          status: 'completed', report: 'Synthetic transport only: document miss is not a recall result.', evidenceRefs: [stored.ref] } }];
      }
      const wire = responseCalls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name,
        arguments: JSON.stringify(encode(TOOL_SCHEMAS[c.name as keyof typeof TOOL_SCHEMAS], c.arguments)) } }));
      const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'synthetic-miss', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', tool_calls: wire }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  await core.run(originalGoal);
  assert.equal(payloads.length, 2); assert.equal(otherToolCalls, 0); assert.equal(canonical(core.workspace.snapshot()), before);
  assert.deepEqual(events.filter(e => e.kind === 'tool-start').map(e => e.value.name), ['read_context', 'read_context', 'finish']);
  assert.deepEqual(events.filter(e => e.kind === 'tool-start').slice(0, 2).map(e => e.value.args), calls.map((c: any) => c.arguments));
  t.diagnostic(canonical({ fixture: sealedRoot, transport: 'synthetic HTTP; production Pi and workspace', requests: 2,
    toolResults: events.filter(e => e.kind === 'tool-end'), originalCalls: calls, bodyCalls: otherToolCalls,
    realModelCalls: 0, noAutomaticAlternative: true }));
});
