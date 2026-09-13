import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

// Read-only evidence audit. Deliberately imports no actor, learner or evaluator.
const [controlPath, candidatePath, protocolPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('usage: STOPPED_CONTROL STOPPED_CANDIDATE PREREGISTERED_JSON NEW_AUDIT_JSON');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sensoryDigest = value => hash(JSON.stringify(value, (_key, item) => item !== null
  && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sequence = value => assert(Number.isSafeInteger(value) && value >= 0, 'invalid sensory sequence');
const duration = value => assert(Number.isFinite(value) && value >= 0, 'missing or invalid measured duration');
const near = (a, b) => assert(Math.abs(a - b) < 1e-6, 'inconsistent monotonic duration');
const histogram = values => Object.fromEntries([...new Set(values)].map(value => [value, values.filter(v => v === value).length]));
const summarize = values => {
  values.forEach(duration);
  if (!values.length) return { n: 0, mean: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { n, mean: values.reduce((sum, value) => sum + value, 0) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.ceil(.95 * n) - 1], max: sorted.at(-1) };
};
const result = { version: 'NativeStartAlignmentAudit1', status: 'failed', runs: [],
  scope: 'Independent raw frame, interval, attempt and receipt accounting. Passing integrity is separate from availability improvement and capability acceptance.',
  newPhysicalActionsByAuditor: 0, learningWritesByAuditor: 0 };

async function auditRun(path, aligned, registration) {
  const root = resolve(path), reportBytes = await readFile(resolve(root, 'results.json'));
  const report = JSON.parse(reportBytes), initial = await json(resolve(root, 'initial-observation.json'));
  assert(report.stoppedAt && report.final && report.initialStats, 'stopped native evidence required');
  assert(report.journal, 'missing exported journal counters');
  const readRows = async name => {
    const expected = report.journal[name] ?? 0;
    const contents = await readFile(resolve(root, name + '.jsonl'), 'utf8').catch(error => {
      if (error.code === 'ENOENT' && expected === 0) return '';
      throw error;
    });
    const rows = contents.split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
    assert.equal(rows.length, expected, 'journal count mismatch: ' + name); return rows;
  };
  const decisions = await readRows('decisions'), actions = await readRows('physical-actions');
  const intents = await readRows('action-intents'), passiveRows = await readRows('passive-windows');
  const diagnostics = await readRows('body-diagnostics');
  const delta = field => report.final[field] - report.initialStats[field];
  assert.equal(decisions.length, delta('decisions'), 'new decision denominator mismatch');
  assert(decisions.length <= registration.steps, 'decision budget exceeded');
  for (const [index, decision] of decisions.entries())
    assert.equal(decision.index, report.initialStats.decisions + index + 1, 'decision was omitted or repeated');
  const attempted = decisions.filter(row => ['executed', 'refused'].includes(row.status));
  assert.equal(actions.length, attempted.length, 'extra or omitted physical attempt');
  assert.equal(intents.length, attempted.length, 'extra or omitted action intention');

  const provenanceBytes = await readFile(resolve(report.predecessor, 'fork-provenance.json'));
  const provenance = JSON.parse(provenanceBytes);
  assert.equal(report.checkpointInput.sha256, registration.sourceSessionSha256);
  assert.equal(report.checkpointInput.expectedSha256, registration.sourceSessionSha256, 'launch omitted input byte pin');
  assert.equal(hash(await readFile(report.checkpointInput.path)), registration.sourceSessionSha256, 'preserved input bytes changed');
  assert.equal(provenance.sessionSha256, registration.sourceSessionSha256);
  assert.equal(provenance.worldTreeSha256, registration.sourceWorldTreeSha256);
  assert.equal(provenance.worldArchiveSha256, registration.sourceWorldArchiveSha256);
  assert.equal(report.initialLearningDigest, registration.initialLearningDigest);
  assert.equal(report.seed, registration.modelSeed);
  assert.equal(report.protocol.steps, registration.steps);
  assert.equal(report.protocol.seconds, registration.seconds);
  assert.equal(report.protocol.goalAfter, registration.goalAfter);
  assert.equal(report.protocol.goalSourceSha256, registration.goalSha256);
  assert.equal(report.protocol.difficultyVerifiedByServer, registration.difficulty);
  assert.equal(report.protocol.worldSeed, registration.worldSeed);
  assert.equal(report.protocol.environment, registration.environment);
  assert.equal(report.protocol.frozen, !registration.learning);
  assert.equal(report.protocol.externalActionSelection, false);
  assert.equal(report.protocol.resetAfterStart, false);

  const frames = new Map(), intervals = new Map(), events = new Map(), eventIds = new Set();
  sequence(initial.sequence); frames.set(initial.sequence, sensoryDigest(initial));
  const archive = [];
  for (const directory of ['events', 'passive-events']) {
    for (const file of (await readdir(resolve(root, directory))).filter(value => value.endsWith('.json.gz')).sort()) {
      const name = directory + '/' + file, bytes = await readFile(resolve(root, name));
      const event = JSON.parse(gunzipSync(bytes));
      assert(typeof event.id === 'string' && !eventIds.has(event.id), 'duplicate real event identity');
      assert(Array.isArray(event.frames) && event.frames.length >= 2, 'empty physical interval');
      eventIds.add(event.id); events.set(name, event);
      for (const [index, frame] of event.frames.entries()) {
        sequence(frame.sequence); const digest = sensoryDigest(frame), old = frames.get(frame.sequence);
        assert(!old || old === digest, 'conflicting shared sensory frame at ' + frame.sequence);
        frames.set(frame.sequence, digest);
        if (!index) continue;
        const before = event.frames[index - 1];
        assert.equal(frame.sequence, before.sequence + 1, 'missing internal real interval');
        assert(!intervals.has(before.sequence), 'real interval appears in multiple windows');
        intervals.set(before.sequence, name);
      }
      archive.push({ file: name, eventId: event.id, sha256: hash(bytes), first: event.frames[0].sequence,
        last: event.frames.at(-1).sequence, kind: directory === 'events' ? 'executed' : 'passive' });
    }
  }
  const lastArchived = Math.max(initial.sequence, ...frames.keys());
  for (let value = initial.sequence; value < lastArchived; value++)
    assert(intervals.has(value), 'unarchived interval before archive boundary: ' + value);
  assert.equal(intervals.size, lastArchived - initial.sequence, 'interval outside initial/archive boundary');
  assert(report.finalObservation.sequence >= lastArchived, 'archive extends beyond final observation');
  const passiveFiles = archive.filter(row => row.kind === 'passive');
  assert.equal(passiveRows.length, passiveFiles.length);
  const usedPassive = new Set();
  for (const row of passiveRows) {
    const event = events.get(row.file);
    assert(event && row.file.startsWith('passive-events/'), 'passive journal references absent or active event');
    assert(!usedPassive.has(row.file), 'duplicate passive journal row'); usedPassive.add(row.file);
    assert.equal(row.eventId, event.id); assert.equal(row.first, event.frames[0].sequence);
    assert.equal(row.last, event.frames.at(-1).sequence); assert.equal(row.frames, event.frames.length);
  }
  assert.equal(passiveRows.length, delta('passiveWindows'), 'passive windows not conserved in session counter');
  assert.equal(delta('writes'), archive.length, 'real windows and new learning writes disagree');

  const tokens = new Map(), preparationless = [], receipts = diagnostics
    .filter(row => row.kind === 'body-action-start').map(row => row.value);
  for (const receipt of receipts) {
    assert.equal(receipt.version, 'WorkerActionStartReceiptV1');
    assert(['prepared', 'accepted', 'refused', 'cancelled'].includes(receipt.phase));
    assert(typeof receipt.token === 'string' && receipt.token.length > 0, 'missing request identity');
    sequence(receipt.checkedSequence); duration(receipt.checkedMonotonicMs);
    for (const key of ['checkedRawDigest', 'checkedAnonymousDigest']) assert.match(receipt[key], /^[a-f0-9]{64}$/);
    if (receipt.preparedSequence === null) {
      assert.equal(receipt.phase, 'refused'); assert.equal(receipt.reason, 'unknown-action-start-token');
      for (const key of ['preparedRawDigest', 'preparedAnonymousDigest', 'preparedMonotonicMs', 'elapsedMs'])
        assert.equal(receipt[key], null);
      preparationless.push(receipt); continue;
    }
    sequence(receipt.preparedSequence); duration(receipt.preparedMonotonicMs); duration(receipt.elapsedMs);
    for (const key of ['preparedRawDigest', 'preparedAnonymousDigest']) assert.match(receipt[key], /^[a-f0-9]{64}$/);
    near(receipt.elapsedMs, receipt.checkedMonotonicMs - receipt.preparedMonotonicMs);
    assert(receipt.checkedSequence >= receipt.preparedSequence);
    if (receipt.phase === 'prepared') {
      assert(!tokens.has(receipt.token), 'preparation token reused');
      assert.equal(receipt.checkedSequence, receipt.preparedSequence);
      assert.equal(receipt.checkedRawDigest, receipt.preparedRawDigest);
      assert.equal(receipt.checkedAnonymousDigest, receipt.preparedAnonymousDigest);
      if (aligned) {
        const wait = receipt.preparationWait;
        assert(wait, 'candidate preparation has no wait receipt');
        assert.equal(wait.version, 'ActionStartPreparationWaitV1');
        assert.equal(wait.waitAttempts, 1, 'preparation performed more than one wait');
        sequence(wait.requestedSequence);
        for (const key of ['requestedMonotonicMs', 'completedMonotonicMs', 'elapsedMs']) duration(wait[key]);
        near(wait.elapsedMs, wait.completedMonotonicMs - wait.requestedMonotonicMs);
        assert.equal(wait.timeoutMs, registration.preparationWait.requestedTimeoutMs);
        assert(wait.completedMonotonicMs <= receipt.preparedMonotonicMs, 'preparation predates its wait completion');
        assert(receipt.preparedSequence >= wait.requestedSequence, 'prepared frame predates wait request');
        assert(['next-frame', 'timeout'].includes(wait.outcome));
        if (wait.outcome === 'next-frame') {
          sequence(wait.observedSequence); assert(wait.observedSequence > wait.requestedSequence);
          assert(receipt.preparedSequence >= wait.observedSequence, 'prepared frame predates observed real frame');
          assert(frames.has(wait.observedSequence), 'wait resolved to a frame absent from real archives');
        } else assert.equal(wait.observedSequence, null);
        assert(frames.has(wait.requestedSequence), 'wait request frame absent from real archives');
      }
      tokens.set(receipt.token, { prepared: receipt });
    } else {
      const pair = tokens.get(receipt.token);
      assert(pair && !pair.terminal, 'unknown or repeatedly consumed preparation');
      for (const key of ['preparedSequence', 'preparedRawDigest', 'preparedAnonymousDigest', 'preparedMonotonicMs', 'preparationWait'])
        assert.deepEqual(receipt[key], pair.prepared[key], 'terminal receipt changed ' + key);
      pair.terminal = receipt;
      if (receipt.phase === 'accepted') {
        assert.equal(receipt.reason, 'matched');
        assert.equal(receipt.checkedSequence, receipt.preparedSequence);
        assert.equal(receipt.checkedRawDigest, receipt.preparedRawDigest);
        assert.equal(receipt.checkedAnonymousDigest, receipt.preparedAnonymousDigest);
      }
      if (receipt.reason === 'action-start-expired') assert(receipt.checkedSequence !== receipt.preparedSequence
        || receipt.checkedRawDigest !== receipt.preparedRawDigest, 'expiry without an actual frame change');
    }
  }
  for (const pair of tokens.values()) assert(pair.terminal, 'preparation has no terminal disposition');
  assert(tokens.size <= attempted.length, 'more preparations than attempted decisions');
  const usedTokens = new Set(), usedPreparationless = new Set(), usedActiveFiles = new Set(), attempts = [];
  for (const [index, decision] of attempted.entries()) {
    const action = actions[index], token = decision.actionStartToken, pair = tokens.get(token);
    assert.equal(action.executed, decision.status === 'executed');
    assert.deepEqual(action.offer, intents[index].offer, 'physical offer differs from corresponding intent');
    if (!pair || usedTokens.has(token)) {
      assert.equal(decision.status, 'refused'); assert.equal(decision.predictionFresh, false);
      assert(!decision.forecastAdvanced && !decision.refuted, 'refusal received forecast credit');
      if (token !== undefined) {
        const orphan = preparationless.find(row => row.token === token && !usedPreparationless.has(row));
        assert(orphan, 'identified request has no unique worker refusal'); usedPreparationless.add(orphan);
      }
      attempts.push({ index: decision.index, status: decision.status, token, withoutPreparation: true }); continue;
    }
    usedTokens.add(token);
    assert.equal(action.executionBinding?.token, token, 'decision/physical token mismatch');
    near(action.executionBinding.elapsedMs, pair.terminal.elapsedMs);
    near(decision.actionStartElapsedMs, pair.terminal.elapsedMs);
    const prepared = pair.prepared;
    assert.equal(frames.get(prepared.preparedSequence), prepared.preparedAnonymousDigest, 'prepared sensory frame absent or changed in archive');
    if (action.executed) {
      assert.equal(pair.terminal.phase, 'accepted'); assert.equal(decision.predictionFresh, true);
      assert.equal(decision.predictionInvalidation, undefined);
      assert.equal(decision.predictionObservationSequence, prepared.preparedSequence);
      const file = 'events/' + String(action.eventFile).padStart(7, '0') + '.json.gz', event = events.get(file);
      assert(event && !usedActiveFiles.has(file), 'missing or repeated executed event'); usedActiveFiles.add(file);
      assert.equal(event.id, action.eventId); assert.equal(event.frames[0].sequence, prepared.preparedSequence);
      assert.equal(sensoryDigest(event.frames[0]), prepared.preparedAnonymousDigest, 'actual start differs from whole forecast frame');
      assert.equal(event.frames.at(-1).sequence, decision.observationSequence);
      assert.equal(decision.predictedSteps?.length, 1);
      assert.equal(decision.predictedSteps[0].offer.observationSequence, event.frames[0].sequence);
    } else {
      // A matched frame can still be rejected by the motor's own availability
      // check. Count the physical result, never the transport acceptance alone.
      assert.equal(decision.predictionFresh, false);
      assert(!decision.forecastAdvanced && !decision.refuted, 'refusal received forecast credit');
      assert(!action.eventId, 'refusal has a real executed event');
    }
    attempts.push({ index: decision.index, token, status: decision.status, phase: pair.terminal.phase,
      reason: pair.terminal.reason, preparedSequence: prepared.preparedSequence,
      checkedSequence: pair.terminal.checkedSequence, elapsedMs: pair.terminal.elapsedMs,
      ...(aligned ? { preparationWait: prepared.preparationWait } : {}) });
  }
  assert.equal(usedTokens.size, tokens.size, 'unrepresented preparation');
  assert.equal(usedPreparationless.size, preparationless.length, 'unrepresented token request');
  assert.equal(usedActiveFiles.size, archive.filter(row => row.kind === 'executed').length);
  assert.equal(usedActiveFiles.size, delta('executed'));
  const waits = [...tokens.values()].map(pair => pair.prepared.preparationWait).filter(Boolean);
  const callbackRows = decisions.filter(row => row.actionStartTimingsMs);
  const executed = decisions.filter(row => row.status === 'executed');
  return { root, reportSha256: hash(reportBytes), provenanceSha256: hash(provenanceBytes),
    sourceCommit: report.commit, executedBuildHashes: report.executedBuildHashes, executedHarnessHashes: report.executedHarnessHashes,
    initialSessionSha256: report.checkpointInput.sha256, initialWorldTreeSha256: provenance.worldTreeSha256,
    initialLearningDigest: report.initialLearningDigest, initialStats: report.initialStats, protocol: report.protocol,
    status: report.status, stoppedAt: report.stoppedAt, seconds: report.seconds,
    decisions: decisions.length, attemptedDecisions: attempted.length, preparations: tokens.size,
    executed: executed.length, refused: decisions.filter(row => row.status === 'refused').length,
    matchedFramesWithoutExecution: attempts.filter(row => row.phase === 'accepted' && row.status === 'refused').length,
    newWrites: delta('writes'), newPassiveWindows: delta('passiveWindows'),
    supportedExecutedForecasts: executed.filter(row => row.predictionFresh && row.prediction?.basis === 'supported'
      && row.predictedSteps?.[0]?.prediction?.supportedFields?.length > 0).length,
    comparedSupportedExecutedForecasts: executed.filter(row => row.predictionFresh
      && row.prediction?.basis === 'supported' && row.prediction.compared > 0).length,
    supportedTaskPlans: executed.filter(row => row.source === 'task' && row.planLength > 0
      && row.predictionFresh && row.prediction?.basis === 'supported').length,
    goalStatuses: report.tasks.map(task => ({ id: task.goal.id, status: task.status })), deaths: report.lifecycle.deaths,
    initialSequence: initial.sequence, lastArchivedSequence: lastArchived, archivedIntervals: intervals.size,
    unarchivedCheckpointTailIntervals: report.finalObservation.sequence - lastArchived,
    waitOutcomes: histogram(waits.map(wait => wait.outcome)), waitDurationMs: summarize(waits.map(wait => wait.elapsedMs)),
    timerOverruns: waits.filter(wait => wait.elapsedMs > wait.timeoutMs).map(wait => ({ ...wait, overrunMs: wait.elapsedMs - wait.timeoutMs })),
    preparationToTerminalMs: summarize(attempts.filter(row => !row.withoutPreparation).map(row => row.elapsedMs)),
    callbackMs: Object.fromEntries(['validation', 'passiveLearning', 'prediction'].map(key => [key,
      summarize(callbackRows.map(row => row.actionStartTimingsMs[key]))])),
    wholeLoopMs: summarize(decisions.map(row => row.durationMs)), attempts, archive };
}

try {
  const registrationBytes = await readFile(resolve(protocolPath)), registration = JSON.parse(registrationBytes);
  result.registrationSha256 = hash(registrationBytes);
  assert.equal(registration.version, 'MatchedNativeStartAlignmentProtocol1');
  assert.equal(registration.launchAttempts, 1); assert.equal(registration.preparationWait.maximumWaitCallsPerPreparation, 1);
  assert.equal(registration.preparationWait.maximumPreparationsPerDecision, 1);
  assert.equal(hash(await readFile(resolve(registration.sourceWorld))), registration.sourceWorldArchiveSha256,
    'preserved source world archive bytes changed');
  const control = await auditRun(controlPath, false, registration); result.runs.push(control);
  assert.equal(control.reportSha256, registration.controlReportSha256, 'wrong baseline report');
  assert.equal(control.sourceCommit, registration.controlActorCommit, 'wrong baseline actor');
  assert.equal(hash(JSON.stringify(control.protocol)), registration.controlProtocolSha256, 'wrong baseline protocol');
  for (const key of ['decisions', 'executed', 'refused', 'newWrites', 'newPassiveWindows', 'supportedExecutedForecasts'])
    assert.equal(control[key], registration.controlResult[key], 'baseline result differs: ' + key);
  const candidate = await auditRun(candidatePath, true, registration); result.runs.push(candidate);
  for (const key of ['initialSessionSha256', 'initialWorldTreeSha256', 'initialLearningDigest', 'initialStats', 'protocol'])
    assert.deepEqual(candidate[key], control[key], 'unmatched ' + key);
  result.status = 'passed';
  const complete = candidate.decisions === registration.steps && candidate.status === 'budget-paused';
  result.pairComplete = complete;
  result.availabilityOutcome = !complete ? 'incomplete' : candidate.executed > control.executed ? 'improved-in-this-pair' : 'not-improved-in-this-pair';
  result.executionFractions = [control, candidate].map(run => run.decisions ? run.executed / run.decisions : null);
  result.capabilityAcceptance = 'not-established-by-this-short-timing-experiment';
  result.limitations = registration.limitations;
} catch (error) {
  result.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
}
await writeFile(resolve(outputPath), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(outputPath), status: result.status,
  availabilityOutcome: result.availabilityOutcome, failure: result.failure,
  runs: result.runs.map(run => ({ decisions: run.decisions, executed: run.executed, refused: run.refused,
    newWrites: run.newWrites, archivedIntervals: run.archivedIntervals, waitOutcomes: run.waitOutcomes })) }));
