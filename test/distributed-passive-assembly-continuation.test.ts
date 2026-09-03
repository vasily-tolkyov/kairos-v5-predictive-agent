import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1 } from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';

const PREFIX = [1, 2, 3, 4] as const;
const ACTION = [100, 101, 102, 103] as const;
const TERMINAL = [1000, 1001, 1002, 1003] as const;
const ALTERNATE_TERMINAL = [2000, 2001, 2002, 2003] as const;

function episode(traceId: string, terminal: readonly number[] = TERMINAL): DistributedEpisodeV1 {
  return {
    version: 'DistributedEpisodeV1',
    traceId,
    provenance: 'trusted-real-event',
    pulses: [
      { version: 'SparseFieldPulseV1', offset: 0,
        drives: PREFIX.map(siteId => ({ siteId, intensity: 1 })) },
      { version: 'SparseFieldPulseV1', offset: 1,
        drives: ACTION.map(siteId => ({ siteId, intensity: 1 })) },
      { version: 'SparseFieldPulseV1', offset: 2,
        drives: terminal.map(siteId => ({ siteId, intensity: 1 })) },
    ],
  };
}

function trainCompetingMedium(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({
    name: 'passive-assembly-competition', seedHex: '636f6d70657465',
  });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(episode(`first-${repetition}`, TERMINAL));
    medium.applyEpisode(episode(`second-${repetition}`, ALTERNATE_TERMINAL));
  }
  return medium;
}

function trainedMedium(): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({
    name: 'passive-assembly-continuation', seedHex: '70617373697665',
  });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(episode(`continuation-${repetition}`));
  }
  return medium;
}

test('continuation readout identifies a terminal assembly reached without terminal seeding', () => {
  const medium = trainedMedium();
  const [assembly] = medium.coactivationAssemblies();
  assert.ok(assembly, 'fixture did not form a repeated terminal population');

  // The rollout supplies only the observed prefix and hypothetical action.
  // The terminal population is deliberately absent from the query seed; its
  // identity may be returned only when the distributed field reaches it.
  const readout = medium.probeSequential([PREFIX, ACTION], 0x636f6e74696e7565n, 180);
  assert.equal(readout.ambiguous, false);
  assert.equal(readout.coactivationAssemblyId, assembly.assemblyId);
  assert.ok((readout.coactivationCoverage ?? 0) >= .75,
    'assembly readout did not meet the existing physical quorum');
  assert.ok(readout.coreSiteIds.every(siteId => assembly.terminalPulseSiteIds.includes(siteId)),
    'dynamic core contains sites outside the physically reached assembly');
});

test('diffuse continuation over multiple learned assemblies remains ambiguous', () => {
  const medium = trainCompetingMedium();
  assert.equal(medium.coactivationAssemblies().length, 2);
  const readout = medium.probeSequential([PREFIX, ACTION], 0x636f6d70657465n, 180);
  assert.equal(readout.coactivationAssemblyId, undefined);
  assert.equal(readout.coactivationCoverage, undefined);
  assert.equal(readout.ambiguous, true,
    'two physically qualifying terminal populations were ranked as one result');
});
