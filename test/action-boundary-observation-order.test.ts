import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import type { Action, BodyResult, Observation, RealEvent } from '../src/contracts.js';
import type { MinecraftBody } from '../src/body.js';
import type { Compute } from '../src/compute.js';
import type { Configuration } from '../src/services.js';
import { PhysicalMemory } from '../src/memory.js';
import { V5Runtime } from '../src/runtime.js';
import { cueFor, eventRows } from '../src/events.js';
import { fileSha, sha } from '../src/util.js';

const config = { actionBudget: 512, analysis: { baseUrl: 'http://127.0.0.1:18080/v1', context: 8192,
  maximumOutputTokens: 768, timeoutMs: 2000, nativeThinking: false, temperature: 0, topP: 1,
  topK: 0, minP: 0, presencePenalty: 0, seed: 1 } } as Configuration;
const frame = (sequence: number, external = false, self = false): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'explicit-synthetic-window-order-test', targetId: null,
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { onGround: !self, selectedSlot: self ? 2 : 0 } },
  objects: [{ id: 'external', type: 'opaque-object', relativePosition: [1, 0, 0], properties: { lit: external, open: external } }] });
const active = (id: string, frames: readonly Observation[], action: Action): RealEvent => ({
  version: 'RealEventV5', id, frames, cue: cueFor(action, frames[0]!),
  trackedIds: ['self', ...new Set(frames.flatMap(f => f.objects.map(o => o.id)))],
  bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence },
  complete: true, provenance: 'executed-real-body' });

function setup() {
  const memory = new PhysicalMemory(), records: { kind: string; value: any }[] = [];
  const calls: { method: string; args: any[]; memoryTimeBefore: number }[] = [], supplied = new Map<number, Observation>();
  let current = frame(1), afterObserve: ((event: RealEvent) => Promise<void>) | undefined;
  let execute: (action: Action) => Promise<{ result: BodyResult; event: RealEvent | null }> = async () => { throw new Error('unexpected-body-call'); };
  const body = Object.assign(new EventEmitter(), { check() {}, latest: () => current, execute: (a: Action) => execute(a), async close() {} });
  const compute = { async call(method: string, ...args: any[]) {
    calls.push({ method, args, memoryTimeBefore: memory.snapshot().activeSeconds });
    if (method === 'observe') { const r = memory.observe(args[0]); await afterObserve?.(args[0]); return r; }
    if (method === 'advance') return memory.advanceTo(args[0]);
    if (method === 'recall') return memory.recall(args[0], args[1], args[2]);
    if (method === 'predict') return memory.predict(args[0], args[1], args[2]);
    if (method === 'snapshot') return memory.snapshot();
    throw new Error(`unexpected-compute-call:${method}`);
  }, async close() {} };
  const runtime = new V5Runtime(body as unknown as MinecraftBody, config, 'D:/Kairos_V5_Predictive_Agent/tmp/not-written-by-window-test',
    (kind, value) => records.push({ kind, value }), { compute: compute as unknown as Compute,
      analysisHooks: { beforeModelRequest() { throw new Error('offline-window-test-model-forbidden'); } } });
  runtime.save = async () => { calls.push({ method: 'save', args: [memory.snapshot()], memoryTimeBefore: memory.snapshot().activeSeconds }); };
  return { runtime, memory, records, calls, supplied,
    push(f: Observation) { current = f; supplied.set(f.sequence, structuredClone(f)); body.emit('frame', f); },
    current: () => current, executeWith(f: typeof execute) { execute = f; },
    afterObserve(f: NonNullable<typeof afterObserve>) { afterObserve = f; } };
}
type Fixture = ReturnType<typeof setup>;
const learned = (s: Fixture): RealEvent[] => s.calls.filter(c => c.method === 'observe').map(c => c.args[0]);
function audit(s: Fixture) {
  const events = learned(s), owned = new Set<number>();
  for (const e of events) {
    for (const f of e.frames) assert.deepEqual(f, s.supplied.get(f.sequence), 'only original public frames and original times');
    for (const f of e.frames.slice(1)) { assert(!owned.has(f.sequence), 'a change interval has one owner'); owned.add(f.sequence); }
  }
  return { learned: events.map(e => ({ id: e.id, provenance: e.provenance,
    start: e.frames[0]!.sequence, end: e.frames.at(-1)!.sequence, actualEnd: e.frames.at(-1)!.activeSeconds,
    changes: eventRows(e).changes.flat() })),
    memoryTime: s.memory.snapshot().activeSeconds, buffered: s.memory.bufferedEvents, writes: s.memory.writes,
    actions: s.runtime.actions, modelCalls: s.runtime.analysis.calls, snapshotSha256: sha(s.memory.snapshot()) };
}

