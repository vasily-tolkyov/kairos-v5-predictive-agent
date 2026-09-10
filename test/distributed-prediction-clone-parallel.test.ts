import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from 'node:worker_threads';
import type { DistributedEpisodeV1 }
  from "../src/core/physics/distributed-physical-contracts.js";
import { DistributedPhysicalMedium3DV1 }
  from "../src/core/physics/distributed-physical-medium.js";
import { DistributedPredictionCloneV2 }
  from "../src/core/prediction/distributed-prediction-clone.js";
import { runDistributedPredictionCloneBatchParallelV1, runDistributedPredictionCloneBatchSyncV1 }
  from "../src/core/prediction/distributed-prediction-clone-parallel.js";
import { sha } from "../src/util.js";

function fixture() {
  const medium = new DistributedPhysicalMedium3DV1({ name: "prediction", seedHex: "1234abcd" });
  const source = [0, 1], terminal = [1024, 1025];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    const episode: DistributedEpisodeV1 = {
      version: "DistributedEpisodeV1", traceId: `parallel-${repetition}`,
      provenance: "trusted-real-event", pulses: [
        { version: "SparseFieldPulseV1", pulseId: `source-${repetition}`, offset: 0,
          drives: source.map(siteId => ({ siteId, intensity: 1 })) },
        { version: "SparseFieldPulseV1", pulseId: `terminal-${repetition}`, offset: .04,
          drives: terminal.map(siteId => ({ siteId, intensity: 1 })) },
      ],
    };
    medium.applyEpisode(episode);
  }
  return { medium, source, terminal };
}

test("parallel seed batching is byte-identical to unchanged sequential Clone runs", async () => {
  const { medium, source, terminal } = fixture();
  const snapshot = medium.snapshot(), before = sha(snapshot);
  const request = { currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary' as const,
    realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    readoutAssemblies: [{ assemblyId: "terminal", siteIds: terminal }],
    steps: 12, seeds: [11n, 3n, 19n, 7n] } as const;
  const sequential = new DistributedPredictionCloneV2(snapshot).runMany(request);
  const parallel = await runDistributedPredictionCloneBatchParallelV1(snapshot, request, 2);
  assert.deepEqual(parallel, sequential);
  assert.deepEqual(runDistributedPredictionCloneBatchSyncV1(snapshot, request, 3), sequential);
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
    import { parentPort, workerData } from 'node:worker_threads';
    const { runDistributedPredictionCloneBatchSyncV1 } = await import(workerData.module);
    parentPort.postMessage(runDistributedPredictionCloneBatchSyncV1(workerData.snapshot, workerData.request, 2));
  `)), { workerData: { module: new URL('../src/core/prediction/distributed-prediction-clone-parallel.js', import.meta.url).href,
    snapshot, request } });
  try {
    const fromPhysicalOwner = await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
    });
    assert.deepEqual(fromPhysicalOwner, sequential);
  } finally { await worker.terminate(); }
  assert.equal(sha(snapshot), before);
});

test('sync seed lanes preserve original errors and exact cached results', () => {
  const { medium, source, terminal } = fixture();
  const snapshot = medium.snapshot();
  const request = { currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary' as const, realPrefixSeedSiteIds: [source],
    actionSeedSiteIds: source, readoutAssemblies: [{ assemblyId: 'terminal', siteIds: terminal }],
    steps: 12, seeds: [19n, 2n, 7n] };
  const ports = [0, 1]; let batches = 0;
  const clone = new DistributedPredictionCloneV2(snapshot, ports, value => {
    batches++; return runDistributedPredictionCloneBatchSyncV1(snapshot, value, 2, ports);
  });
  const expected = new DistributedPredictionCloneV2(snapshot, ports).runMany(request);
  assert.deepEqual(clone.runMany(request), expected);
  assert.deepEqual(clone.runMany(request), expected);
  assert.equal(batches, 1);
  assert.throws(() => runDistributedPredictionCloneBatchSyncV1(snapshot, { ...request, steps: 0 }, 2),
    /prediction steps must be positive/);
});

test("parallel batching validates concurrency and keeps empty input empty", async () => {
  const { medium, source } = fixture();
  const request = { currentPerceptionSeedSiteIds: source,
    currentPerceptionMode: 'held-boundary' as const,
    realPrefixSeedSiteIds: [source], actionSeedSiteIds: source,
    readoutAssemblies: [], steps: 2, seeds: [] } as const;
  assert.deepEqual(await runDistributedPredictionCloneBatchParallelV1(
    medium.snapshot(), request, 4), []);
  await assert.rejects(runDistributedPredictionCloneBatchParallelV1(
    medium.snapshot(), request, 0), /parallelism must be a positive integer/);
});
