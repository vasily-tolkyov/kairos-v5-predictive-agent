import assert from 'node:assert/strict';
import test from 'node:test';
import { AttentivePerception, perceptualObjects, type VisualSensation } from '../src/perception.js';
import type { Observation } from '../src/contracts.js';

const observation = (sequence: number, z = 0): Observation => ({ sequence, activeSeconds: sequence / 20,
  contextId: 'test', targetId: null, self: { position: [0, 0, z], yaw: 0, pitch: 0, properties: {} }, objects: [] });

test('clutter cannot evict a small surface at the actual gaze from bounded perception', () => {
  const width = 85, height = 55, samples: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const central = x >= 42 && x <= 43 && y >= 27 && y <= 28;
    const surround = Math.abs(x - 42) > 5 || Math.abs(y - 27) > 5;
    const visible = central || surround && x % 6 < 3 && y % 6 < 3;
    const depth = visible ? 2 / Math.cos((.5 - x / (width - 1)) * 1.4) / Math.cos((.5 - y / (height - 1)) * 1.08) : -1;
    samples.push(central ? .8 : .3, .2, .2, depth);
  }
  const frame = new AttentivePerception().observe(observation(1), { version: 'AnonymousRGBD1', width, height,
    horizontalFov: 1.4, verticalFov: 1.08, range: 8, samples });
  assert(frame.groups > 32, 'the apparatus must actually exceed the capacity');
  assert(frame.gazeId, 'visible central evidence was discarded by peripheral clutter');
  assert(frame.tracks.length <= 64);
  assert.equal(frame.tracks.find(track => track.id === frame.gazeId)!.color[0], .8);
});
function patch(depth: number, red = .4, centers = [4]): VisualSensation {
  const samples: number[] = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const visible = y >= 3 && y <= 5 && centers.some(center => Math.abs(x - center) <= 1);
    samples.push(red, .2, .2, visible ? depth : -1);
  }
  return { version: 'AnonymousRGBD1', width: 9, height: 9, horizontalFov: 1.2, verticalFov: 1.2,
    range: 8, samples };
}
test('groups raw samples and preserves identity under measured observer motion', () => {
  const sensor = new AttentivePerception(), first = sensor.observe(observation(1), patch(3));
  assert.equal(first.groups, 1); assert.equal(first.receptors, 9);
  const next = sensor.observe(observation(2, -.1), patch(2.9));
  assert.equal(next.gazeId, first.gazeId); assert.equal(next.tracks[0]!.age, 2);
  assert.equal(perceptualObjects(next)[0]!.type, 'percept');
  assert(!JSON.stringify(next).includes('block:'));
});
test('a checkpoint preserves temporal correspondence, attention and a shared boundary frame exactly', () => {
  const continuous = new AttentivePerception();
  continuous.observe(observation(1), patch(3)); continuous.observe(observation(2, -.1), patch(2.9));
  const checkpoint = JSON.parse(JSON.stringify(continuous.snapshot())), resumed = AttentivePerception.restore(checkpoint);
  assert.deepEqual(resumed.observe(observation(2, -.1), patch(2.9)), continuous.observe(observation(2, -.1), patch(2.9)));
  for (const [sequence, depth] of [[3, -1], [4, 2.8], [5, 3.1]])
    assert.deepEqual(resumed.observe(observation(sequence!, -.2), patch(depth!)), continuous.observe(observation(sequence!, -.2), patch(depth!)));
  assert.deepEqual(resumed.snapshot(), continuous.snapshot());
  assert.throws(() => AttentivePerception.restore({ ...checkpoint, serial: -1 }), /invalid-perception-checkpoint/);
});
test('occlusion is unknown and reappearance refreshes actual properties', () => {
  const sensor = new AttentivePerception(), first = sensor.observe(observation(1), patch(3));
  const occluded = sensor.observe(observation(2), patch(-1));
  assert.equal(occluded.tracks[0]!.visible, false); assert.equal(perceptualObjects(occluded).length, 0);
  const returned = sensor.observe(observation(3), patch(3, .5));
  assert.equal(returned.gazeId, first.gazeId);
  assert.equal(perceptualObjects(returned)[0]!.properties.red, .5);
});
test('same appearance does not collapse separated surfaces to one identity', () => {
  const sensor = new AttentivePerception(), seen = sensor.observe(observation(1), patch(3, .4, [1, 7]));
  assert.equal(seen.groups, 2);
  assert.equal(new Set(perceptualObjects(seen).map(o => o.id)).size, 2);
});
test('revealing another part of a surface does not move its tracked anchor', () => {
  const plane = (center: number, distance = 3): VisualSensation => {
    const visual = patch(distance, .4, [center]), samples = [...visual.samples];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const i = (y * 9 + x) * 4 + 3;
      if (samples[i]! >= 0) samples[i] = distance / (Math.cos((.5 - x / 8) * 1.2) * Math.cos((.5 - y / 8) * 1.2));
    }
    return { ...visual, samples };
  };
  const sensor = new AttentivePerception(), first = sensor.observe(observation(1), plane(4));
  const revealed = sensor.observe(observation(2), plane(5));
  assert.equal(revealed.tracks[0]!.id, first.tracks[0]!.id);
  assert(Math.hypot(...revealed.tracks[0]!.position.map((v, i) => v - first.tracks[0]!.position[i]!)) < .05);
  const moved = sensor.observe(observation(3), plane(5, 3.15));
  assert(Math.abs(moved.tracks[0]!.position[2] - first.tracks[0]!.position[2] + .15) < .03);
});
test('invalid sensations and backwards time are rejected', () => {
  const sensor = new AttentivePerception(); sensor.observe(observation(10), patch(3));
  assert.throws(() => sensor.observe(observation(9), patch(3)), /observation-order/);
  assert.throws(() => sensor.observe(observation(11), { ...patch(3), samples: [NaN] }), /invalid-anonymous/);
});
test('a boundaryless plane does not supply tangential motion evidence', () => {
  const visual = patch(3), samples: number[] = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) samples.push(.4, .2, .2,
    3 / (Math.cos((.5 - x / 8) * 1.2) * Math.cos((.5 - y / 8) * 1.2)));
  const frame = new AttentivePerception().observe(observation(1), { ...visual, samples });
  assert.equal(frame.groups, 1);
  assert.deepEqual(frame.tracks[0]!.motionEvidence, [true, false, false]);
});

