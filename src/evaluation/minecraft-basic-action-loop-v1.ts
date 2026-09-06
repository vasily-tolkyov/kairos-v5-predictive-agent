import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { Action, Observation, PublicObject } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import { V5Runtime } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { startLoopbackMineflayerViewerV1 } from '../viewer.mjs';
import { startDashboard } from '../dashboard.js';
import { assert, canonical, saveJson } from '../util.js';

export const MINECRAFT_BASIC_ACTION_LOOP_V1 = Object.freeze({
  version: 'MinecraftBasicActionLoopV1' as const,
  maxActions: 16 as const,
  readinessTicks: 5 as const,
  readinessTimeoutTicks: 200 as const,
  allowedKinds: Object.freeze(['observe', 'wait', 'look', 'move', 'jump',
    'select-hotbar', 'interact'] as const),
  forbiddenKinds: Object.freeze(['attack', 'break', 'place'] as const),
  fixture: 'empty' as const,
  controllerAccessAfterFixture: false as const,
});

export interface MinecraftBasicActionLoopResultV1 {
  readonly version: 'MinecraftBasicActionLoopResultV1';
  readonly status: 'passed' | 'failed';
  readonly controllerStatus: string | null;
  readonly fixtureReady: boolean;
  readonly actions: readonly string[];
  readonly actionCount: number;
  readonly bodyReceiptCount: number;
  readonly eventCount: number;
  readonly writes: number;
  readonly observerActionPresent: boolean;
  readonly spatialActionPresent: boolean;
  readonly forbiddenActionCount: number;
  readonly duplicateActionReceiptCount: number;
  readonly error: string | null;
}

function objectOfType(observation: Observation, type: string): PublicObject | null {
  const objects = observation.objects.filter(object => object.type === type);
  return objects.length === 1 ? objects[0]! : null;
}

async function waitForFixture(body: MinecraftBody): Promise<{ readonly observation: Observation;
  readonly targetId: string }> {
  let firstSequence: number | null = null;
  let targetId: string | null = null;
  let previous = body.latest();
  for (let tick = 0; tick < MINECRAFT_BASIC_ACTION_LOOP_V1.readinessTimeoutTicks; tick++) {
    const observation = tick === 0 ? previous : await body.waitForObservationAfter(previous.sequence);
    previous = observation;
    const target = objectOfType(observation, 'note_block');
    if (!target) { firstSequence = null; targetId = null; continue; }
    if (targetId !== null && target.id !== targetId) { firstSequence = null; targetId = null; }
    targetId ??= target.id;
    firstSequence ??= observation.sequence;
    if (observation.sequence - firstSequence >= MINECRAFT_BASIC_ACTION_LOOP_V1.readinessTicks)
      return { observation, targetId };
  }
  throw new Error('basic-action-fixture-readiness-timeout');
}

function actionKinds(records: readonly { readonly kind: string; readonly value: unknown }[]): string[] {
  return records.filter(record => record.kind === 'body-result')
    .map(record => (record.value as { readonly action: Action }).action.kind);
}

