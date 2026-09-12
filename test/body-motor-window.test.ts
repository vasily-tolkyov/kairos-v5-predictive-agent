import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftBody } from '../src/body.js';
import { validateAction } from '../src/action-contract.js';
import { validateEvent } from '../src/events.js';

class MotorBot extends EventEmitter {
  entity = { id: 1, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: false };
  entities = {}; game = { dimension: 'overworld', gameMode: 'survival' };
  health = 20; food = 20; oxygenLevel: number | undefined = 7; quickBarSlot = 0; heldItem = null;
  registry = { entitiesByName: { player: { metadataKeys: ['shared_flags', 'air_supply'] } } };
  inventory = { hotbarStart: 36, slots: Array(45).fill(null) };
  world = { raycast: () => null }; controls = new Map<string, boolean>(); held = 0; restarts = 0;
  _client = Object.assign(new EventEmitter(), { write: (name: string) => assert.equal(name, 'player_loaded') });
  entityAtCursor() { return null; }
  setControlState(key: string, pressed: boolean) { this.controls.set(key, pressed); }
  clearControlStates() { this.controls.clear(); }
  stopDigging() {} quit() {} targetDigBlock = null;
  usingHeldItem = false; activations = 0; releases = 0;
  activateItem() { this.usingHeldItem = true; this.activations++; }
  deactivateItem() { this.usingHeldItem = false; this.releases++; }
  respawn() { this.emit('respawn'); this.restarts++; this.health = 20; this.entity.position = new Vec3(10, 64, 10); this.emit('spawn'); }
}
function fixture(t: TestContext) {
  const bot = new MotorBot();
  t.mock.method(mineflayer, 'createBot', (options: Parameters<typeof mineflayer.createBot>[0]) => {
    assert.equal(options.respawn, false); return bot as unknown as Bot;
  });
  const records: { kind: string; value: any }[] = [];
  const body = new MinecraftBody({ host: '127.0.0.1', port: 1, username: 'motor-port-test', worldId: 'transport-fixture' },
    (kind, value) => records.push({ kind, value }));
  bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value: 105 }] });
  const tick = async (count: number, moving = false) => {
    for (let i = 0; i < count; i++) {
      if (bot.controls.get('jump')) bot.held++;
      if (moving) bot.entity.position.y += bot.controls.get('jump') ? .1 : -.05;
      bot.emit('physicsTick'); await turn();
    }
  };
  t.after(() => body.close()); return { bot, body, tick, records };
}

test('a stalled real sensor archives only the incomplete measured motor window and releases its controls', async t => {
  const h = fixture(t); await h.tick(1); t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = h.body.execute({ kind: 'jump', parameters: { forward: false, holdTicks: 20 } });
  void pending.catch(() => {}); await h.tick(2); t.mock.timers.tick(10_000);
  await assert.rejects(pending, /real-frame timeout/);
  assert.equal(h.bot.controls.size, 0);
  const timeout = h.records.find(record => record.kind === 'body-frame-timeout')!.value;
  assert.equal(timeout.sequence, 3); assert(timeout.waitedMs >= 0); assert(timeout.frameSilenceMs >= 0);
  const partial = h.records.find(record => record.kind === 'body-incomplete-window')!.value;
  assert.equal(partial.complete, false); assert.equal(partial.physicalCalls, 1);
  assert.deepEqual(partial.frames.map((frame: { sequence: number }) => frame.sequence), [1, 2, 3]);
  assert.equal(partial.frames.at(-1).sequence, h.body.latest().sequence);
  assert(!h.records.some(record => record.kind === 'body-result'));
});

