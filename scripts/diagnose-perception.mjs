import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventRows, eventLocalCurrentPublicStateV1 } from '../dist/src/events.js';
import { experienceState } from '../dist/src/experience-medium.js';
import { SelfOrganizingAfferentProjectionV1 } from '../dist/src/core/learning/self-organizing-afferent.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';

// Offline diagnosis only. Replaying or transforming records below is NOT new
// real experience, autonomous exploration, or a Minecraft capability trial.
const [evidenceArg, baselineArg, outputArg, mediumBuildArg] = process.argv.slice(2);
if (!outputArg || !mediumBuildArg) throw new Error('Historical V1 diagnosis only. Usage: node scripts/diagnose-perception.mjs EVIDENCE BASELINE OUTPUT V1_BUILD_ROOT');
const { ExperienceMedium } = await import(pathToFileURL(resolve(mediumBuildArg, 'src/experience-medium.js')).href);
if (new ExperienceMedium().snapshot().version !== 'KairosExperienceMediumV1') throw new Error('historical-diagnosis-requires-V1-medium');
const evidence = resolve(evidenceArg), baseline = resolve(baselineArg), output = resolve(outputArg);
const old = await import(pathToFileURL(join(baseline, 'dist/src/events.js')).href);
const oldAfferent = await import(pathToFileURL(join(baseline, 'dist/src/core/learning/self-organizing-afferent.js')).href);
const oldPhysics = await import(pathToFileURL(join(baseline, 'dist/src/core/physics/distributed-physical-medium.js')).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const increment = (map, key, by = 1) => { map[key] = (map[key] ?? 0) + by; };
const sameLayout = (a, b) => JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b));
const records = async function* (file) {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity }))
    if (line.trim()) yield JSON.parse(line);
};
const files = [], windows = [], kinds = {}, seen = new Set(), inputs = new Set();
let first, poison, firstUnionFailure = null;
let legacyEncoded = 0, legacyIdentical = 0, legacyAmbiguous = 0, bindingCount = 0, unresolvedCount = 0;
let legacyOriginMismatch = 0;
for (const [run, phase] of [['baseline-41', 'learn-A'], ['transfer-41', 'learn-B']]) {
  const file = join(evidence, run, 'events.jsonl');
  files.push({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
  for await (const record of records(file)) {
    if (record.phase !== phase) continue;
    const event = record.event, before = experienceState(event.frames[0]), after = experienceState(event.frames.at(-1));
    first ??= event;
    const accepted = sameLayout(before, after), stat = kinds[event.cue.kind] ??= { events: 0, accepted: 0 };
    stat.events++; stat.accepted += Number(accepted);
    if (accepted) {
      for (const state of [before, after]) for (const [key, value] of Object.entries(state)) {
        seen.add(key); inputs.add(JSON.stringify([key, value]));
      }
      if (!poison && Object.keys(before).some(key => !Object.hasOwn(experienceState(first.frames[0]), key))) poison = event;
    }
    const missing = [...seen].filter(key => !Object.hasOwn(after, key)).length;
    if (firstUnionFailure === null && missing > 0) firstUnionFailure = { ordinal: windows.length + 1, eventId: event.id, learned: accepted, missingAfter: missing };
    const row = { eventId: event.id, phase, kind: event.cue.kind, newAccepted: accepted,
      beforeChannels: Object.keys(before).length, afterChannels: Object.keys(after).length,
      unionChannels: seen.size, missingAfter: missing };
    try {
      const legacy = old.eventRows(event), current = eventRows(event);
      legacyEncoded++; legacyIdentical += Number(hash(legacy) === hash(current));
      const origin = old.eventLocalCurrentPublicStateV1(event.frames[0], legacy.roleBindings);
      bindingCount += legacy.roleBindings.length; unresolvedCount += origin.unresolvedRoles.length;
      legacyAmbiguous += Number(origin.unresolvedRoles.length > 0);
      const reencoded = Object.fromEntries(origin.values.map(value => [JSON.stringify([value.subjectRole, value.property]), value.value]));
      const original = Object.fromEntries(Object.entries(legacy.measurementStates[0]).flatMap(([role, values]) =>
        Object.entries(values).map(([property, value]) => [JSON.stringify([role, property]), value])));
      const mismatches = [...new Set([...Object.keys(original), ...Object.keys(reencoded)])].filter(key => !Object.is(original[key], reencoded[key]));
      legacyOriginMismatch += Number(mismatches.length > 0);
      row.legacy = { encoded: true, unresolvedRoles: origin.unresolvedRoles.length, bindings: legacy.roleBindings.length,
        originMismatchCount: mismatches.length, mismatchExamples: mismatches.slice(0, 3) };
    } catch (error) { row.legacy = { encoded: false, error: String(error) }; }
    windows.push(row);
  }
}
assert(first && poison);

// Same exact real window repeated with diagnostic identities to isolate
// representation gates from environmental noise and inadequate training.
const medium = new ExperienceMedium(41);
for (let index = 0; index < 80; index++) medium.observe({ ...first, id: `diagnostic-repeat-${index}` });
const original = first.frames[0], supported = medium.predict(first.cue, original);
assert.equal(supported.accepted, true, 'positive control must learn the fixed repeated window');
const renamed = structuredClone(original);
for (const object of renamed.objects) object.id = `renamed:${object.id}`;
if (renamed.targetId !== null) renamed.targetId = `renamed:${renamed.targetId}`;
const shifted = structuredClone(original);
shifted.self.position[0] += 40;
const jittered = structuredClone(original);
jittered.self.position[0] += 1e-9;
const beforePoison = { original: supported, renamed: medium.predict(first.cue, renamed),
  shifted: medium.predict(first.cue, shifted), jittered: medium.predict(first.cue, jittered) };
const poisonLearning = medium.observe({ ...poison, id: 'diagnostic-layout-expansion' });
const afterPoison = medium.predict(first.cue, original);
assert.equal(poisonLearning.learned, true);
assert.equal(afterPoison.reason, 'unobserved-receptor-layout');
const shortPrediction = prediction => ({ ...prediction, observation: prediction.observation ? 'present' : null });

// Change only nuisance identifiers and world origin in the recorded event.
// Sensor-relative measurements and action receipts are kept consistent.
const transformed = structuredClone(first);
const rename = id => id === 'self' || id === null || id === undefined ? id : `renamed:${id}`;
transformed.id = 'diagnostic-coordinate-transform';
transformed.trackedIds = transformed.trackedIds.map(rename);
if (transformed.bodyResult) transformed.bodyResult.action.targetId = rename(transformed.bodyResult.action.targetId);
for (const frame of transformed.frames) {
  frame.self.position[0] += 40; frame.self.position[2] += 12;
  frame.targetId = rename(frame.targetId);
  for (const object of frame.objects) object.id = rename(object.id);
}
const oldOriginal = old.eventRows(first), oldTransformed = old.eventRows(transformed);
const oldInvariance = { measurementStates: hash(oldOriginal.measurementStates) === hash(oldTransformed.measurementStates),
  measurementChanges: hash(oldOriginal.measurementChanges) === hash(oldTransformed.measurementChanges),
  roleBindings: hash(oldOriginal.roleBindings) === hash(oldTransformed.roleBindings) };

// A visible but previously untracked object reappears with a different value.
// This control asks whether the original encoder confuses missing with stale.
const visibilityEvent = { version: 'RealEventV5', id: 'diagnostic-occlusion',
  cue: { kind: 'observe', parameters: { ticks: 5 }, targetRole: null },
  provenance: 'executed-real-body', complete: true, trackedIds: ['self', 'object'],
  bodyResult: { action: { kind: 'observe', parameters: { ticks: 5 } }, executed: true,
    status: 'completed', startSequence: 1, endSequence: 4 },
  frames: [false, null, true, true].map((value, index) => ({ sequence: index + 1, activeSeconds: (index + 1) * .05,
    contextId: 'diagnostic-only', targetId: null, self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
    objects: value === null ? [] : [{ id: 'object', type: 'opaque', relativePosition: [0, 0, -2], properties: { active: value } }] })) };
const visibilityRows = old.eventRows(visibilityEvent);
const visibility = { measurementStates: visibilityRows.measurementStates,
  measurementChanges: visibilityRows.measurementChanges,
  actualTerminal: visibilityEvent.frames.at(-1).objects[0].properties.active };

// Probe the actual original afferent implementation with its physical write
// port. These are encoder/decoder round trips, NOT forward predictions.
const afferentRoundTrips = {};
for (const [version, Projection, Physical] of [
  ['7fe4157', oldAfferent.SelfOrganizingAfferentProjectionV1, oldPhysics.DistributedPhysicalMedium3DV1],
  ['185413d', SelfOrganizingAfferentProjectionV1, DistributedPhysicalMedium3DV1],
]) {
  const projection = new Projection(), physical = new Physical({ name: `diagnostic-${version}` });
  const noteTrials = [];
  const file = join(evidence, 'native-body-calibration-v2', 'calibration-events.jsonl');
  if (version === '7fe4157') files.push({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
  for await (const { phase, event } of records(file)) {
    const episode = projection.projectEvent(event, physical).episode;
    const readout = projection.readPublicState(episode.pulses.at(-1).drives);
    const actual = event.frames.at(-1).objects.find(object => object.id === event.bodyResult.action.targetId)?.properties.note;
    const decoded = readout.channels.filter(channel => channel.property === 'note');
    noteTrials.push({ phase, eventId: event.id, actual, decoded,
      correct: decoded.length === 1 && decoded[0].status === 'decoded' && Object.is(decoded[0].value, actual) });
  }
  const occlusionProjection = new Projection(), occlusionPhysical = new Physical({ name: `occlusion-${version}` });
  const asTarget = input => {
    const result = structuredClone(input);
    result.cue = { kind: 'interact', parameters: {}, targetRole: 'opaque' };
    result.bodyResult.action = { kind: 'interact', parameters: {}, targetId: 'object' };
    for (const frame of result.frames) frame.targetId = frame.objects.length ? 'object' : null;
    return result;
  };
  const targetEvent = asTarget(visibilityEvent), seed = asTarget(visibilityEvent);
  seed.id = 'diagnostic-occlusion-prior-channel';
  seed.frames = [structuredClone(seed.frames[2]), structuredClone(seed.frames[0])];
  seed.frames.forEach((frame, index) => { frame.sequence = index + 1; frame.activeSeconds = (index + 1) * .05; });
  seed.bodyResult.endSequence = 2;
  occlusionProjection.projectEvent(seed, occlusionPhysical);
  const episode = occlusionProjection.projectEvent(targetEvent, occlusionPhysical).episode;
  const terminal = occlusionProjection.readPublicState(episode.pulses.at(-1).drives);
  afferentRoundTrips[version] = { noteTrials, noteCorrect: noteTrials.filter(trial => trial.correct).length,
    occlusion: { actualTerminal: true, decoded: terminal.channels.filter(channel => channel.property === 'active') } };
}

const report = { version: 'KairosPerceptionDiagnosisV1', generatedAt: new Date().toISOString(),
  classification: 'offline replay and isolated diagnostic controls; not new live learning',
  files, training: { events: windows.length, accepted: windows.filter(row => row.newAccepted).length,
    discarded: windows.filter(row => !row.newAccepted).length, kinds,
    unionChannels: seen.size, categoricalInputs: inputs.size, firstUnionFailure },
  legacy: { encoded: legacyEncoded, identicalToCurrentEventRows: legacyIdentical,
    eventsWithUnresolvedRoles: legacyAmbiguous, bindings: bindingCount, unresolvedBindings: unresolvedCount,
    eventsWithOriginMismatch: legacyOriginMismatch, nuisanceTransformInvariance: oldInvariance, afferentRoundTrips },
  isolatedControls: { repetitions: 80, sourceEvent: first.id, poisonEvent: poison.id,
    beforePoison: Object.fromEntries(Object.entries(beforePoison).map(([key, value]) => [key, shortPrediction(value)])),
    poisonLearning, afterPoison: shortPrediction(afterPoison), visibility }, windows };
await mkdir(output, { recursive: true });
await writeFile(join(output, 'diagnosis.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, windows: `[${windows.length} detailed rows in diagnosis.json]`, files }, null, 2));
