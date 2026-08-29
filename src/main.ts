import { mkdir, readFile } from 'node:fs/promises';
import { createWriteStream, watch, type FSWatcher } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfiguration, Services } from './services.js';
import { MinecraftBody } from './body.js';
import { assertNewExperienceOutput, restoreExperience, V5Runtime } from './runtime.js';
import { Compute } from './compute.js';
import { PUBLIC_LAYOUT_SEMANTICS } from './public-context.js';
import { startLoopbackMineflayerViewerV1 } from './viewer.mjs';
import { startDashboard } from './dashboard.js';
import { assert, canonical, saveJson, sha } from './util.js';
import { MODE_PROMPTS, SYSTEM_PROMPT, TOOL_SCHEMAS } from './analysis.js';

export function parseLearningOptions(args: readonly string[]): { short: boolean; bootstrapOnly: boolean;
  experiencePointer: string | null; evidenceDirectory: string | null } {
  const value = (name: string): string | null => {
    const index = args.indexOf(name); if (index < 0) return null;
    assert(args[index + 1] && !args[index + 1]!.startsWith('--'), `missing-${name.slice(2)}`);
    return args[index + 1]!;
  };
  const short = args.includes('--short'), bootstrapOnly = args.includes('--bootstrap-only');
  const experiencePointer = value('--experience-pointer'), evidenceDirectory = value('--evidence-dir');
  assert(!(short && bootstrapOnly), 'short-and-bootstrap-only-are-distinct-runs');
  assert(!short || evidenceDirectory, 'short-loop-requires-explicit-evidence-directory');
  assert(experiencePointer === null || isAbsolute(experiencePointer), 'experience-pointer-must-be-absolute');
  return { short, bootstrapOnly, experiencePointer, evidenceDirectory };
}

