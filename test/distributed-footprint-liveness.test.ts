import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1 } from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../src/core/physics/distributed-physical-medium.js';

function episode(traceId: string, prefix: readonly number[], terminal: readonly number[]): DistributedEpisodeV1 {
  return { version: 'DistributedEpisodeV1', traceId, provenance: 'trusted-real-event', pulses: [
    { version: 'SparseFieldPulseV1', pulseId: `${traceId}:prefix`, offset: 0,
      drives: prefix.map(siteId => ({ siteId, intensity: 1 })) },
    { version: 'SparseFieldPulseV1', pulseId: `${traceId}:terminal`, offset: .04,
      drives: terminal.map(siteId => ({ siteId, intensity: 1 })) },
  ] };
}

test('a surviving shared cue prefix cannot impersonate a recovered terminal footprint', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'footprint-liveness', seedHex: 'f001' });
  const prefix = [1, 2, 3, 4], firstTerminal = [100, 101, 102, 103],
    secondTerminal = [200, 201, 202, 203];
  medium.applyEpisode(episode('first', prefix, firstTerminal));
  medium.applyEpisode(episode('second', prefix, secondTerminal));
  assert(medium.isFootprintActive('first'));
  assert(medium.isFootprintActive('second'));

  const state = structuredClone(medium.snapshot());
  for (const siteId of firstTerminal) {
    const site = state.sites[siteId] as unknown as {
      potentialDepth: number; supportMass: number; activation: number };
    site.potentialDepth = 0; site.supportMass = 0; site.activation = 0;
  }
  const restored = DistributedPhysicalMedium3DV1.fromSnapshot(state);
  assert.equal(restored.isFootprintActive('first'), false,
    'shared prefix sites preserved a physically absent result attractor');
  assert.equal(restored.isFootprintActive('second'), true);
});

test('a footprint own support recovers with active experience time', () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'footprint-recovery', seedHex: 'f002' });
  medium.applyEpisode(episode('old-trace', [10, 11], [300, 301]));
  const before = medium.footprint('old-trace')!.supportMass;
  medium.recover(100);
  const after = medium.footprint('old-trace')!.supportMass;
  assert(after < before && after > 0);
  assert(Math.abs(after - before * Math.exp(-.002 * 100)) < 1e-12);
});
