import { mkdir, readFile } from 'node:fs/promises';
import { createWriteStream, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfiguration, Services, type MinecraftFixtureModeV1,
  MinecraftBody, assertNewExperienceOutput, restoreExperience, restoreExperienceV4,
  V5Runtime, type RestoredDistributedExperienceV2, type RestoredDistributedExperienceV4 }
  from './adapters/minecraft/index.js';
import type { BodyConfiguration } from './body.js';
import { Compute } from './compute.js';
import type { GroundedGoalV1 } from './control/contracts.js';
import { startLoopbackMineflayerViewerV1, startDashboard } from './adapters/minecraft/viewer.js';
import { assert, canonical, saveJson, sha } from './util.js';
import { EvidenceWriterV1, type EvidenceLaneStreamV1 } from './evidence-writer.js';
import { StallWatchdogV1 } from './stall-watchdog.js';
import type { Configuration } from './services.js';

/** PLAN-005 1.7: explicit run profile.  Full-audit is the default; lean only
 * reduces auxiliary I/O — physics, learning, gates and decisions are identical. */
export type RunProfileV1 = 'full-audit' | 'lean';

export interface RunOptionsV1 { bootstrapOnly: boolean;
  experiencePointer: string | null; evidenceDirectory: string | null; goalFile: string | null;
  fixture: MinecraftFixtureModeV1; profile: RunProfileV1; snapshotInterval: number | null;
  viewer: boolean | null; maxActions?: number | null;
  /** Bounded goal-less exploration minutes (three-arm experiment arm A). */ exploreMinutes?: number | null }

export function parseRunOptions(args: readonly string[]): RunOptionsV1 {
  const value = (name: string): string | null => {
    const index = args.indexOf(name); if (index < 0) return null;
    assert(args[index + 1] && !args[index + 1]!.startsWith('--'), `missing-${name.slice(2)}`); return args[index + 1]!;
  };
  const experiencePointer = value('--experience-pointer'), evidenceDirectory = value('--evidence-dir'),
    goalFile = value('--goal-file'), fixtureValue = value('--fixture'),
    profileValue = value('--profile'), snapshotIntervalValue = value('--snapshot-interval'),
    exploreMinutesValue = value('--explore-minutes');
  assert(experiencePointer === null || isAbsolute(experiencePointer), 'experience-pointer-must-be-absolute');
  assert(goalFile === null || isAbsolute(goalFile), 'goal-file-must-be-absolute');
  const fixture = (fixtureValue ?? 'empty') as MinecraftFixtureModeV1;
  assert(fixture === 'empty' || fixture === 'legacy-door', 'fixture-must-be-empty-or-legacy-door');
  assert(!(args.includes('--bootstrap-only') && goalFile !== null),
    'goal-file-incompatible-with-bootstrap-only');
  assert(profileValue === null || profileValue === 'lean' || profileValue === 'full-audit',
    'profile-must-be-lean-or-full-audit');
  const snapshotInterval = snapshotIntervalValue === null ? null : Number(snapshotIntervalValue);
  assert(snapshotInterval === null
    || Number.isSafeInteger(snapshotInterval) && snapshotInterval > 0, 'invalid-snapshot-interval');
  const viewer = args.includes('--viewer') ? true : args.includes('--no-viewer') ? false : null;
  assert(!(args.includes('--viewer') && args.includes('--no-viewer')), 'viewer-flags-conflict');
  const maximum = value('--max-actions');
  const maxActions = maximum === null ? null : Number(maximum);
  assert(maxActions === null || Number.isSafeInteger(maxActions) && maxActions > 0,
    'max-actions-must-be-positive-integer');
  const exploreMinutes = exploreMinutesValue === null ? null : Number(exploreMinutesValue);
  assert(exploreMinutes === null || Number.isFinite(exploreMinutes) && exploreMinutes > 0,
    'explore-minutes-must-be-positive');
  assert(!(args.includes('--bootstrap-only') && exploreMinutes !== null)
    && !(goalFile !== null && exploreMinutes !== null), 'explore-minutes-incompatible-flags');
  return { bootstrapOnly: args.includes('--bootstrap-only'), experiencePointer, evidenceDirectory,
    goalFile, fixture, profile: profileValue ?? 'full-audit', snapshotInterval, viewer, maxActions,
    exploreMinutes };
}

/** Raw evidence stays in the writer. A terminal must not receive whole
 * frame windows, physical samples or growing dependency workspaces. */
