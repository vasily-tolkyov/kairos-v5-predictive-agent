/** Guided learning only. No controller, prediction or heldout score runs here. */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MinecraftBody } from '../dist/src/body.js';
import { Services, loadConfiguration } from '../dist/src/services.js';
import { EvidenceWriterV1 } from '../dist/src/evidence-writer.js';
import { canonical, saveJson, sha, fileSha } from '../dist/src/util.js';
import { realEventHierarchyContinuityV1, validateEvent } from '../dist/src/events.js';
import { prepareGuidedNoteFixtureLiveV1 } from '../dist/src/evaluation/minecraft-note-fixture-v1.js';
import { minecraftDistributedG6ContinuousCapturePlanV1, retagDistributedG6ContinuousEpisodeV1,
  auditDistributedG6PublicPairV1 } from '../dist/src/evaluation/minecraft-distributed-g6-continuous-capture-v1.js';

const { values } = parseArgs({ options: { output: { type: 'string' },
  'single-interaction': { type: 'boolean', default: false },
  'initial-note': { type: 'string', default: '0' },
  repetitions: { type: 'string', default: '1' } } });
if (!values.output) throw new Error('capture-requires-new-output-directory');
const directory = resolve(values.output);
await mkdir(directory, { recursive: false });
const config = await loadConfiguration();
const sourcePlan = minecraftDistributedG6ContinuousCapturePlanV1();
// A separate, preregistered foundation experiment. A trial ends after one
// actual interaction's complete stable window, before a second action exists.
// It diagnoses single-action readout, not the earlier note=2 task or controller.
const singleInteraction = values['single-interaction'];
const initialNote = Number(values['initial-note']);
const repetitions = Number(values.repetitions);
if (!Number.isInteger(initialNote) || initialNote < 0 || initialNote > 24)
  throw new Error('invalid-initial-note');
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 4)
  throw new Error('invalid-repetitions');
const repeatedEpisodes = Array.from({ length: repetitions }, (_, repetition) =>
  sourcePlan.episodes.map(episode => ({ ...episode,
    episodeOrdinal: repetition * sourcePlan.episodes.length + episode.episodeOrdinal,
    pairCohort: repetition * sourcePlan.layouts.length + episode.layoutOrdinal,
    repetition }))).flat();
const plan = singleInteraction ? {
  version: 'SingleInteractionFoundationCaptureV1',
  sourceLayoutPlan: sourcePlan.version, expectedRealEvents: repeatedEpisodes.length * 2,
  episodes: repeatedEpisodes.map(episode => ({ ...episode, actions: episode.actions.slice(0, 2) })),
  completion: 'normal-stop-after-actual-interaction-window-and-five-stable-public-frames',
  noOutcomeDependentRetry: true,
} : repetitions === 1 ? sourcePlan : {
  ...sourcePlan, version: 'RepeatedGuidedFoundationCaptureV1',
  expectedRealEvents: repeatedEpisodes.length * sourcePlan.episodes[0].actions.length,
  episodes: repeatedEpisodes,
};
await saveJson(resolve(directory, 'GUIDED_CAPTURE_PLAN.json'), {
  kind: 'guided-real-events-from-empty-without-physical-replay',
  plan, planSha256: sha(plan), initialNote, controllerExecutions: 0, loadedExperiences: 0,
});
const writer = new EvidenceWriterV1({
  events: createWriteStream(resolve(directory, 'events.jsonl'), { flags: 'wx' }),
  frames: createWriteStream(resolve(directory, 'frames.jsonl'), { flags: 'wx' }),
});
const record = (kind, value) => writer.write(kind === 'frame' ? 'frames' : 'events',
  canonical({ kind, value }) + '\n');
