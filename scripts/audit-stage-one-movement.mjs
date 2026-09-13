import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';

const [source, build, output] = process.argv.slice(2);
assert(output, 'usage: STOPPED_STAGE_ONE_RUN PINNED_ACTOR_DIST NEW_AUDIT_JSON');
const root = resolve(source), hash = value => createHash('sha256').update(value).digest('hex');
const report = JSON.parse(await readFile(resolve(root, 'results.json')));
assert(report.stoppedAt && report.version === 'StageOneNativeEvaluation1');
const decisions = (await readFile(resolve(root, 'decisions.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const sessionBytes = await readFile(resolve(root, 'session.json.gz')), checkpoint = JSON.parse(gunzipSync(sessionBytes));
const { StageOneMovement } = await import(pathToFileURL(resolve(build, 'src/stage-one-movement.js')));
const { validateEvent } = await import(pathToFileURL(resolve(build, 'src/events.js')));
const { sha } = await import(pathToFileURL(resolve(build, 'src/util.js')));
const modules = ['stage-one-movement.js', 'contextual-readout.js', 'experience-ledger.js', 'events.js', 'util.js'];
for (const name of modules) assert.equal(hash(await readFile(resolve(build, 'src', name))), report.executedBuildHashes[name]);
const result = { version: 'StageOneNativeAudit1', source: root, status: 'running',
  reportSha256: hash(await readFile(resolve(root, 'results.json'))), sessionSha256: hash(sessionBytes),
  auditScriptSha256: hash(await readFile(new URL(import.meta.url))), failures: [],
  scope: 'Stopped native action/forecast audit plus private discarded chronological replay for accounting and CPU diagnosis. Replay supplies zero new physical actions, independent experience or capability.',
  replayNewPhysicalActions: 0, replayNewIndependentWindows: 0, capabilityEstablished: false };
const check = (condition, reason) => { if (!condition) result.failures.push(reason); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const p95 = rows => rows.length ? [...rows].sort((a, b) => a - b)[Math.ceil(.95 * rows.length) - 1] : null;
let model = new StageOneMovement();
if (report.modelSource) model = StageOneMovement.restore(JSON.parse(gunzipSync(await readFile(report.modelSource.path))).medium);
check(hash(JSON.stringify(model.snapshot())) === report.initialLearningDigest, 'wrong-starting-model');
const raw = new Map(); let gaps = 0, rawRecords = 0;
for (const line of (await readFile(resolve(root, 'raw-telemetry.jsonl'), 'utf8')).split('\n').filter(Boolean)) {
  const batch = JSON.parse(line); gaps += Number(Boolean(batch.gap));
  for (const row of batch.records) if (row.kind === 'frame') {
    rawRecords++; const prior = raw.get(row.observation.sequence);
    check(!prior || equal(prior, row.observation), 'conflicting-raw-frame:' + row.observation.sequence);
    raw.set(row.observation.sequence, row.observation);
  }
}
const inspector = new Session(); inspector.connect(); const post = promisify(inspector.post).bind(inspector);
await post('Profiler.enable'); await post('Profiler.start');
const timings = [], outcomes = [], ids = new Set(); let executed = 0, qualified = 0, writes = 0;
try {
  for (const [index, decision] of decisions.entries()) {
    check(decision.decision === index + 1, 'decision-order');
    if (!decision.executed) { check(!decision.eventPath, 'refused-with-event'); continue; }
    executed++; const eventBytes = await readFile(resolve(root, decision.eventPath));
    const event = JSON.parse(gunzipSync(eventBytes)); validateEvent(event);
    check(!ids.has(event.id), 'reused-event:' + event.id); ids.add(event.id);
    const first = event.frames[0], last = event.frames.at(-1), receipt = event.bodyResult.motorReceipt;
    check(first.sequence === decision.bound?.observationSequence && equal(first.self, decision.bound.self), 'stale-start:' + index);
    check(decision.executionBinding?.status === 'accepted', 'missing-accepted-start:' + index);
    for (const frame of event.frames) {
      const original = raw.get(frame.sequence);
      check(original && equal(original.self.position, frame.self.position) && equal(original.physicalClock, frame.physicalClock)
        && equal(original.sensation, frame.sensation), 'source-frame-mismatch:' + frame.sequence);
    }
    const expected = model.predict(first, decision.choice.offer);
    check(equal(expected, decision.bound.prediction), 'recorded-pre-update-prediction-differs:' + index);
    const actual = last.self.position.map((value, i) => value - first.self.position[i]);
    const error = expected.displacement ? Math.hypot(expected.displacement[0] - actual[0], expected.displacement[2] - actual[2]) : null;
    const blocked = Math.hypot(actual[0], actual[2]) <= report.protocol.blockedDisplacementThreshold;
    check(equal(actual, decision.comparison.actual) && error === decision.comparison.error
      && blocked === decision.comparison.blocked && expected.supported === decision.comparison.supported, 'forecast-score-mismatch:' + index);
    const measured = receipt && receipt.actualTicks === 4 && receipt.actualSeconds === .2;
    qualified += Number(Boolean(measured));
    let receiptReplay = null;
    if (report.condition === 'training') {
      const before = performance.now(); receiptReplay = model.observe(event); timings.push(performance.now() - before);
      check(equal(receiptReplay, decision.learning), 'learning-receipt-mismatch:' + index);
      writes += Number(receiptReplay.learned);
    }
    outcomes.push({ decision: index + 1, eventId: event.id, file: decision.eventPath, sha256: hash(eventBytes),
      direction: event.cue.parameters.direction, actual, blocked, supported: expected.supported, error,
      matched: error !== null && error <= report.protocol.predictionErrorTolerance, measured,
      learned: receiptReplay?.learned ?? false });
  }
} catch (error) { result.failures.push(String(error.stack ?? error)); }
const { profile } = await post('Profiler.stop'); inspector.disconnect();
await writeFile(output + '.cpuprofile', JSON.stringify(profile), { flag: 'wx' });
const nodes = new Map(profile.nodes.map(node => [node.id, node])), self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const node = nodes.get(profile.samples[i]), name = node.callFrame.functionName + ' @ ' + node.callFrame.url + ':' + (node.callFrame.lineNumber + 1);
  self.set(name, (self.get(name) ?? 0) + profile.timeDeltas[i] / 1000);
}
result.privateReplay = { exactFinalModel: equal(model.snapshot(), checkpoint.medium), finalDigest: hash(JSON.stringify(model.snapshot())),
  totalLearningMs: timings.reduce((a, b) => a + b, 0), topSelfMilliseconds: [...self].sort((a, b) => b[1] - a[1]).slice(0, 20) };
check(result.privateReplay.exactFinalModel, 'final-model-differs');
check(hash(JSON.stringify(checkpoint.medium)) === report.finalLearningDigest, 'reported-final-digest-differs');
check(decisions.length === report.final.decisions && executed === report.final.executed && checkpoint.steps === decisions.length, 'final-counts-differ');
check(writes === report.final.writes - report.initialStats.writes, 'write-delta-differs');
check(!gaps && report.status !== 'fault-paused' && !report.cleanupErrors, 'native-integrity-fault');
check(Boolean(report.finalObservation), 'final-observation-unavailable');
const serverLog = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
check(/The difficulty is Peaceful/.test(serverLog), 'peaceful-not-engine-confirmed');
const positionText = [...serverLog.matchAll(/KairosStageOne has the following entity data: \[([^\]]+)\]/g)].at(-1)?.[1];
const serverPosition = positionText?.split(',').map(value => Number(value.trim().replace(/d$/, ''))) ?? null;
result.serverPosition = serverPosition;
result.finalPositionDifference = serverPosition && report.finalObservation ? Math.hypot(...serverPosition.map((value, i) => value - report.finalObservation.self.position[i])) : null;
check(result.finalPositionDifference !== null && result.finalPositionDifference < .05, 'final-native-player-disagreement');
const supported = outcomes.filter(row => row.supported), available = outcomes.filter(row => row.error !== null);
result.metrics = { decisions: decisions.length, executed, refused: decisions.length - executed,
  executedFraction: executed / Math.max(1, decisions.length), writes, qualifiedOriginalMoves: qualified, seconds: report.seconds,
  choicePreparationP95Ms: p95(decisions.map(row => row.choiceMs + (row.preparationMs ?? 0))),
  learningP95Ms: p95(decisions.filter(row => row.executed).map(row => row.learningMs)),
  supportedPredictions: supported.length, supportedCorrect: supported.filter(row => row.matched).length,
  missingPredictions: executed - available.length, unsupportedPredictions: available.length - supported.length,
  allAvailablePredictions: available.length, allAvailableCorrect: available.filter(row => row.matched).length,
  blocked: outcomes.filter(row => row.blocked).length, moving: outcomes.filter(row => !row.blocked).length,
  rawFrames: raw.size, rawRecords, telemetryGaps: gaps,
  byDirection: Object.fromEntries(['forward', 'back', 'left', 'right'].map(direction => [direction, outcomes.filter(row => row.direction === direction).length])),
  learnedTaskChoices: decisions.filter(row => row.choice.mode === 'learned-progress').length };
const gate = report.protocol.acquisitionGate, m = result.metrics;
result.acquisitionGate = report.condition === 'training' ? {
  counts: m.decisions === gate.completedDecisions && m.executed >= gate.minimumExecuted && m.qualifiedOriginalMoves >= gate.minimumQualifiedOriginalWrites,
  timing: m.choicePreparationP95Ms <= gate.maximumChoicePlusPreparationP95Ms && m.learningP95Ms <= gate.maximumLearningP95Ms,
  integrity: result.failures.length === 0 } : null;
result.acquisitionGatePassed = result.acquisitionGate ? Object.values(result.acquisitionGate).every(Boolean) : null;
result.outcomes = outcomes;
result.status = result.failures.length ? 'incomplete' : 'audited';
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, metrics: result.metrics, acquisitionGate: result.acquisitionGate, failures: result.failures,
  privateReplay: result.privateReplay }));
process.exitCode = result.failures.length ? 1 : 0;
