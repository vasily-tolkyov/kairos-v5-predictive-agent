/** Development evidence, not Formal/G6 qualification. Only the final public
 * predicate is given to the production controller; no action script follows
 * fixture setup. The frozen real experience is loaded read-only. */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MinecraftBody } from '../dist/src/body.js';
import { Compute } from '../dist/src/compute.js';
import { V5Runtime, restoreExperience } from '../dist/src/runtime.js';
import { Services, loadConfiguration } from '../dist/src/services.js';
import { EvidenceWriterV1 } from '../dist/src/evidence-writer.js';
import { startLoopbackMineflayerViewerV1 } from '../dist/src/viewer.mjs';
import { startDashboard } from '../dist/src/dashboard.js';
import { prepareGuidedNoteFixtureLiveV1 } from '../dist/src/evaluation/minecraft-note-fixture-v1.js';
import { canonical, sha, fileSha, saveJson } from '../dist/src/util.js';

const { values } = parseArgs({ options: { checkpoint: { type: 'string' }, output: { type: 'string' },
  yaw: { type: 'string', default: '0' }, 'max-actions': { type: 'string', default: '8' },
  'target-note': { type: 'string', default: '1' },
  'initial-note': { type: 'string', default: '0' },
  'origin-x': { type: 'string', default: '704' }, 'origin-z': { type: 'string', default: '704' },
  'marker-variant': { type: 'string', default: '3' }, 'case-id': { type: 'string', default: 'heldout-foundation-01' },
  port: { type: 'string' }, 'viewer-port': { type: 'string' }, 'dashboard-port': { type: 'string' } } });
if (!values.checkpoint || !values.output) throw new Error('checkpoint-and-new-evidence-directory-required');
const checkpoint = resolve(values.checkpoint), directory = resolve(values.output);
const yaw = Number(values.yaw), maximumActions = Number(values['max-actions']);
const targetNote = Number(values['target-note']);
const initialNote = Number(values['initial-note']);
const originX = Number(values['origin-x']), originZ = Number(values['origin-z']);
const markerVariant = Number(values['marker-variant']);
if (![0, -15, 15].includes(yaw) || !Number.isInteger(maximumActions) || maximumActions < 1 || maximumActions > 16
  || !Number.isInteger(targetNote) || targetNote < 1 || targetNote > 24
  || !Number.isInteger(initialNote) || initialNote < 0 || initialNote > 24
  || !Number.isSafeInteger(originX) || !Number.isSafeInteger(originZ)
  || ![0, 1, 2, 3].includes(markerVariant))
  throw new Error('invalid-development-case');
await mkdir(directory, { recursive: false });
const sourcePointer = JSON.parse(await readFile(checkpoint, 'utf8'));
const sourcePointerSha256 = await fileSha(checkpoint);
const configured = await loadConfiguration();
const port = (value, fallback) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('invalid-local-port');
  return number;
};
const config = { ...configured, actionBudget: maximumActions,
  minecraft: { ...configured.minecraft, port: port(values.port, configured.minecraft.port) },
  viewer: { ...configured.viewer, port: port(values['viewer-port'], configured.viewer.port),
    dashboardPort: port(values['dashboard-port'], configured.viewer.dashboardPort) } };
const plan = { version: 'CurrentGroundedNoteDevelopmentV1',
  goalOnly: { observable: 'properties.note', comparator: 'equals', target: String(targetNote) },
  layout: { id: values['case-id'], originX, originZ, side: 'west', markerVariant },
  initialNote, targetNote, initialYawOffsetDegrees: yaw, maximumNewActions: maximumActions,
  fixtureSettleTicks: 60,
  controllerChosenActionsOnly: true, noWorldCommandsAfterGoalInjection: true,
  forbiddenKinds: ['attack', 'break', 'place'],
  sourcePointerSha256, sourcePhysicalSnapshotSha256: sourcePointer.sha256 };
plan.localEndpoints = { minecraft: config.minecraft.port,
  viewer: config.viewer.port, dashboard: config.viewer.dashboardPort };
await saveJson(resolve(directory, 'FROZEN_DEVELOPMENT_PLAN.json'), plan);
const writer = new EvidenceWriterV1({
  events: createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx' }),
  frames: createWriteStream(resolve(directory, 'frames.jsonl'), { flags: 'wx' }),
});
const record = (kind, value) => writer.write(kind === 'frame' ? 'frames' : 'events',
  canonical({ kind, value }) + '\n');
