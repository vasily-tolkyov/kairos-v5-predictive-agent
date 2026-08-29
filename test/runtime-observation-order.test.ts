import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Action, BodyResult, Observation, RealEvent } from '../src/contracts.js';
import type { MinecraftBody } from '../src/body.js';
import type { Compute } from '../src/compute.js';
import type { Configuration } from '../src/services.js';
import { PhysicalMemory } from '../src/memory.js';
import { V5Runtime } from '../src/runtime.js';

const frame = (sequence: number): Observation => ({ sequence, activeSeconds: sequence / 20,
  targetId: null, contextId: 'explicit-ordering-test-not-Minecraft', objects: [],
  self: { position: [sequence / 10, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot: 2 } } });
const event = (id: string, start: number, end: number, action?: Action): RealEvent => {
  const bodyResult: BodyResult | null = action ? { action, executed: true, status: 'completed', startSequence: start, endSequence: end } : null;
  return { version: 'RealEventV5', id, cue: { kind: action?.kind ?? 'passive', parameters: action?.parameters ?? {}, targetRole: null },
    frames: Array.from({ length: end - start + 1 }, (_, i) => frame(start + i)), trackedIds: ['self'],
    provenance: action ? 'executed-real-body' : 'observed-passive', bodyResult, complete: true };
};
const config = { actionBudget: 512, analysis: { baseUrl: 'http://127.0.0.1:18080/v1', context: 8192,
  maximumOutputTokens: 768, timeoutMs: 2000, nativeThinking: false, temperature: 0, topP: 1,
  topK: 0, minP: 0, presencePenalty: 0, seed: 1 } } as Configuration;

function setup(beforeObserve?: (count: number, event: RealEvent) => void) {
  const memory = new PhysicalMemory(), calls: { method: string; args: any[] }[] = [], records: { kind: string; value: any }[] = [];
  let current = frame(1), runtime: V5Runtime;
  let execute: (action: Action) => Promise<{ result: BodyResult; event: RealEvent | null }> = async action => {
    const e = event('active-default', current.sequence, current.sequence + 1, action);
    current = e.frames.at(-1)!; return { result: e.bodyResult!, event: e };
  };
  let afterObserve: ((event: RealEvent) => Promise<void>) | undefined;
  const body = Object.assign(new EventEmitter(), { executing: false, check() {}, latest: () => current,
    async execute(action: Action) { body.executing = true; try { return await execute(action); } finally { body.executing = false; } },
    async close() {} });
  const compute = { async call(method: string, ...args: any[]) {
    calls.push({ method, args });
    if (method === 'observe') { const value = memory.observe(args[0]); await afterObserve?.(args[0]); return value; }
    if (method === 'advance') return memory.advanceTo(args[0]);
    if (method === 'recall') return memory.recall(args[0], args[1], args[2]);
    if (method === 'predict') return memory.predict(args[0], args[1]);
    if (method === 'snapshot') return memory.snapshot();
    throw new Error(`unexpected-test-method:${method}`);
  }, async close() {} };
  runtime = new V5Runtime(body as unknown as MinecraftBody, config, 'D:/Kairos_V5_Predictive_Agent/tmp/not-written-by-ordering-test',
    (kind, value) => records.push({ kind, value }), { compute: compute as unknown as Compute, beforeObserve });
  // No model request and no filesystem persistence in this ordering fixture; save order is still observable.
  runtime.save = async () => { calls.push({ method: 'save', args: [memory.snapshot()] }); };
  const capture = (e: RealEvent) => runtime.attention.capture(e);
  return { runtime, memory, calls, records, capture, body,
    latest: (sequence: number) => { current = frame(sequence); },
    executeWith: (f: typeof execute) => { execute = f; }, afterObserve: (f: NonNullable<typeof afterObserve>) => { afterObserve = f; } };
}
const learnedWindows = (s: ReturnType<typeof setup>) => s.calls.filter(c => c.method === 'observe')
  .map(c => (c.args[0] as RealEvent).frames.map(f => f.sequence));

for (const query of ['recall', 'predict'] as const) test(`${query}: completed passive .10 is learned before advancing/querying captured .15`, async () => {
  const s = setup(); s.latest(3); s.capture(event('passive-before-query', 1, 2));
  if (query === 'recall') await s.runtime.recall({ direction: 'change' }, 0);
  else await s.runtime.predict({ kind: 'wait', parameters: { ticks: 1 } }, []);
  await s.runtime.execute([]);
  assert.deepEqual(s.calls.slice(0, 3).map(c => c.method), ['observe', 'advance', query]);
  assert.equal(s.calls[1]!.args[0], .15); assert.equal(s.runtime.eventCount, 1);
  assert.equal(s.memory.snapshot().activeSeconds, .15); assert.equal(s.memory.writes, 0);
  await s.runtime.close();
});