test('a held motor keeps its requested duration and returns ongoing motion without waiting for rest', async t => {
  const h = fixture(t); await h.tick(1);
  assert.equal(h.body.latest().self.properties.oxygen, 7);
  let finished = false;
  const pending = h.body.execute({ kind: 'jump', parameters: { forward: false, holdTicks: 20 } })
    .then(result => { finished = true; return result; });
  void pending.catch(() => {});
  await h.tick(24, true);
  assert(finished, 'ongoing motion must not keep the next controller action locked out');
  const { result, event } = await pending;
  assert.equal(h.bot.held, 20); assert.equal(h.bot.controls.size, 0);
  assert.equal(result.terminationReason, 'motor-released'); assert(event);
  assert(event.frames.at(-1)!.self.position[1] > event.frames[0]!.self.position[1] + 1.5);
  h.bot.emit('respawn'); await h.tick(1);
  assert.equal(h.body.latest().self.properties.oxygen, undefined, 'unmeasured oxygen is not a fabricated full tank');
  assert.throws(() => validateAction({ kind: 'jump', parameters: { forward: false, holdTicks: 0 } }), /hold-ticks/);
});

test('requested motor duration survives a synchronous physics catch-up batch', async t => {
  const cases = [
    { action: { kind: 'move', parameters: { direction: 'forward', ticks: 4 } }, ticks: 4, control: 'forward' },
    { action: { kind: 'jump', parameters: { forward: true, holdTicks: 20 } }, ticks: 20, control: 'jump' },
    { action: { kind: 'use-item', parameters: { holdTicks: 40 } }, ticks: 40, control: 'item' },
  ] as const;
  for (const entry of cases) await t.test(entry.action.kind, async t => {
    const h = fixture(t); await h.tick(1);
    const pending = h.body.execute(entry.action); void pending.catch(() => {});
    await h.tick(entry.ticks - 1);
    let additionalPressedTicks = 0;
    // Mineflayer can simulate up to four ticks in one synchronous timer turn.
    // Promise continuations cannot release a button between those callbacks.
    for (let i = 0; i < 4; i++) {
      if (entry.control === 'item' ? h.bot.usingHeldItem : h.bot.controls.get(entry.control)) additionalPressedTicks++;
      h.bot.emit('physicsTick');
    }
    assert.equal(additionalPressedTicks, 1, 'the final requested tick must synchronously release the motor');
    await turn(); await h.tick(12); const receipt = await pending;
    assert(receipt.event); validateEvent(receipt.event);
    assert.equal(h.bot.controls.size, 0); assert.equal(h.bot.usingHeldItem, false);
  });
});

test('the passive port returns exactly its measured interval without motor output or waiting for stability', async t => {
  const h = fixture(t); await h.tick(1); h.body.takePassiveEvents();
  const offer = h.body.listActionOffers().find(value => value.action.kind === 'passive'); assert(offer);
  const calls = h.body.physicalCalls, pending = h.body.execute(offer.action); void pending.catch(() => {});
  // Deliberately deliver a synchronous callback batch before its promise can
  // resume; later frames must not lengthen the chosen physical interval.
  for (let i = 0; i < 13; i++) { h.bot.entity.position.y -= .05; h.bot.emit('physicsTick'); }
  const { result, event } = await pending; assert(event); validateEvent(event);
  assert.equal(event.frames.length, 11); assert.equal(result.endSequence - result.startSequence, 10);
  assert.equal(result.terminationReason, 'interval-complete'); assert.equal(h.body.physicalCalls, calls);
  assert.equal(h.bot.controls.size, 0);
  const surplus = h.body.takePassiveEvents(); assert.equal(surplus.length, 1);
  validateEvent(surplus[0]!); assert.equal(surplus[0]!.cue.parameters.ticks, 3);
  assert.equal(surplus[0]!.frames[0]!.sequence, event.frames.at(-1)!.sequence);
  assert.throws(() => validateEvent({ ...event, cue: { ...event.cue, parameters: { ticks: 13 } } }), /passive-duration/);
});

test('death during a passive choice retains the short actual interval without completing its requested duration', async t => {
  const h = fixture(t); await h.tick(1); h.body.takePassiveEvents();
  const pending = h.body.execute({ kind: 'passive', parameters: { ticks: 10 } }); void pending.catch(() => {});
  await h.tick(2); h.bot.health = 0; h.bot.emit('death');
  const { result, event } = await pending;
  assert.equal(result.executed, false); assert.equal(result.terminationReason, 'body-interrupted'); assert.equal(event, null);
  const actual = h.body.takePassiveEvents(); assert.equal(actual.length, 1); validateEvent(actual[0]!);
  assert.equal(actual[0]!.cue.parameters.ticks, 3); assert.equal(actual[0]!.bodyResult, null);
  assert.equal(actual[0]!.frames.at(-1)!.self.properties.health, 0); assert.equal(h.bot.restarts, 0);
});

