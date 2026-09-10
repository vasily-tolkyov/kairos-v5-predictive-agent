import { isMainThread, MessageChannel, type MessagePort, parentPort,
  receiveMessageOnPort, Worker, workerData } from "node:worker_threads";
import type { DistributedMediumSnapshotV1 }
  from "../physics/distributed-physical-contracts.js";
import { encodeDistributedSnapshotForWorkersV1, decodeDistributedSnapshotInWorkerV1 }
  from '../physics/distributed-snapshot-transfer.js';
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
  readonly completionBuffer?: SharedArrayBuffer;
  readonly resultPort?: MessagePort;
  readonly prescribedActionSiteIds: readonly number[];
  readonly kind: typeof BATCH_WORKER_KIND;
  readonly snapshotBytes: SharedArrayBuffer;
  readonly request: Omit<DistributedPredictionCloneRequestV2, "seed">;
  readonly indexedSeeds: readonly IndexedSeedV1[];
}

/** Synchronous adapter for the existing synchronous physical-memory port.
 * Only independent seeds are partitioned; the same worker body is used by
 * the async diagnostic API below. This may coordinate from a physical owner
 * Worker, but a seed worker must never recursively create more seed workers. */
export function runDistributedPredictionCloneBatchSyncV1(
  snapshot: DistributedMediumSnapshotV1, request: BatchRequestV1,
  parallelism = 1, prescribedActionSiteIds: readonly number[] = [],
): readonly DistributedPredictionCloneResultV2[] {
  if (!Number.isInteger(parallelism) || parallelism < 1)
    throw new RangeError('parallelism must be a positive integer');
  if (request.seeds.length === 0) return [];
  if (parallelism === 1 || request.seeds.length === 1)
    return new DistributedPredictionCloneV2(snapshot, prescribedActionSiteIds).runMany(request);
  if (isBatchWorker) throw new Error('parallel Clone batch worker cannot recursively coordinate a batch');
  const partitions: IndexedSeedV1[][] = Array.from({ length: Math.min(parallelism, request.seeds.length) }, () => []);
  request.seeds.forEach((seed, index) => partitions[index % partitions.length]!.push({ index, seed }));
  const { seeds: _seeds, ...seedlessRequest } = request;
  const snapshotBytes = encodeDistributedSnapshotForWorkersV1(snapshot);
  const handles: Array<{ worker: Worker; port: MessagePort; completion: Int32Array }> = [];
  try {
    for (const indexedSeeds of partitions) {
      const { port1, port2 } = new MessageChannel();
      const completionBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const input: WorkerInputV1 = { kind: BATCH_WORKER_KIND, snapshotBytes,
        request: seedlessRequest, indexedSeeds, prescribedActionSiteIds,
        completionBuffer, resultPort: port2 };
      const worker = new Worker(new URL(import.meta.url), { workerData: input, transferList: [port2] });
      handles.push({ worker, port: port1, completion: new Int32Array(completionBuffer) });
    }
    const indexed: IndexedResultV1[] = [];
    for (const handle of handles) {
      Atomics.wait(handle.completion, 0, 0);
      const message = receiveMessageOnPort(handle.port)?.message as WorkerOutputV1 | undefined;
      if (!message) throw new Error('parallel Clone worker completed without a result');
      if (message.error) {
        const error = new Error(message.error.message);
        if (message.error.stack !== undefined) error.stack = message.error.stack;
        throw error;
      }
      indexed.push(...message.results!);
    }
    indexed.sort((left, right) => left.index - right.index);
    if (indexed.length !== request.seeds.length || indexed.some((value, index) => value.index !== index))
      throw new Error('parallel Clone worker result index mismatch');
    return indexed.map(value => value.result);
  } finally {
    for (const handle of handles) { handle.port.close(); void handle.worker.terminate(); }
  }
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
  prescribedActionSiteIds: readonly number[] = [],
): Promise<readonly DistributedPredictionCloneResultV2[]> {
  if (!Number.isInteger(parallelism) || parallelism < 1) {
    throw new RangeError("parallelism must be a positive integer");
  }
  if (request.seeds.length === 0) return [];
  if (parallelism === 1 || request.seeds.length === 1) {
    return new DistributedPredictionCloneV2(snapshot, prescribedActionSiteIds).runMany(request);
  }
  if (isBatchWorker) throw new Error("parallel Clone batch worker cannot recursively coordinate a batch");

  const workerCount = Math.min(parallelism, request.seeds.length);
  const partitions: IndexedSeedV1[][] = Array.from({ length: workerCount }, () => []);
  request.seeds.forEach((seed, index) => partitions[index % workerCount]!.push({ index, seed }));
  const { seeds: _seeds, ...seedlessRequest } = request;
  const snapshotBytes = encodeDistributedSnapshotForWorkersV1(snapshot);
  const workers: Worker[] = [];
  try {
    const batches = partitions.map((indexedSeeds) => new Promise<readonly IndexedResultV1[]>((resolve, reject) => {
      const input: WorkerInputV1 = { kind: BATCH_WORKER_KIND,
        snapshotBytes, request: seedlessRequest, indexedSeeds, prescribedActionSiteIds };
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
  let output: WorkerOutputV1;
  try {
    const clone = new DistributedPredictionCloneV2(
      decodeDistributedSnapshotInWorkerV1(input.snapshotBytes), input.prescribedActionSiteIds,
      undefined, 'transferred');
    const results = input.indexedSeeds.map(({ index, seed }) => ({
      index,
      result: clone.run({ ...input.request, seed }),
    }));
    output = { results };
  } catch (caught) {
    const error = caught as Error;
    const message = { error: { message: error.message, stack: error.stack } } satisfies WorkerOutputV1;
    output = message;
  }
  if (input.resultPort && input.completionBuffer) {
    input.resultPort.postMessage(output);
    input.resultPort.close();
    const completion = new Int32Array(input.completionBuffer);
    Atomics.store(completion, 0, 1); Atomics.notify(completion, 0);
  } else parentPort!.postMessage(output);
}
