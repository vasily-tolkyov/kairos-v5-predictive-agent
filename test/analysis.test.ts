import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { encodeStrictToolArguments as encode, decodeStrictToolArguments as decode } from '../src/analysis-strict-wire.js';
import { canonical } from '../src/util.js';
import type { Configuration } from '../src/services.js';

async function fakeService(handler: (count: number) => { name: string; args: unknown } | 'error', tokenCount = 3) {
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume without retaining prompt */ }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/apply-template') { res.end(JSON.stringify({ prompt: 'synthetic template' })); return; }
    if (req.url === '/tokenize') { res.end(JSON.stringify({ tokens: Array(tokenCount).fill(1) })); return; }
    const call = handler(++requests);
    if (call === 'error') { res.writeHead(503).end(JSON.stringify({ error: { message: 'deliberate-model-service-failure' } })); return; }
    res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0,
      delta: { role: 'assistant', tool_calls: [{ index: 0, id: `tool-${requests}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  return { server, requests: () => requests, url: `http://127.0.0.1:${address.port}/v1` };
}
const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
const tools = (execute: AnalysisTools['execute']): AnalysisTools => ({
  observe: async () => ({ public: true }), recall: async () => ({ candidates: [] }), predict: async () => ({ support: 0 }),
  execute, context: () => ({ remainingActions: 512 }),
});
const config = (baseUrl: string) => ({ baseUrl, context: 8192, maximumOutputTokens: 768,
  nativeThinking: false, temperature: 0, topP: 1, topK: 0, minP: 0, presencePenalty: 0,
  seed: 1, timeoutMs: 2000 } as Configuration['analysis']);
test('Pi basic tool loop executes the model chain once and terminates only on its finish', async () => {
  let actions = 0;
  const service = await fakeService(n => n === 1 ? { name: 'execute_chain', args: { actions: [{ kind: 'wait', parameters: { ticks: 1 } }] } }
    : { name: 'finish', args: { status: 'completed', report: 'observed synthetic completion' } });
  try {
    const core = new AnalysisCore(config(service.url), tools(async chosen => { actions += chosen.length; return { actual: true }; }), () => {});
    const finish = await core.run('Synthetic test goal'); assert.equal(finish.status, 'completed'); assert.equal(actions, 1); assert.equal(service.requests(), 2);
  } finally { await close(service.server); }
});
test('original body exception exits without a fallback, another model request or action replay', async () => {
  let actions = 0; const original = new Error('original-physical-call-failure');
  const service = await fakeService(() => ({ name: 'execute_chain', args: { actions: [{ kind: 'jump', parameters: { forward: false, ticks: 4 } }] } }));
  try {
    const core = new AnalysisCore(config(service.url), tools(async () => { actions++; throw original; }), () => {});
    // The established public error boundary sanitizes into a new Error; preserve its original cause and stack, not object identity.
    await assert.rejects(() => core.run('Synthetic failing action'), error => error instanceof Error
      && error.message === original.message && error.stack === original.stack);
    assert.equal(actions, 1); assert.equal(service.requests(), 1);
  } finally { await close(service.server); }
});
test('HTTP failure is fatal and SDK/provider retries are disabled', async () => {
  const service = await fakeService(() => 'error'); let actions = 0;
  try { const core = new AnalysisCore(config(service.url), tools(async () => { actions++; return null; }), () => {});
    await assert.rejects(() => core.run('Service failure'), /503|deliberate/); assert.equal(service.requests(), 1); assert.equal(actions, 0);
  } finally { await close(service.server); }
});
test('one production Pi instance switches modes and preserves evidence older than two assistant turns', async () => {
  const calls = [
    { name: 'recall', args: { desiredChange: { direction: 'change' } } },
    { name: 'set_intent', args: { mode: 'recall', tasks: [{ id: 't1', parentId: 't0', objective: 'model question', evidenceRefs: ['g1-e1'] }], currentTaskId: 't1' } },
    { name: 'observe', args: {} }, { name: 'observe', args: {} },
    { name: 'set_intent', args: { mode: 'plan', tasks: [{ id: 't1', question: 'is the old condition still known?' }] } },
    { name: 'read_context', args: { reference: 'g1-e1' } },
    { name: 'finish', args: { status: 'needs-experience', report: 'old evidence lacks current applicability', evidenceRefs: ['g1-e1'] } },
  ];
  const service = await fakeService(n => calls[n - 1]!); const events: { kind: string; value: any }[] = [];
  try {
    const core = new AnalysisCore(config(service.url), { ...tools(async () => null), recall: async () => ({ condition: 'sealed-old-physical-evidence', support: 0 }) },
      (kind, value) => events.push({ kind, value }));
    const agent = core.agent; await core.run('Original immutable question');
    assert.equal(core.agent, agent); assert.equal(core.workspace.mode, 'plan');
    const requests = events.filter(e => e.kind === 'analysis-request'); assert.equal(requests.length, 7);
    assert.ok(JSON.stringify(requests[5]!.value.request).includes('sealed-old-physical-evidence'));
    assert.ok(JSON.stringify(requests[5]!.value.request).includes('当前模式：规划与推演'));
    assert.equal(requests[5]!.value.removedInteractionGroups, 0);
    assert.equal((core.workspace.read('t1') as any).status, 'open');
    assert.equal(events.find(e => e.kind === 'tool-end' && e.value.name === 'read_context')!.value.result.selectedValue.data.support, 0);
  } finally { await close(service.server); }
});
test('empty look is a fatal schema error, never a zero-angle action or a repaired request', async () => {
  const service = await fakeService(() => ({ name: 'execute_chain', args: { actions: [{ kind: 'look', parameters: {} }] } })); let actions = 0;
  try { const core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), () => {});
    await assert.rejects(() => core.run('invalid tool output'), /validation/); assert.equal(actions, 0); assert.equal(service.requests(), 1);
  } finally { await close(service.server); }
});
test('mandatory context over 6500 real-tokenizer response rejects before any model request or action', async () => {
  const service = await fakeService(() => 'error', 6501); let actions = 0;
  try { const core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), () => {});
    await assert.rejects(() => core.run('critical material may not be silently dropped'), /context-budget-exceeded/);
    assert.equal(core.calls, 0); assert.equal(service.requests(), 0); assert.equal(actions, 0);
  } finally { await close(service.server); }
});
test('bounded test-driver ceiling does not synthesize finish, switch mode, retry or force a body action', async () => {
  const service = await fakeService(() => ({ name: 'observe', args: {} })); let actions = 0;
  try { const core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), () => {}, {
    beforeModelRequest: count => { if (count >= 3) throw new Error('evaluation-request-limit'); },
  });
    await assert.rejects(() => core.run('repeat diagnostic'), /evaluation-request-limit/);
    assert.equal(service.requests(), 3); assert.equal(actions, 0); assert.equal(core.workspace.mode, 'orient');
  } finally { await close(service.server); }
});
test('a new full attention notice arriving during inference reaches the next Pi turn, without losing the task', async () => {
  let core: AnalysisCore; const events: { kind: string; value: any }[] = [];
  const service = await fakeService(n => {
    if (n === 1) core.wake({ kind: 'unknown-change', subjectId: 'o1', sequence: 11,
      evidence: { changes: [{ property: 'visible', before: true, after: false }], prediction: null } });
    return { name: 'finish', args: { status: 'needs-experience', report: 'retain unknown and original question', ...(n === 2 ? { evidenceRefs: ['g1-e1'] } : {}) } };
  });
  try { core = new AnalysisCore(config(service.url), tools(async () => null), (kind, value) => events.push({ kind, value }));
    await core.run('original pending question');
    assert.equal(service.requests(), 2); assert.equal(core.workspace.currentTaskId, 't0');
    const requests = events.filter(e => e.kind === 'analysis-request');
    assert.ok(JSON.stringify(requests[1]!.value.request).includes('visible'));
    assert.ok(JSON.stringify(requests[1]!.value.request).includes('original pending question'));
  } finally { await close(service.server); }
});
test('initial-mode hook is test-only; ordinary new goals still start orient with the same Agent', async () => {
  const service = await fakeService(() => ({ name: 'finish', args: { status: 'no-plan', report: 'test-only end' } }));
  try {
    for (const mode of ['recall', undefined] as const) {
      const requests: any[] = [];
      const core = new AnalysisCore(config(service.url), tools(async () => null), (kind, value) => { if (kind === 'analysis-request') requests.push(value); },
        mode ? { initialModeForTest: mode } : {});
      await core.run('mode isolation');
      assert.equal(requests[0].mode, mode ?? 'orient'); assert.equal(core.workspace.snapshot().tasks.length, 1);
      assert.ok(JSON.stringify(requests[0].request).includes(mode ? '当前模式：经验与条件' : '当前模式：理解与定向'));
    }
  } finally { await close(service.server); }
});

