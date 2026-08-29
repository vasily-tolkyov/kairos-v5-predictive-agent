import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Type from 'typebox';
import Value from 'typebox/value';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { AnalysisCore, TOOL_SCHEMAS, STRICT_TOOL_SCHEMAS, SYSTEM_PROMPT, MODE_PROMPTS, type AnalysisTools } from '../src/analysis.js';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { ACTION_SCHEMA } from '../src/analysis-actions.js';
import { deriveStrictToolSchema, encodeStrictToolArguments as encode, decodeStrictToolArguments as decode,
  STRICT_WIRE_GUIDANCE, STRICT_WIRE_VERSION } from '../src/analysis-strict-wire.js';
import { realInputTokens } from '../src/analysis-context.js';
import { loadConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

type ToolName = keyof typeof TOOL_SCHEMAS;
test('native wire V3: ordinary values and null stay native, markers are distinct and old wrappers have no fallback', () => {
  assert.equal(STRICT_WIRE_VERSION, 'KairosNativeValueStrictWireV3');
  const page = { reference: 'g1-e1', field: '', offset: 0, limit: 4 };
  assert.deepEqual(encode(TOOL_SCHEMAS.read_context, page), page);
  assert.deepEqual(encode(TOOL_SCHEMAS.read_context, { reference: 'g1-e1' }), {
    reference: 'g1-e1', field: { op: 'keep' }, offset: { op: 'keep' }, limit: { op: 'keep' },
  });
  for (const value of [null, false, 0, '', [], 'keep']) {
    const logical = Array.isArray(value) ? { tasks: value } : { desiredChange: { value } };
    const schema = Array.isArray(value) ? TOOL_SCHEMAS.set_intent : TOOL_SCHEMAS.recall;
    const wire = encode(schema, logical);
    assert.deepEqual(Array.isArray(value) ? wire.tasks : wire.desiredChange.value, value);
    assert.deepEqual(decode(schema, wire), logical);
  }
  assert.equal(encode(TOOL_SCHEMAS.recall, { desiredChange: { value: null } }).desiredChange.value, null);
  for (const [field, wrapper] of [['field', { op: 'set-string', value: '' }], ['offset', { op: 'set-number', value: 0 }],
    ['limit', { op: 'set-number', value: 4 }]] as const)
    assert.throws(() => decode(TOOL_SCHEMAS.read_context, { ...page, [field]: wrapper }), /strict-wire-invalid/);
  assert.throws(() => decode(TOOL_SCHEMAS.set_intent, { ...encode(TOOL_SCHEMAS.set_intent, {}), tasks: { op: 'set-array', value: [] } }));
  assert.throws(() => decode(TOOL_SCHEMAS.recall, { ...encode(TOOL_SCHEMAS.recall, { desiredChange: {} }), desiredChange: { value: { op: 'set-boolean', value: false }, subject: { op: 'keep' }, property: { op: 'keep' }, direction: { op: 'keep' } } }));
  // Only the seven frozen logical tools: their real objects never collide with the two wire markers.
  const inspectLogical = (schema: any) => {
    if (schema.type === 'object') for (const marker of [{ op: 'keep' }, { unit: 'empty' }])
      assert(!Value.Check(schema, marker));
    for (const v of Object.values(schema)) if (Array.isArray(v)) v.forEach(x => { if (x && typeof x === 'object') inspectLogical(x); });
      else if (v && typeof v === 'object') inspectLogical(v);
  };
  Object.values(TOOL_SCHEMAS).forEach(inspectLogical);
});

test('native null: sealed fifth call remains rejected by its old schema but passes installed Pi unchanged under the new schema', async t => {
  const path = 'evidence/native-value-wire-budget-separation-v2/bootstrap-001/events.jsonl';
  const rows = (await readFile(path, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const oldRequest = rows.filter(r => r.kind === 'analysis-request')[4].value.request;
  const call = rows.filter(r => r.kind === 'analysis-response')[4].value.tools.find((c: any) => c.name === 'set_intent');
  const oldSchema = oldRequest.tools.find((tool: any) => tool.function.name === call.name).function.parameters;
  const original = canonical(call.arguments);
  assert.equal(Value.Check(oldSchema, call.arguments), false, 'historical failure must not be relabelled');
  assert.equal(Value.Check(STRICT_TOOL_SCHEMAS.set_intent, call.arguments), true);
  const result = validateToolArguments({ name: call.name, description: '', parameters: STRICT_TOOL_SCHEMAS.set_intent }, call);
  assert.deepEqual(result, call.arguments); assert.equal(canonical(call.arguments), original);
  assert.equal(decode(TOOL_SCHEMAS.set_intent, result).tasks[0].parentId, null);
  t.diagnostic('Recorded Pi public arguments only; original HTTP was not captured. Offline installed-Pi replay, no model/body.');
});

test('native null: keep preserves a real workspace parent, null clears it, recall omission is not null and old wrappers fail', () => {
  const workspace = new CognitiveWorkspace(); workspace.startGoal('synthetic workspace root');
  workspace.update({ tasks: [{ id: 't1', parentId: 't0', objective: 'synthetic child', hypotheses: ['retain note'] }] });
  const before: any = workspace.read('t1');
  const keep = encode(TOOL_SCHEMAS.set_intent, { tasks: [{ id: 't1' }] });
  assert.deepEqual(keep.tasks[0].parentId, { op: 'keep' });
  workspace.update(decode(TOOL_SCHEMAS.set_intent, keep)); assert.deepEqual(workspace.read('t1'), before);
  const clear = encode(TOOL_SCHEMAS.set_intent, { tasks: [{ id: 't1', parentId: null }] });
  assert.equal(clear.tasks[0].parentId, null);
  const validated = validateToolArguments({ name: 'set_intent', description: '', parameters: STRICT_TOOL_SCHEMAS.set_intent },
    { type: 'toolCall', id: 'synthetic-null', name: 'set_intent', arguments: clear });
  assert.deepEqual(validated, clear); workspace.update(decode(TOOL_SCHEMAS.set_intent, validated));
  assert.deepEqual(workspace.read('t1'), { ...before, parentId: null });
  const omitted = encode(TOOL_SCHEMAS.recall, { desiredChange: {} });
  const explicit = encode(TOOL_SCHEMAS.recall, { desiredChange: { value: null } });
  assert.deepEqual(omitted.desiredChange.value, { op: 'keep' }); assert.equal(explicit.desiredChange.value, null);
  assert.equal(Object.hasOwn(decode(TOOL_SCHEMAS.recall, omitted).desiredChange, 'value'), false);
  assert.equal(decode(TOOL_SCHEMAS.recall, explicit).desiredChange.value, null);
  for (const old of [{ op: 'set-null' }, { op: 'set-number', value: 0 }]) {
    assert.throws(() => decode(TOOL_SCHEMAS.set_intent, { ...clear, tasks: [{ ...clear.tasks[0], parentId: old }] }), /strict-wire-invalid/);
    assert.throws(() => decode(TOOL_SCHEMAS.recall, { ...explicit, desiredChange: { ...explicit.desiredChange, value: old } }), /strict-wire-invalid/);
  }
  const page = encode(TOOL_SCHEMAS.read_context, { reference: 't0' });
  for (const field of ['reference', 'field', 'offset', 'limit']) assert.throws(() => decode(TOOL_SCHEMAS.read_context, { ...page, [field]: null }), /strict-wire-invalid/);
});
const actions = [
  { kind: 'observe', parameters: { ticks: 100 } }, { kind: 'wait', parameters: { ticks: 1 } },
  { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
  { kind: 'move', parameters: { direction: 'forward', ticks: 20 } },
  { kind: 'jump', parameters: { forward: false, ticks: 20 } },
  { kind: 'interact', parameters: {}, targetId: 'o1' }, { kind: 'attack', parameters: {}, targetId: 'o2' },
  { kind: 'break', parameters: {}, targetId: 'o3' }, { kind: 'place', parameters: { face: 'up' }, targetId: 'o4' },
  { kind: 'select-hotbar', parameters: { slot: 0 } },
];
function inspect(schema: any) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    assert.ok(Object.keys(schema.properties).length > 0, 'no empty strict objects');
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    assert.equal(schema.additionalProperties, false);
  }
  if (schema.type === 'array') { assert.equal(schema.minItems, undefined); assert.equal(schema.maxItems, undefined); }
  if (schema.type === 'string') assert.equal(schema.const, undefined);
  for (const value of Object.values(schema)) if (Array.isArray(value)) value.forEach(inspect); else inspect(value);
}

test('strict wire: all seven tools round-trip omission, actual null, false, zero, strings and empty arrays', () => {
  const before = sha(TOOL_SCHEMAS);
  const examples: Record<ToolName, any[]> = {
    observe: [{}],
    recall: [{ desiredChange: {} }, ...[null, false, 0, '', 'true', true, 1.5].map(value => ({ desiredChange: { value }, offset: 0 }))],
    predict: [{ action: actions[4] }, { action: actions[5], assumptions: [] }, { action: actions[0], assumptions: ['synthetic'] }],
    execute_chain: [{ actions }],
    set_intent: [{}, { tasks: [] }, { mode: 'act', currentTaskId: '', acknowledgeAttention: [], tasks: [{ id: 't1', parentId: null,
      objective: '', question: '', conclusion: '', completionCriteria: [], hypotheses: [], unknowns: [], attemptedBranches: [], evidenceRefs: [] }] },
      { tasks: [{ id: 't2', parentId: 't0', objective: 'explicit model text', status: 'paused' }] }],
    read_context: [{ reference: 't0' }, { reference: 't0', field: '', offset: 0, limit: 1 }],
    finish: [{ status: 'no-plan', report: '' }, { status: 'completed', report: 'fixture', evidenceRefs: [] }],
  };
  for (const [name, values] of Object.entries(examples) as [ToolName, any[]][]) for (const logical of values) {
    const wire = encode(TOOL_SCHEMAS[name], logical), original = canonical(wire);
    assert(Value.Check(STRICT_TOOL_SCHEMAS[name], wire)); inspect(STRICT_TOOL_SCHEMAS[name]);
    assert.deepEqual(decode(TOOL_SCHEMAS[name], wire), logical); assert.equal(canonical(wire), original);
  }
  assert.equal(sha(TOOL_SCHEMAS), before);
  assert.notDeepEqual(encode(TOOL_SCHEMAS.recall, { desiredChange: {} }), encode(TOOL_SCHEMAS.recall, { desiredChange: { value: null } }));
  assert.notDeepEqual(encode(TOOL_SCHEMAS.set_intent, {}), encode(TOOL_SCHEMAS.set_intent, { tasks: [] }));
});

test('strict wire: optional object is recursive, required fields never keep, zero-parameter unit is exact', () => {
  const schema = Type.Object({ x: Type.Optional(Type.Object({ value: Type.Optional(Type.Number()) }, { additionalProperties: false })) }, { additionalProperties: false });
  for (const value of [{}, { x: {} }, { x: { value: 0 } }]) assert.deepEqual(decode(schema, encode(schema, value)), value);
  for (const wrong of [{}, { unit: 'other' }, { unit: 'empty', extra: false }, { op: 'keep' }])
    assert.throws(() => decode(TOOL_SCHEMAS.observe, wrong));
  const wire = encode(TOOL_SCHEMAS.execute_chain, { actions: [actions[5]] });
  assert.deepEqual(wire.actions[0].parameters, { unit: 'empty' });
  wire.actions[0].targetId = { op: 'keep' }; assert.throws(() => decode(TOOL_SCHEMAS.execute_chain, wire));
  assert.throws(() => decode(TOOL_SCHEMAS.execute_chain, { actions: [{ kind: 'move', parameters: { unit: 'empty' } }] }));
  const patch = encode(TOOL_SCHEMAS.read_context, { reference: 't0' }); patch.field = { op: 'set-null' };
  assert.throws(() => decode(TOOL_SCHEMAS.read_context, patch));
});

test('strict wire: old actual nine-action error, action types/ranges and original nonempty array are still rejected', async t => {
  const old = JSON.parse(await readFile('evidence/analysis-turn-order-and-progress-timeout-v1/STOPPING_FAILURE.json', 'utf8'));
  const original = old.response.value.tools[0].arguments;
  assert.throws(() => decode(TOOL_SCHEMAS.execute_chain, original)); assert.throws(() => encode(TOOL_SCHEMAS.execute_chain, original));
  for (const action of [
    { kind: 'move', parameters: { direction: 'forward', ticks: 21 } },
    { kind: 'look', parameters: { yawDegrees: 91, pitchDegrees: 0 } },
    { kind: 'jump', parameters: { forward: 'false', ticks: 20 } },
    { kind: 'interact', parameters: { unit: 'empty' }, targetId: 'not-an-alias' },
    { kind: 'select-hotbar', parameters: { slot: '0' } },
  ]) assert.throws(() => decode(TOOL_SCHEMAS.execute_chain, { actions: [actions[3], action] }));
  assert(Value.Check(STRICT_TOOL_SCHEMAS.execute_chain, { actions: [] }));
  assert.throws(() => decode(TOOL_SCHEMAS.execute_chain, { actions: [] }), /logical-validation/);
  assert.equal(sha(ACTION_SCHEMA).toUpperCase(), '4B40BE921EFF9B7E134F3C417EA84D820116005D0E7172650057BEE7E83A3967');
  assert.equal(sha(TOOL_SCHEMAS).toUpperCase(), '120531C44777D6121EC03C78E872D37E488AE40BBDB62D192A77C5AF46857C70');
  assert.equal(sha(SYSTEM_PROMPT).toUpperCase(), '822A687B71A49A6513FD608891ABADF5FA74D9CEAA944AEE4120E18A27EE0A25');
  assert.equal(sha(MODE_PROMPTS).toUpperCase(), 'E19B035D8B2718B49BB9A46D0DFF6A1099AED44ED406E0B47FD1F10ED68B3354');
  t.diagnostic(canonical({ oldRequest: 13, oldActionCount: original.actions.length, rejectedWithoutRepair: true,
    logicalSchemaSha256: sha(TOOL_SCHEMAS), reportDescriptionsUpdated: true }));
});

type Call = { name: ToolName; logical?: any; rawWire?: any };
function response(call: Call, n: number): Response {
  const arguments_ = call.rawWire ?? encode(TOOL_SCHEMAS[call.name], call.logical);
  const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: `synthetic-${n}`,
    choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return new Response(chunk({ role: 'assistant', reasoning_content: '' }) + chunk({ tool_calls: [{ index: 0, id: `call-${n}`,
    type: 'function', function: { name: call.name, arguments: JSON.stringify(arguments_) } }] })
    + chunk({}, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
async function productionFixture(calls: Call[], httpFailure = false) {
  const config = (await loadConfiguration()).analysis, requests: any[] = [], events: any[] = [], performed: any[] = [], queries: any[] = [];
  let sequence = 10;
  const tools: AnalysisTools = {
    context: () => ({ publicObservation: { sequence, body: { selectedSlot: 4 } }, eventCount: performed.length }),
    observe: async () => ({ sequence, body: { selectedSlot: 4 } }),
    recall: async (desired, offset) => { queries.push({ desired, offset }); return { candidates: [], observationSequence: sequence, activeSeconds: .5 }; },
    predict: async () => ({ support: 0 }),
    execute: async chosen => { performed.push(structuredClone(chosen)); sequence++; return { results: [], observationSequence: sequence,
      activeSeconds: .55, publicObservation: { sequence, body: { selectedSlot: 4 } } }; },
  };
  const core = new AnalysisCore(config, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.href, 'https://api.deepseek.com/beta/chat/completions');
      const payload = JSON.parse(String(init?.body)); requests.push(payload);
      if (httpFailure) return new Response('{"error":{"message":"synthetic strict schema rejection"}}', { status: 400, headers: { 'content-type': 'application/json' } });
      const call = calls[requests.length - 1]; assert(call, 'unexpected extra request (no fallback allowed)');
      return response(call, requests.length);
    },
  });
  return { core, requests, events, performed, queries, config };
}

test('strict wire: actual Pi path decodes once, preserves raw history, null/empty updates and latest workspace chronology', async t => {
  const chosen = [actions[3], actions[2], actions[5]];
  const calls: Call[] = [
    { name: 'set_intent', logical: { mode: 'explore', tasks: [{ id: 't1', parentId: 't0', objective: 'synthetic question', hypotheses: ['old'], conclusion: 'old' }], currentTaskId: 't1' } },
    { name: 'set_intent', logical: { tasks: [{ id: 't1', parentId: null, conclusion: '', hypotheses: [] }] } },
    { name: 'recall', logical: { desiredChange: { value: null }, offset: 0 } },
    { name: 'execute_chain', logical: { actions: chosen } },
    { name: 'finish', logical: { status: 'no-plan', report: 'synthetic protocol only', evidenceRefs: [] } },
  ];
  const f = await productionFixture(calls); await f.core.run('ONE_ORIGINAL_FORMAT_TEST_GOAL');
  assert.equal(f.requests.length, 5); assert.deepEqual(f.performed, [chosen]); assert.deepEqual(f.queries, [{ desired: { value: null }, offset: 0 }]);
  const task: any = f.core.workspace.read('t1'); assert.equal(task.parentId, null); assert.equal(task.conclusion, ''); assert.deepEqual(task.hypotheses, []);
  for (const [i, request] of f.requests.entries()) {
    assert.equal(request.tools.length, 7); assert(request.tools.every((tool: any) => tool.type === 'function' && tool.function.strict === true));
    request.tools.forEach((tool: any) => inspect(tool.function.parameters));
    assert.equal(request.tool_choice, undefined); assert.equal(request.reasoning_effort, 'high');
    assert.equal(sha(request), f.events.filter(e => e.kind === 'analysis-request')[i].value.payloadSha256);
    assert.equal(request.messages.at(-1).role, 'user');
    assert(request.messages.some((message: any) => typeof message.content === 'string' && message.content.includes(STRICT_WIRE_GUIDANCE)));
  }
  const last = f.requests.at(-1), receipts = last.messages.filter((m: any) => m.role === 'tool');
  const assistants = last.messages.filter((m: any) => m.role === 'assistant');
  assert.equal(receipts.length, 4); assert.equal(assistants.length, 4);
  for (let i = 0; i < 4; i++) {
    const raw = assistants[i].tool_calls[0]; assert.equal(raw.id, `call-${i + 1}`);
    assert.deepEqual(JSON.parse(raw.function.arguments), encode(TOOL_SCHEMAS[calls[i]!.name], calls[i]!.logical));
    assert.equal(receipts[i].tool_call_id, raw.id);
  }
  assert(canonical(last.messages.at(-1)).includes('11'));
  assert.equal(canonical(last.messages).split('ONE_ORIGINAL_FORMAT_TEST_GOAL').length - 1, 1);
  assert.deepEqual(f.events.filter(e => e.kind === 'tool-start').map(e => e.value.args), calls.map(c => c.logical));
  assert(f.events.filter(e => e.kind === 'model-tool').every(e => e.value.argumentFormat === 'strict-wire'));
  const recount = await realInputTokens(f.requests[0], f.config);
  assert.equal(recount, f.events.find(e => e.kind === 'analysis-request').value.inputTokens);
  t.diagnostic(canonical({ syntheticTransport: true, realModelCalls: 0, interceptedPiRequests: 5,
    firstFinalPayloadTokens: recount, logicalExecuteInvocations: f.performed.length, rawWireHistoryPreserved: true }));
});

for (const kind of ['empty-chain', 'wrong-unit', 'bad-second-action', 'slot-coercion', 'old-nine-call', 'http-400'] as const)
  test(`strict wire: ${kind} exits with no retry, no body and no partial chain`, async t => {
    let call: Call;
    if (kind === 'old-nine-call') {
      const old = JSON.parse(await readFile('evidence/analysis-turn-order-and-progress-timeout-v1/STOPPING_FAILURE.json', 'utf8'));
      call = { name: 'execute_chain', rawWire: old.response.value.tools[0].arguments };
    } else if (kind === 'wrong-unit') call = { name: 'observe', rawWire: { unit: 'nonempty' } };
    else {
      const rawWire = kind === 'empty-chain' ? { actions: [] } : kind === 'slot-coercion'
        ? { actions: [{ kind: 'select-hotbar', parameters: { slot: '0' } }] }
        : { actions: [actions[3], { kind: 'move', direction: 'forward', parameters: { ticks: 20 } }] };
      call = { name: 'execute_chain', rawWire };
    }
    const f = await productionFixture([call], kind === 'http-400');
    await assert.rejects(() => f.core.run('Synthetic rejected format'), kind === 'http-400' ? /400|schema rejection/ : /validation|invalid|coercion/);
    assert.equal(f.requests.length, 1); assert.equal(f.performed.length, 0);
    if (kind === 'slot-coercion') assert(f.events.some(e => e.kind === 'tool-arguments-rejected'));
    t.diagnostic(canonical({ kind, interceptedRequests: f.requests.length, actualModelCalls: 0, bodyCalls: 0, replay: 0 }));
  });

test('strict wire: Qwen retains original logical parameters and no wire guidance', async () => {
  const local: any = { provider: 'llama.cpp', baseUrl: 'http://127.0.0.1:1', context: 8192, maximumOutputTokens: 768,
    nativeThinking: false, temperature: 0, topP: 1, topK: 0, minP: 0, presencePenalty: 0, seed: 1, timeoutMs: 2000 };
  const tools: AnalysisTools = { context: () => ({}), observe: async () => ({}), recall: async () => ({}), predict: async () => ({}), execute: async () => ({}) };
  const core = new AnalysisCore(local, tools, () => {});
  for (const tool of core.agent.state.tools) assert.equal(canonical(tool.parameters), canonical(TOOL_SCHEMAS[tool.name as ToolName]));
  assert.equal(core.agent.state.systemPrompt.includes(STRICT_WIRE_GUIDANCE), false);
  assert.equal(core.calls, 0);
});
