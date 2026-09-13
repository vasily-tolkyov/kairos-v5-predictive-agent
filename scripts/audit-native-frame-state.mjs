import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Independent post-run accounting. No actor imports, model execution, world
// access, fabricated clocks, or learning writes. Retain only compact frame
// metadata after hashing each complete archived observation.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// The recorded prediction binding uses the actor's documented locale-sorted
// JSON convention. Reproduce that convention here without importing the actor.
const bindingHash = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item !== null
  && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item)).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => Number.isFinite(value) && value >= 0;
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
const same = (a, b) => hash(a ?? null) === hash(b ?? null);
const clockValid = c => c?.version === 'RealFrameClockV1' && integer(c.physicsTick)
  && c.secondsPerTick === .05 && finite(c.monotonicMs) && ['physics', 'terminal'].includes(c.sample);
const edgeClockValid = c => integer(c?.observationSequence) && integer(c?.physicsTick)
  && finite(c?.activeSeconds) && finite(c?.monotonicMs);
const motorValid = signal => signal?.version === 'BodyMotorSignalV1' && signal.scope === 'instrumented-held-controls'
  && (signal.state === 'held' ? typeof signal.cue?.kind === 'string' && signal.cue.targetRole === null
    && signal.cue.parameters && typeof signal.cue.parameters === 'object' && !Array.isArray(signal.cue.parameters)
    : ['off', 'unknown'].includes(signal.state) && signal.cue === null);
const withoutDuration = (cue, parameter) => ({ kind: cue?.kind,
  parameters: Object.fromEntries(Object.entries(cue?.parameters ?? {}).filter(([key]) => key !== parameter)) });

