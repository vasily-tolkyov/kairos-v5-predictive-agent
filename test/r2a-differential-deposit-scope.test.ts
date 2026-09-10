import assert from 'node:assert/strict';
import test from 'node:test';
import { distributedR2ADifferentialEpisodeV1, DistributedR2APhysicalPatternLearnerV2,
  DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5 }
  from '../src/core/learning/distributed-r2a-physical.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';

const pulse = (start: number) => Array.from({ length: 8 }, (_, i) => ({ siteId: start + i, intensity: 1 }));

test('a condition difference does not re-deposit the shared road or exact common action', () => {
  const factor = pulse(0), prefix = [pulse(1024)], action = pulse(2048), terminal = pulse(3072);
  const episode = distributedR2ADifferentialEpisodeV1('difference', factor, terminal);
  assert.deepEqual(episode.pulses.map(p => p.drives), [factor, terminal]);
  const medium = new DistributedPhysicalMedium3DV1({ name: 'anonymous-difference-scope' });
  const before = [...prefix.flat(), ...action].map(p => medium.site(p.siteId));
  medium.applyEpisode(episode);
  assert.deepEqual([...prefix.flat(), ...action].map(p => medium.site(p.siteId)), before);
  assert(medium.snapshot().learnedBonds.filter(b => b.directedConductance > 0)
    .every(b => factor.some(p => p.siteId === b.fromSiteId) && terminal.some(p => p.siteId === b.toSiteId)));
});

test('differential traces keep actual amplitudes and never insert a labelled target population', () => {
  const factor = pulse(0).map(p => ({ ...p, intensity: .5 }));
  const terminal = pulse(3072).map(p => ({ ...p, intensity: .75 }));
  const a = distributedR2ADifferentialEpisodeV1('opaque-a', factor, terminal);
  const b = distributedR2ADifferentialEpisodeV1('opaque-b', factor, terminal);
  assert.deepEqual(a.pulses.map(p => p.drives), b.pulses.map(p => p.drives));
  assert.deepEqual(a.pulses[0]!.drives, factor);
  assert.deepEqual(a.pulses.at(-1)!.drives, terminal);
  assert.deepEqual(a.temporalEligibility, [{ fromPulseIndex: 0, toPulseIndex: 1, strength: 1 }]);
});

test('the serialized physical index records the same current algorithm identity that callers see', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  assert.equal(learner.snapshot().physicalIndexIdentity.algorithmIdentity,
    DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5);
});
