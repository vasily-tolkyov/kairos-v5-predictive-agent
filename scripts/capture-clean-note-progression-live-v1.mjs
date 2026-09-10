/**
 * Guided foundation collection for the recursive note progression.
 *
 * This is training-only: it uses a real Minecraft body and writes only raw
 * events.  It deliberately fails if either interaction does not produce the
 * declared public note transition; no retry or outcome-dependent repair is
 * allowed.  The held-out controller run receives only the final goal.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MinecraftBody } from '../dist/src/body.js';
import { Services, loadConfiguration } from '../dist/src/services.js';
import { EvidenceWriterV1 } from '../dist/src/evidence-writer.js';
import { canonical, fileSha, saveJson, sha } from '../dist/src/util.js';
import { realEventHierarchyContinuityV1, validateEvent } from '../dist/src/events.js';
import { prepareGuidedNoteFixtureLiveV1 } from '../dist/src/evaluation/minecraft-note-fixture-v1.js';
import { minecraftDistributedG6ContinuousCapturePlanV1 } from '../dist/src/evaluation/minecraft-distributed-g6-continuous-capture-v1.js';
import { counterbalancedNoteStatesV1, balancedSingleTransitionStatesV1 }
  from '../dist/src/evaluation/note-progression-test-contract.js';

const { values } = parseArgs({ options: {
  output: { type: 'string' },
  'initial-note': { type: 'string', default: '0' },
  repetitions: { type: 'string', default: '2' },
  interactions: { type: 'string', default: '2' },
  counterbalanced: { type: 'boolean', default: false },
  'single-transition-states': { type: 'string' },
  'active-seconds-offset': { type: 'string', default: '0' },
} });
if (!values.output) throw new Error('clean-capture-requires-new-output-directory');
const output = resolve(values.output);
await mkdir(output, { recursive: false });
const initialNote = Number(values['initial-note']);
const repetitions = Number(values.repetitions);
const interactions = Number(values.interactions);
const activeSecondsOffset = Number(values['active-seconds-offset']);
if (!Number.isFinite(activeSecondsOffset) || activeSecondsOffset < 0)
  throw new Error('clean-capture-invalid-experience-offset');
if (!Number.isInteger(initialNote) || initialNote < 0 || initialNote > 22)
  throw new Error('clean-capture-invalid-initial-note');
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 4)
  throw new Error('clean-capture-invalid-repetitions');
if (![1, 2].includes(interactions)) throw new Error('clean-capture-invalid-interactions');
const eventsPerEpisode = interactions === 1 ? 2 : 4;
if (values.counterbalanced && interactions !== 1)
  throw new Error('counterbalanced-capture-requires-separate-single-transitions');
const singleTransitionStates = values['single-transition-states']?.split(',').map(Number);
if (singleTransitionStates && (interactions !== 1 || values.counterbalanced))
  throw new Error('explicit-rehearsal-requires-single-transitions-without-pair-mode');
if (singleTransitionStates) balancedSingleTransitionStatesV1(singleTransitionStates, 0, 0);

const sourcePlan = minecraftDistributedG6ContinuousCapturePlanV1();
// Keep interaction geometry fixed while varying four publicly visible marker
// layouts.  Absolute translation alone is not an independent public context.
// Direction generalization is a separate heldout question, not this cohort's
// manipulated variable.
const layouts = sourcePlan.layouts.map((layout, index) => ({ ...layout,
  id: `clean-note-progression-layout-${String(index + 1).padStart(2, '0')}`,
  side: 'west',
}));
const episodes = Array.from({ length: repetitions }, (_, repetition) => layouts.flatMap((layout, layoutOrdinal) =>
  (singleTransitionStates ? balancedSingleTransitionStatesV1(singleTransitionStates, repetition, layoutOrdinal)
    : values.counterbalanced ? counterbalancedNoteStatesV1(initialNote, repetition, layoutOrdinal) : [initialNote])
    .map(note => ({ layoutOrdinal, layout, repetition, initialNote: note })))).flat()
  .map((episode, episodeOrdinal) => ({ ...episode, episodeOrdinal }));
const plan = Object.freeze({
  version: 'CleanMinecraftNoteProgressionCaptureV1',
  sourceLayoutPlan: sourcePlan.version,
  initialNote,
  counterbalanced: values.counterbalanced,
  singleTransitionStates: singleTransitionStates ?? null,
  activeSecondsOffset,
  episodes,
  layouts,
  repetitions,
  fixtureSettleTicks: 60,
  publicGameMode: 'survival',
  neutralMarkers: 'visible',
  expectedTransitions: singleTransitionStates
    ? singleTransitionStates.map(note => `${note}->${note + 1}`)
    : Array.from({ length: values.counterbalanced ? 2 : interactions },
      (_, i) => `${initialNote + i}->${initialNote + i + 1}`),
  eventsPerEpisode,
  expectedEpisodes: episodes.length,
  expectedRealEvents: episodes.length * eventsPerEpisode,
  actionSequence: [
    { kind: 'look', parameters: { yawDegrees: 0, pitchDegrees: 0 } },
    { kind: 'interact', target: 'current-public-note-block' },
    ...(interactions === 2 ? [{ kind: 'interact', target: 'current-public-note-block' },
      { kind: 'observe', parameters: { ticks: 5 } }] : []),
  ],
  controllerExecutions: 0,
  physicalWrites: 0,
});
await saveJson(resolve(output, 'CLEAN_CAPTURE_PLAN.json'), { plan, planSha256: sha(plan) });

const writer = new EvidenceWriterV1({
  events: createWriteStream(resolve(output, 'events.jsonl'), { flags: 'wx' }),
  frames: createWriteStream(resolve(output, 'frames.jsonl'), { flags: 'wx' }),
});
const record = (kind, value) => writer.write(kind === 'frame' ? 'frames' : 'events', canonical({ kind, value }) + '\n');
const services = new Services(await loadConfiguration(), resolve(output, 'runtime'), output);
const captured = [];
const observedClosures = [];
let body = null, failure = null;
const noteOf = (observation, id) => observation.objects.find(value => value.id === id)?.properties.note;
try {
  await services.start('empty');
  services.command('gamerule doWeatherCycle false');
  services.command('forceload add 540 540 656 616');
  const config = await loadConfiguration();
  body = new MinecraftBody({ ...config.minecraft,
    worldId: `clean-note-progression-${sha(plan).slice(0, 16)}`,
    sessionId: sha({ plan, started: Date.now() }), activeSecondsOffset,
  }, record);
  await body.ready();
  for (const episode of episodes) {
    const initialNote = episode.initialNote;
    services.command(`gamemode survival ${body.bot.username}`);
    for (let tick = 0; body.latest().self.properties.gameMode !== 'survival' && tick < 200; tick++)
      await body.waitTicks(1);
    if (body.latest().self.properties.gameMode !== 'survival') throw new Error('clean-capture-survival-not-observed');
    const prepared = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, initialNote, 0,
      { neutralMarkers: 'visible', clearRadius: 10 });
    // The setblock packet and the client block-state update are separate
    // real ticks.  Let the fixture settle before the first recorded action;
    // this is setup time, not a hidden interaction or a retry.
    await body.waitTicks(60);
    if (noteOf(body.latest(), prepared.controlId) !== String(initialNote))
      throw new Error(`clean-capture-initial-note-mismatch:${episode.episodeOrdinal}`);
    const actions = [
      { kind: 'look', parameters: { yawDegrees: 0, pitchDegrees: 0 } },
      { kind: 'interact', parameters: {}, targetId: prepared.controlId },
      ...(interactions === 2 ? [{ kind: 'interact', parameters: {}, targetId: prepared.controlId },
        { kind: 'observe', parameters: { ticks: 5 } }] : []),
    ];
    const events = [];
    for (const [index, action] of actions.entries()) {
      const execution = await body.execute(action, { version: 'ActionObservationScopeV1',
        referencedPublicObjectIds: [prepared.controlId] });
      if (!execution.result.executed || !execution.event?.complete)
        throw new Error(`clean-capture-action-failed:${episode.episodeOrdinal}:${index}:${canonical(execution.result)}`);
      if (index === 1 && noteOf(body.latest(), prepared.controlId) !== String(initialNote + 1))
        throw new Error(`clean-capture-first-transition-missing:${episode.episodeOrdinal}`);
      if (index === 2 && noteOf(body.latest(), prepared.controlId) !== String(initialNote + 2))
        throw new Error(`clean-capture-second-transition-missing:${episode.episodeOrdinal}`);
      events.push(execution.event);
    }
    const tagged = events.map((event, index) => {
      validateEvent(event);
      const { hierarchyContinuity: _old, ...publicEvent } = event;
      return { ...publicEvent, hierarchyContinuity: realEventHierarchyContinuityV1(
        publicEvent, body.session.id, index === 0 ? 'reset' : 'continuous') };
    });
    if (interactions === 1) {
      const last = tagged.at(-1), tail = last.frames.slice(-5);
      const publicStates = tail.map(frame => ({ self: frame.self,
        object: frame.objects.find(object => object.id === prepared.controlId) }));
      if (tail.length !== 5 || !publicStates.every(state => state.object !== undefined)
        || new Set(publicStates.map(sha)).size !== 1
        || !['stable', 'no-effect-window-complete'].includes(last.bodyResult.terminationReason))
        throw new Error('clean-single-transition-process-not-publicly-stable');
      observedClosures.push({ afterEventId: last.id, reason: 'normal-stop-after-public-stability',
        frameSequences: tail.map(frame => frame.sequence), frameHashes: tail.map(sha),
        finalPublicStateSha256: sha(publicStates[0]) });
      record('observed-process-closure', observedClosures.at(-1));
    } else if (tagged.at(-1)?.hierarchyContinuity?.processStatusAfter !== 'publicly-resolved')
      throw new Error(`clean-capture-process-not-resolved:${episode.episodeOrdinal}`);
    for (const event of tagged) record('real-event', event);
    captured.push({ episodeOrdinal: episode.episodeOrdinal, layoutOrdinal: episode.layoutOrdinal,
      repetition: episode.repetition, initialNote, controlId: prepared.controlId, events: tagged,
      finalNote: noteOf(body.latest(), prepared.controlId) });
    await writer.flush();
    process.stdout.write(JSON.stringify({ capturedEpisodes: captured.length,
      realEvents: captured.length * eventsPerEpisode, finalNote: captured.at(-1).finalNote }) + '\n');
  }
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  record('capture-error', failure);
  process.exitCode = 1;
} finally {
  await body?.close();
  await services.stop();
  await writer.end();
  failure ??= writer.failure ? { message: writer.failure.message } : null;
  await saveJson(resolve(output, 'CLEAN_CAPTURE_RESULT.json'), {
    version: 'CleanMinecraftNoteProgressionCaptureResultV1', completedCapture: failure === null
      && captured.length === episodes.length, failure, capturedEpisodes: captured.length,
    realEvents: captured.length * eventsPerEpisode, expectedEpisodes: episodes.length, eventsPerEpisode,
    expectedRealEvents: episodes.length * eventsPerEpisode, controllerExecutions: 0, physicalWrites: 0,
    observedClosures,
    eventsSha256: await fileSha(resolve(output, 'events.jsonl')),
    framesSha256: await fileSha(resolve(output, 'frames.jsonl')),
    episodes: captured.map(value => ({ episodeOrdinal: value.episodeOrdinal,
      layoutOrdinal: value.layoutOrdinal, repetition: value.repetition, finalNote: value.finalNote,
      initialNote: value.initialNote,
      eventIds: value.events.map(event => event.id) })),
  });
}
