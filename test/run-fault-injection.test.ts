import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compute } from '../src/compute.js';
import { V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { startDashboard } from '../src/dashboard.js';
import { runPhysicalControlV5, type RunDependenciesV1, type RunOptionsV1 } from '../src/main.js';
import type { Configuration, Services } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import type { EvidenceLaneStreamV1 } from '../src/evidence-writer.js';
import { SyntheticBody } from './synthetic-body.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

const goal = { version: 'GroundedGoalV1', id: 'g', expression: { kind: 'predicate' as const, predicate: {
  version: 'GoalPredicateV1' as const, id: 'p', subject: { kind: 'self' as const },
  observable: 'yaw', comparator: 'equals' as const, target: 1 } } };

function testConfig(root: string): Configuration {
  return { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 2, initializationEvents: 128, control,
    viewer: { enabled: true, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: resolve(root, 'state'), evidenceRoot: resolve(root, 'evidence'),
    runtimeRoot: resolve(root, 'runtime'),
    evidence: { snapshotEveryEvents: 2, attentionRecordEveryWindows: 2, attentionScoreEpsilon: .1,
      writerQueueLineLimit: 4096 } } as Configuration;
}

type HarnessMode = 'none' | 'mid-wait' | 'mid-predict' | 'mid-snapshot' | 'write-error' | 'lean';

interface HarnessResult {
  readonly root: string; readonly evidence: string;
  readonly status: Record<string, unknown>;
  readonly body: SyntheticBody; readonly runtime: V5Runtime;
  readonly computeCalls: readonly string[]; readonly exitCodes: readonly number[];
  readonly logs: readonly string[];
  readonly dashboardStarted: boolean; readonly viewerStarted: boolean;
}

async function runHarness(mode: HarnessMode): Promise<HarnessResult> {
  const root = await mkdtemp(resolve(process.cwd(), '.tmp-run-fault-'));
  const evidence = resolve(root, 'evidence');
  const runRoot = resolve(root, 'runtime');
  await mkdir(evidence, { recursive: true });
  await mkdir(runRoot, { recursive: true });
  const goalFile = resolve(root, 'goal.json');
  await writeFile(resolve(root, 'goal.json'), JSON.stringify(goal));
  const computeCalls: string[] = [], exitCodes: number[] = [], logs: string[] = [];
  let body: SyntheticBody | null = null, runtime: V5Runtime | null = null;
  let dashboardStarted = false, viewerStarted = false;
  const options: RunOptionsV1 = { bootstrapOnly: false, experiencePointer: null,
    evidenceDirectory: evidence, goalFile, fixture: 'empty',
    profile: mode === 'lean' ? 'lean' : 'full-audit', snapshotInterval: null, viewer: null };
  const deps: Partial<RunDependenciesV1> = {
    loadConfiguration: async () => testConfig(root),
    restoreExperience: async () => null,
    createServices: (_config, runRoot, _evidence) => ({ start: async () => {
      await mkdir(runRoot, { recursive: true }); // the real Services creates this before the STOP-file watch
    }, placeBot: async () => {},
      stop: async () => {} }) as unknown as Services,
    createBody: (_configuration, record) => {
      body = new SyntheticBody(record);
      if (mode === 'mid-wait') body.armDisconnectDuringNextExecute(1);
      return body as unknown as MinecraftBody;
    },
    createCompute: () => {
      const compute = new Compute();
      const original = compute.call.bind(compute);
      compute.call = <T>(method: string, ...args: unknown[]): Promise<T> => {
        computeCalls.push(method);
        if (mode === 'mid-predict' && method === 'predict') body?.disconnect();
        if (mode === 'mid-snapshot' && method === 'snapshotBundle') body?.disconnect();
        return original<T>(method, ...args);
      };
      return compute;
    },
    createRuntime: (bodyArg, config, evidenceDir, record, runtimeDeps) => {
      runtime = new V5Runtime(bodyArg, config, evidenceDir, record, runtimeDeps);
      return runtime;
    },
    startViewer: async () => { viewerStarted = true; return { url: 'offscreen', close: async () => {} }; },
    startDashboard: async (runtimeArg, port) => { dashboardStarted = true;
      return startDashboard(runtimeArg, port); },
    watchdog: { intervalMs: 25 },
    trapSignals: false,
    setExitCode: code => { exitCodes.push(code); },
    log: value => { logs.push(value); },
    logError: error => { logs.push(`error:${error}`); },
  };
  if (mode === 'write-error') {
    deps.createEvidenceLanes = () => {
      const emitter = new EventEmitter();
      const failing: EvidenceLaneStreamV1 = {
        write: () => { queueMicrotask(() => emitter.emit('error', new Error('synthetic-disk-failure'))); return true; },
        end: callback => { queueMicrotask(callback); },
        once: (event, listener) => { emitter.once(event, listener as (...args: unknown[]) => void); },
        on: (event, listener) => { emitter.on(event, listener as (...args: unknown[]) => void); },
      };
      return { events: failing,
        frames: createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' }) };
    };
  }
  const status = await runPhysicalControlV5(options, deps);
  assert(body !== null && runtime !== null);
  return { root, evidence, status, body, runtime, computeCalls, exitCodes, logs,
    dashboardStarted, viewerStarted };
}

async function readRunResult(evidence: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(evidence, 'RUN_RESULT.json'), 'utf8')) as Record<string, unknown>;
}

async function readEvents(evidence: string): Promise<{ kind: string; value: any }[]> {
  const text = await readFile(resolve(evidence, 'events.jsonl'), 'utf8');
  return text.trim().split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { kind: string; value: any });
}