async function main(): Promise<void> {
  const { short, bootstrapOnly, experiencePointer, evidenceDirectory: output } = parseLearningOptions(process.argv.slice(2));
  const config = await loadConfiguration();
  const shortHarness = short ? await import('./analysis-harness.js') : null;
  if (shortHarness) await shortHarness.verifyShortLoopGate();
  const runId = `v5-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const evidence = output ? resolve(output) : resolve(config.evidenceRoot, runId), runRoot = resolve(config.runtimeRoot, runId);
  assertNewExperienceOutput(experiencePointer, evidence); assertNewExperienceOutput(experiencePointer, runRoot);
  await mkdir(evidence, { recursive: !short });
  const log = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown) => {
    (kind === 'frame' ? frames : log).write(canonical({ kind, time: new Date().toISOString(), value }) + '\n');
    if (['body-result', 'model-finish', 'attention-wake', 'analysis-response'].includes(kind)) console.log(canonical({ kind, value }));
  };
  const services = new Services(config, runRoot, evidence);
  let body: MinecraftBody | null = null, runtime: V5Runtime | null = null;
  let compute: Compute | null = null;
  let viewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null, dashboard: Server | null = null;
  let stopWatcher: FSWatcher | null = null;
  const status: Record<string, unknown> = { runId, evidence, formalAccessed: false, oldExperienceLoaded: false,
    promptSha256: sha({ SYSTEM_PROMPT, MODE_PROMPTS }), schemaSha256: sha(TOOL_SCHEMAS), configurationSha256: sha(config), shortLoop: short,
    bootstrapOnly, sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, experiencePointer, actionResume: false };
  const stopped = () => runtime?.analysis.fail(new Error('user-stop'));
  process.once('SIGINT', stopped); process.once('SIGTERM', stopped);
  try {
    compute = new Compute();
    const restoredExperience = await restoreExperience(compute, experiencePointer);
    status.experienceLoaded = restoredExperience !== null;
    status.initialPhysical = await compute.call('status');
    status.initialActiveSeconds = restoredExperience?.snapshot.activeSeconds ?? 0;
    if (restoredExperience) record('experience-restored', { pointerPath: restoredExperience.pointerPath,
      snapshotPath: restoredExperience.snapshotPath, sha256: restoredExperience.pointer.sha256,
      initialActiveSeconds: restoredExperience.snapshot.activeSeconds, initialPhysical: status.initialPhysical,
      sourceActionsNotResumed: restoredExperience.pointer.actions, sourceEventCount: restoredExperience.pointer.eventCount });
    await services.start();
    body = new MinecraftBody({ ...config.minecraft, worldId: runId, sessionId: runId,
      activeSecondsOffset: restoredExperience?.snapshot.activeSeconds ?? 0 }, record); await body.ready(); await services.placeBot();
    runtime = new V5Runtime(body, config, evidence, record, { compute, restoredExperience, ...(short ? { analysisHooks: {
      beforeModelRequest: count => assert(count < 20, 'short-loop-evaluation-request-limit:20'),
    }, beforeObserve: (count: number) => assert(count < 64, 'short-loop-evaluation-event-limit:64') } : {}) });
    // A local operator stop is not a model tool or an action/recovery protocol.
    stopWatcher = watch(runRoot, (_event, filename) => {
      if (filename === 'STOP') { record('operator-stop', { file: resolve(runRoot, 'STOP') }); stopped(); }
    });
    if (config.viewer.enabled && !short) viewer = await startLoopbackMineflayerViewerV1(body.bot, { host: config.viewer.host,
      port: config.viewer.port, firstPerson: true, viewDistance: 3 });
    if (!short) dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
    console.log(canonical({ kind: 'V5_READY', viewer: viewer?.url ?? null, dashboard: dashboard ? `http://127.0.0.1:${config.viewer.dashboardPort}/` : null,
      operatorStopFile: resolve(runRoot, 'STOP'), evidence }));
    await runtime.save();
    record('startup-recall', await runtime.recall({ direction: 'change' }, 0));
    if (short) {
      status.shortResult = await runtime.runGoal('由你自己提出一个可通过真实尝试回答的小问题，选择基础动作，观察实际返回，更新简短结论或计划并报告。没有效果也如实说明；本轮不是128条初始化，不需要成熟物理预测或完成开门。');
      status.conclusion = 'bounded-development-short-loop-not-general-physical-capability';
    } else {
    const initial = await runtime.compute.call<{ ready: boolean }>('status');
    if (!initial.ready) {
      const goal = restoredExperience
        ? '你已从显式经验快照恢复已有初始化缓冲。请自主探索当前可见环境，继续积累首批128条完整真实事件以校准事件地图。选择有信息价值的观察与基础行动，记录和比较具体公开变化；动作课程由你决定，允许实验无效果。工具会报告初始化计数。达到128条后结束本探索目标，报告你真实发现了什么。'
        : '你是新版空经验智能体。请自主探索当前可见环境，积累首批128条完整真实事件以校准事件地图。选择有信息价值的观察与基础行动，记录和比较具体公开变化；动作课程由你决定，允许实验无效果。工具会报告初始化计数。达到128条后结束本探索目标，报告你真实发现了什么。';
      status.exploration = await runtime.runGoal(goal);
    }
    const physical = await runtime.compute.call<{ ready: boolean; writes: number; bufferedEvents: number }>('status');
    status.physical = physical;
    if (!physical.ready) { status.conclusion = 'initialization-incomplete-model-stopped'; }
    else if (bootstrapOnly) {
      status.conclusion = initial.ready ? 'restored-initialization-already-present' : 'autonomous-initialization-completed-not-general-capability';
      if (initial.ready) await runtime.save();
    }
    else {
      record('post-memory-clear-recall', await runtime.compute.call('recall', { direction: 'change' }, body.latest(), 0));
      status.doorGoal = await runtime.runGoal('让你在当前环境中能够观察到的门处于打开状态，并用新的真实观察确认。你自行反查真实经验、分析条件、形成子目标并选择方案。不要把预测或预训练常识当作已观察的成功。');
      await services.changeVisibleCondition(); await body.waitTicks(30);
      status.changedCondition = await runtime.runGoal('环境中有公开条件发生变化。观察实际情况，比较你的经验和预测，判断原方案是否仍适用；必要时修改子目标或进行新的实验，并报告仍未知的原因。');
      status.conclusion = 'development-run-completed-not-general-capability';
    }
    }
    status.actions = runtime.actions; status.writes = runtime.writes; status.events = runtime.eventCount;
    status.newEvents = runtime.newEventCount; status.modelCalls = runtime.analysis.calls;
  } catch (error) {
    const err = error as Error;
    const budgetStop = short && /^short-loop-evaluation-(request|event)-limit:/.test(err.message);
    status.conclusion = budgetStop ? 'short-experiment-budget-stop-not-model-finish' : 'run-failed';
    status.error = { message: err.message, stack: err.stack };
    status.actions = runtime?.actions ?? 0; status.writes = runtime?.writes ?? 0; status.events = runtime?.eventCount ?? 0; status.modelCalls = runtime?.analysis.calls ?? 0;
    status.newEvents = runtime?.newEventCount ?? 0;
    // Keep the last successful periodic snapshot. An interrupted initialization is not a new valid map.
    status.unsavedIncrementsMayBeLost = true;
    record('fatal-original-error', status); console.error(err); process.exitCode = 1;
  } finally {
    stopWatcher?.close();
    try { await runtime?.saveWorkspace(); }
    finally {
      try { await viewer?.close(); if (dashboard) await new Promise<void>(resolve => dashboard!.close(() => resolve()));
        if (runtime) await runtime.close(); else { await body?.close(); await compute?.close(); } } finally { await services.stop(); }
    }
    await saveJson(resolve(evidence, 'RUN_RESULT.json'), status);
    await Promise.all([new Promise<void>(resolve => log.end(resolve)), new Promise<void>(resolve => frames.end(resolve))]);
    console.log(canonical({ kind: 'V5_STOPPED', ...status }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
