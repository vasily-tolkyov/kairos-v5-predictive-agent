import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Independent stopped-run byte/state comparison, with no actor imports.
const [initialDirectory, stoppedDirectory, output] = process.argv.slice(2);
assert(initialDirectory && stoppedDirectory && output, 'usage: INITIAL_FORK STOPPED_FROZEN_RUN NEW_AUDIT');
const hash = value => createHash('sha256').update(value).digest('hex');
const inputs = [];
const read = async (directory, name) => {
  const path = resolve(directory, name), bytes = await readFile(path);
  inputs.push({ path, bytes: bytes.length, sha256: hash(bytes) }); return bytes;
};
const report = JSON.parse(await read(stoppedDirectory, 'results.json'));
assert(report.stoppedAt && report.final && report.protocol.frozen === true && report.status !== 'running');
const beforeBytes = await read(initialDirectory, 'session.json.gz');
assert.equal(hash(beforeBytes), report.checkpointInput.sha256);
assert.equal(hash(beforeBytes), report.checkpointInput.expectedSha256);
const afterBytes = await read(stoppedDirectory, 'session.json.gz');
const before = JSON.parse(gunzipSync(beforeBytes)), after = JSON.parse(gunzipSync(afterBytes));
assert.deepEqual(after.medium, before.medium, 'frozen dynamics changed');
assert.deepEqual(after.affordances, before.affordances, 'frozen affordances changed');
assert.equal(after.medium.writes, report.final.writes);
assert.equal(before.medium.writes, report.initialStats.writes);
assert.equal(after.steps, report.final.decisions);
const learning = state => hash(JSON.stringify({ medium: state.medium, affordances: state.affordances }));
const result = { version: 'NativeFrozenLearningAudit1', status: 'passed', inputs,
  initialLearningDigest: learning(before), finalLearningDigest: learning(after),
  dynamicsAndAffordancesExactlyUnchanged: true, newDecisions: after.steps - before.steps,
  newExecuted: after.executed - before.executed, newLearningWrites: after.medium.writes - before.medium.writes,
  initialLive: before.live?.current?.frame ?? null, finalLive: after.live?.current?.frame ?? null,
  scope: 'Original stopped checkpoint equality only. Current task/world/live state can change. No actions, model queries or learning writes; no task-capability claim.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
