import { isMainThread, MessageChannel, MessagePort, receiveMessageOnPort, Worker, workerData }
  from 'node:worker_threads';
import type { DistributedAttractorReadoutV1, DistributedMediumSnapshotV1,
  DistributedProbePulseInputV1 }
  from './distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from './distributed-physical-medium.js';

const WORKER_KIND = 'distributed-medium-exact-probe-worker-v1' as const;

export type DistributedMediumProbeJobV1 = {
  readonly index: number;
  readonly kind: 'probe';
  readonly seedSiteIds: readonly number[];
  readonly seed: bigint;
  readonly steps: number;
} | {
  readonly index: number;
  readonly kind: 'sequential';
  readonly seedPulses: readonly DistributedProbePulseInputV1[];
  readonly seed: bigint;
  readonly steps: number;
} | {
  readonly index: number;
  readonly kind: 'conditioned-sequential';
  readonly conditionSiteIds: DistributedProbePulseInputV1;
  readonly seedPulses: readonly DistributedProbePulseInputV1[];
  readonly seed: bigint;
  readonly steps: number;
} | {
  readonly index: number;
  readonly kind: 'sequential-readout';
  readonly seedPulses: readonly DistributedProbePulseInputV1[];
  readonly readoutSiteIds: readonly number[];
  readonly readoutDomainSiteIds: readonly number[];
  readonly seed: bigint;
  readonly steps: number;
} | {
  readonly index: number;
  readonly kind: 'conditioned-sequential-readout';
  readonly conditionSiteIds: DistributedProbePulseInputV1;
  readonly seedPulses: readonly DistributedProbePulseInputV1[];
  readonly readoutSiteIds: readonly number[];
  readonly readoutDomainSiteIds: readonly number[];
  readonly seed: bigint;
  readonly steps: number;
};

interface WorkerInputV1 {
  readonly kind: typeof WORKER_KIND;
  readonly snapshot: DistributedMediumSnapshotV1;
  readonly jobs: readonly DistributedMediumProbeJobV1[];
  readonly compactReadout?: boolean;
  readonly compactSiteIds?: readonly number[];
  readonly completionBuffer: SharedArrayBuffer;
  readonly port: MessagePort;
}

interface WorkerOutputV1 {
  readonly results?: readonly { readonly index: number;
    readonly readout: DistributedAttractorReadoutV1 }[];
  readonly error?: { readonly message: string; readonly stack?: string };
}

function runJob(medium: DistributedPhysicalMedium3DV1,
  job: DistributedMediumProbeJobV1): DistributedAttractorReadoutV1 {
  if (job.kind === 'probe') return medium.probe(job.seedSiteIds, job.seed, job.steps);
  if (job.kind === 'sequential') return medium.probeSequential(job.seedPulses, job.seed, job.steps);
  if (job.kind === 'conditioned-sequential') {
    return medium.probeConditionedSequence(job.conditionSiteIds, job.seedPulses, job.seed, job.steps);
  }
  if (job.kind === 'sequential-readout') {
    return medium.probeSequentialAtReadout(job.seedPulses, job.readoutSiteIds,
      job.readoutDomainSiteIds, job.seed, job.steps);
  }
  return medium.probeConditionedSequenceAtReadout(job.conditionSiteIds, job.seedPulses,
    job.readoutSiteIds, job.readoutDomainSiteIds, job.seed, job.steps);
}

/**
 * Selection-rate callers only need the measured basin and transport fields.
 * The full field run also carries every final site activation; serialising
 * that array for hundreds of independent seeds can exceed the worker message
 * and host memory limits.  This projection happens after the exact physical
 * run and leaves all values used by the selector unchanged.
 */
function compactSelectionReadoutV1(value: DistributedAttractorReadoutV1,
  compactSiteIds?: readonly number[]): DistributedAttractorReadoutV1 {
  // The selector compares terminal activation only inside the union of the
  // branch domains it is about to score.  Keeping that exact subset preserves
  // every term in physicalActivationResidenceMatchV1 while removing the
  // unrelated portion of the measured field from the worker message.
  const focus = compactSiteIds === undefined ? undefined : new Set(compactSiteIds);
  const terminalActivations = focus === undefined ? value.terminalActivations
    : (value.terminalActivations ?? []).filter(activation => focus.has(activation.siteId));
  return { ...value, ...(terminalActivations === undefined ? {} : { terminalActivations }),
    run: { ...value.run, finalActivations: [] } };
}

