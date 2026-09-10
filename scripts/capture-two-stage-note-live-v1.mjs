/**
 * Guided training only.  The two interactions are real body events in one
 * continuous fixture; no controller, goal, prediction, or test result is
 * supplied to the memory.  This is the minimum missing 1->2 experience.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MinecraftBody } from '../dist/src/body.js';
import { Services, loadConfiguration } from '../dist/src/services.js';
import { EvidenceWriterV1 } from '../dist/src/evidence-writer.js';
import { prepareGuidedNoteFixtureLiveV1 } from '../dist/src/evaluation/minecraft-note-fixture-v1.js';
import { canonical, fileSha, saveJson, sha } from '../dist/src/util.js';

const output = resolve(process.argv[2] ?? 'evidence/current-guided-note-two-stage-training-v1');
const activeSecondsOffset = Number(process.argv[3] ?? '0');
if (!Number.isFinite(activeSecondsOffset) || activeSecondsOffset < 0) throw new Error('invalid-active-seconds-offset');
await mkdir(output, { recursive: false });
const configuration = await loadConfiguration();
const writer = new EvidenceWriterV1({
  events: createWriteStream(resolve(output, 'events.jsonl'), { flags: 'wx' }),
  frames: createWriteStream(resolve(output, 'frames.jsonl'), { flags: 'wx' }),
});
const record = (kind, value) => writer.write(kind === 'frame' ? 'frames' : 'events',
  canonical({ kind, value }) + '\n');
const services = new Services(configuration, resolve(configuration.runtimeRoot, `two-stage-note-${Date.now()}`), output);
let body = null, fixture, events = [], failure = null;
try {
  await services.start('empty');
  services.command('gamerule doWeatherCycle false');
  services.command('forceload add 688 688 720 720');
  const plan = { version: 'GuidedTwoStageNoteTrainingV1', originX: 704, originZ: 704,
    initialNote: 0, expectedTransitions: ['0->1', '1->2'], controllerExecutions: 0 };
  await saveJson(resolve(output, 'TRAINING_PLAN.json'), plan);
  body = new MinecraftBody({ ...configuration.minecraft,
    worldId: `two-stage-note-${sha(plan).slice(0, 16)}`,
    sessionId: sha({ plan, started: Date.now(), activeSecondsOffset }), activeSecondsOffset }, record);
  await body.ready();
  fixture = await prepareGuidedNoteFixtureLiveV1(services, body,
    { id: 'two-stage-note-layout', originX: plan.originX, originZ: plan.originZ,
      side: 'west', markerVariant: 3 }, 0, 0, { clearRadius: 10 });
  await body.waitTicks(5);
  if (body.latest().objects.find(value => value.id === fixture.controlId)?.properties.note !== '0')
    throw new Error('two-stage-training-initial-note-not-zero');
  record('training-public-ready', { observation: body.latest(), targetId: fixture.controlId });
  // Let the just-created remote block complete one full server/client settle
  // window before the first guided interaction.  This is still fixture setup,
  // not a planner action; the held-out run remains controller-only.
  await body.waitTicks(40);
  record('training-public-settled', { observation: body.latest(), targetId: fixture.controlId });
  for (const expected of ['1', '2']) {
    const execution = await body.execute({ kind: 'interact', parameters: {}, targetId: fixture.controlId },
      { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [fixture.controlId] });
    if (!execution.result.executed || !execution.event?.complete) throw new Error('two-stage-training-action-not-complete');
    const actual = execution.event.frames.at(-1)?.objects.find(value => value.id === fixture.controlId)
      ?.properties.note;
    if (actual !== expected) throw new Error(`two-stage-training-transition:${actual}:${expected}`);
    events.push(execution.event); record('real-event', execution.event);
  }
  if (writer.failure) throw writer.failure;
} catch (error) {
  failure = { message: error.message, stack: error.stack }; record('training-error', failure);
  process.exitCode = 1;
} finally {
  await body?.close(); await services.stop(); await writer.end();
  await saveJson(resolve(output, 'TRAINING_RESULT.json'), {
    version: 'GuidedTwoStageNoteTrainingResultV1', failure, events: events.length,
    transitions: events.map(event => ({ eventId: event.id,
      before: event.frames[0]?.objects.find(value => value.id === fixture?.controlId)?.properties.note ?? null,
      after: event.frames.at(-1)?.objects.find(value => value.id === fixture?.controlId)?.properties.note ?? null })),
    eventsSha256: await fileSha(resolve(output, 'events.jsonl')),
    framesSha256: await fileSha(resolve(output, 'frames.jsonl')),
    controllerExecutions: 0,
  });
}
if (failure) process.exitCode = 1;
