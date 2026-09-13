import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
import { setImmediate as turn } from 'node:timers/promises';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftBody } from '../src/body.js';
import { validateAction } from '../src/action-contract.js';
import { validateEvent } from '../src/events.js';
import * as eventTools from '../src/events.js';
import type { MotorReceiptV1, RealEvent } from '../src/contracts.js';
import { MinecraftActionStartProtocol } from '../src/adapters/minecraft/action-start.js';

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

test('a bounded next-frame wait returns a copied real successor and removes its listeners', async t => {
  const h = fixture(t); await h.tick(1);
  const listeners = { frame: h.body.listenerCount('frame'), fault: h.body.listenerCount('fault') };
  const waiting = h.body.waitForObservationAfter(1, { timeoutMs: 50 });
  assert.equal(h.body.listenerCount('frame'), listeners.frame + 1);
  assert.equal(h.body.listenerCount('fault'), listeners.fault + 1);
  await h.tick(1); const observed = await waiting; assert(observed);
  assert.equal(observed.sequence, 2); assert.deepEqual(observed, h.body.latest());
  assert.notStrictEqual(observed, h.body.latest());
  assert.equal(h.body.listenerCount('frame'), listeners.frame);
  assert.equal(h.body.listenerCount('fault'), listeners.fault);
  await h.tick(1); assert.equal(h.body.latest().sequence, 3);
  assert.deepEqual(await h.body.waitForObservationAfter(1, { timeoutMs: 50 }), h.body.latest());
});

test('a bounded silent-clock wait expires without fabricating a frame and removes its listeners', async t => {
  const h = fixture(t); await h.tick(1); t.mock.timers.enable({ apis: ['setTimeout'] });
  const listeners = { frame: h.body.listenerCount('frame'), fault: h.body.listenerCount('fault') };
  let finished = false;
  const waiting = h.body.waitForObservationAfter(1, { timeoutMs: 50 }).then(value => { finished = true; return value; });
  t.mock.timers.tick(49); await Promise.resolve(); assert.equal(finished, false);
  t.mock.timers.tick(1); assert.equal(await waiting, null); assert.equal(h.body.latest().sequence, 1);
  assert.equal(h.body.listenerCount('frame'), listeners.frame);
  assert.equal(h.body.listenerCount('fault'), listeners.fault);
  assert.equal(h.body.physicalCalls, 0);
});

test('aborted, faulted and closed observation waits settle once and release listeners', async t => {
  for (const reason of ['abort', 'fault', 'close'] as const) await t.test(reason, async t => {
    const h = fixture(t); await h.tick(1);
    const listeners = { frame: h.body.listenerCount('frame'), fault: h.body.listenerCount('fault') };
    const controller = new AbortController();
    const waiting = h.body.waitForObservationAfter(1, { timeoutMs: 50, signal: controller.signal });
    const failure = assert.rejects(waiting, reason === 'abort' ? /cancel-test/ : reason === 'fault' ? /wait-fault/ : /body-closed/);
    if (reason === 'abort') controller.abort(new Error('cancel-test'));
    else if (reason === 'fault') h.bot.emit('error', new Error('wait-fault'));
    else await h.body.close();
    await failure;
    assert.equal(h.body.listenerCount('frame'), listeners.frame);
    assert.equal(h.body.listenerCount('fault'), listeners.fault);
    if (reason === 'abort') await assert.rejects(h.body.waitForObservationAfter(0, { timeoutMs: 50, signal: controller.signal }), /cancel-test/);
    if (reason === 'close') await assert.rejects(h.body.waitForObservationAfter(0), /body-closed/);
  });
});

test('pending preparation cancellation preserves measured passive evidence with no token or motor', async t => {
  const h = fixture(t); await h.tick(1); h.body.startObservation(); await h.tick(1);
  const records: unknown[] = [], starts = new MinecraftActionStartProtocol(h.body, value => records.push(value));
  const listeners = { frame: h.body.listenerCount('frame'), fault: h.body.listenerCount('fault') };
  const pending = starts.prepareActionStart();
  const cancelled = assert.rejects(pending, /preparation-body-closed/);
  assert.throws(() => starts.startObservation(), /during-preparation/);
  await assert.rejects(starts.executePrepared('unknown', { kind: 'respawn', parameters: {} }), /preparing-action-start/);
  starts.invalidate('body-closed'); await cancelled;
  assert.equal(records.length, 0); assert.equal(h.body.physicalCalls, 0);
  assert.equal(h.body.listenerCount('frame'), listeners.frame);
  assert.equal(h.body.listenerCount('fault'), listeners.fault);
  assert.deepEqual(starts.drainPassiveEvents().flatMap(event => event.frames.map(value => value.sequence)), [1, 2]);
  assert.deepEqual(starts.drainPassiveEvents(), []);
});

