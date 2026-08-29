import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, SYSTEM_PROMPT, MODE_PROMPTS, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CASES, scoreCase, type CaseResult } from '../src/analysis-harness.js';
import { budgetPayload, interactionGroups, realInputTokens } from '../src/analysis-context.js';
import { publicAnalysisEvidence, verifyDeepSeekTokenizer } from '../src/analysis-provider.js';
import { encodeStrictToolArguments } from '../src/analysis-strict-wire.js';
import { analysisSampling, loadConfiguration, type DeepSeekAnalysisConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

const reasoningMarker = 'SYNTHETIC_PRIVATE_THINKING_MARKER_NOT_ACTUAL_REASONING';
const credentialMarker = 'SYNTHETIC_DEEPSEEK_KEY_NEVER_LOG';
type Call = { name: string; args: unknown; rawWire?: boolean };
async function fixture(calls: Call[], mode: 'normal' | 'error' | 'stall' | 'over-budget' = 'normal', emptyReasoningAt = 0) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const data of req) body += String(data);
    requests.push({ path: req.url, headers: req.headers, payload: JSON.parse(body) });
    if (mode === 'error') { res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `synthetic-unavailable Bearer ${credentialMarker}` } })); return; }
    res.setHeader('content-type', 'text/event-stream');
    const emit = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => res.write('data: ' + JSON.stringify({
      id: `synthetic-${requests.length}`, model: 'deepseek-v4-pro-test-response', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    }) + '\n\n');
    emit({ role: 'assistant', reasoning_content: requests.length === emptyReasoningAt ? '' : reasoningMarker });
    if (mode === 'stall') return;
    const call = calls[requests.length - 1];
    if (!call) { res.end('data: [DONE]\n\n'); return; }
    emit({ tool_calls: [{ index: 0, id: `t${requests.length}`, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.rawWire ? call.args
        : encodeStrictToolArguments(TOOL_SCHEMAS[call.name as keyof typeof TOOL_SCHEMAS], call.args)) } }] });
    const prompt = mode === 'over-budget' ? 24001 : 100;
    emit({}, 'tool_calls', { prompt_tokens: prompt, completion_tokens: 20, total_tokens: prompt + 20,
      prompt_cache_hit_tokens: 10, completion_tokens_details: { reasoning_tokens: 8 } });
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const redirectFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://api.deepseek.com'); assert.equal(url.pathname, '/beta/chat/completions');
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
  };
  return { requests, redirectFetch, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
const finish: Call = { name: 'finish', args: { status: 'no-plan', report: 'Public synthetic conclusion, not physical evidence.' } };
function tools(actions: unknown[], queries: unknown[] = []): AnalysisTools {
  return { context: () => ({ publicObservation: { sequence: 1, body: { selectedSlot: 4 } } }),
    observe: async () => ({ sequence: 1, body: { selectedSlot: 4 } }),
    recall: async desired => { queries.push(structuredClone(desired)); return { query: desired, candidates: [] }; },
    predict: async () => ({ support: 0 }), execute: async chosen => { actions.push(...chosen); return { results: [] }; } };
}
async function config(): Promise<DeepSeekAnalysisConfiguration> {
  const c = (await loadConfiguration()).analysis; assert.equal(c.provider, 'deepseek'); return c as DeepSeekAnalysisConfiguration;
}
test('DeepSeek: active profile, official tokenizer, fixed questions/tools/prompts; no Qwen sampling', async () => {
  const c = await config(); assert.equal(c.context, 65536); assert.equal(c.maximumInputTokens, 24000);
  assert.equal(c.maximumOutputTokens, 32768); assert.equal(c.reasoningEffort, 'high'); assert.deepEqual(analysisSampling(c), {});
  await verifyDeepSeekTokenizer(c);
  const old = JSON.parse(await readFile('evidence/analysis-qwen4b-reasoning-profile-v1/questions-001/PROTOCOL.json', 'utf8'));
  assert.equal(sha(CASES), old.casesSha256); assert.equal(sha(TOOL_SCHEMAS), old.schemaSha256);
  assert.equal(sha({ SYSTEM_PROMPT, MODE_PROMPTS }), old.promptSha256);
  const plain = { messages: [{ role: 'system', content: 'synthetic' }, { role: 'user', content: 'test' }], tools: [], reasoning_effort: 'high' };
  const count = await realInputTokens(plain, c); assert.ok(count > 0);
  assert.equal(await realInputTokens(plain, c), count);
});
test('DeepSeek: native thinking round trip stays in transport only; actual Pi auth/wire and response identity', async () => {
  const s = await fixture([{ name: 'observe', args: {} }, finish]); const events: any[] = [], actions: unknown[] = [];
  try {
    const core = new AnalysisCore(await config(), tools(actions), (kind, value) => events.push({ kind, value }),
      { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
    await core.run('Synthetic transport round trip');
    assert.equal(s.requests.length, 2); assert.equal(actions.length, 0);
    for (const req of s.requests) {
      assert.equal(req.headers.authorization, `Bearer ${credentialMarker}`);
      assert.equal(req.payload.model, 'deepseek-v4-pro'); assert.deepEqual(req.payload.thinking, { type: 'enabled' });
      assert.equal(req.payload.reasoning_effort, 'high'); assert.equal(req.payload.max_tokens, 32768);
      for (const k of ['temperature', 'top_p', 'top_k', 'min_p', 'seed', 'presence_penalty', 'frequency_penalty', 'chat_template_kwargs', 'tool_choice'])
        assert.equal(req.payload[k], undefined, k);
      assert.equal(canonical(req.payload).includes(credentialMarker), false);
    }
    const assistant = s.requests[1].payload.messages.find((m: any) => m.role === 'assistant');
    assert.equal(assistant.reasoning_content, reasoningMarker);
    const publicLogs = canonical(events), workspace = canonical(core.workspace.snapshot());
    for (const privateValue of [reasoningMarker, credentialMarker]) {
      assert.equal(publicLogs.includes(privateValue), false); assert.equal(workspace.includes(privateValue), false);
      assert.equal(canonical(core.agent.state.messages).includes(privateValue), false);
    }
    assert.equal(events.filter(e => e.kind === 'analysis-request')[1].value.reasoningTransportMessages, 1);
    assert.ok(events.filter(e => e.kind === 'analysis-response').every(e => e.value.responseModel === 'deepseek-v4-pro-test-response' && e.value.usage.reasoning === 8));
    assert.equal(events.filter(e => e.kind === 'analysis-request')[0].value.limit, 24000);
  } finally { await s.close(); }
});
test('DeepSeek: SDK slot coercion is fatal before body; numeric slot remains unchanged', async () => {
  for (const slot of ['2', 2]) {
    const s = await fixture([{ name: 'execute_chain', args: { actions: [{ kind: 'select-hotbar', parameters: { slot } }] }, rawWire: true }, finish]);
    const actions: any[] = [], events: any[] = [];
    try {
      const core = new AnalysisCore(await config(), tools(actions), (kind, value) => events.push({ kind, value }),
        { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
      if (typeof slot === 'string') {
        await assert.rejects(() => core.run('Synthetic raw parameter boundary'), /argument-coercion/);
        assert.equal(actions.length, 0); assert.equal(s.requests.length, 1);
        assert.equal(events.find(e => e.kind === 'tool-arguments-rejected').value.raw.actions[0].parameters.slot, '2');
      } else {
        await core.run('Synthetic raw parameter boundary'); assert.equal(actions.length, 1);
        assert.deepEqual(actions[0], { kind: 'select-hotbar', parameters: { slot: 2 } });
      }
    } finally { await s.close(); }
  }
});
test('DeepSeek: actual empty native reasoning is valid; earlier nonempty content remains intact', async () => {
  const s = await fixture([{ name: 'observe', args: {} }, { name: 'observe', args: {} }, finish], 'normal', 2);
  const events: any[] = [];
  try {
    const core = new AnalysisCore(await config(), tools([]), (kind, value) => events.push({ kind, value }),
      { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
    await core.run('Synthetic empty-native-field protocol regression');
    assert.equal(s.requests.length, 3);
    const assistants = s.requests[2].payload.messages.filter((m: any) => m.role === 'assistant');
    assert.equal(assistants[0].reasoning_content, reasoningMarker);
    assert.equal(assistants[1].reasoning_content, '');
    assert.equal(canonical(events).includes(reasoningMarker), false);
    assert.equal(canonical(core.workspace.snapshot()).includes(reasoningMarker), false);
  } finally { await s.close(); }
});
test('DeepSeek: recall boolean and string remain distinct, with no helpful type conversion', async () => {
  const s = await fixture([{ name: 'recall', args: { desiredChange: { value: true } } },
    { name: 'recall', args: { desiredChange: { value: 'true' } } }, finish]);
  const queries: any[] = [];
  try {
    const core = new AnalysisCore(await config(), tools([], queries), () => {}, { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
    await core.run('Synthetic exact query types'); assert.deepEqual(queries, [{ value: true }, { value: 'true' }]);
  } finally { await s.close(); }
});
test('DeepSeek: whole native tool groups are retained/dropped; budget uses active limits, not 6500', async () => {
  const c = await config(), header = [{ role: 'system', content: 'fixed' }, { role: 'user', content: 'required-current-material' }];
  const pair = (id: string) => [{ role: 'assistant', content: null, reasoning_content: reasoningMarker + id, tool_calls: [{ id }] },
    { role: 'tool', tool_call_id: id, content: 'public-result' }];
  const payload = { max_tokens: 8192, messages: [...header, ...pair('old'), ...pair('new')] };
  const fitted = await budgetPayload(payload, 'required-current-material', async p => (p.messages as any[]).length > 4 ? 25000 : 20000, c);
  assert.equal(fitted.audit.removedInteractionGroups, 1); assert.equal(fitted.audit.limit, 24000);
  assert.deepEqual((fitted.payload.messages as any[]).slice(2), pair('new'));
  assert.equal(interactionGroups((fitted.payload.messages as any[]).slice(2)).length, 1);
  await assert.rejects(() => budgetPayload({ max_tokens: 8192, messages: header }, 'required-current-material', async () => 24001, c), /context-budget-exceeded/);
  const old = JSON.parse(await readFile('evidence/analysis-qwen4b-reasoning-profile-v1/questions-001/current-versus-history/RESULT.json', 'utf8')) as CaseResult;
  const changed = structuredClone(old); changed.inputLimit = 24000;
  for (const e of changed.events) if (e.kind === 'analysis-request') e.value.inputTokens = 12000;
  assert.equal(scoreCase(CASES[0]!, changed).checks.withinRequestLimit, true);
  changed.inputLimit = 6500; assert.equal(scoreCase(CASES[0]!, changed).checks.withinRequestLimit, false);
});
test('DeepSeek: HTTP failure and stalled SSE stop once; no credential/thinking in errors or logs', async () => {
  for (const mode of ['error', 'stall'] as const) {
    const s = await fixture([], mode), events: any[] = [], actions: unknown[] = [];
    try {
      const core = new AnalysisCore({ ...await config(), timeoutMs: 1800 }, tools(actions), (kind, value) => events.push({ kind, value }),
        { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
      let caught: Error | null = null;
      try { await core.run('Synthetic service failure'); } catch (error) { caught = error as Error; }
      assert.ok(caught); assert.match(caught.message, mode === 'error' ? /503|synthetic-unavailable/ : /timeout/);
      assert.equal(s.requests.length, 1); assert.equal(actions.length, 0);
      assert.equal(canonical(events).includes(reasoningMarker), false);
      assert.equal(canonical(events).includes(credentialMarker), false);
      assert.equal(caught.message.includes(credentialMarker), false);
    } finally { await s.close(); }
  }
});
test('DeepSeek: service-reported budget overrun stops before tools; native numeric usage is public', async () => {
  const s = await fixture([{ name: 'execute_chain', args: { actions: [{ kind: 'select-hotbar', parameters: { slot: 2 } }] } }], 'over-budget');
  const actions: unknown[] = [];
  try {
    const core = new AnalysisCore(await config(), tools(actions), () => {}, { apiKeyForTest: credentialMarker, fetchForTest: s.redirectFetch });
    await assert.rejects(() => core.run('Synthetic usage boundary'), /actual-token-budget-exceeded/);
    assert.equal(actions.length, 0); assert.equal(s.requests.length, 1);
    assert.deepEqual(publicAnalysisEvidence({ reasoning: 8, reasoning_content: reasoningMarker }), { reasoning: 8 });
  } finally { await s.close(); }
});
