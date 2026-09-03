import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftBody } from '../src/body.js';
import type { Action, RealEvent } from '../src/contracts.js';

/** A transport fixture only: production capture, tick waits, execute and event construction run unchanged. */
class DigBot extends EventEmitter {
  entity = { id: 1, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: -.2, onGround: true };
  entities = {};
  game = { dimension: 'overworld' };
  health = 20; food = 20; quickBarSlot = 0; heldItem = null;
  block = { name: 'synthetic-block', position: new Vec3(0, 64, -2), getProperties: () => ({ intact: true }) };
  visible = true;
  world = { raycast: () => this.visible ? this.block : null };
  calls: { target: unknown; forceLook: unknown }[] = [];
  implicitLooks = 0; activeStops = 0; clearCalls = 0;
  targetDigBlock: unknown = null;
  entityAtCursor(): null { return null; }
  blockAt(position: Vec3): typeof this.block | null {
    return this.visible && position.equals(this.block.position) ? this.block : null;
  }
  pending = (() => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  })();
  stopError = new Error('Digging aborted');
  synchronousError: Error | null = null;
  dig(target: unknown, forceLook?: unknown): Promise<void> {
    this.calls.push({ target, forceLook });
    if (this.synchronousError) throw this.synchronousError;
    if (forceLook !== 'ignore') { this.implicitLooks++; this.entity.pitch = -.6; }
    this.targetDigBlock = target;
    return this.pending.promise;
  }
  stopDigging(): void {
    if (!this.targetDigBlock) return;
    const target = this.targetDigBlock; this.targetDigBlock = null; this.activeStops++;
    this.emit('diggingAborted', target);
    this.pending.reject(this.stopError);
  }
  complete(removeVisibleBlock: boolean): void {
    this.targetDigBlock = null;
    if (removeVisibleBlock) this.visible = false;
    this.pending.resolve();
  }
  clearControlStates(): void { this.clearCalls++; }
  quit(): void {}
}

function fixture(t: TestContext, options: { visible?: boolean; far?: boolean } = {}) {
  const bot = new DigBot();
  if (options.visible === false) bot.visible = false;
  if (options.far) bot.block.position = new Vec3(0, 64, -5);
  t.mock.method(mineflayer, 'createBot', () => bot as unknown as Bot);
  const records: { kind: string; value: unknown }[] = [];
  const body = new MinecraftBody({ host: '127.0.0.1', port: 1, username: 'offline-fixture', worldId: 'no-world-created',
    sessionId: 'synthetic-dig-test' }, (kind, value) => records.push({ kind, value }));
  bot.emit('physicsTick');
  t.after(() => body.close());
  const action: Action = { kind: 'break', targetId: `block:0,64,${options.far ? -5 : -2}`, parameters: {} };
  const tick = async (count: number) => { for (let i = 0; i < count; i++) { bot.emit('physicsTick'); await turn(); } };
  const execute = (chosen = action) => {
    const pending = body.execute(chosen);
    // Let the driver advance real production event listeners without an unhandled rejection in a red case.
    void pending.catch(() => {});
    return pending;
  };
  return { bot, body, records, action, tick, execute };
}

function assertRealWindow(event: RealEvent, first: number, last: number): void {
  assert.deepEqual(event.frames.map(f => f.sequence), Array.from({ length: last - first + 1 }, (_, i) => first + i));
  assert.equal(event.frames[0]!.sequence, event.bodyResult!.startSequence);
  assert.equal(event.frames.at(-1)!.sequence, event.bodyResult!.endSequence);
  assert.equal(event.provenance, 'executed-real-body');
}