test('superseding a pending frame wait cancels it without stealing the succeeding preparation interval', async t => {
  const h = fixture(t); await h.tick(1); h.body.startObservation();
  const starts = new MinecraftActionStartProtocol(h.body), first = starts.prepareActionStart();
  const superseded = assert.rejects(first, /preparation-superseded/);
  const second = starts.prepareActionStart(); await superseded;
  assert.equal(h.body.listenerCount('frame'), 1); assert.equal(h.body.listenerCount('fault'), 1);
  await h.tick(1); const prepared = await second;
  assert.equal(prepared.observation.sequence, 2);
  assert.deepEqual(prepared.precedingPassiveEvents.flatMap(event => event.frames.map(value => value.sequence)), [1, 2]);
  assert.equal(h.body.listenerCount('frame'), 0); assert.equal(h.body.listenerCount('fault'), 0);
  starts.cancelActionStart(prepared.token, 'test-end'); assert.equal(h.body.physicalCalls, 0);
});

test('a dead body with no further clock ticks can prepare and execute its explicitly chosen restart after one timeout', async t => {
  const h = fixture(t), ready = h.body.ready(); await h.tick(4); await ready;
  h.bot.health = 0; h.bot.emit('death');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starts = new MinecraftActionStartProtocol(h.body), pending = starts.prepareActionStart();
  const before = h.body.latest(); t.mock.timers.tick(50); const prepared = await pending;
  assert.strictEqual(prepared.observation, before); assert.equal(h.bot.restarts, 0);
  const restart = h.body.listActionOffers()[0]!;
  const execution = starts.executePrepared(prepared.token, restart.action);
  await h.tick(12); const receipt = await execution;
  assert.equal(receipt.result.executed, true); assert.equal(h.bot.restarts, 1);
  assert.equal(receipt.event?.frames[0]!.self.properties.health, 0);
  assert.equal(receipt.actionStartReceipt.preparationWait?.outcome, 'timeout');
  assert.equal(receipt.actionStartReceipt.preparationWait?.observedSequence, null);
  assert.equal(receipt.actionStartReceipt.preparationWait?.waitAttempts, 1);
});

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

function actualReceipt(event: RealEvent): MotorReceiptV1 {
  const receipt = event.bodyResult?.motorReceipt;
  assert(receipt, 'body result must retain its measured motor receipt');
  assert.equal(receipt.version, 'MotorReceiptV1'); return receipt;
}
function actualCue(event: RealEvent) {
  const helper = (eventTools as unknown as { measuredMotorCueV1?: (event: RealEvent) => RealEvent['cue'] | null }).measuredMotorCueV1;
  assert(helper, 'the learning boundary must expose an actual-duration cue'); return helper(event);
}

test('motor receipts retain real clocks and release frames before a catch-up continuation', async t => {
  const h = fixture(t); await h.tick(1);
  const action = { kind: 'jump', parameters: { forward: true, holdTicks: 4 } } as const;
  const pending = h.body.execute(action); void pending.catch(() => {});
  for (let i = 0; i < 9; i++) h.bot.emit('physicsTick');
  await turn(); await h.tick(3);
  const { event } = await pending; assert(event); validateEvent(event);
  const receipt = actualReceipt(event);
  assert.equal(receipt.requestedTicks, 4); assert.equal(receipt.actualTicks, 4);
  assert.equal(receipt.actualSeconds, .2); assert.equal(receipt.observedIntervals, 4);
  assert.equal(receipt.pressedAt.observationSequence, 1); assert.equal(receipt.releasedAt.observationSequence, 5);
  assert(event.frames.at(-1)!.sequence > receipt.releasedAt.observationSequence);
  assert(receipt.requestedAt.monotonicMs <= receipt.pressedAt.monotonicMs);
  assert(receipt.releasedAt.monotonicMs >= receipt.pressedAt.monotonicMs);
  assert.equal(receipt.elapsedMonotonicMs, receipt.releasedAt.monotonicMs - receipt.pressedAt.monotonicMs);
  assert.equal(receipt.releasedAt.activeSeconds, event.frames[4]!.activeSeconds);
  assert.deepEqual(receipt.frameRange, { startSequence: 1, endSequence: 5 });
  assert.equal(receipt.releaseReason, 'interval-complete');
  assert.equal(receipt.pressSucceeded, true); assert.equal(receipt.releaseSucceeded, true);
  assert(!Object.hasOwn(receipt, 'action')); assert(!JSON.stringify(receipt).includes('targetId'));
  assert.deepEqual(event.bodyResult!.action, action); assert.deepEqual(actualCue(event), event.cue);
  assert.equal(h.records.filter(record => record.kind === 'body-motor-receipt').length, 1);
});

