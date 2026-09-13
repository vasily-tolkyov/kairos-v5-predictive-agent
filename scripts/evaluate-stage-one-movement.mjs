import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { gzip, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Services } from '../dist/src/services.js';
import { MinecraftExperienceEnvironment, anonymousObservation } from '../dist/src/adapters/minecraft/experience.js';
import { StageOneMovement, StageOneController } from '../dist/src/stage-one-movement.js';
import { MinecraftBodyConnection } from './minecraft-body-connection.mjs';
import { EvidenceJournal } from './evidence-journal.mjs';

const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' }, output: { type: 'string' },
  protocol: { type: 'string' }, case: { type: 'string' }, condition: { type: 'string' },
  model: { type: 'string' }, 'model-sha256': { type: 'string' }, continue: { type: 'string' },
  seed: { type: 'string' }, port: { type: 'string', default: '25638' } } });
assert(values.java && values.server && values.output && values.protocol && values.case && values.condition);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const protocolBytes = await readFile(values.protocol), protocol = JSON.parse(protocolBytes);
assert.equal(protocol.version, 'StageOneMovementProtocol1');
assert(['training', 'prepare', 'retained-frozen', 'erased-frozen'].includes(values.condition));
const training = values.condition === 'training', prepare = values.condition === 'prepare';
const spec = training ? protocol.training : protocol.testCases.find(value => value.id === values.case);
assert(spec && spec.id === values.case, 'unregistered case');
assert(Number.isSafeInteger(Number(values.seed)) && protocol.controllerSeeds.includes(Number(values.seed)));
const goal = training || prepare ? null : protocol.goal;
const limit = prepare ? { decisions: 0, seconds: 0 } : training ? protocol.trainingBudget : protocol.testBudget;
assert(!values.continue || !training && !prepare, 'only paired tests continue prepared worlds');
assert(training || prepare || values.continue, 'paired tests require a stopped identical-world fork');
const output = resolve(values.output); await mkdir(output);
const save = (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
const zip = promisify(gzip), journal = new EvidenceJournal(output);
await mkdir(resolve(output, 'events')); await mkdir(resolve(output, 'passive-events'));
let model = new StageOneMovement(), modelSource = null;
if (values.condition === 'retained-frozen') {
  assert(values.model && /^[a-f0-9]{64}$/.test(values['model-sha256']));
  const bytes = await readFile(values.model); assert.equal(hash(bytes), values['model-sha256']);
  const state = JSON.parse(gunzipSync(bytes)); assert.equal(state.version, 'StageOneSession1');
  model = StageOneMovement.restore(state.medium); modelSource = { path: resolve(values.model), sha256: hash(bytes) };
} else assert(!values.model && !values['model-sha256'], 'model supplied to a fresh/erased condition');
const controller = new StageOneController(model, Number(values.seed));
const predecessor = values.continue ? JSON.parse(await readFile(resolve(values.continue, 'results.json'))) : null;
if (predecessor) {
  assert(predecessor.stoppedAt && predecessor.status === 'prepared');
  assert.equal(predecessor.stageCase, values.case);
  assert.equal(predecessor.protocolSha256, protocol.preparedProtocolSha256 ?? hash(protocolBytes));
  assert.deepEqual(predecessor.protocol.setupCommands, protocol.setupCommands);
  assert.equal(predecessor.protocol.worldSeed, protocol.worldSeed);
  assert.deepEqual(predecessor.protocol.testCases.find(value => value.id === values.case), spec);
  assert.equal(predecessor.final.executed, 0); assert.equal(predecessor.final.writes, 0);
}
const runtimeRoot = predecessor?.runtimeRoot ?? resolve(output, 'runtime');
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port), username: 'KairosStageOne',
  java: resolve(values.java), serverJar: resolve(values.server) } };
const services = new Services(config, runtimeRoot, resolve(output, 'server-evidence'));
const initialDigest = hash(JSON.stringify(model.snapshot()));
const report = { version: 'StageOneNativeEvaluation1', status: 'running', startedAt: new Date().toISOString(), runtimeRoot,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  stageCase: values.case, condition: values.condition, protocolSha256: hash(protocolBytes), protocol,
  controllerSeed: Number(values.seed), modelSource, predecessor: values.continue ?? null,
  initialStats: { decisions: 0, executed: 0, writes: model.writes }, initialLearningDigest: initialDigest,
  limitations: ['Small flat static fixture; endpoint-only model, no continuous-state/multistage/long-term claim.',
    'RGBD/body geometry are engineered sensing. Four existing movement offers only; no route or effect supplied.',
    'Raw passive frames are archived but are not trained by this endpoint movement prototype.'] };