test('breathing comes only from owned metadata and becomes unknown at a body replacement', async t => {
  const h = fixture(t); await h.tick(1); assert.equal(h.body.latest().self.properties.oxygen, 7);
  h.bot.oxygenLevel = 0;
  h.bot._client.emit('entity_metadata', { entityId: 99, metadata: [{ key: 1, value: -20 }] });
  await h.tick(1); assert.equal(h.body.latest().self.properties.oxygen, 7,
    'a neighboring entity and the SDK aggregate cannot change the owned reading');
  h.bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value: 75 }] });
  await h.tick(1); assert.equal(h.body.latest().self.properties.oxygen, 5);
  assert.deepEqual(h.body.latest().bodySensation?.oxygen, { rawAir: 75, value: 5 });
  h.bot.emit('respawn'); await h.tick(1);
  assert.equal(h.body.latest().self.properties.oxygen, undefined);
  h.bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 0, value: 0 }] });
  await h.tick(1); assert.equal(h.body.latest().self.properties.oxygen, undefined,
    'an unrelated owned metadata field cannot restore a stale air reading');
  h.bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 1, value: 300 }] });
  await h.tick(1); assert.equal(h.body.latest().self.properties.oxygen, 20);
});

test('death exposes an explicit restart action and no SDK restart runs before it is chosen', async t => {
  const h = fixture(t), ready = h.body.ready(); await h.tick(4); await ready;
  h.bot.health = 0; h.bot.emit('death'); await h.tick(1);
  assert.equal(h.bot.restarts, 0);
  const offers = h.body.listActionOffers(); assert.deepEqual(offers.map(offer => offer.action), [{ kind: 'respawn', parameters: {} }]);
  const refused = await h.body.execute({ kind: 'move', parameters: { direction: 'forward', ticks: 4 } });
  assert.equal(refused.result.executed, false);
  const pending = h.body.execute(offers[0]!.action); void pending.catch(() => {}); await h.tick(12);
  const { result, event } = await pending;
  assert.equal(result.executed, true); assert.equal(h.bot.restarts, 1); assert(event);
  assert.equal(event.cue.kind, 'respawn'); assert.equal(event.frames[0]!.self.properties.health, 0);
  assert.equal(event.frames.at(-1)!.self.properties.health, 20);
  assert(!h.body.listActionOffers().some(offer => offer.action.kind === 'respawn'));
});

test('a death packet ends a physical window even when the SDK stops all subsequent physics ticks', async t => {
  const h = fixture(t); await h.tick(1);
  const pending = h.body.execute({ kind: 'jump', parameters: { forward: false, holdTicks: 20 } });
  void pending.catch(() => {}); await h.tick(2);
  h.bot.health = 0; h.bot.emit('death'); // No further physics ticks occur.
  const { result, event } = await pending;
  assert.equal(result.terminationReason, 'body-interrupted'); assert(event);
  assert.equal(event.frames.at(-1)!.self.properties.health, 0);
  assert.equal(h.body.listActionOffers()[0]!.action.kind, 'respawn');
  assert.equal(h.bot.restarts, 0); assert.equal(h.bot.controls.size, 0);
});

test('using the held item is a measured button window, with no supplied item effect or consumption helper', async t => {
  const h = fixture(t); await h.tick(1);
  const offer = h.body.listActionOffers().find(value => value.action.kind === 'use-item'); assert(offer);
  const pending = h.body.execute(offer.action); void pending.catch(() => {});
  await h.tick(20); assert(h.bot.usingHeldItem); assert.equal(h.bot.activations, 1); assert.equal(h.bot.releases, 0);
  await h.tick(24); const { result, event } = await pending;
  assert.equal(result.terminationReason, 'motor-released'); assert(event); assert.equal(h.bot.releases, 1);
  assert.equal(event.frames.at(-1)!.self.properties.food, event.frames[0]!.self.properties.food, 'a physical press does not invent a useful outcome');
});