test('repeated observer motion cannot integrate unmeasured plane sliding into a visible object position', () => {
  const visual = patch(3), samples: number[] = [], sensor = new AttentivePerception();
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) samples.push(.4, .2, .2,
    3 / (Math.cos((.5 - x / 8) * 1.2) * Math.cos((.5 - y / 8) * 1.2)));
  let anchor: readonly number[] | null = null;
  for (let i = 0; i < 100; i++) {
    const input = observation(i + 1), height = i % 2 ? .14 : 0;
    const current = { ...input, self: { ...input.self, position: [0, height, 0] as const } };
    const frame = sensor.observe(current, { ...visual, samples }), track = frame.tracks[0]!;
    const world = track.position.map((value, axis) => value + current.self.position[axis]!);
    anchor ??= world;
    assert(Math.hypot(...world.map((value, axis) => value - anchor![axis]!)) < .01);
    assert.deepEqual(perceptualObjects(frame)[0]!.relativePosition, track.surface!.point);
  }
});
test('occluding borders do not become the hidden surface own boundaries', () => {
  const visual = patch(3);
  for (const foreground of [true, false]) {
    const samples: number[] = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const center = x >= 3 && x <= 5 && y >= 3 && y <= 5;
      const depth = (center === foreground ? 2 : 4)
        / (Math.cos((.5 - x / 8) * 1.2) * Math.cos((.5 - y / 8) * 1.2));
      samples.push(center ? .4 : .9, .2, .2, depth);
    }
    const seen = new AttentivePerception().observe(observation(1), { ...visual, samples });
    const center = seen.tracks.find(track => track.id === seen.gazeId)!;
    assert.deepEqual(center.motionEvidence, [true, foreground, foreground]);
  }
});
test('an oblique plane does not identify separate coordinate components', () => {
  const visual = patch(3), samples: number[] = [], input = observation(1);
  const rotated = { ...input, self: { ...input.self, yaw: .4 } };
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) samples.push(.4, .2, .2,
    3 / (Math.cos(.4 + (.5 - x / 8) * 1.2) * Math.cos((.5 - y / 8) * 1.2)));
  const seen = new AttentivePerception().observe(rotated, { ...visual, samples });
  assert.deepEqual(seen.tracks[0]!.motionEvidence, [false, false, false]);
});
