import assert from "node:assert/strict";
import test from "node:test";
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1 }
  from "../src/core/physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 } from "../src/core/physics/distributed-physical-medium.js";
import { DistributedPredictionCloneV2 } from "../src/core/prediction/distributed-prediction-clone.js";
import { sha } from "../src/util.js";

function path(traceId: string, target: readonly number[]): DistributedEpisodeV1 {
  return {
    version: "DistributedEpisodeV1",
    traceId,
    provenance: "trusted-real-event",
    pulses: [
      { version: "SparseFieldPulseV1", offset: 0,
        drives: [0, 1].map(siteId => ({ siteId, intensity: 1 })) },
      { version: "SparseFieldPulseV1", offset: 0.04,
        drives: target.map(siteId => ({ siteId, intensity: 1 })) },
    ],
  };
}

function trained(targets: readonly (readonly number[])[]): DistributedPhysicalMedium3DV1 {
  const medium = new DistributedPhysicalMedium3DV1({ name: "prediction-test" });
  for (let repetition = 0; repetition < 8; repetition += 1) {
    targets.forEach((target, branch) => medium.applyEpisode(path(`trace-${branch}-${repetition}`, target)));
  }
  return medium;
}

test("distributed clone reaches only an actually visited physical assembly", () => {
  const medium = trained([[100, 101]]);
  const before = sha(medium.snapshot());
  const result = new DistributedPredictionCloneV2(medium.snapshot()).run({
    currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary',
    actionSeedSiteIds: [0, 1], seed: 10n, steps: 180,
    readoutAssemblies: [
      { assemblyId: "physical-result", siteIds: [100, 101], minimumCoverage: .75,
        minimumPurity: .75 },
      { assemblyId: "off-road", siteIds: [300, 301], minimumCoverage: .75,
        minimumPurity: .75 },
    ],
  });
  assert.equal(result.status, "reached");
  assert.deepEqual(result.reachedAssemblyIds, ["physical-result"]);
  assert.equal(sha(medium.snapshot()), before, "prediction wrote into the source medium");
});

test("an off-road rollout returns explicit unknown instead of copying a historical result", () => {
  const medium = trained([[100, 101]]);
  const result = new DistributedPredictionCloneV2(medium.snapshot()).run({
    currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary',
    actionSeedSiteIds: [0, 1], seed: 11n, steps: 180,
    readoutAssemblies: [{ assemblyId: "never-visited", siteIds: [500, 501],
      minimumCoverage: .75, minimumPurity: .75 }],
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reason, "trajectory-did-not-reach-readout-assembly");
  assert.deepEqual(result.reachedAssemblyIds, []);
});

test("one stochastic field reports only its terminal winner, not every branch visited on the way", () => {
  const medium = trained([[100, 101], [200, 201]]);
  const result = new DistributedPredictionCloneV2(medium.snapshot()).run({
    currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary',
    actionSeedSiteIds: [0, 1], seed: 12n, steps: 180,
    readoutAssemblies: [
      { assemblyId: "branch-a", siteIds: [100, 101], minimumCoverage: .75,
        minimumPurity: .75 },
      { assemblyId: "branch-b", siteIds: [200, 201], minimumCoverage: .75,
        minimumPurity: .75 },
    ],
  });
  assert.equal(result.status, "reached");
  assert.equal(result.reachedAssemblyIds.length, 1);
  assert(["branch-a", "branch-b"].includes(result.reachedAssemblyIds[0]!));
  assert(result.reaches.every(reach => reach.visitedSiteIds.every(siteId =>
    result.attractorReadout.coreSiteIds.includes(siteId))),
  "an intermediate visit was decoded as a terminal predicted result");
});

test("every seed owns independent transient activation and fixed seeds reproduce", () => {
  const clone = new DistributedPredictionCloneV2(trained([[100, 101]]).snapshot());
  const request = {
    currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary' as const,
    actionSeedSiteIds: [0, 1], seed: 13n, steps: 180,
    readoutAssemblies: [{ assemblyId: "result", siteIds: [100, 101],
      minimumCoverage: .75, minimumPurity: .75 }],
  } as const;
  assert.deepEqual(clone.run(request), clone.run(request));
  const before = clone.snapshot();
  clone.runMany({ ...request, seeds: [1n, 2n, 3n] });
  assert.deepEqual(clone.snapshot(), before);
});

test("distributed clone preserves weighted populations through run and runMany", () => {
  const snapshot = trained([[100, 101]]).snapshot();
  const base = {
    currentPerceptionSeedSiteIds: [0, 1],
    currentPerceptionMode: 'held-boundary' as const,
    realPrefixSeedSiteIds: [[0, 1]],
    actionSeedSiteIds: [0, 1],
    readoutAssemblies: [{ assemblyId: 'result', siteIds: [100, 101],
      minimumCoverage: .75, minimumPurity: .75 }],
    steps: 32,
  };
  const weighted = {
    ...base,
    currentPerceptionSeedDrives: [{ siteId: 0, intensity: .25 }, { siteId: 1, intensity: .75 }],
    realPrefixSeedDrives: [[{ siteId: 0, intensity: .25 }, { siteId: 1, intensity: .75 }]],
    actionSeedDrives: [{ siteId: 0, intensity: .25 }, { siteId: 1, intensity: .75 }],
    seed: 77n,
  };
  const one = new DistributedPredictionCloneV2(snapshot).run(weighted);
  const many = new DistributedPredictionCloneV2(snapshot).runMany({ ...weighted, seeds: [77n] });
  assert.deepEqual(many, [one]);
  const unit = new DistributedPredictionCloneV2(snapshot).run({ ...base, seed: 77n });
  assert.notDeepEqual(one.fieldRun.finalActivations, unit.fieldRun.finalActivations,
    'weighted clone inputs were flattened to unit drives');
});

test("metadata-only state cannot produce a predicted result", () => {
  const snapshot = trained([[100, 101]]).snapshot();
  const metadataOnly: DistributedMediumSnapshotV1 = {
    ...snapshot,
    learnedBonds: [],
    sites: snapshot.sites.map(site => ({ ...site, potentialDepth: 0, activation: 0, supportMass: 0 })),
  };
  const result = new DistributedPredictionCloneV2(metadataOnly).run({
    currentPerceptionSeedSiteIds: [0, 1], realPrefixSeedSiteIds: [[0, 1]],
    currentPerceptionMode: 'held-boundary',
    actionSeedSiteIds: [0, 1], seed: 14n, steps: 180,
    readoutAssemblies: [{ assemblyId: "metadata-result", siteIds: [100, 101],
      minimumCoverage: .75, minimumPurity: .75 }],
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.attractorReadout.evidenceLevel, "none");
});
