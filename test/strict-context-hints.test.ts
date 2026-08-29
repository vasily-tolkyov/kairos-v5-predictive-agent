import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Value from 'typebox/value';
import { AnalysisCore, TOOL_SCHEMAS, STRICT_TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { encodeStrictToolArguments as encode, decodeStrictToolArguments as decode } from '../src/analysis-strict-wire.js';
import { loadConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

const strictPresenter = (args: unknown) => encode(TOOL_SCHEMAS.read_context, args);
const paths = ['objects', 'queryVocabulary/historySubjects', 'queryVocabulary/selfProperties'];
const get = (data: any, path: string) => path.split('/').reduce((v, part) => v[part], data);
async function sealedObservation() {
  const document = JSON.parse(await readFile('evidence/native-strict-wire-integration-bootstrap-v1/bootstrap-001/WORKSPACE_LATEST.json', 'utf8'));
  const evidence = document.workspace.evidence.find((e: any) => e.ref === 'g1-e1');
  assert.equal(evidence.sha256, sha({ ...evidence, sha256: undefined }));
  return evidence.data;
}
function validHint(hint: any, logical: unknown) {
  assert.equal(hint.tool, 'read_context');
  assert(Value.Check(STRICT_TOOL_SCHEMAS.read_context, hint.arguments));
  assert.deepEqual(decode(TOOL_SCHEMAS.read_context, hint.arguments), logical);
  assert.deepEqual(Object.keys(hint.arguments).sort(), ['field', 'limit', 'offset', 'reference']);
}
function readonlyTools(data: any, called: string[] = []): AnalysisTools {
  const unavailable = async (name: string) => { called.push(name); throw new Error(`unavailable-in-no-body-fixture:${name}`); };
  return { context: () => ({ publicObservation: structuredClone(data) }), observe: async () => structuredClone(data),
    recall: () => unavailable('recall'), predict: () => unavailable('predict'), execute: () => unavailable('execute') };
}

test('context hints: sealed legacy hints remain invalid under their original sent schema (historical counterexample)', async t => {
  const lines = (await readFile('evidence/native-strict-wire-integration-bootstrap-v1/bootstrap-001/events.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const request = lines.find(e => e.kind === 'analysis-request').value.request;
  const data = JSON.parse(request.messages.at(-1).content).evidence[0].data;
  const originalSentSchema = request.tools.find((tool: any) => tool.function.name === 'read_context').function.parameters;
  for (const path of paths) {
    const legacy = get(data, path).more;
    assert(Value.Check(TOOL_SCHEMAS.read_context, legacy));
    assert(!Value.Check(originalSentSchema, legacy));
  }
  t.diagnostic('3 sealed legacy hints rejected by their original schema; historical failure not relabelled');
});

test('context hints: production DeepSeek publicSummary, readPublic and material share the same reversible hints', async t => {
  const data = await sealedObservation(), config = await loadConfiguration();
  const core = new AnalysisCore(config.analysis, readonlyTools(data), () => {});
  core.workspace.startGoal('Read-only hint test');
  const { evidence } = core.workspace.observe(data), before = canonical(core.workspace.snapshot());
  const views = [core.workspace.publicSummary(evidence.ref).data,
    (core.workspace.readPublic(evidence.ref) as any).selectedValue.data, JSON.parse(core.workspace.material().text).evidence[0].data];
  for (const view of views) for (const path of paths)
    validHint(get(view, path).more, { reference: evidence.ref, field: `/data/${path}`, offset: 4, limit: 4 });
  assert.equal(canonical(core.workspace.snapshot()), before);
  assert.deepEqual(core.workspace.evidence(evidence.ref).data, data);
  assert.equal(core.calls, 0);
  assert.equal(sha(TOOL_SCHEMAS).toUpperCase(), '120531C44777D6121EC03C78E872D37E488AE40BBDB62D192A77C5AF46857C70');
  assert.notEqual(sha(STRICT_TOOL_SCHEMAS).toUpperCase(), '1D9A57EB4D13D377CBC8F4E02F537BBC20AFEF9370663105B79496F9AD5BB5F0');
  t.diagnostic('3 entrances x 3 original hints: 9 valid and exactly reversible; immutable evidence unchanged');
});

test('context hints: nested arrays, object fields, escaped pointers and continuation pages retain exact offsets', () => {
  const workspace = new CognitiveWorkspace(strictPresenter); workspace.startGoal('Nested paging');
  const publicFields = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
  const data = { 'a/b~c': Array.from({ length: 9 }, (_, i) => ({ index: i, publicFields })), literal: '' };
  const e = workspace.addEvidence('public-observation', 'test', data), before = canonical(workspace.snapshot());
  const summary = workspace.publicSummary(e.ref).data;
  validHint(summary['a/b~c'].more, { reference: e.ref, field: '/data/a~1b~0c', offset: 4, limit: 4 });
  validHint(summary['a/b~c'].items[0].publicFields.moreFields,
    { reference: e.ref, field: '/data/a~1b~0c/0/publicFields', offset: 12, limit: 12 });
  assert.equal(summary['a/b~c'].items[0].publicFields.moreFields.total, 17);
  const page = workspace.readPublic(e.ref, '/data/a~1b~0c', 4, 4) as any;
  assert.deepEqual(page.selectedValue.map((v: any) => v.index), [4, 5, 6, 7]);
  validHint(page.more, { reference: e.ref, field: '/data/a~1b~0c', offset: 8, limit: 4 });
  validHint(page.selectedValue[0].publicFields.moreFields, { reference: e.ref, field: '/data/a~1b~0c/4/publicFields', offset: 12, limit: 12 });
  const last = workspace.readPublic(e.ref, '/data/a~1b~0c', 8, 4) as any;
  assert.equal(last.more, undefined); assert.equal(last.page.nextOffset, null);
  const fields = workspace.readPublic(e.ref, '/data/a~1b~0c/0/publicFields', 12, 12) as any;
  assert.deepEqual(fields.selectedValue, Object.fromEntries(Object.entries(publicFields).slice(12)));
  const root = workspace.readPublic(e.ref, '', 0, 1) as any;
  validHint(root.more, { reference: e.ref, field: '', offset: 1, limit: 1 });
  assert.deepEqual(decode(TOOL_SCHEMAS.read_context, strictPresenter({ reference: e.ref, field: '', offset: 0, limit: 1 })),
    { reference: e.ref, field: '', offset: 0, limit: 1 });
  assert.deepEqual(decode(TOOL_SCHEMAS.read_context, strictPresenter({ reference: e.ref })), { reference: e.ref });
  assert.equal(canonical(workspace.snapshot()), before);
});

test('context hints: page metadata is not an argument and literal more/field/op data and history query remain untouched', () => {
  const workspace = new CognitiveWorkspace(strictPresenter); workspace.startGoal('Raw evidence integrity');
  const literal = { more: { field: '', op: 'keep', offset: 0 }, field: 'not-a-pointer', op: false };
  const query = { desiredChange: { value: null }, more: literal, offset: 0 };
  const e = workspace.addEvidence('historical-experience', 'test', {
    query, candidates: [{ eventId: 'e-0', observedBefore: literal, actualObserved: Array.from({ length: 6 }, () => literal) }],
  }, query, 7, true, .35);
  const before = canonical(workspace.snapshot());
  const views = [workspace.publicSummary(e.ref), (workspace.readPublic(e.ref) as any).selectedValue, JSON.parse(workspace.material().text).evidence[0]];
  for (const view of views) {
    assert.deepEqual(view.query, query);
    assert.deepEqual(view.data.query, query);
    assert.deepEqual(view.data.candidates[0].observedBefore, literal);
    assert.deepEqual(view.data.candidates[0].actualObserved.items[0], literal);
    const hint = view.data.candidates[0].actualObserved.more;
    validHint(hint, { reference: e.ref, field: '/data/candidates/0/actualObserved', offset: 4, limit: 4 });
    assert.equal(hint.arguments.total, undefined); assert.equal(hint.arguments.coveredRange, undefined); assert.equal(hint.arguments.page, undefined);
    assert(!Value.Check(STRICT_TOOL_SCHEMAS.read_context, hint));
  }
  assert.equal(canonical(workspace.snapshot()), before);
});

test('context hints: Qwen keeps logical arguments while using the same trusted paging locations', async () => {
  const local: any = { provider: 'llama.cpp', baseUrl: 'http://127.0.0.1:1', context: 8192, maximumOutputTokens: 768,
    nativeThinking: false, temperature: 0, topP: 1, topK: 0, minP: 0, presencePenalty: 0, seed: 1, timeoutMs: 2000 };
  const core = new AnalysisCore(local, readonlyTools(await sealedObservation()), () => {});
  core.workspace.startGoal('Logical presentation'); const e = core.workspace.observe(await sealedObservation()).evidence;
  for (const path of paths) {
    const hint = get(core.workspace.publicSummary(e.ref).data, path).more;
    assert.equal(hint.tool, 'read_context');
    assert.deepEqual(hint.arguments, { reference: e.ref, field: `/data/${path}`, offset: 4, limit: 4 });
    assert(Value.Check(TOOL_SCHEMAS.read_context, hint.arguments));
  }
  assert.equal(core.calls, 0);
});

function response(name: keyof typeof TOOL_SCHEMAS, wire: unknown, request: number) {
  const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `fake-${request}`,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: 'assistant', reasoning_content: '' }) + chunk({ tool_calls: [{ index: 0, id: `call-${request}`,
    type: 'function', function: { name, arguments: JSON.stringify(wire) } }] }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n',
  { headers: { 'content-type': 'text/event-stream' } });
}

test('context hints: real Pi reads a generated hint, returns the actual page and carries it into the next request', async t => {
  const config = await loadConfiguration(), data = await sealedObservation(), requests: any[] = [], events: any[] = [], called: string[] = [];
  let firstHint: any;
  const core = new AnalysisCore(config.analysis, readonlyTools(data, called), (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)); requests.push(payload);
      assert.equal(payload.tools.length, 7); assert(payload.tools.every((v: any) => v.function.strict === true));
      const readTool = payload.tools.find((v: any) => v.function.name === 'read_context').function;
      assert.match(readTool.description, /公开文档根/);
      assert.match(JSON.stringify(readTool.parameters.properties.field), /从该reference的公开文档根/);
      if (requests.length === 1) {
        firstHint = JSON.parse(payload.messages.at(-1).content).evidence[0].data.objects.more;
        return response('read_context', firstHint.arguments, 1);
      }
      assert.equal(requests.length, 2, 'no additional or fallback request');
      const assistant = payload.messages.find((m: any) => m.role === 'assistant');
      assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), firstHint.arguments);
      const result = payload.messages.find((m: any) => m.role === 'tool');
      assert.equal(result.tool_call_id, 'call-1');
      const returned = JSON.parse(result.content);
      assert.deepEqual(returned.selectedValue, data.objects.slice(4, 8));
      assert.deepEqual(returned.page, { field: '/data/objects', offset: 4, total: data.objects.length, nextOffset: 8 });
      assert.equal(returned.ref, 'g1-e1'); assert.equal(returned.source, 'current-public-frame');
      assert.equal(returned.observationSequence, data.sequence);
      assert.equal(returned.reference, undefined); assert.equal(returned.material, undefined);
      return response('finish', encode(TOOL_SCHEMAS.finish, { status: 'completed', report: 'synthetic protocol fixture', evidenceRefs: ['g1-e1'] }), 2);
    },
  });
  await core.run('Read the remaining sealed public material, then report briefly.');
  assert.equal(requests.length, 2); assert.deepEqual(called, []);
  assert.deepEqual(events.find(e => e.kind === 'tool-start').value.args, { reference: 'g1-e1', field: '/data/objects', offset: 4, limit: 4 });
  assert.equal(core.workspace.snapshot().evidence.filter(e => e.kind === 'actual-action').length, 0);
  t.diagnostic('Synthetic HTTP only: production Pi/7 tools/workspace; 2 requests, actual page in second input, body=0');
});

test('context hints: mixed tagged field and bare offsets from a model still fails without correction or retry', async t => {
  const config = await loadConfiguration(), data = await sealedObservation(), events: any[] = [], called: string[] = [];
  let requests = 0;
  const core = new AnalysisCore(config.analysis, readonlyTools(data, called), (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async () => {
      requests++;
      const raw = { reference: 'g1-e1', field: { op: 'set-string', value: '/objects' }, offset: 0, limit: 12 };
      return response('read_context', raw, 1);
    },
  });
  await assert.rejects(() => core.run('Read-only invalid model format fixture'), /validation|invalid/);
  assert.equal(requests, 1); assert.deepEqual(called, []);
  assert.equal(events.filter(e => e.kind === 'tool-start').length, 0);
  t.diagnostic('Invalid model output left unchanged; 1 synthetic request, no retry/body/tool execution');
});
