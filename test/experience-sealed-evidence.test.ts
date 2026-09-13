import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, RealEvent } from '../src/contracts.js';
import { actualEventDigest, sealRealEvent } from '../src/experience-sealed-evidence.js';
import { sealRealObservation } from '../src/experience-live-state.js';
import { ExperienceFrameFlow } from '../src/experience-frame-flow.js';
import { validateExperienceLiveTrace } from '../src/experience-timed-readout.js';
import { sha } from '../src/util.js';

const frame = (sequence: number): Observation => ({ sequence, activeSeconds: sequence * .05,
  contextId: 'test-only', targetId: null, objects: [],
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { heat: 2 } },
  physicalClock: { version: 'RealFrameClockV1', physicsTick: sequence, secondsPerTick: .05,
    monotonicMs: sequence * 50, sample: 'physics' } });
const event = (): RealEvent => ({ version: 'RealEventV5', id: 'test:event-1', complete: true,
  provenance: 'observed-passive', bodyResult: null, trackedIds: ['self'],
  cue: { kind: 'passive', targetRole: null, parameters: { ticks: 1 } }, frames: [frame(1), frame(2)] });

test('sealed original digest equals uncached canonical digest and freezes nested data', () => {
  const value = event(), expected = sha(value);
  assert.equal(sealRealEvent(value), expected); assert.equal(actualEventDigest(value), expected);
  assert.throws(() => Object.assign(value.frames[0]!.self.properties, { heat: 3 }), TypeError);
  assert.throws(() => Object.assign(value.cue.parameters, { ticks: 2 }), TypeError);
  assert.equal(actualEventDigest(value), sha(value));
});

test('mutable clone with an identical event ID never inherits a cached digest or source trace', () => {
  const value = event(), trace = new ExperienceFrameFlow().window(value)!;
  const clone = structuredClone(value), before = actualEventDigest(clone);
  Object.assign(clone.frames[0]!.self.properties, { heat: 3 });
  assert.notEqual(actualEventDigest(clone), before);
  assert.throws(() => validateExperienceLiveTrace(clone, trace), /live-trace-source-mismatch/);
  const forged = structuredClone(trace);
  assert.throws(() => validateExperienceLiveTrace(value, forged), /unowned-or-conflicting-live-trace/);
});

test('shallow-frozen input has its mutable descendants validated and frozen', () => {
  const value = Object.freeze(event());
  assert(!Object.isFrozen(value.frames[0]!.self.properties));
  sealRealEvent(value);
  assert(Object.isFrozen(value.frames[0]!.self.properties));
  const invalid = event(); Object.assign(invalid, { complete: false }); Object.freeze(invalid);
  assert.throws(() => sealRealEvent(invalid), /incomplete-real-event/);
});

test('accessors, custom serializers and cycles cannot enter a reusable evidence cache', () => {
  const accessor = frame(1);
  Object.defineProperty(accessor, 'extra', { enumerable: true, get: () => Math.random() });
  assert.throws(() => sealRealObservation(accessor), /non-data-real-evidence/);
  const custom = event(); Object.assign(custom, { toJSON: () => ({ altered: true }) });
  assert.throws(() => sealRealEvent(custom), /non-data-real-evidence/);
  const cyclic = event(); Object.assign(cyclic, { cycle: cyclic });
  assert.throws(() => sealRealEvent(cyclic), /cyclic-real-evidence/);
});

test('imagined or invalid real receptors are rejected before caching an event', () => {
  const imagined = event(); Object.assign(imagined.frames[0]!, { predictionSupport: [] });
  assert.throws(() => sealRealEvent(imagined), /imagined-frame-cannot-enter-live-state/);
  const invalid = event(); Object.assign(invalid.frames[0]!.self.properties, { heat: NaN });
  assert.throws(() => sealRealEvent(invalid), /invalid-live-channel-value/);
});
