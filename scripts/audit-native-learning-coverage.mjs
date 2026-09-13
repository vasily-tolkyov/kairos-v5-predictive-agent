import assert from 'node:assert/strict';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Post-run apparatus only. Default operation imports no actor and never learns,
// selects an action, changes a world, or reclassifies hypotheses as forecasts.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item !== null
  && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
const motorId = cue => hash(canonical({ kind: cue.kind, parameters: cue.parameters }));
const cueOnly = cue => ({ kind: cue.kind, parameters: { ...cue.parameters } });
const fraction = (numerator, denominator) => denominator ? numerator / denominator : null;
const count = values => Object.fromEntries([...new Set(values)].sort().map(value =>
  [value, values.filter(item => item === value).length]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stats = values => {
  assert(values.every(finite), 'non-finite-statistic');
  const sorted = [...values].sort((a, b) => a - b), at = p => sorted.length
    ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { count: values.length, min: sorted[0] ?? null, median: at(.5), p95: at(.95),
    max: sorted.at(-1) ?? null, mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
};
const axisFields = goal => {
  const visit = expression => expression?.kind === 'predicate' ? [expression.predicate]
    : (expression?.children ?? []).flatMap(visit);
  return [...new Set(visit(goal?.expression).filter(predicate => predicate.subject?.kind === 'self'
    && /^position\.[012]$/.test(predicate.observable)).map(predicate => 'self/' + predicate.observable))];
};

// The whole completion window can include motor-off stabilization and falling.
// Those intervals are reported separately; they are not relabelled hold ticks.
export function windowTiming(event) {
  assert(event.complete === true && event.frames.length >= 2, 'incomplete-real-window');
  const first = event.frames[0], last = event.frames.at(-1);
  event.frames.forEach((frame, index) => {
    assert(Number.isSafeInteger(frame.sequence) && finite(frame.activeSeconds));
    assert(frame.self.position.length === 3 && frame.self.position.every(finite));
    if (index) {
      assert.equal(frame.sequence, event.frames[index - 1].sequence + 1, 'nonconsecutive-real-window');
      assert(frame.activeSeconds >= event.frames[index - 1].activeSeconds, 'reversed-real-clock');
    }
  });
  const requestedCue = cueOnly(event.cue), receipt = event.bodyResult?.motorReceipt;
  const common = { requestedCue, firstSequence: first.sequence, lastSequence: last.sequence,
    totalObservedIntervals: last.sequence - first.sequence,
    totalActiveSeconds: last.activeSeconds - first.activeSeconds,
    displacement: last.self.position.map((value, axis) => value - first.self.position[axis]),
    termination: event.bodyResult?.terminationReason ?? null };
  if (!receipt) return { ...common, measuredCue: requestedCue,
    durationAuthority: event.provenance === 'observed-passive' || event.cue.kind === 'passive'
      ? 'observed-passive-window' : 'no-embedded-hold-receipt',
    hold: null };
  assert.equal(receipt.version, 'MotorReceiptV1');
  assert(receipt.pressSucceeded === true && receipt.releaseSucceeded === true);
  assert(['ticks', 'holdTicks'].includes(receipt.durationParameter));
  assert.equal(event.cue.parameters[receipt.durationParameter], receipt.requestedTicks);
  assert.equal(event.bodyResult.startSequence, first.sequence);
  assert.equal(event.bodyResult.endSequence, last.sequence);
  const clocks = [receipt.requestedAt, receipt.pressedAt, receipt.releasedAt];
  clocks.forEach((clock, index) => {
    assert(Number.isSafeInteger(clock.observationSequence) && Number.isSafeInteger(clock.physicsTick));
    assert(finite(clock.activeSeconds) && finite(clock.monotonicMs));
    assert.equal(event.frames.find(frame => frame.sequence === clock.observationSequence)?.activeSeconds,
      clock.activeSeconds, 'receipt-clock-not-in-real-window');
    if (index) for (const key of ['observationSequence', 'physicsTick', 'activeSeconds', 'monotonicMs'])
      assert(clock[key] >= clocks[index - 1][key], 'reversed-motor-clock');
  });
  assert.equal(receipt.requestedAt.observationSequence, first.sequence);
  assert(Number.isSafeInteger(receipt.actualTicks) && receipt.actualTicks >= 0
    && receipt.actualTicks <= receipt.requestedTicks);
  assert.equal(receipt.actualTicks, receipt.releasedAt.physicsTick - receipt.pressedAt.physicsTick);
  assert.equal(receipt.actualSeconds, receipt.actualTicks * .05);
  assert.equal(receipt.observedIntervals, receipt.releasedAt.observationSequence - receipt.pressedAt.observationSequence);
  assert.equal(receipt.elapsedMonotonicMs, receipt.releasedAt.monotonicMs - receipt.pressedAt.monotonicMs);
  assert.equal(receipt.frameRange.startSequence, receipt.pressedAt.observationSequence);
  assert.equal(receipt.frameRange.endSequence, receipt.releasedAt.observationSequence);
  const pressed = event.frames.find(frame => frame.sequence === receipt.pressedAt.observationSequence);
  const released = event.frames.find(frame => frame.sequence === receipt.releasedAt.observationSequence);
  return { ...common, measuredCue: receipt.actualTicks === 0 ? null : { ...requestedCue,
    parameters: { ...requestedCue.parameters, [receipt.durationParameter]: receipt.actualTicks } },
    durationAuthority: 'embedded-physical-motor-receipt', hold: {
      requestedTicks: receipt.requestedTicks, actualTicks: receipt.actualTicks, actualSeconds: receipt.actualSeconds,
      elapsedMonotonicMs: receipt.elapsedMonotonicMs, observedIntervals: receipt.observedIntervals,
      releaseReason: receipt.releaseReason, releaseSequence: released.sequence,
      beforePressIntervals: pressed.sequence - first.sequence,
      afterReleaseIntervals: last.sequence - released.sequence,
      afterReleaseActiveSeconds: last.activeSeconds - released.activeSeconds,
      pressedDisplacement: released.self.position.map((value, axis) => value - pressed.self.position[axis]),
      afterReleaseDisplacement: last.self.position.map((value, axis) => value - released.self.position[axis]) } };
}

function fieldValue(observation, field, predictedGazeRole) {
  if (!observation) return undefined;
  if (field.startsWith('context/')) {
    const channel = field.slice(8);
    if (observation.predictionContext && Object.hasOwn(observation.predictionContext, channel))
      return observation.predictionContext[channel];
    const view = observation.sensation;
    if (!view || !channel.startsWith('view/')) return undefined;
    const center = 4 * (Math.floor(view.height / 2) * view.width + Math.floor(view.width / 2));
    if (channel === 'view/gaze') return view.samples[center + 3] < 0 ? view.range : view.samples[center + 3];
    const fovea = /^view\/fovea\/([012])$/.exec(channel);
    if (fovea) return view.samples[center + Number(fovea[1])];
    const sector = /^view\/([01])\/([012])$/.exec(channel);
    if (!sector) return undefined;
    const row = Number(sector[1]), col = Number(sector[2]); let sum = 0, cells = 0;
    for (let y = Math.floor(row * view.height / 2); y < Math.floor((row + 1) * view.height / 2); y++)
      for (let x = Math.floor(col * view.width / 3); x < Math.floor((col + 1) * view.width / 3); x++) {
        const depth = view.samples[4 * (y * view.width + x) + 3]; sum += depth < 0 ? view.range : depth; cells++;
      }
    return cells ? sum / cells : undefined;
  }
  if (field === 'targetId') return predictedGazeRole && observation.targetId !== null
    ? predictedGazeRole : observation.targetId;
  const slash = field.indexOf('/'), owner = field.slice(0, slash), path = field.slice(slash + 1);
  const gaze = predictedGazeRole && owner === 'object:' + predictedGazeRole;
  const subject = owner === 'self' ? observation.self : observation.objects.find(object =>
    object.id === (gaze ? observation.targetId : owner.slice('object:'.length)));
  if (gaze && path === 'visible') return Boolean(subject);
  if (!subject) return undefined;
  if (path === 'relativeDistance') return Math.hypot(...subject.relativePosition);
  return path.split('.').reduce((value, key) => value !== null && typeof value === 'object'
    && Object.hasOwn(value, key) ? value[key] : undefined, subject);
}

export function forecastRows(prediction, event) {
  const first = event.frames[0], last = event.frames.at(-1), role = prediction.predictedGazeRole;
  // An empty supported basis is not a supported forecast. Probe assumptions
  // remain separate even when their later numerical result happens to match.
  const hypothesis = prediction.hypothesizedFields !== undefined;
  const fields = [...new Set([...(hypothesis ? prediction.hypothesizedFields : prediction.supportedFields ?? []),
    ...(!hypothesis && prediction.accepted ? Object.keys(prediction.observation?.predictionContext ?? {})
      .map(channel => 'context/' + channel) : [])])];
  return fields.map(field => {
    const expected = fieldValue(prediction.observation, field, role);
    let actual = fieldValue(last, field, role), unavailableReason = actual === undefined ? 'not-observed-or-unsupported-channel' : null;
    const owner = field.slice(0, field.indexOf('/'));
    if (owner.startsWith('object:') && owner !== 'object:' + role) {
      const id = owner.slice(7), before = first.perception?.tracks.find(track => track.id === id),
        after = last.perception?.tracks.find(track => track.id === id);
      if (before && after && before.anchorEpoch !== after.anchorEpoch) {
        actual = undefined; unavailableReason = 'object-anchor-epoch-changed';
      }
    }
    const interval = prediction.observation?.predictionBounds?.[field];
    if (interval !== undefined) assert(Array.isArray(interval) && interval.length === 2
      && interval.every(finite) && interval[0] <= interval[1], 'invalid-recorded-prediction-interval');
    const numeric = finite(expected) && finite(actual), intervalEvaluable = numeric && interval !== undefined;
    return { eventId: event.id, field, fieldGroup: field.replace(/^object:[^/]+\//, 'object:*/'),
      basis: hypothesis ? 'hypothesized' : 'supported', declaredAccepted: prediction.accepted,
      expected: expected ?? null, actual: actual ?? null, actualKnown: actual !== undefined,
      unavailableReason, numeric, absoluteError: numeric ? Math.abs(expected - actual) : null,
      interval: interval ?? null, intervalWidth: interval ? interval[1] - interval[0] : null,
      intervalEvaluable, intervalContainsActual: intervalEvaluable ? actual >= interval[0] && actual <= interval[1] : null,
      // Preserve the actor comparator's numerical allowance as a SECOND metric.
      // The strict empirical coverage above never uses a tolerance to gain hits.
      intervalContainsWith1eMinus6: intervalEvaluable ? actual >= interval[0] - 1e-6 && actual <= interval[1] + 1e-6 : null,
      categoricalMatch: !numeric && actual !== undefined && expected !== undefined && !interval
        ? Object.is(expected, actual) : null };
  });
}

export function summarizeForecasts(rows, allDecisions, executedWindows) {
  const ids = new Set(rows.map(row => row.eventId)), measured = rows.filter(row => row.actualKnown),
    intervals = rows.filter(row => row.intervalEvaluable), hits = intervals.filter(row => row.intervalContainsActual).length;
  return { fieldDeclarations: rows.length, uniqueSourceWindows: ids.size, actualObservable: measured.length,
    actualUnavailable: rows.length - measured.length, numericIntervalsEvaluated: intervals.length,
    intervalHits: hits, intervalMisses: intervals.length - hits,
    strictIntervalCoverage: fraction(hits, intervals.length),
    coverageWith1eMinus6: fraction(intervals.filter(row => row.intervalContainsWith1eMinus6).length, intervals.length),
    intervalWidths: stats(rows.flatMap(row => row.intervalWidth === null ? [] : [row.intervalWidth])),
    absoluteErrors: stats(rows.flatMap(row => row.absoluteError === null ? [] : [row.absoluteError])),
    categoricalCompared: rows.filter(row => row.categoricalMatch !== null).length,
    categoricalMatched: rows.filter(row => row.categoricalMatch === true).length,
    windowSupportFractionOfAllDecisions: fraction(ids.size, allDecisions),
    windowSupportFractionOfExecuted: fraction(ids.size, executedWindows) };
}

async function audit(source, output, explicitActorDist) {
  const root = resolve(source), destination = resolve(output);
  try { await access(destination); throw new Error('audit-output-already-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const inputs = {}, bytes = async name => {
    const path = resolve(root, name), subpath = relative(root, path);
    assert(!isAbsolute(subpath) && subpath !== '..' && !subpath.startsWith('..\\') && !subpath.startsWith('../'), 'input-outside-run');
    const value = await readFile(path); inputs[name] = { bytes: value.length, sha256: hash(value) }; return value;
  };
  const json = async name => JSON.parse(await bytes(name));
  const report = await json('results.json');
  assert(report.stoppedAt && report.final && report.status !== 'running', 'stopped-native-report-required');
  assert(report.initialStats && report.journal, 'exact-initial-counters-and-journal-required');
  const delta = name => (report.final[name] ?? 0) - (report.initialStats[name] ?? 0);
  const jsonl = async (name, expected) => {
    let value;
    try { value = await bytes(name); } catch (error) { if (error.code !== 'ENOENT' || expected !== 0) throw error; value = Buffer.from(''); }
    const rows = value.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);
    assert.equal(rows.length, expected, 'journal-count-mismatch:' + name); return rows;
  };
  const decisions = await jsonl('decisions.jsonl', delta('decisions')),
    actions = await jsonl('physical-actions.jsonl', report.journal['physical-actions'] ?? 0),
    passives = await jsonl('passive-windows.jsonl', report.journal['passive-windows'] ?? 0);
  const attempts = decisions.filter(row => ['executed', 'refused'].includes(row.status));
  assert.equal(attempts.length, actions.length); assert.equal(passives.length, delta('passiveWindows'));
  assert.equal(new Set(decisions.map(row => row.index)).size, decisions.length, 'duplicate-decision');
  decisions.forEach((row, index) => assert.equal(row.index, report.initialStats.decisions + index + 1));
  const session = JSON.parse(gunzipSync(await bytes('session.json.gz')));
  assert.equal(session.medium.writes, report.final.writes); assert.equal(session.steps, report.final.decisions);
  assert.equal(session.executed, report.final.executed);
  const eventIds = new Set(), indexed = { events: [], 'passive-events': [] }, windows = [], fields = [], motors = new Map();
  let latestArchived = null;
  const registerCue = cue => {
    const id = motorId(cue); if (!motors.has(id)) motors.set(id, { id, cue: cueOnly(cue), active: 0, passive: 0,
      executedObservation: 0, selectedDecisions: 0, refusedDecisions: 0, offeredDecisions: 0 });
    return motors.get(id);
  };
  const loadEvent = async (file, lane) => {
    assert(file.startsWith(lane + '/') && /^\d+\.json\.gz$/.test(file.slice(lane.length + 1)), 'unexpected-event-path');
    const event = JSON.parse(gunzipSync(await bytes(file))); assert(!eventIds.has(event.id), 'duplicate-source-window');
    eventIds.add(event.id); indexed[lane].push(file.slice(lane.length + 1));
    assert.equal(event.provenance, lane === 'events' ? 'executed-real-body' : 'observed-passive');
    if (lane === 'passive-events') { assert.equal(event.bodyResult, null); assert.equal(event.cue.kind, 'passive'); }
    else assert(event.bodyResult?.executed === true);
    const timing = windowTiming(event);
    if (event.cue.kind === 'passive') assert.equal(event.cue.parameters.ticks, timing.totalObservedIntervals);
    if (!latestArchived || event.frames.at(-1).sequence > latestArchived.sequence) latestArchived = event.frames.at(-1);
    const row = { eventId: event.id, file, sha256: inputs[file].sha256, lane, ...timing,
      motorId: timing.measuredCue ? motorId(timing.measuredCue) : null };
    if (timing.measuredCue) {
      const motor = registerCue(timing.measuredCue); motor[lane === 'events' ? 'active' : 'passive']++;
      if (lane === 'events' && event.cue.kind === 'passive') motor.executedObservation++;
    }
    windows.push(row); return { event, row };
  };
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index], decision = attempts[index];
    assert.equal(action.executed, decision.status === 'executed');
    assert.equal(motorId(action.offer.cue), motorId(decision.offer.cue));
    const selected = registerCue(decision.offer.cue); selected.selectedDecisions++;
    if (!action.executed) selected.refusedDecisions++;
    for (const id of new Set((action.choiceOffers ?? action.availableOffers ?? []).map(offer => registerCue(offer.cue).id)))
      motors.get(id).offeredDecisions++;
    if (!action.executed) continue;
    const file = `events/${String(action.eventFile).padStart(7, '0')}.json.gz`, { event, row } = await loadEvent(file, 'events');
    assert.equal(event.id, action.eventId); assert.equal(event.frames.length, action.frames);
    assert.deepEqual(event.frames[0].self, action.before); assert.deepEqual(event.frames.at(-1).self, action.after);
    assert.equal(event.frames.at(-1).sequence, decision.observationSequence);
    row.decisionIndex = decision.index; row.goalId = decision.goalId ?? null;
    row.goalAxes = axisFields(decision.goal); row.learned = decision.learned === true;
    const prediction = decision.predictedSteps?.[0]?.prediction;
    row.freshRecordedForecast = !!prediction && decision.predictionFresh === true
      && decision.predictionObservationSequence === event.frames[0].sequence;
    if (prediction) {
      assert.equal(decision.predictedSteps.length, 1, 'only-the-actual-first-step-is-a-forecast');
      assert.equal(decision.predictedSteps[0].offer.observationSequence, event.frames[0].sequence);
      const compared = forecastRows(prediction, event);
      row.forecastBasis = prediction.hypothesizedFields !== undefined ? 'hypothesized' : 'supported';
      row.supportedFields = row.freshRecordedForecast && row.forecastBasis === 'supported'
        ? compared.map(value => value.field) : [];
      fields.push(...compared.map(value => ({ ...value, freshRecordedForecast: row.freshRecordedForecast,
        decisionIndex: decision.index, motorId: row.motorId, activeGoalAxis: row.goalAxes.includes(value.field) })));
    } else { row.forecastBasis = 'missing'; row.supportedFields = []; }
  }
  for (const passive of passives) {
    const { event, row } = await loadEvent(passive.file, 'passive-events');
    assert.equal(event.id, passive.eventId); assert.equal(event.frames.length, passive.frames);
    assert.equal(row.firstSequence, passive.first); assert.equal(row.lastSequence, passive.last);
  }
  for (const lane of Object.keys(indexed)) assert.deepEqual((await readdir(resolve(root, lane))).sort(),
    indexed[lane].sort(), 'unindexed-or-missing-raw-window:' + lane);
  assert.equal(windows.filter(row => row.lane === 'events').length, delta('executed'));
  const contexts = new Map(session.medium.contexts?.circuits ?? []);
  const networks = session.medium.networks.map(([id, network]) => {
    const circuit = contexts.get(id), motor = motors.get(id.slice(0, id.lastIndexOf('/')));
    return { id, cue: motor?.cue ?? null, observations: network.observations, receptorCount: network.inputs.length,
      retainedRows: circuit?.samples.length ?? 0,
      retainedIndependentWindowIds: new Set(circuit?.samples.flatMap(row => row.windowId ? [row.windowId] : [])).size,
      legacyRowsWithoutWindowIdentity: circuit?.samples.filter(row => !row.windowId).length ?? 0,
      motionCalibration: ['motion/0', 'motion/1', 'motion/2'].map(field => ({ field,
        contextualWindows: new Set(circuit?.samples.flatMap(row => row.windowId && row.errors?.[field] !== undefined ? [row.windowId] : [])).size,
        externalWindows: new Set(circuit?.samples.flatMap(row => row.windowId && row.externalErrors?.[field] !== undefined ? [row.windowId] : [])).size })) };
  });
  let frozenQueries = null;
  if (explicitActorDist) {
    assert(latestArchived, 'no-real-frame-for-frozen-query');
    const build = resolve(explicitActorDist), recorded = report.executedBuildHashes;
    assert(recorded && Object.keys(recorded).length, 'recorded-actor-hashes-required');
    for (const [name, digest] of Object.entries(recorded)) {
      const path = name.replaceAll('\\', '/'); assert(!path.split('/').includes('..') && !isAbsolute(path));
      assert.equal(hash(await readFile(resolve(build, 'src', path))), digest, 'actor-build-hash-mismatch:' + name);
    }
    const { ExperienceMedium } = await import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href);
    const medium = ExperienceMedium.restore(session.medium), before = hash(JSON.stringify(medium.snapshot()));
    // Bound this optional diagnostic independently of native task budgets.
    // It is not exhaustive when the acquired motor catalogue exceeds 64.
    const ordered = [...motors.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')), queries = [];
    for (const motor of ordered.slice(0, 64)) {
      const prediction = medium.predict({ ...motor.cue, targetRole: null }, latestArchived);
      queries.push({ motorId: motor.id, cue: motor.cue, offeredDuringRun: motor.offeredDecisions > 0,
        accepted: prediction.accepted, observedSamples: prediction.observedSamples,
        supportedFields: prediction.supportedFields, reason: prediction.reason });
    }
    const after = hash(JSON.stringify(medium.snapshot())); assert.equal(after, before, 'frozen-query-mutated-learning');
    frozenQueries = { actorDist: build, matchedActorFiles: Object.keys(recorded).length,
      frameSequence: latestArchived.sequence, beforeDigest: before, afterDigest: after,
      modelRestoreChangedSerializedRepresentation: canonical(medium.snapshot()) !== canonical(session.medium),
      queriedMotors: queries.length, omittedMotors: Math.max(0, ordered.length - queries.length), queries,
      authority: 'Read-only final-model queries at one archived frame, not prequential forecasts or new evidence.' };
  }
  const supported = fields.filter(row => row.basis === 'supported' && row.freshRecordedForecast),
    executed = delta('executed'), summarize = rows => summarizeForecasts(rows, decisions.length, executed);
  const goalAxes = [...new Set([...(report.protocol.requestedGoals ?? []), ...(report.tasks ?? []).map(task => task.goal)]
    .flatMap(axisFields))].sort();
  const summary = { version: 'NativeLearningCoverageAudit1', status: 'passed', source: root,
    actorCommit: report.commit, stoppedAt: report.stoppedAt, runStatus: report.status,
    scriptSha256: hash(await readFile(new URL(import.meta.url))), inputs,
    protocol: report.protocol,
    budgetNote: 'protocol.steps is a decision limit, not an executed-action count. The historical matched task uses 192 decisions / 480 seconds; 191 was an outcome, not its budget.',
    counts: { decisions: decisions.length, decisionStatuses: count(decisions.map(row => row.status)),
      attempts: attempts.length, executed, refused: decisions.filter(row => row.status === 'refused').length,
      refusalReasons: count(decisions.filter(row => row.status === 'refused').map(row => row.predictionInvalidation ?? 'unspecified')),
      executedFractionOfAllDecisions: fraction(executed, decisions.length),
      freshRecordedForecasts: windows.filter(row => row.freshRecordedForecast).length,
      supportedExecutedForecasts: windows.filter(row => row.supportedFields?.length).length,
      supportedTaskPlans: decisions.filter(row => row.source === 'task' && row.status === 'executed' && row.planLength > 0
        && windows.some(window => window.decisionIndex === row.index && window.supportedFields?.length)).length,
      uniqueNewRealWindows: windows.length, activeWindows: executed, passiveWindows: passives.length,
      activeObservationWindows: windows.filter(row => row.lane === 'events' && row.requestedCue.kind === 'passive').length,
      receiptInstrumentedWindows: windows.filter(row => row.hold).length,
      zeroDurationMotorExposures: windows.filter(row => row.hold?.actualTicks === 0).length,
      learningWrites: delta('writes'), passiveWrites: delta('passiveWrites'), activeWrites: delta('writes') - delta('passiveWrites') },
    supportedForecasts: summarize(supported),
    perField: Object.fromEntries([...new Set(supported.map(row => row.fieldGroup))].sort()
      .map(field => [field, summarize(supported.filter(row => row.fieldGroup === field))])),
    goalAxisCoverage: Object.fromEntries(goalAxes.map(field => [field, { ...summarize(supported.filter(row => row.field === field)),
      activeGoal: summarize(supported.filter(row => row.field === field && row.activeGoalAxis)) }])),
    hypotheses: { fieldDeclarations: fields.filter(row => row.basis === 'hypothesized').length,
      sourceWindows: new Set(fields.filter(row => row.basis === 'hypothesized').map(row => row.eventId)).size },
    motors: [...motors.values()].sort((a, b) => b.active - a.active || b.passive - a.passive || a.id.localeCompare(b.id, 'en')),
    finalModel: { version: session.medium.version, contextVersion: session.medium.contexts?.version ?? null,
      cumulativeWrites: session.medium.writes, networkCount: networks.length, networks, frozenQueries },
    windows: windows.sort((a, b) => a.firstSequence - b.firstSequence), fields,
    limitations: [
      'Counts are within this run only. Inherited model observations are separate and shared ancestors must not be counted twice.',
      'Distinct source-window IDs do not establish statistical independence; adjacent windows and multiple fields share physical context.',
      'Observed holds are keyed by measured duration. Receipt-free actions retain cue identity without a timing certificate.',
      'Interval coverage uses only fresh recorded supported forecasts with observable numeric outcomes. Unobservable fields and hypotheses are reported separately.',
      'Frozen final-model support is not an out-of-sample prediction result. No fitting, replay or native action occurs in this audit.',
      'This audit does not prove goal success, preservation of raw capture boundaries, long-term retention or causal multistage capability. Use the independent outcome and capture audits too.' ] };
  await writeFile(destination, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output: destination, status: summary.status, counts: summary.counts,
    goalAxisCoverage: summary.goalAxisCoverage, motorCount: summary.motors.length }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [source, output, explicitActorDist, ...extra] = process.argv.slice(2);
  assert(source && output && !extra.length,
    'usage: STOPPED_NATIVE_OUTPUT NEW_AUDIT_JSON [EXPLICIT_PINNED_ACTOR_DIST]');
  await audit(source, output, explicitActorDist);
}
