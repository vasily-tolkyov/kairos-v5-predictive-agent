import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { NativeFrameStateAudit } from './audit-native-frame-state.mjs';
import { InitialTelemetryJournal } from './initial-telemetry-journal.mjs';

// Offline positive/negative fixtures only. They make no native/capability claim.
const signal = state => ({ version: 'BodyMotorSignalV1', scope: 'instrumented-held-controls', state,
  cue: state === 'held' ? { kind: 'move', parameters: { direction: 'forward', ticks: 2 }, targetRole: null } : null });
const frame = sequence => ({ sequence, activeSeconds: sequence * .05, objects: [], targetId: null, contextId: 'anonymous-sensing',
  self: { position: [0, 0, sequence], yaw: 0, pitch: 0, properties: {} },
  physicalClock: { version: 'RealFrameClockV1', physicsTick: 99 + sequence, secondsPerTick: .05,
    monotonicMs: 10 + (sequence - 1) * .1, sample: 'physics' },
  motorSignal: signal(sequence === 1 ? 'unknown' : sequence <= 3 ? 'held' : 'off') });
const clock = (observation, delay = .01) => ({ observationSequence: observation.sequence,
  physicsTick: observation.physicalClock.physicsTick, activeSeconds: observation.activeSeconds,
  monotonicMs: observation.physicalClock.monotonicMs + delay });
const live = (sequence, order) => ({ version: 'ExperienceFrameFlow1', acceptedFrames: sequence, lastSequence: sequence,
  telemetryGaps: 0, missingTraceWindows: 0, unavailableTelemetryBoundaries: 0,
  deliveredThroughOrder: order, continuity: sequence === 1 ? 'unanchored' : 'continuous' });
function fixture() {
  const frames = [1, 2, 3, 4, 5].map(frame), pressedAt = clock(frames[0]), releasedAt = clock(frames[2]);
  const receipt = { version: 'MotorReceiptV1', requestedTicks: 2, durationParameter: 'ticks', requestedAt: pressedAt,
    pressedAt, releasedAt, pressSucceeded: true, releaseSucceeded: true, actualTicks: 2, actualSeconds: .1,
    elapsedMonotonicMs: releasedAt.monotonicMs - pressedAt.monotonicMs, observedIntervals: 2,
    frameRange: { startSequence: 1, endSequence: 3 }, releaseReason: 'interval-complete' };
  const event = { version: 'RealEventV5', id: 'observed-1', cue: signal('held').cue, frames, complete: true,
    trackedIds: [], provenance: 'executed-real-body', bodyResult: { motorReceipt: receipt } };
  const edge = (edgeSequence, kind, edgeClock, state) => ({ kind: 'body-motor-edge', value: {
    version: 'MotorEdgeV1', edgeSequence, kind, clock: edgeClock, signal: signal(state), succeeded: true,
    releaseReason: kind === 'release' ? receipt.releaseReason : null } });
  return { initial: frames[0], events: [event],
    report: { stoppedAt: '2026-09-13T00:00:00Z', final: { decisions: 12 }, initialStats: { decisions: 10 },
      journal: { decisions: 2, 'body-diagnostics': 3, 'physical-actions': 1 }, finalObservation: frame(7) },
    diagnostics: [edge(1, 'press', pressedAt, 'held'), edge(2, 'release', releasedAt, 'off'), { kind: 'body-motor-receipt', value: receipt }],
    decisions: [{ index: 11, status: 'observing', observationSequence: 1, live: live(1, 1) },
      { index: 12, status: 'executed', observationSequence: 5, live: live(5, 7) }],
    actions: [{ executed: true, eventId: event.id, eventFile: 1 }] };
}
function audit(data) {
  const checker = new NativeFrameStateAudit(data.report, data.initial);
  data.events.forEach((event, index) => checker.addEvent(event, 'events/' + String(index + 1).padStart(7, '0') + '.json.gz'));
  (data.initialTelemetry ?? []).forEach((row, index) => checker.addInitialTelemetry(row, 'initial-telemetry:' + index));
  return checker.finish(data.decisions, data.diagnostics, data.actions);
}
const contains = (result, code) => result.issues.some(issue => issue.code === code);

