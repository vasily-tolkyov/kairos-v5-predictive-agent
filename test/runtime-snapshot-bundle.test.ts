import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compute } from '../src/compute.js';
import { restoreExperience, restoreExperienceV4, V5Runtime,
  type DistributedExperiencePointerV4, type ExperiencePointer } from '../src/runtime.js';
import type { Configuration } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import { SyntheticBody } from './synthetic-body.js';
import { canonical } from '../src/util.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

function testConfig(): Configuration {
  return { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 8, initializationEvents: 128, control,
    viewer: { enabled: false, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
    evidence: { snapshotEveryEvents: 4, attentionRecordEveryWindows: 5, attentionScoreEpsilon: .1 },
  } as Configuration;
}

async function commitOneEvent(runtime: V5Runtime, body: SyntheticBody): Promise<void> {
  const offer = runtime.listActionOffers(body.latest())[0]!;
  const result = await runtime.executeOffer(offer,
    { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [] });
  assert.equal(result.executed, true);
}

test('worker-serialized V3 bundle restores through the production gate', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-bundle-v3-'));
  const compute = new Compute();
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    const records: { kind: string; value: any }[] = [];
    runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(), directory,
      (kind, value) => records.push({ kind, value }), { compute, mediaStatistics: false });
    await commitOneEvent(runtime, body);
    await runtime.save();
    const pointer = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'),
      'utf8')) as ExperiencePointer;
    assert.equal(pointer.eventCount, 1);
    assert.equal(pointer.memoryVersion, undefined, 'V3 pointers carry no memoryVersion');
    // The worker-written bytes are byte-identical to a main-thread canonical()
    // of the same state — serialization moved thread, not semantics.
    const reference = canonical(await compute.call('snapshot'));
    const written = await readFile(resolve(directory, pointer.filename), 'utf8');
    assert.equal(written, reference + '\n');
    assert(records.some(record => record.kind === 'experience-snapshot-serialized'
      && record.value.mediaStatistics === false), 'lean-style save skips per-medium statistics');

    // The written bundle passes the real restore gate into a fresh worker.
    const compute2 = new Compute();
    try {
      const restored = await restoreExperience(compute2, resolve(directory, 'EXPERIENCE_LATEST.json'));
      assert(restored !== null);
      assert.equal(restored.snapshot.seenEventIds.length, 1);
      const status = await compute2.call<{ writes: number }>('status');
      assert.equal(status.writes, restored.snapshot.writes);
    } finally { await compute2.close(); }
  } finally {
    if (runtime) await runtime.close();
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});

test('worker-serialized V4 bundle carries the timescale identity and restores as V4', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-bundle-v4-'));
  const compute = new Compute();
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(), directory,
      () => {}, { compute, mediaStatistics: false });
    await runtime.enableTimescaleV2();
    // Note: V4 restore after observed events has a pre-existing, out-of-scope
    // identity-check limitation (the timescale owner compares stringified
    // medium snapshots, which is key-order sensitive); the existing V4
    // persistence coverage deliberately snapshots an empty substrate, and so
    // does this worker-serialization round-trip.
    await runtime.save();
    const pointer = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'),
      'utf8')) as DistributedExperiencePointerV4;
    assert.equal(pointer.memoryVersion, 'KairosV5DistributedPhysicalMemoryV4');
    assert.match(pointer.timescaleLawIdentitySha256, /^[a-f0-9]{64}$/);
    // Worker-written bytes are byte-identical to the legacy main-thread
    // canonicalization of the same state.
    const reference = canonical(await compute.snapshotV4());
    const written = await readFile(resolve(directory, pointer.filename), 'utf8');
    assert.equal(written, reference + '\n');

    // The written bundle passes every main-thread restore gate (the gate's
    // compute leg is mocked exactly as in the existing V4 persistence test).
    const mockCompute = { call: async (method: string, value: unknown) => {
      assert.equal(method, 'restoreV4'); return { writes: 0 };
    } } as unknown as Compute;
    const restored = await restoreExperienceV4(mockCompute, resolve(directory, 'EXPERIENCE_LATEST.json'));
    assert(restored !== null);
    assert.equal(restored.snapshot.timescales.r1.lawIdentitySha256, pointer.timescaleLawIdentitySha256);
  } finally {
    if (runtime) await runtime.close();
    await rm(directory, { recursive: true, force: true });
    await compute.close();
  }
});
