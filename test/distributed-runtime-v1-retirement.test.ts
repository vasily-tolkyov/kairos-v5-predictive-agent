import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Compute } from '../src/compute.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { restoreExperience, saveExperienceBundleV1 } from '../src/runtime.js';
import { PUBLIC_LAYOUT_SEMANTICS } from '../src/public-context.js';
import { saveJson, sha } from '../src/util.js';

async function workerCall(worker: Worker, id: number, method: string): Promise<unknown> {
  const response = new Promise<unknown>((accept, reject) => {
    const receive = (message: { readonly id: number; readonly value?: unknown;
      readonly error?: { readonly message: string } }): void => {
      if (message.id !== id) return;
      worker.off('message', receive);
      if (message.error) reject(new Error(message.error.message)); else accept(message.value);
    };
    worker.on('message', receive);
  });
  worker.postMessage({ id, method, args: [] });
  return response;
}

test('production runtime and worker expose only the distributed V2 intervention route', async () => {
  const [runtime, workerSource, memory] = await Promise.all([
    readFile(resolve('src/runtime.ts'), 'utf8'), readFile(resolve('src/worker.ts'), 'utf8'),
    readFile(resolve('src/distributed-hierarchical-memory.ts'), 'utf8'),
  ]);
  for (const source of [runtime, workerSource, memory]) {
    assert.equal(source.includes('registerMatchedInterventionProtocol'), false);
  }
  assert.equal(runtime.includes("from './core/learning/r2a-stable-pattern.js'"), false);
  assert.equal(workerSource.includes("case 'recordMatchedIntervention'"), false);
  assert.equal(memory.includes('recordMatchedIntervention(_input: unknown)'), false);
  assert.match(runtime, /recordDistributedMatchedIntervention/);
  assert.match(workerSource, /case 'recordDistributedMatchedIntervention'/);

  const worker = new Worker(new URL('../src/worker.js', import.meta.url));
  try {
    await assert.rejects(() => workerCall(worker, 1, 'registerMatchedInterventionProtocol'),
      /unknown-worker-method:registerMatchedInterventionProtocol/);
    await assert.rejects(() => workerCall(worker, 2, 'recordMatchedIntervention'),
      /unknown-worker-method:recordMatchedIntervention/);
  } finally { await worker.terminate(); }
});

test('legacy snapshot and pointer documents fail before any compute restore', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-distributed-v1-retirement-'));
  try {
    const snapshot = { version: 'KairosV5MemoryV4', writes: 0, seenEventIds: [] };
    await assert.rejects(() => saveExperienceBundleV1(directory, snapshot,
      { actions: 0, eventCount: 0, writes: 0 }, new ControlHabitWeightsV1()),
    /legacy-experience-snapshot-is-audit-only/);
    const filename = 'experience-0000.json';
    await saveJson(resolve(directory, filename), snapshot);
    await saveJson(resolve(directory, 'EXPERIENCE_LATEST.json'), {
      runtimeVersion: 'KairosV5PhysicalControlRuntimeV1', sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS,
      filename, sha256: sha(snapshot), actions: 0, eventCount: 0, writes: 0,
    });
    let calls = 0;
    const compute = { call: async () => { calls += 1; } } as unknown as Compute;
    await assert.rejects(() => restoreExperience(compute,
      resolve(directory, 'EXPERIENCE_LATEST.json')), /legacy-experience-pointer-is-audit-only/);
    assert.equal(calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
