import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftBody } from '../src/body.js';
import type { Action, RealEvent } from '../src/contracts.js';

/** Transport fixture: production sensing, waits, actuation and receipts run unchanged. */
class DigBot extends EventEmitter {
  entity = { id: 1, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: -.2, onGround: true };
  entities = {}; game = { dimension: 'overworld', gameMode: 'survival' };
  health = 20; food = 20; quickBarSlot = 0; heldItem = null;
  inventory = { hotbarStart: 36, slots: Array(45).fill(null) };
  block = { name: 'synthetic-block', stateId: 1, position: new Vec3(0, 64, -2), face: 3,
    intersect: new Vec3(.5, 64.5, -1), shapes: [[0, 0, 0, 1, 1, 1]], getProperties: () => ({ intact: true }) };
  visible = true; world = { raycast: () => this.visible ? this.block : null };
  packets: { status: number; location: Vec3; sequence: number }[] = [];
  targetDigBlock = null; sdkCalls = 0; loaded = 0;
  startError: Error | null = null; cancelError: Error | null = null;
  _client = Object.assign(new EventEmitter(), { write: (name: string, packet: { status: number; location: Vec3; sequence: number }) => {
    if (name === 'player_loaded') { this.loaded++; return; }
    assert.equal(name, 'block_dig'); this.packets.push(packet);
    if (packet.status === 0 && this.startError) throw this.startError;
    if (packet.status === 1 && this.cancelError) throw this.cancelError;
  } });
  entityAtCursor(): null { return null; }
  blockAt(position: Vec3) { return this.visible && position.equals(this.block.position) ? this.block : null; }
  dig(): never { this.sdkCalls++; throw new Error('material-table SDK must not control the sensory outcome'); }
  digTime(): number { return Infinity; }
  _updateBlockState(): never { throw new Error('the actuator must not predict a block disappearance'); }
  stopDigging(): void {}
  swingArm(): void {}
  clearControlStates(): void {}
  quit(): void {}
  authoritativeRemoval(): void {
    this.visible = false; this.emit('blockUpdate', this.block, { ...this.block, stateId: 0 });
  }
}
function fixture(t: TestContext, options: { visible?: boolean; far?: boolean } = {}) {
  const bot = new DigBot();
  if (options.visible === false) bot.visible = false;
  if (options.far) bot.block.position = new Vec3(0, 64, -5);
  t.mock.method(mineflayer, 'createBot', () => bot as unknown as Bot);
  const records: { kind: string; value: unknown }[] = [];
  const body = new MinecraftBody({ host: '127.0.0.1', port: 1, username: 'offline-fixture', worldId: 'no-world-created',
    sessionId: 'synthetic-dig-test' }, (kind, value) => records.push({ kind, value }));
  bot.emit('physicsTick'); t.after(() => body.close());
  const action: Action = { kind: 'break', targetId: `block:0,64,${options.far ? -5 : -2}`, parameters: {} };
  const tick = async (count: number) => { for (let i = 0; i < count; i++) { bot.emit('physicsTick'); await turn(); } };
  const execute = (chosen = action) => { const pending = body.execute(chosen); void pending.catch(() => {}); return pending; };
  return { bot, body, records, action, tick, execute };
}
function assertWindow(event: RealEvent): void {
  const first = event.bodyResult!.startSequence, last = event.bodyResult!.endSequence;
  assert.deepEqual(event.frames.map(f => f.sequence), Array.from({ length: last - first + 1 }, (_, i) => first + i));
  assert.equal(event.provenance, 'executed-real-body');
}
function assertReleased(h: ReturnType<typeof fixture>): void {
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  assert.equal(h.bot.listenerCount('blockUpdate'), 0); assert.equal(h.body.executing, false);
}
test('readiness acknowledges captured client loading and repeats after a new spawn', async t => {
  const h = fixture(t), ready = h.body.ready(); assert.equal(h.bot.loaded, 0);
  await h.tick(2); await ready; assert.equal(h.bot.loaded, 1);
  await h.tick(5); assert.equal(h.bot.loaded, 1);
  h.bot.emit('spawn'); await h.tick(2); assert.equal(h.bot.loaded, 1);
  await h.tick(1); assert.equal(h.bot.loaded, 2);
});
test('an infinite client dig time still yields a bounded actual no-effect window without an optimistic disappearance', async t => {
  const h = fixture(t), initial = h.body.latest(), pending = h.execute(); await h.tick(210);
  const { result, event } = await pending;
  assert.equal(result.executed, true); assert.equal(result.terminationReason, 'observation-limit'); assert(event); assertWindow(event);
  assert.equal(event.frames.length, 206); assert.equal(h.bot.sdkCalls, 0); assert.equal(h.body.physicalCalls, 1);
  assert.deepEqual(h.bot.packets.map(p => p.status), [0, 1]);
  assert.deepEqual(h.bot.packets.map(p => p.sequence), [0, 1]);
  assert(h.bot.packets.every(p => p.location.equals(h.bot.block.position)));
  for (const f of event.frames) { assert.deepEqual(f.objects, initial.objects); assert.deepEqual(f.self, initial.self); }
  assertReleased(h);
});
test('only the server-observed target change completes a dig and no old waiter survives', async t => {
  const h = fixture(t), pending = h.execute(); await h.tick(4); h.bot.authoritativeRemoval(); await h.tick(8);
  const { result, event } = await pending;
  assert.equal(result.terminationReason, 'stable'); assert(event); assertWindow(event);
  assert(event.frames.some(f => f.objects.length > 0)); assert.equal(event.frames.at(-1)!.objects.length, 0); assertReleased(h);
  await h.tick(210);
  const next = h.execute({ kind: 'observe', parameters: { ticks: 1 } }); await h.tick(8);
  assert.equal((await next).result.status, 'completed');
  assert.equal(h.bot.packets.filter(p => p.status === 0).length, 1);
  assert.equal(h.records.filter(r => r.kind === 'body-result').length, 2); assertReleased(h);
});
test('an unrelated server block update cannot certify a change to the attempted target', async t => {
  const h = fixture(t), pending = h.execute(); await h.tick(4);
  h.bot.emit('blockUpdate', null, { ...h.bot.block, position: new Vec3(8, 64, -2), stateId: 0 });
  await h.tick(206); const receipt = await pending;
  assert.equal(receipt.result.terminationReason, 'observation-limit'); assertReleased(h);
});
test('a real frame fault remains fatal and releases the active input and observers', async t => {
  const h = fixture(t), original = new Error('synthetic disconnected'), pending = h.execute(); await h.tick(2);
  h.bot.emit('error', original); await assert.rejects(pending, error => error === original);
  assert.equal(h.bot.packets.at(-1)!.status, 1); assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0); assertReleased(h);
});
test('start and cancellation transport failures cannot become successful action receipts', async t => {
  for (const stage of ['start', 'cancel']) {
    const h = fixture(t), original = new Error(stage + '-transport-failure');
    if (stage === 'start') h.bot.startError = original; else h.bot.cancelError = original;
    const pending = h.execute(); if (stage === 'cancel') await h.tick(200);
    await assert.rejects(pending, error => error === original);
    assert.equal(h.bot.packets.filter(p => p.status === 0).length, 1);
    assert.equal(h.records.filter(r => r.kind === 'body-result').length, 0); assertReleased(h);
  }
});
test('missing or unreachable targets do not emit a dig, retarget, or create experience', async t => {
  for (const options of [{ visible: false }, { far: true }]) {
    const h = fixture(t, options), outcome = await h.execute();
    assert.equal(outcome.result.executed, false); assert.equal(outcome.event, null);
    assert.equal(outcome.result.status, options.visible === false ? 'no-target' : 'out-of-reach');
    assert.equal(h.bot.packets.length, 0); assert.equal(h.body.physicalCalls, 0);
  }
});
