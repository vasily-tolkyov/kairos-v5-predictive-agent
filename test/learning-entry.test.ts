import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BodySession, type MinecraftBody } from '../src/body.js';
import { publicLayoutContextId, PUBLIC_LAYOUT_SEMANTICS } from '../src/public-context.js';
import { parseLearningOptions } from '../src/main.js';
import { assertNewExperienceOutput, restoreExperience, V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { PhysicalMemory, type MemorySnapshot } from '../src/memory.js';
import { Compute } from '../src/compute.js';
import { AttentionMonitor } from '../src/attention/monitor.js';
import { PublicObjectAliases } from '../src/analysis-actions.js';
import { eventRows, relativePublicFeatures } from '../src/events.js';
import { saveJson, fileSha, sha } from '../src/util.js';
import type { Action, BodyResult, Observation, PublicObject, RealEvent } from '../src/contracts.js';
import type { Configuration } from '../src/services.js';

const blocks: PublicObject[] = [
  { id: 'block:1,64,2', type: 'synthetic-a', relativePosition: [1.12, -.5, 2], properties: { open: false } },
  { id: 'block:2,64,2', type: 'synthetic-b', relativePosition: [2, -.5, 2], properties: {} },
];
const context = () => publicLayoutContextId('overworld', blocks);
const config = { actionBudget: 512, analysis: { baseUrl: 'http://127.0.0.1:18080/v1', context: 8192,
  maximumOutputTokens: 768, timeoutMs: 2000, nativeThinking: false, temperature: 0, topP: 1,
  topK: 0, minP: 0, presencePenalty: 0, seed: 1 } } as Configuration;
const action: Action = { kind: 'select-hotbar', parameters: { slot: 2 } };
function frame(session: BodySession, sequence: number, slot = 0, external = false): Observation {
  return { sequence, activeSeconds: session.activeSeconds(sequence), contextId: context(), targetId: null,
    self: { position: [0, 64, 0], yaw: 0, pitch: 0, properties: { selectedSlot: slot } },
    objects: [...blocks, { id: 'entity:9', type: 'synthetic-external', relativePosition: [1, 0, 0],
      properties: { open: external, lit: external } }] };
}
function event(session: BodySession, frames: readonly Observation[]): RealEvent {
  return { version: 'RealEventV5', id: session.eventId(1), cue: { ...action, targetRole: null }, frames,
    trackedIds: ['self'], complete: true, provenance: 'executed-real-body', bodyResult: {
      action, executed: true, status: 'completed', startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence } };
}
async function sourceFixture() {
  const temporaryRoot = resolve('tmp'); await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(resolve(temporaryRoot, 'learning-entry-test-'));
  const source = resolve(root, 'source'), output = resolve(root, 'new-run');
  await mkdir(source);
  const memory = new PhysicalMemory(), session = new BodySession(0, 'synthetic-old-session');
  memory.observe(event(session, [frame(session, 1), frame(session, 2, 1)]));
  memory.advanceTo(166.5); // A small isolated clock fixture, not new Minecraft evidence.
  const snapshot = memory.snapshot(), snapshotPath = resolve(source, 'experience-0001.json');
  const pointer: ExperiencePointer = { sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename: 'experience-0001.json',
    sha256: sha(snapshot), actions: 99, eventCount: 1, writes: 0 }; // Old action metadata must never be replayed.
  const pointerPath = resolve(source, 'EXPERIENCE_LATEST.json');
  await saveJson(snapshotPath, snapshot); await saveJson(pointerPath, pointer);
  return { root, output, memory, snapshot, snapshotPath, pointer, pointerPath };
}

test('public layout provenance ignores absolute translation, body/clock/session and object IDs but detects visible layout changes', t => {
  const a = frame(new BodySession(0, 'first'), 1);
  const translated: Observation = { ...a, sequence: 9000, activeSeconds: 450,
    self: { position: [1000, 20, -900], yaw: 1, pitch: .2, properties: { health: 5, selectedSlot: 8, velocityY: 1 } },
    objects: a.objects.map(o => ({ ...o, id: o.id.startsWith('block:') ? o.id.replace('64', '20') : 'entity:400' })) };
  const first = publicLayoutContextId('overworld', a.objects), second = publicLayoutContextId('overworld', translated.objects);
  assert.equal(first, second);
  assert.notEqual(first, publicLayoutContextId('overworld', [{ ...blocks[0]!, properties: { open: true } }, blocks[1]!]));
  assert.notEqual(first, publicLayoutContextId('overworld', [{ ...blocks[0]!, relativePosition: [1.5, -.5, 2] }, blocks[1]!]));
  assert.equal(first, publicLayoutContextId('overworld', [...a.objects].reverse()));
  assert.equal(first, publicLayoutContextId('overworld', [{ ...blocks[0]!, relativePosition: [1.11, -.5, 2] }, blocks[1]!]));
  t.diagnostic(JSON.stringify({ first, translated: second, version: PUBLIC_LAYOUT_SEMANTICS,
    caveat: 'view-dependent public grouping, not proof of statistical independence' }));
});

test('context provenance and session IDs do not enter representation rows or the public analysis view', () => {
  const s1 = new BodySession(0, 'one'), s2 = new BodySession(0, 'two');
  const a = event(s1, [frame(s1, 1), frame(s1, 2, 1)]);
  const b = { ...event(s2, [frame(s2, 1), frame(s2, 2, 1)]),
    frames: a.frames.map(f => ({ ...f, contextId: 'different-source-only' })) };
  assert.notEqual(a.id, b.id); assert.deepEqual(eventRows(a), eventRows(b));
  assert.deepEqual(relativePublicFeatures(a.frames[0]!), relativePublicFeatures(b.frames[0]!));
  const view = new PublicObjectAliases().present(a.frames[0]!);
  assert(!JSON.stringify(view).includes(PUBLIC_LAYOUT_SEMANTICS));
  assert(!JSON.stringify(relativePublicFeatures(a.frames[0]!)).includes(PUBLIC_LAYOUT_SEMANTICS));
});

test('entry options make default empty, explicit experience and bootstrap-only distinct; source directory remains read-only', () => {
  assert.deepEqual(parseLearningOptions([]), { short: false, bootstrapOnly: false, experiencePointer: null, evidenceDirectory: null });
  const pointer = resolve('tmp/source/EXPERIENCE_LATEST.json');
  const parsed = parseLearningOptions(['--bootstrap-only', '--experience-pointer', pointer]);
  assert.equal(parsed.experiencePointer, pointer); assert.equal(parsed.bootstrapOnly, true);
  assert.throws(() => parseLearningOptions(['--experience-pointer']), /missing-experience-pointer/);
  assert.throws(() => parseLearningOptions(['--experience-pointer', 'relative.json']), /must-be-absolute/);
  assert.throws(() => parseLearningOptions(['--short', '--bootstrap-only']), /distinct-runs/);
  assert.throws(() => assertNewExperienceOutput(pointer, resolve('tmp/source')), /read-only/);
  assert.throws(() => assertNewExperienceOutput(pointer, resolve('tmp/source/nested')), /read-only/);
  assertNewExperienceOutput(pointer, resolve('tmp/new-run'));
});

test('missing, corrupt, rehashed-old-context and incompatible pointers fail without fallback or worker restore', async t => {
  const s = await sourceFixture(), calls: string[] = [];
  const compute = { async call(method: string) { calls.push(method); throw new Error('unexpected-restore'); } } as unknown as Compute;
  const bad = resolve(s.root, 'bad-pointer.json');
  await assert.rejects(restoreExperience(compute, resolve(s.root, 'missing.json')), /ENOENT/);
  await writeFile(bad, '{'); await assert.rejects(restoreExperience(compute, bad), SyntaxError);
  await saveJson(bad, { ...s.pointer, sourceContextVersion: undefined });
  await assert.rejects(restoreExperience(compute, bad), /incompatible-experience-context/);
  await saveJson(s.pointerPath, { ...s.pointer, sha256: '0'.repeat(64) });
  await assert.rejects(restoreExperience(compute, s.pointerPath), /hash-mismatch/);
  const legacy = { ...s.snapshot, pendingInitialization: s.snapshot.pendingInitialization.map(e => ({ ...e,
    frames: e.frames.map(f => ({ ...f, contextId: 'old-absolute-region' })) })) };
  await saveJson(s.snapshotPath, legacy); await saveJson(s.pointerPath, { ...s.pointer, sha256: sha(legacy) });
  await assert.rejects(restoreExperience(compute, s.pointerPath), /incompatible-stored-context/);
  assert.deepEqual(calls, []);
  t.diagnostic(JSON.stringify({ fixture: s.root, invalidRestoreCalls: calls.length, fallback: false }));
});

test('default empty worker and explicit restored worker differ, while stopped wall time is not added', async t => {
  const s = await sourceFixture(), compute = new Compute();
  try {
    assert.equal(await restoreExperience(compute, null), null);
    const cold = await compute.call<MemorySnapshot>('snapshot'); assert.equal(cold.activeSeconds, 0); assert.equal(cold.pendingInitialization.length, 0);
    const restored = await restoreExperience(compute, s.pointerPath); assert(restored);
    assert.deepEqual(await compute.call('snapshot'), s.snapshot);
    const clock = new BodySession(restored.snapshot.activeSeconds, 'synthetic-new-session');
    assert.equal(clock.activeSeconds(1), 166.55); assert.equal(clock.activeSeconds(2), 166.6);
    assert.notEqual(clock.eventId(1), s.snapshot.seenEventIds[0]);
    assert.throws(() => new BodySession(-1), /invalid-experience-time/);
    const otherOfflineDuration = new BodySession(restored.snapshot.activeSeconds, 'different-session');
    assert.equal(otherOfflineDuration.activeSeconds(1), clock.activeSeconds(1));
    t.diagnostic(JSON.stringify({ cold: { activeSeconds: cold.activeSeconds, buffered: 0 },
      restored: { activeSeconds: restored.snapshot.activeSeconds, buffered: restored.snapshot.pendingInitialization.length,
        sha256: sha(await compute.call('snapshot')) }, firstNewFrameTime: clock.activeSeconds(1), actionsReplayed: 0 }));
  } finally { await compute.close(); }
});

test('restored runtime shows actual counts, learns a new session event and never restores old actions or workspace', async t => {
  const s = await sourceFixture(), compute = new Compute(), restored = await restoreExperience(compute, s.pointerPath);
  assert(restored); const sourceHashes = [await fileSha(s.pointerPath), await fileSha(s.snapshotPath)];
  const session = new BodySession(restored.snapshot.activeSeconds, 'synthetic-next-session');
  let current = frame(session, 1), bodyCalls = 0, failure = false;
  const body = Object.assign(new EventEmitter(), { session, check() {}, latest: () => current,
    async execute(a: Action): Promise<{ result: BodyResult; event: RealEvent }> {
      bodyCalls++; if (failure) throw new Error('synthetic-body-fault');
      const start = current; current = frame(session, 2, 2); body.emit('frame', current);
      const actual = event(session, [start, current]); return { result: actual.bodyResult!, event: actual };
    }, async close() {} });
  const records: { kind: string; value: unknown }[] = [];
  const runtime = new V5Runtime(body as unknown as MinecraftBody, config, s.output,
    (kind, value) => records.push({ kind, value }), { compute, restoredExperience: restored,
      analysisHooks: { beforeModelRequest() { throw new Error('offline-test-model-forbidden'); } } });
  try {
    const before = runtime.context() as { physicalEvents: number; initializationBuffered: number; depositedEvents: number };
    assert.equal(before.physicalEvents, 1); assert.equal(before.initializationBuffered, 1); assert.equal(before.depositedEvents, 0);
    assert.equal(runtime.actions, 0); assert.equal(bodyCalls, 0); assert.equal(runtime.newEventCount, 0);
    assert.equal(runtime.analysis.workspace.active, false); assert.equal(runtime.attention.notices.length, 0);
    body.emit('frame', current);
    await runtime.recall({ direction: 'change' }, 0);
    assert.equal((await compute.call<MemorySnapshot>('snapshot')).activeSeconds, 166.55);
    await runtime.execute([action]); await runtime.save();
    const after = await compute.call<MemorySnapshot>('snapshot');
    assert.equal(after.pendingInitialization.length, 2); assert.equal(after.writes, 0); assert.equal(after.activeSeconds, 166.6);
    assert.equal(new Set(after.seenEventIds).size, 2); assert.equal(bodyCalls, 1); assert.equal(runtime.actions, 1);
    assert.equal(runtime.eventCount, 2); assert.equal(runtime.newEventCount, 1); assert.equal(runtime.analysis.calls, 0);
    const newPointer = resolve(s.output, 'EXPERIENCE_LATEST.json'), lastSuccessful = await fileSha(newPointer);
    failure = true; await assert.rejects(runtime.execute([action]), /synthetic-body-fault/);
    assert.equal(await fileSha(newPointer), lastSuccessful, 'failed operation does not replace last successful save');
    assert.deepEqual([await fileSha(s.pointerPath), await fileSha(s.snapshotPath)], sourceHashes);
    t.diagnostic(JSON.stringify({ fixture: s.root, before, after: { seenEventIds: after.seenEventIds,
      activeSeconds: after.activeSeconds, writes: after.writes, buffered: after.pendingInitialization.length },
      actionsBeforeRestore: 99, oldActionsExecuted: 0, newSuccessfulActions: runtime.actions,
      sourceHashes, lastSuccessfulPointer: lastSuccessful, records }));
  } finally { await runtime.close(); }
});

test('production passive windows have session-scoped IDs, without changing their observed event representation', async t => {
  const compute = new Compute(), captures: RealEvent[] = [];
  try {
    for (const id of ['session-alpha', 'session-beta']) {
      const clock = new BodySession(0, id);
      const monitor = new AttentionMonitor(compute, () => {}, () => {}, e => captures.push(e), id);
      monitor.bindActionTarget('self');
      for (let sequence = 1; sequence <= 21; sequence++) monitor.accept(frame(clock, sequence, 0, sequence > 10));
      monitor.check(); await compute.call('status'); await new Promise<void>(done => setImmediate(done)); monitor.check();
    }
    assert.equal(captures.length, 2); assert.notEqual(captures[0]!.id, captures[1]!.id);
    assert.equal(captures[0]!.id, 'session-alpha:monitor-21'); assert.equal(captures[1]!.id, 'session-beta:monitor-21');
    assert.deepEqual(eventRows(captures[0]!), eventRows(captures[1]!));
    t.diagnostic(JSON.stringify({ capturedIds: captures.map(e => e.id), frameSequences: captures[0]!.frames.map(f => f.sequence),
      representationSha256: sha(eventRows(captures[0]!)), modelCalls: 0 }));
  } finally { await compute.close(); }
});