// A test-world safety boundary, not a planner. All permitted basic actions
// remain available regardless of the goal or predicted outcome.
class SafeDevelopmentBody extends MinecraftBody {
  listActionOffers(observation) {
    return super.listActionOffers(observation).filter(offer => !plan.forbiddenKinds.includes(offer.action.kind));
  }
  execute(action, scope) {
    if (plan.forbiddenKinds.includes(action.kind)) throw new Error('forbidden-development-body-action');
    return super.execute(action, scope);
  }
}
const services = new Services(config, resolve(config.runtimeRoot, `grounded-note-${Date.now()}`), directory);
const compute = new Compute();
// Passive per-query timing, including Worker queue wait. It neither changes
// arguments/results nor chooses an operation or supplies a future observation.
const computeCall = compute.call.bind(compute);
let predictionQueryOrdinal = 0;
compute.call = async (method, ...args) => {
  if (method !== 'predictCandidate' && method !== 'predictContinuation' && method !== 'predictShortChain')
    return computeCall(method, ...args);
  const ordinal = ++predictionQueryOrdinal, queryStarted = performance.now();
  const identity = { ordinal, method,
    candidateId: method === 'predictCandidate' ? args[0].candidateId : null,
    patternId: method === 'predictContinuation' ? args[0] : null,
    baseSequence: (method === 'predictContinuation' ? args[2] : args[1]).sequence };
  record('physical-prediction-query-start', identity);
  try {
    const value = await computeCall(method, ...args);
    record('physical-prediction-query-completed', { ...identity,
      durationIncludingQueueMs: performance.now() - queryStarted,
      validSampleCount: value.validSampleCount ?? null,
      progressFraction: value.progressFraction ?? null,
      sampleCount: value.prediction?.samples?.length ?? value.samples?.length ?? 0,
      unknown: value.unknown });
    return value;
  } catch (error) {
    record('physical-prediction-query-failed', { ...identity,
      durationIncludingQueueMs: performance.now() - queryStarted,
      message: error.message });
    throw error;
  }
};
let body, runtime, viewer, dashboard, result, failure;
const started = performance.now();
try {
  // Restore before the world exists; parsing/qualification is not game time.
  const restored = await restoreExperience(compute, checkpoint);
  record('frozen-experience-restored', { sha256: sourcePointer.sha256,
    eventCount: sourcePointer.eventCount, actions: sourcePointer.actions, writes: sourcePointer.writes,
    eventIds: restored.snapshot.seenEventIds,
    relationIds: restored.snapshot.r2a.relations.map(value => value.relationId),
    physicalTraceIds: {
      r1: restored.snapshot.r1Medium.footprints.map(value => value.traceId),
      r2: restored.snapshot.r2Medium.footprints.map(value => value.traceId),
      r2a: restored.snapshot.r2a.medium.footprints.map(value => value.traceId),
    } });
  await services.start('empty');
  services.command('gamerule doWeatherCycle false');
  services.command(`forceload add ${originX - 16} ${originZ - 16} ${originX + 16} ${originZ + 16}`);
  body = new SafeDevelopmentBody({ ...config.minecraft, worldId: `grounded-note-${sha(plan).slice(0, 16)}`,
    sessionId: sha({ plan, started: Date.now() }), activeSecondsOffset: restored.snapshot.activeSeconds }, record);
  await body.ready();
  const prepared = await prepareGuidedNoteFixtureLiveV1(services, body, plan.layout, initialNote, yaw, { clearRadius: 10 });
  const first = prepared.observation;
  await body.waitTicks(plan.fixtureSettleTicks);
  const second = body.latest();
  if (second.objects.filter(object => object.type === 'note_block').length !== 1
    || !second.objects.some(object => object.id === prepared.controlId && object.properties.note === String(initialNote)))
    throw new Error('heldout-note-fixture-not-stably-public');
  record('fixture-public-ready', { first, second, targetId: prepared.controlId });
  runtime = new V5Runtime(body, config, directory, record, { compute, restoredExperience: restored });
  if (config.viewer.enabled) {
    viewer = await startLoopbackMineflayerViewerV1(body.bot, { host: config.viewer.host,
      port: config.viewer.port, firstPerson: true, viewDistance: 3 });
    dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
    record('viewer-endpoint', { firstPerson: viewer.url,
      dashboard: `http://${config.viewer.host}:${config.viewer.dashboardPort}/`, readOnly: true });
  }
  const goal = { version: 'GroundedGoalV1', id: `heldout-public-note-${targetNote}`, expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'target-state',
    subject: { kind: 'public-object', id: prepared.controlId, expectedType: 'note_block' },
    observable: 'properties.note', comparator: 'equals', target: String(targetNote) } } };
  record('final-goal-injected', { goal, observation: body.latest(), fixtureComplete: true });
  result = await runtime.runGoal(goal);
  record('goal-controller-result', result);
  if (writer.failure) throw writer.failure;
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  record('development-error', failure);
} finally {
  await viewer?.close();
  if (dashboard) await new Promise(done => dashboard.close(done));
  try {
    if (runtime) await runtime.close();
    else { await body?.close(); await compute.close(); }
  } catch (error) {
    record('cleanup-error', { message: error.message, stack: error.stack });
    failure ??= { message: error.message, stack: error.stack };
    await body?.close(); await compute.close();
  }
  await services.stop();
  await writer.end();
  failure ??= writer.failure ? { message: writer.failure.message } : undefined;
  await saveJson(resolve(directory, 'RUN_RESULT.json'), { plan, result, failure: failure ?? null,
    durationMs: performance.now() - started,
    newActions: runtime ? runtime.actions - sourcePointer.actions : 0,
    newEvents: runtime?.newEventCount ?? 0,
    sourcePointerUnchanged: sourcePointerSha256 === await fileSha(checkpoint),
    rawEventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
    rawFramesSha256: await fileSha(resolve(directory, 'frames.jsonl')),
    qualification: 'raw-development-outcome-awaits-physical-drive-audit' });
}
if (failure || result?.status !== 'goal-verified') process.exitCode = 1;
