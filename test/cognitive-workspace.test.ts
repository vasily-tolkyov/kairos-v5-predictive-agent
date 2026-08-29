import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveWorkspace } from '../src/cognitive-workspace.js';
import { PublicObjectAliases, validateAction } from '../src/analysis-actions.js';
import { budgetPayload, cleanTranscript, interactionGroups, type WireMessage } from '../src/analysis-context.js';
import type { Observation } from '../src/contracts.js';
import { canonical, sha } from '../src/util.js';

test('incremental model tasks and evidence survive modes, many turns and do not auto-complete', () => {
  const w = new CognitiveWorkspace(); w.startGoal('Original immutable goal', ['no guessed facts']);
  const original = w.observe({ sequence: 1, state: 'closed' }).evidence;
  const historical = w.addEvidence('historical-experience', 'recall', { past: 'opened', applicable: false }, { property: 'state' }, 1);
  w.update({ tasks: [{ id: 't1', parentId: 't0', objective: 'model-chosen question', question: 'which condition is unknown?',
    evidenceRefs: [historical.ref], status: 'active' }], mode: 'recall', currentTaskId: 't1' });
  for (let sequence = 2; sequence <= 8; sequence++) w.observe({ sequence, state: 'closed' });
  w.update({ mode: 'plan', tasks: [{ id: 't1', conclusion: 'not yet verified' }] });
  assert.deepEqual((w.read(historical.ref) as any).data, { past: 'opened', applicable: false });
  assert.equal((w.read('t1') as any).status, 'active'); assert.equal((w.read('t0') as any).status, 'open');
  assert.ok(w.material().text.includes(historical.ref)); assert.ok(w.material().text.includes('applicable'));
  w.addEvidence('actual-action', 'execute_chain', { executed: true, state: 'closed' });
  assert.equal((w.read('t1') as any).status, 'active');
  const copied = w.read(original.ref) as any; copied.data.state = 'forged'; assert.equal((w.read(original.ref) as any).data.state, 'closed');
  assert.equal(w.snapshot().originalGoal, 'Original immutable goal');
  w.startGoal('new user goal'); assert.equal(w.mode, 'orient'); assert.equal(w.snapshot().tasks.length, 1);
  assert.throws(() => w.read(original.ref), /not-in-current-goal/);
});
test('Pi-normalized text-array goal and root task objective are deduplicated without removing the user goal', () => {
  const w = new CognitiveWorkspace(); w.startGoal('UNIQUE ORIGINAL USER GOAL');
  assert.equal((w.originalMaterial() + w.material().text).split('UNIQUE ORIGINAL USER GOAL').length - 1, 1);
  assert.equal(cleanTranscript([{ role: 'user', content: [{ type: 'text', text: 'UNIQUE ORIGINAL USER GOAL' }], timestamp: 0 }],
    'UNIQUE ORIGINAL USER GOAL', []).length, 0);
  assert.equal((w.read('t0') as any).objective, 'UNIQUE ORIGINAL USER GOAL');
});
test('identical observation content is sent once even when all acquisition references are critical', () => {
  const w = new CognitiveWorkspace(); w.startGoal('keep every acquisition');
  const refs: string[] = [];
  for (let sequence = 1; sequence <= 6; sequence++) refs.push(w.observe({ sequence, activeSeconds: sequence * .05, uniqueData: 'ONLY_ONE_BODY_VALUE' }).evidence.ref);
  w.update({ tasks: [{ id: 't0', evidenceRefs: refs }] });
  const before = canonical(w.snapshot()), material = w.material().text, parsed = JSON.parse(material);
  assert.equal(material.split('ONLY_ONE_BODY_VALUE').length - 1, 1);
  assert.equal(parsed.evidence.length, 6); assert.equal(parsed.evidence.filter((e: any) => e.dataSameAs === refs[0]).length, 5);
  assert.deepEqual(parsed.evidence.map((e: any) => e.observationClock.sequence), [1, 2, 3, 4, 5, 6]);
  for (let i = 0; i < 6; i++) assert.equal((w.evidence(refs[i]!).data as any).sequence, i + 1);
  assert.equal(canonical(w.snapshot()), before);
});
test('observation has independent provenance and time; predictions and model notes never overwrite reality', () => {
  const w = new CognitiveWorkspace(); w.startGoal('test');
  w.observe({ sequence: 10, state: 'closed' });
  const p = w.addEvidence('prediction', 'predict', { possibleState: 'open', support: .8 }, { action: 'test' }, 10);
  w.observe({ sequence: 20, state: 'closed' });
  w.update({ tasks: [{ id: 't0', conclusion: 'I think it is open', evidenceRefs: [p.ref] }] });
  assert.equal(w.evidence(p.ref).observationSequence, 10);
  assert.equal((w.evidence(w.snapshot().latestObservationRef!).data as any).state, 'closed');
  assert.equal(w.observe({ sequence: 30, state: 'closed' }).changeSummary, '与上次相比无新公开变化');
  const before = sha(w.snapshot()); w.read(p.ref); w.material(); w.snapshot(); assert.equal(sha(w.snapshot()), before);
  assert.throws(() => w.update({ tasks: [{ id: 't0', evidenceRefs: ['file:///secret'] }] }), /not-in-current-goal/);
  assert.throws(() => w.update({ tasks: [{ id: 't0', parentId: 't0' }] }), /cycle/);
});
test('attention preserves full changes, linked prediction, time and interrupted task until model acknowledges', () => {
  const w = new CognitiveWorkspace(); w.startGoal('original'); w.update({ tasks: [{ id: 't2', parentId: 't0', objective: 'original question' }], currentTaskId: 't2' });
  const n = { subjectId: 'o1', sequence: 42, changes: [{ value: 7 }], prediction: { support: .7, createdAt: 40 } };
  const e = w.addEvidence('attention', 'real producer', n, null, 42, false);
  assert.deepEqual(w.evidence(e.ref).data, n); assert.equal(w.currentTaskId, 't2');
  assert.ok(w.material().text.includes('createdAt')); assert.equal((w.read('t2') as any).status, 'open');
  w.update({ acknowledgeAttention: [e.ref], mode: 'review' }); assert.equal(w.snapshot().pendingAttention.length, 0);
});

