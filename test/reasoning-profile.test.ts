import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, MODE_PROMPTS, SYSTEM_PROMPT, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CASES } from '../src/analysis-harness.js';
import { budgetPayload, realInputTokens } from '../src/analysis-context.js';
import { analysisSampling, analysisServerArguments, type LocalAnalysisConfiguration } from '../src/services.js';
import { sha } from '../src/util.js';

const marker = 'SYNTHETIC_REASONING_PRIVACY_TEST_MARKER'; // Test data, never an actual model thought.
// The retained Qwen protocol test uses its frozen profile, never the newly active remote backend.
async function loadConfiguration(): Promise<{ analysis: LocalAnalysisConfiguration }> {
  return JSON.parse(await readFile('evidence/analysis-deepseek-backend-v1/BASELINE.json', 'utf8')).configuration;
}
async function service(kind: 'tools' | 'length' | 'error' | 'stall' = 'tools', tokenCount = 1234) {
  const payloads: { path: string; data: any }[] = [];
  let calls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    const data = JSON.parse(body); payloads.push({ path: req.url!, data });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/apply-template') { res.end(JSON.stringify({ prompt: 'synthetic rendered prompt' })); return; }
    if (req.url === '/tokenize') { res.end(JSON.stringify({ tokens: Array(tokenCount).fill(1) })); return; }
    calls++;
    if (kind === 'error') { res.writeHead(503).end(JSON.stringify({ error: { message: 'test-service-unavailable' } })); return; }
    res.setHeader('content-type', 'text/event-stream');
    const emit = (chunk: unknown) => res.write('data: ' + JSON.stringify(chunk) + '\n\n');
    emit({ id: 'privacy-test', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: marker }, finish_reason: null }] });
    if (kind === 'stall') return; // Headers and one SSE delta arrived; only the whole-request deadline can stop this.
    if (kind === 'tools') {
      const tool = calls === 1 ? { name: 'observe', arguments: '{}' }
        : { name: 'finish', arguments: JSON.stringify({ status: 'no-plan', report: 'synthetic public report' }) };
      emit({ id: 'privacy-test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `c${calls}`, type: 'function', function: tool }] }, finish_reason: null }] });
    }
    emit({ id: 'privacy-test', choices: [{ index: 0, delta: {}, finish_reason: kind === 'length' ? 'length' : 'tool_calls' }],
      usage: { prompt_tokens: tokenCount, completion_tokens: 8, total_tokens: tokenCount + 8, completion_tokens_details: { reasoning_tokens: 3 } } });
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  return { payloads, calls: () => calls, baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
const tools = (act: () => void): AnalysisTools => ({
  context: () => ({ publicObservation: { sequence: 1, self: { subject: 'self', selectedSlot: 4 } } }),
  observe: async () => ({ sequence: 1, self: { subject: 'self', selectedSlot: 4 } }),
  recall: async () => ({ candidates: [] }), predict: async () => ({ support: 0 }),
  execute: async () => { act(); return { actual: true }; },
});

test('reasoning profile: fixed configuration drives production server arguments; prompts/tools/cases are unchanged', async () => {
  const a = (await loadConfiguration()).analysis, argv = analysisServerArguments(a);
  assert.equal(a.context, 16384); assert.equal(a.maximumOutputTokens, 4096); assert.equal(a.timeoutMs, 120000);
  assert.equal(a.nativeThinking, true);
  assert.deepEqual(analysisSampling(a), { temperature: .6, top_p: .95, top_k: 20, min_p: 0, presence_penalty: 1.5, seed: 1262836050 });
  for (const [flag, value] of Object.entries({ '--ctx-size': '16384', '--n-predict': '4096', '--temp': '0.6',
    '--top-p': '0.95', '--top-k': '20', '--min-p': '0', '--presence-penalty': '1.5', '--seed': '1262836050',
    '--parallel': '1', '--reasoning': 'on', '--reasoning-format': 'deepseek', '--host': '127.0.0.1' })) {
    assert.equal(argv.filter(x => x === flag).length, 1); assert.equal(argv[argv.indexOf(flag) + 1], value);
  }
  const baseline = JSON.parse(await readFile('evidence/analysis-contract-context-root-repair-v2/questions-002/PROTOCOL.json', 'utf8'));
  assert.equal(sha({ SYSTEM_PROMPT, MODE_PROMPTS }), baseline.promptSha256);
  assert.equal(sha(TOOL_SCHEMAS), baseline.schemaSha256); assert.equal(sha(CASES), baseline.casesSha256);
});

test('reasoning profile: real Pi adapter, template and request agree; thinking is neither recorded nor replayed', async () => {
  const s = await service(); let actions = 0;
  const events: { kind: string; value: any }[] = [];
  try {
    const config = { ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl };
    const core = new AnalysisCore(config, tools(() => { actions++; }), (kind, value) => events.push({ kind, value }));
    assert.equal(core.agent.state.model.reasoning, true); assert.equal(core.agent.state.model.contextWindow, 16384);
    assert.notEqual(core.agent.state.thinkingLevel, 'off');
    await core.run('Synthetic profile wiring test');
    assert.equal(s.calls(), 2); assert.equal(actions, 0);
    const requests = s.payloads.filter(p => p.path === '/v1/chat/completions');
    const templates = s.payloads.filter(p => p.path === '/apply-template');
    assert.equal(requests.length, 2); assert.equal(templates.length, 2);
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i]!.data, template = templates[i]!.data;
      assert.deepEqual(template.messages, request.messages); assert.deepEqual(template.tools, request.tools);
      assert.deepEqual(template.chat_template_kwargs, request.chat_template_kwargs);
      assert.equal(template.enable_thinking, true); assert.equal(request.chat_template_kwargs.enable_thinking, true);
      for (const [key, value] of Object.entries(analysisSampling(config))) assert.equal(request[key], value);
      assert.equal(request.max_tokens, 4096);
    }
    const audits = events.filter(e => e.kind === 'analysis-request');
    assert.ok(audits.every(e => e.value.inputTokens === 1234 && e.value.outputTokens === 4096 && e.value.context === 16384));
    assert.ok(events.filter(e => e.kind === 'analysis-response').every(e => e.value.nativeReasoningObserved));
    assert.equal(JSON.stringify(events).includes(marker), false);
    assert.equal(JSON.stringify(core.workspace.snapshot()).includes(marker), false);
    assert.equal(JSON.stringify(s.payloads).includes(marker), false);
    assert.ok(requests.every(p => p.data.messages.every((m: any) => !m.reasoning_content && !m.reasoning)));
  } finally { await s.close(); }
});

test('reasoning profile: template mismatch fails before tokenizer or generation; input and total budgets remain independent', async () => {
  const s = await service();
  try {
    const config = { ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl };
    await assert.rejects(() => realInputTokens({ messages: [], tools: [], chat_template_kwargs: { enable_thinking: false } }, config), /template-thinking-mismatch/);
    assert.equal(s.payloads.length, 0);
    const payload = { max_tokens: 4096, messages: [{ role: 'system', content: 'fixed' }, { role: 'user', content: 'required' }] };
    const fitted = await budgetPayload(payload, 'required', async () => 6500, config);
    assert.equal(fitted.audit.limit, 6500); assert.equal(fitted.audit.outputTokens, 4096);
    assert.ok(fitted.audit.inputTokens + fitted.audit.outputTokens <= fitted.audit.context);
    await assert.rejects(() => budgetPayload(payload, 'required', async () => 6501, config), /context-budget-exceeded/);
    await assert.rejects(() => budgetPayload(payload, 'required', async () => 6500, { ...config, context: 10000 }), /total-context-budget-exceeded/);
    await assert.rejects(() => budgetPayload({ ...payload, max_tokens: 768 }, 'required', async () => 1, config), /output-budget-mismatch/);
  } finally { await s.close(); }
});

test('reasoning profile: mandatory input over 6500 makes no generation or action call', async () => {
  const s = await service('tools', 6501); let actions = 0;
  try {
    const core = new AnalysisCore({ ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl }, tools(() => { actions++; }), () => {});
    await assert.rejects(() => core.run('too much required input'), /context-budget-exceeded/);
    assert.equal(s.calls(), 0); assert.equal(core.calls, 0); assert.equal(actions, 0);
  } finally { await s.close(); }
});

test('reasoning profile: exhausted output exposes length and stops; no automatic continuation or action', async () => {
  const s = await service('length'); let actions = 0;
  const events: { kind: string; value: any }[] = [];
  try {
    const core = new AnalysisCore({ ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl }, tools(() => { actions++; }), (kind, value) => events.push({ kind, value }));
    await assert.rejects(() => core.run('synthetic length limit'), /analysis-ended-without-finish/);
    assert.equal(s.calls(), 1); assert.equal(actions, 0);
    assert.equal(events.find(e => e.kind === 'analysis-response')?.value.rawStopReason, 'length');
    assert.equal(JSON.stringify(events).includes(marker), false);
  } finally { await s.close(); }
});

test('reasoning profile: HTTP failure retains cause and never retries', async () => {
  const s = await service('error'); let actions = 0;
  try {
    const core = new AnalysisCore({ ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl }, tools(() => { actions++; }), () => {});
    await assert.rejects(() => core.run('synthetic service failure'), /503|test-service-unavailable/);
    assert.equal(s.calls(), 1); assert.equal(actions, 0);
  } finally { await s.close(); }
});

test('reasoning profile: timeout also bounds SSE after headers, without retry or retaining thinking', async () => {
  const s = await service('stall'); let actions = 0;
  const events: { kind: string; value: any }[] = [];
  try {
    const core = new AnalysisCore({ ...(await loadConfiguration()).analysis, baseUrl: s.baseUrl, timeoutMs: 150 }, tools(() => { actions++; }), (kind, value) => events.push({ kind, value }));
    await assert.rejects(() => core.run('synthetic stalled stream'), /analysis-request-timeout/);
    assert.equal(s.calls(), 1); assert.equal(actions, 0);
    assert.equal(events.find(e => e.kind === 'analysis-response')?.value.requestDeadlineExceeded, true);
    assert.equal(JSON.stringify(events).includes(marker), false);
  } finally { await s.close(); }
});
