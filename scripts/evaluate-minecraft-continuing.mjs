import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ExperienceSession, ExperienceMedium } from '../dist/src/prototype.js';
import { MinecraftBodyConnection } from './minecraft-body-connection.mjs';
import { MinecraftExperienceEnvironment } from '../dist/src/adapters/minecraft/experience.js';
import { Services } from '../dist/src/services.js';
import { GroundedGoalEvaluatorV1 } from '../dist/src/control/goal.js';
import { EvidenceJournal } from './evidence-journal.mjs';

const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, restore: { type: 'string' }, continue: { type: 'string' }, seed: { type: 'string', default: '317' },
  goal: { type: 'string' },
  'migrated-session': { type: 'string' },
  steps: { type: 'string', default: '256' }, seconds: { type: 'string', default: '1800' },
  port: { type: 'string', default: '25587' }, 'goal-after': { type: 'string', default: '64' },
  'wall-depth': { type: 'string', default: '2' }, 'half-width': { type: 'string', default: '5' },
  'start-x': { type: 'string', default: '.5' },
  environment: { type: 'string', default: 'enclosure' }, 'world-seed': { type: 'string' },
  difficulty: { type: 'string' },
  'goal-distance': { type: 'string', default: '12' },
  'task-only': { type: 'boolean' }, 'frozen': { type: 'boolean' }, material: { type: 'string', default: 'oak_planks' } } });
if (!values.java || !values.server || !values.output) throw new Error('required: --java --server --output NEW_DIRECTORY');
if (values.continue && values.restore) throw new Error('continue-and-transfer-restore-are-distinct');
if (values['migrated-session'] && !values.continue) throw new Error('a-migrated-session-requires-its-stopped-predecessor');
if (!['enclosure', 'natural'].includes(values.environment)) throw new Error('invalid-environment');
if (values.difficulty && !['peaceful', 'easy', 'normal', 'hard'].includes(values.difficulty)) throw new Error('invalid-difficulty');
const number = key => {
  const value = Number(values[key]); if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid-' + key); return value;
};
if (!['oak_planks', 'birch_planks', 'spruce_planks'].includes(values.material)) throw new Error('invalid-fixture-material');
const depth = number('wall-depth'), halfWidth = number('half-width'), startX = Number(values['start-x']);
if (depth < 1 || depth > 4 || halfWidth < 3 || halfWidth > 7 || !Number.isFinite(startX)
  || Math.abs(startX) >= halfWidth - .5) throw new Error('invalid-static-fixture-geometry');
const root = resolve(values.output), compress = promisify(gzip), decompress = promisify(gunzip);
await mkdir(root); await mkdir(resolve(root, 'events')); await mkdir(resolve(root, 'passive-events'));
const save = (name, value) => writeFile(resolve(root, name), JSON.stringify(value, null, 2));
const journal = new EvidenceJournal(root), log = (name, value) => journal.write(name, value);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: number('port'), username: 'KairosContinuing',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const predecessor = values.continue ? resolve(values.continue) : null;
const previousReport = predecessor ? JSON.parse(await readFile(resolve(predecessor, 'results.json'), 'utf8')) : null;
const worldKind = predecessor ? previousReport?.protocol?.environment ?? 'enclosure' : values.environment;
if (previousReport && (!previousReport.final
  || !['operator-paused', 'duration-paused', 'budget-paused', 'fault-paused', 'goal-verified', 'already-satisfied-goal-confirmed'].includes(previousReport.status)))
  throw new Error('only-a-checkpointed-stopped-native-world-can-continue');
const runtime = previousReport?.runtimeRoot ?? resolve(predecessor ?? root, 'runtime');
const predecessorProperties = predecessor ? await readFile(resolve(runtime, 'minecraft/server.properties'), 'utf8') : null;
const worldSeed = predecessor ? predecessorProperties
  .split(/\r?\n/).find(line => line.startsWith('level-seed='))?.slice(11)
  : values['world-seed'] ?? String(Date.now());
