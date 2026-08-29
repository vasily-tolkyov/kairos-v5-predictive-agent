import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { AnalysisCore, TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { encodeStrictToolArguments } from '../src/analysis-strict-wire.js';
import { budgetPayload, interactionGroups, realInputTokens } from '../src/analysis-context.js';
import { DEEPSEEK_TOKENIZER_REVISION, deepSeekInputTokens, verifyDeepSeekTokenizer } from '../src/analysis-provider.js';
import { loadConfiguration, type DeepSeekAnalysisConfiguration } from '../src/services.js';
import { canonical, fileSha, sha } from '../src/util.js';

const previousRoot = 'runtime/deepseek-tokenizer-b5968e9';
const currentRoot = 'runtime/deepseek-tokenizer-0813-3c6b304';
const originalLog = 'evidence/learning-entry-and-first-bootstrap-v1/bootstrap-001/events.jsonl';
async function configuration(): Promise<DeepSeekAnalysisConfiguration> {
  const config = (await loadConfiguration()).analysis;
  assert.equal(config.provider, 'deepseek'); return config as DeepSeekAnalysisConfiguration;
}
async function firstRequest() {
  const input = createReadStream(originalLog, 'utf8'), reader = createInterface({ input, crlfDelay: Infinity });
  let request: any, response: any;
  try {
    for await (const line of reader) {
      const record = JSON.parse(line);
      if (record.kind === 'analysis-request' && !request) request = record.value;
      if (record.kind === 'analysis-response') { response = record.value; break; }
    }
  } finally { reader.close(); input.destroy(); }
  assert(request && response); const payload = structuredClone(request.request);
  assert.equal(payload.messages.length, 2, 'this sealed first request has no private reasoning to reconstruct');
  // The evidence logger sorts JSON keys. Restore only the actual SDK function-key order
  // and production TypeBox schema order; never pretend the sorted log was the wire.
  payload.tools = payload.tools.map((tool: any) => ({ type: 'function', function: {
    name: tool.function.name, description: tool.function.description,
    parameters: TOOL_SCHEMAS[tool.function.name as keyof typeof TOOL_SCHEMAS],
  } }));
  assert.equal(sha(payload), request.payloadSha256);
  assert.equal(sha(payload), '2e6004bf5cdbef690dcd034b22496921dd7df05660b9194094a13a6955ab9405');
  return { request, response, payload };
}

test('0813 assets: official renderer, identical vocabulary, and tokenizerRoot is the only config change', async t => {
  const config = await configuration(); assert.equal(config.tokenizerRoot, currentRoot);
  assert.equal(DEEPSEEK_TOKENIZER_REVISION, '3c6b30435c8590933c489be0c5200691559e0576');
  const identity = await verifyDeepSeekTokenizer(config);
  const baseline = JSON.parse(await readFile('evidence/deepseek-template-alignment-bootstrap-v1/BASELINE.json', 'utf8'));
  const expected = structuredClone(baseline.configuration); expected.analysis.tokenizerRoot = currentRoot;
  assert.deepEqual(JSON.parse(await readFile('kairos.config.json', 'utf8')), expected);
  for (const asset of baseline.oldAssets) assert.equal(await fileSha(asset.path), asset.sha256);
  for (const name of ['tokenizer.json', 'LICENSE'])
    assert.equal(await fileSha(resolve(currentRoot, name)), await fileSha(resolve(previousRoot, name)));
  t.diagnostic(JSON.stringify({ identity, configurationChangedFields: ['analysis.tokenizerRoot'], oldAssetsUnchanged: true }));
});

test('0813 first request: native schema order is restored without changing canonical identity; service count matches', async t => {
  const { request, response, payload } = await firstRequest(), config = await configuration();
  const before = JSON.stringify(payload);
  const oldTokens = await deepSeekInputTokens(payload, { ...config, tokenizerRoot: previousRoot });
  const newTokens = await realInputTokens(payload, config);
  const actualServiceInput = response.usage.input + response.usage.cacheRead + response.usage.cacheWrite;
  assert.equal(oldTokens, 5286); assert.equal(oldTokens, request.inputTokens);
  assert.equal(newTokens, 5365); assert.equal(newTokens, actualServiceInput);
  assert.equal(JSON.stringify(payload), before); assert.equal(payload.reasoning_effort, 'high');
  t.diagnostic(JSON.stringify({ originalLog, payloadSha256: sha(payload), oldTokens, newTokens, actualServiceInput, modelRequests: 0 }));
});

test('0813 actual rendering: high prefix occurs once; full tool schemas and chat participate in production count', async t => {
  const config = await configuration(), { payload } = await firstRequest();
  const tmp = resolve('tmp/deepseek-template-alignment-bootstrap-v1'); await mkdir(tmp, { recursive: true });
  const python = `import copy, importlib.util, json, sys
from pathlib import Path
from tokenizers import Tokenizer
d=json.load(sys.stdin); root=Path(d['root']); p=d['payload']
s=importlib.util.spec_from_file_location('official',root/'encoding'/'encoding_dsv4.py'); r=importlib.util.module_from_spec(s); s.loader.exec_module(r)
messages=copy.deepcopy(p['messages']); messages[0]['tools']=p['tools']
high=r.encode_messages(messages,thinking_mode='thinking',drop_thinking=False,reasoning_effort='high')
low=r.encode_messages(messages,thinking_mode='thinking',drop_thinking=False,reasoning_effort='low')
prefix=r.REASONING_EFFORT_PROMPTS['high']; tokenizer=Tokenizer.from_file(str(root/'tokenizer.json'))
without_tools=copy.deepcopy(messages); without_tools[0]['tools']=[]
plain=r.encode_messages(without_tools,thinking_mode='thinking',drop_thinking=False,reasoning_effort='high')
count=lambda text: len(tokenizer.encode(text,add_special_tokens=False).ids)
print(json.dumps({'fullTokens':count(high),'lowTokens':count(low),'prefixOccurrences':high.count(prefix),'removePrefixEqualsLow':high.replace(prefix,'',1)==low,'prefixTokens':count(prefix),'withoutToolsTokens':count(plain),'systemPresent':messages[0]['content'] in high,'userPresent':messages[1]['content'] in high,'allToolNamesPresent':all(tool['function']['name'] in high for tool in p['tools'])}))`;
  const rendered = await new Promise<any>((accept, reject) => {
    const child = spawn(config.python, ['-B', '-X', 'utf8', '-c', python], { windowsHide: true,
      env: { ...process.env, TEMP: tmp, TMP: tmp, PYTHONDONTWRITEBYTECODE: '1', TOKENIZERS_PARALLELISM: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.once('error', reject); child.once('close', code => {
      if (code !== 0) reject(new Error(`offline-renderer:${code}:${stderr}`));
      else { try { accept(JSON.parse(stdout)); } catch (error) { reject(error); } }
    });
    child.stdin.end(JSON.stringify({ root: resolve(config.tokenizerRoot), payload }));
  });
  assert.equal(rendered.prefixOccurrences, 1); assert.equal(rendered.removePrefixEqualsLow, true);
  assert.equal(rendered.fullTokens, await realInputTokens(payload, config));
  assert(rendered.withoutToolsTokens < rendered.fullTokens);
  assert(rendered.systemPresent && rendered.userPresent && rendered.allToolNamesPresent);
  assert.equal(rendered.fullTokens - rendered.lowTokens, rendered.prefixTokens);
  t.diagnostic(JSON.stringify({ ...rendered, actualRequestEffortUnchanged: payload.reasoning_effort }));
});

function syntheticPair(id: string, text: string): any[] {
  return [{ role: 'assistant', content: null, reasoning_content: '', tool_calls: [{ id, type: 'function',
    function: { name: 'read_context', arguments: JSON.stringify({ reference: id }) } }] },
  { role: 'tool', tool_call_id: id, content: text }];
}
test('0813 boundary: real production budget removes one whole old group before a request, preserving current material and latest pair', async t => {
  const config = await configuration(), { payload: original } = await firstRequest();
  const required = canonical({ originalUserGoal: 'SYNTHETIC current goal; not a live task', currentTaskId: 't0',
    necessaryEvidence: { id: 'g0-e2', fact: 'SYNTHETIC explicitly required public fact' } });
  const fixed = [{ role: 'system', content: 'SYNTHETIC offline budget fixture; no model request.' }, { role: 'user', content: required }];
  const latest = syntheticPair('g0-e2', 'SYNTHETIC latest public result must remain paired');
  const payload = { ...original, messages: [...fixed, ...syntheticPair('g0-e1', ''), ...latest] };
  const old = { ...config, tokenizerRoot: previousRoot };
  const oldBase = await realInputTokens(payload, old), newBase = await realInputTokens(payload, config);
  // Size synthetic filler from measured official token counts, not a correction to production counting.
  const repetitions = config.maximumInputTokens! - oldBase - Math.ceil((newBase - oldBase) / 2);
  payload.messages[3]!.content = ' x'.repeat(repetitions);
  const unchanged = JSON.stringify(payload), oldCount = await realInputTokens(payload, old), newCount = await realInputTokens(payload, config);
  assert(oldCount <= config.maximumInputTokens! && newCount > config.maximumInputTokens!);
  const passes: { tokens: number; sha256: string }[] = [];
  const fitted = await budgetPayload(payload, required, async p => {
    const tokens = await realInputTokens(p, config); passes.push({ tokens, sha256: sha(p) }); return tokens;
  }, config);
  assert.equal(fitted.audit.removedInteractionGroups, 1); assert.equal(fitted.audit.compactTaskIndex, false);
  assert(fitted.audit.inputTokens <= 24000); assert.equal(fitted.audit.tokenizationPasses, 2);
  assert.deepEqual((fitted.payload.messages as any[]).slice(0, 2), fixed);
  assert.deepEqual((fitted.payload.messages as any[]).slice(2), latest);
  assert.equal(interactionGroups((fitted.payload.messages as any[]).slice(2)).length, 1);
  assert.equal(fitted.payload.reasoning_effort, 'high'); assert.deepEqual(fitted.payload.tools, payload.tools);
  assert.equal(JSON.stringify(payload), unchanged);
  t.diagnostic(JSON.stringify({ synthetic: true, oldCount, newCount, passes, audit: fitted.audit,
    preservedOriginalGoalAndEvidence: true, latestPairPreserved: true, modelRequests: 0 }));
});

test('0813 mandatory over-budget material still fails instead of truncating required evidence or increasing limits', async t => {
  const config = await configuration(), required = 'SYNTHETIC mandatory evidence:' + ' x'.repeat(25000);
  const payload = { model: config.model, reasoning_effort: 'high', thinking: { type: 'enabled' }, max_tokens: config.maximumOutputTokens,
    tools: [], messages: [{ role: 'system', content: 'SYNTHETIC mandatory fixture' }, { role: 'user', content: required }] };
  const before = JSON.stringify(payload), passes: number[] = [];
  await assert.rejects(() => budgetPayload(payload, required, async p => {
    const count = await realInputTokens(p, config); passes.push(count); return count;
  }, config), /context-budget-exceeded:mandatory-input=/);
  assert(passes.every(count => count > 24000)); assert.equal(JSON.stringify(payload), before);
  t.diagnostic(JSON.stringify({ synthetic: true, passes, inputLimit: config.maximumInputTokens, rejectedBeforeModel: true }));
});

test('0813 native Pi usage: cached input is counted once and equals actual renderer count without a remote request', async t => {
  const config = await configuration(), records: any[] = []; let requests = 0, input = 0, actions = 0;
  const tools: AnalysisTools = { context: () => ({ publicObservation: { sequence: 1, body: { selectedSlot: 0 } } }),
    observe: async () => ({}), recall: async () => ({}), predict: async () => ({}), execute: async () => { actions++; return {}; } };
  const fetchForTest: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).origin, 'https://api.deepseek.com'); requests++;
    const payload = JSON.parse(String(init?.body)); input = await realInputTokens(payload, config);
    const chunk = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => 'data: ' + JSON.stringify({
      id: 'synthetic-counter-only', model: 'synthetic-response-not-a-real-backend-result', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    }) + '\n\n';
    return new Response(chunk({ role: 'assistant', reasoning_content: '' }) + chunk({ tool_calls: [{ index: 0, id: 'synthetic-finish', type: 'function',
      function: { name: 'finish', arguments: JSON.stringify(encodeStrictToolArguments(TOOL_SCHEMAS.finish,
        { status: 'no-plan', report: 'SYNTHETIC protocol only, no capability claim.' })) } }] })
      + chunk({}, 'tool_calls', { prompt_tokens: input, completion_tokens: 8, total_tokens: input + 8,
        prompt_cache_hit_tokens: 17, prompt_tokens_details: { cache_write_tokens: 3 } }) + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
  };
  const core = new AnalysisCore(config, tools, (kind, value) => records.push({ kind, value }),
    { apiKeyForTest: 'SYNTHETIC_NOT_A_CREDENTIAL', fetchForTest });
  await core.run('SYNTHETIC token-usage transport test; not a model qualification.');
  const request = records.find(r => r.kind === 'analysis-request'), response = records.find(r => r.kind === 'analysis-response');
  assert.equal(requests, 1); assert.equal(actions, 0); assert.equal(request.value.inputTokens, input);
  const usage = response.value.usage;
  assert.equal(usage.cacheRead, 17); assert.equal(usage.cacheWrite, 3); assert.equal(usage.input, input - 20);
  assert.equal(usage.input + usage.cacheRead + usage.cacheWrite, input);
  t.diagnostic(JSON.stringify({ syntheticHttp: true, remoteRequests: 0, interceptedRequests: requests,
    localInput: input, usage, actions, inputLimit: request.value.limit }));
});
