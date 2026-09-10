import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';
import { sha } from '../src/util.js';
import { distributedObservedTerminalReadoutMatchesV1 }
  from '../src/core/learning/distributed-r2a-physical.js';

test('arrival identity belongs to the reached population, not to the injected population', () => {
  const a = [1, 2, 3, 4], b = [1000, 1001, 1002, 1003];
  const medium = new DistributedPhysicalMedium3DV1({ name: 'readout-binding' });
  for (let i = 0; i < 8; i++) medium.applyPulse({ version: 'SparseFieldPulseV1',
    pulseId: `a${i}`, offset: 0, drives: a.map(siteId => ({ siteId, intensity: 1 })) });
  for (let i = 0; i < 16; i++) medium.applyEpisode({ version: 'DistributedEpisodeV1',
    traceId: `route${i}`, provenance: 'trusted-real-event',
    pulses: [a, b].map((sites, j) => ({ version: 'SparseFieldPulseV1', offset: j,
      drives: sites.map(siteId => ({ siteId, intensity: 1 })) })) });
  const before = sha(medium.snapshot());
  const readout = medium.probeSequential([a], 3n, 180);
  assert.deepEqual(medium.probe(a, 3n, 180), readout,
    'one physical pulse must have the same calibration and continuation readout');
  // A frozen pre-repair trajectory included reader-dependent resonance.
  // Compare observers of the current physical law, not that invalid oracle.
  assert.deepEqual(readout.run, medium.probeSequential([a], 3n, 180).run);
  assert.equal(readout.coactivationAssemblyId, `coactivation:${b.join(',')}`);
  assert(readout.coreSiteIds.every(site => b.includes(site)));
  assert(readout.terminalActivations!.every(value => b.includes(value.siteId)));
  assert.equal(readout.ambiguous, false);
  assert.equal(distributedObservedTerminalReadoutMatchesV1(a, readout), false,
    'a trajectory ending at B must not calibrate an observed A result');
  assert.equal(distributedObservedTerminalReadoutMatchesV1(b, readout), true);
  const passive = medium.probeSequentialAtReadout([a], b, [...a, ...b], 3n, 180);
  assert.equal(sha(passive.run), sha(readout.run),
    'adding a passive measuring mask changed physical evolution');
  assert.equal(sha(medium.snapshot()), before);
});
