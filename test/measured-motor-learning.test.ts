import assert from 'node:assert/strict';
import test from 'node:test';
import type { Action, MotorReceiptV1, Observation, RealEvent } from '../src/contracts.js';
import { ExperienceMedium, motorIdentity } from '../src/experience-medium.js';
import { cueFor } from '../src/events.js';
import { sha } from '../src/util.js';

const requested: Action = { kind: 'jump', parameters: { forward: false, holdTicks: 20 } };
const frame = (sequence: number, z = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'measured-motor-apparatus', targetId: null, objects: [],
  self: { position: [0, 0, z], yaw: 0, pitch: 0, properties: { health: 20 } } });
function interrupted(index: number, actualTicks = 2): RealEvent {
  const start = index * 8 + 1;
  // A terminal health sample is a real frame, but not another physics step.
  const frames = Array.from({ length: actualTicks + 2 }, (_, i) => frame(start + i, -.1 * Math.min(i, actualTicks)));
  frames[frames.length - 1] = { ...frames.at(-1)!, self: { ...frames.at(-1)!.self, properties: { health: 0 } } };
  const first = frames[0]!, last = frames.at(-1)!;
  const pressedAt = { observationSequence: first.sequence, physicsTick: index * 8,
    activeSeconds: first.activeSeconds, monotonicMs: index * 1000 };
  const releasedAt = { observationSequence: last.sequence, physicsTick: pressedAt.physicsTick + actualTicks,
    activeSeconds: last.activeSeconds, monotonicMs: pressedAt.monotonicMs + actualTicks * 50 + 1 };
  const motorReceipt: MotorReceiptV1 = { version: 'MotorReceiptV1', durationParameter: 'holdTicks',
    requestedTicks: 20, requestedAt: pressedAt, pressedAt, releasedAt, pressSucceeded: true, releaseSucceeded: true,
    actualTicks, actualSeconds: actualTicks / 20, elapsedMonotonicMs: actualTicks * 50 + 1,
    observedIntervals: actualTicks + 1, frameRange: { startSequence: first.sequence, endSequence: last.sequence },
    releaseReason: 'death' };
  return { version: 'RealEventV5', id: `measured-duration:event-${index + 1}`, frames,
    cue: cueFor(requested, first), trackedIds: ['self'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: requested, executed: true, status: 'completed', startSequence: first.sequence,
      endSequence: last.sequence, terminationReason: 'body-interrupted', motorReceipt } };
}

test('interrupted measured presses train their actual duration without relabeling the original request', () => {
  const medium = new ExperienceMedium(71), events = Array.from({ length: 64 }, (_, i) => interrupted(i));
  const originals = events.map(sha);
  for (const event of events) assert(medium.observe(event).learned);
  const current = frame(1000), fullCue = cueFor(requested, current);
  const shortCue = { ...fullCue, parameters: { ...fullCue.parameters, holdTicks: 2 } };
  const before = sha(medium.snapshot());
  assert.equal(medium.predict(fullCue, current).reason, 'unobserved-action',
    'a two-tick interruption cannot certify the requested twenty-tick response');
  const prediction = medium.predict(shortCue, current);
  assert(prediction.supportedFields.includes('self/position.2'), 'the measured short response remains learnable');
  assert(Math.abs(prediction.observation!.self.position[2] + .2) < 1e-9);
  assert(medium.snapshot().networks.some(([id]) => id === motorIdentity(shortCue) + '/self'));
  assert.equal(sha(medium.snapshot()), before, 'queries do not add duration evidence');
  assert.deepEqual(events.map(sha), originals, 'raw cue, action, window and receipt are immutable');
  const restored = ExperienceMedium.restore(medium.snapshot());
  assert.deepEqual(restored.predict(shortCue, current), prediction);
  assert.equal(restored.predict(fullCue, current).reason, 'unobserved-action');
  assert.equal(restored.observe(events.at(-1)!).learned, false);
});

test('a press with no measured physics interval is retained by identity without creating an action effect', () => {
  const medium = new ExperienceMedium(71), event = interrupted(0, 0);
  const result = medium.observe(event);
  assert.equal(result.learned, false); assert.equal(result.writes, 0);
  assert.equal(result.skipped, 'no-measured-motor-interval');
  assert.equal(medium.snapshot().networks.length, 0);
  assert.equal(medium.snapshot().untrainedMotorWindows, 1);
  const restored = ExperienceMedium.restore(medium.snapshot());
  assert.equal(restored.observe(event).skipped, 'duplicate');
  assert.equal(restored.writes, 0);
  assert.throws(() => ExperienceMedium.restore({ ...medium.snapshot(), untrainedMotorWindows: undefined }),
    /invalid-populations/, 'ledger exposures cannot masquerade as training writes');
});

test('legacy windows remain readable without manufacturing measured motor receipts', () => {
  const medium = new ExperienceMedium(71), original = interrupted(0);
  const { motorReceipt: _receipt, ...bodyResult } = original.bodyResult!;
  const event: RealEvent = { ...original, bodyResult };
  assert(medium.observe(event).learned);
  assert(medium.snapshot().networks.some(([id]) => id === motorIdentity(event.cue) + '/self'));
  assert.equal(event.bodyResult!.motorReceipt, undefined);
});
