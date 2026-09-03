import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftBody } from '../src/body.js';
import { eventRows } from '../src/events.js';
import type { Action } from '../src/contracts.js';
import type { ActionObservationScopeV1 } from '../src/control/contracts.js';

type PublicBlockFixture = {
  readonly name: string;
  readonly position: Vec3;
  readonly shapes: readonly number[][];
  face: number;
  intersect: Vec3;
  getProperties(): Readonly<Record<string, boolean>>;
};

/**
 * A transport-only replay of run-004's public ordering:
 *
 * 1. the button packet is sent;
 * 2. several unchanged ticks make the old body window look stable;
 * 3. the referenced door changes asynchronously;
 * 4. its rotated selection outline no longer intersects the ordinary fan.
 *
 * Production capture, execute, ActionObservationScope and event construction
 * are used unchanged.  No Minecraft outcome is fabricated by the test.
 */
class AsyncInteractBot extends EventEmitter {
  entity = { id: 1, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: true };
  entities = {};
  game = { dimension: 'overworld' };
  health = 20; food = 20; quickBarSlot = 0; heldItem = null;
  buttonPowered = false;
  doorOpen = false;
  doorFanVisible = true;
  interactionCalls = 0;
  readonly button: PublicBlockFixture = {
    name: 'stone_button', position: new Vec3(0, 65, -2), shapes: [], face: 3,
    intersect: new Vec3(.5, 65.5, -2), getProperties: () => ({ powered: this.buttonPowered }),
  };
  readonly door: PublicBlockFixture = {
    name: 'iron_door', position: new Vec3(-1, 64, -2), shapes: [[0, 0, 0, 1, 1, 1]], face: 3,
    intersect: new Vec3(-.5, 64.5, -2), getProperties: () => ({ open: this.doorOpen, powered: this.doorOpen }),
  };
  readonly air: PublicBlockFixture = {
    name: 'air', position: new Vec3(0, 0, 0), shapes: [], face: 0,
    intersect: new Vec3(0, 0, 0), getProperties: () => ({}),
  };
  world = {
    raycast: (_from: Vec3, ray: Vec3) => {
      // The exact forward ray binds the interaction target.  A left-hand fan
      // ray sees the closed door; after it opens its outline rotates away.
      if (Math.abs(ray.x) < .04) return this.button;
      if (ray.x < -.08 && this.doorFanVisible) return this.door;
      return null;
    },
  };
  _client = { write: (name: string) => {
    assert.equal(name, 'block_place'); this.interactionCalls++; this.buttonPowered = true;
  } };
  entityAtCursor(): null { return null; }
  blockAt(position: Vec3): PublicBlockFixture {
    if (position.equals(this.button.position)) return this.button;
    if (position.equals(this.door.position)) return this.door;
    return { ...this.air, position };
  }
  swingArm(): void {}
  clearControlStates(): void {}
  stopDigging(): void {}
  quit(): void {}
  targetDigBlock = null;
}

function fixture(t: TestContext) {
  const bot = new AsyncInteractBot();
  t.mock.method(mineflayer, 'createBot', () => bot as unknown as Bot);
  const records: { kind: string; value: unknown }[] = [];
  const body = new MinecraftBody({ host: '127.0.0.1', port: 1,
    username: 'async-interact-fixture', worldId: 'no-world-created',
    sessionId: 'run-004-ordering-replay' },
  (kind, value) => records.push({ kind, value }));
  bot.emit('physicsTick');
  const buttonId = 'block:0,65,-2', doorId = 'block:-1,64,-2';
  assert.equal(body.latest().targetId, buttonId);
  assert(body.latest().objects.some(object => object.id === doorId));
  const action: Action = { kind: 'interact', targetId: buttonId, parameters: {} };
  const scope: ActionObservationScopeV1 = {
    version: 'ActionObservationScopeV1', referencedPublicObjectIds: [doorId],
  };
  const tick = async (count: number) => {
    for (let i = 0; i < count; i++) { bot.emit('physicsTick'); await turn(); }
  };
  t.after(() => body.close());
  return { bot, body, records, action, scope, doorId, tick };
}

test('run-004 ordering stays inside one interact event until the scoped delayed result is stable', async t => {
  const h = fixture(t);
  const pending = h.body.execute(h.action, h.scope); void pending.catch(() => {});
  await h.tick(12);
  h.bot.doorOpen = true;
  h.bot.doorFanVisible = false;
  await h.tick(20);
  const { result, event } = await pending;

  assert.equal(result.executed, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.terminationReason, 'stable');
  assert(event);
  assert.equal(h.bot.interactionCalls, 1);
  assert.equal(h.body.physicalCalls, 1);
  assert(event.frames.some(frame => frame.objects.some(object =>
    object.id === h.doorId && object.properties.open === false)));
  assert(event.frames.some(frame => frame.objects.some(object =>
    object.id === h.doorId && object.properties.open === true)));
  assert(eventRows(event).changes.flat().some(change => change.property === 'open'
    && change.before === false && change.after === true));
  assert.equal(event.frames.at(-1)!.objects.find(object => object.id === h.doorId)?.properties.open, true);

  // The current grounded scope remains a public continuity binding after the
  // action.  Opening rotated the outline out of the ordinary fan, but did not
  // put the already-public, unobstructed block behind a wall.
  await h.tick(20);
  assert.equal(h.body.latest().objects.find(object => object.id === h.doorId)?.properties.open, true);
  assert.equal(h.records.filter(record => record.kind === 'body-result').length, 1);
});

test('an interact with no scoped result completes its bounded no-effect window and remains learnable', async t => {
  const h = fixture(t);
  const pending = h.body.execute(h.action, h.scope); void pending.catch(() => {});
  await h.tick(84);
  const { result, event } = await pending;

  assert.equal(result.executed, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.terminationReason, 'no-effect-window-complete');
  assert(event);
  assert.equal(h.bot.interactionCalls, 1);
  assert.equal(h.body.physicalCalls, 1);
  assert(event.frames.length >= 83);
  assert(event.trackedIds.includes(h.doorId));
  assert(event.frames.every(frame => frame.objects.find(object =>
    object.id === h.doorId)?.properties.open === false));
  assert(!eventRows(event).changes.flat().some(change => change.subject.startsWith('iron_door#')
    && change.property === 'open'));
});