export class NativeFrameStateAudit {
  constructor(report, initial) {
    this.report = report; this.initial = initial; this.frames = new Map(); this.intervals = new Map();
    this.events = []; this.eventIds = new Map(); this.receipts = []; this.issues = []; this.issueCounts = {};
    this.initialTelemetry = []; this.initialTelemetryOrder = 0;
    this.addFrame(initial, 'initial-observation.json');
  }
  issue(code, detail = {}, severity = 'failed') {
    this.issueCounts[severity + ':' + code] = (this.issueCounts[severity + ':' + code] ?? 0) + 1;
    if (this.issues.length < 256) this.issues.push({ code, severity, ...detail });
  }
  addFrame(frame, source) {
    if (!integer(frame?.sequence) || !finite(frame?.activeSeconds)) {
      this.issue('invalid-observation-boundary', { source }); return;
    }
    const sha256 = hash(frame), old = this.frames.get(frame.sequence);
    if (old && old.sha256 !== sha256) this.issue('conflicting-shared-frame-payload', {
      sequence: frame.sequence, source, previousSource: old.source, expected: old.sha256, actual: sha256 });
    if (old) return;
    if (frame.physicalClock && !clockValid(frame.physicalClock)) this.issue('invalid-physical-clock', { source, sequence: frame.sequence });
    if (frame.motorSignal && !motorValid(frame.motorSignal)) this.issue('invalid-sampled-motor', { source, sequence: frame.sequence });
    this.frames.set(frame.sequence, { sequence: frame.sequence, activeSeconds: frame.activeSeconds,
      physicalClock: frame.physicalClock, motorSignal: frame.motorSignal, sha256, predictionSha256: bindingHash(frame), source });
  }
  addInitialTelemetry(batch, source) {
    this.initialTelemetry.push({ source, records: batch?.records?.length ?? null });
    if (batch?.version !== 'InitialTelemetryArchive1' || batch.initialSequence !== this.initial.sequence
      || !integer(batch.deliveredThroughOrder) || !integer(batch.receivedThroughOrder)
      || batch.receivedThroughOrder < batch.deliveredThroughOrder || !Array.isArray(batch.records)) {
      this.issue('invalid-initial-telemetry-record', { source }); return;
    }
    for (const record of batch.records) {
      if (!integer(record.order) || record.order <= this.initialTelemetryOrder || record.order > batch.deliveredThroughOrder
        || !finite(record.receivedMonotonicMs)) this.issue('invalid-initial-telemetry-order', { source });
      this.initialTelemetryOrder = record.order;
      if (record.kind === 'frame') {
        if (!['worker-frame', 'cached-anchor'].includes(record.source) || record.observation?.sequence >= this.initial.sequence)
          this.issue('invalid-initial-telemetry-frame', { source });
        this.addFrame(record.observation, source);
      } else if (record.kind !== 'motor-edge' || !edgeClockValid(record.edge?.clock)
        || record.edge.clock.observationSequence >= this.initial.sequence || !motorValid(record.edge.signal))
        this.issue('invalid-initial-telemetry-edge', { source });
    }
  }
  addEvent(event, source, compressedSha256 = null) {
    if (!event?.id || !Array.isArray(event.frames) || event.frames.length < 2) {
      this.issue('invalid-event', { source }); return;
    }
    const digest = hash(event), old = this.eventIds.get(event.id);
    if (old) this.issue(old.digest === digest ? 'duplicate-event-id' : 'conflicting-event-id', { source, previousSource: old.source, id: event.id });
    else this.eventIds.set(event.id, { source, digest });
    const first = event.frames[0], last = event.frames.at(-1);
    this.events.push({ source, id: event.id, sha256: compressedSha256, eventDigest: digest,
      first: first.sequence, last: last.sequence, provenance: event.provenance });
    if (!event.complete || !['observed-passive', 'executed-real-body'].includes(event.provenance)) this.issue('noncomplete-learning-archive', { source });
    if (event.provenance === 'observed-passive' && (event.bodyResult !== null || event.cue?.kind !== 'passive')) this.issue('invalid-passive-event', { source });
    for (const [index, frame] of event.frames.entries()) {
      this.addFrame(frame, source);
      if (!index) continue;
      const before = event.frames[index - 1];
      if (frame.sequence !== before.sequence + 1) this.issue('internal-frame-gap', { source, before: before.sequence, after: frame.sequence });
      if (this.intervals.has(before.sequence)) this.issue('duplicate-physical-interval', { source, before: before.sequence, previousSource: this.intervals.get(before.sequence) });
      else this.intervals.set(before.sequence, source);
    }
    const receipt = event.bodyResult?.motorReceipt;
    if (receipt) this.receipts.push({ source, receipt, cue: event.cue, first: first.sequence, last: last.sequence });
  }
  finish(decisions, diagnostics, actions = []) {
    const report = this.report, allFrames = [...this.frames.values()].sort((a, b) => a.sequence - b.sequence);
    const initialSequence = this.initial.sequence, lastArchivedSequence = Math.max(initialSequence, allFrames.at(-1)?.sequence ?? initialSequence);
    const acquired = allFrames.filter(frame => frame.sequence >= initialSequence);
    if (!report.stoppedAt || !report.final) this.issue('run-not-stopped');
    const finalObservation = report.finalObservation, archivedFinal = this.frames.get(finalObservation?.sequence);
    if (!finalObservation) this.issue('final-observation-unavailable', {}, 'incomplete');
    if (finalObservation && finalObservation.sequence < lastArchivedSequence) this.issue('final-observation-before-archive-end');
    if (archivedFinal && archivedFinal.sha256 !== hash(finalObservation)) this.issue('conflicting-final-shared-frame-payload', { sequence: finalObservation.sequence });
    const expectedDecisions = report.final?.decisions - report.initialStats?.decisions;
    if (!integer(expectedDecisions) || expectedDecisions !== decisions.length) this.issue('decision-export-count-mismatch', { expected: expectedDecisions, actual: decisions.length });
    for (const [kind, rows] of [['decisions', decisions], ['body-diagnostics', diagnostics], ['physical-actions', actions]])
      if ((report.journal?.[kind] ?? 0) !== rows.length) this.issue('journal-count-mismatch', { kind, expected: report.journal?.[kind] ?? 0, actual: rows.length });
    if ((report.journal?.['initial-telemetry'] ?? 0) !== this.initialTelemetry.length)
      this.issue('journal-count-mismatch', { kind: 'initial-telemetry' });
    if (report.protocol?.initialTelemetryArchive === 'InitialTelemetryArchive1' && !this.initialTelemetry.length)
      this.issue('initial-telemetry-marker-missing', {}, 'incomplete');
    const actionEvents = this.events.filter(event => event.provenance === 'executed-real-body'), actionReferences = new Set();
    for (const action of actions.filter(action => action.executed)) {
      const event = actionEvents.find(event => event.id === action.eventId);
      if (!event || event.source !== 'events/' + String(action.eventFile).padStart(7, '0') + '.json.gz')
        this.issue('physical-action-archive-binding-mismatch', { eventId: action.eventId });
      else if (actionReferences.has(event.id)) this.issue('physical-action-archive-reused', { eventId: event.id });
      else actionReferences.add(event.id);
    }
    if (actionReferences.size !== actionEvents.length) this.issue('unreferenced-action-archives', { archives: actionEvents.length, referenced: actionReferences.size });
    let physicalIntervals = 0, terminalSamples = 0;
    const missingIntervals = [];
    for (let sequence = initialSequence; sequence < lastArchivedSequence; sequence++)
      if (!this.intervals.has(sequence)) missingIntervals.push([sequence, sequence + 1]);
    if (missingIntervals.length) this.issue('missing-archived-intervals', { count: missingIntervals.length }, 'incomplete');
    for (let index = 1; index < acquired.length; index++) {
      const before = acquired[index - 1], after = acquired[index], a = before.physicalClock, b = after.physicalClock;
      if (!a || !b || !clockValid(a) || !clockValid(b)) continue;
      const deltaSequence = after.sequence - before.sequence, deltaTicks = b.physicsTick - a.physicsTick;
      if (deltaTicks < 0 || deltaTicks > deltaSequence || b.monotonicMs < a.monotonicMs)
        this.issue('backward-or-impossible-physical-clock', { before: before.sequence, after: after.sequence, deltaTicks });
      if (deltaSequence !== 1) continue; // Never interpolate an unobserved interval.
      if (b.sample === 'terminal') {
        terminalSamples++;
        if (deltaTicks !== 0) this.issue('terminal-sample-invented-physics', { sequence: after.sequence, deltaTicks });
      } else {
        physicalIntervals++;
        if (deltaTicks !== 1) this.issue('physics-sample-tick-mismatch', { sequence: after.sequence, deltaTicks });
      }
    }
    const clockedFrames = acquired.filter(frame => clockValid(frame.physicalClock)).length;
    const sampledFrames = acquired.filter(frame => motorValid(frame.motorSignal)).length;
    const edgeRows = diagnostics.map((row, index) => ({ ...row, diagnosticIndex: index + 1 }))
      .filter(row => row.kind === 'body-motor-edge');
    const edges = [], outsideArchiveEdges = [];
    let previousEdge;
    for (const row of edgeRows) {
      const edge = row.value;
      if (edge?.version !== 'MotorEdgeV1' || !integer(edge.edgeSequence) || !edgeClockValid(edge.clock)
        || !['press', 'release', 'unmeasured'].includes(edge.kind) || !motorValid(edge.signal)) {
        this.issue('invalid-motor-edge', { diagnosticIndex: row.diagnosticIndex }); continue;
      }
      if (previousEdge && (edge.edgeSequence !== previousEdge.edgeSequence + 1
        || edge.clock.observationSequence < previousEdge.clock.observationSequence
        || edge.clock.physicsTick < previousEdge.clock.physicsTick || edge.clock.monotonicMs < previousEdge.clock.monotonicMs))
        this.issue('motor-edge-order-conflict', { edgeSequence: edge.edgeSequence });
      if (!previousEdge && edge.edgeSequence !== 1) this.issue('motor-edge-prefix-missing', { first: edge.edgeSequence }, 'incomplete');
      previousEdge = edge; edges.push({ ...edge, diagnosticIndex: row.diagnosticIndex });
      if ((edge.kind === 'press' && (edge.succeeded !== true || edge.signal.state !== 'held' || edge.releaseReason !== null))
        || (edge.kind === 'release' && (typeof edge.succeeded !== 'boolean'
          || edge.signal.state !== (edge.succeeded ? 'off' : 'unknown') || !edge.releaseReason))
        || (edge.kind === 'unmeasured' && (edge.succeeded !== null || edge.signal.state !== 'unknown' || edge.releaseReason !== null)))
        this.issue('motor-edge-signal-conflict', { edgeSequence: edge.edgeSequence });
      const frame = this.frames.get(edge.clock.observationSequence);
      if (!frame) outsideArchiveEdges.push({ edgeSequence: edge.edgeSequence, observationSequence: edge.clock.observationSequence });
      else this.checkEdgeClock(edge.clock, frame, 'diagnostic-edge-' + edge.edgeSequence);
      const nextFrame = this.frames.get(edge.clock.observationSequence + 1);
      if (nextFrame?.physicalClock && edge.clock.monotonicMs > nextFrame.physicalClock.monotonicMs)
        this.issue('edge-recorded-after-next-frame-capture', { edgeSequence: edge.edgeSequence });
    }
    let edgeIndex = 0, expectedMotor, sampledOrderChecks = 0;
    for (const frame of acquired) {
      // A same-sequence edge happens after that frame was captured. Never use
      // post-release off to relabel the last held sample or its preceding dt.
      while (edgeIndex < edges.length && edges[edgeIndex].clock.observationSequence < frame.sequence)
        expectedMotor = edges[edgeIndex++].signal;
      if (expectedMotor && frame.motorSignal) {
        sampledOrderChecks++;
        if (!same(expectedMotor, frame.motorSignal)) this.issue('sampled-motor-edge-order-conflict', { sequence: frame.sequence });
      }
    }
    const matchedEdges = new Set(), matchedReceiptDiagnostics = new Set();
    let heldIntervals = 0, offIntervalsAfterRelease = 0;
    for (const record of this.receipts) {
      const { receipt: r, source, cue, first, last } = record;
      if (r.version !== 'MotorReceiptV1' || ![r.requestedAt, r.pressedAt, r.releasedAt].every(edgeClockValid)) {
        this.issue('invalid-motor-receipt', { source }); continue;
      }
      for (const clock of [r.requestedAt, r.pressedAt, r.releasedAt]) {
        const frame = this.frames.get(clock.observationSequence);
        if (!frame || clock.observationSequence < first || clock.observationSequence > last) this.issue('motor-receipt-outside-own-window', { source });
        else this.checkEdgeClock(clock, frame, source);
      }
      if (!integer(r.actualTicks) || !integer(r.requestedTicks) || !['ticks', 'holdTicks'].includes(r.durationParameter)
        || typeof r.pressSucceeded !== 'boolean' || typeof r.releaseSucceeded !== 'boolean'
        || r.pressedAt.physicsTick !== r.requestedAt.physicsTick
        || r.pressedAt.observationSequence !== r.requestedAt.observationSequence
        || r.pressedAt.monotonicMs < r.requestedAt.monotonicMs
        || r.actualTicks !== r.releasedAt.physicsTick - r.pressedAt.physicsTick
        || !close(r.actualSeconds, r.actualTicks * .05)
        || !close(r.elapsedMonotonicMs, r.releasedAt.monotonicMs - r.pressedAt.monotonicMs)
        || r.elapsedMonotonicMs < 0 || r.observedIntervals !== r.releasedAt.observationSequence - r.pressedAt.observationSequence
        || r.frameRange?.startSequence !== r.pressedAt.observationSequence || r.frameRange?.endSequence !== r.releasedAt.observationSequence
        || r.releaseReason === 'interval-complete' && r.actualTicks !== r.requestedTicks)
        this.issue('motor-receipt-clock-arithmetic-conflict', { source });
      if (clockedFrames) for (const [kind, clock, required] of [['press', r.pressedAt, r.pressSucceeded], ['release', r.releasedAt, true]]) {
        const matches = edges.filter(edge => edge.kind === kind && same(edge.clock, clock));
        if (matches.length !== (required ? 1 : 0)) this.issue('motor-receipt-edge-count-conflict', { source, kind, actual: matches.length });
        for (const edge of matches) {
          if (matchedEdges.has(edge.edgeSequence)) this.issue('motor-edge-reused-by-receipts', { source, edgeSequence: edge.edgeSequence });
          matchedEdges.add(edge.edgeSequence);
          if (kind === 'release' && (edge.succeeded !== r.releaseSucceeded || edge.releaseReason !== r.releaseReason)) this.issue('motor-release-edge-receipt-conflict', { source });
          if (kind === 'press' && !same(withoutDuration(edge.signal.cue, r.durationParameter), withoutDuration(cue, r.durationParameter)))
            this.issue('motor-press-cue-conflict', { source });
        }
      }
      const receiptDiagnostics = diagnostics.map((row, index) => ({ row, index }))
        .filter(({ row }) => row.kind === 'body-motor-receipt' && same(row.value, r));
      if (clockedFrames && receiptDiagnostics.length !== 1) this.issue('motor-receipt-diagnostic-count-conflict', { source, actual: receiptDiagnostics.length });
      for (const { index } of receiptDiagnostics) matchedReceiptDiagnostics.add(index);
      for (let sequence = first + 1; sequence <= last; sequence++) {
        const before = this.frames.get(sequence - 1), after = this.frames.get(sequence);
        if (!clockValid(before?.physicalClock) || !clockValid(after?.physicalClock)) continue;
        const a = before.physicalClock.physicsTick, b = after.physicalClock.physicsTick;
        if (b <= a) continue; // terminal zero-dt is assimilation only.
        const held = r.pressSucceeded && a >= r.pressedAt.physicsTick && b <= r.releasedAt.physicsTick;
        const off = r.releaseSucceeded && a >= r.releasedAt.physicsTick;
        if (held) heldIntervals++; else if (off) offIntervalsAfterRelease++;
        if ((held || off) && after.motorSignal?.state !== (held ? 'held' : 'off'))
          this.issue('receipt-interval-sampled-motor-conflict', { source, sequence, expected: held ? 'held' : 'off' });
      }
    }
    const unpairedInsideArchive = edges.filter(edge => edge.kind !== 'unmeasured' && !matchedEdges.has(edge.edgeSequence)
      && edge.clock.observationSequence >= initialSequence && edge.clock.observationSequence <= lastArchivedSequence);
    if (unpairedInsideArchive.length) this.issue('motor-edge-without-complete-archive-receipt', { count: unpairedInsideArchive.length }, 'incomplete');
    // Diagnostic interrupted windows are raw body frames, whereas event frames
    // are anonymous. Full payload identity is checked within each domain; only
    // unchanged capture instrumentation is compared across the two domains.
    const rawDiagnosticFrames = new Map(); let interruptedClockedFrames = 0;
    for (const row of diagnostics.filter(row => row.kind === 'body-incomplete-window')) {
      let previous;
      for (const frame of row.value?.frames ?? []) {
        const digest = hash(frame), old = rawDiagnosticFrames.get(frame.sequence);
        if (old && old !== digest) this.issue('conflicting-raw-diagnostic-shared-frame', { sequence: frame.sequence });
        rawDiagnosticFrames.set(frame.sequence, digest);
        if (frame.physicalClock) {
          if (!clockValid(frame.physicalClock)) this.issue('invalid-interrupted-frame-clock', { sequence: frame.sequence });
          else {
            interruptedClockedFrames++;
            if (previous?.physicalClock && (frame.sequence !== previous.sequence + 1
              || frame.physicalClock.monotonicMs < previous.physicalClock.monotonicMs
              || frame.physicalClock.physicsTick - previous.physicalClock.physicsTick !== (frame.physicalClock.sample === 'terminal' ? 0 : 1)))
              this.issue('interrupted-frame-clock-order-conflict', { sequence: frame.sequence });
          }
        }
        const archived = this.frames.get(frame.sequence);
        if (archived && (!same(archived.physicalClock, frame.physicalClock) || !same(archived.motorSignal, frame.motorSignal)
          || !close(archived.activeSeconds, frame.activeSeconds))) this.issue('raw-anonymous-capture-instrumentation-conflict', { sequence: frame.sequence });
        previous = frame;
      }
    }
    const incompleteWindows = diagnostics.filter(row => row.kind === 'body-incomplete-window').map(row => ({
      id: row.value?.id, startSequence: row.value?.startSequence, endSequence: row.value?.endSequence,
      frames: row.value?.frames?.length ?? 0, complete: row.value?.complete }));
    if (incompleteWindows.length) this.issue('incomplete-body-windows-not-learning-evidence', { count: incompleteWindows.length }, 'incomplete');
    const gaps = diagnostics.filter(row => row.kind === 'physical-telemetry-gap').map(row => row.value);
    const capacityGaps = gaps.filter(gap => gap?.reason === 'payload-or-record-capacity');
    const missingBoundaryReports = gaps.filter(gap => gap?.boundaryMissing === true).length;
    for (const gap of capacityGaps) if (![gap.firstOrder, gap.lastOrder, gap.records, gap.frames, gap.motorEdges].every(integer)
      || gap.lastOrder < gap.firstOrder || gap.records !== gap.frames + gap.motorEdges
      || gap.records !== gap.lastOrder - gap.firstOrder + 1) this.issue('invalid-telemetry-gap-report');
    if (gaps.length) this.issue('telemetry-loss-or-missing-boundary-reported', { count: gaps.length }, 'incomplete');
    const watermarks = [], predictionBindings = [], deferredWindows = new Set(); let previousLive, initialUnreconciledAcceptedFrames = null;
    for (const [index, decision] of decisions.entries()) {
      if (decision.index !== report.initialStats.decisions + index + 1) this.issue('decision-index-gap', { index: decision.index });
      const live = decision.live;
      if (!live) continue;
      const counters = ['acceptedFrames', 'lastSequence', 'telemetryGaps', 'missingTraceWindows', 'unavailableTelemetryBoundaries', 'deliveredThroughOrder'];
      if (live.version !== 'ExperienceFrameFlow1' || !counters.every(key => integer(live[key]))
        || !['unanchored', 'continuous', 'gap', 'timing-unknown'].includes(live.continuity)) {
        this.issue('invalid-decision-live-watermark', { index: decision.index }); continue;
      }
      if (!this.frames.has(live.lastSequence)) this.issue('live-watermark-without-archived-frame', { index: decision.index, sequence: live.lastSequence }, 'incomplete');
      if (live.lastSequence > decision.observationSequence) this.issue('live-watermark-after-decision-observation', { index: decision.index });
      if (decision.predictionObservationSequence !== undefined && decision.predictionObservationSequence > live.lastSequence)
        this.issue('prediction-boundary-after-live-consumption-watermark', { index: decision.index });
      const binding = decision.livePredictionBinding;
      if (decision.predictionObservationSequence !== undefined && !binding)
        this.issue('missing-live-prediction-binding', { index: decision.index }, 'incomplete');
      if (binding) {
        const source = this.frames.get(binding.frame?.sequence);
        if (binding.version !== 'LivePredictionBindingV1' || !binding.frame?.epoch
          || !integer(binding.stateRevision) || !integer(binding.thetaWritesBeforePrediction)
          || typeof binding.law !== 'string' || !/^[a-f0-9]{64}$/.test(binding.stateSha256 ?? '')
          || binding.frame.sequence !== decision.predictionObservationSequence
          || !source || source.predictionSha256 !== binding.frame.sensorySha256)
          this.issue('invalid-live-prediction-source-binding', { index: decision.index });
        predictionBindings.push({ decision: decision.index, ...binding });
      }
      const deferred = decision.deferredPassiveLearning;
      if (deferred) {
        if (deferred.version !== 'DeferredPassiveLearningV1' || !['windows', 'learnedWindows', 'thetaBefore', 'thetaAfter'].every(key => integer(deferred[key]))
          || !finite(deferred.elapsedMs) || !Array.isArray(deferred.parentWindowIds)
          || deferred.parentWindowIds.length !== deferred.windows || deferred.learnedWindows > deferred.windows
          || deferred.thetaAfter - deferred.thetaBefore !== deferred.learnedWindows
          || binding && deferred.thetaBefore !== binding.thetaWritesBeforePrediction)
          this.issue('invalid-deferred-passive-learning-accounting', { index: decision.index });
        for (const id of deferred.parentWindowIds ?? []) {
          const event = this.events.find(event => event.id === id);
          if (!event || event.provenance !== 'observed-passive' || !binding || event.last > binding.frame.sequence || deferredWindows.has(id))
            this.issue('invalid-deferred-original-window-binding', { index: decision.index, id });
          deferredWindows.add(id);
        }
      }
      if (live.deliveredThroughOrder < live.acceptedFrames) this.issue('native-live-acceptance-exceeds-delivered-record-order', { index: decision.index });
      if (previousLive) {
        for (const key of counters) if (live[key] < previousLive[key]) this.issue('live-counter-went-backward', { index: decision.index, key });
        if (live.acceptedFrames - previousLive.acceptedFrames !== live.lastSequence - previousLive.lastSequence)
          this.issue('live-acceptance-count-does-not-cover-sequence-advance', { index: decision.index }, 'incomplete');
      } else {
        initialUnreconciledAcceptedFrames = live.acceptedFrames - (live.lastSequence - initialSequence + 1);
        if (initialUnreconciledAcceptedFrames < 0) this.issue('initial-live-count-misses-acquisition-frames', { index: decision.index }, 'incomplete');
      }
      if (live.telemetryGaps || live.missingTraceWindows || live.unavailableTelemetryBoundaries
        || ['gap', 'timing-unknown'].includes(live.continuity)) this.issue('live-reports-incomplete-continuity', { index: decision.index }, 'incomplete');
      watermarks.push({ decision: decision.index, observationSequence: decision.observationSequence,
        predictionObservationSequence: decision.predictionObservationSequence ?? null, ...live });
      previousLive = live;
    }
    const finalLive = watermarks.at(-1), lastConsumedSequence = finalLive?.lastSequence ?? null;
    const prefix = allFrames.filter(frame => frame.sequence < initialSequence);
    if (initialUnreconciledAcceptedFrames !== null && initialUnreconciledAcceptedFrames !== prefix.length)
      this.issue('initial-live-frames-not-fully-archived', { acceptedBeforeInitial: initialUnreconciledAcceptedFrames,
        archivedBeforeInitial: prefix.length }, 'incomplete');
    const prefixChain = [...prefix, this.frames.get(initialSequence)];
    for (let index = 1; index < prefixChain.length; index++) {
      const before = prefixChain[index - 1], after = prefixChain[index];
      if (after.sequence !== before.sequence + 1 || !clockValid(before.physicalClock) || !clockValid(after.physicalClock)
        || after.activeSeconds <= before.activeSeconds || after.physicalClock.monotonicMs < before.physicalClock.monotonicMs
        || after.physicalClock.physicsTick - before.physicalClock.physicsTick !== Number(after.physicalClock.sample === 'physics'))
        this.issue('initial-live-prefix-clock-or-sequence-gap', { before: before.sequence, after: after.sequence }, 'incomplete');
    }
    const archiveTailBeyondDecisionWatermark = lastConsumedSequence === null ? null : Math.max(0, lastArchivedSequence - lastConsumedSequence);
    if (archiveTailBeyondDecisionWatermark) this.issue('archive-tail-without-decision-consumption-watermark', { intervals: archiveTailBeyondDecisionWatermark }, 'incomplete');
    if (finalLive && (finalLive.telemetryGaps > capacityGaps.length || finalLive.unavailableTelemetryBoundaries > missingBoundaryReports))
      this.issue('live-gap-counter-missing-diagnostics');
    const missingClocks = acquired.length - clockedFrames, missingSamples = acquired.length - sampledFrames;
    const missingLive = decisions.length - watermarks.length;
    const legacy = clockedFrames === 0;
    const unsupported = legacy || missingClocks > 0 || missingSamples > 0 || missingLive > 0 || decisions.length === 0;
    const failed = Object.keys(this.issueCounts).some(key => key.startsWith('failed:'));
    const incomplete = Object.keys(this.issueCounts).some(key => key.startsWith('incomplete:'));
    return { version: 'NativeFrameStateAudit2', status: failed ? 'failed' : unsupported ? 'unsupported' : incomplete ? 'incomplete' : 'passed',
      scope: 'Independent raw-evidence instrumentation and consumption-accounting audit; not capability acceptance or a replay of learned/live state.',
      legacy, bCapabilityEstablished: false, newActions: 0, learningWrites: 0,
      coverage: { initialSequence, lastArchivedSequence, uniqueArchivedFrames: acquired.length,
        archivedIntervals: this.intervals.size, expectedIntervalsThroughArchive: lastArchivedSequence - initialSequence,
        clockedFrames, missingClockFrames: missingClocks, sampledMotorFrames: sampledFrames, missingSampledMotorFrames: missingSamples,
        physicalIntervals, zeroPhysicsTerminalSamples: terminalSamples, missingIntervals,
        finalObservedSequence: report.finalObservation?.sequence ?? null,
        unarchivedCheckpointTailIntervals: report.finalObservation ? Math.max(0, report.finalObservation.sequence - lastArchivedSequence) : null },
      motor: { receiptWindows: this.receipts.length, edges: edges.length, sampledOrderChecks, heldIntervals, offIntervalsAfterRelease,
        outsideArchiveEdges, unmatchedEdgeSequences: edges.filter(edge => edge.kind !== 'unmeasured' && !matchedEdges.has(edge.edgeSequence)).map(edge => edge.edgeSequence),
        unmeasuredEdges: edges.filter(edge => edge.kind === 'unmeasured').length,
        unmatchedReceiptDiagnostics: diagnostics.filter((row, index) => row.kind === 'body-motor-receipt' && !matchedReceiptDiagnostics.has(index)).length,
        measuredHoldExercised: heldIntervals > 0 },
      live: { decisions: decisions.length, decisionsWithWatermarks: watermarks.length, missingLiveWatermarks: missingLive,
        lastConsumedSequence, archiveTailBeyondDecisionWatermark, initialUnreconciledAcceptedFrames, watermarks, predictionBindings,
        archivedInitializationFrames: prefix.length, initialTelemetryRecords: this.initialTelemetry,
        unreconciledInitializationFrames: initialUnreconciledAcceptedFrames === null ? null : initialUnreconciledAcceptedFrames - prefix.length,
        deferredOriginalWindows: deferredWindows.size,
        capacityGapReports: capacityGaps.length, droppedRecords: capacityGaps.reduce((sum, gap) => sum + (integer(gap.records) ? gap.records : 0), 0),
        droppedFrames: capacityGaps.reduce((sum, gap) => sum + (integer(gap.frames) ? gap.frames : 0), 0),
        droppedMotorEdges: capacityGaps.reduce((sum, gap) => sum + (integer(gap.motorEdges) ? gap.motorEdges : 0), 0),
        missingBoundaryReports, finalMissingTraceWindows: finalLive?.missingTraceWindows ?? null },
      incompleteWindows, interruptedClockedFrameOccurrences: interruptedClockedFrames,
      events: this.events, issueCounts: this.issueCounts, issues: this.issues,
      limitations: [
        'No absolute/relative physical duration is inferred for legacy or partially clocked frames; sequence and activeSeconds are not substitute physical clocks.',
        'Source frame clocks, sampled controls and edge diagnostics check capture-before-release. The full transport order-to-frame map is not journaled, so worker delivery order is not independently replayed.',
        'Decision.live is recorded consumption accounting. Prediction bindings cross-check the archived start-frame digest and recorded z identity, but do not independently replay z recurrence, theta updates, or functional learning.',
        'Initialization anchors must have their own original archived payloads and measured clocks. Any remaining unreconciled surplus is incomplete, never credited as independent learning windows.',
        'Incomplete diagnostic windows and the unarchived checkpoint/close tail are not counted as completed learning experience. Original event IDs remain the independent window units.',
        'Unknown or unmeasured motor signals do not prove off, held, motion, effect, or task achievement; no impulse dynamics are invented.',
        'A passed instrumentation audit is not evidence of sustained autonomous learning or an open multistage task result.' ] };
  }
  checkEdgeClock(clock, frame, source) {
    if (!close(clock.activeSeconds, frame.activeSeconds) || frame.physicalClock
      && (clock.physicsTick !== frame.physicalClock.physicsTick || clock.monotonicMs < frame.physicalClock.monotonicMs))
      this.issue('motor-edge-frame-clock-conflict', { source, sequence: frame.sequence });
  }
}

