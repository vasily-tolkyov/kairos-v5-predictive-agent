import assert from 'node:assert/strict';
import test from 'node:test';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';
import { SparseInterlayerProjectionV1 }
  from '../src/core/learning/sparse-interlayer-projection.js';

const SOURCE_DRIVES = [
  { siteId: 1, intensity: 1 },
  { siteId: 999, intensity: 1 },
  { siteId: 2000, intensity: 1 },
] as const;

function trainCoactivePopulation(): {
  readonly medium: DistributedPhysicalMedium3DV1;
  readonly terminalSiteIds: readonly number[];
} {
  const medium = new DistributedPhysicalMedium3DV1({
    name: 'distributed-coactivation-assembly',
    seedHex: '5a41e6f2130cb977',
  });
  const projection = new SparseInterlayerProjectionV1(medium, {
    projectionId: 'coactivation-readout',
    seed: 0x1234n,
    candidateCount: 32,
    winnerCount: 8,
  });
  let terminalSiteIds: readonly number[] = [];
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const pulse = projection.projectPulse({
      pulseId: `coactive-${repetition}`,
      offset: 0,
      drives: SOURCE_DRIVES,
    });
    terminalSiteIds = pulse.drives.map((drive) => drive.siteId);
    medium.applyPulse(pulse);
  }
  return { medium, terminalSiteIds };
}

test('repeated same-time terminal population is read as one distributed assembly', () => {
  const { medium, terminalSiteIds } = trainCoactivePopulation();
  const readout = medium.probe(terminalSiteIds, 3n, 180);

  // The three independent source fibres remain physically disconnected.  The
  // repeated terminal pulse is the only evidence for the higher-order
  // coactivation assembly; no non-local bond or result label is introduced.
  assert.equal(readout.ambiguous, false);
  assert(readout.coreSiteIds.length > 8,
    'fixture did not retain the disconnected coactivation members');
  assert.equal(readout.coactivationAssemblyId, medium.coactivationAssemblies()[0]!.assemblyId);
  assert.equal(readout.coactivationCoverage, 1);
  assert.ok((readout.coactivationResonance ?? 0) > 0,
    'assembly readout did not measure a joint terminal residence');
  // Residence is measured over the union of co-active basins.  Counting only
  // the strongest basin would report a false escape when excitation moves
  // between disconnected members of this one repeated terminal population.
  assert(readout.escapeRate <= .25,
    `coactivation union residence escaped too often: ${readout.escapeRate}`);
});

test('same-time stimulation without a repeated coactivation episode remains ambiguous', () => {
  const medium = new DistributedPhysicalMedium3DV1({
    name: 'distributed-independent-populations',
    seedHex: '5a41e6f2130cb977',
  });
  const projection = new SparseInterlayerProjectionV1(medium, {
    projectionId: 'independent-readout',
    seed: 0x1234n,
    candidateCount: 32,
    winnerCount: 8,
  });
  let first: readonly number[] = [];
  let second: readonly number[] = [];
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const pulse = projection.projectPulse({
      pulseId: `first-${repetition}`,
      offset: 0,
      drives: [{ siteId: 1, intensity: 1 }],
    });
    first = pulse.drives.map((drive) => drive.siteId);
    medium.applyPulse(pulse);
  }
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const pulse = projection.projectPulse({
      pulseId: `second-${repetition}`,
      offset: 0,
      drives: [{ siteId: 999, intensity: 1 }],
    });
    second = pulse.drives.map((drive) => drive.siteId);
    medium.applyPulse(pulse);
  }
  const readout = medium.probe([...first, ...second], 3n, 180);
  assert.equal(readout.ambiguous, true,
    'independent populations were merged merely because a query seeded them together');
  assert.equal(readout.coactivationAssemblyId, undefined);
  assert.equal(readout.coactivationResonance, undefined);
});

test('coactivation assembly evidence is deterministic across snapshot restore', () => {
  const { medium, terminalSiteIds } = trainCoactivePopulation();
  const before = medium.coactivationAssemblies();
  assert.equal(before.length, 1);
  const restored = DistributedPhysicalMedium3DV1.fromSnapshot(
    JSON.parse(JSON.stringify(medium.snapshot())));
  assert.deepEqual(restored.coactivationAssemblies(), before);
  assert.deepEqual(restored.probe(terminalSiteIds, 3n, 180),
    medium.probe(terminalSiteIds, 3n, 180));
});

test('clearing the physical terminal field disables assembly resonance', () => {
  const { medium, terminalSiteIds } = trainCoactivePopulation();
  const terminal = new Set(terminalSiteIds);
  const snapshot = medium.snapshot();
  const cleared = {
    ...snapshot,
    sites: snapshot.sites.map(site => terminal.has(site.siteId)
      ? { ...site, potentialDepth: 0, activation: 0, supportMass: 0 }
      : site),
  };
  const restored = DistributedPhysicalMedium3DV1.fromSnapshot(cleared);
  const readout = restored.probe(terminalSiteIds, 3n, 180);
  // The derived assembly index is retained for audit, but metadata cannot
  // activate it after all of its physical terminal members are cleared.
  assert.equal(restored.coactivationAssemblies().length, 1);
  assert.equal(readout.coactivationAssemblyId, undefined);
  assert.equal(readout.coactivationResonance, undefined);
});

test('recovery makes a coactivation assembly physically unavailable', () => {
  const { medium, terminalSiteIds } = trainCoactivePopulation();
  const elapsed = -Math.log(1e-8) / medium.config.recoveryRate;
  medium.recover(elapsed);
  const readout = medium.probe(terminalSiteIds, 3n, 180);
  assert.equal(readout.coactivationAssemblyId, undefined);
  assert.equal(readout.coactivationResonance, undefined);
  assert(medium.coactivationAssemblies()[0]!.supportMass < medium.config.minimumActiveMagnitude);
});
