import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { DistributedMediumTimescaleAdapterV2 } from '../src/core/physics/distributed-medium-timescale-adapter-v2.js';

function adapter(): DistributedMediumTimescaleAdapterV2 {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'timescale-adapter', seedHex: '2203' });
  medium.applyPulse({ version: 'SparseFieldPulseV1', pulseId: 'trace-a', offset: 0,
    drives: [{ siteId: 0, intensity: 0.8 }] });
  return new DistributedMediumTimescaleAdapterV2(medium);
}

test('the staged adapter keeps the V1 medium and V2 time state on one clock', () => {
  const value = adapter();
  value.advanceTo(2);
  assert.equal(value.logicalTime, 2);
  assert.equal(value.mediumSnapshot().logicalTime, 2);
  value.depositMeasuredSurprise({ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 2, surpriseMagnitude: .4, goalRelevance: .2, supportMass: 1 });
  assert(value.arousal > 0);
  const restored = DistributedMediumTimescaleAdapterV2.restore(value.snapshot());
  assert.deepEqual(restored.snapshot(), value.snapshot());
});

test('the adapter rejects clock reversal and keeps recovery derived from measurements', () => {
  const value = adapter();
  value.advanceTo(1);
  assert.throws(() => value.advanceTo(.5), /time-reversed/);
  const rate = value.recoveryRate({ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 1, surpriseMagnitude: 0, goalRelevance: 0, supportMass: 0 });
  assert.equal(rate, .002);
});

test('measured observations use the V2 recovery law on the staged live substrate', () => {
  const neutral = adapter();
  neutral.advanceTo(2);
  const salient = adapter();
  salient.advanceTo(2, [{ version: 'RuntimeMeasuredSalienceV2', source: 'trusted-runtime-observation',
    structureId: 'site:0', observedAt: 2, surpriseMagnitude: .9, goalRelevance: .8, supportMass: 1 }]);
  const neutralSite = neutral.mediumSnapshot().sites.find(site => site.siteId === 0)!;
  const salientSite = salient.mediumSnapshot().sites.find(site => site.siteId === 0)!;
  assert(salientSite.potentialDepth > neutralSite.potentialDepth);
  assert(salient.arousal > 0);
  assert.equal(salient.logicalTime, salient.mediumSnapshot().logicalTime);
});
