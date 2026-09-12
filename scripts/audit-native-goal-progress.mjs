import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { GroundedGoalEvaluatorV1 } from '../dist/src/control/goal.js';

// Read-only reconstruction from actual motor windows. No model is fitted and
// no event is replayed into a learner. An action-window advance is separate
// from endpoint success and does not imply a useful long-term policy.
const [source, goalId, output, mode] = process.argv.slice(2);
assert(source && goalId && output && (!mode || mode === '--require-window-rule'),
  'usage: STOPPED_RUN EXACT_GOAL_ID NEW_OUTPUT [--require-window-rule]');
const root = resolve(source), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFile(resolve(root, path));
const reportBytes = await read('results.json'), report = JSON.parse(reportBytes);
assert(report.stoppedAt && report.status !== 'running', 'a stopped run is required');
const task = report.tasks.find(value => value.goal.id === goalId);
assert(task?.baseline, 'the exact goal and its actual baseline must be preserved');
const evaluator = new GroundedGoalEvaluatorV1(); evaluator.setGoal(task.goal, task.baseline);
const decisionBytes = await read('decisions.jsonl'), receiptBytes = await read('physical-actions.jsonl');
const lines = bytes => bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const decisions = lines(decisionBytes), receipts = lines(receiptBytes).filter(row => row.executed);
assert.equal(decisions.length, report.final.decisions - report.initialStats.decisions);
assert.equal(receipts.length, report.final.executed - report.initialStats.executed);
const byEnd = new Map(), timeline = [];
for (const receipt of receipts) {
  const file = `events/${String(receipt.eventFile).padStart(7, '0')}.json.gz`;
  const bytes = await read(file), event = JSON.parse(gunzipSync(bytes));
  const before = event.frames[0], after = event.frames.at(-1);
  assert.equal(event.id, receipt.eventId); assert.equal(event.frames.length, receipt.frames);
  assert.deepEqual(before.self, receipt.before); assert.deepEqual(after.self, receipt.after);
  assert(!byEnd.has(after.sequence), 'duplicate physical endpoint');
  byEnd.set(after.sequence, { file, sha256: sha(bytes), cue: event.cue, before, after });
}
for (const decision of decisions) {
  if (decision.source !== 'task' || decision.goalId !== goalId || decision.status !== 'executed') continue;
  const window = byEnd.get(decision.observationSequence);
  assert(window, 'task decision is missing its actual event');
  assert.deepEqual(window.cue, decision.offer.cue);
  if (decision.goal) assert.deepEqual(decision.goal, task.goal);
  if (decision.goalBaselineSequence !== undefined) assert.equal(decision.goalBaselineSequence, task.baseline.sequence);
  const before = evaluator.evaluate(window.before), after = evaluator.evaluate(window.after);
  const advanced = after.status !== 'unknown' && after.residual < before.residual - 1e-12;
  const next = decisions.filter(row => row.index > decision.index && row.index <= decision.index + 9);
  timeline.push({ decision: decision.index, file: window.file, sha256: window.sha256,
    firstSequence: window.before.sequence, lastSequence: window.after.sequence,
    beforePosition: window.before.self.position, afterPosition: window.after.self.position,
    beforeResidual: before.residual, afterResidual: after.residual, advanced,
    credited: decision.measuredProgress === true, deferred: decision.hypothesisDeferred === true,
    cooldownWithinNineDecisions: next.some(row => row.goalId === goalId && row.hypothesisDeferred),
    source: decision.planLength ? 'supported-plan' : decision.exploration?.source ?? 'unclassified',
    action: window.cue });
}
const mismatches = timeline.filter(row => row.advanced !== row.credited).map(row => row.decision);
const initial = JSON.parse(await read('initial-observation.json'));
const result = { version: 'NativeGoalProgressAudit1', source: root, goal: task.goal,
  baseline: task.baseline, stoppedAt: report.stoppedAt,
  provenance: { reportSha256: sha(reportBytes), decisionsSha256: sha(decisionBytes),
    receiptsSha256: sha(receiptBytes), evaluatorSha256: sha(await readFile(new URL('../dist/src/control/goal.js', import.meta.url))),
    inspectorSha256: sha(await readFile(new URL(import.meta.url))) },
  scope: 'Actual task-action windows; zero new trials or learning writes. Goal verification remains a separate stopped-world audit.',
  initialPosition: initial.self.position, finalPosition: report.finalObservation.self.position,
  initialResidual: evaluator.evaluate(initial).residual,
  finalResidual: evaluator.evaluate(report.finalObservation).residual,
  goalStatus: task.status, taskWindows: timeline.length,
  advances: timeline.filter(row => row.advanced).length,
  creditedAdvances: timeline.filter(row => row.advanced && row.credited).length,
  uncreditedAdvances: timeline.filter(row => row.advanced && !row.credited).length,
  uncreditedAdvancesWithSoonCooldown: timeline.filter(row => row.advanced && !row.credited && row.cooldownWithinNineDecisions).length,
  falseCredits: timeline.filter(row => !row.advanced && row.credited).length,
  deferredTaskWindows: timeline.filter(row => row.deferred).length,
  windowRuleMismatches: mismatches, timeline };
await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
if (mode) assert.equal(mismatches.length, 0, 'candidate progress does not match actual action windows');
const { timeline: _timeline, baseline: _baseline, ...compact } = result;
console.log(JSON.stringify(compact));
