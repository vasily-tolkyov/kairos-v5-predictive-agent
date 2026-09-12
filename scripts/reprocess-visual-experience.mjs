import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
const build = process.argv[5] ? resolve(process.argv[5]) : new URL('../dist/', import.meta.url).pathname;
const { ExperienceMedium } = await import(resolve(build, 'src/experience-medium.js'));
const { AttentivePerception } = await import(resolve(build, 'src/perception.js'));
const { cueFor } = await import(resolve(build, 'src/events.js'));
const { LearnedAffordances } = await import(resolve(build, 'src/learned-affordances.js'));
const { ExperienceSession } = await import(resolve(build, 'src/experience-session.js'));
const { anonymousObservation } = await import(resolve(build, 'src/adapters/minecraft/experience.js'));

// Re-encode each original measured window once. This is a model migration
// from retained sensory experience, not new exploration or additional trials.
const [source, output, phase = 'learn-A'] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: reprocess-visual-experience.mjs RUN_DIRECTORY NEW_MEMORY.gz [PHASE] [BUILD_DIRECTORY] [--with-offers]');
const compress = promisify(gzip), decompress = promisify(gunzip), evidence = [];
let medium = new ExperienceMedium(41), perception = new AttentivePerception(), affordances = new LearnedAffordances();
const withOffers = process.argv.includes('--with-offers'); let exactOfferFrames = 0;
let maskedLegacyOxygenFrames = 0;
const directories = source.split(',').map(path => resolve(path)), target = resolve(output);
if (existsSync(target)) throw new Error('completed-output-already-exists');
const checkpointPath = target + '.checkpoint.json.gz', pausePath = target + '.PAUSE';
const pauseOption = process.argv.find(value => value.startsWith('--pause-after='));
const pauseAfter = pauseOption ? Number(pauseOption.slice('--pause-after='.length)) : Infinity;
if (pauseAfter !== Infinity && (!Number.isSafeInteger(pauseAfter) || pauseAfter < 1)) throw new Error('invalid-pause-after');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compiledHashes = Object.fromEntries(await Promise.all(['experience-medium', 'perception', 'contextual-readout', 'learned-affordances'].map(async name =>
  [name, hash(await readFile(resolve(build, 'src', name + '.js')))])));
const encoderHash = hash(await readFile(new URL(import.meta.url)));
const offerJournalHashes = withOffers ? await Promise.all(directories.map(async directory =>
  hash(await readFile(resolve(directory, 'physical-actions.jsonl'))))) : [];
const filesByDirectory = await Promise.all(directories.map(async directory =>
  (await readdir(resolve(directory, 'events'))).filter(name => name.endsWith('.json.gz')).sort()));