test('missing final measurement stays unknown rather than a zero close tail', () => {
  const data = fixture(); delete data.report.finalObservation;
  const result = audit(data); assert.equal(result.status, 'incomplete');
  assert(contains(result, 'final-observation-unavailable'));
  assert.equal(result.coverage.unarchivedCheckpointTailIntervals, null);
});

test('initialization surplus requires exact archived frames; a marker cannot fill a missing frame', () => {
  const data = fixture(), zero = frame(0);
  zero.physicalClock.monotonicMs = 9; zero.motorSignal = signal('unknown');
  data.decisions.forEach(row => { row.live.acceptedFrames++; row.live.deliveredThroughOrder++; });
  assert(contains(audit(data), 'initial-live-frames-not-fully-archived'));
  const journal = new InitialTelemetryJournal();
  const row = journal.capture({ deliveredThroughOrder: 2, receivedThroughOrder: 2, records: [
    {kind:'frame',source:'cached-anchor',order:1,receivedMonotonicMs:10,observation:zero},
    {kind:'frame',source:'worker-frame',order:2,receivedMonotonicMs:11,observation:data.initial} ] }, 1);
  assert.equal(row.records.length, 1); assert.equal(journal.capture({records:[]}, 1), null);
  data.initialTelemetry = [row]; data.report.journal['initial-telemetry'] = 1;
  data.report.protocol = { initialTelemetryArchive: 'InitialTelemetryArchive1' };
  const result = audit(data); assert.equal(result.status, 'passed', JSON.stringify(result.issues));
  assert.equal(result.live.archivedInitializationFrames, 1);
  assert.equal(result.live.unreconciledInitializationFrames, 0);
  data.initialTelemetry[0].records = [];
  assert(contains(audit(data), 'initial-live-frames-not-fully-archived'));
});

test('corrupt initialization clocks and absent required archive markers are incomplete', () => {
  const data = fixture(); data.report.protocol = { initialTelemetryArchive: 'InitialTelemetryArchive1' };
  assert(contains(audit(data), 'initial-telemetry-marker-missing'));
  const zero = frame(0); zero.physicalClock.monotonicMs = 50;
  data.decisions.forEach(row => { row.live.acceptedFrames++; row.live.deliveredThroughOrder++; });
  data.initialTelemetry = [{version:'InitialTelemetryArchive1',initialSequence:1,deliveredThroughOrder:1,receivedThroughOrder:1,
    records:[{kind:'frame',source:'cached-anchor',order:1,receivedMonotonicMs:10,observation:zero}]}];
  data.report.journal['initial-telemetry'] = 1;
  assert(contains(audit(data), 'initial-live-prefix-clock-or-sequence-gap'));
});

function boundFixture() {
  const data = fixture(), start = data.initial;
  const sensorySha256 = createHash('sha256').update(JSON.stringify(start, (_key, item) => item !== null
    && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item)).digest('hex');
  Object.assign(data.decisions[1], { predictionObservationSequence: start.sequence, livePredictionBinding: {
    version: 'LivePredictionBindingV1', frame: { sequence: start.sequence, epoch: 'fixture', sensorySha256 },
    law: 'fixture-only', stateRevision: 1, stateSha256: 'a'.repeat(64), thetaWritesBeforePrediction: 0 } });
  return data;
}

test('recorded prediction start is bound to the complete original frame independently of the later live watermark', () => {
  const result = audit(boundFixture()); assert.equal(result.status, 'passed');
  assert.equal(result.live.predictionBindings.length, 1);
});

