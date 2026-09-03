import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Observation, RealEvent } from '../src/contracts.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import type { MinecraftBody } from '../src/body.js';
import type { Compute } from '../src/compute.js';
import { realEventHierarchyContinuityV1 } from '../src/events.js';
import { HierarchicalPhysicalMemoryV1, type HierarchicalMemorySnapshotV1 } from '../src/hierarchical-memory.js';
import { V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import type { Configuration } from '../src/services.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

function observation(sequence: number, activeSeconds: number, state: boolean): Observation {
  return { sequence, activeSeconds, self: { position: [0, 0, 0], yaw: 0, pitch: 0,
    properties: { grounded: true } }, objects: [{ id: 'shutdown-object', type: 'opaque-object',
    relativePosition: [1, 0, 0], properties: { state } }], targetId: 'shutdown-object',
    contextId: 'shutdown-public-context' };
}

function passiveEvent(): RealEvent {
  const frames = [observation(0, 0, false), observation(1, 1, true)];
  const raw: RealEvent = { version: 'RealEventV5', id: 'shutdown-passive-event',
    cue: { kind: 'passive', parameters: {}, targetRole: null }, frames,
    trackedIds: ['self', 'shutdown-object'], bodyResult: null,
    provenance: 'observed-passive', complete: true };
  return { ...raw, hierarchyContinuity: realEventHierarchyContinuityV1(raw, 'shutdown-session') };
}

test('normal close seals passive facts and the R2 boundary before its final checkpoint and worker close', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-runtime-final-checkpoint-'));
  const order: string[] = [], memory = new HierarchicalPhysicalMemoryV1();
  const compute = { call: async <T>(method: string, ...args: unknown[]): Promise<T> => {
    order.push(method);
    if (method === 'observe') return memory.observe(args[0] as RealEvent) as T;
    if (method === 'closeContinuity') return memory.closeContinuity(args[0] as Parameters<typeof memory.closeContinuity>[0]) as T;
    if (method === 'snapshot') return memory.snapshot() as T;
    if (method === 'predict') return memory.predict(args[0] as Parameters<typeof memory.predict>[0],
      args[1] as Parameters<typeof memory.predict>[1], args[2] as Parameters<typeof memory.predict>[2]) as T;
    throw new Error(`unexpected-test-compute-method:${method}`);
  }, close: async () => {
    assert.equal(existsSync(resolve(directory, 'EXPERIENCE_LATEST.json')), true,
      'worker closed before the final bundle pointer was committed');
    order.push('compute-close');
  } } as unknown as Compute;
  const latest = observation(1, 1, true);
  const body = { session: { id: 'shutdown-session' }, on: () => body, latest: () => latest,
    close: async () => {
      assert.equal(existsSync(resolve(directory, 'EXPERIENCE_LATEST.json')), true,
        'body closed before the final bundle pointer was committed');
      order.push('body-close');
    } } as unknown as MinecraftBody;
  const config = { version: 'KairosV5PhysicalControlConfigV2', control, actionBudget: 1,
    initializationEvents: 128 } as unknown as Configuration;
  const runtime = new V5Runtime(body, config, directory, () => {}, { compute });

  try {
    runtime.attention.capture(passiveEvent());
    await runtime.close();

    assert.deepEqual(order, ['observe', 'closeContinuity', 'snapshot', 'body-close', 'compute-close']);
    const pointer = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
    const snapshot = JSON.parse(await readFile(resolve(directory, pointer.filename), 'utf8')) as HierarchicalMemorySnapshotV1;
    assert.equal(pointer.eventCount, 1);
    assert.deepEqual(snapshot.seenEventIds, ['shutdown-passive-event']);
    assert.equal(snapshot.pendingInitialization.length, 1);
    assert.equal(snapshot.activeSeconds, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