const services = new Services(config, resolve(config.runtimeRoot, `guided-note-${Date.now()}`), directory);
const captured = [], pairs = [], observedClosures = [];
let body = null, failure = null;
try {
  await services.start('empty');
  services.command('gamerule doWeatherCycle false');
  services.command('forceload add 540 540 656 616');
  body = new MinecraftBody({ ...config.minecraft,
    worldId: `guided-note-${sha(plan).slice(0, 16)}`,
    sessionId: sha({ plan: sha(plan), started: Date.now() }), activeSecondsOffset: 0,
  }, record);
  await body.ready();
  for (const episode of plan.episodes) {
    // Fixture transport is not an experimental factor: load/settle the new
    // floor in ordinary collision mode, then apply the declared public factor.
    // Spectator transport into an unloaded client chunk otherwise falls
    // through that floor before the first actual observation is available.
    services.command(`gamemode survival ${body.bot.username}`);
    for (let tick = 0; body.latest().self.properties.gameMode !== 'survival' && tick < 200; tick++)
      await body.waitTicks(1);
    if (body.latest().self.properties.gameMode !== 'survival') throw new Error('fixture-mode-not-observed');
    const prepared = await prepareGuidedNoteFixtureLiveV1(services, body, episode.layout, initialNote,
      episode.initialYawOffsetDegrees, { clearRadius: 10 });
    services.command(`gamemode ${episode.publicGameMode} ${body.bot.username}`);
    for (let tick = 0; body.latest().self.properties.gameMode !== episode.publicGameMode && tick < 200; tick++)
      await body.waitTicks(1);
    if (body.latest().self.properties.gameMode !== episode.publicGameMode)
      throw new Error('experimental-public-mode-not-observed');
    await body.waitTicks(5);
    const events = [];
    for (const action of episode.actions) {
      const selected = action.kind === 'interact' ? { ...action, targetId: prepared.controlId } : action;
      const execution = await body.execute(selected, { version: 'ActionObservationScopeV1',
        referencedPublicObjectIds: [prepared.controlId] });
      if (!execution.result.executed || !execution.event?.complete)
        throw new Error(`guided-body-result:${episode.episodeOrdinal}:${canonical(execution.result)}`);
      events.push(execution.event);
      if (writer.failure) throw writer.failure;
    }
    let tagged;
    if (singleInteraction) {
      tagged = events.map((event, index) => {
        validateEvent(event);
        const { hierarchyContinuity: _old, ...publicEvent } = event;
        return { ...publicEvent, hierarchyContinuity: realEventHierarchyContinuityV1(
          publicEvent, body.session.id, index === 0 ? 'reset' : 'continuous') };
      });
      const last = tagged.at(-1), tail = last.frames.slice(-5);
      const publicStates = tail.map(frame => ({ self: frame.self,
        object: frame.objects.find(object => object.id === prepared.controlId) }));
      if (tail.length !== 5 || !publicStates.every(state => state.object !== undefined)
        || new Set(publicStates.map(sha)).size !== 1
        || !['stable', 'no-effect-window-complete'].includes(last.bodyResult.terminationReason))
        throw new Error('single-interaction-process-did-not-close-in-real-stable-window');
      observedClosures.push({ afterEventId: last.id, reason: 'normal-stop-after-public-stability',
        frameSequences: tail.map(frame => frame.sequence),
        frameHashes: tail.map(sha), finalPublicStateSha256: sha(publicStates[0]) });
      record('observed-process-closure', observedClosures.at(-1));
    } else tagged = retagDistributedG6ContinuousEpisodeV1(events, body.session.id);
    for (const event of tagged) record('real-event', event);
    const entry = { episodeOrdinal: episode.episodeOrdinal, layoutOrdinal: episode.layoutOrdinal,
      turnDegrees: episode.turnDegrees, publicGameMode: episode.publicGameMode,
      pairCohort: episode.pairCohort ?? episode.layoutOrdinal, events: tagged };
    captured.push(entry);
    const layoutEntries = captured.filter(value => value.pairCohort === entry.pairCohort);
    if (layoutEntries.length === 4) for (const direction of [15, -15]) {
      const baseline = layoutEntries.find(value => value.turnDegrees === direction && value.publicGameMode === 'spectator');
      const intervention = layoutEntries.find(value => value.turnDegrees === direction && value.publicGameMode === 'survival');
      pairs.push(auditDistributedG6PublicPairV1(episode.layoutOrdinal, direction,
        baseline.events, intervention.events));
    }
    await writer.flush();
    process.stdout.write(JSON.stringify({ capturedEpisodes: captured.length,
      realEvents: captured.reduce((sum, entry) => sum + entry.events.length, 0), finalNote: body.latest().objects
        .find(value => value.id === prepared.controlId)?.properties.note ?? null }) + '\n');
  }
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  record('capture-error', failure);
  process.exitCode = 1;
} finally {
  await body?.close();
  await services.stop();
  await writer.end();
  if (writer.failure) { failure ??= { message: writer.failure.message }; process.exitCode = 1; }
  await saveJson(resolve(directory, 'CAPTURE_RESULT.json'), {
    completedCapture: captured.length === plan.episodes.length && failure === null,
    failure, capturedEpisodes: captured.length,
    realEvents: captured.reduce((sum, entry) => sum + entry.events.length, 0), observedClosures,
    physicalWrites: 0, controllerExecutions: 0, pairAudits: pairs,
    matchedPairs: pairs.filter(value => value.otherPublicChannelsMatched).length,
    eventsSha256: await fileSha(resolve(directory, 'events.jsonl')),
    framesSha256: await fileSha(resolve(directory, 'frames.jsonl')),
  });
}