test('missing or changed prediction start binding cannot pass the state audit', () => {
  const changed = boundFixture(); changed.decisions[1].livePredictionBinding.frame.sensorySha256 = '0'.repeat(64);
  assert(contains(audit(changed), 'invalid-live-prediction-source-binding'));
  const missing = boundFixture(); delete missing.decisions[1].livePredictionBinding;
  assert(contains(audit(missing), 'missing-live-prediction-binding'));
});

test('deferred learning must name a prior original passive window and reconcile the exact write delta', () => {
  const data = boundFixture(), event = data.events[0], decision = data.decisions[1];
  event.provenance = 'observed-passive'; event.cue = { kind: 'passive', parameters: { ticks: 4 }, targetRole: null };
  event.bodyResult = null; event.frames.forEach(frame => { frame.motorSignal = signal('off'); });
  data.diagnostics = []; data.actions = [{ executed: false }]; data.report.journal['body-diagnostics'] = 0;
  decision.status = 'refused'; decision.predictionObservationSequence = 5;
  decision.livePredictionBinding.frame.sequence = 5;
  decision.livePredictionBinding.frame.sensorySha256 = createHash('sha256').update(JSON.stringify(event.frames[4], (_key, item) => item !== null
    && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item)).digest('hex');
  decision.deferredPassiveLearning = { version: 'DeferredPassiveLearningV1', windows: 1, learnedWindows: 1,
    thetaBefore: 0, thetaAfter: 1, elapsedMs: 100, parentWindowIds: [event.id] };
  assert.equal(audit(data).status, 'passed');
  decision.deferredPassiveLearning.thetaAfter = 2;
  assert(contains(audit(data), 'invalid-deferred-passive-learning-accounting'));
  decision.deferredPassiveLearning.thetaAfter = 1; decision.deferredPassiveLearning.parentWindowIds = ['unobserved-event'];
  assert(contains(audit(data), 'invalid-deferred-original-window-binding'));
});

test('catch-up capture clocks retain last held sample and later off, with separate checkpoint tail', () => {
  const result = audit(fixture());
  assert.equal(result.status, 'passed');
  assert.equal(result.motor.heldIntervals, 2); assert.equal(result.motor.offIntervalsAfterRelease, 2);
  assert.equal(result.coverage.unarchivedCheckpointTailIntervals, 2);
  assert.equal(result.bCapabilityEstablished, false); assert.equal(result.learningWrites, 0);
});

test('a terminal sample advances sensation but contributes zero physical time', () => {
  const data = fixture(); data.events[0].frames[4].physicalClock.physicsTick = 103;
  data.events[0].frames[4].physicalClock.sample = 'terminal';
  const result = audit(data);
  assert.equal(result.status, 'passed'); assert.equal(result.coverage.zeroPhysicsTerminalSamples, 1);
  assert.equal(result.coverage.physicalIntervals, 3);
});

test('death before the first held tick records a held terminal sample then release without inventing exposure', () => {
  const data = fixture(), event = data.events[0], r = event.bodyResult.motorReceipt;
  event.frames = event.frames.slice(0, 2);
  event.frames[1].physicalClock.physicsTick = 100; event.frames[1].physicalClock.sample = 'terminal';
  Object.assign(r, { releasedAt: clock(event.frames[1]), actualTicks: 0, actualSeconds: 0, observedIntervals: 1,
    frameRange: { startSequence: 1, endSequence: 2 }, releaseReason: 'death' });
  r.elapsedMonotonicMs = r.releasedAt.monotonicMs - r.pressedAt.monotonicMs;
  Object.assign(data.diagnostics[1].value, { clock: r.releasedAt, releaseReason: 'death' });
  data.decisions[1].observationSequence = 2; data.decisions[1].live = live(2, 3);
  const result = audit(data);
  assert.equal(result.status, 'passed'); assert.equal(result.motor.heldIntervals, 0);
  assert.equal(result.coverage.zeroPhysicsTerminalSamples, 1);
});