/**
 * Synchronous exact seed parallelism for the synchronous R2A query surface.
 * Each worker restores the identical read-only snapshot and runs complete,
 * unmodified local-field trajectories. Only independent seeds are partitioned;
 * no step, frontier, proposal, temperature or readout is approximated.
 */
export function runDistributedMediumProbeBatchSyncV1(
  snapshot: DistributedMediumSnapshotV1,
  jobs: readonly DistributedMediumProbeJobV1[],
  // A full distributed snapshot is an expensive object graph.  Production
  // callers use the exact serial path by default; callers that have measured
  // enough headroom may still opt into explicit seed parallelism.
  parallelism = 1,
  options: { readonly compactReadout?: boolean;
    readonly compactSiteIds?: readonly number[] } = {},
): readonly DistributedAttractorReadoutV1[] {
  if (!Number.isInteger(parallelism) || parallelism < 1)
    throw new RangeError('parallelism must be a positive integer');
  if (jobs.length === 0) return [];
  if (parallelism === 1 || jobs.length === 1) {
    const medium = DistributedPhysicalMedium3DV1.fromSnapshot(snapshot);
    return [...jobs].sort((left, right) => left.index - right.index)
      .map(job => {
        const readout = runJob(medium, job);
        return options.compactReadout
          ? compactSelectionReadoutV1(readout, options.compactSiteIds) : readout;
      });
  }
  if (!isMainThread) throw new Error('exact probe worker cannot recursively coordinate workers');
  if (new Set(jobs.map(job => job.index)).size !== jobs.length)
    throw new Error('exact probe job indexes must be unique');
  const workerCount = Math.min(parallelism, jobs.length);
  const partitions: DistributedMediumProbeJobV1[][] = Array.from({ length: workerCount }, () => []);
  jobs.forEach((job, position) => partitions[position % workerCount]!.push(job));
  const handles = partitions.map(partition => {
    const { port1, port2 } = new MessageChannel();
    const completionBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const completion = new Int32Array(completionBuffer);
    const input: WorkerInputV1 = { kind: WORKER_KIND, snapshot, jobs: partition,
      ...(options.compactReadout ? { compactReadout: true,
        ...(options.compactSiteIds === undefined ? {} : { compactSiteIds: options.compactSiteIds }) } : {}),
      completionBuffer, port: port2 };
    const worker = new Worker(new URL(import.meta.url), {
      workerData: input,
      transferList: [port2],
    });
    return { worker, port: port1, completion };
  });
  try {
    const indexed: Array<{ index: number; readout: DistributedAttractorReadoutV1 }> = [];
    for (const handle of handles) {
      Atomics.wait(handle.completion, 0, 0);
      const message = receiveMessageOnPort(handle.port)?.message as WorkerOutputV1 | undefined;
      if (message === undefined) throw new Error('exact probe worker completed without a result');
      if (message.error !== undefined) {
        const error = new Error(message.error.message);
        if (message.error.stack !== undefined) error.stack = message.error.stack;
        throw error;
      }
      indexed.push(...(message.results ?? []));
    }
    indexed.sort((left, right) => left.index - right.index);
    if (indexed.length !== jobs.length
      || indexed.some((value, position) => value.index !== [...jobs]
        .sort((left, right) => left.index - right.index)[position]!.index)) {
      throw new Error('exact probe worker result index mismatch');
    }
    return indexed.map(value => value.readout);
  } finally {
    for (const handle of handles) {
      handle.port.close();
      void handle.worker.terminate();
    }
  }
}

const input = workerData as Partial<WorkerInputV1> | undefined;
if (!isMainThread && input?.kind === WORKER_KIND) {
  const completion = new Int32Array(input.completionBuffer!);
  const port = input.port!;
  let output: WorkerOutputV1;
  try {
    const medium = DistributedPhysicalMedium3DV1.fromSnapshot(input.snapshot!);
    output = { results: input.jobs!.map(job => {
      const readout = runJob(medium, job);
      return { index: job.index,
        readout: input.compactReadout
          ? compactSelectionReadoutV1(readout, input.compactSiteIds) : readout };
    }) };
  } catch (caught) {
    const error = caught as Error;
    output = { error: { message: error.message, stack: error.stack } };
  }
  port.postMessage(output);
  port.close();
  Atomics.store(completion, 0, 1);
  Atomics.notify(completion, 0);
}
