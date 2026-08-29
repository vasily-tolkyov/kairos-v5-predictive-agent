import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { encodeStrictToolArguments } from '../src/analysis-strict-wire.js';
import { budgetPayload } from '../src/analysis-context.js';
import { loadConfiguration, type Configuration } from '../src/services.js';

test('budget separation: local 24000 target still trims whole groups or rejects before any model request', async () => {
  const config = (await loadConfiguration()).analysis;
  const payload: any = { max_tokens: config.maximumOutputTokens, messages: [
    { role: 'system', content: 'synthetic system' }, { role: 'user', content: 'immutable goal' },
    { role: 'assistant', tool_calls: [{ id: 'older' }] }, { role: 'tool', tool_call_id: 'older', content: 'older detail' },
    { role: 'assistant', tool_calls: [{ id: 'latest' }] }, { role: 'tool', tool_call_id: 'latest', content: 'latest real page' },
    { role: 'user', content: 'current required state' },
  ] };
  const counted = await budgetPayload(payload, 'compact state', async p => (p.messages as any[]).some(m => m.tool_call_id === 'older') ? 24001 : 23990, config);
  assert.equal(counted.audit.inputTokens, 23990); assert.equal(counted.audit.removedInteractionGroups, 1);
  assert((counted.payload.messages as any[]).some(m => m.tool_call_id === 'latest'));
  assert.equal((counted.payload.messages as any[]).at(-1).content, 'current required state');
  await assert.rejects(() => budgetPayload(payload, 'compact state', async () => 24001, config), /budget/);
});

function usageResponse(input: number, output: number, remote: boolean) {
  const logical = { status: 'no-plan', report: 'synthetic budget fixture; not a model result' };
  const args = remote ? encodeStrictToolArguments(TOOL_SCHEMAS.finish, logical) : logical;
  const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  return new Response(chunk({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '', tool_calls: [{ index: 0, id: 'budget-call',
    type: 'function', function: { name: 'finish', arguments: JSON.stringify(args) } }] }, finish_reason: null }] })
    + chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } })
    + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
async function fixture(config: Configuration['analysis'], input: number, output: number) {
  const events: any[] = []; let requests = 0;
  const unused = async () => { throw new Error('budget-test-must-not-call-physical-or-body-tools'); };
  const tools: AnalysisTools = { context: () => ({ publicObservation: { sequence: 1, body: {} } }), observe: unused, recall: unused, predict: unused, execute: unused };
  const core = new AnalysisCore(config, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async () => { requests++; return usageResponse(input, output, config.provider === 'deepseek'); },
  });
  return { core, events, requests: () => requests };
}

test('budget separation: DeepSeek service input above local target is allowed when actual total and output are legal', async t => {
  const config = (await loadConfiguration()).analysis, f = await fixture(config, 24054, 100);
  await f.core.run('Synthetic budget case');
  assert.equal(f.requests(), 1);
  const request = f.events.find(e => e.kind === 'analysis-request').value;
  const response = f.events.find(e => e.kind === 'analysis-response').value;
  assert.equal(request.inputLimitMeaning, 'local-preparation-target'); assert(request.inputTokens <= 24000);
  assert.equal(request.wireFormatVersion, 'KairosNativeValueStrictWireV3');
  assert.equal(response.serviceActualInputTokens, 24054); assert.equal(response.serviceActualTotalTokens, 24154);
  assert.equal(f.events.filter(e => e.kind === 'tool-end' && e.value.name === 'finish').length, 1);
  t.diagnostic('Synthetic usage only: 24054 input + 100 output allowed; no real HTTP or physical result');
});

for (const name of ['total-overflow', 'output-overflow'] as const)
  test(`budget separation: actual ${name} still fails without executing a tool or retrying`, async () => {
    const config = (await loadConfiguration()).analysis;
    const input = name === 'total-overflow' ? config.context - 99 : 1000;
    const output = name === 'total-overflow' ? 100 : config.maximumOutputTokens + 1;
    const f = await fixture(config, input, output);
    await assert.rejects(() => f.core.run('Synthetic hard-limit violation'), /service-actual-token-budget-exceeded/);
    assert.equal(f.requests(), 1); assert.equal(f.events.filter(e => e.kind === 'tool-start').length, 0);
  });

test('budget separation: Qwen service input hard limit is unchanged (synthetic tokenizer and transport)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/apply-template') return Response.json({ prompt: 'synthetic tokenizer' });
    assert.equal(url.pathname, '/tokenize'); return Response.json({ tokens: [1, 2, 3] });
  };
  try {
    const local: any = { provider: 'llama.cpp', baseUrl: 'http://127.0.0.1:1', context: 8192, maximumInputTokens: 6500, maximumOutputTokens: 768,
      nativeThinking: false, temperature: 0, topP: 1, topK: 0, minP: 0, presencePenalty: 0, seed: 1, timeoutMs: 2000 };
    const f = await fixture(local, 6501, 1);
    await assert.rejects(() => f.core.run('Synthetic Qwen limit'), /service-actual-token-budget-exceeded/);
    assert.equal(f.requests(), 1); assert.equal(f.events.filter(e => e.kind === 'tool-start').length, 0);
    assert.equal(f.events.find(e => e.kind === 'analysis-request').value.inputLimitMeaning, 'local-and-service-input-hard-limit');
  } finally { globalThis.fetch = originalFetch; }
});