test('legacy frames and live omissions remain unsupported even with measured old receipts', () => {
  const data = fixture();
  for (const observation of data.events[0].frames) { delete observation.physicalClock; delete observation.motorSignal; }
  for (const decision of data.decisions) delete decision.live;
  data.diagnostics = data.diagnostics.filter(row => row.kind !== 'body-motor-edge');
  data.report.journal['body-diagnostics'] = data.diagnostics.length;
  const result = audit(data);
  assert.equal(result.status, 'unsupported'); assert.equal(result.legacy, true);
  assert.equal(result.coverage.clockedFrames, 0); assert.equal(result.bCapabilityEstablished, false);
});

test('equal sequence with a different boundary payload is rejected, including legacy data', () => {
  const data = fixture(); data.initial = structuredClone(data.initial); data.initial.self.yaw = .5;
  assert(contains(audit(data), 'conflicting-shared-frame-payload'));
  for (const observation of [data.initial, ...data.events[0].frames]) { delete observation.physicalClock; delete observation.motorSignal; }
  assert.equal(audit(data).status, 'failed');
});

test('terminal physics advancement and physical clock reversal are rejected', () => {
  const data = fixture(); data.events[0].frames[4].physicalClock.sample = 'terminal';
  assert(contains(audit(data), 'terminal-sample-invented-physics'));
  data.events[0].frames[4].physicalClock.physicsTick = 2;
  assert(contains(audit(data), 'backward-or-impossible-physical-clock'));
});

test('post-release off cannot relabel the last held frame', () => {
  const data = fixture(); data.events[0].frames[2].motorSignal = signal('off');
  const result = audit(data);
  assert.equal(result.status, 'failed'); assert(contains(result, 'sampled-motor-edge-order-conflict'));
  assert(contains(result, 'receipt-interval-sampled-motor-conflict'));
});

test('missing release edge and modified edge clock cannot be hidden by the receipt', () => {
  const data = fixture(); data.diagnostics.splice(1, 1); data.report.journal['body-diagnostics']--;
  assert(contains(audit(data), 'motor-receipt-edge-count-conflict'));
  const changed = fixture(); changed.diagnostics[1].value.clock = { ...changed.diagnostics[1].value.clock, physicsTick: 101 };
  assert(contains(audit(changed), 'motor-edge-frame-clock-conflict'));
});

test('live count and sequence watermark advance must agree even with theta frozen', () => {
  const data = fixture(); data.report.frozen = true; data.decisions[1].live.acceptedFrames = 4;
  const result = audit(data);
  assert.equal(result.status, 'incomplete'); assert(contains(result, 'live-acceptance-count-does-not-cover-sequence-advance'));
});

test('recorded telemetry loss and trace omissions cannot pass a complete-coverage audit', () => {
  const data = fixture(); data.diagnostics.push({ kind: 'physical-telemetry-gap', value: {
    reason: 'payload-or-record-capacity', firstOrder: 2, lastOrder: 3, records: 2, frames: 1, motorEdges: 1,
    boundaryMissing: true, requestedSequence: 2 } });
  data.report.journal['body-diagnostics']++; Object.assign(data.decisions[1].live, {
    telemetryGaps: 1, missingTraceWindows: 1, unavailableTelemetryBoundaries: 1 });
  const result = audit(data);
  assert.equal(result.status, 'incomplete'); assert.equal(result.live.droppedRecords, 2);
  assert.equal(result.live.droppedFrames, 1); assert.equal(result.live.finalMissingTraceWindows, 1);
});

test('missing frames and a reused original action event reject accounting', () => {
  const missing = fixture(); missing.events[0].frames.splice(3, 1);
  assert(contains(audit(missing), 'internal-frame-gap'));
  const reused = fixture(); reused.actions.push({ ...reused.actions[0] }); reused.report.journal['physical-actions']++;
  assert(contains(audit(reused), 'physical-action-archive-reused'));
});