export async function runMinecraftBasicActionLoopV1(config: Configuration, evidence: string,
  maximumActions = MINECRAFT_BASIC_ACTION_LOOP_V1.maxActions): Promise<MinecraftBasicActionLoopResultV1> {
  assert(Number.isInteger(maximumActions) && maximumActions >= 6
    && maximumActions <= MINECRAFT_BASIC_ACTION_LOOP_V1.maxActions, 'invalid-basic-action-loop-budget');
  await mkdir(evidence, { recursive: true });
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const records: { kind: string; value: unknown }[] = [];
  const record = (kind: string, value: unknown): void => {
    const copy = structuredClone(value); records.push({ kind, value: copy });
    (kind === 'frame' ? frames : events).write(canonical({ kind, value: copy }) + '\n');
  };
  const runRoot = resolve(config.runtimeRoot, `basic-action-loop-${Date.now()}`);
  const services = new Services(config, runRoot, evidence);
  let body: MinecraftBody | null = null;
  let compute: Compute | null = null;
  let runtime: V5Runtime | null = null;
  let viewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null;
  let dashboard: Server | null = null;
  let fixtureReady = false;
  let controllerStatus: string | null = null;
  let error: string | null = null;
  try {
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft, worldId: `basic-action-loop-${Date.now()}`,
      sessionId: `basic-action-loop-${Date.now()}` }, record);
    await body.ready();
    // Fixture commands are the only world mutation in this runner. They occur
    // before the controller starts and are never exposed as controller tools.
    const commands = [
      'gamerule spawnRadius 0', 'gamerule doDaylightCycle false',
      'gamerule doWeatherCycle false', 'gamerule doMobSpawning false', 'time set noon',
      'forceload add -8 0 12 20', 'fill -6 63 2 10 63 20 minecraft:smooth_stone',
      'fill -6 64 2 10 68 20 air',
      'setblock 2 64 9 minecraft:note_block[instrument=harp,note=0,powered=false]',
      'setblock -2 64 9 minecraft:gold_block', 'setblock 6 64 9 minecraft:gold_block',
      `setworldspawn 2 64 12`,
    ];
    for (const command of commands) services.command(command);
    await services.placeBot();
    await saveJson(resolve(evidence, 'FIXTURE_SETUP.json'), {
      version: 'MinecraftBasicActionFixtureSetupV1', commands,
      controllerAccess: false, dynamicRuleCallbacks: false,
      forbiddenKinds: [...MINECRAFT_BASIC_ACTION_LOOP_V1.forbiddenKinds],
    });
    const fixture = await waitForFixture(body); fixtureReady = true;
    record('fixture-public-ready', { observation: fixture.observation, targetId: fixture.targetId,
      stableTicks: MINECRAFT_BASIC_ACTION_LOOP_V1.readinessTicks });
    compute = new Compute();
    runtime = new V5Runtime(body, config, evidence, record, { compute });
    if (config.viewer.enabled) {
      viewer = await startLoopbackMineflayerViewerV1(body.bot, { host: config.viewer.host,
        port: config.viewer.port, firstPerson: true, viewDistance: 3 });
      dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
      record('viewer-endpoint', { firstPerson: viewer.url,
        dashboard: `http://${config.viewer.host}:${config.viewer.dashboardPort}/`, readOnly: true });
    }
    const result = await runtime.exploreUntil(observation => runtime!.actions >= maximumActions
      || observation.activeSeconds - fixture.observation.activeSeconds >= 45);
    controllerStatus = result.status;
    await runtime.save();
  } catch (caught) {
    const cause = caught instanceof Error ? caught : new Error(String(caught));
    error = `${cause.name}:${cause.message}`;
    record('basic-action-loop-error', { name: cause.name, message: cause.message, stack: cause.stack });
  } finally {
    await viewer?.close();
    if (dashboard) await new Promise<void>(done => dashboard!.close(() => done()));
    if (runtime) await runtime.close();
    else { await body?.close(); await compute?.close(); }
    await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)),
      new Promise<void>(done => frames.end(done))]);
  }
  const actions = actionKinds(records);
  const forbiddenActionCount = actions.filter(kind =>
    (MINECRAFT_BASIC_ACTION_LOOP_V1.forbiddenKinds as readonly string[]).includes(kind)).length;
  const duplicateActionReceiptCount = records.filter(record => record.kind === 'body-result')
    .map(record => (record.value as { readonly startSequence: number }).startSequence)
    .filter((value, index, all) => all.indexOf(value) !== index).length;
  const observerActionPresent = actions.some(kind => kind === 'observe' || kind === 'wait');
  const spatialActionPresent = actions.some(kind => ['look', 'move', 'jump'].includes(kind));
  const bodyReceiptCount = actions.length;
  const actionCount = runtime?.actions ?? actions.length;
  const passed = error === null && fixtureReady && actions.length >= 6 && observerActionPresent
    && spatialActionPresent && forbiddenActionCount === 0 && duplicateActionReceiptCount === 0
    && bodyReceiptCount === actionCount && (runtime?.writes ?? 0) === 0;
  const result: MinecraftBasicActionLoopResultV1 = { version: 'MinecraftBasicActionLoopResultV1',
    status: passed ? 'passed' : 'failed', controllerStatus, fixtureReady, actions,
    actionCount, bodyReceiptCount, eventCount: runtime?.eventCount ?? 0,
    writes: runtime?.writes ?? 0, observerActionPresent, spatialActionPresent,
    forbiddenActionCount, duplicateActionReceiptCount, error };
  await saveJson(resolve(evidence, 'RUN_RESULT.json'), result);
  assert(passed, `minecraft-basic-action-loop-failed:${error ?? controllerStatus ?? 'acceptance'}`);
  return result;
}