export function compactLiveStatusV1(kind: string, value: unknown): unknown | null {
  if (kind === 'body-result') {
    const result = value as { action: unknown; executed: boolean; status: string;
      startSequence: number; endSequence: number };
    return { kind, action: result.action, executed: result.executed, status: result.status,
      startSequence: result.startSequence, endSequence: result.endSequence };
  }
  if (kind === 'joint-control-decision') {
    const decision = (value as { lastDecision: { operation: string; nodeId: string | null;
      converged: boolean } }).lastDecision;
    return { kind, operation: decision.operation, nodeId: decision.nodeId, converged: decision.converged };
  }
  return null;
}

/** Every environment touchpoint of a run, injectable for fault-injection tests. */
export interface RunDependenciesV1 {
  loadConfiguration(): Promise<Configuration>;
  createCompute(): Compute;
  restoreExperience(compute: Compute, pointerPath: string | null):
    Promise<RestoredDistributedExperienceV2 | RestoredDistributedExperienceV4 | null>;
  createServices(config: Configuration, runRoot: string, evidence: string): Services;
  createBody(configuration: BodyConfiguration, record: (kind: string, value: unknown) => void): MinecraftBody;
  createRuntime(body: MinecraftBody, config: Configuration, evidence: string,
    record: (kind: string, value: unknown) => void, dependencies: { compute: Compute;
      restoredExperience: RestoredDistributedExperienceV2 | RestoredDistributedExperienceV4 | null;
      mediaStatistics: boolean }): V5Runtime;
  startViewer(body: MinecraftBody, viewerConfig: Configuration['viewer']):
    Promise<{ readonly url: string; close(): Promise<void> }>;
  startDashboard(runtime: V5Runtime, port: number): Promise<Server>;
  createEvidenceLanes(evidence: string): { events: EvidenceLaneStreamV1; frames: EvidenceLaneStreamV1 };
  /** Watchdog timing; production defaults come from StallWatchdogV1. */
  watchdog: { intervalMs?: number; recordThresholdMs?: number; stopThresholdMs?: number };
  trapSignals: boolean;
  setExitCode(code: number): void;
  log(value: string): void;
  logError(error: unknown): void;
}

