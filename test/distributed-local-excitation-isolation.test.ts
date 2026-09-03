import assert from "node:assert/strict";
import test from "node:test";
import type {
  DistributedEpisodeV1,
  DistributedMediumSnapshotV1,
} from "../src/core/physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 }
  from "../src/core/physics/distributed-physical-medium.js";
import { sha } from "../src/util.js";

const SOURCE = [0, 1, 2, 3, 32, 33, 34, 35] as const;
const REMOTE = [32732, 32733, 32734, 32735, 32764, 32765, 32766, 32767] as const;

function basinEpisode(traceId: string, sites: readonly number[]): DistributedEpisodeV1 {
  return {
    version: "DistributedEpisodeV1",
    traceId,
    provenance: "trusted-real-event",
    pulses: [{
      version: "SparseFieldPulseV1",
      pulseId: `${traceId}:pulse`,
      offset: 0,
      drives: sites.map((siteId) => ({ siteId, intensity: 1 })),
    }],
  };
}

function separatedBasins(): DistributedMediumSnapshotV1 {
  const medium = new DistributedPhysicalMedium3DV1({
    name: "local-excitation-isolation",
    seedHex: "5a41e6f2130cb977",
  });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    medium.applyEpisode(basinEpisode(`source-${repetition}`, SOURCE));
    medium.applyEpisode(basinEpisode(`remote-${repetition}`, REMOTE));
  }
  const snapshot = medium.snapshot();
  for (const site of snapshot.sites as unknown as Array<{ activation: number }>) {
    site.activation = 0;
  }
  assert.equal(snapshot.learnedBonds.some((bond) => bond.kind === "plastic-directed"), false,
    "single-pulse basin fixture unexpectedly learned a temporal road");
  return snapshot;
}

function activationAt(snapshot: DistributedMediumSnapshotV1, siteIds: readonly number[]): number {
  const selected = new Set(siteIds);
  return snapshot.sites.reduce((sum, site) => selected.has(site.siteId)
    ? sum + Math.max(0, site.activation) : sum, 0);
}

test("localized excitation cannot spontaneously light an unconnected remote learned basin", () => {
  const frozen = separatedBasins();
  const frozenHash = sha(frozen);
  for (const seed of [1n, 2n, 3n]) {
    const medium = DistributedPhysicalMedium3DV1.fromSnapshot(frozen);
    const first = medium.probe(SOURCE, seed, 180);
    const second = medium.probe(SOURCE, seed, 180);
    assert.deepEqual(second, first, "a fixed local thermal trajectory was not reproducible");
    assert.equal(sha(medium.snapshot()), frozenHash, "a read-only local probe changed the source medium");
    assert(first.coreSiteIds.length > 0, "the actually stimulated learned basin produced no readout");
    assert.equal(first.ambiguous, false,
      "an unconnected remote basin became a second terminal attractor without receiving excitation");

    const peak = Math.max(0, ...first.run.finalActivations.map((value) => value.activation));
    const remotePeak = Math.max(0, ...REMOTE.map((siteId) => first.run.finalActivations
      .find((value) => value.siteId === siteId)?.activation ?? 0));
    assert(remotePeak < peak * 0.25,
      `remote learned basin crossed the physical significance floor:${remotePeak}/${peak}`);
  }
});

test("thermal evolution redistributes injected excitation instead of creating it", () => {
  const frozen = separatedBasins();
  const medium = DistributedPhysicalMedium3DV1.fromSnapshot(frozen);
  const run = medium.probe(SOURCE, 7n, 180);
  const finalPositiveMass = run.run.finalActivations.reduce(
    (sum, value) => sum + Math.max(0, value.activation), 0);
  assert(finalPositiveMass <= SOURCE.length + 1e-9,
    `thermal field created activation mass:${SOURCE.length}->${finalPositiveMass}`);

  const settled = DistributedPhysicalMedium3DV1.fromSnapshot({
    ...frozen,
    sites: frozen.sites.map((site) => ({
      ...site,
      activation: SOURCE.includes(site.siteId as typeof SOURCE[number]) ? 1 : 0,
    })),
  });
  const initialMass = activationAt(settled.snapshot(), SOURCE);
  settled.settle(7n, 180);
  const finalMass = settled.snapshot().sites.reduce(
    (sum, site) => sum + Math.max(0, site.activation), 0);
  assert(finalMass <= initialMass + 1e-9,
    `zero-input settlement created activation mass:${initialMass}->${finalMass}`);
});