test('report references: sealed finish can cite t0 as model-note without completing or promoting the task', async t => {
  const sealed = JSON.parse(await readFile('evidence/native-null-wire-bootstrap-v1/STOPPING_FAILURE.json', 'utf8'));
  const args = sealed.stoppedCall.find((call: any) => call.name === 'finish').arguments;
  assert.deepEqual(args.evidenceRefs, ['t0']);
  const service = await fakeService(() => ({ name: 'finish', args }));
  const events: { kind: string; value: any }[] = []; let actions = 0;
  try {
    const core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), (kind, value) => events.push({ kind, value }));
    const report = await core.run('Report material contract; not a physical claim');
    const result = events.find(e => e.kind === 'tool-end' && e.value.name === 'finish')!.value.result;
    assert.equal(report.report, args.report);
    assert.deepEqual(result.referenceSources, [{ ref: 't0', kind: 'model-note' }]);
    assert.equal(core.workspace.snapshot().tasks[0]!.status, 'open');
    assert.equal(core.workspace.snapshot().tasks[0]!.parentId, null);
    assert.equal(core.workspace.snapshot().evidence.length, 0);
    assert.equal(actions, 0); assert.equal(service.requests(), 1);
    t.diagnostic(canonical({ sealedFinishArgumentsReused: true, referenceSources: result.referenceSources,
      taskStatus: core.workspace.snapshot().tasks[0]!.status, physicalEvidenceAdded: 0, actions }));
  } finally { await close(service.server); }
});

