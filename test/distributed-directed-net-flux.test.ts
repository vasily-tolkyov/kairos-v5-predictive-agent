import assert from 'node:assert/strict';
import test from 'node:test';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1 }
  from '../src/core/physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 }
  from '../src/core/physics/distributed-physical-medium.js';

function trainedDirectedField(): { readonly snapshot: DistributedMediumSnapshotV1;
  readonly source: number; readonly sinks: readonly number[]; readonly terminal: readonly number[] } {
  const medium = new DistributedPhysicalMedium3DV1({ name: 'directed-net-flux', seedHex: '66778899aabbccdd' });
  const source = 0, population = Array.from({ length: 8 }, (_, index) => 100 + index);
  for (let repetition = 0; repetition < 8; repetition += 1) {
    const episode: DistributedEpisodeV1 = { version: 'DistributedEpisodeV1',
      traceId: `physical-transition-${repetition}`, provenance: 'trusted-real-event', pulses: [
        { version: 'SparseFieldPulseV1', pulseId: `source-${repetition}`, offset: 0,
          drives: [{ siteId: source, intensity: 1 }] },
        { version: 'SparseFieldPulseV1', pulseId: `sink-${repetition}`, offset: .04,
          drives: population.map(siteId => ({ siteId, intensity: 1 })) },
      ] };
    medium.applyEpisode(episode);
  }
  const snapshot = medium.snapshot();
  const sinks = snapshot.learnedBonds.filter(bond => bond.kind === 'plastic-directed'
    && bond.fromSiteId === source).map(bond => bond.toSiteId).sort((left, right) => left - right);
  assert(sinks.length > 0);
  for (const site of snapshot.sites as unknown as Array<{ siteId: number; activation: number }>) site.activation = 0;
  (snapshot.sites[source] as { activation: number }).activation = 1;
  for (const siteId of sinks) (snapshot.sites[siteId] as { activation: number }).activation
    = snapshot.config.minimumActiveMagnitude;
  return { snapshot, source, sinks, terminal: population };
}

function cutDirected(snapshot: DistributedMediumSnapshotV1): DistributedMediumSnapshotV1 {
  return { ...structuredClone(snapshot),
    learnedBonds: snapshot.learnedBonds.filter(bond => bond.kind !== 'plastic-directed') };
}

function activationAt(snapshot: DistributedMediumSnapshotV1, siteIds: readonly number[]): number {
  const selected = new Set(siteIds);
  return snapshot.sites.filter(site => selected.has(site.siteId))
    .reduce((sum, site) => sum + Math.max(0, site.activation), 0);
}

function totalExcitation(snapshot: DistributedMediumSnapshotV1): number {
  return snapshot.sites.reduce((sum, site) => sum + Math.max(0, site.activation), 0);
}

test('directed conductance produces source outflow and sink inflow rather than target-only excitation', () => {
  const fixture = trainedDirectedField(), cut = cutDirected(fixture.snapshot);
  let sourceOutflowSeeds = 0, sinkInflowSeeds = 0;
  for (let seed = 1; seed <= 32; seed += 1) {
    const connected = DistributedPhysicalMedium3DV1.fromSnapshot(fixture.snapshot);
    const disconnected = DistributedPhysicalMedium3DV1.fromSnapshot(cut);
    const initialMass = totalExcitation(fixture.snapshot);
    connected.settle(BigInt(seed), 1); disconnected.settle(BigInt(seed), 1);
    const connectedState = connected.snapshot(), disconnectedState = disconnected.snapshot();
    assert(totalExcitation(connectedState) <= initialMass + 1e-9,
      'directed transport created excitation instead of moving it');
    assert(totalExcitation(disconnectedState) <= initialMass + 1e-9,
      'local thermal exchange created excitation in the cut-edge control');
    if (activationAt(connectedState, [fixture.source])
      < activationAt(disconnectedState, [fixture.source]) - 1e-12) sourceOutflowSeeds += 1;
    if (activationAt(connectedState, fixture.sinks)
      > activationAt(disconnectedState, fixture.sinks) + 1e-12) sinkInflowSeeds += 1;
  }
  assert(sourceOutflowSeeds > 0, 'a learned outgoing channel never depleted its active source');
  assert(sinkInflowSeeds > 0, 'a learned incoming channel never enhanced its sink');
});

test('directed net flux makes a terminal population win more residence than the cut-edge counterfactual', () => {
  const fixture = trainedDirectedField(), cut = cutDirected(fixture.snapshot);
  let connectedTerminalResidence = 0, disconnectedTerminalResidence = 0;
  for (let seed = 1; seed <= 24; seed += 1) {
    const connected = DistributedPhysicalMedium3DV1.fromSnapshot(fixture.snapshot);
    const disconnected = DistributedPhysicalMedium3DV1.fromSnapshot(cut);
    connected.settle(BigInt(seed), 180); disconnected.settle(BigInt(seed), 180);
    connectedTerminalResidence += activationAt(connected.snapshot(), fixture.terminal);
    disconnectedTerminalResidence += activationAt(disconnected.snapshot(), fixture.terminal);
  }
  assert(connectedTerminalResidence > disconnectedTerminalResidence,
    `directed terminal residence did not exceed cut-edge control:${connectedTerminalResidence}/${disconnectedTerminalResidence}`);
});
