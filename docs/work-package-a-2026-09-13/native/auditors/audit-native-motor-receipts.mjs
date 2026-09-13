import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateEvent } from '../dist/src/events.js';

// Evaluator-only: compare the recorded control state and server reply to the
// embedded motor receipt. This does not train a model or prove task success.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: NATIVE_MOTOR_CATCHUP_OUTPUT NEW_AUDIT_JSON');
const root = resolve(source), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const reportBytes = await readFile(resolve(root, 'results.json')), report = JSON.parse(reportBytes);
const windowBytes = await readFile(resolve(root, 'windows.json.gz'));
const windows = JSON.parse(gunzipSync(windowBytes));
const records = JSON.parse(await readFile(resolve(root, 'body-records.json')));
const serverLog = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
assert.equal(report.status, 'passed'); assert(report.stoppedAt);
assert.equal(report.expectation, 'exact'); assert.equal(report.autonomousTrials, 0); assert.equal(report.learningWrites, 0);
assert.equal(sha(windowBytes), report.windowsSha256);
assert.equal(sha(await readFile(resolve(report.build, 'src/body.js'))), report.bodySha256);
assert(/difficulty is Peaceful/i.test(serverLog));
const serverReplies = [...serverLog.matchAll(/KairosMotor has the following entity data: (.+)/g)].map(match => match[1]);
assert.deepEqual(serverReplies, report.enginePositionReplies);
assert.equal(windows.length, 6); assert.equal(report.trials.length, windows.length);
const trials = report.trials.map((trial, index) => {
  const event = windows[index]; validateEvent(event);
  assert.equal(event.id, trial.eventId);
  assert.deepEqual(event.frames[0].self, trial.before);
  assert.deepEqual(event.frames.at(-1).self, trial.after);
  assert.equal(trial.controls.length, event.frames.length - 1);
  trial.controls.forEach((sample, i) => assert.equal(sample.ordinal, i + 1));
  const pressedTicks = trial.controls.filter(sample => sample.pressed).length;
  assert.equal(pressedTicks, 4); assert.equal(pressedTicks, trial.pressedTicks);
  const receipt = event.bodyResult.motorReceipt;
  assert(receipt, 'new native motor event is missing its embedded receipt');
  assert.equal(receipt.actualTicks, pressedTicks); assert.equal(receipt.requestedTicks, 4);
  assert.equal(receipt.actualSeconds, pressedTicks * .05);
  assert.equal(receipt.releaseReason, 'interval-complete');
  const releases = records.filter(record => record.kind === 'body-motor-release'
    && record.value.startSequence === event.frames[0].sequence).map(record => record.value);
  assert.equal(releases.length, 1); assert.deepEqual(releases, trial.releases);
  const instrumented = records.filter(record => record.kind === 'body-motor-receipt'
    && record.value.requestedAt.observationSequence === event.frames[0].sequence);
  assert.equal(instrumented.length, 1); assert.deepEqual(instrumented[0].value, receipt);
  const serverPosition = JSON.parse(serverReplies[index].replace(/d/g, ''));
  serverPosition.forEach((value, axis) => assert(Math.abs(value - trial.after.position[axis]) < 1e-9));
  return { eventId: event.id, loaded: trial.load, round: trial.round, pressedTicks,
    motorReceipt: receipt, serverPosition };
});
const result = { version: 'NativeMotorReceiptAudit1', status: 'passed', source: root,
  reportSha256: sha(reportBytes), windowsSha256: sha(windowBytes), bodySha256: report.bodySha256,
  evaluatorSelectedPhysicalActions: trials.length, autonomousTrials: 0, learningWrites: 0, trials,
  limitation: 'Isolated peaceful movement timing only; no retention or causal multistage outcome. Jump/item interruption is tested separately.' };
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, output: resolve(output), pressedTicks: trials.map(trial => trial.pressedTicks) }));
