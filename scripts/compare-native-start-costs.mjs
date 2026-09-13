import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [control, candidate, output] = process.argv.slice(2);
if (!output) throw new Error('usage: STOPPED_CONTROL STOPPED_CANDIDATE NEW_AUDIT_JSON');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const rows = [];
const summarize = values => {
  assert(values.length > 0 && values.every(Number.isFinite), 'missing or non-finite measured duration');
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { n, mean: values.reduce((sum, n) => sum + n, 0) / n, median: n % 2 ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, p95: sorted[Math.ceil(.95 * n) - 1], max: sorted.at(-1) };
};
for (const path of [control, candidate]) {
  const root = resolve(path), report = await json(resolve(root, 'results.json'));
  assert(report.stoppedAt && report.status === 'budget-paused');
  const provenance = await json(resolve(report.predecessor, 'fork-provenance.json'));
  const decisions = (await readFile(resolve(root, 'decisions.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(decisions.length, report.final.decisions - report.initialStats.decisions);
  const values = field => decisions.filter(row => row.actionStartTimingsMs).map(row => row.actionStartTimingsMs[field]);
  rows.push({ root, sourceCommit: report.commit, initialModelDigest: report.initialLearningDigest,
    initialSessionSha256: report.checkpointInput.sha256, initialWorldTreeSha256: provenance.worldTreeSha256,
    protocol: report.protocol, decisions: decisions.length,
    executed: decisions.filter(row => row.status === 'executed').length,
    refused: decisions.filter(row => row.status === 'refused').length,
    supportedExecutedForecasts: decisions.filter(row => row.predictionFresh && row.prediction?.compared > 0 && row.prediction.basis === 'supported').length,
    supportedTaskPlans: decisions.filter(row => row.status === 'executed' && row.planLength > 0).length,
    newWrites: report.final.writes - report.initialWrites,
    newPassiveWindows: report.final.passiveWindows - report.initialStats.passiveWindows,
    deaths: report.lifecycle.deaths, goalStatuses: report.tasks.map(task => ({ id: task.goal.id, status: task.status })),
    callbackMs: { validation: summarize(values('validation')), passiveLearning: summarize(values('passiveLearning')), prediction: summarize(values('prediction')) },
    wholeLoopMilliseconds: summarize(decisions.map(row => row.durationMs)),
    durationSeconds: report.seconds, finalPosition: report.finalObservation.self.position });
}
const [a, b] = rows;
for (const key of ['initialModelDigest', 'initialSessionSha256', 'initialWorldTreeSha256', 'protocol']) assert.deepEqual(a[key], b[key], 'unmatched ' + key);
const result = { version: 'NativeStartCostComparison1', status: 'passed', runs: rows,
  rawExecutionFraction: [a.executed / a.decisions, b.executed / b.decisions],
  passiveLearningMeanRatio: b.callbackMs.passiveLearning.mean / a.callbackMs.passiveLearning.mean,
  limitation: 'One ordered paired development trial with the same initial world, model, choice state, goal and budget. Changed real-time trajectories prevent a pure causal estimate of all later learning costs. This does not establish sustained learning, goal success or multistage capability.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, execution: rows.map(row => [row.executed, row.decisions]),
  passiveLearningMeanMs: rows.map(row => row.callbackMs.passiveLearning.mean),
  supportedForecasts: rows.map(row => row.supportedExecutedForecasts), goalStatuses: rows.map(row => row.goalStatuses) }));
