import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateEvent } from '../dist/src/events.js';

const [controlRoot, candidateRoot, output] = process.argv.slice(2);
if (!output) throw new Error('usage: CONTROL_ROOT CANDIDATE_ROOT NEW_JSON');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runs = [];
for (const root of [controlRoot, candidateRoot]) {
  const reportBytes = await readFile(resolve(root, 'results.json'));
  const report = JSON.parse(reportBytes), bytes = await readFile(resolve(root, 'windows.json.gz'));
  const windows = JSON.parse(gunzipSync(bytes));
  const recordBytes = await readFile(resolve(root, 'body-records.json'));
  const records = JSON.parse(recordBytes);
  assert.equal(report.version, 'NativeMotorCatchupCalibration1');
  assert.equal(report.status, 'passed'); assert(report.stoppedAt);
  assert.equal(report.learningWrites, 0); assert.equal(report.autonomousTrials, 0);
  assert.equal(report.engineDifficulty, 'peaceful'); assert.equal(sha(bytes), report.windowsSha256);
  assert.equal(sha(await readFile(resolve(report.build, 'src/body.js'))), report.bodySha256);
  assert.equal(windows.length, 6); assert.equal(report.trials.length, 6);
  const trials = report.trials.map((trial, index) => {
    const event = windows[index]; validateEvent(event);
    assert.equal(event.id, trial.eventId);
    assert.deepEqual(event.cue, { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null });
    assert.deepEqual(event.frames[0].self, trial.before);
    assert.deepEqual(event.frames.at(-1).self, trial.after);
    assert.equal(trial.controls.length, event.frames.length - 1);
    trial.controls.forEach((sample, i) => assert.equal(sample.ordinal, i + 1));
    const pressed = trial.controls.filter(sample => sample.pressed).length;
    assert.equal(pressed, trial.pressedTicks);
    const displacement = Math.hypot(...event.frames.at(-1).self.position.map((value, i) => value - event.frames[0].self.position[i]));
    assert.equal(displacement, trial.displacement);
    const serverPosition = JSON.parse(report.enginePositionReplies[index].replace(/d/g, ''));
    serverPosition.forEach((value, i) => assert(Math.abs(value - event.frames.at(-1).self.position[i]) < 1e-9));
    const releases = records.filter(record => record.kind === 'body-motor-release'
      && record.value.startSequence === event.frames[0].sequence).map(record => record.value);
    assert.deepEqual(releases, trial.releases);
    if (report.expectation === 'exact') {
      assert.equal(pressed, 4); assert.equal(releases.length, 1);
      assert.equal(releases[0].releaseSequence - releases[0].startSequence, 4);
      assert.equal(releases[0].observedIntervals, 4); assert.equal(releases[0].reason, 'interval-complete');
    }
    return { round: trial.round, loaded: trial.load, requestedTicks: 4, pressedTicks: pressed,
      displacement, startSequence: event.frames[0].sequence, endSequence: event.frames.at(-1).sequence,
      serverPosition, eventId: event.id };
  });
  runs.push({ source: resolve(root), expectation: report.expectation, stoppedAt: report.stoppedAt,
    reportSha256: sha(reportBytes), windowsSha256: sha(bytes), bodyRecordsSha256: sha(recordBytes),
    actorBodySha256: report.bodySha256, calibrationScriptSha256: report.scriptSha256, trials });
}
assert.equal(runs[0].expectation, 'overshoot'); assert.equal(runs[1].expectation, 'exact');
assert.equal(runs[0].calibrationScriptSha256, runs[1].calibrationScriptSha256);
assert(runs[0].trials.some(trial => trial.loaded && trial.pressedTicks > 4));
const result = { version: 'NativeMotorCatchupComparison1', status: 'passed', autonomousTrials: 0, learningWrites: 0,
  evaluatorSelectedPhysicalActions: 12, runs,
  limitation: 'Isolated actuator boundary calibration, not a retained-learning or multistage task outcome. Native jump/item checks were not run.' };
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), status: result.status,
  pressed: runs.map(run => run.trials.map(trial => trial.pressedTicks)) }));