test('sealed 760-frame replay uses production monitor, preserving 735-753 and 753-760 receipts without a late 734-735 write', async t => {
  const root = 'evidence/evidence-boundary-observation-order-short-loop-v1/short-loop-001/';
  const raw = (await readFile(root + 'frames.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line).value as Observation);
  const log = (await readFile(root + 'events.jsonl', 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(await fileSha(root + 'frames.jsonl'), '617335d88ae52ca639e91651d8edcfa1b4d90e91a98d8532dee11864c2a87348');
  assert.equal(raw.length, 760);
  const first = log.find(r => r.kind === 'real-event').value as RealEvent;
  const receipts = log.filter(r => r.kind === 'body-result').map(r => r.value as BodyResult);
  assert.deepEqual(receipts.map(r => [r.startSequence, r.endSequence]), [[735, 753], [753, 760]]);
  const second = { ...active('recorded-second-receipt', raw.filter(f => f.sequence >= 753), receipts[1]!.action), bodyResult: receipts[1]! };
  const s = setup(); let cursor = 34;
  const feedThrough = (end: number) => { while (cursor <= end) s.push(raw[cursor++ - 1]!); };
  try {
    feedThrough(735);
    for (const e of [first, second]) {
      s.executeWith(async () => { feedThrough(e.frames.at(-1)!.sequence); return { result: e.bodyResult!, event: e }; });
      // Offline receipt replay is not a model or a real-action qualification.
      await s.runtime.execute([e.bodyResult!.action]);
    }
    await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => [e.frames[0]!.sequence, e.frames.at(-1)!.sequence]), [[735, 753], [753, 760]]);
    assert.equal(s.memory.bufferedEvents, 2); assert.equal(s.runtime.actions, 2); assert.equal(s.memory.writes, 0);
    assert(s.records.some(r => r.kind === 'attention' && r.value.sequence === 753), 'the real action-end prefix was sealed');
    t.diagnostic(JSON.stringify({ sourceFrames: 760, actualMinecraftCalls: 0, ...audit(s) }));
  } finally { await s.runtime.close(); }
});

test('a still-open monitor window with genuine pre-action changes is learned before the active event', async t => {
  const s = setup(); s.push(frame(1));
  const frames = [frame(2, true), frame(3, true), frame(4, true, true), frame(5, true, true)];
  s.executeWith(async action => { frames.forEach(f => s.push(f));
    const e = active('prelude-active', frames.slice(1), action); return { result: e.bodyResult!, event: e }; });
  try {
    await s.runtime.execute([{ kind: 'jump', parameters: { forward: false, ticks: 1 } }]);
    await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => [e.provenance, e.frames[0]!.sequence, e.frames.at(-1)!.sequence]),
      [['observed-passive', 1, 3], ['executed-real-body', 3, 5]]);
    assert(eventRows(learned(s)[0]!).changes.flat().some(c => c.subject === 'opaque-object#0' && c.before !== c.after));
    t.diagnostic(JSON.stringify(audit(s)));
  } finally { await s.runtime.close(); }
});

for (const query of ['recall', 'predict'] as const) test(`${query} seals the actual cutoff before time advance; a new real tail during await stays later`, async t => {
  const s = setup(); [frame(1), frame(2, true), frame(3, true)].forEach(f => s.push(f));
  s.afterObserve(async e => { if (e.frames.at(-1)!.sequence === 3)
    for (let n = 4; n <= 23; n++) s.push(frame(n, true, true)); });
  try {
    if (query === 'recall') await s.runtime.recall({ direction: 'change' }, 0);
    else await s.runtime.predict({ kind: 'wait', parameters: { ticks: 1 } }, []);
    assert.equal(s.runtime.eventCount, 1, 'unfinished producer evidence must precede the query');
    const call = s.calls.findLast(c => c.method === query && (query === 'recall' || !c.args[2]?.prefix))!;
    assert.equal(call.args[1].sequence, 3, 'body.latest after an await is not this query cutoff');
    assert.equal(s.memory.snapshot().activeSeconds, .15);
    assert.equal(s.current().sequence, 23);
    await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => [e.frames[0]!.sequence, e.frames.at(-1)!.sequence]), [[1, 3], [3, 23]]);
    const methods = s.calls.map(c => c.method);
    assert(methods.indexOf('observe') < methods.indexOf('advance'));
    t.diagnostic(JSON.stringify({ query, ...audit(s) }));
  } finally { await s.runtime.close(); }
});

