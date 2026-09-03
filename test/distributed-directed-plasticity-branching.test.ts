import assert from "node:assert/strict";
import test from "node:test";
import type { DistributedEpisodeV1 } from "../src/core/physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 } from "../src/core/physics/distributed-physical-medium.js";

function transition(traceId: string, targetStart: number): DistributedEpisodeV1 {
  return {
    version: "DistributedEpisodeV1",
    traceId,
    provenance: "trusted-real-event",
    pulses: [
      {
        version: "SparseFieldPulseV1",
        pulseId: `${traceId}:prefix`,
        offset: 0,
        drives: [{ siteId: 0, intensity: 1 }],
      },
      {
        version: "SparseFieldPulseV1",
        pulseId: `${traceId}:terminal`,
        offset: 0.04,
        drives: Array.from({ length: 8 }, (_, offset) => ({ siteId: targetStart + offset, intensity: 1 })),
      },
    ],
  };
}

function directedTargets(medium: DistributedPhysicalMedium3DV1): readonly number[] {
  return medium.bondsFrom(0)
    .filter((bond) => bond.kind === "plastic-directed")
    .map((bond) => bond.toSiteId)
    .sort((left, right) => left - right);
}

test("one population transition grows a sparse directed fibre without consuming all eight slots", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test", seedHex: "1122334455667788" });
  medium.applyEpisode(transition("branch-a-0", 100));
  const targets = directedTargets(medium);
  assert(targets.length > 0, "a real temporal transition formed no directed channel");
  assert(targets.length < medium.config.maxPlasticLongRangeOut,
    "the first observed branch immediately consumed the source site's whole plastic out-degree");
});

test("repetition reinforces a represented branch while preserving capacity for a later branch", () => {
  const medium = new DistributedPhysicalMedium3DV1({ name: "test", seedHex: "1122334455667788" });
  for (let index = 0; index < 8; index += 1) medium.applyEpisode(transition(`branch-a-${index}`, 100));
  const firstBranchTargets = directedTargets(medium);
  assert(firstBranchTargets.length > 0 && firstBranchTargets.length < medium.config.maxPlasticLongRangeOut);
  const firstConductance = medium.bondsFrom(0)
    .filter((bond) => bond.kind === "plastic-directed")
    .reduce((sum, bond) => sum + bond.directedConductance, 0);

  for (let index = 0; index < 4; index += 1) medium.applyEpisode(transition(`branch-b-${index}`, 200));
  const allTargets = directedTargets(medium);
  assert(allTargets.some((siteId) => siteId >= 100 && siteId < 108), "the shared prefix lost its first branch");
  assert(allTargets.some((siteId) => siteId >= 200 && siteId < 208), "the shared prefix could not grow a later branch");
  assert(allTargets.length <= medium.config.maxPlasticLongRangeOut);
  assert(medium.bondsFrom(0)
    .filter((bond) => bond.kind === "plastic-directed" && bond.toSiteId >= 100 && bond.toSiteId < 108)
    .reduce((sum, bond) => sum + bond.directedConductance, 0) >= firstConductance,
  "re-observing a represented branch did not reinforce its existing channel");
});

test("plastic branch competition is fixed-seed reproducible and independent of trace labels", () => {
  const left = new DistributedPhysicalMedium3DV1({ name: "test", seedHex: "cafebabedeadbeef" });
  const right = new DistributedPhysicalMedium3DV1({ name: "test", seedHex: "cafebabedeadbeef" });
  for (let index = 0; index < 4; index += 1) {
    left.applyEpisode(transition(`left-a-${index}`, 100));
    right.applyEpisode(transition(`renamed-a-${index}`, 100));
  }
  left.applyEpisode(transition("left-b", 200));
  right.applyEpisode(transition("renamed-b", 200));
  assert.deepEqual(left.snapshot().sites, right.snapshot().sites);
  assert.deepEqual(left.snapshot().learnedBonds, right.snapshot().learnedBonds);
  assert.deepEqual(directedTargets(left), directedTargets(right));
});