test('200 real ticks end one attempted dig normally, preserve the crosshair and retain a no-effect window', async t => {
  const h = fixture(t), initial = h.body.latest(), pending = h.execute();
  await h.tick(205); // 200 force ticks + the unchanged 3 stable / 2 grace ticks.
  const { result, event } = await pending;
  assert.equal(result.executed, true); assert.equal(result.status, 'completed');
  assert.equal(result.terminationReason, 'observation-limit'); assert.deepEqual(result.action, h.action);
  assert.equal(h.bot.calls.length, 1); assert.equal(h.body.physicalCalls, 1); assert.equal(h.bot.activeStops, 1);
  assert.equal(h.bot.calls[0]!.target, h.bot.block); assert.equal(h.bot.calls[0]!.forceLook, 'ignore');
  assert.equal(h.bot.implicitLooks, 0); assert.equal(h.body.latest().self.pitch, initial.self.pitch);
  assert.equal(h.body.latest().targetId, initial.targetId);
  assert(event); assertRealWindow(event, 1, 206);
  for (const f of event.frames) { assert.deepEqual(f.objects, initial.objects); assert.deepEqual(f.self, initial.self); }
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 1);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  assert.equal(h.bot.listenerCount('diggingAborted'), 0);
  t.diagnostic(JSON.stringify({ source: 'synthetic transport / production body branch, not Minecraft evidence', result,
    frames: event.frames.length, activeStops: h.bot.activeStops, calls: h.bot.calls.length,
    diagnostics: h.records.filter(r => r.kind === 'dig-attempt') }));
});

test('dig completion removes its old window before the next action and only records captured disappearance', async t => {
  const h = fixture(t), pending = h.execute();
  await h.tick(4); h.bot.complete(true); await turn(); await h.tick(6);
  const { result, event } = await pending;
  assert.equal(result.terminationReason, 'stable'); assert(event); assertRealWindow(event, 1, 11);
  assert(event.frames.some(f => f.objects.length > 0)); assert.equal(event.frames.at(-1)!.objects.length, 0);
  assert.equal(h.bot.activeStops, 0); assert.equal(h.bot.calls.length, 1);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  await h.tick(210); // Past the canceled dig window; there must be no old waiter or late failure.
  const next = h.execute({ kind: 'observe', parameters: { ticks: 1 } }); await h.tick(6);
  const following = await next;
  assert.equal(following.result.status, 'completed'); assert.equal(h.bot.calls.length, 1);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 2);
  t.diagnostic(JSON.stringify({ result, following: following.result, oldWindowListeners: h.body.listenerCount('frame') }));
});

test('a genuine dig rejection stays the identical error, produces no receipt and starts no following action', async t => {
  const h = fixture(t), original = new Error('synthetic protocol rejection'), pending = h.execute();
  await h.tick(3); h.bot.pending.reject(original); await turn();
  await assert.rejects(pending, error => error === original);
  assert.equal(h.bot.calls.length, 1); assert.equal(h.bot.activeStops, 1);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  assert.equal(h.body.executing, false);
});

test('the window cannot swallow a non-cancellation error produced during active stop', async t => {
  const h = fixture(t), original = new Error('synthetic stop protocol failure'); h.bot.stopError = original;
  const pending = h.execute(); await h.tick(200);
  await assert.rejects(pending, error => error === original);
  assert.equal(h.bot.activeStops, 1); assert.equal(h.bot.calls.length, 1);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
  assert.equal(h.bot.listenerCount('diggingAborted'), 0);
});

test('an unsolicited abort with the same message is not a normal window expiry', async t => {
  const h = fixture(t), original = new Error('Digging aborted'), pending = h.execute();
  await h.tick(10); h.bot.pending.reject(original); await turn();
  await assert.rejects(pending, error => error === original);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
  assert.equal(h.bot.calls.length, 1);
});

test('a real frame fault during the dig remains fatal and cleans both active dig and waiter', async t => {
  const h = fixture(t), original = new Error('synthetic disconnected'), pending = h.execute();
  await h.tick(2); h.bot.emit('error', original); await turn();
  await assert.rejects(pending, error => error === original);
  assert.equal(h.bot.activeStops, 1); assert.equal(h.bot.calls.length, 1);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
});

test('missing or unreachable original targets do not dig, retarget or create events', async t => {
  for (const options of [{ visible: false }, { far: true }]) {
    const h = fixture(t, options), outcome = await h.execute();
    assert.equal(outcome.result.executed, false); assert.equal(outcome.event, null);
    assert.equal(outcome.result.status, options.visible === false ? 'no-target' : 'out-of-reach');
    assert.equal(h.bot.calls.length, 0); assert.equal(h.body.physicalCalls, 0);
    assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
  }
});

test('a synchronous dig error also releases the window with no action retry or fabricated event', async t => {
  const h = fixture(t), original = new Error('synthetic synchronous failure'); h.bot.synchronousError = original;
  await assert.rejects(h.execute(), error => error === original);
  assert.equal(h.bot.calls.length, 1); assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
});