test('death records actual physical duration without rewriting the requested action or terminal sample', async t => {
  const h = fixture(t); await h.tick(1);
  const action = { kind: 'use-item', parameters: { holdTicks: 20 } } as const;
  const pending = h.body.execute(action); void pending.catch(() => {});
  await h.tick(2); h.bot.health = 0; h.bot.emit('death');
  const { event } = await pending; assert(event); validateEvent(event);
  const receipt = actualReceipt(event);
  assert.equal(receipt.requestedTicks, 20); assert.equal(receipt.actualTicks, 2);
  assert.equal(receipt.observedIntervals, 3, 'the terminal death sample is a frame, not a physical tick');
  assert.equal(receipt.releaseReason, 'death'); assert.equal(h.bot.releases, 1);
  assert.deepEqual(event.bodyResult!.action, action); assert.equal(event.cue.parameters.holdTicks, 20);
  assert.equal(actualCue(event)?.parameters.holdTicks, 2);
  const legacy = structuredClone(event); delete (legacy.bodyResult as { motorReceipt?: MotorReceiptV1 }).motorReceipt;
  validateEvent(legacy); assert.deepEqual(actualCue(legacy), legacy.cue);
  assert.equal(legacy.bodyResult?.motorReceipt, undefined, 'legacy reads cannot invent historical instrumentation');
});

test('zero-tick death cannot be learned as a completed positive motor interval', async t => {
  const h = fixture(t); await h.tick(1);
  const pending = h.body.execute({ kind: 'use-item', parameters: { holdTicks: 20 } }); void pending.catch(() => {});
  h.bot.health = 0; h.bot.emit('death');
  const { event } = await pending; assert(event); validateEvent(event);
  assert.equal(actualReceipt(event).actualTicks, 0); assert.equal(actualCue(event), null);
});

test('invalid or inconsistent motor receipts are rejected at the real-event boundary', async t => {
  const h = fixture(t); await h.tick(1);
  const pending = h.body.execute({ kind: 'jump', parameters: { forward: false, holdTicks: 4 } }); void pending.catch(() => {});
  await h.tick(8); const { event } = await pending; assert(event);
  const receipt = actualReceipt(event); validateEvent(event);
  const variants: unknown[] = [
    { ...receipt, version: 'MotorReceiptV0' }, { ...receipt, actualTicks: -1 },
    { ...receipt, actualTicks: receipt.actualTicks + 1 }, { ...receipt, actualSeconds: 99 },
    { ...receipt, requestedTicks: 5 }, { ...receipt, durationParameter: 'ticks' },
    { ...receipt, elapsedMonotonicMs: Number.NaN }, { ...receipt, releaseSucceeded: false },
    { ...receipt, requestedAt: { ...receipt.requestedAt, observationSequence: 0 } },
    { ...receipt, pressedAt: { ...receipt.pressedAt, activeSeconds: 100 } },
    { ...receipt, releasedAt: { ...receipt.releasedAt, monotonicMs: receipt.pressedAt.monotonicMs - 1 } },
    { ...receipt, frameRange: { ...receipt.frameRange, endSequence: event.frames.at(-1)!.sequence + 1 } },
  ];
  for (const invalid of variants) assert.throws(() => validateEvent({ ...event,
    bodyResult: { ...event.bodyResult!, motorReceipt: invalid as MotorReceiptV1 } }), /motor-receipt/);
});

test('fault, close and timeout archive one actual release receipt without completing an event', async t => {
  for (const reason of ['fault', 'closed', 'timeout'] as const) await t.test(reason, async t => {
    const h = fixture(t); await h.tick(1);
    if (reason === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = h.body.execute({ kind: 'use-item', parameters: { holdTicks: 20 } }); void pending.catch(() => {});
    await h.tick(2);
    if (reason === 'fault') h.bot.emit('error', new Error('injected motor fault'));
    else if (reason === 'closed') await h.body.close();
    else t.mock.timers.tick(10_000);
    await assert.rejects(pending);
    assert.equal(h.bot.releases, 1); assert.equal(h.bot.usingHeldItem, false);
    const partial = h.records.find(record => record.kind === 'body-incomplete-window')!.value;
    assert.equal(partial.motorReceipt?.version, 'MotorReceiptV1');
    assert.equal(partial.motorReceipt.releaseReason, reason); assert.equal(partial.motorReceipt.actualTicks, 2);
    assert.equal(h.records.filter(record => record.kind === 'body-motor-receipt').length, 1);
    assert(!h.records.some(record => record.kind === 'body-result'));
  });
});
