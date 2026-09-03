import assert from "node:assert/strict";
import test from "node:test";
import type {
  DistributedBondStateV1,
  DistributedMediumSnapshotV1,
} from "../src/core/physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 }
  from "../src/core/physics/distributed-physical-medium.js";

const LEFT_PEAK = 0;
const LOW_BRIDGE_SITES = [1, 2, 3] as const;
const RIGHT_PEAK = 4;

function localBond(fromSiteId: number, toSiteId: number,
  activeMagnitude: number): DistributedBondStateV1 {
  return {
    fromSiteId,
    toSiteId,
    symmetricCoupling: activeMagnitude,
    directedConductance: 0,
    supportMass: 8,
    lastUpdatedAt: 0,
    kind: "local",
  };
}

function physicalFixture(learnedBonds: readonly DistributedBondStateV1[]): DistributedMediumSnapshotV1 {
  const empty = new DistributedPhysicalMedium3DV1({ name: "local-attractor-domain" }).snapshot();
  const bridgePotential = empty.config.minimumActiveMagnitude * 10;
  return {
    ...empty,
    sites: empty.sites.map((site) => ({
      ...site,
      potentialDepth: site.siteId === LEFT_PEAK || site.siteId === RIGHT_PEAK
        ? 6
        : LOW_BRIDGE_SITES.includes(site.siteId as 1 | 2 | 3) ? bridgePotential : 0,
      supportMass: site.siteId === LEFT_PEAK || site.siteId === RIGHT_PEAK
        ? 8
        : LOW_BRIDGE_SITES.includes(site.siteId as 1 | 2 | 3) ? 1 : 0,
      activation: 0,
    })),
    learnedBonds: learnedBonds.map((bond) => ({ ...bond })),
  };
}

function probe(snapshot: DistributedMediumSnapshotV1) {
  return DistributedPhysicalMedium3DV1.fromSnapshot(snapshot)
    .probe([LEFT_PEAK, RIGHT_PEAK], 5n, 10);
}

test("attractor ambiguity follows learned local basin bridges, not lattice proximity or directed roads", () => {
  const minimum = new DistributedPhysicalMedium3DV1({ name: "minimum" })
    .config.minimumActiveMagnitude;
  const connectedSnapshot = physicalFixture([
    localBond(LEFT_PEAK, LOW_BRIDGE_SITES[0], minimum * 10),
    localBond(LOW_BRIDGE_SITES[0], LOW_BRIDGE_SITES[1], minimum * 10),
    localBond(LOW_BRIDGE_SITES[1], LOW_BRIDGE_SITES[2], minimum * 10),
    localBond(LOW_BRIDGE_SITES[2], RIGHT_PEAK, minimum * 10),
  ]);
  const connected = probe(connectedSnapshot);
  const repeated = probe(connectedSnapshot);
  assert.deepEqual(repeated, connected, "fixed-seed local attractor readout changed");
  assert.deepEqual(connected.coreSiteIds, [LEFT_PEAK, RIGHT_PEAK]);
  const peak = Math.max(...connected.run.finalActivations.map((value) => Math.abs(value.activation)));
  const bridge = Math.max(...LOW_BRIDGE_SITES.map((siteId) => Math.abs(connected.run.finalActivations
    .find((value) => value.siteId === siteId)?.activation ?? 0)));
  assert(bridge < peak * 0.25,
    `fixture bridge became a terminal significant peak: bridge=${bridge}, peak=${peak}`);
  assert.equal(connected.ambiguous, false,
    "two peaks joined through a learned, potential-supported local bridge are one attractor domain");

  const directedOnly = probe(physicalFixture([{
    fromSiteId: LEFT_PEAK,
    toSiteId: RIGHT_PEAK,
    symmetricCoupling: 0,
    directedConductance: minimum * 10,
    supportMass: 1,
    lastUpdatedAt: 0,
    kind: "plastic-directed",
  }]));
  assert.deepEqual(directedOnly.coreSiteIds, [LEFT_PEAK, RIGHT_PEAK]);
  assert.equal(directedOnly.ambiguous, true,
    "fixed six-neighbour proximity and a directed road cannot merge two local attractor domains");
});

test("a decaying upstream basin is not a second terminal attractor after excitation reaches one downstream basin", () => {
  const empty = new DistributedPhysicalMedium3DV1({ name: "upstream-residue" }).snapshot();
  const snapshot: DistributedMediumSnapshotV1 = {
    ...empty,
    sites: empty.sites.map((site) => ({
      ...site,
      potentialDepth: [0, 1, 100, 101].includes(site.siteId) ? 6 : 0,
      supportMass: [0, 1, 100, 101].includes(site.siteId) ? 8 : 0,
      activation: 0,
    })),
    learnedBonds: [
      localBond(0, 1, 1),
      localBond(100, 101, 1),
    {
      fromSiteId: 0,
      toSiteId: 100,
      symmetricCoupling: 0,
      directedConductance: 1,
      supportMass: 8,
      lastUpdatedAt: 0,
      kind: "plastic-directed",
    },
    ],
  };
  const readout = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot)
    .probe([0, 1], 5n, 180);
  assert(readout.coreSiteIds.every((siteId) => siteId === 100 || siteId === 101),
    `the terminal readout did not settle in the downstream local basin: ${readout.coreSiteIds}`);
  assert.equal(readout.ambiguous, false,
    "residual activation in a non-terminal upstream basin was counted as a second terminal attractor");
});
