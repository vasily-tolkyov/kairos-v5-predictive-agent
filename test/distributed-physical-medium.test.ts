import assert from "node:assert/strict";
import test from "node:test";
import { SplitMix64 } from "../src/core/random.js";
import type { DistributedEpisodeV1 } from "../src/core/physics/distributed-physical-contracts.js";
import {
  DistributedPhysicalMedium3DV1,
  MediumCapacityExhaustedError,
  distributedMediumConfig,
} from "../src/core/physics/distributed-physical-medium.js";

function episode(traceId: string, first = [0, 1], second = [100, 101]): DistributedEpisodeV1 {
  return {
    version: "DistributedEpisodeV1",
    traceId,
    provenance: "trusted-real-event",
    pulses: [
      { version: "SparseFieldPulseV1", pulseId: `${traceId}:0`, offset: 0,
        drives: first.map(siteId => ({ siteId, intensity: 1 })) },
      { version: "SparseFieldPulseV1", pulseId: `${traceId}:1`, offset: 0.2,
        drives: second.map(siteId => ({ siteId, intensity: 1 })) },
    ],
  };
}

test("distributed medium is one auditable 32^3 lattice with implicit six-neighbor bonds", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test" });
  const snapshot = medium.snapshot();
  assert.equal(snapshot.tiles.length, 1);
  assert.equal(snapshot.sites.length, 32 ** 3);
  assert.equal(snapshot.localBondCount, 3 * 31 * 32 * 32);
  assert.deepEqual(medium.site(0).coordinate, [0, 0, 0]);
  assert.deepEqual(medium.site(31).coordinate, [31, 0, 0]);
  assert.equal(medium.bondsFrom(0).length, 3);
});

test("candidate sampling does not reserve losers and binding never relocates a winner", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test" });
  const candidates = medium.allocateSites(32, new SplitMix64(1n));
  const winners = medium.competeForSites(candidates, 8, new SplitMix64(2n));
  medium.bindSites("opaque-input-1", winners);
  medium.bindSites("opaque-input-1", winners);
  assert.deepEqual(medium.bindingSites("opaque-input-1"), [...winners].sort((a, b) => a - b));
  const losers = candidates.filter(siteId => !winners.includes(siteId));
  medium.bindSites("opaque-input-2", losers.slice(0, 8));
  assert.throws(() => medium.bindSites("opaque-input-1", [...winners.slice(0, 7), losers[8]!]), /cannot be reassigned/);
});

test("trusted episodes deepen sites and form local and directed plastic connections", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test" });
  const first = medium.applyEpisode(episode("trace-1"));
  const depthOne = medium.site(0).potentialDepth;
  for (let index = 2; index <= 8; index += 1) medium.applyEpisode(episode(`trace-${index}`));
  assert.equal(first.footprintId, "trace-1");
  assert.ok(first.directedBondIds.length > 0);
  assert.equal(medium.site(0).potentialDepth, depthOne * 8);
  assert.equal(medium.site(0).supportMass, 8);
  assert.ok(medium.bondsFrom(0).some(bond => bond.kind === "local" && bond.toSiteId === 1
    && bond.symmetricCoupling > medium.config.localCoupling));
  assert.ok(medium.bondsFrom(0).some(bond => bond.kind === "plastic-directed" && bond.toSiteId === 100
    && bond.directedConductance > 0));
  assert.equal(medium.isFootprintActive(first), true);
});

test("repetition gives a footprint a longer recovery lifetime than a singleton", () => {
  const singleton = new DistributedPhysicalMedium3DV1({ name: "test" });
  singleton.applyEpisode(episode("single"));
  const repeated = new DistributedPhysicalMedium3DV1({ name: "test" });
  for (let index = 0; index < 8; index += 1) repeated.applyEpisode(episode(`repeat-${index}`));
  const elapsed = -Math.log(3e-7) / 0.002;
  singleton.recover(elapsed);
  repeated.recover(elapsed);
  assert.equal(singleton.isFootprintActive("single"), false);
  assert.equal(repeated.isFootprintActive("repeat-0"), true);
  assert.ok(Math.abs(singleton.site(0).activation) < 1e-12);
});

test("Metropolis field evolution is fixed-seed reproducible and snapshot-restorable", () => {
  const source = new DistributedPhysicalMedium3DV1({ name: "test" });
  source.applyEpisode(episode("trace"));
  const frozen = source.snapshot();
  const left = DistributedPhysicalMedium3DV1.fromSnapshot(JSON.parse(JSON.stringify(frozen)));
  const right = DistributedPhysicalMedium3DV1.fromSnapshot(JSON.parse(JSON.stringify(frozen)));
  const leftRun = left.settle(0x1234n, 80);
  const rightRun = right.settle(0x1234n, 80);
  assert.deepEqual(leftRun, rightRun);
  assert.deepEqual(left.snapshot(), right.snapshot());
  assert.equal(left.snapshot().metropolisSequence, 80);
});

test("probe and readonly clone never mutate the source and reject every write", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test" });
  medium.applyEpisode(episode("trace"));
  const before = medium.snapshot();
  const clone = medium.readonlyClone();
  const readout = clone.probe([0, 1], 99n, 120);
  assert.ok(readout.coreSiteIds.length > 0);
  clone.settle(100n, 20);
  assert.deepEqual(clone.snapshot(), before);
  assert.deepEqual(medium.snapshot(), before);
  assert.throws(() => clone.applyEpisode(), /read-only/);
  assert.throws(() => clone.applyPulse(), /read-only/);
  assert.throws(() => clone.recover(), /read-only/);
});

test("tile growth preserves cross-boundary six-neighbor continuity and reports capacity", () => {
  const growing = new DistributedPhysicalMedium3DV1(distributedMediumConfig("test", undefined, { maxTiles: 2 }));
  const firstTileSites = Array.from({ length: 32 ** 3 }, (_, siteId) => siteId);
  growing.bindSites("fill-first-tile", firstTileSites);
  const allocated = growing.allocateSites(1, new SplitMix64(3n));
  assert.equal(growing.tileCount, 2);
  assert.equal(allocated.length, 1);
  const snapshot = growing.snapshot();
  const crossBoundaryBonds = snapshot.sites.filter(site => growing.bondsFrom(site.siteId)
    .some(bond => Math.floor(bond.toSiteId / (32 ** 3)) !== Math.floor(site.siteId / (32 ** 3))));
  assert.ok(crossBoundaryBonds.length > 0);

  const bounded = new DistributedPhysicalMedium3DV1(distributedMediumConfig("test", undefined, { maxTiles: 1 }));
  assert.throws(() => bounded.allocateSites(32 ** 3 + 1, new SplitMix64(4n)), MediumCapacityExhaustedError);
});

test("metadata without physical depth cannot yield an attractor", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test" });
  medium.applyEpisode(episode("trace"));
  const snapshot = medium.snapshot();
  const ablated = {
    ...snapshot,
    sites: snapshot.sites.map(site => ({ ...site, potentialDepth: 0, activation: 0, supportMass: 0 })),
    learnedBonds: [],
  };
  const restored = DistributedPhysicalMedium3DV1.fromSnapshot(ablated);
  assert.equal(restored.isFootprintActive("trace"), false);
  assert.equal(restored.probe([0, 1], 5n, 80).evidenceLevel, "none");
});