test('happy path: goal run completes, checkpoint exists, RUN_RESULT written', async () => {
  const result = await runHarness('none');
  try {
    assert.equal(result.status.conclusion, 'goal-run-complete');
    assert.equal(result.status.fidelity, 'full-audit');
    assert.equal(result.status.profile, 'full-audit');
    assert(result.dashboardStarted && result.viewerStarted, 'full-audit starts viewer and dashboard');
    assert.deepEqual(result.exitCodes, []);
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.conclusion, 'goal-run-complete');
    const pointer = JSON.parse(await readFile(resolve(result.evidence, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
    assert(pointer.eventCount > 0, 'final checkpoint committed');
    assert(existsSync(resolve(result.evidence, pointer.filename)));
    const events = await readEvents(result.evidence);
    assert(events.some(record => record.kind === 'experience-snapshot-serialized'
      && typeof record.value.serializeMs === 'number'), 'every save emits a serializeMs timing record');
    assert.equal(result.computeCalls.filter(method => method === 'closeContinuity').length, 1);
    assert.equal(result.body.closeCount, 1);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test('fault injection: disconnect mid-wait still writes RUN_RESULT with connection-lost and a final checkpoint', async () => {
  const result = await runHarness('mid-wait');
  try {
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.conclusion, 'connection-lost');
    assert.match((runResult.error as { message: string }).message, /Minecraft disconnected/);
    assert(existsSync(resolve(result.evidence, 'EXPERIENCE_LATEST.json')),
      'final checkpoint attempted and committed despite the lost connection');
    const events = await readEvents(result.evidence);
    assert(events.some(record => record.kind === 'experience-snapshot-serialized'),
      'the final checkpoint serialization completed worker-side');
    assert.equal(result.computeCalls.filter(method => method === 'closeContinuity').length, 1);
    assert(result.body.closeCount >= 1);
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test('fault injection: disconnect mid-predict still writes RUN_RESULT with connection-lost', async () => {
  const result = await runHarness('mid-predict');
  try {
    assert(result.computeCalls.includes('predict'), 'the predict call was actually reached');
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.conclusion, 'connection-lost');
    assert(existsSync(resolve(result.evidence, 'EXPERIENCE_LATEST.json')));
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test('fault injection: disconnect mid-snapshot still completes the checkpoint and writes RUN_RESULT', async () => {
  const result = await runHarness('mid-snapshot');
  try {
    assert(result.computeCalls.includes('snapshotBundle'), 'the snapshot serialization was reached');
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.conclusion, 'connection-lost');
    assert(existsSync(resolve(result.evidence, 'EXPERIENCE_LATEST.json')));
    const events = await readEvents(result.evidence);
    assert(events.filter(record => record.kind === 'experience-snapshot-serialized').length >= 2,
      'the interrupted save and the final close-time save both completed worker-side');
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test('fault injection: an evidence stream failure fails the run explicitly with RUN_RESULT', async () => {
  const result = await runHarness('write-error');
  try {
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.conclusion, 'evidence-write-failed');
    assert.match((runResult.error as { message: string }).message, /evidence-stream-error:events/);
    assert(result.exitCodes.includes(1), 'evidence loss must fail the run with a non-zero exit');
  } finally { await rm(result.root, { recursive: true, force: true }); }
});

test('close is idempotent: concurrent double close runs the shutdown protocol exactly once', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.tmp-double-close-'));
  const compute = new Compute();
  const computeCalls: string[] = [];
  const original = compute.call.bind(compute);
  compute.call = <T>(method: string, ...args: unknown[]): Promise<T> => {
    computeCalls.push(method);
    return original<T>(method, ...args);
  };
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    const runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(root), root,
      () => {}, { compute, mediaStatistics: false });
    const offer = runtime.listActionOffers(body.latest())[0]!;
    await runtime.executeOffer(offer, { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [] });
    await Promise.all([runtime.close(), runtime.close(), runtime.close()]);
    assert.equal(computeCalls.filter(method => method === 'closeContinuity').length, 1);
    assert.equal(computeCalls.filter(method => method === 'snapshotBundle').length, 1);
    assert.equal(body.closeCount, 1);
    const pointer = JSON.parse(await readFile(resolve(root, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
    assert.equal(pointer.eventCount, 1);
    // A later close is a resolved no-op, never a second checkpoint.
    await runtime.close();
    assert.equal(computeCalls.filter(method => method === 'snapshotBundle').length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('lean profile: no dashboard, minimal attention evidence, RUN_RESULT marked reduced-fidelity', async () => {
  const result = await runHarness('lean');
  try {
    assert.equal(result.status.conclusion, 'goal-run-complete');
    assert.equal(result.status.profile, 'lean');
    assert.equal(result.status.fidelity, 'reduced-fidelity');
    assert.equal(result.dashboardStarted, false, 'lean never starts the dashboard');
    assert.equal(result.viewerStarted, false, 'lean viewer is opt-in only');
    const runResult = await readRunResult(result.evidence);
    assert.equal(runResult.fidelity, 'reduced-fidelity');
    const events = await readEvents(result.evidence);
    const attention = events.filter(record => record.kind === 'attention');
    assert(attention.every(record => Array.isArray(record.value.reasons)
      && !record.value.reasons.includes('periodic')), 'lean disables periodic attention records');
    assert(events.some(record => record.kind === 'attention-wake'),
      'attention-wake notice records are never dropped, even in lean mode');
    assert(existsSync(resolve(result.evidence, 'EXPERIENCE_LATEST.json')),
      'lean still checkpoints — only auxiliary I/O is reduced');
  } finally { await rm(result.root, { recursive: true, force: true }); }
});
