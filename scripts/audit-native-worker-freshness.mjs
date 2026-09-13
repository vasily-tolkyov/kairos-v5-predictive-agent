import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sha } from '../dist/src/util.js';
import { validateEvent } from '../dist/src/events.js';

// Post-run evidence audit. No policy, world commands, training or retries.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: STOPPED_NATIVE_OUTPUT NEW_FRESHNESS_AUDIT.json');
const root = resolve(source), bytes = async name => readFile(resolve(root, name));
const json = async name => JSON.parse(await bytes(name));
const jsonl = async (name, expected) => {
  const data = await bytes(name).catch(error => {
    if (error.code === 'ENOENT' && expected === 0) return Buffer.from('');
    throw error;
  });
  return data.toString('utf8').split('\n').filter(line => line.trim()).map(JSON.parse);
};
const report = await json('results.json');
assert(report.stoppedAt && report.final, 'a stopped run is required');
assert(report.journal, 'journal export counts are required');
const decisions = await jsonl('decisions.jsonl', report.final.decisions - report.initialStats.decisions);
const actions = await jsonl('physical-actions.jsonl', report.journal['physical-actions'] ?? 0);
const diagnostics = await jsonl('body-diagnostics.jsonl', report.journal['body-diagnostics'] ?? 0);
assert.equal(decisions.length, report.final.decisions - report.initialStats.decisions);
assert.equal(actions.length, report.journal['physical-actions'] ?? 0);
assert.equal(diagnostics.length, report.journal['body-diagnostics'] ?? 0);
const receipts = diagnostics.filter(row => row.kind === 'body-action-start').map(row => row.value);
const tokens = new Map(), unpairedRefusals = [];
for (const receipt of receipts) {
  assert.equal(receipt.version, 'WorkerActionStartReceiptV1');
  assert(['prepared', 'accepted', 'refused', 'cancelled'].includes(receipt.phase));
  assert(receipt.token !== undefined && receipt.token !== null, 'every native preparation needs an identity');
  for (const field of ['checkedSequence'])
    assert(Number.isSafeInteger(receipt[field]) && receipt[field] >= 0);
  for (const field of ['checkedRawDigest', 'checkedAnonymousDigest'])
    assert.match(receipt[field], /^[a-f0-9]{64}$/);
  assert(Number.isFinite(receipt.checkedMonotonicMs) && receipt.checkedMonotonicMs >= 0);
  if (receipt.preparedSequence === null) {
    assert.equal(receipt.phase, 'refused'); assert.equal(receipt.reason, 'unknown-action-start-token');
    for (const field of ['preparedRawDigest', 'preparedAnonymousDigest', 'preparedMonotonicMs', 'elapsedMs'])
      assert.equal(receipt[field], null);
    unpairedRefusals.push(receipt); continue;
  }
  assert(Number.isSafeInteger(receipt.preparedSequence) && receipt.preparedSequence >= 0);
  for (const field of ['preparedRawDigest', 'preparedAnonymousDigest']) assert.match(receipt[field], /^[a-f0-9]{64}$/);
  for (const field of ['preparedMonotonicMs', 'elapsedMs'])
    assert(Number.isFinite(receipt[field]) && receipt[field] >= 0);
  assert(receipt.checkedSequence >= receipt.preparedSequence);
  assert(Math.abs(receipt.elapsedMs - (receipt.checkedMonotonicMs - receipt.preparedMonotonicMs)) < 1e-6);
  if (receipt.phase === 'prepared') {
    assert(!tokens.has(receipt.token), 'a preparation token was reused');
    assert.equal(receipt.preparedSequence, receipt.checkedSequence);
    assert.equal(receipt.preparedRawDigest, receipt.checkedRawDigest);
    assert.equal(receipt.preparedAnonymousDigest, receipt.checkedAnonymousDigest);
    tokens.set(receipt.token, { prepared: receipt });
  } else {
    const pair = tokens.get(receipt.token);
    assert(pair && !pair.terminal, 'missing preparation or a token was consumed more than once');
    for (const field of ['preparedSequence', 'preparedRawDigest', 'preparedAnonymousDigest', 'preparedMonotonicMs'])
      assert.equal(receipt[field], pair.prepared[field]);
    pair.terminal = receipt;
    if (receipt.phase === 'accepted') {
      assert.equal(receipt.reason, 'matched');
      assert.equal(receipt.preparedSequence, receipt.checkedSequence);
      assert.equal(receipt.preparedRawDigest, receipt.checkedRawDigest);
      assert.equal(receipt.preparedAnonymousDigest, receipt.checkedAnonymousDigest);
    }
    if (receipt.reason === 'action-start-expired')
      assert(receipt.preparedSequence !== receipt.checkedSequence
        || receipt.preparedRawDigest !== receipt.checkedRawDigest, 'expiry needs a measured frame change');
  }
}
assert(tokens.size > 0, 'no asynchronous preparations were recorded');
for (const pair of tokens.values()) assert(pair.terminal, 'an outstanding token has no final disposition');
const attemptedDecisions = decisions.filter(row => ['executed', 'refused'].includes(row.status));
assert.equal(actions.length, attemptedDecisions.length);
assert(tokens.size <= attemptedDecisions.length, 'at most one preparation per attempted decision');
const used = new Set(), usedUnpaired = new Set(), windows = [], attempts = [];
for (let index = 0; index < attemptedDecisions.length; index++) {
  const decision = attemptedDecisions[index], action = actions[index];
  const token = decision.actionStartToken, pair = tokens.get(token);
  assert.equal(decision.status === 'executed', action.executed);
  if (!pair || used.has(token)) {
    assert.equal(decision.status, 'refused', 'an execution has no unique preparation');
    assert.equal(decision.predictionFresh, false);
    assert(!decision.forecastAdvanced && !decision.refuted);
    const refusal = unpairedRefusals.find(value => value.token === token && !usedUnpaired.has(value));
    if (token !== undefined) {
      assert(refusal, 'an identified refusal has no corresponding worker receipt'); usedUnpaired.add(refusal);
    }
    attempts.push({ index: decision.index, token, status: decision.status, phase: 'refused',
      reason: refusal?.reason ?? decision.predictionInvalidation ?? 'before-preparation',
      withoutPreparation: true, checkedSequence: refusal?.checkedSequence });
    continue;
  }
  used.add(token);
  if (decision.actionStartElapsedMs !== undefined)
    assert(Math.abs(decision.actionStartElapsedMs - pair.terminal.elapsedMs) < 1e-6);
  if (action.executed) {
    assert.equal(pair.terminal.phase, 'accepted');
    assert.equal(decision.predictionFresh, true, 'an executed async action has no fresh forecast');
    assert.equal(decision.predictionInvalidation, undefined);
    assert.equal(decision.predictionObservationSequence, pair.prepared.preparedSequence);
    const file = `events/${String(action.eventFile).padStart(7, '0')}.json.gz`;
    const eventBytes = await bytes(file), event = JSON.parse(gunzipSync(eventBytes));
    validateEvent(event);
    assert.equal(event.id, action.eventId);
    assert.equal(event.frames[0].sequence, pair.prepared.preparedSequence);
    assert.equal(sha(event.frames[0]), pair.prepared.preparedAnonymousDigest,
      'actual complete sensory start differs from the prepared forecast frame');
    assert.equal(event.frames.at(-1).sequence, decision.observationSequence);
    assert.equal(decision.predictedSteps?.length, 1);
    assert.equal(decision.predictedSteps[0].offer.observationSequence, event.frames[0].sequence);
    const comparison = decision.prediction;
    assert(comparison && ['supported', 'hypothesized'].includes(comparison.basis));
    windows.push({ eventId: event.id, file, sha256: createHash('sha256').update(eventBytes).digest('hex'),
      token, startSequence: event.frames[0].sequence, endSequence: event.frames.at(-1).sequence,
      sensoryDigest: sha(event.frames[0]), basis: comparison.basis,
      supportedFields: decision.predictedSteps[0].prediction.supportedFields,
      compared: comparison.compared, matched: comparison.matched, unknown: comparison.unknown,
      errors: comparison.errors.map(error => ({ ...error,
        ...(error.range ? { intervalWidth: error.range[1] - error.range[0] } : {}) })) });
  } else {
    assert.equal(decision.predictionFresh, false);
    assert(!decision.forecastAdvanced && !decision.refuted, 'a refused action received forecast credit');
  }
  attempts.push({ index: decision.index, token, status: decision.status, phase: pair.terminal.phase,
    reason: pair.terminal.reason, preparedSequence: pair.prepared.preparedSequence,
    checkedSequence: pair.terminal.checkedSequence, elapsedMs: pair.terminal.elapsedMs });
}
assert.equal(windows.length, report.final.executed - report.initialStats.executed);
assert.equal(used.size, tokens.size, 'a preparation has no corresponding attempted decision');
assert.equal(usedUnpaired.size, unpairedRefusals.length, 'extra token requests are not represented in the decision denominator');
const count = values => Object.fromEntries([...new Set(values)].map(value => [value, values.filter(item => item === value).length]));
const result = { version: 'NativeWorkerFreshnessAudit1', status: 'passed', source: root,
  reportSha256: createHash('sha256').update(await bytes('results.json')).digest('hex'),
  stoppedAt: report.stoppedAt, runStatus: report.status, protocol: report.protocol,
  learningWrites: report.final.writes - report.initialStats.writes,
  passiveWindows: (report.final.passiveWindows ?? 0) - (report.initialStats.passiveWindows ?? 0),
  decisions: decisions.length, attemptedDecisions: attempts.length,
  preparations: tokens.size, acceptedAttempts: attempts.filter(value => value.phase === 'accepted').length,
  preparationlessRefusals: attempts.filter(value => value.withoutPreparation).length,
  refusedDecisions: attempts.filter(value => value.status === 'refused').length,
  refusalReasons: count(attempts.filter(value => value.status === 'refused').map(value => value.reason)),
  executedActions: windows.length, freshExecutedForecasts: windows.length,
  executedFractionOfAllDecisions: decisions.length ? windows.length / decisions.length : null,
  freshFractionOfExecutedActions: windows.length ? 1 : null,
  supportedExecutedForecasts: windows.filter(value => value.basis === 'supported' && value.supportedFields.length > 0).length,
  supportedTaskPlans: decisions.filter(row => row.source === 'task' && row.status === 'executed'
    && row.planLength > 0 && row.predictionFresh && row.prediction?.basis === 'supported').length,
  attempts, windows,
  wholeLoopDurationMs: decisions.map(row => row.durationMs), rssMB: decisions.map(row => row.rssMB),
  limitation: 'Checks token/frame evidence, not a production coverage threshold. Zero executions cannot demonstrate availability. A short peaceful run does not establish task success, retention, transfer, multistage planning or worst-case query latency.' };
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), status: result.status, decisions: result.decisions,
  executedActions: result.executedActions, refusedDecisions: result.refusedDecisions,
  refusalReasons: result.refusalReasons, freshExecutedForecasts: result.freshExecutedForecasts }));
