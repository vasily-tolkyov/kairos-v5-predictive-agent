import { mkdir, readFile } from 'node:fs/promises';
import { createWriteStream, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfiguration, Services } from './services.js';
import { MinecraftBody } from './body.js';
import { assertNewExperienceOutput, restoreExperience, restoreExperienceV4, V5Runtime } from './runtime.js';
import { Compute } from './compute.js';
import { startLoopbackMineflayerViewerV1 } from './viewer.mjs';
import { startDashboard } from './dashboard.js';
import { assert, canonical, saveJson, sha } from './util.js';

export function parseRunOptions(args: readonly string[]): { bootstrapOnly: boolean;
  experiencePointer: string | null; evidenceDirectory: string | null } {
  const value = (name: string): string | null => {
    const index = args.indexOf(name); if (index < 0) return null;
    assert(args[index + 1] && !args[index + 1]!.startsWith('--'), `missing-${name.slice(2)}`); return args[index + 1]!;
  };
  const experiencePointer = value('--experience-pointer'), evidenceDirectory = value('--evidence-dir');
  assert(experiencePointer === null || isAbsolute(experiencePointer), 'experience-pointer-must-be-absolute');
  return { bootstrapOnly: args.includes('--bootstrap-only'), experiencePointer, evidenceDirectory };
}

async function restoreRuntimeExperience(compute: Compute, pointerPath: string | null) {
  if (pointerPath === null) return null;
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { readonly memoryVersion?: unknown };
  return pointer.memoryVersion === 'KairosV5DistributedPhysicalMemoryV4'
    ? restoreExperienceV4(compute, pointerPath)
    : restoreExperience(compute, pointerPath);
}

async function main(): Promise<void> {
  const options = parseRunOptions(process.argv.slice(2)); const config = await loadConfiguration();
  const runId = `v5-physical-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const evidence = resolve(options.evidenceDirectory ?? config.evidenceRoot, options.evidenceDirectory ? '' : runId);
  const runRoot = resolve(config.runtimeRoot, runId);
  assertNewExperienceOutput(options.experiencePointer, evidence); await mkdir(evidence, { recursive: true });
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown) => {
    (kind === 'frame' ? frames : events).write(canonical({ kind, time: new Date().toISOString(), value }) + '\n');
    if (['body-result', 'joint-control-decision', 'joint-control-attention', 'attention-wake',
      'control-action-result'].includes(kind))
      console.log(canonical({ kind, value }));
  };
  const services = new Services(config, runRoot, evidence);
  let compute: Compute | null = null, body: MinecraftBody | null = null, runtime: V5Runtime | null = null;
  let viewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null, dashboard: Server | null = null;
  let stopWatcher: FSWatcher | null = null;
  const status: Record<string, unknown> = { runId, evidence, runtimeVersion: 'KairosV5JointPhysicalControlRuntimeV2',
    configurationSha256: sha(config), externalAnalyzerPresent: false, formalAccessed: false,
    experiencePointer: options.experiencePointer, bootstrapOnly: options.bootstrapOnly };
  let stopping = false;
  const stop = () => { stopping = true; void body?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    compute = new Compute(); const restored = await restoreRuntimeExperience(compute, options.experiencePointer);
    status.experienceLoaded = restored !== null; status.initialPhysical = await compute.call('status');
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft, worldId: runId, sessionId: runId,
      activeSecondsOffset: restored?.snapshot.activeSeconds ?? 0 }, record);
    await body.ready(); await services.placeBot();
    runtime = new V5Runtime(body, config, evidence, record, { compute, restoredExperience: restored });
    stopWatcher = watch(runRoot, (_event, filename) => { if (filename === 'STOP') stop(); });
    if (config.viewer.enabled) {
      viewer = await startLoopbackMineflayerViewerV1(body.bot, { host: config.viewer.host, port: config.viewer.port,
        firstPerson: true, viewDistance: 3 });
      dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
    }
    console.log(canonical({ kind: 'V5_PHYSICAL_CONTROL_READY', viewer: viewer?.url ?? null,
      dashboard: dashboard ? `http://127.0.0.1:${config.viewer.dashboardPort}/` : null,
      operatorStopFile: resolve(runRoot, 'STOP'), evidence }));
    await runtime.save();
    const initial = await runtime.status();
    if (!initial.ready) status.initialization = await runtime.initializeFromRealExploration();
    const physical = await runtime.status(); status.physical = physical;
    if (physical.ready && !options.bootstrapOnly && !stopping) {
      // Production no longer invents a Minecraft-semantic objective. A caller must provide a
      // grounded, publicly verifiable goal through an explicit future integration boundary.
      status.goalInput = { status: 'structured-goal-required', acceptedVersion: 'GroundedGoalV1' };
      record('structured-goal-required', status.goalInput);
    }
    status.actions = runtime.actions; status.events = runtime.eventCount; status.writes = runtime.writes;
    status.physical = await runtime.status();
    status.conclusion = !physical.ready ? 'real-initialization-incomplete'
      : options.bootstrapOnly ? 'real-initialization-ready' : 'structured-goal-required';
  } catch (error) {
    const failure = error as Error; status.conclusion = stopping ? 'operator-stopped' : 'run-failed';
    status.error = { message: failure.message, stack: failure.stack };
    status.actions = runtime?.actions ?? 0; status.events = runtime?.eventCount ?? 0; status.writes = runtime?.writes ?? 0;
    record('fatal-original-error', status); if (!stopping) { console.error(failure); process.exitCode = 1; }
  } finally {
    stopWatcher?.close();
    try { await viewer?.close(); if (dashboard) await new Promise<void>(done => dashboard!.close(() => done()));
      if (runtime) await runtime.close(); else { await body?.close(); await compute?.close(); } }
    finally { await services.stop(); }
    await saveJson(resolve(evidence, 'RUN_RESULT.json'), status);
    await Promise.all([new Promise<void>(done => events.end(done)), new Promise<void>(done => frames.end(done))]);
    console.log(canonical({ kind: 'V5_PHYSICAL_CONTROL_STOPPED', ...status }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