test('sealThrough retains a supplied old cutoff and the already-received newer real tail; baseline and repeated seals do not duplicate', async t => {
  const s = setup(); [frame(1), frame(2, true), frame(3, true), frame(4, true, true), frame(5, true, true)].forEach(f => s.push(f));
  try {
    s.runtime.attention.sealThrough(frame(3, true));
    s.runtime.attention.sealThrough(frame(3, true));
    s.runtime.attention.sealThrough(frame(5, true, true));
    s.runtime.attention.sealThrough(frame(5, true, true));
    await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => [e.frames[0]!.sequence, e.frames.at(-1)!.sequence]), [[1, 3], [3, 5]]);
    assert.deepEqual(s.records.filter(r => r.kind === 'attention').map(r => r.value.sequence), [3, 5]);
    // A forecast completed after the saved cutoff must keep its actual completion sequence.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert(s.records.filter(r => r.kind === 'focus-forecast').every(r => r.value.completedSequence === 5));
    t.diagnostic(JSON.stringify(audit(s)));
  } finally { await s.runtime.close(); }
});

test('periodic window already processed and cutoff at its baseline are idempotent', async t => {
  const s = setup(); for (let n = 1; n <= 21; n++) s.push(frame(n, n > 1));
  try {
    assert.equal(s.records.filter(r => r.kind === 'attention').length, 1);
    s.runtime.attention.sealThrough(frame(21, true)); await s.runtime.recall({ direction: 'change' }, 0);
    s.runtime.attention.sealThrough(frame(21, true)); await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => [e.frames[0]!.sequence, e.frames.at(-1)!.sequence]), [[1, 21]]);
    assert.equal(s.records.filter(r => r.kind === 'attention').length, 1); t.diagnostic(JSON.stringify(audit(s)));
  } finally { await s.runtime.close(); }
});

test('a no-change passive remainder is not a new event; an executed no-effect action is still observed', async t => {
  const s = setup(); s.push(frame(1));
  s.executeWith(async action => {
    // The periodic monitor closes at 21 before the body returns; the active event already covers the change.
    for (let n = 2; n <= 21; n++) s.push(frame(n, n >= 3));
    const e = active('changed-action', [frame(2), frame(3, true), frame(4, true), frame(5, true)], action);
    return { result: e.bodyResult!, event: e };
  });
  try {
    await s.runtime.execute([{ kind: 'wait', parameters: { ticks: 1 } }]); await s.runtime.execute([]);
    assert.deepEqual(learned(s).map(e => e.id), ['changed-action']);
    assert(s.records.some(r => r.kind === 'passive-event-no-change'));
    s.executeWith(async action => { s.push(frame(22, true)); const e = active('no-effect-action', [frame(21, true), frame(22, true)], action);
      return { result: e.bodyResult!, event: e }; });
    await s.runtime.execute([{ kind: 'wait', parameters: { ticks: 1 } }]);
    assert.deepEqual(learned(s).map(e => e.id), ['changed-action', 'no-effect-action']);
    assert(eventRows(learned(s)[1]!).changes.flat().every(c => c.before === c.after));
    assert.equal(s.runtime.actions, 2); t.diagnostic(JSON.stringify(audit(s)));
  } finally { await s.runtime.close(); }
});

test('normal completion seals unfinished producer evidence before save; a genuine error does not flush or act', async t => {
  const normal = setup(), failed = setup();
  for (const s of [normal, failed]) [frame(1), frame(2, true), frame(3, true)].forEach(f => s.push(f));
  normal.runtime.analysis.run = async () => ({ status: 'completed', report: 'offline lifecycle test, not model evidence' });
  failed.runtime.analysis.run = async () => { throw new Error('original-service-fault'); };
  try {
    await normal.runtime.runGoal('offline normal finish');
    await assert.rejects(failed.runtime.runGoal('offline error exit'), /original-service-fault/);
    assert.equal(normal.memory.bufferedEvents, 1); assert.equal(normal.calls.at(-1)!.method, 'save');
    assert.equal(failed.runtime.eventCount, 0); assert.equal(failed.runtime.actions, 0);
    assert(!failed.calls.some(c => ['observe', 'save', 'advance'].includes(c.method)));
    t.diagnostic(JSON.stringify({ normal: audit(normal), failed: audit(failed) }));
  } finally { await normal.runtime.close(); await failed.runtime.close(); }
});

test('sealThrough does not replace an observation time or fill an observation gap', async () => {
  const s = setup(); s.push(frame(1)); s.push(frame(2, true));
  try { assert.throws(() => s.runtime.attention.sealThrough({ ...frame(2, true), activeSeconds: 999 }), /cutoff-time-mismatch/); }
  finally { await s.runtime.close(); }
  const gap = setup(); gap.push(frame(1)); gap.push(frame(3, true));
  try { assert.throws(() => gap.runtime.attention.sealThrough(frame(3, true)), /event-observation-gap/); }
  finally { await gap.runtime.close(); }
});
