import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { encodeStrictToolArguments } from '../src/analysis-strict-wire.js';
import { loadConfiguration, type Configuration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

type SyntheticCall = { name: keyof typeof TOOL_SCHEMAS; args: unknown };
type SyntheticReply = { input: number; output: number; reasoning: number; stop: 'tool_calls' | 'length'; calls: SyntheticCall[] };
const finish: SyntheticCall = { name: 'finish', args: { status: 'no-plan', report: 'Synthetic usage fixture only; not learned ability.' } };
const action: SyntheticCall = { name: 'execute_chain', args: { actions: [{ kind: 'wait', parameters: { ticks: 1 } }] } };
function response(reply: SyntheticReply, n: number): Response {
  const chunk = (delta: unknown, finish_reason: string | null = null, usage?: unknown) =>
    `data: ${JSON.stringify({ id: `synthetic-output-budget-${n}`, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
  const tool_calls = reply.calls.map((call, index) => ({ index, id: `synthetic-call-${n}-${index}`, type: 'function', function: {
    name: call.name, arguments: JSON.stringify(encodeStrictToolArguments(TOOL_SCHEMAS[call.name], call.args)),
  } }));
  return new Response(chunk({ role: 'assistant', reasoning_content: '', tool_calls }) + chunk({}, reply.stop, {
    prompt_tokens: reply.input, completion_tokens: reply.output, total_tokens: reply.input + reply.output,
    completion_tokens_details: { reasoning_tokens: reply.reasoning },
  }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function fixture(config: Configuration['analysis'], replies: SyntheticReply[]) {
  const requests: any[] = [], events: { kind: string; value: any }[] = [], executions: unknown[] = [];
  const unused = async () => { throw new Error('no-physical-query-or-body-in-output-budget-fixture'); };
  const tools: AnalysisTools = { context: () => ({ publicObservation: { sequence: 1, activeSeconds: .05, body: { selectedSlot: 0 } } }),
    observe: unused, recall: unused, predict: unused,
    execute: async actions => { executions.push(structuredClone(actions)); return { syntheticPortOnly: true }; },
  };
  const core = new AnalysisCore(config, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'https://api.deepseek.com'); assert.equal(url.pathname, '/beta/chat/completions');
      requests.push(JSON.parse(String(init?.body)));
      assert(requests.length <= replies.length, 'no extra synthetic request or retry');
      return response(replies[requests.length - 1]!, requests.length);
    },
  });
  return { core, requests, events, executions };
}
const smallFinish: SyntheticReply = { input: 6000, output: 100, reasoning: 20, stop: 'tool_calls', calls: [finish] };

test('output budget: old 8192 and new 32768 are sent by the same production Pi boundary', async t => {
  const before = JSON.parse(await readFile('evidence/analysis-output-budget-bootstrap-continuation-v1/before/kairos.config.json', 'utf8')) as Configuration;
  const current = await loadConfiguration();
  const oldRun = fixture(before.analysis, [smallFinish]), newRun = fixture(current.analysis, [smallFinish]);
  await oldRun.core.run('Synthetic output budget transmission'); await newRun.core.run('Synthetic output budget transmission');
  const oldPayload = oldRun.requests[0], newPayload = newRun.requests[0];
  t.diagnostic(canonical({ syntheticTransportOnly: true, old: { context: before.analysis.context, maximumInputTokens: before.analysis.maximumInputTokens,
    sentMaximumOutputTokens: oldPayload.max_tokens }, current: { context: current.analysis.context,
    maximumInputTokens: current.analysis.maximumInputTokens, sentMaximumOutputTokens: newPayload.max_tokens },
    requests: [oldRun.requests.length, newRun.requests.length], realModelCalls: 0, realBodyCalls: 0 }));
  assert.equal(oldPayload.max_tokens, 8192);
  assert.equal(newPayload.max_tokens, 32768);
  assert.equal(current.analysis.context, 65536); assert.equal(current.analysis.maximumInputTokens, 24000);
  assert.deepEqual(current, { ...before, analysis: { ...before.analysis, context: 65536, maximumOutputTokens: 32768 } });
  assert.equal(current.analysis.context - current.analysis.maximumInputTokens! - current.analysis.maximumOutputTokens, 8768);
  for (const field of ['model', 'thinking', 'reasoning_effort', 'tools']) assert.deepEqual(newPayload[field], oldPayload[field], field);
  for (const field of ['temperature', 'top_p', 'top_k', 'min_p', 'seed', 'presence_penalty', 'frequency_penalty', 'tool_choice'])
    assert.equal(newPayload[field], undefined, field);
  assert.equal(newRun.events.find(e => e.kind === 'analysis-request')!.value.limit, 24000);
  assert.equal(oldRun.executions.length + newRun.executions.length, 0);
  assert.equal(oldRun.requests.length, 1); assert.equal(newRun.requests.length, 1);
  t.diagnostic(canonical({ toolWireSha256: sha(newPayload.tools), currentConfiguration: current.analysis }));
});

test('output budget: synthetic usage above 8192 can execute the chosen tool then finish normally', async t => {
  const config = (await loadConfiguration()).analysis;
  const f = fixture(config, [{ input: 6000, output: 9000, reasoning: 8800, stop: 'tool_calls', calls: [action] }, smallFinish]);
  const result = await f.core.run('Synthetic long response, not a real model qualification');
  assert.equal(result.status, 'no-plan'); assert.equal(f.requests.length, 2);
  assert.deepEqual(f.executions, [(action.args as { actions: unknown[] }).actions]);
  assert.deepEqual(f.events.filter(e => e.kind === 'tool-start').map(e => e.value.name), ['execute_chain', 'finish']);
  assert(f.requests.every(r => r.max_tokens === 32768));
  const actual = f.events.find(e => e.kind === 'analysis-response')!.value;
  assert.equal(actual.usage.output, 9000); assert.equal(actual.stopReason, 'toolUse');
  assert.equal(actual.serviceActualTotalTokens, 15000);
  t.diagnostic(canonical({ syntheticUsageNotRealGeneration: true, reportedOutput: actual.usage.output,
    toolStarts: f.events.filter(e => e.kind === 'tool-start').map(e => e.value.name),
    syntheticExecutePortCalls: f.executions.length, realModelCalls: 0, realBodyCalls: 0 }));
});

test('output budget: length remains fatal before the included tool without continuation or replay', async t => {
  const config = (await loadConfiguration()).analysis;
  const f = fixture(config, [{ input: 6000, output: config.maximumOutputTokens,
    reasoning: config.maximumOutputTokens, stop: 'length', calls: [action] }]);
  await assert.rejects(() => f.core.run('Synthetic truncation must stop'), /analysis-output-truncated:length/);
  assert.equal(f.requests.length, 1); assert.equal(f.executions.length, 0);
  assert.equal(f.events.filter(e => e.kind === 'tool-start').length, 0);
  const actual = f.events.find(e => e.kind === 'analysis-response')!.value;
  assert.equal(actual.stopReason, 'length'); assert.equal(actual.requestDeadlineExceeded, false);
  t.diagnostic(canonical({ syntheticTransportOnly: true, stop: actual.stopReason, output: actual.usage.output,
    modelTransportRequests: f.requests.length, toolStarts: 0, actionPortCalls: 0, retries: 0 }));
});