test('report references: goal and tool provenance preserve their kinds and captured times while reads and finish are readonly', async t => {
  const calls = [
    { name: 'recall', args: { desiredChange: { direction: 'change' } } },
    { name: 'read_context', args: { reference: 'g1-e2' } },
    { name: 'finish', args: { status: 'needs-experience', report: 'Goal and note are not physical proof', evidenceRefs: ['originalUserGoal', 't0', 'g1-e2'] } },
  ];
  const service = await fakeService(n => calls[n - 1]!); const events: { kind: string; value: any }[] = [];
  let core: AnalysisCore, sequence = 100, recalls = 0, actions = 0, predictions = 0;
  const snapshots = new Map<string, string>();
  try {
    core = new AnalysisCore(config(service.url), { ...tools(async () => { actions++; }),
      context: () => ({ publicObservation: { sequence, activeSeconds: sequence / 20, body: {} } }),
      predict: async () => { predictions++; return null; },
      recall: async () => { recalls++; sequence = 900; return { observationSequence: 7, activeSeconds: .35, candidates: [] }; },
    }, (kind, value) => {
      events.push({ kind, value });
      const tool = value as { name?: string };
      if (['read_context', 'finish'].includes(tool.name ?? '')) {
        if (kind === 'tool-start') snapshots.set(tool.name!, canonical(core.workspace.snapshot()));
        if (kind === 'tool-end') assert.equal(canonical(core.workspace.snapshot()), snapshots.get(tool.name!));
      }
    });
    await core.run('Original goal material');
    const result = events.find(e => e.kind === 'tool-end' && e.value.name === 'finish')!.value.result;
    assert.deepEqual(result.referenceSources, [
      { ref: 'originalUserGoal', kind: 'user-goal' }, { ref: 't0', kind: 'model-note' },
      { ref: 'g1-e2', kind: 'historical-experience', source: 'recall', observationSequence: 7, activeSeconds: .35 },
    ]);
    assert.equal(core.workspace.evidence(core.workspace.snapshot().latestObservationRef!).observationSequence, 900);
    assert.equal(core.workspace.evidence('g1-e2').activeSeconds, .35);
    assert.equal(recalls, 1); assert.equal(predictions, 0); assert.equal(actions, 0); assert.equal(service.requests(), 3);
    assert.equal(snapshots.size, 2);
    t.diagnostic(canonical({ referenceSources: result.referenceSources, latestObservationSequence: 900,
      readonlyTools: [...snapshots.keys()], noAdditionalPhysicalCalls: true, actions }));
  } finally { await close(service.server); }
});