function defaultRunDependencies(): RunDependenciesV1 {
  return {
    loadConfiguration,
    createCompute: () => new Compute(),
    restoreExperience: (compute, pointerPath) => restoreRuntimeExperience(compute, pointerPath),
    createServices: (config, runRoot, evidence) => new Services(config, runRoot, evidence),
    createBody: (configuration, record) => new MinecraftBody(configuration, record),
    createRuntime: (body, config, evidence, record, dependencies) =>
      new V5Runtime(body, config, evidence, record, dependencies),
    startViewer: async (body, viewerConfig) =>
      startLoopbackMineflayerViewerV1(body.bot, { host: viewerConfig.host, port: viewerConfig.port,
        firstPerson: true, viewDistance: 3 }) as unknown as { readonly url: string; close(): Promise<void> },
    startDashboard: (runtime, port) => startDashboard(runtime, port),
    createEvidenceLanes: evidence => ({
      events: createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' }),
      frames: createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' }) }),
    watchdog: {},
    trapSignals: true,
    setExitCode: code => { process.exitCode = code; },
    log: value => console.log(value),
    logError: error => console.error(error),
  };
}

async function restoreRuntimeExperience(compute: Compute, pointerPath: string | null) {
  if (pointerPath === null) return null;
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as { readonly memoryVersion?: unknown };
  return pointer.memoryVersion === 'KairosV5DistributedPhysicalMemoryV4'
    ? restoreExperienceV4(compute, pointerPath)
    : restoreExperience(compute, pointerPath);
}

export async function runPhysicalControlV5(options: RunOptionsV1,
  overrides: Partial<RunDependenciesV1> = {}): Promise<Record<string, unknown>> {
  const deps = { ...defaultRunDependencies(), ...overrides };
  const config = await deps.loadConfiguration();
  const goal = options.goalFile === null ? null
    : JSON.parse(await readFile(options.goalFile, 'utf8')) as GroundedGoalV1;
  if (goal !== null) assert(goal.version === 'GroundedGoalV1', 'goal-file-version-invalid');
  const runId = `v5-physical-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const evidence = resolve(options.evidenceDirectory ?? config.evidenceRoot, options.evidenceDirectory ? '' : runId);
  const runRoot = resolve(config.runtimeRoot, runId);
  assertNewExperienceOutput(options.experiencePointer, evidence); await mkdir(evidence, { recursive: true });
  // --- PLAN-005 1.7: resolve the run profile into auxiliary-I/O settings. ---
  const profile = options.profile;
  const fidelity = profile === 'lean' ? 'reduced-fidelity' : 'full-audit';
  const dashboardWanted = profile === 'full-audit' && config.viewer.enabled;
  const viewerWanted = profile === 'lean' ? options.viewer === true : config.viewer.enabled;
  const resolvedConfig: Configuration = { ...config,
    actionBudget: options.maxActions ?? config.actionBudget, evidence: { ...config.evidence,
    snapshotEveryEvents: options.snapshotInterval ?? config.evidence?.snapshotEveryEvents ?? 32,
    attentionRecordEveryWindows: profile === 'lean' ? 0 : config.evidence?.attentionRecordEveryWindows ?? 20,
    attentionScoreEpsilon: config.evidence?.attentionScoreEpsilon ?? .1 } };
  // --- PLAN-005 1.4: bounded, backpressure-aware evidence writer. ---
  const writer = new EvidenceWriterV1(deps.createEvidenceLanes(evidence),
    { maxQueuedLines: resolvedConfig.evidence?.writerQueueLineLimit ?? 65536 });
  const record = (kind: string, value: unknown) => {
    writer.write(kind === 'frame' ? 'frames' : 'events', canonical({ kind, time: new Date().toISOString(), value }) + '\n');
    const live = compactLiveStatusV1(kind, value);
    if (live !== null) deps.log(canonical(live));
  };
  const services = deps.createServices(resolvedConfig, runRoot, evidence);
  let compute: Compute | null = null, body: MinecraftBody | null = null, runtime: V5Runtime | null = null;
  let viewer: { readonly url: string; close(): Promise<void> } | null = null, dashboard: Server | null = null;
  let stopWatcher: FSWatcher | null = null;
  const status: Record<string, unknown> = { runId, evidence, runtimeVersion: 'KairosV5JointPhysicalControlRuntimeV2',
    configurationSha256: sha(resolvedConfig), externalAnalyzerPresent: false, formalAccessed: false,
    experiencePointer: options.experiencePointer, bootstrapOnly: options.bootstrapOnly, fixture: options.fixture,
    profile, fidelity, snapshotEveryEvents: resolvedConfig.evidence!.snapshotEveryEvents };
  let stopping = false;
  const stop = () => { stopping = true; void body?.close().catch(() => {}); };
  if (deps.trapSignals) { process.once('SIGINT', stop); process.once('SIGTERM', stop); }
  // --- PLAN-005 1.6: event-loop stall watchdog (records, protective stop). ---
  // Armed only once the run is live: startup restore/parse work is heavy by
  // nature and must never trip the protective stop.
  const watchdog = new StallWatchdogV1({ ...deps.watchdog, record,
    checkpoint: async () => { if (runtime) await runtime.save(); },
    stop: () => stop(),
    evidenceFailure: () => writer.failure,
    onEvidenceFailure: () => stop() });
  try {
    compute = deps.createCompute(); const restored = await deps.restoreExperience(compute, options.experiencePointer);
    status.experienceLoaded = restored !== null; status.initialPhysical = await compute.call('status');
    await services.start(options.fixture);
    body = deps.createBody({ ...resolvedConfig.minecraft, worldId: runId, sessionId: runId,
      activeSecondsOffset: restored?.snapshot.activeSeconds ?? 0 }, record);
    await body.ready(); await services.placeBot();
    runtime = deps.createRuntime(body, resolvedConfig, evidence, record,
      { compute, restoredExperience: restored, mediaStatistics: dashboardWanted });
    stopWatcher = watch(runRoot, (_event, filename) => { if (filename === 'STOP') stop(); });
    if (viewerWanted) {
      viewer = await deps.startViewer(body, resolvedConfig.viewer);
      if (dashboardWanted) dashboard = await deps.startDashboard(runtime, resolvedConfig.viewer.dashboardPort);
    }
    deps.log(canonical({ kind: 'V5_PHYSICAL_CONTROL_READY', viewer: viewer?.url ?? null,
      dashboard: dashboard ? `http://127.0.0.1:${resolvedConfig.viewer.dashboardPort}/` : null,
      operatorStopFile: resolve(runRoot, 'STOP'), evidence, profile, fidelity }));
    await runtime.save();
    // The stall watchdog arms only once the run is live (restore and the first
    // checkpoint above are heavy by design and must not trip it).
    watchdog.start();
    const initial = await runtime.status();
    // Initialization remains an explicit observation mode for callers that did
    // not provide a goal.  It is not a prerequisite for goal execution: a
    // grounded goal may begin from an empty substrate and let recall, control
    // and real exploration establish the first evidence in one run.
    if (!initial.ready && (options.bootstrapOnly
      || (goal === null && options.exploreMinutes == null)))
      status.initialization = await runtime.initializeFromRealExploration();
    const physical = await runtime.status(); status.physical = physical;
    if (!options.bootstrapOnly && !stopping) {
      if (goal !== null) {
        status.goalInput = { status: 'accepted', version: goal.version, file: options.goalFile };
        status.goal = await runtime.runGoal(goal);
      } else if (options.exploreMinutes != null) {
        // Bounded goal-less exploration (three-arm experiment arm A): the field
        // competes exploration offers with no grounded goal driving it.
        const start = body.latest().activeSeconds;
        status.exploration = await runtime.exploreUntil(observation =>
          observation.activeSeconds - start >= options.exploreMinutes! * 60);
      } else {
        // Production no longer invents a Minecraft-semantic objective. A caller must provide a
        // grounded, publicly verifiable goal through this explicit input boundary.
        status.goalInput = { status: 'structured-goal-required', acceptedVersion: 'GroundedGoalV1' };
        record('structured-goal-required', status.goalInput);
      }
    }
    status.actions = runtime.actions; status.sessionActions = runtime.actionCount;
    status.events = runtime.eventCount; status.writes = runtime.writes;
    status.physical = await runtime.status();
    status.conclusion = stopping ? 'operator-stopped' : options.bootstrapOnly
      ? (physical.ready ? 'real-initialization-ready' : 'real-initialization-incomplete')
      : goal !== null ? 'goal-run-complete'
      : options.exploreMinutes != null ? 'exploration-complete' : 'structured-goal-required';
  } catch (error) {
    const failure = error as Error;
    const connectionFailure = body?.connectionFailure ?? null;
    status.conclusion = stopping ? 'operator-stopped' : connectionFailure !== null ? 'connection-lost' : 'run-failed';
    if (connectionFailure !== null)
      status.connection = { classification: 'connection-lost', message: connectionFailure.message };
    status.error = { message: failure.message, stack: failure.stack };
    status.actions = runtime?.actions ?? 0; status.events = runtime?.eventCount ?? 0; status.writes = runtime?.writes ?? 0;
    record('fatal-original-error', status); if (!stopping) { deps.logError(failure); deps.setExitCode(1); }
  } finally {
    // PLAN-005 1.5: every shutdown step is isolated so no close-time failure
    // can skip RUN_RESULT.  Passive flush + final checkpoint run inside
    // runtime.close(); a failure there is recorded, never fatal to the result.
    watchdog.dispose();
    stopWatcher?.close();
    const closeErrors: { readonly message: string; readonly stack?: string }[] = [];
    const noteCloseError = (error: unknown) => closeErrors.push({ message: (error as Error).message,
      stack: (error as Error).stack });
    try { await viewer?.close(); } catch (error) { noteCloseError(error); }
    if (dashboard) try { await new Promise<void>(done => dashboard!.close(() => done())); }
    catch (error) { noteCloseError(error); }
    try { if (runtime) await runtime.close(); else { await body?.close(); await compute?.close(); } }
    catch (error) { noteCloseError(error); }
    try { await services.stop(); } catch (error) { noteCloseError(error); }
    if (closeErrors.length > 0) status.closeErrors = closeErrors;
    if (watchdog.protectiveStopTriggered) status.conclusion = 'stall-protective-stop';
    if (writer.failure !== null) {
      status.conclusion = 'evidence-write-failed';
      status.error ??= { message: writer.failure.message, stack: writer.failure.stack };
      deps.setExitCode(1);
    }
    try { await saveJson(resolve(evidence, 'RUN_RESULT.json'), status); }
    catch (error) { deps.logError(error); deps.setExitCode(1); }
    await writer.end();
    deps.log(canonical({ kind: 'V5_PHYSICAL_CONTROL_STOPPED', ...status }));
  }
  return status;
}

async function main(): Promise<void> {
  await runPhysicalControlV5(parseRunOptions(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
