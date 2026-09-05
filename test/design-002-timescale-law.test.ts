import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceArousalV1,
  effectiveRecoveryRateV1,
  encodingGainV1,
  homeostaticDownscaleV1,
  measuredSalienceV1,
  memoryTimescaleLawConfigV1,
  type MeasuredSalienceV1,
} from '../src/core/learning/memory-timescales.js';

const neutral: MeasuredSalienceV1 = {
  version: 'MeasuredSalienceV1', surpriseMagnitude: 0, goalRelevance: 0,
  supportMass: 0, rehearsalCount: 0,
};

test('salience is continuous and measured, with a monotone slower recovery law', () => {
  const config = memoryTimescaleLawConfigV1();
  const low = measuredSalienceV1({ ...neutral, surpriseMagnitude: 0.1 }, config);
  const high = measuredSalienceV1({ ...neutral, surpriseMagnitude: 2 }, config);
  assert.ok(low > 0 && low < high && high < 1);
  assert.ok(effectiveRecoveryRateV1({ ...neutral, surpriseMagnitude: 0.1 }, config)
    > effectiveRecoveryRateV1({ ...neutral, surpriseMagnitude: 2 }, config));
  assert.equal(effectiveRecoveryRateV1(neutral, config), config.baseRecoveryRate);
});

test('arousal is an autonomous decaying state driven only by measured surprise flux', () => {
  const config = memoryTimescaleLawConfigV1();
  const initial = { version: 'MediumArousalStateV1' as const, arousal: 0, logicalTime: 0 };
  const excited = advanceArousalV1(initial, 1, 0, config);
  assert.equal(excited.logicalTime, 0);
  assert.ok(excited.arousal > 0 && excited.arousal <= 1);
  const decayed = advanceArousalV1(excited, 0, 10, config);
  assert.ok(decayed.arousal < excited.arousal);
  assert.equal(decayed.logicalTime, 10);
  assert.ok(encodingGainV1(excited.arousal, config) > encodingGainV1(0, config));
});

test('homeostatic downscale preserves ordering and never changes evidence inputs', () => {
  const values = [4, 2, 0];
  const scaled = homeostaticDownscaleV1(values);
  assert.deepEqual(scaled, values.map(value => value * 0.995));
  assert.ok(scaled[0]! > scaled[1]! && scaled[1]! > scaled[2]!);
});

test('the law rejects caller attempts to alter frozen constants or weights', () => {
  const config = memoryTimescaleLawConfigV1();
  assert.throws(() => effectiveRecoveryRateV1(neutral,
    { ...config, baseRecoveryRate: 0.1 } as unknown as typeof config),
    /identity is frozen/);
  assert.throws(() => measuredSalienceV1(neutral, { ...config, surpriseWeight: 0.5 }),
    /identity is frozen/);
  assert.throws(() => measuredSalienceV1(neutral,
    { ...config, minimumRecoveryFactor: 0.9 } as typeof config), /identity is frozen/);
  assert.throws(() => advanceArousalV1(
    { version: 'MediumArousalStateV1', arousal: Number.NaN, logicalTime: 0 }, 0, 0, config),
  /arousal state/);
});