const group = (i: number): WireMessage[] => [{ role: 'assistant', content: null, tool_calls: [{ id: `c${i}` }] },
  { role: 'tool', tool_call_id: `c${i}`, content: `actual result ${i}` }];
const oldBudgetFixture = { context: 8192, maximumOutputTokens: 768 };
test('budget pruning retains mandatory materials and the latest COMPLETE tool group, even before a steer', async () => {
  const header = 'original user goal, current question, critical old evidence, latest public frame and pending attention';
  const p = { max_tokens: oldBudgetFixture.maximumOutputTokens, messages: [{ role: 'system', content: 'modes' }, { role: 'user', content: header }, ...group(1), ...group(2), ...group(3),
    { role: 'user', content: 'steer also in mandatory header' }] };
  // This is a deterministic unit tokenizer stub. Production tests use llama /apply-template + /tokenize.
  const counted: unknown[] = [];
  const fitted = await budgetPayload(p, header, async x => { counted.push(x); return 5000 + (x.messages as unknown[]).length * 300; }, oldBudgetFixture);
  assert.ok(fitted.audit.removedInteractionGroups >= 2);
  const messages = fitted.payload.messages as WireMessage[];
  assert.equal(messages[1]!.content, header); assert.ok(messages.some(m => m.tool_call_id === 'c3'));
  assert.doesNotThrow(() => interactionGroups(messages.slice(2)));
  assert.ok(counted.length > 1); assert.ok(fitted.audit.inputTokens <= 6500);
  await assert.rejects(() => budgetPayload(p, header, async () => 6501, oldBudgetFixture), /context-budget-exceeded/);
  assert.throws(() => interactionGroups([{ role: 'tool', tool_call_id: 'orphan' }]), /orphan/);
});

const frame = (yaw = 0): Observation => ({ sequence: 1, activeSeconds: .05, targetId: 'block:1', contextId: 'public-fixture',
  self: { position: [1, 2, 3], yaw, pitch: .25, properties: {} }, objects: [{ id: 'block:1', type: 'test', relativePosition: [2, 3, -4], properties: {} }] });