export async function auditStoppedRun(source) {
  const root = resolve(source), inputs = [];
  const bytes = async name => { const value = await readFile(resolve(root, name));
    inputs.push({ path: name, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') }); return value; };
  const report = JSON.parse(await bytes('results.json'));
  if (!report.stoppedAt || !report.final || !report.journal) throw new Error('a stopped run with final journal counts is required');
  const initial = JSON.parse(await bytes('initial-observation.json')), audit = new NativeFrameStateAudit(report, initial);
  for (const directory of ['events', 'passive-events']) {
    const names = await readdir(resolve(root, directory));
    for (const name of names.filter(name => name.endsWith('.json.gz')).sort()) {
      const path = directory + '/' + name, data = await bytes(path);
      audit.addEvent(JSON.parse(gunzipSync(data)), path, inputs.at(-1).sha256);
    }
  }
  const jsonl = async kind => {
    let value;
    try { value = await bytes(kind + '.jsonl'); }
    catch (error) { if (error.code === 'ENOENT' && !(report.journal[kind] ?? 0)) return []; throw error; }
    return value.toString('utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  };
  const decisions = await jsonl('decisions'), diagnostics = await jsonl('body-diagnostics'), actions = await jsonl('physical-actions');
  (await jsonl('initial-telemetry')).forEach((row, index) => audit.addInitialTelemetry(row, 'initial-telemetry.jsonl:' + (index + 1)));
  return { source: root, ...audit.finish(decisions, diagnostics, actions), inputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('usage: node scripts/audit-native-frame-state.mjs STOPPED_RUN NEW_AUDIT_JSON');
  const result = await auditStoppedRun(source);
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ version: result.version, status: result.status, legacy: result.legacy,
    frames: result.coverage.uniqueArchivedFrames, clocks: result.coverage.clockedFrames,
    liveDecisions: result.live.decisionsWithWatermarks, issueCounts: result.issueCounts, output: resolve(output) }));
  if (result.status !== 'passed') process.exitCode = 1;
}