let resumeDirectory = 0, resumeFile = 0, resumed = false, newWindows = 0;
if (existsSync(checkpointPath)) {
  const state = JSON.parse(await decompress(await readFile(checkpointPath)));
  if (state.version !== 'VisualReencodingCheckpoint1' || state.encoderHash !== encoderHash
    || JSON.stringify(state.compiledHashes) !== JSON.stringify(compiledHashes)
    || JSON.stringify(state.directories) !== JSON.stringify(directories) || state.phase !== phase || state.withOffers !== withOffers
    || JSON.stringify(state.offerJournalHashes) !== JSON.stringify(offerJournalHashes)
    || JSON.stringify(state.filesByDirectory) !== JSON.stringify(filesByDirectory)) throw new Error('reencoding-checkpoint-input-or-encoder-mismatch');
  for (const entry of state.evidence) if (hash(await readFile(entry.path)) !== entry.sha256)
    throw new Error('reencoding-original-window-changed:' + entry.path);
  medium = ExperienceMedium.restore(state.medium); affordances = LearnedAffordances.restore(state.affordances);
  perception = AttentivePerception.restore(state.perception); evidence.push(...state.evidence);
  if (medium.writes !== evidence.length || !Number.isSafeInteger(state.directoryIndex) || state.directoryIndex < 0
    || state.directoryIndex >= directories.length || !Number.isSafeInteger(state.nextFileIndex)
    || state.nextFileIndex < 0 || state.nextFileIndex > filesByDirectory[state.directoryIndex].length)
    throw new Error('invalid-reencoding-checkpoint-cursor');
  exactOfferFrames = state.exactOfferFrames; maskedLegacyOxygenFrames = state.maskedLegacyOxygenFrames;
  resumeDirectory = state.directoryIndex; resumeFile = state.nextFileIndex; resumed = true;
  console.log(JSON.stringify({ status: 'resumed-verified-prefix', writes: medium.writes, checkpoint: checkpointPath }));
}
const checkpoint = async (directoryIndex, nextFileIndex) => {
  const bytes = await compress(JSON.stringify({ version: 'VisualReencodingCheckpoint1', directories, filesByDirectory,
    phase, withOffers, compiledHashes, encoderHash, offerJournalHashes, directoryIndex, nextFileIndex,
    medium: medium.snapshot(), affordances: affordances.snapshot(), perception: perception.snapshot(), evidence,
    exactOfferFrames, maskedLegacyOxygenFrames, newPhysicalTrials: 0 }));
  await writeFile(checkpointPath + '.pending', bytes); await rename(checkpointPath + '.pending', checkpointPath);
  await writeFile(checkpointPath + '.manifest.json', JSON.stringify({ status: 'partial-reencoding-checkpoint',
    checkpoint: checkpointPath, sha256: hash(bytes), bytes: bytes.length, writes: medium.writes,
    directoryIndex, nextFileIndex, encoderHash, compiledHashes, newPhysicalTrials: 0 }, null, 2));
};
for (let directoryIndex = resumeDirectory; directoryIndex < directories.length; directoryIndex++) {
const directory = directories[directoryIndex];
if (!(resumed && directoryIndex === resumeDirectory)) perception.reset();
const offersByEvent = new Map();
if (withOffers) {
  const lines = (await readFile(resolve(directory, 'physical-actions.jsonl'), 'utf8')).trim().split('\n');
  for (const line of lines) { const record = JSON.parse(line); if (record.eventId) offersByEvent.set(record.eventId, record.availableOffers); }
}
const names = filesByDirectory[directoryIndex];
for (let fileIndex = directoryIndex === resumeDirectory ? resumeFile : 0; fileIndex < names.length; fileIndex++) {
  const name = names[fileIndex];
  const raw = await readFile(resolve(directory, 'events', name)), record = JSON.parse(await decompress(raw));
  if (record.event && phase !== '*' && record.phase !== phase) continue;
  const original = record.event ?? record;
  if (!original.frames.every(frame => frame.sensation?.version === 'AnonymousRGBD1'
    && ['AttentivePerception1', 'AttentivePerception2', 'AttentivePerception3', 'AttentivePerception4', 'AttentivePerception5', 'AttentivePerception6', 'AttentivePerception7', 'AttentivePerception8'].includes(frame.perception?.version))) throw new Error('missing-original-visual-sensation');
  const frames = original.frames.map(frame => {
    // Legacy oxygen came from an SDK aggregate that could belong to any
    // entity. The original packets were not retained, so it is unknown;
    // never infer a replacement from health, location, or a desired outcome.
    if (Object.hasOwn(frame.self.properties, 'oxygen') && frame.bodySensation?.version !== 'OwnedBodySignals1') {
      const { oxygen: _unowned, ...properties } = frame.self.properties;
      frame = { ...frame, self: { ...frame.self, properties } }; maskedLegacyOxygenFrames++;
    }
    return anonymousObservation({ ...frame, perception: perception.observe(frame, frame.sensation) });
  });
  const action = original.bodyResult?.action;
  // Identity counters can change during re-encoding. Transfer the originally
  // chosen focus only when its measured anchor/appearance binds uniquely.
  const originalFocus = original.frames[0].objects.find(object => object.id === original.attentionId);
  const originalPoint = original.frames[0].perception.tracks.find(track => track.id === original.attentionId)?.surface?.point
    ?? originalFocus?.relativePosition;
  const candidates = originalFocus ? frames[0].objects.map(object => ({ id: object.id,
    distance: Math.hypot(...object.relativePosition.map((v, i) => v - originalPoint[i])),
    color: Math.hypot(...['red', 'green', 'blue'].map(key => Number(object.properties[key]) - Number(originalFocus.properties[key])))
  })).filter(match => match.distance < .2 && match.color < .05) : [];
  const attentionId = original.attentionId === undefined ? undefined : candidates.length === 1 ? candidates[0].id : null;
  if (action?.targetId && !frames[0].targetId) throw new Error('reencoded-commanded-target-not-observed:' + original.id);
  const reboundAction = action ? { ...action, ...(action.targetId ? { targetId: frames[0].targetId } : {}) } : null;
  const event = { ...original, frames, cue: reboundAction ? cueFor(reboundAction, frames[0]) : original.cue,
    attentionId,
    trackedIds: ['self', ...new Set(frames.flatMap(frame => [attentionId, frame.targetId, frame.perception.attendedId]).filter(Boolean))],
    bodyResult: action ? { ...original.bodyResult, action: { ...action,
      ...(action.targetId ? { targetId: frames[0].targetId } : {}) } } : null };
  const observedOffers = offersByEvent.get(original.id);
  if (observedOffers?.length && observedOffers.every(offer => offer.observationSequence === original.frames[0].sequence
    && (!offer.action.targetId || frames[0].targetId))) {
    const reboundOffers = observedOffers.map(offer => {
      const action = { ...offer.action, ...(offer.action.targetId ? { targetId: frames[0].targetId } : {}) };
      return { ...offer, action, cue: cueFor(action, frames[0]) };
    });
    affordances.observe(frames[0], reboundOffers); exactOfferFrames++;
  }
  const result = medium.observe(event);
  if (!result.learned) throw new Error('duplicate-original-window');
  evidence.push({ path: resolve(directory, 'events', name), sha256: createHash('sha256').update(raw).digest('hex'),
    eventId: original.id, derivedEventSha256: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    originalAttentionId: original.attentionId, attentionId,
    measuredChannels: result.measuredChannels, maskedObjects: result.maskedObjects });
  const pausing = ++newWindows >= pauseAfter || existsSync(pausePath);
  if (medium.writes % 64 === 0 || pausing) {
    await checkpoint(directoryIndex, fileIndex + 1);
    console.log(JSON.stringify({ writes: medium.writes, exactOfferFrames, source: directory, event: name,
      status: pausing ? 'checkpoint-paused' : 'checkpointed' }));
  }
  if (pausing) process.exit(0);
}
await checkpoint(directoryIndex, names.length);
}
const snapshot = withOffers ? new ExperienceSession(medium, affordances).snapshot() : medium.snapshot();
await writeFile(resolve(output), await compress(JSON.stringify(snapshot)), { flag: 'wx' });
await writeFile(resolve(output + '.provenance.json'), JSON.stringify({ sources: directories, phase,
  version: medium.snapshot().version, writes: medium.writes, newPhysicalTrials: 0, exactOfferFrames, unavailableOfferFrames: evidence.length - exactOfferFrames,
  maskedLegacyOxygenFrames, maskedChannelReason: 'Legacy SDK oxygen aggregate did not establish ownership; no replacement values were invented.',
  compiledHashes, encoderHash, offerJournalHashes, resumedFromVerifiedCheckpoint: resumed, evidence }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ writes: medium.writes, exactOfferFrames, newPhysicalTrials: 0, output: resolve(output) }));
