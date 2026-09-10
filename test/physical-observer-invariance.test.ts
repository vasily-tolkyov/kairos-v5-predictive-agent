import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';

function fixture() {
  const members = [64, 96, 1088, 4000];
  const medium = new DistributedPhysicalMedium3DV1({ name: 'observer-invariance' });
  for (let index = 0; index < 8; index++) medium.applyEpisode({
    version: 'DistributedEpisodeV1', traceId: `real-${index}`, provenance: 'trusted-real-event',
    pulses: [{ version: 'SparseFieldPulseV1', offset: 0,
      drives: members.map(siteId => ({ siteId, intensity: 1 })) }],
  });
  const driven = members.slice(0, 3);
  const stored = medium.snapshot();
  const state = { ...stored, sites: stored.sites.map(site => ({ ...site,
    activation: driven.includes(site.siteId) ? 1 : 0 })) };
  return { state, members, driven };
}

test('observing an unchanged physical input cannot enable dynamics absent from ordinary settling', () => {
  const { state, driven } = fixture();
  const evolving = DistributedPhysicalMedium3DV1.fromSnapshot(state);
  const observing = DistributedPhysicalMedium3DV1.fromSnapshot(state);
  const before = sha(observing.snapshot());
  const actual = evolving.settle(73n, 32);
  const measured = observing.probeSequential([driven], 73n, 32);
  assert.deepEqual(measured.run, actual,
    'readout nomination must not turn a learned collective channel on or off');
  assert.equal(sha(observing.snapshot()), before, 'observing wrote persistent state');
});

test('a passive readout mask cannot change the same physical evolution', () => {
  const { state, members, driven } = fixture();
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot(state);
  const plain = medium.probeSequential([driven], 74n, 32);
  const masked = medium.probeSequentialAtReadout([driven], members, members, 74n, 32);
  assert.deepEqual(masked.run, plain.run);
});

test('learned collective exchange does not create excitation in a zero-input field', () => {
  const { state } = fixture();
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot({ ...state,
    sites: state.sites.map(site => ({ ...site, activation: 0 })) });
  const result = medium.settle(75n, 32);
  assert.equal(result.finalActivations.length, 0);
  assert.equal(result.directedTransportMass, 0);
});