test('short aliases bind exact public identity and ego direction never changes raw world coordinates', () => {
  const a = new PublicObjectAliases(), f = frame(), before = canonical(f);
  const shown = a.present(f) as any;
  assert.deepEqual(shown.objects[0].positionFRU, [4, 2, 3]); assert.equal(shown.objects[0].id, 'o1');
  const turned = a.present(frame(Math.PI / 2)) as any;
  assert.deepEqual(turned.objects[0].positionFRU, [-2, 4, 3]); assert.equal(turned.objects[0].id, 'o1');
  assert.equal(a.resolveAction({ kind: 'interact', parameters: {}, targetId: 'o1' }, f).targetId, 'block:1');
  for (const alias of ['1', 'O1', 'block:1', 'o2']) assert.throws(() => a.resolveAction({ kind: 'interact', parameters: {}, targetId: alias }, f), /alias/);
  assert.throws(() => a.resolveAction({ kind: 'interact', parameters: {}, targetId: 'o1' }, { ...f, objects: [] }), /alias/);
  assert.equal(canonical(f), before); a.reset(); assert.throws(() => a.resolveAction({ kind: 'interact', parameters: {}, targetId: 'o1' }, f), /alias/);
});
test('action contracts require every parameter with correct units; empty look cannot silently become zero', () => {
  for (const action of [{ kind: 'look', parameters: {} }, { kind: 'look', parameters: { yawDegrees: NaN, pitchDegrees: 0 } },
    { kind: 'jump', parameters: {} }, { kind: 'move', parameters: { direction: 'north', ticks: 4 } }, { kind: 'wait', parameters: { ticks: 0 } }])
    assert.throws(() => validateAction(action as any));
  for (const action of [{ kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }, { kind: 'jump', parameters: { forward: false, ticks: 4 } },
    { kind: 'move', parameters: { direction: 'forward', ticks: 4 } }]) assert.doesNotThrow(() => validateAction(action as any));
});

test('public summary paging preserves every public condition while internal traces remain audit-only', () => {
  const w = new CognitiveWorkspace(); w.startGoal('public conditions');
  const conditions = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`field${i}`, i]));
  const e = w.addEvidence('historical-experience', 'recall', { candidates: [{ eventId: 'test', action: { kind: 'wait', parameters: { ticks: 1 } },
    actualObserved: [{ subject: 'self', property: 'food', before: 1, after: 2 }], observedBefore: conditions,
    currentApplicability: { coreEvidenceSupport: 0, querySpecificR2aApplicability: 0 }, unknown: ['not-currently-supported'],
    r1: { pageId: 'internal-only' }, r2: [1, 2, 3], r2a: [{ secretInternalReference: 'not-public' }] }] });
  const before = canonical(w.snapshot());
  const summary = w.publicSummary(e.ref);
  assert.equal(summary.data.candidates[0].observedBefore.moreFields.total, 31);
  const restored: Record<string, unknown> = {};
  for (const offset of [0, 12, 24]) Object.assign(restored, (w.readPublic(e.ref, '/data/candidates/0/observedBefore', offset, 12) as any).selectedValue);
  assert.deepEqual(restored, conditions);
  const missing = w.readPublic(e.ref, '/data/candidates/0/r1') as any;
  assert.equal(missing.status, 'field-not-found'); assert.equal(missing.selectedValue, undefined);
  assert.throws(() => w.readPublic(e.ref, '/constructor'), /public-field-missing/);
  assert.ok((w.read(e.ref) as any).data.candidates[0].r1);
  assert.equal(canonical(w.snapshot()), before);
});
test('explicitly requested read_context details are never replaced with a default summary pointer', () => {
  const message = { role: 'toolResult' as const, toolName: 'read_context', toolCallId: 't1', isError: false, timestamp: 0,
    content: [{ type: 'text' as const, text: canonical({ ref: 'g1-e1', kind: 'historical-experience', source: 'recall',
      selectedValue: { field30: 30 }, page: { field: '/data/conditions', offset: 24 } }) }] };
  assert.deepEqual(cleanTranscript([message], 'goal', ['g1-e1']), [message]);
});
test('permitted short-input comparison removes old interactions, not necessary facts or the latest paired result', async () => {
  const p = { max_tokens: oldBudgetFixture.maximumOutputTokens, messages: [{ role: 'system', content: 'same six modes and constraints' }, { role: 'user', content: 'old task index' },
    ...group(1), ...group(2), ...group(3)] };
  const result = await budgetPayload(p, 'same current facts and evidence; minimal other-task index', async () => 4200, oldBudgetFixture, true);
  const messages = result.payload.messages as WireMessage[];
  assert.equal(messages[1]!.content, 'same current facts and evidence; minimal other-task index');
  assert.equal(result.audit.removedInteractionGroups, 2);
  assert.deepEqual(messages.slice(2), group(3)); assert.doesNotThrow(() => interactionGroups(messages.slice(2)));
});
test('the displayed task objective reference has the same field contract in read_context', () => {
  const w = new CognitiveWorkspace(); w.startGoal('original goal remains readable');
  assert.equal(JSON.parse(w.material().text).currentTask.objectiveReference, 'originalUserGoal');
  const field = w.readPublic('t0', '/objectiveReference', 0, 1) as any;
  assert.equal(field.selectedValue, 'originalUserGoal');
  assert.equal((w.readPublic('originalUserGoal') as any).selectedValue, 'original goal remains readable');
  assert.equal((w.readPublic('t0', '/status') as any).selectedValue, 'open');
});