const previousDifficulty = predecessorProperties?.split(/\r?\n/).find(line => line.startsWith('difficulty='))?.slice(11);
const difficulty = values.difficulty ?? ({ 0: 'peaceful', 1: 'easy', 2: 'normal', 3: 'hard' }[previousDifficulty]
  ?? previousDifficulty ?? (worldKind === 'natural' ? 'normal' : 'peaceful'));
if (!['peaceful', 'easy', 'normal', 'hard'].includes(difficulty)) throw new Error('invalid-inherited-difficulty');
const services = new Services(config, runtime, resolve(root, 'server-evidence'));
let session = new ExperienceSession(new ExperienceMedium(number('seed')));
const restorePath = values['migrated-session'] ? resolve(values['migrated-session'])
  : predecessor ? resolve(predecessor, 'session.json.gz') : values.restore ? resolve(values.restore) : null;
let checkpointMigration = null;
if (restorePath) {
  const bytes = await readFile(restorePath);
  let state = JSON.parse((bytes[0] === 31 ? await decompress(bytes) : bytes).toString());
  if (values['migrated-session']) {
    if (state.version !== 'ReencodedNativeCheckpoint1' || state.predecessor !== predecessor || state.newPhysicalTrials !== 0
      || state.sourceSessionSha256 !== createHash('sha256').update(await readFile(resolve(predecessor, 'session.json.gz'))).digest('hex'))
      throw new Error('migrated-checkpoint-does-not-match-its-original-predecessor');
    const { session: migrated, ...metadata } = state; checkpointMigration = { ...metadata, path: restorePath,
      sha256: createHash('sha256').update(bytes).digest('hex') }; state = migrated;
  }
  session = state.version === 'ExperienceSession1' ? ExperienceSession.restore(state, { sameWorld: Boolean(predecessor) })
    : new ExperienceSession(ExperienceMedium.restore(state));
  if (predecessor && (state.version !== 'ExperienceSession1' || session.stats.writes !== previousReport.final.writes
    || session.stats.decisions !== previousReport.final.decisions)) throw new Error('predecessor-checkpoint-does-not-match-final-report');
}
const learningDigest = () => createHash('sha256').update(JSON.stringify([
  session.agent.medium.snapshot(), session.agent.affordances.snapshot()])).digest('hex');
const goalBytes = values.goal ? await readFile(resolve(values.goal)) : null;
const goalInput = goalBytes ? JSON.parse(goalBytes.toString('utf8')) : null;
const requestedGoals = goalInput ? (Array.isArray(goalInput) ? goalInput : [goalInput]) : null;
if (requestedGoals && (!requestedGoals.length || requestedGoals.length > 32
  || new Set(requestedGoals.map(goal => goal.id)).size !== requestedGoals.length)) throw new Error('invalid-native-goal-set');
if (requestedGoals?.some(goal => session.tasks.some(task => task.goal.id === goal.id
  && JSON.stringify(task.goal) !== JSON.stringify(goal)))) throw new Error('goal-id-reused-for-a-different-native-task');
