import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { encodeStrictToolArguments } from '../src/analysis-strict-wire.js';
import * as context from '../src/analysis-context.js';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { loadConfiguration, type Configuration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

// Isolated HTTP/SSE transport, not model or physical capability evidence. No external requests.
type Call = { name: string; args: unknown };
const endCall: Call = { name: 'finish', args: { status: 'needs-experience', report: 'Synthetic end, not a physical result.' } };
const action: Call = { name: 'execute_chain', args: { actions: [{ kind: 'wait', parameters: { ticks: 1 } }] } };
const privateMarker = 'SYNTHETIC_NATIVE_CONTENT_NOT_REAL_THOUGHTS';
function emit(res: ServerResponse, delta: unknown, finish_reason: string | null = null) {
  res.write(`data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
}
function complete(res: ServerResponse, n: number, call: Call = endCall, finishReason = 'tool_calls', strictWire = false) {
  emit(res, { tool_calls: [{ index: 0, id: `call-${n}`, type: 'function', function: { name: call.name,
    arguments: JSON.stringify(strictWire ? encodeStrictToolArguments(TOOL_SCHEMAS[call.name as keyof typeof TOOL_SCHEMAS], call.args) : call.args) } }] });
  emit(res, {}, finishReason); res.end('data: [DONE]\n\n');
}
async function service(handler: (n: number, res: ServerResponse, payload: any) => void, preparationEndpointDelay = 0) {
  const requests: any[] = [], scheduled = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += String(part);
    if (req.url === '/apply-template' || req.url === '/tokenize') {
      await delay(preparationEndpointDelay);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url === '/apply-template' ? { prompt: 'synthetic template' } : { tokens: [1, 2, 3] })); return;
    }
    const payload = JSON.parse(body); requests.push(payload);
    res.setHeader('content-type', 'text/event-stream'); handler(requests.length, res, payload);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const later = (res: ServerResponse, ms: number, fn: () => void) => {
    const timer = setTimeout(() => { scheduled.delete(timer); if (!res.destroyed) fn(); }, ms);
    scheduled.add(timer); res.once('close', () => { clearTimeout(timer); scheduled.delete(timer); });
  };
  const redirectFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://api.deepseek.com'); assert.equal(url.pathname, '/beta/chat/completions');
    return fetch(base + url.pathname, init);
  };
  return { requests, baseUrl: base + '/v1', redirectFetch, later,
    close: async () => { for (const timer of scheduled) clearTimeout(timer); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve())); } };
}
const local = (baseUrl: string, timeoutMs = 2000): Configuration['analysis'] => ({ provider: 'llama.cpp',
  model: 'synthetic-no-model-file', modelSha256: 'synthetic', llama: 'synthetic-no-server-binary', llamaSha256: 'synthetic', baseUrl, context: 8192,
  maximumInputTokens: 6500, maximumOutputTokens: 768, nativeThinking: false, temperature: 0,
  topP: 1, topK: 0, minP: 0, presencePenalty: 0, seed: 1, timeoutMs });
const ports = (execute: AnalysisTools['execute'] = async () => ({ actual: true })): AnalysisTools => ({
  context: () => ({ publicObservation: { sequence: 1, body: { selectedSlot: 4 } } }),
  observe: async () => ({ sequence: 1, body: { selectedSlot: 4 } }),
  recall: async desired => ({ query: desired, candidates: [] }), predict: async () => ({ support: 0 }), execute,
});
const wireText = (m: any) => typeof m.content === 'string' ? m.content : (m.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
const pair = (i: number, text = `public result ${i}`): context.WireMessage[] => {
  const call = { id: `c${i}`, type: 'function', function: { name: 'observe', arguments: '{}' } };
  return [{ role: 'assistant', content: null, reasoning_content: privateMarker + i, tool_calls: [call] },
    { role: 'tool', tool_call_id: `c${i}`, content: text }];
};
const budgetConfig = { context: 32768, maximumOutputTokens: 8192, maximumInputTokens: 24000 };

test('red counterexample: current workspace follows the completed production tool pair, with one original goal', async () => {
  const s = await service((n, res) => complete(res, n, n === 1 ? action : endCall));
  let actions = 0;
  const tools: AnalysisTools = { ...ports(), context: () => ({ publicObservation: { sequence: actions + 1, body: { selectedSlot: 4 } }, eventCount: actions }),
    execute: async () => { actions++; return { results: [{ eventId: `new-${actions}`, executed: true, status: 'completed' }],
      publicObservation: { sequence: actions + 1, body: { selectedSlot: 4 } } }; } };
  try {
    const core = new AnalysisCore(local(s.baseUrl), tools, () => {}); await core.run('ONE_IMMUTABLE_USER_GOAL');
    const messages = s.requests[1].messages, last = messages.at(-1);
    const receiptIndex = messages.findIndex((m: any) => m.role === 'tool' && m.tool_call_id === 'call-1');
    const currentIndex = messages.findIndex((m: any) => m.role === 'user' && wireText(m).includes('latestPublicObservationRef'));
    assert.ok(currentIndex > receiptIndex, `current=${currentIndex}, receipt=${receiptIndex}`);
    assert.equal(last.role, 'user'); assert.equal(JSON.parse(wireText(last)).operationalState.eventCount, 1);
    assert.equal(canonical(messages).split('ONE_IMMUTABLE_USER_GOAL').length - 1, 1);
    assert.equal(actions, 1); assert.equal(s.requests.length, 2);
  } finally { await s.close(); }
});

test('red counterexample: whole-prefix budget search is logarithmic rather than one tokenizer launch per removed group', async t => {
  const p = { max_tokens: 8192, messages: [{ role: 'system', content: 'fixed' }, { role: 'user', content: 'immutable goal' },
    ...Array.from({ length: 24 }, (_, i) => pair(i)).flat(), { role: 'user', content: 'mandatory current workspace' }] };
  const count = async (p: Record<string, unknown>) => 100 + (p.messages as any[]).filter(m => m.role === 'tool').length * 100;
  const result = await context.budgetPayload(p, 'mandatory current workspace', count, { ...budgetConfig, maximumInputTokens: 700 });
  t.diagnostic(canonical(result.audit));
  assert.equal(result.audit.removedInteractionGroups, 18); assert.ok(result.audit.tokenizationPasses <= 7);
  assert.deepEqual((result.payload.messages as any[]).filter(m => m.role === 'tool').map(m => m.tool_call_id), ['c18', 'c19', 'c20', 'c21', 'c22', 'c23']);
});

test('red counterexample: local preparation longer than the scaled remote timeout does not consume its window', async t => {
  // Each existing tokenizer endpoint is within its own deadline; their combined time exceeds it.
  const s = await service((n, res) => complete(res, n), 250), events: any[] = [];
  try {
    const core = new AnalysisCore(local(s.baseUrl, 400), ports(), (kind, value) => events.push({ kind, value }));
    await core.run('Synthetic slow local preparation'); assert.equal(s.requests.length, 1);
    const response = events.find(e => e.kind === 'analysis-response').value;
    assert.ok(response.preparationMilliseconds > 400); assert.equal(response.requestDeadlineExceeded, false);
    t.diagnostic(canonical({ preparationMilliseconds: response.preparationMilliseconds, generationMilliseconds: response.generationMilliseconds }));
  } finally { await s.close(); }
});

test('red counterexample: continuous genuine SSE deltas may exceed the total scaled timeout', async t => {
  const s = await service((n, res) => {
    emit(res, { role: 'assistant', reasoning_content: privateMarker });
    for (let i = 1; i <= 7; i++) s.later(res, i * 90, () => emit(res, { reasoning_content: ' synthetic' }));
    s.later(res, 680, () => complete(res, n));
  }), events: any[] = [];
  try {
    const core = new AnalysisCore(local(s.baseUrl, 250), ports(), (kind, value) => events.push({ kind, value }));
    await core.run('Synthetic progress beyond a total duration'); assert.equal(s.requests.length, 1);
    const response = events.find(e => e.kind === 'analysis-response').value;
    assert.ok(response.generationMilliseconds > 500); assert.ok(response.effectiveProgressCount >= 8);
    assert.equal(response.requestDeadlineExceeded, false); assert.equal(canonical(events).includes(privateMarker), false);
    t.diagnostic(canonical({ generationMilliseconds: response.generationMilliseconds, effectiveProgressCount: response.effectiveProgressCount }));
  } finally { await s.close(); }
});

test('sealed requests 18/19: public-only replay preserves call/result chronology and places acquired state last', async t => {
  const raw = JSON.parse(await readFile('evidence/analysis-turn-order-and-progress-timeout-v1/SEALED_PUBLIC_REQUESTS_18_20.json', 'utf8'));
  for (const entry of raw.requests.slice(0, 2)) {
    const wire = entry.request.value.request.messages, current = JSON.parse(wireText(wire[1]));
    const goal = current.originalUserGoal, constraints = current.originalUserConstraints;
    const names = new Map<string, string>();
    const messages: AgentMessage[] = [{ role: 'user', content: goal, timestamp: 0 }, ...wire.slice(2).map((m: any) => {
      if (m.role === 'user') return { role: 'user', content: wireText(m), timestamp: 0 };
      if (m.role === 'tool') return { role: 'toolResult', toolCallId: m.tool_call_id, toolName: names.get(m.tool_call_id),
        isError: false, content: [{ type: 'text', text: wireText(m) }], timestamp: 0 };
      const calls = (m.tool_calls ?? []).map((c: any) => { names.set(c.id, c.function.name); return { type: 'toolCall', id: c.id,
        name: c.function.name, arguments: JSON.parse(c.function.arguments) }; });
      return { role: 'assistant', content: [...(m.content ? [{ type: 'text', text: wireText(m) }] : []), ...calls], timestamp: 0 };
    }) as AgentMessage[]];
    const { originalUserGoal: _g, originalUserConstraints: _c, ...publicState } = current;
    const refs = publicState.evidence.map((e: any) => e.ref);
    const result = context.orderAnalysisContext(messages, goal, canonical({ originalUserGoal: goal, originalUserConstraints: constraints }),
      { text: canonical(publicState), evidenceRefs: refs }, true);
    assert.equal(result.at(-1)!.role, 'user'); assert.deepEqual(JSON.parse(wireText(result.at(-1))), publicState);
    const calls = new Set<string>(); for (const message of result) {
      if (message.role === 'assistant') for (const p of message.content) if (p.type === 'toolCall') calls.add(p.id);
      if (message.role === 'toolResult') assert.ok(calls.has(message.toolCallId));
    }
    assert.equal(canonical(result).split(goal).length - 1, 1);
    assert.equal(result.filter(m => m.role === 'toolResult').length, wire.filter((m: any) => m.role === 'tool').length);
    t.diagnostic(canonical({ requestNumber: entry.requestNumber, publicStructureOnly: true, privateReasoningReconstructed: false,
      beforeCurrentIndex: 1, afterCurrentIndex: result.length - 1, latestPublicObservationRef: current.latestPublicObservationRef }));
  }
});

test('official tokenizer: binary search returns the same complete suffix as the linear reference and keeps all mandatory material', async t => {
  const cfg = (await loadConfiguration()).analysis;
  const header = [{ role: 'system', content: 'Synthetic responsibility' }, { role: 'user', content: 'IMMUTABLE_GOAL_AND_CONSTRAINTS' }];
  const tail = { role: 'user', content: 'MANDATORY_CURRENT_EVIDENCE_AND_PENDING_NOTICE' };
  const groups = Array.from({ length: 24 }, (_, i) => pair(i, (`synthetic public block ${i} alpha beta gamma delta `).repeat(350)));
  const p = { model: 'deepseek-v4-pro', max_tokens: 8192, thinking: { type: 'enabled' }, reasoning_effort: 'high',
    messages: [...header, ...groups.flat(), tail], tools: [] };
  const passes: { removed: number; tokens: number }[] = [];
  const result = await context.budgetPayload(p, tail.content, async candidate => {
    const tokens = await context.realInputTokens(candidate, cfg);
    passes.push({ removed: 24 - (candidate.messages as any[]).filter(m => m.role === 'tool').length, tokens }); return tokens;
  }, cfg);
  let referenceRemoved = 0, referenceTokens = 0, referencePasses = 0;
  for (; referenceRemoved < groups.length; referenceRemoved++) {
    referenceTokens = await context.realInputTokens({ ...p, messages: [...header, ...groups.slice(referenceRemoved).flat(), tail] }, cfg); referencePasses++;
    if (referenceTokens <= 24000) break;
  }
  const selected = result.payload.messages as any[];
  assert.equal(result.audit.removedInteractionGroups, referenceRemoved); assert.equal(result.audit.inputTokens, referenceTokens);
  assert.ok(result.audit.inputTokens <= 24000); assert.ok(result.audit.tokenizationPasses <= 7);
  assert.ok(result.audit.tokenizationPasses < referencePasses); assert.deepEqual(selected.slice(0, 2), header);
  assert.deepEqual(selected.at(-1), tail); assert.deepEqual(selected.slice(2, -1), groups.slice(referenceRemoved).flat());
  assert.doesNotThrow(() => context.interactionGroups(selected.slice(2, -1)));
  t.diagnostic(canonical({ synthetic: true, officialTokenizer: true, passes, referencePasses, referenceRemoved, referenceTokens,
    selectedSuffixSha256: sha(selected.slice(2, -1)), originalPayloadUnchanged: p.messages.length === 51 }));
});

test('mandatory goal/current workspace/latest tool cannot be evicted; compact task index only changes workspace presentation', async () => {
  const p = { max_tokens: 8192, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'original-goal' },
    ...pair(0), ...pair(1), { role: 'user', content: 'full-current-index' }] };
  const seen: any[] = [];
  await assert.rejects(() => context.budgetPayload(p, 'compact-current-index', async x => { seen.push(x); return 24001; }, budgetConfig), /context-budget-exceeded/);
  for (const x of seen) { assert.equal(x.messages[1].content, 'original-goal'); assert.ok(x.messages.some((m: any) => m.tool_call_id === 'c1'));
    assert.ok(['full-current-index', 'compact-current-index'].includes(x.messages.at(-1).content)); }
  assert.equal(p.messages.at(-1)!.content, 'full-current-index');
});

test('same action parameters in two new native calls execute once each; tail user context retains each original native reasoning field', async () => {
  const s = await service((n, res) => { emit(res, { role: 'assistant', reasoning_content: n === 2 ? '' : privateMarker });
    complete(res, n, n <= 2 ? action : endCall, 'tool_calls', true); });
  const events: any[] = [], actions: unknown[] = [];
  try {
    const core = new AnalysisCore((await loadConfiguration()).analysis, ports(async chosen => { actions.push(...chosen); return { results: [] }; }),
      (kind, value) => events.push({ kind, value }), { apiKeyForTest: 'synthetic-key', fetchForTest: s.redirectFetch });
    await core.run('Repeat only when explicitly chosen anew'); assert.equal(s.requests.length, 3); assert.equal(actions.length, 2);
    assert.deepEqual(actions[0], actions[1]);
    const messages = s.requests[2].messages, assistants = messages.filter((m: any) => m.role === 'assistant');
    assert.equal(assistants[0].reasoning_content, privateMarker); assert.equal(assistants[1].reasoning_content, '');
    assert.equal(messages.at(-1).role, 'user');
    assert.deepEqual(events.filter(e => e.kind === 'model-tool').map(e => e.value.name), ['execute_chain', 'execute_chain', 'finish']);
    for (const data of [events, core.workspace.snapshot(), core.agent.state.messages]) assert.equal(canonical(data).includes(privateMarker), false);
  } finally { await s.close(); }
});

for (const keepalive of [false, true]) test(`headers${keepalive ? '/keepalive/empty-deltas' : ''} do not postpone the no-progress deadline`, async () => {
  const s = await service((_n, res) => {
    res.flushHeaders(); if (keepalive) for (let i = 1; i <= 9; i++) s.later(res, i * 50, () => {
      res.write(': synthetic keepalive\n\n'); emit(res, { content: '', reasoning_content: '' });
    });
  }), events: any[] = []; let actions = 0;
  try {
    const core = new AnalysisCore(local(s.baseUrl, 250), ports(async () => { actions++; }), (kind, value) => events.push({ kind, value }));
    await assert.rejects(() => core.run('Synthetic stalled SSE'), /timeout/);
    const response = events.find(e => e.kind === 'analysis-response').value;
    assert.equal(response.effectiveProgressCount, 0); assert.equal(response.requestDeadlineExceeded, true);
    assert.equal(s.requests.length, 1); assert.equal(actions, 0);
  } finally { await s.close(); }
});

test('a user abort interrupts a generating request without retry, tool execution or a later timeout event', async () => {
  let core: AnalysisCore; const s = await service((_n, res) => {
    emit(res, { role: 'assistant', content: 'synthetic progress' }); s.later(res, 25, () => core.agent.abort());
  }), events: any[] = []; let actions = 0;
  try {
    core = new AnalysisCore(local(s.baseUrl, 250), ports(async () => { actions++; }), (kind, value) => events.push({ kind, value }));
    await assert.rejects(() => core.run('Synthetic user stop'), /abort/i);
    assert.equal(s.requests.length, 1); assert.equal(actions, 0);
    const count = events.length; await delay(280); assert.equal(events.length, count);
    assert.equal(events.find(e => e.kind === 'analysis-response').value.requestDeadlineExceeded, false);
  } finally { await s.close(); }
});

test('truncated output and HTTP errors stop without accepting an incomplete action or retrying', async () => {
  for (const kind of ['length', 'http'] as const) {
    const s = await service((n, res) => { if (kind === 'http') { res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":{"message":"synthetic-unavailable"}}'); }
      else complete(res, n, action, 'length'); }); let actions = 0;
    try {
      const core = new AnalysisCore(local(s.baseUrl), ports(async () => { actions++; }), () => {});
      await assert.rejects(() => core.run('Synthetic original error'), kind === 'http' ? /503|unavailable/ : /length|truncat/);
      assert.equal(s.requests.length, 1); assert.equal(actions, 0);
    } finally { await s.close(); }
  }
});

test('original user material and current notes are distinct readonly views without automatic task completion', () => {
  const w = new CognitiveWorkspace(); w.startGoal('ONE_GOAL', ['ONE_CONSTRAINT']);
  w.update({ tasks: [{ id: 't1', parentId: 't0', objective: 'model-created child', status: 'active' }], currentTaskId: 't1' });
  const before = canonical(w.snapshot()), original = w.originalMaterial(), material = w.material().text;
  assert.equal((original + material).split('ONE_GOAL').length - 1, 1); assert.equal((original + material).split('ONE_CONSTRAINT').length - 1, 1);
  assert.ok(material.includes('之后') && material.includes('不是新目标'));
  assert.equal(canonical(w.snapshot()), before); assert.equal((w.read('t1') as any).status, 'active');
});
