import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import type { DistributedMediumSnapshotV1 }
  from "../physics/distributed-physical-contracts.js";
import { DistributedPredictionCloneV2,
  type DistributedPredictionCloneRequestV2,
  type DistributedPredictionCloneResultV2 }
  from "./distributed-prediction-clone.js";

const BATCH_WORKER_KIND = "distributed-prediction-clone-batch-worker-v1" as const;

type BatchRequestV1 = Omit<DistributedPredictionCloneRequestV2, "seed"> & {
  readonly seeds: readonly bigint[];
};

interface IndexedSeedV1 {
  readonly index: number;
  readonly seed: bigint;
}

interface WorkerInputV1 {
  readonly kind: typeof BATCH_WORKER_KIND;
  readonly snapshot: DistributedMediumSnapshotV1;
  readonly request: Omit<DistributedPredictionCloneRequestV2, "seed">;
  readonly indexedSeeds: readonly IndexedSeedV1[];
}

interface IndexedResultV1 {
  readonly index: number;
  readonly result: DistributedPredictionCloneResultV2;
}

interface WorkerOutputV1 {
  readonly results?: readonly IndexedResultV1[];
  readonly error?: { readonly message: string; readonly stack?: string };
}

/**
 * Exact seed-level parallelism for expensive field probes.
 *
 * Every seed still runs the unchanged 180-tick local Metropolis process on an
 * independent transient activation.  Work is partitioned only across those
 * already-independent seeds; no frontier, proposal, threshold, temperature,
 * or readout is approximated.  Results are restored to caller seed order.
 */
export async function runDistributedPredictionCloneBatchParallelV1(
  snapshot: DistributedMediumSnapshotV1,
  request: BatchRequestV1,
  // Keep the safe default single-copy.  Explicit parallelism remains
  // available for small, measured fixtures and exactness tests.
  parallelism = 1,
): Promise<readonly DistributedPredictionCloneResultV2[]> {
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    throw new RangeError("parallelism must be a positive integer");
  }
  if (request.seeds.length === 0) return [];
  if (parallelism === 1 || request.seeds.length === 1) {
    return new DistributedPredictionCloneV2(snapshot).runMany(request);
  }
  if (isBatchWorker) throw new Error("parallel Clone batch worker cannot recursively coordinate a batch");

  const workerCount = Math.min(parallelism, request.seeds.length);
  const partitions: IndexedSeedV1[][] = Array.from({ length: workerCount }, () => []);
  request.seeds.forEach((seed, index) => partitions[index % workerCount]!.push({ index, seed }));
  const { seeds: _seeds, ...seedlessRequest } = request;
  const workers: Worker[] = [];
  try {
    const batches = partitions.map((indexedSeeds) => new Promise<readonly IndexedResultV1[]>((resolve, reject) => {
      const input: WorkerInputV1 = { kind: BATCH_WORKER_KIND,
        snapshot, request: seedlessRequest, indexedSeeds };
      const worker = new Worker(new URL(import.meta.url), { workerData: input });
      workers.push(worker);
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      worker.once("error", fail);
      worker.once("exit", (code) => {
        if (!settled) fail(new Error(code === 0
          ? "parallel Clone worker exited without a result"
          : `parallel Clone worker exited:${code}`));
      });
      worker.once("message", (message: WorkerOutputV1) => {
        if (settled) return;
        settled = true;
        if (message.error !== undefined) {
          const error = new Error(message.error.message);
          if (message.error.stack !== undefined) error.stack = message.error.stack;
          reject(error);
        } else resolve(message.results ?? []);
      });
    }));
    const indexed = (await Promise.all(batches)).flat()
      .sort((left, right) => left.index - right.index);
    if (indexed.length !== request.seeds.length
      || indexed.some((value, index) => value.index !== index)) {
      throw new Error("parallel Clone worker result index mismatch");
    }
    return indexed.map(value => value.result);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}

const isBatchWorker = !isMainThread
  && (workerData as Partial<WorkerInputV1> | undefined)?.kind === BATCH_WORKER_KIND;

if (isBatchWorker) {
  const input = workerData as WorkerInputV1;
  try {
    const clone = new DistributedPredictionCloneV2(input.snapshot);
    const results = input.indexedSeeds.map(({ index, seed }) => ({
      index,
      result: clone.run({ ...input.request, seed }),
    }));
    parentPort!.postMessage({ results } satisfies WorkerOutputV1);
  } catch (caught) {
    const error = caught as Error;
    const message = { error: { message: error.message, stack: error.stack } } satisfies WorkerOutputV1;
    parentPort!.postMessage(message);
  }
}
