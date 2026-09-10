import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { scanAnonymousPhysicalStructureV1 } from '../src/core/physics/distributed-physical-structure-scanner.js';
import { distributedR2AConditionDifferentialV1, distributedR2ADifferentialComponentsV1,
  distributedR2APairwiseDifferentialComponentsV1 }
  from '../src/core/learning/distributed-r2a-physical.js';

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);
function physicalFixture() {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'anonymous-difference' });
  for (let i = 0; i < 8; i++) medium.applyEpisode({ version: 'DistributedEpisodeV1',
    traceId: `neutral-${i}`, provenance: 'trusted-real-event', pulses: [{
      version: 'SparseFieldPulseV1', offset: 0,
      drives: range(0, 24).map(siteId => ({ siteId, intensity: 1 })) }] });
  return medium.snapshot();
}

test('a repeated local difference survives touching a larger shared context population', () => {
  const snapshot = physicalFixture(), before = JSON.stringify(snapshot);
  const own = Array.from({ length: 8 }, () => range(0, 24));
  const contrast = Array.from({ length: 8 }, () => range(8, 16));
  const oldBasin = scanAnonymousPhysicalStructureV1(snapshot).basins[0]!;
  assert.equal(oldBasin.coreSiteIds.length, 24);
  assert.equal(distributedR2AConditionDifferentialV1(oldBasin.coreSiteIds, own, contrast).qualifies,
    false, 'the original whole-component test reproduces common-context dilution');
  const components = distributedR2ADifferentialComponentsV1(snapshot, own, contrast);
  assert.deepEqual(components.map(b => b.coreSiteIds), [range(0, 8)]);
  assert(components[0]!.internalLocalBondCount > 0);
  assert.equal(JSON.stringify(snapshot), before);
});

test('balanced or common excitation is subtracted; missing contrasts cannot invent factors', () => {
  const snapshot = physicalFixture();
  const common = Array.from({ length: 8 }, () => range(0, 24));
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, common, common), []);
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, common, []), []);
  const balanced = common.map((p, i) => i < 4 ? p : range(8, 16));
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, balanced, balanced), []);
});

test('differential components retain learned topology rather than joining by a common result', () => {
  const snapshot = physicalFixture();
  const own = [range(0, 24)], contrast = [range(8, 8)];
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, own, contrast)
    .map(b => b.coreSiteIds), [range(0, 8), range(16, 8)]);
  assert.deepEqual(distributedR2ADifferentialComponentsV1({ ...snapshot, learnedBonds: [] },
    own, contrast), []);
  assert.deepEqual(distributedR2ADifferentialComponentsV1({ ...snapshot,
    sites: snapshot.sites.map(site => ({ ...site, supportMass: 0, potentialDepth: 0 })) },
  own, contrast), []);
});

test('site differences keep the existing .80/.20 support limits and count an event once', () => {
  const snapshot = physicalFixture(), all = range(0, 24), shared = range(8, 16);
  const own = [all, all, all, all, shared];
  const contrasting = [all, shared, shared, shared, shared];
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, own, contrasting)
    .map(b => b.coreSiteIds), [range(0, 8)]);
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot,
    [all, all, all, shared, shared], contrasting), []);
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot,
    own, [all, all, shared, shared, shared]), []);
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot,
    own.map(p => [...p, ...p]), contrasting).map(b => b.coreSiteIds), [range(0, 8)]);
});

test('independent matched counterfactuals do not erase each other’s physical factors', () => {
  const snapshot = physicalFixture(), before = JSON.stringify(snapshot);
  const own = Array.from({ length: 8 }, () => range(0, 24));
  const withoutQ = Array.from({ length: 8 }, () => range(8, 16));
  const withoutR = Array.from({ length: 8 }, () => range(0, 16));
  // Pooling the two alternatives makes each missing factor appear in half of
  // the contrast population, although each individual matched experiment is
  // an exact repeated difference.  The middle, common assembly is not a factor.
  assert.deepEqual(distributedR2ADifferentialComponentsV1(snapshot, own,
    [...withoutQ, ...withoutR]), []);
  const expected = [range(0, 8), range(16, 8)];
  assert.deepEqual(distributedR2APairwiseDifferentialComponentsV1(snapshot, own,
    [withoutQ, withoutR]).map(b => b.coreSiteIds), expected);
  assert.deepEqual(distributedR2APairwiseDifferentialComponentsV1(snapshot, own,
    [withoutR, withoutQ, withoutQ]).map(b => b.coreSiteIds), expected);
  assert.deepEqual(distributedR2APairwiseDifferentialComponentsV1(snapshot, own, []), []);
  assert.deepEqual(distributedR2APairwiseDifferentialComponentsV1(
    { ...snapshot, learnedBonds: [] }, own, [withoutQ, withoutR]), []);
  assert.equal(JSON.stringify(snapshot), before);
});