test('a shared baseline is not a duplicate change; identical/fully covered passive windows are not learned twice', async () => {
  const s = setup(); s.latest(2); s.capture(event('first', 1, 2)); await s.runtime.execute([]);
  s.latest(3); s.capture(event('second', 2, 3)); await s.runtime.execute([]);
  s.capture(event('second', 2, 3)); s.capture(event('same-frames-new-id', 1, 3)); await s.runtime.execute([]);
  assert.deepEqual(learnedWindows(s), [[1, 2], [2, 3]]); assert.equal(s.runtime.eventCount, 2);
  await s.runtime.close();
});

test('an event arriving during an await but before the action is committed in chronological order', async () => {
  const s = setup(); s.latest(2); s.capture(event('early', 1, 2));
  s.afterObserve(async e => { if (e.id === 'early') { s.capture(event('during-await', 3, 4)); s.latest(5); } });
  s.executeWith(async action => { const e = event('active', 5, 6, action); s.latest(6); return { result: e.bodyResult!, event: e }; });
  await s.runtime.execute([{ kind: 'move', parameters: { direction: 'forward', ticks: 1 } }]);
  assert.deepEqual(learnedWindows(s), [[1, 2], [3, 4], [5, 6]]);
  assert.equal(s.memory.bufferedEvents, 3); await s.runtime.close();
});

test('newer events arriving during query synchronization stay pending; the query keeps its captured observation', async () => {
  const s = setup(); s.latest(3); s.capture(event('early', 1, 2));
  s.afterObserve(async e => { if (e.id === 'early') { s.capture(event('newer', 4, 5)); s.latest(5); } });
  await s.runtime.recall({ direction: 'change' }, 0);
  assert.equal(s.runtime.eventCount, 1); assert.equal(s.calls.find(c => c.method === 'recall')!.args[1].sequence, 3);
  assert.equal(s.memory.snapshot().activeSeconds, .15);
  await s.runtime.execute([]); assert.deepEqual(learnedWindows(s), [[1, 2], [4, 5]]);
  await s.runtime.close();
});

test('passive capture during an action is retained; overlap has one owner and the real uncovered prefix/tail survive', async () => {
  const s = setup(), p = event('crossing', 2, 5), original = JSON.stringify(p);
  s.executeWith(async action => {
    assert.equal(s.body.executing, true); s.capture(p); s.latest(5);
    const e = event('active', 3, 4, action); return { result: e.bodyResult!, event: e };
  });
  await s.runtime.execute([{ kind: 'jump', parameters: { forward: false, ticks: 1 } }]);
  await s.runtime.execute([]);
  assert.deepEqual(learnedWindows(s), [[2, 3], [3, 4], [4, 5]]);
  const learned = s.calls.filter(c => c.method === 'observe').map(c => c.args[0] as RealEvent);
  assert.deepEqual(learned.map(e => e.provenance), ['observed-passive', 'executed-real-body', 'observed-passive']);
  assert.equal(JSON.stringify(p), original);
  for (const e of learned) for (const f of e.frames) assert.deepEqual(f, frame(f.sequence), 'no synthetic sample/time');
  s.capture(event('duplicate-active-passive', 3, 4)); await s.runtime.execute([]);
  assert.equal(s.runtime.eventCount, 3); await s.runtime.close();
});

test('normal goal completion drains completed observations before the final save', async () => {
  const s = setup();
  s.runtime.analysis.run = async () => { s.latest(3); s.capture(event('last-passive', 1, 2)); return { status: 'completed', report: 'test' }; };
  await s.runtime.runGoal('synthetic test');
  assert.deepEqual(s.calls.map(c => c.method), ['observe', 'save']);
  assert.equal(s.calls.at(-1)!.args[0].pendingInitialization.length, 1);
  await s.runtime.close();
});

test('short-only beforeObserve stops before event 65; production without that hook accepts more than 64', async () => {
  const counts: number[] = [];
  const short = setup(count => { counts.push(count); if (count >= 64) throw new Error('short-loop-evaluation-event-limit:64'); });
  const ordinary = setup();
  for (let i = 0; i < 64; i++) {
    for (const s of [short, ordinary]) {
      if (i % 2 === 0) { s.latest(i + 2); s.capture(event(`e-${i}`, i + 1, i + 2)); await s.runtime.execute([]); }
      else { s.latest(i + 1); s.executeWith(async action => { const e = event(`active-${i}`, i + 1, i + 2, action);
        s.latest(i + 2); return { result: e.bodyResult!, event: e }; });
        await s.runtime.execute([{ kind: 'wait', parameters: { ticks: 1 } }]); }
    }
  }
  short.latest(66); short.capture(event('e-64', 65, 66));
  await assert.rejects(short.runtime.execute([]), /short-loop-evaluation-event-limit:64/);
  ordinary.latest(66); ordinary.capture(event('e-64', 65, 66)); await ordinary.runtime.execute([]);
  assert.equal(short.runtime.eventCount, 64); assert.equal(short.memory.bufferedEvents, 64);
  assert.equal(short.runtime.actions, 32);
  assert.equal(short.calls.filter(c => c.method === 'observe').length, 64);
  assert.equal(ordinary.memory.bufferedEvents, 65); assert.equal(ordinary.memory.ready, false);
  assert.deepEqual(counts, Array.from({ length: 65 }, (_, i) => i));
  await short.runtime.close(); await ordinary.runtime.close();
});
