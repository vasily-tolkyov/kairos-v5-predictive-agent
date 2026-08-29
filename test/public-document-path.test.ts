import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Value from 'typebox/value';
import { AnalysisCore, TOOL_SCHEMAS, STRICT_TOOL_SCHEMAS, type AnalysisTools } from '../src/analysis.js';
import { CognitiveWorkspace, type CognitiveEvidenceV1 } from '../src/cognitive-workspace.js';
import { encodeStrictToolArguments as encode, decodeStrictToolArguments as decode } from '../src/analysis-strict-wire.js';
import { loadConfiguration } from '../src/services.js';
import { canonical, sha } from '../src/util.js';

const sealedRoot = 'evidence/dig-action-window-bootstrap-continuation-v1/bootstrap-001/';
async function sealedFixture() {
  const document = JSON.parse(await readFile(sealedRoot + 'WORKSPACE_LATEST.json', 'utf8'));
  const rows = (await readFile(sealedRoot + 'events.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const stored: CognitiveEvidenceV1[] = document.workspace.evidence;
  const workspace = new CognitiveWorkspace(args => encode(TOOL_SCHEMAS.read_context, args));
  workspace.startGoal(document.workspace.originalGoal, document.workspace.originalConstraints);
  for (const e of stored) {
    assert.equal(e.sha256, sha({ ...e, sha256: undefined }));
    const added = workspace.addEvidence(e.kind, e.source, e.data, e.query, e.observationSequence, true, e.activeSeconds);
    assert.equal(added.ref, e.ref);
  }
  const calls = rows.filter(r => r.kind === 'analysis-response').at(-1).value.tools;
  return { workspace, stored: stored.find(e => e.ref === 'g1-e2')!, calls };
}

test('public document: both sealed g1-e2 calls select exact original objects and vocabulary at the displayed root', async t => {
  const { workspace: w, stored, calls } = await sealedFixture();
  assert.deepEqual(calls.map((c: any) => c.arguments), [
    { reference: 'g1-e2', field: '/data/objects', offset: 4, limit: 8 },
    { reference: 'g1-e2', field: '/data/queryVocabulary/selfProperties', offset: 4, limit: 4 },
  ]);
  const raw = stored.data as any, before = canonical(w.snapshot());
  const expected = [raw.objects.slice(4, 12), raw.queryVocabulary.selfProperties.slice(4, 8)];
  const results = calls.map((c: any, i: number) => {
    const a = c.arguments, result = w.readPublic(a.reference, a.field, a.offset, a.limit) as any;
    assert.deepEqual(result.selectedValue, expected[i]);
    assert.equal(result.page.field, a.field);
    assert.equal(result.observationSequence, stored.observationSequence);
    assert.equal(result.activeSeconds, stored.activeSeconds);
    assert.equal(result.material, undefined); assert.equal(result.data, undefined);
    return result;
  });
  assert.equal(canonical(w.snapshot()), before);
  t.diagnostic(canonical({ fixture: sealedRoot, originalCalls: calls, selectedPages: results,
    historicalOldContractFailurePreserved: true, modelCalls: 0, bodyCalls: 0 }));
});

test('public document: all three entry points publish the same canonical paths and full continuation content', async () => {
  const { workspace: w, stored } = await sealedFixture(), raw = stored.data as any;
  const summary = w.publicSummary(stored.ref);
  const root = (w.readPublic(stored.ref) as any).selectedValue;
  const material = JSON.parse(w.material().text).evidence.find((e: any) => e.ref === stored.ref);
  assert.deepEqual(summary, root); assert.deepEqual(material, root);
  for (const path of ['objects', 'queryVocabulary/historySubjects', 'queryVocabulary/selfProperties']) {
    const select = (v: any) => path.split('/').reduce((x, key) => x[key], v);
    const view = select(root.data), expected = select(raw), received = [...view.items];
    let hint = view.more;
    while (hint) {
      assert.equal(hint.tool, 'read_context'); assert(Value.Check(STRICT_TOOL_SCHEMAS.read_context, hint.arguments));
      const a = decode(TOOL_SCHEMAS.read_context, hint.arguments);
      assert.equal(a.reference, stored.ref); assert.equal(a.field, '/data/' + path);
      const page = w.readPublic(a.reference, a.field, a.offset, a.limit) as any;
      received.push(...page.selectedValue); hint = page.more;
    }
    assert.deepEqual(received, expected);
  }
});

test('public document: task and original user references retain their own roots and cannot become tool evidence', () => {
  const w = new CognitiveWorkspace(); w.startGoal('read only original goal', ['constraint A', 'constraint B']);
  const current = JSON.parse(w.material().text);
  assert.equal(current.originalConstraintsReference, 'originalUserConstraints');
  assert.equal((w.readPublic('t0', '/parentId') as any).selectedValue, null);
  assert.equal((w.readPublic('t0', '/objectiveReference') as any).selectedValue, 'originalUserGoal');
  assert.equal((w.readPublic('originalUserGoal') as any).selectedValue, 'read only original goal');
  const constraints = w.readPublic(current.originalConstraintsReference) as any;
  assert.deepEqual(constraints.selectedValue, ['constraint A', 'constraint B']);
  assert.equal(constraints.kind, 'user-goal'); assert.equal(constraints.source, undefined);
  assert.equal((w.readPublic('t0') as any).kind, 'model-note');
  assert.equal((w.readPublic('t0') as any).source, undefined);
  constraints.selectedValue[0] = 'mutated return';
  assert.equal(w.snapshot().originalConstraints[0], 'constraint A');
  for (const ref of ['t0', 'originalUserGoal', 'originalUserConstraints'])
    assert.throws(() => w.update({ tasks: [{ id: 't0', evidenceRefs: [ref] }] }), /not-in-current-goal/);
});

test('public document: clocks, exact dedup and action observation links remain addressable without borrowing a later frame', () => {
  const w = new CognitiveWorkspace(); w.startGoal('clock provenance');
  const firstData = { sequence: 7, activeSeconds: .35, observedAt: 'first public timestamp', body: { selectedSlot: 2 } };
  const first = w.observe(firstData).evidence;
  const action = w.addEvidence('actual-action', 'execute_chain', { results: [], publicObservation: firstData }, null, 7, true, .35);
  const later = w.observe({ ...firstData, sequence: 9, activeSeconds: .45, observedAt: 'later public timestamp' }).evidence;
  w.update({ tasks: [{ id: 't0', evidenceRefs: [first.ref, later.ref, action.ref] }] });
  const before = canonical(w.snapshot()), material = JSON.parse(w.material().text);
  assert.equal(material.evidence.find((e: any) => e.ref === later.ref).dataSameAs, first.ref);
  for (const [e, clock] of [[first, firstData], [later, { ...firstData, sequence: 9, activeSeconds: .45, observedAt: 'later public timestamp' }]] as const) {
    assert.equal((w.readPublic(e.ref, '/observationClock/sequence') as any).selectedValue, clock.sequence);
    assert.equal((w.readPublic(e.ref, '/observationClock/activeSeconds') as any).selectedValue, clock.activeSeconds);
    assert.equal((w.readPublic(e.ref, '/observationClock/observedAt') as any).selectedValue, clock.observedAt);
    const returned = w.readPublic(e.ref, '/data') as any;
    assert.equal(returned.observationSequence, clock.sequence); assert.equal(returned.activeSeconds, clock.activeSeconds);
    returned.selectedValue.body.selectedSlot = 88;
  }
  const link = w.readPublic(action.ref, '/data/publicObservationReference') as any;
  assert.equal(link.selectedValue, first.ref); assert.equal(link.observationSequence, 7);
  assert.equal((w.readPublic(link.selectedValue, '/observationClock/sequence') as any).selectedValue, 7);
  const noEarlierObservation = w.addEvidence('actual-action', 'execute_chain', {
    results: [], publicObservation: { ...firstData, sequence: 13, activeSeconds: .65 } }, null, 13, true, .65);
  const ownDocument = canonical(w.publicSummary(noEarlierObservation.ref));
  w.observe({ ...firstData, sequence: 13, activeSeconds: .65 });
  assert.equal(canonical(w.publicSummary(noEarlierObservation.ref)), ownDocument, 'a later acquisition cannot rewrite a previous document');
  assert.equal((w.evidence(first.ref).data as any).body.selectedSlot, 2);
  assert.equal(before, canonical({ ...w.snapshot(), evidence: w.snapshot().evidence.slice(0, 3),
    latestObservationRef: later.ref, latestToolEvidenceRef: later.ref }));
});

test('public document: private internals and wrong roots are absent; escaped real keys and immutable query are exact', () => {
  const w = new CognitiveWorkspace(); w.startGoal('public fields only');
  const query = { desiredChange: { property: 'synthetic', value: false }, offset: 0 };
  const beforeFields = { 'a/b~c': Array.from({ length: 17 }, (_, i) => i), '': 0 };
  const e = w.addEvidence('historical-experience', 'recall', { candidates: [{ eventId: 'synthetic-event', observedBefore: beforeFields,
    r1: { pageId: 'hidden' }, r2: [1, 2, 3], r2a: { private: true } }], query }, query, 22, true, 1.1);
  const before = canonical(w.snapshot());
  assert.deepEqual((w.readPublic(e.ref, '/data/candidates/0/observedBefore/a~1b~0c', 4, 12) as any).selectedValue, beforeFields['a/b~c'].slice(4, 16));
  assert.equal((w.readPublic(e.ref, '/data/candidates/0/observedBefore/') as any).selectedValue, 0);
  assert.deepEqual((w.readPublic(e.ref, '/query') as any).selectedValue, query);
  for (const path of ['/objects', '/data/objects', '/candidates', '/data/candidates/0/r1', '/data/candidates/0/r2',
    '/data/candidates/0/r2a', '/sha256', '/version', '/data/data/candidates']) {
    const missing = w.readPublic(e.ref, path) as any;
    assert.equal(missing.status, 'field-not-found'); assert.equal(missing.field, path); assert.equal(missing.selectedValue, undefined);
  }
  for (const path of ['/constructor', '/data/__proto__'])
    assert.throws(() => w.readPublic(e.ref, path), /context-public-field-missing/);
  assert.throws(() => w.readPublic(e.ref, 'data'), /json-pointer/);
  assert.throws(() => w.readPublic('unknown-reference'), /not-in-current-goal/);
  assert.equal(canonical(w.snapshot()), before);
});

test('public document: production Pi rejects a forbidden key and stops before a later body call', async t => {
  const config = await loadConfiguration(), events: any[] = []; let requests = 0, bodies = 0;
  const observation = { sequence: 1, activeSeconds: .05, objects: [1, 2, 3, 4, 5] };
  const tools: AnalysisTools = { context: () => ({ publicObservation: observation }), observe: async () => observation,
    recall: async () => { throw Error('no-physical-query'); }, predict: async () => { throw Error('no-physical-query'); },
    execute: async () => { bodies++; throw Error('body-must-not-be-called'); } };
  const wrong = { reference: 'g1-e1', field: '/constructor', offset: 0, limit: 4 };
  const core = new AnalysisCore(config.analysis, tools, (kind, value) => events.push({ kind, value }), {
    apiKeyForTest: 'SYNTHETIC_NOT_A_SECRET', fetchForTest: async () => {
      requests++;
      const calls = [
        { index: 0, id: 'wrong-path', type: 'function', function: { name: 'read_context', arguments: JSON.stringify(encode(TOOL_SCHEMAS.read_context, wrong)) } },
        { index: 1, id: 'must-not-execute', type: 'function', function: { name: 'execute_chain', arguments: JSON.stringify(encode(TOOL_SCHEMAS.execute_chain,
          { actions: [{ kind: 'wait', parameters: { ticks: 1 } }] })) } },
      ];
      const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', tool_calls: calls }) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  await assert.rejects(() => core.run('Read-only forbidden-key transport fixture'), /context-public-field-missing/);
  assert.equal(requests, 1); assert.equal(bodies, 0);
  assert.deepEqual(events.filter(e => e.kind === 'tool-start').map(e => e.value.args), [wrong]);
  t.diagnostic('Synthetic transport, production Pi: forbidden path unchanged, one request, later tool/body not executed; no real model/game');
});