report.executedBuildHashes = Object.fromEntries(await Promise.all((await readdir(new URL('../dist/src/', import.meta.url), { recursive: true }))
  .filter(name => name.endsWith('.js')).sort().map(async name => [name, hash(await readFile(new URL('../dist/src/' + name, import.meta.url)))])));
report.executedHarnessHashes = Object.fromEntries(await Promise.all(['evaluate-stage-one-movement.mjs', 'minecraft-body-connection.mjs', 'evidence-journal.mjs']
  .map(async name => [name, hash(await readFile(new URL(name, import.meta.url)))])));
await save('protocol.json', report);
let body, environment, decisions = 0, executed = 0, passive = 0, activeStarted, stopping = false;
let diagnostics = Promise.resolve(), diagnosticError = null, confirmations = 0, initial;
process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
const record = (kind, value) => {
  if (kind === 'frame') return;
  diagnostics = diagnostics.then(() => journal.write('body-diagnostics', { kind, value }))
    .catch(error => { diagnosticError = error; });
};
const archivePassive = async events => {
  for (const event of events) {
    const path = 'passive-events/' + String(++passive).padStart(7, '0') + '.json.gz';
    await writeFile(resolve(output, path), await zip(JSON.stringify(event)), { flag: 'wx' });
  }
};
const telemetry = async () => {
  const batch = body.takePhysicalTelemetry(); await journal.write('raw-telemetry', batch);
  if (batch.gap) throw new Error('stage-one-telemetry-gap');
};
const checkpoint = async () => {
  await writeFile(resolve(output, 'session.json.gz'), await zip(JSON.stringify({ version: 'StageOneSession1', medium: model.snapshot(), steps: decisions })));
};
try {
  await services.start(predecessor ? 'preserve' : 'empty', { difficulty: 'peaceful', worldSeed: String(protocol.worldSeed) });
  if (!predecessor) for (const command of protocol.setupCommands) services.command(command);
  services.command('difficulty'); await services.server.ready(/The difficulty is Peaceful/i);
  await save('static-setup.json', { commands: predecessor ? [] : protocol.setupCommands, controllerAccess: false, runtimeRuleCallbacks: false });
  body = new MinecraftBodyConnection({ ...config.minecraft, worldId: 'stage-one-anonymous' }, record);
  await body.ready();
  if (!predecessor) services.command(`tp KairosStageOne ${spec.start.join(' ')} ${spec.yawDegrees} 0`);
  await delay(750);
  environment = new MinecraftExperienceEnvironment(body); initial = await environment.initialize();
  await save('initial-observation.json', initial); await telemetry();
  await archivePassive(await environment.drainPassiveEvents());
  if (predecessor) {
    const expected = predecessor.finalObservation;
    assert(expected && initial.self.position.every((value, i) => Math.abs(value - expected.self.position[i]) < 1e-6));
    assert(Math.abs(initial.self.yaw - expected.self.yaw) < 1e-6, 'paired orientation differs');
    assert.deepEqual(initial.self.properties, expected.self.properties, 'paired body state differs');
  }
  await checkpoint(); activeStarted = performance.now(); report.activeStartedAt = new Date().toISOString();
  for (; decisions < limit.decisions; ) {
    if (stopping || existsSync(resolve(output, 'PAUSE'))) { report.status = 'operator-paused'; break; }
    if ((performance.now() - activeStarted) / 1000 >= limit.seconds) { report.status = 'duration-paused'; break; }
    await archivePassive(await environment.drainPassiveEvents()); await telemetry();
    const observed = await environment.observe(), began = performance.now();
    const choice = controller.choose(observed, environment.listActionOffers(observed), goal);
    const choiceMs = performance.now() - began; assert(choice, 'no-movement-offer');
    let bound = null, preparationMs = null;
    const receipt = await environment.executeOffer(choice.offer, start => {
      const began = performance.now();
      bound = { observationSequence: start.observation.sequence, self: start.observation.self,
        prediction: model.predict(start.observation, start.offer) };
      preparationMs = performance.now() - began; return true;
    });
    decisions++; await archivePassive(receipt.precedingPassiveEvents ?? []);
    let comparison = null, learning = null, learningMs = 0, eventPath = null;
    if (receipt.event) {
      controller.recordExecution(receipt.event.cue);
      executed++; eventPath = 'events/' + String(executed).padStart(7, '0') + '.json.gz';
      await writeFile(resolve(output, eventPath), await zip(JSON.stringify(receipt.event)), { flag: 'wx' });
      const first = receipt.event.frames[0], last = receipt.event.frames.at(-1);
      assert.equal(first.sequence, bound.observationSequence, 'prediction did not bind actual start');
      const actual = last.self.position.map((value, i) => value - first.self.position[i]);
      const predicted = bound.prediction.displacement;
      const error = predicted ? Math.hypot(predicted[0] - actual[0], predicted[2] - actual[2]) : null;
      const selectedPrediction = choice.prediction.displacement;
      const selectionError = selectedPrediction ? Math.hypot(selectedPrediction[0] - actual[0], selectedPrediction[2] - actual[2]) : null;
      comparison = { actual, predicted, supported: bound.prediction.supported, error,
        matched: error === null ? null : error <= protocol.predictionErrorTolerance,
        selectionSupported: choice.prediction.supported, selectionError,
        selectionMatched: selectionError === null ? null : selectionError <= protocol.predictionErrorTolerance,
        blocked: Math.hypot(actual[0], actual[2]) <= protocol.blockedDisplacementThreshold };
      if (training) { const began = performance.now(); learning = model.observe(receipt.event); learningMs = performance.now() - began; }
    }
    await telemetry();
    const distance = goal ? Math.hypot(receipt.observation.self.position[0] - goal[0], receipt.observation.self.position[2] - goal[2]) : null;
    confirmations = distance !== null && distance <= protocol.goalTolerance ? confirmations + 1 : 0;
    if (confirmations) {
      let confirmedFrame = receipt.observation;
      while (confirmations < protocol.goalConfirmations) {
        confirmedFrame = await environment.waitForObservationAfter(confirmedFrame.sequence);
        const error = Math.hypot(confirmedFrame.self.position[0] - goal[0], confirmedFrame.self.position[2] - goal[2]);
        await journal.write('goal-confirmations', { sequence: confirmedFrame.sequence, self: confirmedFrame.self, error });
        if (error > protocol.goalTolerance) { confirmations = 0; break; }
        confirmations++;
      }
      await telemetry();
    }
    await journal.write('decisions', { decision: decisions, choice, choiceMs, bound, preparationMs,
      executed: receipt.executed, executionBinding: receipt.executionBinding, eventPath, comparison, learning, learningMs,
      after: receipt.observation.self, distance, confirmations, elapsedSeconds: (performance.now() - activeStarted) / 1000,
      rssMB: process.memoryUsage().rss / 1048576 });
    if (decisions % 16 === 0) {
      await checkpoint(); console.log(JSON.stringify({ decisions, executed, writes: model.writes, position: receipt.observation.self.position,
        seconds: (performance.now() - activeStarted) / 1000 }));
    }
    if (confirmations >= protocol.goalConfirmations) { report.status = 'goal-verified'; break; }
  }
  if (report.status === 'running') report.status = prepare ? 'prepared' : 'budget-paused';
} catch (error) { report.status = 'fault-paused'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  report.final = { decisions, executed, writes: model.writes, passiveWindows: passive };
  report.seconds = activeStarted ? (performance.now() - activeStarted) / 1000 : null;
  report.finalLearningDigest = hash(JSON.stringify(model.snapshot()));
  if (!training && report.finalLearningDigest !== initialDigest) { report.status = 'frozen-state-mutated'; process.exitCode = 1; }
  try {
    report.finalObservation = environment ? await environment.observe() : null;
    if (environment) { await archivePassive(await environment.drainPassiveEvents()); await telemetry(); }
    services.command('data get entity KairosStageOne Pos'); await delay(200);
  } catch (error) {
    report.finalObservation = null; report.finalObservationUnavailable = String(error.stack ?? error);
    report.lastReceivedBodyEvidence = body?.lastReceivedObservationForEvidence();
    if (report.lastReceivedBodyEvidence?.observation) report.lastReceivedBodyEvidence.observation = anonymousObservation(report.lastReceivedBodyEvidence.observation);
    report.status = 'fault-paused'; process.exitCode = 1;
  }
  await checkpoint();
  try { await body?.close(); } catch (error) { (report.cleanupErrors ??= []).push(String(error)); process.exitCode = 1; }
  try { await services.stop(); report.stoppedAt = new Date().toISOString(); }
  catch (error) { (report.cleanupErrors ??= []).push(String(error)); process.exitCode = 1; }
  if (report.cleanupErrors?.length) report.status = 'fault-paused';
  try { await diagnostics; if (diagnosticError) throw diagnosticError; report.journal = await journal.export(); }
  catch (error) { report.status = 'evidence-incomplete'; report.evidenceError = String(error); process.exitCode = 1; }
  report.final.passiveWindows = passive;
  await save('results.json', report); console.log(JSON.stringify({ status: report.status, error: report.error, ...report.final, seconds: report.seconds }));
}
