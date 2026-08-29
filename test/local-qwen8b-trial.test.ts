import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CASES, runCase } from '../src/analysis-harness.js';
import { analysisSampling, analysisServerArguments, loadConfiguration, type LocalAnalysisConfiguration } from '../src/services.js';
import { fileSha } from '../src/util.js';

const trialRoot = resolve('evidence/local-qwen3-8b-task-trial-v1');
async function trial(): Promise<LocalAnalysisConfiguration> {
  return JSON.parse(await readFile(resolve(trialRoot, 'TRIAL_CONFIGURATION.json'), 'utf8')).analysis;
}
async function syntheticService(finish = true) {
  const sent: { path: string; body: any }[] = []; let generations = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw); sent.push({ path: req.url!, body });
    if (req.url === '/apply-template') { res.end(JSON.stringify({ prompt: 'synthetic-template-no-real-model' })); return; }
    if (req.url === '/tokenize') { res.end(JSON.stringify({ tokens: Array(1200).fill(1) })); return; }
    generations++;
    const call = finish && generations > 1 ? { name: 'finish', arguments: JSON.stringify({ status: 'no-plan', report: 'synthetic transport only' }) }
      : { name: 'observe', arguments: '{}' };
    res.setHeader('content-type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ id: 'local-trial-synthetic', choices: [{ index: 0, delta: { role: 'assistant',
      tool_calls: [{ index: 0, id: `c${generations}`, type: 'function', function: call }] }, finish_reason: null }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1200, completion_tokens: 20, total_tokens: 1220 } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert(address && typeof address !== 'string');
  return { sent, generations: () => generations, baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>(done => server.close(() => done())) };
}

test('local8b: generic local alias and auto fit preserve the explicit trial profile', async () => {
  const a = await trial(), args = analysisServerArguments(a);
  for (const [flag, value] of Object.entries({ '--alias': 'kairos-v5-local-analysis', '--gpu-layers': 'auto', '--fit': 'on',
    '--ctx-size': '16384', '--n-predict': '8192', '--parallel': '1', '--host': '127.0.0.1', '--port': '18080',
    '--reasoning': 'on', '--reasoning-format': 'deepseek', '--temp': '0.6', '--top-p': '0.95', '--top-k': '20',
    '--min-p': '0', '--presence-penalty': '1.5', '--seed': '1262836050' })) {
    assert.equal(args.filter(x => x === flag).length, 1, flag); assert.equal(args[args.indexOf(flag) + 1], value, flag);
  }
  assert.equal(a.maximumInputTokens, 7680); assert.equal(a.timeoutMs, 120000);
  assert.equal(a.context - a.maximumInputTokens! - a.maximumOutputTokens, 512);
});

test('local8b: production Pi uses the same local alias and original logical tools without a remote request', async () => {
  const service = await syntheticService(); const events: any[] = []; let actions = 0;
  const tools: AnalysisTools = { context: () => ({ publicObservation: { sequence: 1, body: { selectedSlot: 4 } } }),
    observe: async () => ({ sequence: 1, body: { selectedSlot: 4 } }), recall: async () => ({ candidates: [] }),
    predict: async () => ({ support: 0 }), execute: async () => { actions++; return null; } };
  try {
    const config = { ...await trial(), baseUrl: service.baseUrl };
    const core = new AnalysisCore(config, tools, (kind, value) => events.push({ kind, value }));
    await core.run('Synthetic alias and transport wiring only');
    assert.equal(core.agent.state.model.id, 'kairos-v5-local-analysis');
    assert.equal(core.agent.state.model.contextWindow, 16384); assert.equal(core.agent.state.model.maxTokens, 8192);
    assert.equal(service.generations(), 2); assert.equal(actions, 0);
    for (const { body } of service.sent.filter(x => x.path === '/v1/chat/completions')) {
      assert.equal(body.model, 'kairos-v5-local-analysis'); assert.equal(body.max_tokens, 8192);
      assert.equal(body.chat_template_kwargs.enable_thinking, true); assert.equal(body.reasoning_effort, undefined);
      for (const [key, value] of Object.entries(analysisSampling(config))) assert.equal(body[key], value);
      assert.deepEqual(body.tools.map((t: any) => t.function.name), Object.keys(TOOL_SCHEMAS));
      assert.ok(body.tools.every((t: any) => t.function.strict !== true));
      const action = body.tools.find((t: any) => t.function.name === 'execute_chain').function.parameters.properties.actions.items;
      assert.deepEqual(action, JSON.parse(JSON.stringify(TOOL_SCHEMAS.execute_chain)).properties.actions.items);
    }
    assert.ok(events.filter(e => e.kind === 'analysis-request').every(e => e.value.wireFormatVersion === 'original-logical-tools'
      && e.value.limit === 7680 && e.value.outputTokens === 8192));
  } finally { await service.close(); }
});

test('local8b: existing runCase honors an explicit outputRoot and twelve-request fixture ceiling', async () => {
  const service = await syntheticService(false);
  const configBefore = await fileSha('kairos.config.json');
  const base = await loadConfiguration(); const config = { ...base, analysis: { ...await trial(), baseUrl: service.baseUrl } };
  const source = JSON.parse(await readFile('evidence/analysis-contract-context-root-repair-v2/questions-002/PROTOCOL.json', 'utf8'));
  const outputRoot = await mkdtemp(resolve('tmp/local8b-case-'));
  try {
    const result = await runCase(CASES[0]!, source.fixturePublicBase, config, false, undefined, { outputRoot, maximumRequests: 12 });
    assert.equal(result.calls, 12); assert.match(result.error!.message, /evaluation-request-limit:12/);
    assert.equal(service.generations(), 12); assert.equal(result.physicalActions, 0); assert.equal(result.physicalWrites, 0);
    assert.equal(result.fixtureActions.length, 0); assert.equal(result.inputLimit, 7680);
    assert.equal(JSON.parse(await readFile(resolve(outputRoot, CASES[0]!.id, 'RESULT.json'), 'utf8')).calls, 12);
    assert.equal(await fileSha('kairos.config.json'), configBefore);
  } finally { await service.close(); }
});
