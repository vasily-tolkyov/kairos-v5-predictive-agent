import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { ActionOfferV1 } from '../src/control/contracts.js';
import { StageOneMovement, StageOneController, movementInputs } from '../src/stage-one-movement.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

const action: Action = { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
const frame = (sequence: number, depth = 4, z = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'synthetic-software-fixture', targetId: null, objects: [],
  self: { position: [0, 64, z], yaw: 0, pitch: 0, properties: { velocityX: 0, velocityY: 0, velocityZ: 0 } },
  sensation: { version: 'AnonymousRGBD1', width: 3, height: 2, horizontalFov: 1, verticalFov: 1, range: 8,
    samples: Array.from({ length: 6 }, () => [.5, .5, .5, depth]).flat() } });
function event(index: number, depth = 4, displacement = -.4): RealEvent {
  const frames = Array.from({ length: 5 }, (_, i) => frame(index * 8 + i + 1, depth, displacement * i / 4));
  const first = frames[0]!, last = frames.at(-1)!;
  const clock = (value: Observation) => ({ observationSequence: value.sequence, physicsTick: value.sequence,
    activeSeconds: value.activeSeconds, monotonicMs: value.sequence * 50 });
  return { version: 'RealEventV5', id: `stage-one-fixture:event-${index + 1}`, complete: true,
    provenance: 'executed-real-body', trackedIds: ['self'], frames, cue: cueFor(action, first),
    bodyResult: { action, executed: true, status: 'completed', startSequence: first.sequence, endSequence: last.sequence,
      terminationReason: 'stable', motorReceipt: { version: 'MotorReceiptV1', durationParameter: 'ticks', requestedTicks: 4,
        requestedAt: clock(first), pressedAt: clock(first), releasedAt: clock(last), pressSucceeded: true, releaseSucceeded: true,
        actualTicks: 4, actualSeconds: .2, elapsedMonotonicMs: 200, observedIntervals: 4,
        frameRange: { startSequence: first.sequence, endSequence: last.sequence }, releaseReason: 'interval-complete' } } };
}
const offer = (observation: Observation): ActionOfferV1 => ({ version: 'ActionOfferV1', offerId: 'synthetic-offer',
  observationSequence: observation.sequence, action, cue: cueFor(action, observation) });

test('stage-one inputs exclude coordinates, goal labels, engine identities and source clocks', () => {
  const original = frame(1), input = movementInputs(original);
  const changed: Observation = { ...original, sequence: 999, contextId: 'different-world', targetId: 'hidden-answer',
    self: { ...original.self, position: [999, 12, -50], properties: { ...original.self.properties, answer: 'move-right' } } };
  assert.deepEqual(movementInputs(changed), input); assert.equal(Object.keys(input).length, 8);
});

test('stage-one discovers different displacement from measured contexts with unchanged calibration rules', () => {
  const model = new StageOneMovement();
  assert.equal(model.predict(frame(1), offer(frame(1))).displacement, null);
  for (let i = 0; i < 96; i++) assert(model.observe(event(i, i % 2 ? 4 : .3, i % 2 ? -.4 : 0)).learned);
  const clear = model.predict(frame(1000, 4), offer(frame(1000, 4)));
  const blocked = model.predict(frame(1000, .3), offer(frame(1000, .3)));
  assert(clear.supported && blocked.supported); assert(Math.abs(clear.displacement![2] + .4) < 1e-10);
  assert(Math.hypot(...blocked.displacement!) < 1e-10);
  assert(clear.forward!.dependencies.some(key => key.startsWith('depth/')));
  const before = sha(model.snapshot()), restored = StageOneMovement.restore(model.snapshot());
  assert.deepEqual(restored.predict(frame(1000, 4), offer(frame(1000, 4))), clear);
  for (let i = 0; i < 10; i++) new StageOneController(model, i).choose(frame(1000, 4), [offer(frame(1000, 4))], [0, 64, -2]);
  assert.equal(sha(model.snapshot()), before, 'read/selection must leave frozen parameters exact');
  assert.equal(restored.observe(event(95, 4, -.4)).learned, false, 'restoration cannot manufacture a new original window');
  assert.throws(() => restored.observe(event(95, 4, -.1)), /conflict/);
});

test('stage-one refuses imagined frames and uninstrumented movement without granting writes', () => {
  const model = new StageOneMovement(), source = event(0), { motorReceipt: _receipt, ...body } = source.bodyResult!;
  assert.equal(model.observe({ ...source, bodyResult: body }).learned, false);
  assert.throws(() => model.observe({ ...source, frames: source.frames.map(value => ({ ...value, predictionSupport: [] })) }), /measured-frames/);
  assert.equal(model.writes, 0); assert.equal(model.snapshot().contexts.circuits.length, 0);
});

test('stage-one V2 identifies original archived bytes and conservatively rejects reordering an existing event', () => {
  const model = new StageOneMovement(), source = event(0), bytes = JSON.stringify(source);
  assert.equal(model.observe(source).sourceEventSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(model.observe(JSON.parse(bytes)).learned, false);
  const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as RealEvent;
  assert.throws(() => model.observe(reordered), /conflict/);
  assert.equal(model.writes, 1);
});