test('report references: missing and cross-goal materials fail without replacement, actions or retry', async t => {
  for (const reference of ['t999', 'g0-e1']) {
    const service = await fakeService(() => ({ name: 'finish', args: { status: 'completed', report: 'unknown reference fixture', evidenceRefs: [reference] } }));
    let actions = 0; const events: { kind: string; value: any }[] = [];
    try {
      const core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), (kind, value) => events.push({ kind, value }));
      await assert.rejects(() => core.run('Unknown reference fixture'), new RegExp(`context-reference-not-in-current-goal:${reference}`));
      assert.equal(service.requests(), 1); assert.equal(actions, 0);
      assert.equal(events.filter(e => e.kind === 'tool-end').length, 0);
      assert.equal(core.workspace.snapshot().evidence.length, 0);
      t.diagnostic(canonical({ reference, rejected: true, actions, requests: service.requests() }));
    } finally { await close(service.server); }
  }
});

test('report references: task-internal evidenceRefs still reject model-note IDs and leave the task unchanged', async t => {
  const service = await fakeService(() => ({ name: 'set_intent', args: { tasks: [{ id: 't0', evidenceRefs: ['t0'] }] } }));
  let actions = 0, before = '';
  try {
    let core: AnalysisCore;
    core = new AnalysisCore(config(service.url), tools(async () => { actions++; }), (kind, value) => {
      if (kind === 'tool-start' && (value as any).name === 'set_intent') before = canonical(core.workspace.snapshot());
    });
    await assert.rejects(() => core.run('Task evidence remains immutable tool material'), /context-reference-not-in-current-goal:t0/);
    assert.equal(canonical(core.workspace.snapshot()), before);
    assert.equal(service.requests(), 1); assert.equal(actions, 0);
    t.diagnostic(canonical({ rejectedTaskReference: 't0', workspaceUnchanged: true, actions }));
  } finally { await close(service.server); }
});

test('report references: native null and keep remain distinct; root limit one never includes unread parentId', async t => {
  const logical = { tasks: [{ id: 't0', parentId: null }] }, wire = encode(TOOL_SCHEMAS.set_intent, logical);
  assert.equal(wire.tasks[0].parentId, null); assert.deepEqual(wire.mode, { op: 'keep' });
  assert.deepEqual(wire.tasks[0].objective, { op: 'keep' }); assert.deepEqual(decode(TOOL_SCHEMAS.set_intent, wire), logical);
  const calls = [
    { name: 'set_intent', args: decode(TOOL_SCHEMAS.set_intent, wire) },
    { name: 'read_context', args: { reference: 't0', limit: 1 } },
    { name: 'read_context', args: { reference: 't0', field: '/parentId' } },
    { name: 'finish', args: { status: 'completed', report: 'Synthetic explicit read coverage', evidenceRefs: ['t0'] } },
  ];
  const service = await fakeService(n => calls[n - 1]!); const events: { kind: string; value: any }[] = [];
  try {
    const core = new AnalysisCore(config(service.url), tools(async () => { throw new Error('paging-test-body-forbidden'); }), (kind, value) => events.push({ kind, value }));
    await core.run('Paging fixture goal');
    const pages = events.filter(e => e.kind === 'tool-end' && e.value.name === 'read_context').map(e => e.value.result);
    assert.deepEqual(pages[0].selectedValue, { id: 't0' }); assert.equal(pages[0].page.nextOffset, 1); assert.equal(pages[0].page.total, 12);
    assert.equal(pages[1].selectedValue, null); assert.equal(pages[1].page.total, 1); assert.equal(pages[1].more, undefined);
    assert.equal(service.requests(), 4); assert.equal(core.workspace.snapshot().evidence.length, 0);
    t.diagnostic(canonical({ pages, requests: service.requests(), realModelCalls: 0, actions: 0 }));
  } finally { await close(service.server); }
});