if (requestedGoals) await save('requested-goals.json', requestedGoals);
const report = { version: 'ContinuingMinecraftEvaluation1', started: new Date().toISOString(),
  runtimeRoot: runtime, predecessor,
  checkpointMigration,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), seed: number('seed'),
  protocol: { steps: number('steps'), seconds: number('seconds'), goalAfter: number('goal-after'), frozen: !!values.frozen,
    frozenScope: 'transferable dynamics and affordances; current task feedback remains active',
    environment: worldKind, worldSeed, difficulty,
    difficultySource: values.difficulty ? 'explicit-command-line' : predecessor ? 'preserved-server-properties' : 'fixture-default',
    goalDistance: number('goal-distance'),
    geometry: previousReport?.protocol?.geometry ?? { wallDepth: depth, halfWidth, startX, material: values.material },
    taskOnly: !!values['task-only'], resetAfterStart: false, externalActionSelection: false,
    ...(requestedGoals ? { requestedGoals, goalSourceSha256: createHash('sha256').update(goalBytes).digest('hex') } : {}),
    boundary: worldKind === 'natural' ? `native normal terrain and ${difficulty} difficulty; no setup, teleport or runtime rule callbacks`
      : 'one static native survival enclosure; real block removal opens a low-ceiling exit; no runtime rule callbacks',
    limitations: [...(worldKind === 'natural' ? ['finite natural-world sample; goal prerequisites depend on actual terrain']
      : ['bounded enclosure, not natural open terrain']),
      ...(difficulty === 'peaceful' ? ['peaceful engine rules; no evidence of hostile survival or hunger management'] : []),
      'engineered block/entity silhouette RGBD and visible hotbar sensing; some visual assets are unsupported; not full client vision',
      'restart requires an explicit observed action; recovery does not establish survival',
      'finite duration cannot establish lifelong learning'] },
  initialWrites: session.stats.writes, initialStats: session.stats, initialLearningDigest: learningDigest(), status: 'running' };
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'scripts', 'package.json', 'package-lock.json'],
  { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
report.sourceHashes = Object.fromEntries(await Promise.all([...new Set(files)].map(async name =>
  [name, createHash('sha256').update(await readFile(name)).digest('hex')])));
// The checkout may advance while an immutable compiled copy is running.
// Identify the files actually imported by this process independently.
const buildRoot = new URL('../dist/src/', import.meta.url);
report.executedBuildHashes = Object.fromEntries(await Promise.all((await readdir(buildRoot, { recursive: true }))
  .filter(name => name.endsWith('.js')).sort().map(async name =>
    [name, createHash('sha256').update(await readFile(new URL(name, buildRoot))).digest('hex')])));
report.executedHarnessHashes = Object.fromEntries(await Promise.all(['evaluate-minecraft-continuing.mjs',
  'minecraft-body-connection.mjs', 'evidence-journal.mjs'].map(async name =>
    [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')])));
await save('protocol.json', report);
let body, environment, initial, submitted = requestedGoals
  ? requestedGoals.every(goal => session.tasks.some(task => task.goal.id === goal.id))
  : session.tasks.some(task => task.goal.id === 'reach-other-side'), events = 0, stopping = false;
let passiveEvents = 0;
const recordPassive = async windows => {
  for (const event of windows ?? []) {
    const file = 'passive-events/' + String(++passiveEvents).padStart(7, '0') + '.json.gz';
    await writeFile(resolve(root, file), await compress(JSON.stringify(event)));
    await log('passive-windows', { file, eventId: event.id, first: event.frames[0].sequence,
      last: event.frames.at(-1).sequence, frames: event.frames.length });
  }
  return windows ?? [];
};
const lifecycle = { spawns: 0, deaths: 0, recent: [] };
let diagnostics = Promise.resolve(), diagnosticError = null;
process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
const checkpoint = async () => {
  const data = await compress(JSON.stringify(session.snapshot()));
  await writeFile(resolve(root, 'session.pending.json.gz'), data); await rename(resolve(root, 'session.pending.json.gz'), resolve(root, 'session.json.gz'));
  return { compressedBytes: data.length, ...session.stats };
};
const start = Date.now();
try {
  await services.start(predecessor ? 'preserve' : worldKind === 'natural' ? 'natural' : 'empty',
    { worldSeed, difficulty: values.difficulty });
  // Read-only engine audit. The difficulty response never enters learner input.
  services.command('difficulty');
  await services.server.ready(/The difficulty is (Peaceful|Easy|Normal|Hard)/i);
  const serverLog = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  const difficultyReply = [...serverLog.matchAll(/The difficulty is (Peaceful|Easy|Normal|Hard)/gi)].at(-1)?.[1].toLowerCase();
  if (difficultyReply !== difficulty) throw new Error('engine-difficulty-does-not-match-protocol:' + difficultyReply);
  report.protocol.difficultyVerifiedByServer = difficultyReply;
  // Static fixture setup is owned by the evaluator and finishes before the
  // learner connects. Neither these names nor this geometry enters a policy.
  const commands = predecessor || worldKind === 'natural' ? [] : [`fill ${-halfWidth} 63 ${-depth - 5} ${halfWidth} 66 5 minecraft:bedrock hollow`,
    `fill ${1 - halfWidth} 64 ${-depth - 4} ${halfWidth - 1} 65 4 minecraft:air`,
    `fill ${1 - halfWidth} 64 ${-depth - 1} ${halfWidth - 1} 65 -2 minecraft:` + values.material,
    'setworldspawn 0 64 2'];
  for (const command of commands) services.command(command);
  await save('static-setup.json', { commands, taskGeometryVisibleOnlyThroughBody: true }); await delay(1000);
  body = new MinecraftBodyConnection({ ...config.minecraft, worldId: 'continuous-evaluation',
    activeSecondsOffset: previousReport?.finalObservation?.activeSeconds ?? 0 }, (kind, value) => {
    if (['body-frame-timeout', 'body-incomplete-window'].includes(kind)) {
      diagnostics = diagnostics.then(() => log('body-diagnostics', { kind, at: new Date().toISOString(), value }))
        .catch(error => { diagnosticError = error; });
    }
    if (!['body-spawn', 'body-death'].includes(kind)) return;
    lifecycle[kind === 'body-spawn' ? 'spawns' : 'deaths']++;
    lifecycle.recent.push({ kind, ...value, at: new Date().toISOString() });
    if (lifecycle.recent.length > 256) lifecycle.recent.shift();
  });
  await body.ready();
  if (!predecessor && worldKind === 'enclosure') services.command(`tp KairosContinuing ${startX} 64 2.5 180 0`);
  await delay(1000);
  const base = new MinecraftExperienceEnvironment(body);
  report.protocol.maintenanceGoals = base.maintenanceGoals; await save('protocol.json', report);
  initial = await base.observe(); await save('initial-observation.json', initial);
  await checkpoint();
  environment = { maintenanceGoals: base.maintenanceGoals,
    drainPassiveEvents: async () => recordPassive(await base.drainPassiveEvents()),
    observe: () => base.observe(), listActionOffers: observation => base.listActionOffers(observation),
    waitForObservationAfter: sequence => base.waitForObservationAfter(sequence), executeOffer: async offer => {
      const before = await base.observe(), choiceOffers = base.listActionOffers(before);
      await log('action-intents', { offer, observation: before, at: new Date().toISOString() });
      let receipt;
      try { receipt = await base.executeOffer(offer); }
      catch (error) {
        await log('action-errors', { offer, error: String(error.stack ?? error), at: new Date().toISOString() });
        throw error;
      }
      await recordPassive(receipt.precedingPassiveEvents);
      if (receipt.event) await writeFile(resolve(root, 'events', String(++events).padStart(7, '0') + '.json.gz'),
        await compress(JSON.stringify(receipt.event)));
      await log('physical-actions', { offer, choiceOffers, availableOffers: receipt.availableOffers,
        executed: receipt.executed, before: receipt.event?.frames[0]?.self ?? before.self, after: receipt.observation.self,
        eventId: receipt.event?.id, frames: receipt.event?.frames.length, eventFile: events,
        sensoryObjectsBefore: before.objects.length, sensoryObjectsAfter: receipt.observation.objects.length });
      return receipt;
    } };
  report.activeStarted = new Date().toISOString();
  for (let i = 0; i < number('steps'); i++) {
    stopping ||= existsSync(resolve(root, 'PAUSE'));
    if (stopping || (Date.now() - start) / 1000 >= number('seconds')) { report.status = stopping ? 'operator-paused' : 'duration-paused'; break; }
    if (!submitted && i >= number('goal-after')) {
      const defaultGoal = { version: 'GroundedGoalV1', id: 'reach-other-side', expression: { kind: 'predicate', predicate: {
        version: 'GoalPredicateV1', id: 'past-exit', subject: { kind: 'self' }, observable: 'position.2',
        comparator: 'less-than', target: worldKind === 'natural' ? initial.self.position[2] - number('goal-distance')
          : -report.protocol.geometry.wallDepth - 2.2 } } };
      const sensed = await base.observe(), goals = requestedGoals ?? [defaultGoal];
      report.taskInitialEvaluations = goals.map(goal => {
        const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(goal, sensed);
        return { id: goal.id, status: evaluator.evaluate(sensed).status };
      });
      report.taskInitialEvaluation = report.taskInitialEvaluations.every(value => value.status === 'satisfied') ? 'satisfied'
        : report.taskInitialEvaluations.some(value => value.status === 'mismatch') ? 'mismatch' : 'unknown';
      report.taskSubmittedAfterExecuted = session.stats.executed;
      for (const goal of goals) if (!session.tasks.some(task => task.goal.id === goal.id)) session.submit(goal);
      submitted = true;
    }
    const started = performance.now(), decision = await session.step(environment, { learn: !values.frozen });
    const current = await base.observe();
    await log('decisions', { ...decision, self: current.self, elapsedSeconds: (Date.now() - start) / 1000,
      durationMs: performance.now() - started, rssMB: process.memoryUsage().rss / 1048576, world: session.world.stats });
    if (i % 16 === 15 || decision.status === 'goal-verified') {
      const metrics = await checkpoint(); console.log(JSON.stringify({ step: i + 1, ...metrics,
        position: current.self.position, status: decision.status, seconds: (Date.now() - start) / 1000 }));
      // Independent read-only server audit; its text is not in agent input.
      services.command('data get entity KairosContinuing Pos');
      services.command('data get entity KairosContinuing Inventory');
      await log('server-audit-queries', { decision: i + 1, position: current.self.position, sequence: current.sequence });
      report.latest = metrics; report.lifecycle = lifecycle; await save('results.json', report);
    }
    if (decision.status === 'observation-stalled' || decision.status === 'no-offers') { report.status = decision.status; break; }
    if (values['task-only'] && (requestedGoals?.map(goal => goal.id) ?? ['reach-other-side'])
      .every(id => session.stats.verifiedGoals.includes(id))) {
      report.status = report.taskInitialEvaluation === 'satisfied' ? 'already-satisfied-goal-confirmed' : 'goal-verified'; break;
    }
  }
  if (report.status === 'running') report.status = 'budget-paused';
} catch (error) { report.status = 'fault-paused'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  try {
    report.final = await checkpoint(); report.tasks = session.tasks; report.seconds = (Date.now() - start) / 1000;
    try { await diagnostics; if (diagnosticError) throw diagnosticError; report.journal = await journal.export(); }
    catch (error) { report.status = 'evidence-incomplete'; report.error = String(error.stack ?? error); process.exitCode = 1; }
    report.lifecycle = lifecycle;
    report.finalLearningDigest = learningDigest();
    if (values.frozen && report.finalLearningDigest !== report.initialLearningDigest) {
      report.status = 'frozen-state-mutated'; report.error = 'A frozen trial changed learned state'; process.exitCode = 1;
    }
    report.finalObservation = body ? await environment?.observe() : null; await save('results.json', report);
    console.log(JSON.stringify({ status: report.status, error: report.error, ...report.final, seconds: report.seconds }));
  } finally {
    await body?.close(); await services.stop();
    report.stoppedAt = new Date().toISOString(); await save('results.json', report);
  }
}
